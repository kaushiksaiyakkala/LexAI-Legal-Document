"""
LexAI agent — LangGraph StateGraph with Groq XML fallback.

Problem: llama-3.3-70b-versatile inconsistently generates an XML-style function
call format (<function=NAME{ARGS}</function>) instead of the JSON format Groq's
API expects. Groq's internal XML→JSON conversion then fails and returns the raw
XML in the 'failed_generation' error field.

Fix: the agent node catches that specific error, parses the XML itself, and
creates a proper LangChain AIMessage with tool_calls — identical to what the
model would have returned if it had generated valid JSON. LangGraph's ToolNode
then executes the tool normally.

Graph topology:
  agent ──► route ──► tools (ToolNode) ──► agent ──► ...
                └──► END (no tool calls)
"""

import os, uuid, re, json
from typing import Literal
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, AIMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import MessagesState
from langgraph.prebuilt import ToolNode

GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

SYSTEM_PROMPT = """\
You are LexAI, an expert legal document analyst. A legal document has been \
loaded and you have tools to search and analyse it.

Rules:
- ALWAYS call search_document or extract_clauses before answering factual questions.
- Quote relevant text when citing evidence.
- Use get_document_metadata for parties, dates, or jurisdiction questions.
- Use get_document_summary only for high-level overview requests.
- Explain legal jargon in plain English.
- If the document does not contain an answer, say so clearly — never fabricate.

Be precise, concise, and helpful."""

TOOL_LABELS = {
    "search_document":       "Searching document",
    "extract_clauses":       "Extracting clauses",
    "get_document_summary":  "Fetching summary",
    "get_document_metadata": "Reading metadata",
}


def _parse_xml_tool_call(failed_generation: str):
    """
    Parse Groq's XML function-call format: <function=NAME{JSON_ARGS}</function>
    Returns (tool_name, args_dict) or (None, None) on parse failure.
    """
    # Non-greedy match handles empty {} and single-level JSON args
    m = re.search(r"<function=(\w+)(\{.*?\})\s*</function>", failed_generation, re.DOTALL)
    if not m:
        # Missing closing tag variant
        m = re.search(r"<function=(\w+)(\{.*?\})", failed_generation, re.DOTALL)
    if not m:
        return None, None
    name = m.group(1)
    try:
        args = json.loads(m.group(2))
    except json.JSONDecodeError:
        args = {}
    return name, args


def _build_graph(tools: list):
    llm_tools = ChatGroq(
        model=GROQ_MODEL,
        temperature=0,
        model_kwargs={"parallel_tool_calls": False},
    ).bind_tools(tools)

    tool_names = {t.name for t in tools}
    tool_node  = ToolNode(tools)
    sys_msg    = SystemMessage(content=SYSTEM_PROMPT)

    def agent_node(state: MessagesState):
        msgs = [sys_msg] + state["messages"]
        try:
            response = llm_tools.invoke(msgs)
            return {"messages": [response]}

        except Exception as exc:
            # ── Groq XML-format fallback ──────────────────────────────────
            # Groq returns the raw XML in body.error.failed_generation when
            # it can't parse the model's <function=NAME{ARGS}> output.
            failed_gen = ""
            if hasattr(exc, "body") and isinstance(exc.body, dict):
                failed_gen = exc.body.get("error", {}).get("failed_generation", "")

            if not failed_gen:
                raise  # Not a tool-format error — propagate

            tool_name, tool_args = _parse_xml_tool_call(failed_gen)

            if not tool_name or tool_name not in tool_names:
                raise  # Couldn't recover — propagate

            # Reconstruct the tool call as a proper AIMessage so ToolNode
            # can execute it exactly as if the model had returned valid JSON
            return {"messages": [AIMessage(
                content="",
                tool_calls=[{
                    "name": tool_name,
                    "args": tool_args or {},
                    "id":   f"call_{uuid.uuid4().hex[:8]}",
                    "type": "tool_call",
                }],
            )]}

    def route(state: MessagesState) -> Literal["tools", "__end__"]:
        last = state["messages"][-1]
        return "tools" if (isinstance(last, AIMessage) and last.tool_calls) else "__end__"

    g = StateGraph(MessagesState)
    g.add_node("agent", agent_node)
    g.add_node("tools", tool_node)
    g.set_entry_point("agent")
    g.add_conditional_edges("agent", route, {"tools": "tools", "__end__": END})
    g.add_edge("tools", "agent")
    return g.compile()


async def stream_agent(tools: list, messages: list):
    """
    Async generator yielding SSE event dicts.

    Streams tool progress events in real-time via graph.astream().
    Emits the final answer word-by-word after all tool calls complete.

      {"type": "tool_start", "label": str}
      {"type": "tool_end"}
      {"type": "token",      "content": str}
    """
    graph = _build_graph(tools)
    last_agent_msg = None

    async for update in graph.astream({"messages": messages}, stream_mode="updates"):
        if "agent" in update:
            for msg in update["agent"].get("messages", []):
                if isinstance(msg, AIMessage):
                    last_agent_msg = msg
                    for tc in (msg.tool_calls or []):
                        name  = tc["name"]
                        args  = tc.get("args", {})
                        label = TOOL_LABELS.get(name, name)
                        first_val = (
                            next((str(v) for v in args.values() if v), "")
                            if isinstance(args, dict) else str(args)
                        )
                        if first_val:
                            label = f'{label} — "{first_val[:60]}"'
                        yield {"type": "tool_start", "label": label}

        elif "tools" in update:
            for _ in update["tools"].get("messages", []):
                yield {"type": "tool_end"}

    if last_agent_msg and last_agent_msg.content and not last_agent_msg.tool_calls:
        for word in last_agent_msg.content.split(" "):
            yield {"type": "token", "content": word + " "}

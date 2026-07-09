"""
LexAI — FastAPI backend (agentic RAG edition).

Endpoints:
  GET  /api/health
  POST /api/upload              upload PDF → background ingest + summarise
  GET  /api/status/{doc_id}     poll processing status
  POST /api/ask                 streaming SSE — LangGraph agent response
  DELETE /api/document/{doc_id} reset
"""

import os, sys, uuid, asyncio, json
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

# Project root on sys.path
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

load_dotenv(os.path.join(_ROOT, ".env"))

from langchain_core.messages import HumanMessage, AIMessage
from langchain_groq import ChatGroq

from baseline.preprocessing import preprocess_document, load_document_store, generate_doc_id
from backend.vectorstore import ingest_document, delete_document
from backend.tools import create_tools
from backend.agent import stream_agent

UPLOAD_DIR = os.path.join(_ROOT, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

doc_states: dict[str, dict] = {}
_executor = ThreadPoolExecutor(max_workers=2)


# ─── startup ────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm up ChromaDB + embeddings on first request (lazy) — nothing to do here
    if not os.getenv("GROQ_API_KEY"):
        print("WARNING: GROQ_API_KEY not set. Copy .env.example → .env and add your key.")
    yield
    _executor.shutdown(wait=False)


app = FastAPI(title="LexAI API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── health ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    groq_ready = bool(os.getenv("GROQ_API_KEY"))
    return {"status": "ok", "groq_ready": groq_ready}


# ─── upload ─────────────────────────────────────────────────────────────────
@app.post("/api/upload")
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    doc_id    = str(uuid.uuid4())[:8]
    save_path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")

    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    doc_states[doc_id] = {"status": "processing", "message": "Extracting document…", "filename": file.filename}
    background_tasks.add_task(_process_bg, doc_id, save_path)
    return {"doc_id": doc_id, "filename": file.filename}


async def _process_bg(doc_id: str, pdf_path: str):
    loop = asyncio.get_event_loop()
    try:
        # 1. PDF → text, chunks, metadata (existing preprocessing)
        doc_states[doc_id]["message"] = "Extracting and chunking text…"
        result = await loop.run_in_executor(
            _executor, _run_preprocessing, pdf_path
        )
        cleaned_text, sections, sentences, chunks, metadata, _ = result

        # 2. Embed chunks into ChromaDB
        doc_states[doc_id]["message"] = "Building vector index…"
        n = await loop.run_in_executor(_executor, ingest_document, doc_id, chunks)

        # 3. LLM summary (Groq)
        doc_states[doc_id]["message"] = "Generating AI summary…"
        llm_summary = await _generate_llm_summary(chunks)

        doc_states[doc_id] = {
            "status":   "ready",
            "filename": doc_states[doc_id].get("filename", ""),
            "data": {
                "doc_id":       doc_id,
                "doc_type":     metadata.get("doc_type", "Legal Document"),
                "parties":      metadata.get("parties", []),
                "dates":        metadata.get("dates", []),
                "jurisdiction": metadata.get("jurisdiction", ""),
                "total_chunks": len(chunks),
                "chunk_count":  n,
                "summary":      llm_summary,
                "metadata":     metadata,
            },
        }
    except Exception as exc:
        doc_states[doc_id] = {"status": "error", "message": str(exc)}


def _run_preprocessing(pdf_path: str):
    """Sync wrapper for preprocess_document (runs in thread pool)."""
    store_root = os.path.join(_ROOT, "document_store")
    doc_id     = generate_doc_id(pdf_path)
    store_path = os.path.join(store_root, doc_id)
    if os.path.exists(store_path):
        return load_document_store(doc_id, store_root=store_root)
    return preprocess_document(pdf_path, store_root=store_root)


async def _generate_llm_summary(chunks: list) -> str:
    """Summarise the document using Groq LLM."""
    if not os.getenv("GROQ_API_KEY"):
        return "Set GROQ_API_KEY in .env to enable AI summarisation."

    texts = [
        (c.get("text", c) if isinstance(c, dict) else str(c)).strip()
        for c in chunks
    ]
    texts = [t for t in texts if len(t.split()) > 30]
    if not texts:
        return "No content available for summarisation."

    # Use first ~8 000 chars to stay within context/cost limits
    combined = "\n\n".join(texts)[:8000]

    llm = ChatGroq(model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"), temperature=0)
    prompt = (
        "Analyse this legal document and produce a structured summary using EXACTLY this markdown format.\n"
        "Only include sections that are relevant to the document. Be specific and concise.\n\n"
        "## Overview\n"
        "[2-3 sentence description of what this document is and its purpose]\n\n"
        "## Parties\n"
        "- **[Party name]** — [brief role or description]\n\n"
        "## Key Obligations\n"
        "- [Most important obligation, right, or deliverable]\n\n"
        "## Important Dates & Terms\n"
        "- **[date or term]** — [what it refers to]\n\n"
        "## Notable Clauses\n"
        "- **[Clause name]** — [plain-English explanation]\n\n"
        "Rules: Use only the sections relevant to this document. No preamble or closing remarks. "
        "Bold only names, dates, amounts, and clause titles. Keep bullets short and scannable.\n\n"
        f"Document:\n{combined}\n\nSummary:"
    )
    response = await llm.ainvoke(prompt)
    return response.content


# ─── status ─────────────────────────────────────────────────────────────────
@app.get("/api/status/{doc_id}")
def get_status(doc_id: str):
    state = doc_states.get(doc_id)
    if not state:
        raise HTTPException(404, f"Document '{doc_id}' not found.")
    return state


# ─── ask (streaming SSE) ────────────────────────────────────────────────────
class MsgIn(BaseModel):
    role: str
    content: str

class AskRequest(BaseModel):
    doc_id:   str
    question: str
    history:  list[MsgIn] = []


@app.post("/api/ask")
async def ask_question(req: AskRequest):
    if not os.getenv("GROQ_API_KEY"):
        raise HTTPException(503, "GROQ_API_KEY not configured. See .env.example.")

    state = doc_states.get(req.doc_id)
    if not state:
        raise HTTPException(404, "Document not found.")
    if state.get("status") != "ready":
        raise HTTPException(400, f"Document is not ready yet (status: {state['status']}).")

    data  = state["data"]
    tools = create_tools(req.doc_id, data.get("metadata", {}), data.get("summary", ""))

    messages = []
    for m in req.history[-6:]:
        cls = HumanMessage if m.role == "user" else AIMessage
        messages.append(cls(content=m.content))
    messages.append(HumanMessage(content=req.question))

    async def event_stream():
        try:
            async for evt in stream_agent(tools, messages):
                yield f"data: {json.dumps(evt)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ─── delete ─────────────────────────────────────────────────────────────────
@app.delete("/api/document/{doc_id}")
def delete_doc(doc_id: str):
    doc_states.pop(doc_id, None)
    pdf_path = os.path.join(UPLOAD_DIR, f"{doc_id}.pdf")
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    delete_document(doc_id)
    return {"ok": True}

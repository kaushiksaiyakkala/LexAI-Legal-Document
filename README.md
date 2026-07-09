# LexAI — Agentic Legal Document Intelligence

Upload any legal PDF and ask questions in natural language. LexAI uses an agentic RAG pipeline powered by Groq's LLaMA 3.3 and LangGraph to search, reason, and stream answers back in real time.

---

## What it does

1. **Upload** a legal PDF (contract, NDA, court order, lease, etc.)
2. **Summarise** — Groq LLM generates a structured markdown summary (parties, obligations, key dates, notable clauses)
3. **Ask** — a LangGraph ReAct agent searches the document, calls tools, and streams a grounded answer with citations

---

## Architecture

```
Browser (React + Vite)
        │
        │  REST + SSE  (/api/upload, /api/status, /api/ask)
        ▼
FastAPI Backend
        │
        ├── PDF Ingest
        │     ├── pdfplumber   → raw text
        │     ├── spaCy        → sentences, NER, metadata
        │     └── ChromaDB     → all-MiniLM-L6-v2 embeddings (persistent)
        │
        ├── LLM Summary  (Groq llama-3.3-70b-versatile, non-streaming)
        │
        └── Agentic QA   (LangGraph StateGraph + Groq)
              ├── agent node   sync LLM.invoke() with tools bound
              ├── ToolNode     search_document · extract_clauses
              │                get_document_summary · get_document_metadata
              └── SSE stream   tool events + answer tokens → browser
```

---

## Key Design Decisions

### Groq tool-call XML fallback

`llama-3.3-70b-versatile` occasionally generates an XML-style function call (`<function=name{args}</function>`) instead of the JSON format Groq's API expects, causing a `failed_generation` error. The agent node catches this, parses the XML itself, reconstructs a proper `AIMessage`, and continues the loop — making QA bulletproof regardless of which format the model emits.

### Sync `invoke()` in agent node

LangChain's `ainvoke()` internally uses `_astream()` even when `streaming=False`. For this model, Groq's incremental streaming parser is less reliable than receiving the complete response. The agent node is a plain sync function so LangGraph runs it in a thread executor via `asyncio.to_thread`, giving Groq a complete non-streaming request.

### Two-stage LLM usage

| Stage | Model | Mode | Why |
|-------|-------|------|-----|
| Document summary | llama-3.3-70b-versatile | `ainvoke()` | No tools, 128 K context for long docs |
| Agentic QA | llama-3.3-70b-versatile | `invoke()` in thread | Reliable tool-call JSON generation |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| LLM | Groq Cloud — `llama-3.3-70b-versatile` (free tier) |
| Agent framework | LangGraph 1.x (`StateGraph` + `ToolNode`) |
| LLM SDK | LangChain + `langchain-groq` |
| Vector store | ChromaDB (persistent) + `all-MiniLM-L6-v2` embeddings |
| PDF extraction | pdfplumber + spaCy |
| Backend | FastAPI + SSE (`StreamingResponse`) |
| Frontend | React 18 + Vite |
| Voice | Web Speech API (STT + TTS) |

---

## Project Structure

```
NLP-Project/
│
├── backend/
│   ├── main.py          FastAPI app — upload, status, ask (SSE)
│   ├── agent.py         LangGraph StateGraph + XML fallback parser
│   ├── tools.py         Four LangChain tools (closures bound per document)
│   └── vectorstore.py   ChromaDB ingest + semantic search
│
├── baseline/
│   └── preprocessing.py PDF → text, chunks, metadata (spaCy NER)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx           State machine: idle → processing → workspace
│   │   ├── App.css           Two-column workspace (dark sidebar + content pane)
│   │   ├── hooks/useVoice.js Web Speech API (STT + TTS)
│   │   └── components/
│   │       ├── Header.jsx     LexAI logo + tech badge
│   │       ├── UploadZone.jsx drag-and-drop landing page
│   │       ├── Summary.jsx    structured markdown summary + metadata
│   │       └── Chat.jsx       streaming chat with tool-step pills
│   └── vite.config.js         proxies /api → localhost:8000
│
├── uploads/             uploaded PDFs (git-ignored)
├── chroma_db/           persistent vector store (git-ignored)
│
├── requirements.txt
├── .env.example
└── start.bat            Windows one-shot launcher
```

---

## Quick Start

### 1. Get a free Groq API key

Sign up at [console.groq.com](https://console.groq.com) — no credit card required.

```bash
cp .env.example .env
# Edit .env and paste your GROQ_API_KEY
```

### 2. Install Python dependencies

```bash
# Windows (Python 3.10+)
py -m pip install -r requirements.txt
py -m spacy download en_core_web_sm
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Start everything

**Windows (recommended):**
```bat
.\start.bat
```

**Manual (two terminals):**
```bash
# Terminal 1 — backend
py -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

### 5. Open the app

Go to **http://localhost:5173**

> Voice features require Chrome or Edge.

> The document store is in-memory — re-upload your PDF after restarting the backend.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check + Groq key status |
| `POST` | `/api/upload` | Upload PDF, returns `doc_id`, starts background ingest |
| `GET` | `/api/status/{doc_id}` | Poll: `processing` → `ready` → `error` |
| `POST` | `/api/ask` | `{ doc_id, question, history }` → SSE stream of tool + token events |
| `DELETE` | `/api/document/{doc_id}` | Delete document from memory + vector store |

Interactive docs: **http://localhost:8000/docs**

### SSE event types (`/api/ask`)

```json
{ "type": "tool_start", "label": "Searching document — \"termination clause\"" }
{ "type": "tool_end" }
{ "type": "token",      "content": "The termination " }
{ "type": "done" }
{ "type": "error",      "message": "..." }
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | — | **Required.** Your Groq API key |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model for document summarisation |
| `GROQ_AGENT_MODEL` | `llama-3.3-70b-versatile` | Model for the QA agent |

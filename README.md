# LexAI — Agentic Legal Document Intelligence

Upload any legal PDF and ask questions in natural language. LexAI uses an agentic RAG pipeline powered by Groq's LLaMA 3.3 and LangGraph to search, reason, and stream answers back in real time — no GPU required, runs entirely on Groq's free API.

---

## What it does

1. **Upload** a legal PDF (contract, NDA, court order, lease, etc.)
2. **Summarise** — Groq LLM generates a structured markdown summary covering parties, obligations, key dates, and notable clauses
3. **Ask** — a LangGraph ReAct agent searches the document, calls tools, and streams a grounded answer with citations back to the browser in real time

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
        │     ├── pdfplumber   → raw text extraction
        │     ├── spaCy        → sentences, NER, metadata
        │     └── ChromaDB     → all-MiniLM-L6-v2 embeddings (persistent)
        │
        ├── LLM Summary  (Groq llama-3.3-70b-versatile)
        │
        └── Agentic QA   (LangGraph StateGraph + Groq)
              ├── agent node   LLM with tools bound
              ├── ToolNode     search_document · extract_clauses
              │                get_document_summary · get_document_metadata
              └── SSE stream   tool events + answer tokens → browser
```

---

## Tech Stack

| Layer | Technology |
|---|---|
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
LexAI/
│
├── backend/
│   ├── main.py          FastAPI app — upload, status, ask (SSE)
│   ├── agent.py         LangGraph StateGraph + XML fallback parser
│   ├── tools.py         Four LangChain tools bound per document
│   └── vectorstore.py   ChromaDB ingest + semantic search
│
├── baseline/
│   └── preprocessing.py PDF → text, chunks, metadata (spaCy NER)
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx            State machine: idle → processing → workspace
│   │   ├── hooks/useVoice.js  Web Speech API (STT + TTS)
│   │   └── components/
│   │       ├── Header.jsx     Logo + tech badge
│   │       ├── UploadZone.jsx Drag-and-drop PDF upload
│   │       ├── Summary.jsx    Structured markdown summary + metadata
│   │       └── Chat.jsx       Streaming chat with tool-step pills
│   └── vite.config.js         Proxies /api → localhost:8000
│
├── uploads/             Uploaded PDFs (git-ignored)
├── chroma_db/           Persistent vector store (git-ignored)
├── requirements.txt
├── .env.example
├── start.bat            Windows one-shot launcher
└── start.sh             Unix one-shot launcher
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
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Start everything

**Windows:**
```bash
.\start.bat
```

**Mac/Linux:**
```bash
./start.sh
```

**Manual (two terminals):**
```bash
# Terminal 1 — backend
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — frontend
cd frontend && npm run dev
```

### 5. Open the app

Go to **http://localhost:5173**

> Voice features require Chrome or Edge.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check + Groq key status |
| `POST` | `/api/upload` | Upload PDF, returns `doc_id`, starts background ingest |
| `GET` | `/api/status/{doc_id}` | Poll: `processing` → `ready` → `error` |
| `POST` | `/api/ask` | `{ doc_id, question, history }` → SSE stream of tool + token events |
| `DELETE` | `/api/document/{doc_id}` | Delete document from memory + vector store |

Interactive docs: **http://localhost:8000/docs**

### SSE event stream (`/api/ask`)

```json
{ "type": "tool_start", "label": "Searching document — \"termination clause\"" }
{ "type": "tool_end" }
{ "type": "token", "content": "The termination " }
{ "type": "done" }
{ "type": "error", "message": "..." }
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | **Required.** Your Groq API key |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Model for document summarisation |
| `GROQ_AGENT_MODEL` | `llama-3.3-70b-versatile` | Model for the QA agent |

---

## Built by

3-person team — IIIT-Bangalore, 2026

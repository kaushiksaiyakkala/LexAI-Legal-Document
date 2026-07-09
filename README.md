# LexAI — Legal Document Intelligence Platform

Upload any legal PDF and ask natural-language questions about it. LexAI uses a local RAG pipeline — no API keys, no cloud, everything runs on your GPU.

---

## What it does

1. **Upload** a legal PDF (contract, NDA, credit agreement, lease, etc.)
2. **Summarise** — BART generates an abstractive summary of the document
3. **Ask** — a retrieve-rerank-generate pipeline finds the most relevant clauses and streams a grounded, citation-backed answer

Every answer cites the exact section name and page number it came from.

---

## Architecture

```
Browser (React + Vite)
        │
        │  REST  (/api/upload, /api/status, /api/ask)
        ▼
FastAPI Backend
        │
        ├── PDF Ingest
        │     ├── pdfplumber      → raw text extraction
        │     ├── preprocessing   → cleaning, section detection, chunking
        │     └── BGE-large       → 1024-dim embeddings (cached to disk)
        │
        ├── Document Summary  (facebook/bart-large-cnn, CPU)
        │
        └── RAG QA Pipeline
              ├── Stage 1 — BGE-large dense retrieval  (top-15 chunks)
              ├── Stage 2 — CrossEncoder reranking      (top-5 chunks)
              └── Stage 3 — Mistral-7B-Instruct (4-bit) → grounded answer
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | Mistral-7B-Instruct-v0.2 (4-bit NF4, local GPU) |
| Retrieval | BAAI/bge-large-en-v1.5 (1024-dim embeddings) |
| Reranking | cross-encoder/ms-marco-MiniLM-L-6-v2 |
| Summarization | facebook/bart-large-cnn (CPU) |
| Quantization | bitsandbytes NF4 |
| Vector storage | NumPy in-memory matrix + disk cache (.npy) |
| PDF extraction | pdfplumber |
| Backend | FastAPI + BackgroundTasks |
| Frontend | React 18 + Vite |
| Voice | Web Speech API (STT + TTS) |

---

## Project Structure

```
LexAI/
│
├── backend/
│   ├── main.py           FastAPI app — upload, status, ask endpoints
│   ├── reranker.py       CrossEncoder reranking (ms-marco-MiniLM)
│   └── summarizer.py     BART abstractive summarization
│
├── baseline/
│   └── preprocessing.py  PDF → text → chunks → TF-IDF index
│
├── rag/
│   ├── embedder.py       BGE-large with asymmetric query encoding
│   ├── retriever.py      Cosine similarity search + section boost + disk cache
│   └── generator.py      Mistral-7B-Instruct 4-bit generation
│
├── pipeline_v2.py        Orchestrates the full RAG pipeline
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx            State machine: idle → processing → workspace
│   │   ├── hooks/useVoice.js  Web Speech API (STT + TTS)
│   │   └── components/
│   │       ├── UploadZone.jsx  Drag-and-drop PDF upload
│   │       ├── Summary.jsx     Document summary + metadata
│   │       └── Chat.jsx        Q&A chat with citations
│   └── vite.config.js          Proxies /api → localhost:8000
│
├── document_store/       Processed docs + embedding cache (git-ignored)
├── uploads/              Uploaded PDFs (git-ignored)
├── requirements.txt
└── start.bat             Windows one-shot launcher
```

---

## Quick Start

### Requirements

- Python 3.10+
- Node.js 18+
- NVIDIA GPU with 8GB+ VRAM (RTX 3060 / 4060 or better)
- CUDA 12.1

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Start the backend

```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

On first run this downloads:
- BGE-large (~335MB)
- CrossEncoder (~91MB)
- Mistral-7B-Instruct 4-bit (~4.5GB)
- BART-large-CNN (~1.6GB)

Subsequent runs load from cache — startup takes ~30 seconds.

### 4. Start the frontend

```bash
cd frontend
npm run dev
```

### 5. Open the app

Go to **http://localhost:5173**

> Voice features require Chrome or Edge.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check + pipeline status |
| `POST` | `/api/upload` | Upload PDF, returns `doc_id`, starts background processing |
| `GET` | `/api/status/{doc_id}` | Poll: `processing` → `ready` → `error` |
| `POST` | `/api/ask` | `{ doc_id, question }` → `{ answer, sources }` |
| `DELETE` | `/api/document/{doc_id}` | Clear document from pipeline |

Interactive docs: **http://localhost:8000/docs**

### Example `/api/ask` response

```json
{
  "question": "What is the interest rate on the Senior Loans?",
  "answer": "The Senior Loans bear interest at a rate per annum equal to LIBOR plus 1.0%. (Section 2.05(a))",
  "sources": [
    {
      "section": "ARTICLE 2 AMOUNT AND TERMS OF COMMITMENTS",
      "page_start": 17,
      "page_end": 17,
      "retrieval_score": 0.6589,
      "rerank_score": 1.8639
    }
  ]
}
```

---

## How the RAG pipeline works

**Chunking** — Documents are split into ~350 word chunks with 50 word overlap, sentence-aware so clauses never break mid-sentence. Each chunk stores section heading, page range, and position.

**Retrieval** — BGE-large embeds the question with an asymmetric instruction prefix and all chunks without it, then returns the top-15 most similar chunks by cosine similarity. A section-heading boost nudges scores up when a chunk's section heading overlaps with question keywords.

**Reranking** — The CrossEncoder sees question and chunk together in a single forward pass (unlike the bi-encoder which embeds them separately), scoring true relevance. Top 5 chunks go to generation.

**Generation** — Mistral-7B-Instruct reads the 5 chunks as grounded context and generates an answer. The system prompt instructs it to answer only from the provided context and explicitly state when the answer is not present — preventing hallucination.

**Embedding cache** — BGE embeddings are saved to `document_store/{doc_id}/bge_embeddings.npy` after the first run. Re-uploading the same document or restarting the server skips re-embedding entirely.

---

## GPU Memory Usage (RTX 4060 8GB)

| Model | VRAM |
|---|---|
| Mistral-7B 4-bit | ~4.5 GB |
| BGE-large | ~1.3 GB |
| CrossEncoder | ~0.1 GB |
| **Total** | **~6 GB** |

BART summarizer runs on CPU to preserve GPU budget for Mistral.

---

## Tested On

54-page TALF LLC Credit Agreement (Federal Reserve Bank of New York / US Treasury, 2009)

| Question | Answer quality |
|---|---|
| What is the interest rate on the Senior Loans? | ✅ LIBOR + 1.0%, Section 2.05(a) |
| What happens if the borrower defaults? | ✅ Cited Section 8.02 accurately |
| What are the conditions before any loan can be made? | ✅ Listed all 6 conditions from Article 5 |
| What rights does the Subordinated Lender lose until Senior Debt is paid? | ✅ Cited subsections (e), (f), (g), (j) |

---

## Built by

4-person team — IIIT-Bangalore, 2026

import { useRef, useState } from 'react'

const FEATURES = [
  {
    icon: '🤖',
    title: 'Agentic RAG',
    sub: 'LangGraph ReAct agent reasons step-by-step',
  },
  {
    icon: '⚡',
    title: 'Groq LLM',
    sub: 'Llama 3.3 70B — fast, free, accurate',
  },
  {
    icon: '🔍',
    title: 'Semantic Search',
    sub: 'ChromaDB vector store with MiniLM embeddings',
  },
  {
    icon: '🎤',
    title: 'Voice Q&A',
    sub: 'Speak your question, hear the answer',
  },
]

export default function UploadZone({ onUpload }) {
  const inputRef = useRef()
  const [dragging, setDragging] = useState(false)

  const handleFile = (file) => {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      alert('Please upload a PDF file.')
      return
    }
    onUpload(file)
  }

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div className="upload-wrapper">
      <div className="upload-hero">
        <div className="upload-eyebrow">
          ✦ Agentic Legal AI
        </div>
        <h1 className="upload-headline">
          Understand any legal document <span>instantly</span>
        </h1>
        <p className="upload-subhead">
          Upload a contract, NDA, or agreement. An AI agent reads it, builds a searchable index, and answers your questions with real citations.
        </p>
      </div>

      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current.click()}
        aria-label="Upload PDF file"
      >
        <span className="upload-icon">📄</span>
        <p className="upload-title">Drop your PDF here</p>
        <p className="upload-sub">or <span className="upload-link">click to browse</span></p>
        <p className="upload-hint">Contracts · NDAs · Agreements · Policies</p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          style={{ display: 'none' }}
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>

      <div className="feature-grid">
        {FEATURES.map(f => (
          <div key={f.title} className="feature-card">
            <span className="feature-card-icon">{f.icon}</span>
            <span className="feature-card-title">{f.title}</span>
            <span className="feature-card-sub">{f.sub}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

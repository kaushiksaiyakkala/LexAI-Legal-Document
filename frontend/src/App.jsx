import { useState, useEffect, useCallback, useRef } from 'react'
import Header from './components/Header'
import UploadZone from './components/UploadZone'
import Summary from './components/Summary'
import Chat from './components/Chat'
import { uploadDocument, getStatus, deleteDocument } from './api/client'
import './App.css'

// phase: 'idle' | 'uploading' | 'processing' | 'ready' | 'error'

export default function App() {
  const [phase, setPhase]         = useState('idle')
  const [docId, setDocId]         = useState(null)
  const [docData, setDocData]     = useState(null)
  const [statusMsg, setStatusMsg] = useState('')
  const [activeTab, setActiveTab] = useState('summary')
  const [messages, setMessages]   = useState([])
  const [qaLoading, setQaLoading] = useState(false)

  const historyRef = useRef([])

  // Poll status while processing
  useEffect(() => {
    if (phase !== 'processing' || !docId) return
    const interval = setInterval(async () => {
      try {
        const status = await getStatus(docId)
        setStatusMsg(status.message || 'Processing…')
        if (status.status === 'ready') {
          setDocData(status.data)
          setPhase('ready')
        } else if (status.status === 'error') {
          setStatusMsg(status.message || 'Processing failed.')
          setPhase('error')
        }
      } catch { /* keep polling */ }
    }, 2000)
    return () => clearInterval(interval)
  }, [phase, docId])

  const handleUpload = async (file) => {
    setPhase('uploading')
    setMessages([])
    setDocData(null)
    setActiveTab('summary')
    historyRef.current = []
    try {
      const { doc_id } = await uploadDocument(file)
      setDocId(doc_id)
      setPhase('processing')
      setStatusMsg('Extracting and indexing document…')
    } catch (e) {
      setPhase('error')
      setStatusMsg(e.message || 'Upload failed.')
    }
  }

  const handleAsk = useCallback(async (question) => {
    if (qaLoading) return
    setMessages(prev => [...prev, { role: 'user', text: question }])
    setQaLoading(true)

    let assistantAdded = false
    const addAssistant = () => {
      if (!assistantAdded) {
        assistantAdded = true
        setMessages(prev => [...prev, { role: 'assistant', text: '', toolSteps: [], streaming: true }])
      }
    }

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doc_id: docId, question,
          history: historyRef.current.slice(-6),
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail || 'Request failed')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = '', finalText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(line.slice(6)) } catch { continue }

          if (evt.type === 'tool_start') {
            addAssistant()
            setMessages(prev => {
              const msgs = [...prev], last = msgs[msgs.length - 1]
              if (last?.role !== 'assistant') return msgs
              return [...msgs.slice(0, -1),
                { ...last, toolSteps: [...(last.toolSteps || []), { label: evt.label, done: false }] }]
            })
          } else if (evt.type === 'tool_end') {
            setMessages(prev => {
              const msgs = [...prev], last = msgs[msgs.length - 1]
              if (last?.role !== 'assistant') return msgs
              const steps = [...(last.toolSteps || [])]
              const ri = [...steps].reverse().findIndex(s => !s.done)
              if (ri !== -1) steps[steps.length - 1 - ri] = { ...steps[steps.length - 1 - ri], done: true }
              return [...msgs.slice(0, -1), { ...last, toolSteps: steps }]
            })
          } else if (evt.type === 'token') {
            addAssistant()
            finalText += evt.content
            const snap = finalText
            setMessages(prev => {
              const msgs = [...prev], last = msgs[msgs.length - 1]
              if (last?.role !== 'assistant') return msgs
              return [...msgs.slice(0, -1), { ...last, text: snap, streaming: true }]
            })
          } else if (evt.type === 'done') {
            setMessages(prev => {
              const msgs = [...prev], last = msgs[msgs.length - 1]
              if (last?.role !== 'assistant') return msgs
              return [...msgs.slice(0, -1), { ...last, streaming: false }]
            })
            historyRef.current = [
              ...historyRef.current,
              { role: 'user', content: question },
              { role: 'assistant', content: finalText },
            ]
          } else if (evt.type === 'error') {
            addAssistant()
            setMessages(prev => {
              const msgs = [...prev], last = msgs[msgs.length - 1]
              if (last?.role !== 'assistant') return msgs
              return [...msgs.slice(0, -1),
                { ...last, text: `Error: ${evt.message}`, streaming: false, found: false }]
            })
          }
        }
      }
    } catch (e) {
      addAssistant()
      setMessages(prev => {
        const msgs = [...prev], last = msgs[msgs.length - 1]
        if (last?.role !== 'assistant') return msgs
        return [...msgs.slice(0, -1),
          { ...last, text: `Error: ${e.message}`, streaming: false, found: false }]
      })
    } finally {
      setQaLoading(false)
    }
  }, [docId, qaLoading])

  const handleReset = async () => {
    if (docId) { try { await deleteDocument(docId) } catch {} }
    setPhase('idle'); setDocId(null); setDocData(null)
    setMessages([]); setStatusMsg(''); setActiveTab('summary')
    historyRef.current = []
  }

  const questionCount = messages.filter(m => m.role === 'user').length

  return (
    <div className="app">
      <Header onReset={handleReset} hasDocument={phase === 'ready'} />

      <main className="main">
        {phase === 'idle' && <UploadZone onUpload={handleUpload} />}

        {(phase === 'uploading' || phase === 'processing') && (
          <div className="center-card">
            <div className="spinner" />
            <p className="status-msg">{statusMsg || 'Uploading…'}</p>
            <p className="status-hint">
              {phase === 'processing'
                ? 'Building vector index and generating AI summary with Groq…'
                : 'Uploading your file…'}
            </p>
          </div>
        )}

        {phase === 'error' && (
          <div className="center-card error">
            <div className="error-icon">⚠️</div>
            <p className="error-msg">{statusMsg}</p>
            <button className="btn-primary" onClick={handleReset}>Try Again</button>
          </div>
        )}

        {phase === 'ready' && docData && (
          <div className="workspace">

            {/* ── Left sidebar ── */}
            <aside className="doc-sidebar">
              <div className="sidebar-doc-header">
                <div className="sidebar-doc-icon">📄</div>
                <div className="sidebar-doc-type">{docData.doc_type}</div>
                <div className="sidebar-doc-stat">
                  <span className="sidebar-stat-dot" />
                  {docData.chunk_count ?? docData.total_chunks} sections indexed
                </div>
              </div>

              <div className="sidebar-divider" />

              {/* Metadata */}
              <div className="sidebar-meta">
                {docData.parties?.length > 0 && (
                  <div className="sidebar-meta-item">
                    <span className="sidebar-meta-label">Parties</span>
                    <span className="sidebar-meta-value">
                      {docData.parties.slice(0, 3).join(', ')}
                      {docData.parties.length > 3 && ` +${docData.parties.length - 3} more`}
                    </span>
                  </div>
                )}
                {docData.dates?.length > 0 && (
                  <div className="sidebar-meta-item">
                    <span className="sidebar-meta-label">Key Dates</span>
                    <span className="sidebar-meta-value">{docData.dates.slice(0, 3).join(', ')}</span>
                  </div>
                )}
                {docData.jurisdiction && docData.jurisdiction !== 'Unknown' && (
                  <div className="sidebar-meta-item">
                    <span className="sidebar-meta-label">Jurisdiction</span>
                    <span className="sidebar-meta-value">{docData.jurisdiction}</span>
                  </div>
                )}
              </div>

              <div className="sidebar-divider" />

              {/* Navigation */}
              <nav className="sidebar-nav">
                <button
                  className={`sidebar-nav-btn ${activeTab === 'summary' ? 'active' : ''}`}
                  onClick={() => setActiveTab('summary')}
                >
                  <span className="sidebar-nav-icon">📋</span>
                  Summary
                </button>
                <button
                  className={`sidebar-nav-btn ${activeTab === 'qa' ? 'active' : ''}`}
                  onClick={() => setActiveTab('qa')}
                >
                  <span className="sidebar-nav-icon">💬</span>
                  Ask AI
                  {questionCount > 0 && (
                    <span className="sidebar-nav-badge">{questionCount}</span>
                  )}
                </button>
              </nav>
            </aside>

            {/* ── Main content ── */}
            <div className="doc-content">
              {activeTab === 'summary' && <Summary data={docData} />}
              {activeTab === 'qa' && (
                <Chat messages={messages} onAsk={handleAsk} loading={qaLoading} />
              )}
            </div>

          </div>
        )}
      </main>
    </div>
  )
}

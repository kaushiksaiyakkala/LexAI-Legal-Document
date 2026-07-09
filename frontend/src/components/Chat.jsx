import { useState, useRef, useEffect } from 'react'
import { useVoice } from '../hooks/useVoice'

const SUGGESTIONS = [
  'Give me an overview of this document.',
  'Who are the parties to this agreement?',
  'What are the termination conditions?',
  'What are the payment terms?',
  'What confidentiality obligations apply?',
  'What is the governing law?',
]

export default function Chat({ messages, onAsk, loading }) {
  const [input, setInput]         = useState('')
  const [autoSpeak, setAutoSpeak] = useState(false)
  const bottomRef                 = useRef()
  const prevLengthRef             = useRef(0)

  const {
    isListening, isSpeaking, supported,
    startListening, stopListening, speak, stopSpeaking,
  } = useVoice()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!autoSpeak || !supported.tts) return
    if (messages.length <= prevLengthRef.current) return
    prevLengthRef.current = messages.length
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && !last.streaming && last.text) speak(last.text)
  }, [messages, autoSpeak, supported.tts, speak])

  const handleSubmit = (e) => {
    e.preventDefault()
    const q = input.trim()
    if (!q || loading || isListening) return
    setInput('')
    onAsk(q)
  }

  const handleMic = () => {
    if (isListening) { stopListening(); return }
    stopSpeaking()
    startListening(
      (transcript) => { setInput(transcript); setTimeout(() => { onAsk(transcript); setInput('') }, 400) },
      (err) => alert(`Mic error: ${err}`),
    )
  }

  const statusLabel = isListening ? '🎤 Listening…' : isSpeaking ? '🔊 Speaking…' : 'Ask anything about the document'

  return (
    <div className="chat-panel">

      {/* toolbar */}
      <div className="chat-toolbar">
        <span className="chat-status">{statusLabel}</span>
        <div className="toolbar-actions">
          {supported.tts && (
            <button className={`toolbar-btn ${autoSpeak ? 'on' : ''}`}
              onClick={() => { if (autoSpeak) stopSpeaking(); setAutoSpeak(v => !v) }}
              title={autoSpeak ? 'Mute auto-read' : 'Enable auto-read'}>
              {autoSpeak ? '🔊' : '🔇'}
              <span className="toolbar-btn-label">{autoSpeak ? 'Auto-read on' : 'Auto-read off'}</span>
            </button>
          )}
          {isSpeaking && (
            <button className="toolbar-btn stop" onClick={stopSpeaking}>⏹ Stop</button>
          )}
        </div>
      </div>

      {/* messages */}
      <div className="messages-area">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">💬</div>
            <p className="chat-empty-title">Ask anything about this document</p>
            <p className="chat-empty-sub">The AI agent will search and cite the document before answering.</p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button key={s} className="suggestion-chip"
                  onClick={() => !loading && !isListening && onAsk(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === 'user' ? (
              <>
                <div className="bubble user-bubble"><p>{msg.text}</p></div>
                <div className="avatar user-avatar">U</div>
              </>
            ) : (
              <>
                <div className="avatar bot-avatar">⚖️</div>
                <div className="bubble bot-bubble">
                  {/* tool steps */}
                  {msg.toolSteps?.length > 0 && (
                    <div className="tool-steps">
                      {msg.toolSteps.map((step, j) => (
                        <div key={j} className={`tool-step ${step.done ? 'done' : 'running'}`}>
                          <span className="tool-icon">🔧</span>
                          <span className="tool-label">{step.label}</span>
                          {!step.done && <span className="tool-spinner" />}
                          {step.done  && <span className="tool-check">✓</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {msg.text && (
                    <p className={msg.found === false ? 'not-found' : ''}>
                      {msg.text}
                      {msg.streaming && <span className="cursor-blink">▍</span>}
                    </p>
                  )}

                  {!msg.streaming && msg.text && supported.tts && msg.found !== false && (
                    <div className="bubble-footer">
                      <button className="replay-btn" onClick={() => speak(msg.text)} title="Read aloud">🔊</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="message assistant">
            <div className="avatar bot-avatar">⚖️</div>
            <div className="bubble bot-bubble">
              <div className="typing-dots"><span /><span /><span /></div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          className={`chat-input ${isListening ? 'listening' : ''}`}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={isListening ? 'Listening…' : 'Ask a question about the document…'}
          disabled={loading || isListening}
          autoFocus
        />
        {supported.stt && (
          <button type="button" className={`mic-btn ${isListening ? 'active' : ''}`}
            onClick={handleMic} disabled={loading}
            title={isListening ? 'Stop' : 'Speak your question'}>
            {isListening ? '⏹' : '🎤'}
          </button>
        )}
        <button type="submit" className="send-btn"
          disabled={!input.trim() || loading || isListening}>↑</button>
      </form>
    </div>
  )
}

export default function Header({ onReset, hasDocument }) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="logo" onClick={hasDocument ? onReset : undefined}
          style={{ cursor: hasDocument ? 'pointer' : 'default' }}>
          <span className="logo-icon">⚖️</span>
          <span className="logo-text">LexAI</span>
          <span className="logo-beta">Beta</span>
        </div>
        <div className="header-right">
          <span className="model-badge">Groq · LangGraph · ChromaDB</span>
          {hasDocument && (
            <button className="new-doc-btn" onClick={onReset}>+ New Document</button>
          )}
        </div>
      </div>
    </header>
  )
}

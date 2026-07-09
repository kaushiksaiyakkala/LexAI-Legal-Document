function parseBold(str) {
  const parts = str.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : part
  )
}

function MarkdownSummary({ text }) {
  if (!text) return <p className="summary-para" style={{ color: 'var(--text-muted)' }}>Summary not available.</p>

  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let key = 0

  const flushList = () => {
    if (listItems.length === 0) return
    elements.push(
      <ul key={key++} className="summary-list">{listItems}</ul>
    )
    listItems = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('## ')) {
      flushList()
      elements.push(
        <h3 key={key++} className="summary-section-title">{line.slice(3)}</h3>
      )
    } else if (line.startsWith('- ')) {
      listItems.push(<li key={key++}>{parseBold(line.slice(2))}</li>)
    } else if (line.trim() === '') {
      flushList()
    } else {
      flushList()
      elements.push(<p key={key++} className="summary-para">{parseBold(line)}</p>)
    }
  }
  flushList()

  return <>{elements}</>
}

export default function Summary({ data }) {
  return (
    <div className="summary-panel">

      {/* AI Summary */}
      <section className="summary-card primary">
        <div className="card-header">
          <h2>AI Summary</h2>
          <div className="badges">
            <span className="badge indigo">Llama 3.3 · Groq</span>
            <span className="badge purple">Generative AI</span>
          </div>
        </div>
        <MarkdownSummary text={data.summary} />
        {data.summary && (
          <div className="card-footer">~{data.summary.split(' ').length} words</div>
        )}
      </section>

      {/* Document Metadata */}
      {(data.parties?.length > 0 || data.dates?.length > 0 || data.jurisdiction || data.total_chunks) && (
        <section className="summary-card metadata-card">
          <div className="card-header">
            <h2>Document Details</h2>
            <div className="badges">
              <span className="badge green">Extracted</span>
            </div>
          </div>
          <div className="meta-grid">
            {data.doc_type && (
              <div className="meta-item">
                <label>Document Type</label>
                <span>{data.doc_type}</span>
              </div>
            )}
            {data.parties?.length > 0 && (
              <div className="meta-item">
                <label>Parties</label>
                <span>{data.parties.join(' · ')}</span>
              </div>
            )}
            {data.dates?.length > 0 && (
              <div className="meta-item">
                <label>Key Dates</label>
                <span>{data.dates.join(', ')}</span>
              </div>
            )}
            {data.jurisdiction && (
              <div className="meta-item">
                <label>Jurisdiction</label>
                <span>{data.jurisdiction}</span>
              </div>
            )}
            <div className="meta-item">
              <label>Indexed Sections</label>
              <span>{data.chunk_count ?? data.total_chunks} chunks</span>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

export function uploadDocument(file) {
  const form = new FormData()
  form.append('file', file)
  return request('/upload', { method: 'POST', body: form })
}

export function getStatus(docId) {
  return request(`/status/${docId}`)
}

export function askQuestion(docId, question) {
  return request('/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc_id: docId, question }),
  })
}

export function deleteDocument(docId) {
  return request(`/document/${docId}`, { method: 'DELETE' })
}

export function healthCheck() {
  return request('/health')
}

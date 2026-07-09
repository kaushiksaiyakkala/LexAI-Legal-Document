"""
LangChain tools for the LexAI legal document agent.
Tools are created as closures bound to a specific document so the agent
can never accidentally query the wrong document.
"""

from langchain_core.tools import tool
from backend.vectorstore import search


def create_tools(doc_id: str, metadata: dict, summary: str = ""):
    """Return the four agent tools, each bound to this document."""

    @tool
    def search_document(query: str) -> str:
        """
        Search the loaded legal document for sections relevant to the query.
        Use this for any factual question about the document's content —
        obligations, rights, definitions, penalties, timelines, etc.
        Input: a concise search query describing what to look for.
        """
        chunks = search(doc_id, query, n=5)
        if not chunks:
            return "No relevant sections found for that query."
        return "\n\n---\n\n".join(chunks)

    @tool
    def extract_clauses(clause_type: str) -> str:
        """
        Extract all sections related to a specific clause type from the document.
        Use this when the user asks about a named clause category.
        Examples of clause_type values:
          'termination', 'payment', 'confidentiality', 'indemnification',
          'governing law', 'intellectual property', 'liability', 'warranties',
          'dispute resolution', 'non-compete', 'force majeure'.
        Input: the clause type as a short string.
        """
        queries = [
            f"{clause_type} clause",
            f"{clause_type} provisions",
            f"article {clause_type}",
            f"{clause_type} terms",
        ]
        seen, chunks = set(), []
        for q in queries:
            for chunk in search(doc_id, q, n=3):
                key = chunk[:80]
                if key not in seen:
                    seen.add(key)
                    chunks.append(chunk)
        if not chunks:
            return f"No '{clause_type}' clauses found in this document."
        return "\n\n---\n\n".join(chunks[:5])

    @tool
    def get_document_summary(query: str = "") -> str:
        """
        Get the high-level AI-generated summary of the entire document.
        Use this at the start of a conversation or when the user asks for
        an overview of what the document is about.
        Input: pass an empty string.
        """
        return summary if summary else (
            "Summary not yet available. Try using search_document to explore the document."
        )

    @tool
    def get_document_metadata(query: str = "") -> str:
        """
        Get structured metadata about the document: parties involved, key dates,
        jurisdiction, and document type.
        Use this when asked who signed the agreement, what dates are mentioned,
        or which country/state governs the contract.
        Input: pass an empty string.
        """
        if not metadata:
            return "No metadata available for this document."
        parts = []
        if metadata.get("doc_type"):
            parts.append(f"Document type: {metadata['doc_type']}")
        if metadata.get("parties"):
            parts.append(f"Parties: {', '.join(metadata['parties'])}")
        if metadata.get("dates"):
            parts.append(f"Key dates: {', '.join(metadata['dates'])}")
        if metadata.get("jurisdiction"):
            parts.append(f"Jurisdiction / governing law: {metadata['jurisdiction']}")
        return "\n".join(parts) if parts else "No structured metadata found."

    return [search_document, extract_clauses, get_document_summary, get_document_metadata]

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

import chromadb

from rag.config import Settings
from rag.models import KnowledgeChunk, RetrievalHit


def _sanitize_metadata(metadata: Dict[str, Any]) -> Dict[str, Union[str, int, float, bool]]:
    sanitized: Dict[str, Union[str, int, float, bool]] = {}
    for key, value in metadata.items():
        if isinstance(value, bool):
            sanitized[key] = value
        elif isinstance(value, (str, int, float)):
            sanitized[key] = value
        elif value is not None:
            sanitized[key] = str(value)
    return sanitized


class ChromaVectorStore:
    def __init__(self, settings: Settings):
        settings.chroma_path.mkdir(parents=True, exist_ok=True)
        self.settings = settings
        self.client = chromadb.PersistentClient(path=str(settings.chroma_path))
        self.collection = self.client.get_or_create_collection(
            name=settings.collection_name,
            metadata={
                "embedding_provider": settings.embedding_provider,
                "embedding_model": settings.embedding_model,
            },
        )

    def reset_collection(self) -> None:
        self.client.delete_collection(name=self.settings.collection_name)
        self.collection = self.client.get_or_create_collection(
            name=self.settings.collection_name,
            metadata={
                "embedding_provider": self.settings.embedding_provider,
                "embedding_model": self.settings.embedding_model,
            },
        )

    def upsert_chunks(self, chunks: List[KnowledgeChunk], embeddings: List[List[float]]) -> int:
        if not chunks:
            return 0
        if len(chunks) != len(embeddings):
            raise ValueError("Chunk count and embedding count must match")

        self.collection.upsert(
            ids=[chunk.chunk_id for chunk in chunks],
            documents=[chunk.retrieval_text or chunk.text for chunk in chunks],
            embeddings=embeddings,
            metadatas=[
                _sanitize_metadata(
                    {
                        "document_id": chunk.document_id,
                        "title": chunk.title,
                        "source": chunk.source or "",
                        "section_id": chunk.section_id or "",
                        "section_title": chunk.section_title or "",
                        "raw_text": chunk.text,
                        **chunk.metadata,
                    }
                )
                for chunk in chunks
            ],
        )
        return len(chunks)

    def query(
        self,
        query_embedding: List[float],
        top_k: int,
        where: Optional[Dict[str, Any]] = None,
        where_document: Optional[Dict[str, Any]] = None,
    ) -> List[RetrievalHit]:
        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where=where,
            where_document=where_document,
            include=["documents", "metadatas", "distances"],
        )

        ids = results.get("ids", [[]])[0]
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        hits: List[RetrievalHit] = []
        for chunk_id, document, metadata, distance in zip(ids, documents, metadatas, distances):
            metadata = metadata or {}
            raw_text = metadata.get("raw_text")
            text = str(raw_text) if isinstance(raw_text, str) and raw_text.strip() else document
            hits.append(
                RetrievalHit(
                    chunk_id=chunk_id,
                    document_id=str(metadata.get("document_id", "")),
                    title=str(metadata.get("title", "")),
                    text=text,
                    source=str(metadata.get("source", "")) or None,
                    distance=float(distance),
                    score=max(0.0, 1 - float(distance)),
                    section_id=str(metadata.get("section_id", "")) or None,
                    section_title=str(metadata.get("section_title", "")) or None,
                    dense_score=max(0.0, 1 - float(distance)),
                    rerank_score=max(0.0, 1 - float(distance)),
                    retrieval_sources=["vector"],
                    metadata=metadata,
                )
            )
        return hits

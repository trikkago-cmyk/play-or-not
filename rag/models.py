from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, Field


ScalarMetadata = Union[str, int, float, bool]


class DocumentSection(BaseModel):
    section_id: Optional[str] = None
    title: str
    text: str
    metadata: Dict[str, ScalarMetadata] = Field(default_factory=dict)


class KnowledgeDocument(BaseModel):
    document_id: str
    title: str
    source: Optional[str] = None
    text: Optional[str] = None
    metadata: Dict[str, ScalarMetadata] = Field(default_factory=dict)
    sections: List[DocumentSection] = Field(default_factory=list)


class KnowledgeChunk(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    text: str
    retrieval_text: Optional[str] = None
    source: Optional[str] = None
    section_id: Optional[str] = None
    section_title: Optional[str] = None
    metadata: Dict[str, ScalarMetadata] = Field(default_factory=dict)


class RetrievalHit(BaseModel):
    chunk_id: str
    document_id: str
    title: str
    text: str
    source: Optional[str] = None
    distance: float
    score: float
    section_id: Optional[str] = None
    section_title: Optional[str] = None
    dense_score: Optional[float] = None
    lexical_score: Optional[float] = None
    rerank_score: Optional[float] = None
    retrieval_sources: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class HealthResponse(BaseModel):
    status: str
    app_name: str
    collection_name: str
    chroma_path: str
    embedding_provider: str
    embedding_model: str
    embedding_cache_dir: str


class IngestRequest(BaseModel):
    input_path: str
    reset_collection: bool = False


class IngestResponse(BaseModel):
    input_path: str
    documents_loaded: int
    chunks_written: int
    collection_name: str
    reset_collection: bool = False


class QueryRequest(BaseModel):
    query: str
    top_k: int = 5
    mode: Optional[str] = None
    active_game_id: Optional[str] = None
    where: Optional[Dict[str, Any]] = None
    where_document: Optional[Dict[str, Any]] = None
    debug: bool = False


class QueryResponse(BaseModel):
    query: str
    top_k: int
    hits: List[RetrievalHit]
    rewritten_query: Optional[str] = None
    strategy: Optional[str] = None
    diagnostics: Dict[str, Any] = Field(default_factory=dict)

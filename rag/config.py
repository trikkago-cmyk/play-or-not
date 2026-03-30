from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "boardgame-dm-rag"
    app_env: str = "development"
    embedding_provider: str = Field(
        default="fastembed",
        validation_alias=AliasChoices("RAG_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"),
    )
    embedding_model: str = Field(
        default="BAAI/bge-small-zh-v1.5",
        validation_alias=AliasChoices("RAG_EMBEDDING_MODEL", "EMBEDDING_MODEL"),
    )
    embedding_cache_dir: Path = Field(
        default=Path("rag/.cache/fastembed"),
        validation_alias=AliasChoices("RAG_EMBEDDING_CACHE_DIR", "EMBEDDING_CACHE_DIR"),
    )
    embedding_threads: Optional[int] = Field(
        default=None,
        validation_alias=AliasChoices("RAG_EMBEDDING_THREADS", "EMBEDDING_THREADS"),
    )
    chroma_path: Path = Field(
        default=Path("rag/.chroma"),
        validation_alias=AliasChoices("RAG_CHROMA_PATH", "CHROMA_PATH"),
    )
    collection_name: str = Field(
        default="boardgame_knowledge",
        validation_alias=AliasChoices("RAG_COLLECTION_NAME", "CHROMA_COLLECTION_NAME"),
    )
    chunk_max_chars: int = Field(default=900, validation_alias="RAG_CHUNK_MAX_CHARS")
    chunk_overlap_chars: int = Field(default=120, validation_alias="RAG_CHUNK_OVERLAP_CHARS")
    embedding_batch_size: int = Field(default=64, validation_alias="RAG_EMBEDDING_BATCH_SIZE")
    default_top_k: int = Field(default=5, validation_alias="RAG_DEFAULT_TOP_K")
    lexical_source_paths: List[Path] = Field(
        default_factory=lambda: [Path("knowledge/boardgame_kb.jsonl")],
        validation_alias=AliasChoices("RAG_LEXICAL_SOURCE_PATHS", "RAG_LEXICAL_SOURCE_PATH"),
    )
    dense_candidate_multiplier: int = Field(default=4, validation_alias="RAG_DENSE_CANDIDATE_MULTIPLIER")
    lexical_candidate_multiplier: int = Field(default=6, validation_alias="RAG_LEXICAL_CANDIDATE_MULTIPLIER")
    hybrid_dense_weight: float = Field(default=0.65, validation_alias="RAG_HYBRID_DENSE_WEIGHT")
    hybrid_lexical_weight: float = Field(default=0.35, validation_alias="RAG_HYBRID_LEXICAL_WEIGHT")
    rrf_k: int = Field(default=60, validation_alias="RAG_RRF_K")
    recommendation_group_max_chunks: int = Field(default=2, validation_alias="RAG_RECOMMENDATION_GROUP_MAX_CHUNKS")
    referee_group_max_chunks: int = Field(default=3, validation_alias="RAG_REFEREE_GROUP_MAX_CHUNKS")


settings = Settings()

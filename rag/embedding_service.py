from __future__ import annotations

import warnings
from functools import lru_cache
from typing import Iterable, List

warnings.filterwarnings(
    "ignore",
    message=r"urllib3 v2 only supports OpenSSL 1\.1\.1\+.*",
)

from fastembed import TextEmbedding

from rag.config import Settings, settings


@lru_cache(maxsize=4)
def _load_text_embedding_model(
    provider: str,
    model_name: str,
    cache_dir: str,
    threads: int,
) -> TextEmbedding:
    normalized_provider = provider.strip().lower()
    if normalized_provider != "fastembed":
        raise ValueError("Only the 'fastembed' embedding provider is currently supported")

    init_kwargs = {"model_name": model_name}
    if cache_dir:
        init_kwargs["cache_dir"] = cache_dir
    if threads > 0:
        init_kwargs["threads"] = threads
    return TextEmbedding(**init_kwargs)


class EmbeddingService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.settings.embedding_cache_dir.mkdir(parents=True, exist_ok=True)
        self.model = _load_text_embedding_model(
            provider=settings.embedding_provider,
            model_name=settings.embedding_model,
            cache_dir=str(settings.embedding_cache_dir),
            threads=settings.embedding_threads or 0,
        )

    def embed_documents(self, texts: Iterable[str]) -> List[List[float]]:
        return self._embed(texts, input_type="passage")

    def embed_queries(self, texts: Iterable[str]) -> List[List[float]]:
        return self._embed(texts, input_type="query")

    def _embed(self, texts: Iterable[str], input_type: str) -> List[List[float]]:
        text_list = [text.strip() for text in texts if text and text.strip()]
        if not text_list:
            return []

        if input_type == "query":
            raw_vectors = list(self.model.query_embed(text_list))
        else:
            raw_vectors = list(
                self.model.passage_embed(
                    text_list,
                    batch_size=max(1, self.settings.embedding_batch_size),
                )
            )

        return [vector.tolist() for vector in raw_vectors]


@lru_cache(maxsize=1)
def get_embedding_service() -> EmbeddingService:
    return EmbeddingService(settings)

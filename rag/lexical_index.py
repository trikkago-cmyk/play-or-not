from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from rag.chunking import chunk_document
from rag.config import Settings, settings
from rag.ingest import load_documents
from rag.models import KnowledgeChunk


ASCII_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9_+\-./:#]*", re.IGNORECASE)
CJK_BLOCK_RE = re.compile(r"[\u4e00-\u9fff]+")


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "")
    normalized = normalized.replace("\u3000", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip().lower()


def tokenize_text(text: str) -> List[str]:
    normalized = normalize_text(text)
    if not normalized:
        return []

    tokens: List[str] = []
    tokens.extend(match.group(0) for match in ASCII_TOKEN_RE.finditer(normalized))

    for block in CJK_BLOCK_RE.findall(normalized):
        if not block:
            continue
        tokens.append(block)
        if len(block) == 1:
            continue
        for ngram_size in (2, 3):
            if len(block) < ngram_size:
                continue
            for index in range(len(block) - ngram_size + 1):
                tokens.append(block[index:index + ngram_size])

    return [token for token in tokens if token]


def _extract_search_surface(chunk: KnowledgeChunk) -> str:
    metadata = chunk.metadata or {}
    metadata_fields = [
        "title_cn",
        "title_en",
        "aliases_text",
        "tags_text",
        "common_questions_text",
        "display_tags_text",
        "recommendation_tags_text",
        "player_tags_text",
        "duration_tags_text",
        "complexity_tags_text",
        "occasion_tags_text",
        "interaction_tags_text",
        "mechanic_tags_text",
        "mood_tags_text",
        "theme_tags_text",
        "search_terms_text",
        "best_player_count_text",
    ]
    metadata_text = [str(metadata[field]) for field in metadata_fields if metadata.get(field)]
    retrieval_text = chunk.retrieval_text or ""
    return "\n".join(
        part for part in [
            retrieval_text,
            chunk.title,
            chunk.section_title or "",
            chunk.text,
            *metadata_text,
        ] if part
    )


@dataclass(frozen=True)
class LexicalDocument:
    chunk: KnowledgeChunk
    search_text: str
    normalized_text: str
    tokens: Tuple[str, ...]
    term_freq: Counter
    length: int


@dataclass(frozen=True)
class LexicalHit:
    chunk: KnowledgeChunk
    score: float
    rank: int


def _match_scalar(actual: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        if len(expected) != 1:
            return False
        operator, operand = next(iter(expected.items()))
        if operator == "$eq":
            return actual == operand
        if operator == "$ne":
            return actual != operand
        if operator == "$in" and isinstance(operand, list):
            return actual in operand
        if operator == "$nin" and isinstance(operand, list):
            return actual not in operand
        if operator == "$gte":
            return actual is not None and actual >= operand
        if operator == "$lte":
            return actual is not None and actual <= operand
        if operator == "$gt":
            return actual is not None and actual > operand
        if operator == "$lt":
            return actual is not None and actual < operand
        if operator == "$contains":
            return operand is not None and normalize_text(str(operand)) in normalize_text(str(actual))
        return False

    return actual == expected


def matches_metadata_filter(metadata: Dict[str, Any], where: Optional[Dict[str, Any]]) -> bool:
    if not where:
        return True

    if not isinstance(where, dict):
        return False

    if "$and" in where:
        clauses = where["$and"]
        return isinstance(clauses, list) and all(matches_metadata_filter(metadata, clause) for clause in clauses)

    if "$or" in where:
        clauses = where["$or"]
        return isinstance(clauses, list) and any(matches_metadata_filter(metadata, clause) for clause in clauses)

    if len(where) > 1:
        return all(matches_metadata_filter(metadata, {key: value}) for key, value in where.items())

    key, expected = next(iter(where.items()))
    actual = metadata.get(key)
    return _match_scalar(actual, expected)


def matches_document_filter(search_text: str, where_document: Optional[Dict[str, Any]]) -> bool:
    if not where_document:
        return True

    if not isinstance(where_document, dict):
        return False

    if "$and" in where_document:
        clauses = where_document["$and"]
        return isinstance(clauses, list) and all(matches_document_filter(search_text, clause) for clause in clauses)

    if "$or" in where_document:
        clauses = where_document["$or"]
        return isinstance(clauses, list) and any(matches_document_filter(search_text, clause) for clause in clauses)

    if len(where_document) > 1:
        return all(matches_document_filter(search_text, {key: value}) for key, value in where_document.items())

    operator, operand = next(iter(where_document.items()))
    normalized = normalize_text(search_text)

    if operator == "$contains":
        return normalize_text(str(operand)) in normalized
    if operator == "$not_contains":
        return normalize_text(str(operand)) not in normalized

    return False


class LexicalIndex:
    def __init__(self, documents: List[LexicalDocument], doc_freq: Counter, avg_doc_length: float):
        self.documents = documents
        self.doc_freq = doc_freq
        self.avg_doc_length = avg_doc_length or 1.0
        self.corpus_size = len(documents)

    def _idf(self, token: str) -> float:
        df = self.doc_freq.get(token, 0)
        return math.log(1 + ((self.corpus_size - df + 0.5) / (df + 0.5)))

    def search(
        self,
        query: str,
        top_k: int,
        where: Optional[Dict[str, Any]] = None,
        where_document: Optional[Dict[str, Any]] = None,
    ) -> List[LexicalHit]:
        query_tokens = tokenize_text(query)
        if not query_tokens:
            return []

        query_terms = Counter(query_tokens)
        k1 = 1.5
        b = 0.75
        scored_hits: List[Tuple[float, KnowledgeChunk]] = []

        for document in self.documents:
            metadata = document.chunk.metadata or {}
            if not matches_metadata_filter(metadata, where):
                continue
            if not matches_document_filter(document.search_text, where_document):
                continue

            score = 0.0
            for token in query_terms.keys():
                term_frequency = document.term_freq.get(token, 0)
                if term_frequency <= 0:
                    continue
                idf = self._idf(token)
                numerator = term_frequency * (k1 + 1)
                denominator = term_frequency + k1 * (1 - b + b * (document.length / self.avg_doc_length))
                score += idf * (numerator / denominator)

            if score > 0:
                scored_hits.append((score, document.chunk))

        scored_hits.sort(key=lambda item: item[0], reverse=True)
        return [
            LexicalHit(chunk=chunk, score=score, rank=index)
            for index, (score, chunk) in enumerate(scored_hits[:top_k], start=1)
        ]


def _resolve_lexical_source_paths(target_settings: Settings) -> List[Path]:
    configured_paths = target_settings.lexical_source_paths or [Path("knowledge/boardgame_kb.jsonl")]
    existing_paths = [Path(path) for path in configured_paths if Path(path).exists()]
    return existing_paths


@lru_cache(maxsize=4)
def _build_cached_index(
    cache_key: Tuple[Tuple[str, int], ...],
    chunk_max_chars: int,
    chunk_overlap_chars: int,
) -> LexicalIndex:
    documents: List[LexicalDocument] = []
    doc_freq: Counter = Counter()
    total_doc_length = 0

    for source_path, _mtime in cache_key:
        for document in load_documents(source_path):
            chunks = chunk_document(
                document,
                max_chars=chunk_max_chars,
                overlap_chars=chunk_overlap_chars,
            )
            for chunk in chunks:
                search_text = _extract_search_surface(chunk)
                tokens = tuple(tokenize_text(search_text))
                term_freq = Counter(tokens)
                length = max(1, sum(term_freq.values()))
                total_doc_length += length
                doc_freq.update(term_freq.keys())
                documents.append(
                    LexicalDocument(
                        chunk=chunk,
                        search_text=search_text,
                        normalized_text=normalize_text(search_text),
                        tokens=tokens,
                        term_freq=term_freq,
                        length=length,
                    )
                )

    avg_doc_length = (total_doc_length / len(documents)) if documents else 1.0
    return LexicalIndex(documents=documents, doc_freq=doc_freq, avg_doc_length=avg_doc_length)


def get_lexical_index(target_settings: Settings = settings) -> Optional[LexicalIndex]:
    source_paths = _resolve_lexical_source_paths(target_settings)
    if not source_paths:
        return None

    cache_key = tuple(
        (str(path.resolve()), int(path.stat().st_mtime_ns))
        for path in source_paths
    )
    return _build_cached_index(
        cache_key=cache_key,
        chunk_max_chars=target_settings.chunk_max_chars,
        chunk_overlap_chars=target_settings.chunk_overlap_chars,
    )

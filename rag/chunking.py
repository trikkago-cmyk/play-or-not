from __future__ import annotations

import re
from typing import List, Optional

from rag.models import DocumentSection, KnowledgeChunk, KnowledgeDocument


def _normalize_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.strip())


def _unique_non_empty(values: List[str]) -> List[str]:
    seen = set()
    normalized_values: List[str] = []
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        normalized_values.append(cleaned)
    return normalized_values


def _format_metadata_list(raw_value: object, limit: int = 10) -> str:
    if raw_value is None:
        return ""

    raw_text = str(raw_value).strip()
    if not raw_text:
        return ""

    parts = _unique_non_empty([part.strip() for part in re.split(r"\s*\|\s*", raw_text) if part.strip()])
    if not parts:
        return ""
    return " | ".join(parts[:limit])


def _build_context_header(
    document: KnowledgeDocument,
    section: Optional[DocumentSection],
    chunk_index: int,
    chunk_count: int,
) -> str:
    metadata = document.metadata or {}
    section_metadata = section.metadata if section else {}

    aliases = _format_metadata_list(metadata.get("aliases_text"), limit=6)
    tags = _format_metadata_list(
        metadata.get("recommendation_tags_text")
        or metadata.get("search_terms_text")
        or metadata.get("tags_text"),
        limit=12,
    )
    common_questions = _format_metadata_list(metadata.get("common_questions_text"), limit=6)

    lines: List[str] = []
    title_cn = str(metadata.get("title_cn") or document.title).strip()
    title_en = str(metadata.get("title_en") or "").strip()
    mode = str(metadata.get("mode") or "").strip()
    section_title = section.title.strip() if section and section.title else ""
    section_type = str(section_metadata.get("section_type") or "").strip()

    if title_cn:
        lines.append(f"游戏：{title_cn}")
    if title_en and title_en.lower() != title_cn.lower():
        lines.append(f"英文名：{title_en}")
    if aliases:
        lines.append(f"别名：{aliases}")
    if mode:
        lines.append(f"模式：{mode}")
    if section_title:
        lines.append(f"章节：{section_title}")
    if section_type:
        lines.append(f"章节类型：{section_type}")

    min_players = metadata.get("min_players")
    max_players = metadata.get("max_players")
    if min_players is not None and max_players is not None:
        lines.append(f"人数：{min_players}-{max_players}人")

    playtime_min = metadata.get("playtime_min")
    if playtime_min is not None:
        lines.append(f"时长：约{playtime_min}分钟")

    if tags:
        lines.append(f"标签：{tags}")
    if common_questions and mode == "referee":
        lines.append(f"常见问法：{common_questions}")
    if chunk_count > 1:
        lines.append(f"分块：{chunk_index}/{chunk_count}")

    return "\n".join(lines)


def _split_text(text: str, max_chars: int, overlap_chars: int) -> List[str]:
    normalized = _normalize_text(text)
    if not normalized:
        return []
    if len(normalized) <= max_chars:
        return [normalized]

    paragraphs = [part.strip() for part in normalized.split("\n\n") if part.strip()]
    chunks: List[str] = []
    current = ""

    for paragraph in paragraphs:
        candidate = paragraph if not current else f"{current}\n\n{paragraph}"
        if len(candidate) <= max_chars:
            current = candidate
            continue

        if current:
            chunks.append(current)

        if len(paragraph) <= max_chars:
            current = paragraph
            continue

        start = 0
        while start < len(paragraph):
            end = min(start + max_chars, len(paragraph))
            piece = paragraph[start:end].strip()
            if piece:
                chunks.append(piece)
            if end >= len(paragraph):
                current = ""
                break
            start = max(end - overlap_chars, start + 1)
        else:
            current = ""

    if current:
        chunks.append(current)

    return chunks


def _build_chunk(
    document: KnowledgeDocument,
    text: str,
    chunk_index: int,
    chunk_count: int,
    section: Optional[DocumentSection] = None,
) -> KnowledgeChunk:
    section_prefix = section.section_id if section and section.section_id else f"section-{chunk_index}"
    metadata = dict(document.metadata)
    if section:
        metadata.update(section.metadata)
        metadata["section_title"] = section.title
    metadata["chunk_index"] = chunk_index
    metadata["chunk_count"] = chunk_count

    context_header = _build_context_header(
        document=document,
        section=section,
        chunk_index=chunk_index,
        chunk_count=chunk_count,
    )
    retrieval_text = text
    if context_header:
        retrieval_text = f"{context_header}\n\n正文：\n{text}"

    return KnowledgeChunk(
        chunk_id=f"{document.document_id}:{section_prefix}:{chunk_index}",
        document_id=document.document_id,
        title=document.title,
        text=text,
        retrieval_text=retrieval_text,
        source=document.source,
        section_id=section.section_id if section else None,
        section_title=section.title if section else None,
        metadata=metadata,
    )


def chunk_document(
    document: KnowledgeDocument,
    max_chars: int,
    overlap_chars: int,
) -> List[KnowledgeChunk]:
    chunks: List[KnowledgeChunk] = []

    if document.sections:
        for section in document.sections:
            section_chunks = _split_text(section.text, max_chars=max_chars, overlap_chars=overlap_chars)
            total_chunks = len(section_chunks)
            for chunk_index, chunk_text in enumerate(section_chunks, start=1):
                chunks.append(_build_chunk(document, chunk_text, chunk_index, total_chunks, section))
        return chunks

    if document.text:
        text_chunks = _split_text(document.text, max_chars=max_chars, overlap_chars=overlap_chars)
        total_chunks = len(text_chunks)
        for chunk_index, chunk_text in enumerate(text_chunks, start=1):
            chunks.append(_build_chunk(document, chunk_text, chunk_index, total_chunks))

    return chunks

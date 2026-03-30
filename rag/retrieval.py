from __future__ import annotations

import re
import time
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from rag.chroma_store import ChromaVectorStore
from rag.config import settings
from rag.embedding_service import get_embedding_service
from rag.lexical_index import get_lexical_index, normalize_text, tokenize_text
from rag.models import QueryResponse, RetrievalHit


REFEREE_SECTION_HINTS: List[Tuple[str, List[str], List[str]]] = [
    ("获胜目标", ["怎么赢", "获胜", "胜利", "胜负", "谁赢", "翻盘", "多少分", "结束条件", "直接获胜", "判胜负"], ["获胜目标", "胜利条件", "得分结算", "胜负判定"]),
    ("游戏流程", ["流程", "回合", "步骤", "怎么进行", "先后顺序"], ["游戏流程", "回合步骤"]),
    ("常见问题", ["能不能", "可以", "是否", "怎么判", "怎么处理", "怎么办", "会怎样", "质疑", "例外", "必须", "能否"], ["常见问题", "FAQ", "特殊判定"]),
    ("新手技巧", ["技巧", "建议", "注意事项"], ["新手技巧"]),
]

RECOMMENDATION_REWRITE_RULES: List[Tuple[re.Pattern, List[str]]] = [
    (re.compile(r"情侣|约会|两个人约会|双人约会"), ["双人核心", "情侣约会", "双人", "两人", "2人"]),
    (re.compile(r"双人|两人|2人"), ["双人核心", "双人", "两人", "2人"]),
    (re.compile(r"破冰|聊天|说话|表达"), ["团建破冰", "猜词联想", "破冰", "聊天", "表达"]),
    (re.compile(r"聚会|人多|热闹|团建"), ["朋友聚会", "欢乐搞笑", "聚会", "人多", "热闹"]),
    (re.compile(r"合作|协作|不想.*互相伤害|友好"), ["合作共赢", "低冲突友好", "合作", "友好"]),
    (re.compile(r"家庭|合家欢|全家"), ["家庭同乐", "合家欢", "家庭"]),
    (re.compile(r"安静|对弈|低冲突|不互坑|别太伤感情|伤感情"), ["安静对弈", "低冲突友好", "低冲突", "安静", "对弈"]),
    (re.compile(r"拼图|布局"), ["拼图布局"]),
    (re.compile(r"同时进行|同时开玩|同步行动|边写边玩|写写画画"), ["纸笔规划", "同时进行", "多人同玩", "写写画画"]),
    (re.compile(r"阵营|身份|推理"), ["阵营推理", "身份", "推理"]),
    (re.compile(r"嘴炮|谈判"), ["嘴炮谈判", "嘴炮", "谈判"]),
    (re.compile(r"策略|烧脑|重策|博弈"), ["烧脑策略", "重策略", "策略", "烧脑", "博弈"]),
    (re.compile(r"轻松|休闲|简单|上手快|新手"), ["轻松休闲", "新手友好", "轻松", "休闲", "上手快"]),
    (re.compile(r"搞笑|欢乐"), ["欢乐搞笑", "欢乐", "搞笑"]),
    (re.compile(r"半小时|30分钟"), ["30分钟内", "半小时内"]),
    (re.compile(r"一小时|60分钟"), ["60分钟内", "一小时内"]),
]

NEGATED_RECOMMENDATION_RULES: List[Tuple[re.Pattern, List[str]]] = [
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:阵营|身份|推理|狼人|阿瓦隆|钟楼)"),
        ["阵营推理", "身份", "推理", "嘴炮"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:嘴炮|谈判)"),
        ["嘴炮谈判", "嘴炮", "谈判"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:对抗|博弈|互坑|互相伤害|伤感情)"),
        ["高互动对抗", "对抗", "博弈", "互坑"],
    ),
    (
        re.compile(r"(?:完全)?(?:不想|不要|别|不考虑)(?:玩)?[^，。；,.;!?？！]{0,10}(?:烧脑|重策|硬核)"),
        ["烧脑策略", "重策略", "烧脑", "重策"],
    ),
    (
        re.compile(r"别[^，。；,.;!?？！]{0,8}(?:伤感情|太伤|互坑|互相伤害)"),
        ["高互动对抗", "对抗", "博弈", "互坑"],
    ),
]


def _normalize_where(where: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not where:
        return None
    if not isinstance(where, dict):
        return None

    if "$and" in where or "$or" in where:
        normalized: Dict[str, Any] = {}
        for operator, clauses in where.items():
            if operator not in {"$and", "$or"} or not isinstance(clauses, list):
                normalized[operator] = clauses
                continue
            normalized_clauses = []
            for clause in clauses:
                if isinstance(clause, dict):
                    nested = _normalize_where(clause)
                    if nested:
                        normalized_clauses.append(nested)
            normalized[operator] = normalized_clauses
        return normalized

    if len(where) <= 1:
        return where

    return {"$and": [{key: value} for key, value in where.items()]}


def _extract_filter_value(where: Optional[Dict[str, Any]], field: str) -> Optional[str]:
    if not where or not isinstance(where, dict):
        return None

    if field in where and isinstance(where[field], str):
        return where[field]

    for operator in ("$and", "$or"):
        clauses = where.get(operator)
        if not isinstance(clauses, list):
            continue
        for clause in clauses:
            result = _extract_filter_value(clause, field)
            if result:
                return result

    return None


def _normalize_query_text(query: str) -> str:
    compact = re.sub(r"\s+", " ", query or "").strip()
    return compact


def _extract_negative_recommendation_terms(query: str) -> List[str]:
    negative_terms: List[str] = []
    for pattern, aliases in NEGATED_RECOMMENDATION_RULES:
        if pattern.search(query):
            negative_terms.extend(aliases)

    unique_negative_terms = []
    seen = set()
    for item in negative_terms:
        normalized_item = item.strip()
        if not normalized_item or normalized_item in seen:
            continue
        seen.add(normalized_item)
        unique_negative_terms.append(normalized_item)
    return unique_negative_terms


def _strip_negative_recommendation_clauses(query: str) -> str:
    stripped = query
    for pattern, _aliases in NEGATED_RECOMMENDATION_RULES:
        stripped = pattern.sub(" ", stripped)
    stripped = re.sub(r"[，,。；;!?？！]\s*[，,。；;!?？！]+", " ", stripped)
    stripped = re.sub(r"\s+", " ", stripped)
    stripped = re.sub(r"^[，,。；;!?？！\s]+|[，,。；;!?？！\s]+$", "", stripped)
    return stripped.strip()


def _build_recommendation_surface(metadata: Dict[str, Any]) -> str:
    recommendation_surface = " ".join(
        str(metadata.get(field, ""))
        for field in (
            "recommendation_tags_text",
            "search_terms_text",
            "occasion_tags_text",
            "mechanic_tags_text",
            "mood_tags_text",
            "theme_tags_text",
            "interaction_tags_text",
        )
        if metadata.get(field)
    )
    return normalize_text(recommendation_surface)


def _rewrite_query(
    query: str,
    mode: Optional[str],
    active_game_id: Optional[str],
) -> Tuple[str, List[str], Optional[str], List[str]]:
    normalized_query = _normalize_query_text(query)
    expansions: List[str] = []
    section_target: Optional[str] = None
    negative_terms: List[str] = []
    base_query = normalized_query

    if mode == "referee":
        for section_name, triggers, aliases in REFEREE_SECTION_HINTS:
            if any(trigger in normalized_query for trigger in triggers):
                section_target = section_name
                expansions.extend(aliases)
                break
    elif mode == "recommendation":
        negative_terms = _extract_negative_recommendation_terms(normalized_query)
        stripped_query = _strip_negative_recommendation_clauses(normalized_query)
        if stripped_query:
            base_query = stripped_query
        for pattern, aliases in RECOMMENDATION_REWRITE_RULES:
            if pattern.search(normalized_query):
                expansions.extend(alias for alias in aliases if alias not in negative_terms)

    if active_game_id and mode == "referee":
        expansions.append(active_game_id)

    unique_expansions = []
    seen = set()
    for item in expansions:
        normalized_item = item.strip()
        if not normalized_item or normalized_item in seen or normalized_item in base_query:
            continue
        seen.add(normalized_item)
        unique_expansions.append(normalized_item)

    if not unique_expansions:
        return base_query, [], section_target, negative_terms

    rewritten = f"{base_query}\n\n检索扩展：{' / '.join(unique_expansions)}"
    return rewritten, unique_expansions, section_target, negative_terms


def _normalize_dense_score(hit: RetrievalHit) -> float:
    if hit.dense_score is not None:
        return max(0.0, hit.dense_score)
    return max(0.0, hit.score)


def _normalize_signal(value: float, maximum: float) -> float:
    if maximum <= 0:
        return 0.0
    return max(0.0, min(1.0, value / maximum))


def _section_bonus(section_title: Optional[str], section_target: Optional[str]) -> float:
    if not section_title or not section_target:
        return 0.0
    normalized_section = normalize_text(section_title)
    normalized_target = normalize_text(section_target)
    return 0.18 if normalized_target in normalized_section else 0.0


def _section_type_bonus(hit: RetrievalHit, mode: Optional[str], section_target: Optional[str]) -> float:
    metadata = hit.metadata or {}
    section_type = normalize_text(str(metadata.get("section_type", "")))
    normalized_section = normalize_text(hit.section_title or "")
    normalized_target = normalize_text(section_target or "")

    bonus = 0.0
    if mode == "referee":
        if section_type == "knowledge_base":
            bonus += 0.14
        elif section_type == "rules":
            bonus += 0.06
        elif section_type == "faq":
            bonus += 0.03
        elif section_type == "summary":
            bonus -= 0.10
        elif section_type == "tips":
            bonus -= 0.06
    elif mode == "recommendation":
        if section_type == "recommendation":
            bonus += 0.04
        elif section_type == "summary":
            bonus -= 0.02

    if normalized_target:
        if normalized_target in normalized_section:
            bonus += 0.08
        elif mode == "referee" and section_type == "knowledge_base":
            # 裁判问答里，知识库长文常常比摘要/技巧更接近完整答案。
            bonus += 0.04

    return bonus


def _metadata_bonus(hit: RetrievalHit, query_terms: List[str], mode: Optional[str], active_game_id: Optional[str]) -> float:
    metadata = hit.metadata or {}
    bonus = 0.0

    if active_game_id and metadata.get("game_id") == active_game_id:
        bonus += 0.12

    title_surface = " ".join(
        str(metadata.get(field, ""))
        for field in ("title_cn", "title_en", "aliases_text")
        if metadata.get(field)
    )
    normalized_title_surface = normalize_text(title_surface)
    if normalized_title_surface:
        exact_hits = sum(1 for term in query_terms if len(term) >= 2 and term in normalized_title_surface)
        bonus += min(0.18, exact_hits * 0.06)

    if mode == "recommendation":
        normalized_recommendation_surface = _build_recommendation_surface(metadata)
        if normalized_recommendation_surface:
            matched_terms = sum(1 for term in query_terms if len(term) >= 2 and term in normalized_recommendation_surface)
            bonus += min(0.24, matched_terms * 0.03)

    return bonus


def _negative_metadata_penalty(hit: RetrievalHit, negative_terms: List[str], mode: Optional[str]) -> float:
    if mode != "recommendation" or not negative_terms:
        return 0.0

    metadata = hit.metadata or {}
    normalized_recommendation_surface = _build_recommendation_surface(metadata)
    if not normalized_recommendation_surface:
        return 0.0

    matched_negative_terms = sum(
        1
        for term in negative_terms
        if len(term) >= 2 and normalize_text(term) in normalized_recommendation_surface
    )
    if matched_negative_terms <= 0:
        return 0.0

    return min(0.42, matched_negative_terms * 0.10)


def _safe_positive_int(value: Any) -> Optional[int]:
    try:
        parsed = int(str(value))
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _get_hit_game_id(hit: RetrievalHit) -> Optional[str]:
    metadata = hit.metadata or {}
    game_id = metadata.get("game_id")
    if isinstance(game_id, str) and game_id.strip():
        return game_id.strip()
    if hit.document_id.strip():
        return hit.document_id.strip()
    return None


def _get_hit_chunk_index(hit: RetrievalHit) -> Optional[int]:
    metadata = hit.metadata or {}
    chunk_index = _safe_positive_int(metadata.get("chunk_index"))
    if chunk_index is not None:
        return chunk_index

    match = re.search(r":(\d+)$", hit.chunk_id or "")
    if not match:
        return None
    return _safe_positive_int(match.group(1))


def _get_raw_hit_text(hit: RetrievalHit) -> str:
    metadata = hit.metadata or {}
    raw_text = metadata.get("raw_text")
    if isinstance(raw_text, str) and raw_text.strip():
        return raw_text.strip()
    return hit.text.strip()


def _merge_group_text(group_hits: List[RetrievalHit], mode: Optional[str], max_group_chunks: int) -> str:
    if not group_hits:
        return ""

    if mode == "referee":
        ordered_hits = sorted(
            group_hits,
            key=lambda item: (
                _get_hit_chunk_index(item) if _get_hit_chunk_index(item) is not None else 10**9,
                -(item.rerank_score or item.score),
            ),
        )
    else:
        ordered_hits = sorted(group_hits, key=lambda item: item.rerank_score or item.score, reverse=True)

    blocks: List[str] = []
    seen_texts = set()

    for hit in ordered_hits:
        text = _get_raw_hit_text(hit)
        normalized_text = normalize_text(text)
        if not text or normalized_text in seen_texts:
            continue
        seen_texts.add(normalized_text)

        section_title = hit.section_title or str((hit.metadata or {}).get("section_title") or "").strip()
        if mode == "recommendation" and section_title:
            blocks.append(f"[{section_title}]\n{text}")
        else:
            blocks.append(text)

        if len(blocks) >= max(1, max_group_chunks):
            break

    return "\n\n".join(blocks) if blocks else _get_raw_hit_text(group_hits[0])


def _aggregate_hits(hits: List[RetrievalHit], mode: Optional[str], top_k: int) -> List[RetrievalHit]:
    if mode not in {"recommendation", "referee"}:
        return hits[:top_k]
    if not hits:
        return []

    grouped: Dict[str, List[RetrievalHit]] = defaultdict(list)
    for hit in hits:
        if mode == "recommendation":
            group_key = _get_hit_game_id(hit) or hit.chunk_id
        else:
            section_key = hit.section_id or str((hit.metadata or {}).get("section_id") or "").strip() or hit.chunk_id
            group_key = f"{hit.document_id}:{section_key}"
        grouped[group_key].append(hit)

    aggregated_hits: List[RetrievalHit] = []
    max_group_chunks = (
        settings.recommendation_group_max_chunks
        if mode == "recommendation"
        else settings.referee_group_max_chunks
    )

    for group_key, group_hits in grouped.items():
        ranked_group = sorted(group_hits, key=lambda item: item.rerank_score or item.score, reverse=True)
        leader = ranked_group[0]
        distinct_sections = {
            normalize_text(item.section_title or str((item.metadata or {}).get("section_title") or ""))
            for item in group_hits
            if item.section_title or (item.metadata or {}).get("section_title")
        }
        retrieval_sources = {source for item in group_hits for source in item.retrieval_sources}

        coverage_bonus = 0.0
        if mode == "recommendation":
            coverage_bonus += min(0.08, max(0, len(group_hits) - 1) * 0.03)
            coverage_bonus += min(0.04, max(0, len(distinct_sections) - 1) * 0.02)
        else:
            coverage_bonus += min(0.10, max(0, len(group_hits) - 1) * 0.04)
            coverage_bonus += min(0.03, max(0, len(retrieval_sources) - 1) * 0.03)

        merged_text = _merge_group_text(group_hits, mode=mode, max_group_chunks=max_group_chunks)
        merged_score = (leader.rerank_score or leader.score) + coverage_bonus
        metadata = dict(leader.metadata or {})
        metadata["aggregation_key"] = group_key
        metadata["aggregation_scope"] = "game" if mode == "recommendation" else "section"
        metadata["aggregated_chunk_count"] = len(group_hits)
        metadata["aggregated_section_count"] = max(1, len(distinct_sections))

        aggregated_hits.append(
            leader.model_copy(
                update={
                    "text": merged_text,
                    "score": merged_score,
                    "rerank_score": merged_score,
                    "metadata": metadata,
                }
            )
        )

    aggregated_hits.sort(key=lambda item: item.rerank_score or item.score, reverse=True)
    return aggregated_hits[:top_k]


def _hybrid_fuse_hits(
    dense_hits: List[RetrievalHit],
    lexical_hits: List[Tuple[RetrievalHit, float]],
    top_k: int,
    mode: Optional[str],
    active_game_id: Optional[str],
    rewritten_query: str,
    section_target: Optional[str],
    negative_terms: List[str],
) -> List[RetrievalHit]:
    merged: Dict[str, Dict[str, Any]] = defaultdict(dict)

    for dense_rank, hit in enumerate(dense_hits, start=1):
        entry = merged[hit.chunk_id]
        entry["hit"] = hit
        entry["dense_rank"] = dense_rank
        entry["dense_score"] = _normalize_dense_score(hit)
        entry.setdefault("sources", set()).add("vector")

    for lexical_rank, (hit, lexical_score) in enumerate(lexical_hits, start=1):
        entry = merged[hit.chunk_id]
        entry.setdefault("hit", hit)
        entry["lexical_rank"] = lexical_rank
        entry["lexical_score"] = lexical_score
        entry.setdefault("sources", set()).add("lexical")

    query_terms = tokenize_text(rewritten_query)
    max_dense_score = max((float(entry.get("dense_score", 0.0)) for entry in merged.values()), default=0.0)
    max_lexical_score = max((float(entry.get("lexical_score", 0.0)) for entry in merged.values()), default=0.0)
    fused_hits: List[RetrievalHit] = []

    for entry in merged.values():
        hit: RetrievalHit = entry["hit"]
        dense_rank = entry.get("dense_rank")
        lexical_rank = entry.get("lexical_rank")
        dense_score = float(entry.get("dense_score", 0.0))
        lexical_score = float(entry.get("lexical_score", 0.0))
        sources = sorted(entry.get("sources", set()))
        dense_signal = _normalize_signal(dense_score, max_dense_score)
        lexical_signal = _normalize_signal(lexical_score, max_lexical_score)

        rrf_score = 0.0
        if dense_rank:
            rrf_score += settings.hybrid_dense_weight / (settings.rrf_k + dense_rank)
        if lexical_rank:
            rrf_score += settings.hybrid_lexical_weight / (settings.rrf_k + lexical_rank)
        rank_signal = rrf_score * float(settings.rrf_k)

        rerank_score = (
            rank_signal +
            (dense_signal * 0.30) +
            (lexical_signal * 0.18) +
            _section_bonus(hit.section_title, section_target) +
            _section_type_bonus(hit, mode, section_target) +
            _metadata_bonus(hit, query_terms, mode, active_game_id) -
            _negative_metadata_penalty(hit, negative_terms, mode)
        )

        fused_hits.append(
            hit.model_copy(
                update={
                    "score": rerank_score,
                    "dense_score": dense_score or hit.dense_score,
                    "lexical_score": lexical_score,
                    "rerank_score": rerank_score,
                    "distance": hit.distance if dense_rank else max(0.0, 1 - lexical_score),
                    "retrieval_sources": sources,
                }
            )
        )

    fused_hits.sort(key=lambda item: item.rerank_score or item.score, reverse=True)
    return fused_hits[:max(top_k, top_k * 3)]


def query_documents(
    query: str,
    top_k: Optional[int] = None,
    mode: Optional[str] = None,
    active_game_id: Optional[str] = None,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None,
    debug: bool = False,
) -> QueryResponse:
    if not query.strip():
        raise ValueError("query must not be empty")

    started_at = time.perf_counter()
    bootstrap_started_at = time.perf_counter()
    embedder = get_embedding_service()
    store = ChromaVectorStore(settings)
    normalized_where = _normalize_where(where)
    derived_mode = mode or _extract_filter_value(normalized_where, "mode")
    derived_active_game_id = active_game_id or _extract_filter_value(normalized_where, "game_id")
    bootstrap_ms = (time.perf_counter() - bootstrap_started_at) * 1000

    rewrite_started_at = time.perf_counter()
    rewritten_query, rewrite_expansions, section_target, negative_terms = _rewrite_query(
        query=query,
        mode=derived_mode,
        active_game_id=derived_active_game_id,
    )
    rewrite_ms = (time.perf_counter() - rewrite_started_at) * 1000

    embedding_started_at = time.perf_counter()
    query_embedding = embedder.embed_queries([rewritten_query])[0]
    embedding_ms = (time.perf_counter() - embedding_started_at) * 1000

    effective_top_k = top_k or settings.default_top_k
    dense_candidate_top_k = max(effective_top_k, effective_top_k * max(1, settings.dense_candidate_multiplier))

    dense_started_at = time.perf_counter()
    dense_hits = store.query(
        query_embedding=query_embedding,
        top_k=dense_candidate_top_k,
        where=normalized_where,
        where_document=where_document,
    )
    dense_ms = (time.perf_counter() - dense_started_at) * 1000

    lexical_hits_raw: List[Tuple[RetrievalHit, float]] = []
    lexical_started_at = time.perf_counter()
    lexical_index = get_lexical_index(settings)
    if lexical_index is not None:
        lexical_candidate_top_k = max(effective_top_k, effective_top_k * max(1, settings.lexical_candidate_multiplier))
        for lexical_hit in lexical_index.search(
            query=rewritten_query,
            top_k=lexical_candidate_top_k,
            where=normalized_where,
            where_document=where_document,
        ):
            lexical_hits_raw.append(
                (
                    RetrievalHit(
                        chunk_id=lexical_hit.chunk.chunk_id,
                        document_id=lexical_hit.chunk.document_id,
                        title=lexical_hit.chunk.title,
                        text=lexical_hit.chunk.text,
                        source=lexical_hit.chunk.source,
                        distance=max(0.0, 1 - lexical_hit.score),
                        score=lexical_hit.score,
                        section_id=lexical_hit.chunk.section_id,
                        section_title=lexical_hit.chunk.section_title,
                        lexical_score=lexical_hit.score,
                        rerank_score=lexical_hit.score,
                        retrieval_sources=["lexical"],
                        metadata=lexical_hit.chunk.metadata,
                    ),
                    lexical_hit.score,
                )
            )
    lexical_ms = (time.perf_counter() - lexical_started_at) * 1000

    fuse_started_at = time.perf_counter()
    fused_hits = _hybrid_fuse_hits(
        dense_hits=dense_hits,
        lexical_hits=lexical_hits_raw,
        top_k=effective_top_k,
        mode=derived_mode,
        active_game_id=derived_active_game_id,
        rewritten_query=rewritten_query,
        section_target=section_target,
        negative_terms=negative_terms,
    )
    fuse_ms = (time.perf_counter() - fuse_started_at) * 1000

    aggregate_started_at = time.perf_counter()
    hits = _aggregate_hits(fused_hits, mode=derived_mode, top_k=effective_top_k)
    aggregate_ms = (time.perf_counter() - aggregate_started_at) * 1000
    total_ms = (time.perf_counter() - started_at) * 1000

    diagnostics = {
        "mode": derived_mode,
        "active_game_id": derived_active_game_id,
        "rewrite_expansions": rewrite_expansions,
        "negative_terms": negative_terms,
        "section_target": section_target,
        "dense_candidates": len(dense_hits),
        "lexical_candidates": len(lexical_hits_raw),
        "hybrid_enabled": lexical_index is not None,
        "pre_aggregation_hits": len(fused_hits),
        "post_aggregation_hits": len(hits),
        "aggregation_scope": "game" if derived_mode == "recommendation" else "section" if derived_mode == "referee" else None,
        "latency_ms": round(total_ms, 2),
        "latency_breakdown_ms": {
            "bootstrap": round(bootstrap_ms, 2),
            "rewrite": round(rewrite_ms, 2),
            "embedding": round(embedding_ms, 2),
            "dense": round(dense_ms, 2),
            "lexical": round(lexical_ms, 2),
            "fusion": round(fuse_ms, 2),
            "aggregation": round(aggregate_ms, 2),
        },
    }
    if not debug:
        diagnostics = {
            key: value
            for key, value in diagnostics.items()
            if key in {"mode", "active_game_id", "hybrid_enabled", "post_aggregation_hits", "latency_ms"}
        }

    return QueryResponse(
        query=query,
        top_k=effective_top_k,
        hits=hits,
        rewritten_query=rewritten_query if rewritten_query != query else None,
        strategy="hybrid_rrf_rerank_aggregated" if lexical_index is not None else "dense_only_aggregated",
        diagnostics=diagnostics,
    )

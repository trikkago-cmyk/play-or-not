#!/usr/bin/env python3
"""
RAG retrieval evaluator for boardgame referee queries.

Supports three adapter types:
1) http: call an HTTP endpoint and parse returned chunks.
2) function: call a local Python function.
3) precomputed: read retrieval results from JSONL.
"""

from __future__ import annotations

import argparse
import importlib
import json
import math
import re
import statistics
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class ExpectedSignals:
    must_game_ids: List[str] = field(default_factory=list)
    any_game_ids: List[str] = field(default_factory=list)
    must_not_game_ids: List[str] = field(default_factory=list)
    keyword_groups: List[List[str]] = field(default_factory=list)
    min_recall_at_k: Optional[float] = None
    min_distinct_game_ids_at_k: Optional[int] = None
    top_1_section_any_of: List[str] = field(default_factory=list)


@dataclass
class EvalCase:
    case_id: str
    query: str
    mode: Optional[str]
    active_game_id: Optional[str]
    category: str
    expected: ExpectedSignals
    notes: Optional[str] = None


@dataclass
class ScoredCase:
    case_id: str
    category: str
    recall_at_k: float
    precision_at_k: float
    mrr_at_k: float
    ndcg_at_k: float
    hit_at_k: bool
    strict_hit_at_k: bool
    passed: bool
    matched_targets: int
    total_targets: int
    game_matches: List[str]
    any_game_matches: List[str]
    forbidden_game_matches: List[str]
    matched_keyword_groups: int
    distinct_game_ids_at_k: int
    top_1_section_passed: bool
    top_chunks_preview: List[Dict[str, Any]]


def _as_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        stripped = value.strip()
        return stripped if stripped else None
    return str(value)


def _pick_first(mapping: Dict[str, Any], keys: List[str]) -> Optional[str]:
    for key in keys:
        if key in mapping:
            value = _as_str(mapping.get(key))
            if value:
                return value
    return None


def normalize_chunk(raw: Dict[str, Any]) -> Dict[str, Any]:
    metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
    game_id = _pick_first(raw, ["game_id", "gameId"]) or _pick_first(metadata, ["game_id", "gameId", "id"])
    section = _pick_first(raw, ["section", "section_title", "section_id", "chunk_type", "source_type"]) or _pick_first(
        metadata, ["section", "section_title", "section_id", "chunk_type", "source_type"]
    )
    text = (
        _pick_first(raw, ["text", "content", "document", "page_content", "chunk"])
        or _pick_first(metadata, ["text", "content"])
        or ""
    )
    chunk_id = _pick_first(raw, ["id", "chunk_id"]) or _pick_first(metadata, ["id", "chunk_id"])
    distance = raw.get("distance", raw.get("score"))

    return {
        "id": chunk_id,
        "game_id": game_id,
        "section": section,
        "text": text,
        "distance": distance,
        "raw": raw,
    }


def normalize_match_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "").lower()
    normalized = re.sub(r"[*_`>#\[\]\(\)\"“”‘’|]", " ", normalized)
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def section_matches_any(expected_sections: List[str], actual_section: Optional[str]) -> bool:
    if not expected_sections:
        return True
    normalized_actual = normalize_match_text(actual_section or "")
    if not normalized_actual:
        return False
    return any(normalize_match_text(section) in normalized_actual for section in expected_sections)


def chunk_target_matches(case: EvalCase, chunk: Dict[str, Any]) -> Dict[str, Any]:
    chunk_game_id = _as_str(chunk.get("game_id"))
    normalized_text = normalize_match_text(chunk.get("text", ""))

    must_game_matches = {f"must_game:{game_id}" for game_id in case.expected.must_game_ids if chunk_game_id == game_id}
    any_game_match = {"any_game"} if case.expected.any_game_ids and chunk_game_id in case.expected.any_game_ids else set()
    keyword_matches = {
        f"keyword_group:{index}"
        for index, group in enumerate(case.expected.keyword_groups)
        if any(normalize_match_text(keyword) in normalized_text for keyword in group)
    }

    return {
        "target_keys": must_game_matches | any_game_match | keyword_matches,
        "keyword_match_indexes": {int(key.split(":", 1)[1]) for key in keyword_matches},
    }


def _from_chroma_shape(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    documents = payload.get("documents")
    if not isinstance(documents, list) or not documents:
        return []
    docs = documents[0] if isinstance(documents[0], list) else documents

    metadatas = payload.get("metadatas", [])
    ids = payload.get("ids", [])
    distances = payload.get("distances", [])

    meta_list = metadatas[0] if metadatas and isinstance(metadatas[0], list) else metadatas
    id_list = ids[0] if ids and isinstance(ids[0], list) else ids
    dist_list = distances[0] if distances and isinstance(distances[0], list) else distances

    chunks: List[Dict[str, Any]] = []
    for i, doc in enumerate(docs):
        chunks.append(
            {
                "id": id_list[i] if i < len(id_list) else None,
                "text": doc,
                "metadata": meta_list[i] if i < len(meta_list) and isinstance(meta_list[i], dict) else {},
                "distance": dist_list[i] if i < len(dist_list) else None,
            }
        )
    return chunks


def extract_chunks(payload: Any) -> List[Dict[str, Any]]:
    if hasattr(payload, "model_dump") and callable(payload.model_dump):
        return extract_chunks(payload.model_dump())

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]

    if not isinstance(payload, dict):
        return []

    for key in ("chunks", "hits", "results", "items", "documents"):
        value = payload.get(key)
        if isinstance(value, list):
            if key == "documents":
                # Could be Chroma shape or direct list[str].
                chunks = _from_chroma_shape(payload)
                if chunks:
                    return chunks
                return [{"text": text, "metadata": {}} for text in value if isinstance(text, str)]
            return [item for item in value if isinstance(item, dict)]

    if all(k in payload for k in ("ids", "documents", "metadatas")):
        chunks = _from_chroma_shape(payload)
        if chunks:
            return chunks

    if isinstance(payload.get("data"), dict):
        return extract_chunks(payload["data"])
    if isinstance(payload.get("result"), dict):
        return extract_chunks(payload["result"])

    return []


def render_template(value: Any, case: EvalCase, top_k: int) -> Any:
    substitutions = {
        "$query": case.query,
        "$top_k": top_k,
        "$mode": case.mode,
        "$active_game_id": case.active_game_id,
        "$case_id": case.case_id,
        "$category": case.category,
    }

    if isinstance(value, str):
        return substitutions.get(value, value)

    if isinstance(value, list):
        rendered_list = [render_template(item, case, top_k) for item in value]
        filtered_list = [item for item in rendered_list if item is not None]
        return filtered_list or None

    if isinstance(value, dict):
        rendered_dict = {}
        for key, nested_value in value.items():
            rendered_value = render_template(nested_value, case, top_k)
            if rendered_value is not None:
                rendered_dict[key] = rendered_value
        if len(rendered_dict) == 1:
            if "$and" in rendered_dict and isinstance(rendered_dict["$and"], list) and len(rendered_dict["$and"]) == 1:
                first_clause = rendered_dict["$and"][0]
                return first_clause if isinstance(first_clause, dict) else rendered_dict
            if "$or" in rendered_dict and isinstance(rendered_dict["$or"], list) and len(rendered_dict["$or"]) == 1:
                first_clause = rendered_dict["$or"][0]
                return first_clause if isinstance(first_clause, dict) else rendered_dict
        return rendered_dict or None

    return value


def validate_case(raw: Dict[str, Any]) -> EvalCase:
    case_id = _as_str(raw.get("id"))
    query = _as_str(raw.get("query"))
    if not case_id:
        raise ValueError("case is missing `id`")
    if not query:
        raise ValueError(f"case `{case_id}` is missing `query`")

    expected_raw = raw.get("expected")
    if not isinstance(expected_raw, dict):
        raise ValueError(f"case `{case_id}` is missing `expected` object")

    must_game_ids = expected_raw.get("must_game_ids", [])
    if not isinstance(must_game_ids, list):
        raise ValueError(f"case `{case_id}` expected.must_game_ids must be a list")
    must_game_ids = [str(item) for item in must_game_ids if str(item).strip()]

    any_game_ids = expected_raw.get("any_game_ids", [])
    if not isinstance(any_game_ids, list):
        raise ValueError(f"case `{case_id}` expected.any_game_ids must be a list")
    any_game_ids = [str(item) for item in any_game_ids if str(item).strip()]

    must_not_game_ids = expected_raw.get("must_not_game_ids", [])
    if not isinstance(must_not_game_ids, list):
        raise ValueError(f"case `{case_id}` expected.must_not_game_ids must be a list")
    must_not_game_ids = [str(item) for item in must_not_game_ids if str(item).strip()]

    keyword_groups = expected_raw.get("keyword_groups", [])
    if not isinstance(keyword_groups, list):
        raise ValueError(f"case `{case_id}` expected.keyword_groups must be a list")

    normalized_groups: List[List[str]] = []
    for group in keyword_groups:
        if isinstance(group, list):
            entries = [str(item).strip() for item in group if str(item).strip()]
            if entries:
                normalized_groups.append(entries)
        elif isinstance(group, str) and group.strip():
            normalized_groups.append([group.strip()])
        else:
            raise ValueError(f"case `{case_id}` has invalid keyword group: {group!r}")

    min_recall_at_k = expected_raw.get("min_recall_at_k")
    if min_recall_at_k is not None:
        min_recall_at_k = float(min_recall_at_k)
        if min_recall_at_k < 0 or min_recall_at_k > 1:
            raise ValueError(f"case `{case_id}` expected.min_recall_at_k must be between 0 and 1")

    min_distinct_game_ids_at_k = expected_raw.get("min_distinct_game_ids_at_k")
    if min_distinct_game_ids_at_k is not None:
        min_distinct_game_ids_at_k = int(min_distinct_game_ids_at_k)
        if min_distinct_game_ids_at_k < 0:
            raise ValueError(f"case `{case_id}` expected.min_distinct_game_ids_at_k must be >= 0")

    top_1_section_any_of = expected_raw.get("top_1_section_any_of", [])
    if not isinstance(top_1_section_any_of, list):
        raise ValueError(f"case `{case_id}` expected.top_1_section_any_of must be a list")
    top_1_section_any_of = [str(item).strip() for item in top_1_section_any_of if str(item).strip()]

    category = _as_str(raw.get("category")) or "uncategorized"
    mode = _as_str(raw.get("mode"))
    active_game_id = _as_str(raw.get("active_game_id"))
    notes = _as_str(raw.get("notes"))

    return EvalCase(
        case_id=case_id,
        query=query,
        mode=mode,
        active_game_id=active_game_id,
        category=category,
        expected=ExpectedSignals(
            must_game_ids=must_game_ids,
            any_game_ids=any_game_ids,
            must_not_game_ids=must_not_game_ids,
            keyword_groups=normalized_groups,
            min_recall_at_k=min_recall_at_k,
            min_distinct_game_ids_at_k=min_distinct_game_ids_at_k,
            top_1_section_any_of=top_1_section_any_of,
        ),
        notes=notes,
    )


def load_cases(path: Path) -> List[EvalCase]:
    cases: List[EvalCase] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            try:
                raw = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL at line {line_number}: {exc}") from exc
            cases.append(validate_case(raw))
    if not cases:
        raise ValueError("No eval cases found in dataset")
    return cases


class Retriever:
    def retrieve(self, case: EvalCase, top_k: int) -> List[Dict[str, Any]]:
        raise NotImplementedError


class HttpRetriever(Retriever):
    def __init__(self, cfg: Dict[str, Any]):
        self.endpoint = _as_str(cfg.get("endpoint"))
        if not self.endpoint:
            raise ValueError("http adapter requires `endpoint`")

        self.method = (_as_str(cfg.get("method")) or "POST").upper()
        self.timeout_sec = float(cfg.get("timeout_sec", 20))
        self.headers = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
        self.payload_template = cfg.get("payload_template") if isinstance(cfg.get("payload_template"), dict) else {}
        self.field_mapping = cfg.get("field_mapping") if isinstance(cfg.get("field_mapping"), dict) else {}

        self.query_field = _as_str(self.field_mapping.get("query")) or "query"
        self.top_k_field = _as_str(self.field_mapping.get("top_k")) or "top_k"
        self.mode_field = _as_str(self.field_mapping.get("mode")) or "mode"
        self.active_game_field = _as_str(self.field_mapping.get("active_game_id")) or "active_game_id"

    def retrieve(self, case: EvalCase, top_k: int) -> List[Dict[str, Any]]:
        payload = render_template(self.payload_template, case, top_k)
        if not isinstance(payload, dict):
            payload = {}

        if self.query_field not in payload:
            payload[self.query_field] = case.query
        if self.top_k_field not in payload:
            payload[self.top_k_field] = top_k
        if case.mode and self.mode_field not in payload:
            payload[self.mode_field] = case.mode
        if case.active_game_id and self.active_game_field not in payload:
            payload[self.active_game_field] = case.active_game_id

        if self.method == "GET":
            query = urllib.parse.urlencode({k: v for k, v in payload.items() if v is not None})
            url = f"{self.endpoint}?{query}" if query else self.endpoint
            req = urllib.request.Request(url=url, method="GET")
            for key, value in self.headers.items():
                req.add_header(str(key), str(value))
        else:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(url=self.endpoint, data=body, method="POST")
            req.add_header("Content-Type", "application/json")
            for key, value in self.headers.items():
                req.add_header(str(key), str(value))

        try:
            with urllib.request.urlopen(req, timeout=self.timeout_sec) as response:
                raw_payload = response.read().decode("utf-8")
        except urllib.error.URLError as exc:
            raise RuntimeError(f"HTTP retrieval failed for case `{case.case_id}`: {exc}") from exc

        try:
            parsed = json.loads(raw_payload)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"HTTP response is not valid JSON for case `{case.case_id}`") from exc

        return [normalize_chunk(chunk) for chunk in extract_chunks(parsed)]


class FunctionRetriever(Retriever):
    def __init__(self, cfg: Dict[str, Any]):
        module_name = _as_str(cfg.get("module"))
        function_name = _as_str(cfg.get("function"))
        if not module_name or not function_name:
            raise ValueError("function adapter requires `module` and `function`")

        module = importlib.import_module(module_name)
        func = getattr(module, function_name, None)
        if func is None or not callable(func):
            raise ValueError(f"Cannot load callable `{function_name}` from module `{module_name}`")
        self.func = func

        self.kwargs_template = cfg.get("kwargs_template") if isinstance(cfg.get("kwargs_template"), dict) else {}
        self.field_mapping = cfg.get("field_mapping") if isinstance(cfg.get("field_mapping"), dict) else {}
        self.query_field = _as_str(self.field_mapping.get("query")) or "query"
        self.top_k_field = _as_str(self.field_mapping.get("top_k")) or "top_k"
        self.mode_field = _as_str(self.field_mapping.get("mode")) or "mode"
        self.active_game_field = _as_str(self.field_mapping.get("active_game_id")) or "active_game_id"

    def retrieve(self, case: EvalCase, top_k: int) -> List[Dict[str, Any]]:
        kwargs = render_template(self.kwargs_template, case, top_k)
        if not isinstance(kwargs, dict):
            kwargs = {}

        if self.query_field not in kwargs:
            kwargs[self.query_field] = case.query
        if self.top_k_field not in kwargs:
            kwargs[self.top_k_field] = top_k
        if case.mode and self.mode_field not in kwargs:
            kwargs[self.mode_field] = case.mode
        if case.active_game_id and self.active_game_field not in kwargs:
            kwargs[self.active_game_field] = case.active_game_id

        payload = self.func(**kwargs)
        return [normalize_chunk(chunk) for chunk in extract_chunks(payload)]


class PrecomputedRetriever(Retriever):
    def __init__(self, cfg: Dict[str, Any]):
        results_path = _as_str(cfg.get("results_path"))
        if not results_path:
            raise ValueError("precomputed adapter requires `results_path`")

        self.id_field = _as_str(cfg.get("id_field")) or "id"
        self.chunks_field = _as_str(cfg.get("chunks_field")) or "chunks"
        self.results_by_id: Dict[str, List[Dict[str, Any]]] = {}

        path = Path(results_path)
        with path.open("r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                raw = json.loads(stripped)
                sample_id = _as_str(raw.get(self.id_field))
                if not sample_id:
                    raise ValueError(f"precomputed line {line_number} missing `{self.id_field}`")
                chunks_raw = raw.get(self.chunks_field)
                if not isinstance(chunks_raw, list):
                    raise ValueError(f"precomputed line {line_number} `{self.chunks_field}` is not a list")
                self.results_by_id[sample_id] = [normalize_chunk(item) for item in chunks_raw if isinstance(item, dict)]

    def retrieve(self, case: EvalCase, top_k: int) -> List[Dict[str, Any]]:
        if case.case_id not in self.results_by_id:
            raise RuntimeError(
                f"precomputed adapter missing case `{case.case_id}`. "
                "Either add it to precomputed results or use http/function adapter."
            )
        return self.results_by_id[case.case_id][:top_k]


def build_retriever(config: Dict[str, Any]) -> Retriever:
    adapter = _as_str(config.get("adapter"))
    if not adapter:
        raise ValueError("config missing `adapter`")
    adapter = adapter.lower()

    if adapter == "http":
        return HttpRetriever(config.get("http", {}))
    if adapter == "function":
        return FunctionRetriever(config.get("function", {}))
    if adapter == "precomputed":
        return PrecomputedRetriever(config.get("precomputed", {}))

    raise ValueError(f"Unsupported adapter: {adapter}")


def score_case(case: EvalCase, chunks: List[Dict[str, Any]], top_k: int, default_threshold: float) -> ScoredCase:
    top_chunks = chunks[:top_k]
    retrieved_game_ids = {chunk["game_id"] for chunk in top_chunks if chunk.get("game_id")}
    distinct_game_ids_at_k = len(retrieved_game_ids)
    game_matches = sorted(set(case.expected.must_game_ids).intersection(retrieved_game_ids))
    game_match_count = len(game_matches)
    any_game_matches = sorted(set(case.expected.any_game_ids).intersection(retrieved_game_ids))
    any_game_match_count = 1 if any_game_matches else 0
    forbidden_game_matches = sorted(set(case.expected.must_not_game_ids).intersection(retrieved_game_ids))

    matched_keyword_indexes = set()
    for chunk in top_chunks:
        chunk_matches = chunk_target_matches(case, chunk)
        matched_keyword_indexes.update(chunk_matches["keyword_match_indexes"])
    keyword_group_matches = len(matched_keyword_indexes)

    total_targets = len(case.expected.must_game_ids) + len(case.expected.keyword_groups) + (
        1 if case.expected.any_game_ids else 0
    )
    matched_targets = game_match_count + keyword_group_matches + any_game_match_count

    recall = 1.0 if total_targets == 0 else matched_targets / float(total_targets)
    hit = matched_targets > 0
    strict_hit = matched_targets == total_targets

    relevant_positions: List[int] = []
    seen_target_keys = set()
    for index, chunk in enumerate(top_chunks, start=1):
        chunk_matches = chunk_target_matches(case, chunk)
        new_target_keys = chunk_matches["target_keys"] - seen_target_keys
        if new_target_keys:
            relevant_positions.append(index)
            seen_target_keys.update(new_target_keys)

    precision_at_k = len(relevant_positions) / float(top_k)
    mrr_at_k = 0.0 if not relevant_positions else 1.0 / float(relevant_positions[0])
    dcg = sum(1.0 / math.log2(position + 1) for position in relevant_positions)
    ideal_count = min(top_k, total_targets)
    idcg = sum(1.0 / math.log2(position + 1) for position in range(1, ideal_count + 1))
    ndcg_at_k = 0.0 if idcg == 0 else dcg / idcg

    threshold = case.expected.min_recall_at_k if case.expected.min_recall_at_k is not None else default_threshold
    diversity_pass = (
        case.expected.min_distinct_game_ids_at_k is None
        or distinct_game_ids_at_k >= case.expected.min_distinct_game_ids_at_k
    )
    top_1_section = _as_str(top_chunks[0].get("section")) if top_chunks else None
    top_1_section_passed = section_matches_any(case.expected.top_1_section_any_of, top_1_section)
    passed = recall >= threshold and diversity_pass and not forbidden_game_matches and top_1_section_passed

    preview = []
    for chunk in top_chunks[:3]:
        text = chunk.get("text", "")
        snippet = text[:140] + ("..." if len(text) > 140 else "")
        preview.append(
            {
                "id": chunk.get("id"),
                "game_id": chunk.get("game_id"),
                "section": chunk.get("section"),
                "snippet": snippet,
            }
        )

    return ScoredCase(
        case_id=case.case_id,
        category=case.category,
        recall_at_k=recall,
        precision_at_k=precision_at_k,
        mrr_at_k=mrr_at_k,
        ndcg_at_k=ndcg_at_k,
        hit_at_k=hit,
        strict_hit_at_k=strict_hit,
        passed=passed,
        matched_targets=matched_targets,
        total_targets=total_targets,
        game_matches=game_matches,
        any_game_matches=any_game_matches,
        forbidden_game_matches=forbidden_game_matches,
        matched_keyword_groups=keyword_group_matches,
        distinct_game_ids_at_k=distinct_game_ids_at_k,
        top_1_section_passed=top_1_section_passed,
        top_chunks_preview=preview,
    )


def summarize(scored_cases: List[ScoredCase]) -> Dict[str, Any]:
    recalls = [case.recall_at_k for case in scored_cases]
    precisions = [case.precision_at_k for case in scored_cases]
    mrr_values = [case.mrr_at_k for case in scored_cases]
    ndcg_values = [case.ndcg_at_k for case in scored_cases]
    hit_values = [1.0 if case.hit_at_k else 0.0 for case in scored_cases]
    strict_values = [1.0 if case.strict_hit_at_k else 0.0 for case in scored_cases]
    pass_values = [1.0 if case.passed else 0.0 for case in scored_cases]
    distinct_game_counts = [float(case.distinct_game_ids_at_k) for case in scored_cases]
    top_1_section_pass_values = [1.0 if case.top_1_section_passed else 0.0 for case in scored_cases]
    forbidden_game_hit_values = [1.0 if case.forbidden_game_matches else 0.0 for case in scored_cases]

    by_category: Dict[str, List[ScoredCase]] = {}
    for case in scored_cases:
        by_category.setdefault(case.category, []).append(case)

    category_summary = {}
    for category, items in sorted(by_category.items()):
        category_summary[category] = {
            "count": len(items),
            "hit_at_k": sum(1.0 if i.hit_at_k else 0.0 for i in items) / len(items),
            "strict_hit_at_k": sum(1.0 if i.strict_hit_at_k else 0.0 for i in items) / len(items),
            "recall_at_k": sum(i.recall_at_k for i in items) / len(items),
            "precision_at_k": sum(i.precision_at_k for i in items) / len(items),
            "mrr_at_k": sum(i.mrr_at_k for i in items) / len(items),
            "ndcg_at_k": sum(i.ndcg_at_k for i in items) / len(items),
            "distinct_game_ids_at_k": sum(float(i.distinct_game_ids_at_k) for i in items) / len(items),
            "top_1_section_pass_rate": sum(1.0 if i.top_1_section_passed else 0.0 for i in items) / len(items),
            "forbidden_game_hit_rate": sum(1.0 if i.forbidden_game_matches else 0.0 for i in items) / len(items),
            "pass_rate": sum(1.0 if i.passed else 0.0 for i in items) / len(items),
        }

    return {
        "count": len(scored_cases),
        "hit_at_k": sum(hit_values) / len(hit_values),
        "strict_hit_at_k": sum(strict_values) / len(strict_values),
        "recall_at_k_mean": sum(recalls) / len(recalls),
        "recall_at_k_median": statistics.median(recalls),
        "precision_at_k_mean": sum(precisions) / len(precisions),
        "mrr_at_k_mean": sum(mrr_values) / len(mrr_values),
        "ndcg_at_k_mean": sum(ndcg_values) / len(ndcg_values),
        "distinct_game_ids_at_k_mean": sum(distinct_game_counts) / len(distinct_game_counts),
        "top_1_section_pass_rate": sum(top_1_section_pass_values) / len(top_1_section_pass_values),
        "forbidden_game_hit_rate": sum(forbidden_game_hit_values) / len(forbidden_game_hit_values),
        "pass_rate": sum(pass_values) / len(pass_values),
        "by_category": category_summary,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate RAG retrieval quality on boardgame referee dataset")
    parser.add_argument("--dataset", required=True, help="JSONL eval dataset path")
    parser.add_argument("--config", required=True, help="JSON config path for retriever adapter")
    parser.add_argument("--top-k", type=int, default=5, help="Evaluate top-k retrieval")
    parser.add_argument(
        "--default-threshold",
        type=float,
        default=0.8,
        help="Default pass threshold for recall@k when case-level threshold is missing",
    )
    parser.add_argument("--report-json", help="Write detailed report JSON to this path")
    parser.add_argument("--verbose", action="store_true", help="Print per-case details")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dataset_path = Path(args.dataset)
    config_path = Path(args.config)

    if args.top_k <= 0:
        raise ValueError("--top-k must be >= 1")
    if args.default_threshold < 0 or args.default_threshold > 1:
        raise ValueError("--default-threshold must be between 0 and 1")

    with config_path.open("r", encoding="utf-8") as handle:
        config = json.load(handle)

    cases = load_cases(dataset_path)
    retriever = build_retriever(config)

    scored_cases: List[ScoredCase] = []
    for case in cases:
        chunks = retriever.retrieve(case, args.top_k)
        scored = score_case(case, chunks, args.top_k, args.default_threshold)
        scored_cases.append(scored)
        if args.verbose:
            print(
                f"[{scored.case_id}] category={scored.category} "
                f"recall@{args.top_k}={scored.recall_at_k:.3f} "
                f"precision@{args.top_k}={scored.precision_at_k:.3f} "
                f"mrr@{args.top_k}={scored.mrr_at_k:.3f} "
                f"ndcg@{args.top_k}={scored.ndcg_at_k:.3f} "
                f"hit={int(scored.hit_at_k)} strict_hit={int(scored.strict_hit_at_k)} pass={int(scored.passed)}"
            )

    summary = summarize(scored_cases)

    print("\n=== Retrieval Eval Summary ===")
    print(f"cases: {summary['count']}")
    print(f"hit@{args.top_k}: {summary['hit_at_k']:.3f}")
    print(f"strict_hit@{args.top_k}: {summary['strict_hit_at_k']:.3f}")
    print(f"recall@{args.top_k} (mean): {summary['recall_at_k_mean']:.3f}")
    print(f"recall@{args.top_k} (median): {summary['recall_at_k_median']:.3f}")
    print(f"precision@{args.top_k} (mean): {summary['precision_at_k_mean']:.3f}")
    print(f"mrr@{args.top_k} (mean): {summary['mrr_at_k_mean']:.3f}")
    print(f"ndcg@{args.top_k} (mean): {summary['ndcg_at_k_mean']:.3f}")
    print(f"distinct_game_ids@{args.top_k} (mean): {summary['distinct_game_ids_at_k_mean']:.3f}")
    print(f"top_1_section_pass_rate: {summary['top_1_section_pass_rate']:.3f}")
    print(f"forbidden_game_hit_rate: {summary['forbidden_game_hit_rate']:.3f}")
    print(f"pass_rate: {summary['pass_rate']:.3f}")

    print("\n=== By Category ===")
    for category, info in summary["by_category"].items():
        print(
            f"{category}: count={info['count']} hit@{args.top_k}={info['hit_at_k']:.3f} "
            f"strict_hit@{args.top_k}={info['strict_hit_at_k']:.3f} "
            f"recall@{args.top_k}={info['recall_at_k']:.3f} "
            f"precision@{args.top_k}={info['precision_at_k']:.3f} "
            f"mrr@{args.top_k}={info['mrr_at_k']:.3f} "
            f"ndcg@{args.top_k}={info['ndcg_at_k']:.3f} "
            f"distinct_game_ids@{args.top_k}={info['distinct_game_ids_at_k']:.3f} "
            f"top_1_section_pass_rate={info['top_1_section_pass_rate']:.3f} "
            f"forbidden_game_hit_rate={info['forbidden_game_hit_rate']:.3f} "
            f"pass_rate={info['pass_rate']:.3f}"
        )

    if args.report_json:
        report_payload = {
            "top_k": args.top_k,
            "default_threshold": args.default_threshold,
            "summary": summary,
            "cases": [
                {
                    "id": case.case_id,
                    "category": case.category,
                    "recall_at_k": case.recall_at_k,
                    "precision_at_k": case.precision_at_k,
                    "mrr_at_k": case.mrr_at_k,
                    "ndcg_at_k": case.ndcg_at_k,
                    "hit_at_k": case.hit_at_k,
                    "strict_hit_at_k": case.strict_hit_at_k,
                    "passed": case.passed,
                    "matched_targets": case.matched_targets,
                    "total_targets": case.total_targets,
                    "game_matches": case.game_matches,
                    "any_game_matches": case.any_game_matches,
                    "forbidden_game_matches": case.forbidden_game_matches,
                    "matched_keyword_groups": case.matched_keyword_groups,
                    "distinct_game_ids_at_k": case.distinct_game_ids_at_k,
                    "top_1_section_passed": case.top_1_section_passed,
                    "top_chunks_preview": case.top_chunks_preview,
                }
                for case in scored_cases
            ],
        }
        report_path = Path(args.report_json)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with report_path.open("w", encoding="utf-8") as handle:
            json.dump(report_payload, handle, ensure_ascii=False, indent=2)
        print(f"\nDetailed report written to: {report_path}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise

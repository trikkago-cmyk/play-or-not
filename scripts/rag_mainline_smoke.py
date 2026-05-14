#!/usr/bin/env python3
"""Smoke-check the mainline Python RAG path.

This script intentionally checks for the real hybrid RAG strategy instead of the
serverless `local_sections_lexical` fallback. It can run against the local Python
function path or a running HTTP service.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List


RECOMMENDATION_PAYLOAD = {
    "query": "九人局家庭聚会，来个轻松点的",
    "top_k": 3,
    "mode": "recommendation",
    "where": {
        "$and": [
            {"mode": "recommendation"},
            {"min_players": {"$lte": 9}},
            {"max_players": {"$gte": 9}},
            {"playtime_min": {"$lte": 30}},
            {"complexity": {"$lte": 2.4}},
            {"age_rating": {"$lte": 8}},
        ]
    },
    "debug": True,
}

DERIVED_FILTER_RECOMMENDATION_PAYLOAD = {
    "query": "九人局家庭聚会，30分钟内，规则简单，8岁孩子也能玩",
    "top_k": 3,
    "mode": "recommendation",
    "where": {"mode": "recommendation"},
    "debug": True,
}

REFEREE_PAYLOAD = {
    "query": "阿瓦隆 刺客什么时候刺杀",
    "top_k": 3,
    "mode": "referee",
    "active_game_id": "avalon",
    "where": {
        "$and": [
            {"mode": "referee"},
            {"game_id": "avalon"},
        ]
    },
    "debug": True,
}


def _post_json(base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/query",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail}") from error


def _query_function(payload: Dict[str, Any]) -> Dict[str, Any]:
    from rag.retrieval import query_documents

    response = query_documents(
        query=payload["query"],
        top_k=payload["top_k"],
        mode=payload.get("mode"),
        active_game_id=payload.get("active_game_id"),
        where=payload.get("where"),
        where_document=payload.get("where_document"),
        debug=bool(payload.get("debug")),
    )
    return response.model_dump()


def _query(mode: str, base_url: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    if mode == "function":
        return _query_function(payload)
    return _post_json(base_url, payload)


def _metadata(hit: Dict[str, Any]) -> Dict[str, Any]:
    metadata = hit.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_mainline_response(name: str, response: Dict[str, Any]) -> None:
    strategy = response.get("strategy")
    diagnostics = response.get("diagnostics") or {}
    _require(strategy != "local_sections_lexical", f"{name}: still using local fallback strategy")
    _require(
        strategy in {"hybrid_rrf_rerank_aggregated", "dense_only_aggregated"},
        f"{name}: unexpected strategy {strategy!r}",
    )
    _require(bool(diagnostics.get("hybrid_enabled")), f"{name}: hybrid retrieval is not enabled")
    _require(response.get("hits"), f"{name}: no hits returned")


def _assert_recommendation(response: Dict[str, Any]) -> None:
    _assert_mainline_response("recommendation", response)
    hits: List[Dict[str, Any]] = response["hits"]
    for hit in hits:
        metadata = _metadata(hit)
        _require(metadata.get("mode") == "recommendation", f"recommendation: wrong mode in {metadata}")
        _require(metadata.get("min_players") <= 9, f"recommendation: min_players filter failed in {metadata}")
        _require(metadata.get("max_players") >= 9, f"recommendation: max_players filter failed in {metadata}")
        _require(metadata.get("playtime_min") <= 30, f"recommendation: playtime filter failed in {metadata}")
        _require(metadata.get("complexity") <= 2.4, f"recommendation: complexity filter failed in {metadata}")
        _require(metadata.get("age_rating") <= 8, f"recommendation: age filter failed in {metadata}")


def _assert_derived_filter_recommendation(response: Dict[str, Any]) -> None:
    _assert_mainline_response("derived-filter recommendation", response)
    hits: List[Dict[str, Any]] = response["hits"]
    for hit in hits:
        metadata = _metadata(hit)
        _require(metadata.get("mode") == "recommendation", f"derived-filter: wrong mode in {metadata}")
        _require(metadata.get("min_players") <= 9, f"derived-filter: min_players filter failed in {metadata}")
        _require(metadata.get("max_players") >= 9, f"derived-filter: max_players filter failed in {metadata}")
        _require(metadata.get("playtime_min") <= 30, f"derived-filter: playtime filter failed in {metadata}")
        _require(metadata.get("complexity") <= 2.4, f"derived-filter: complexity filter failed in {metadata}")
        _require(metadata.get("age_rating") <= 8, f"derived-filter: age filter failed in {metadata}")


def _assert_referee(response: Dict[str, Any]) -> None:
    _assert_mainline_response("referee", response)
    hits: List[Dict[str, Any]] = response["hits"]
    for hit in hits:
        metadata = _metadata(hit)
        _require(metadata.get("mode") == "referee", f"referee: wrong mode in {metadata}")
        _require(metadata.get("game_id") == "avalon", f"referee: active_game_id filter failed in {metadata}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-check the Python RAG mainline.")
    parser.add_argument("--mode", choices=["function", "http"], default="function")
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    args = parser.parse_args()

    recommendation_response = _query(args.mode, args.base_url, RECOMMENDATION_PAYLOAD)
    derived_filter_recommendation_response = _query(args.mode, args.base_url, DERIVED_FILTER_RECOMMENDATION_PAYLOAD)
    referee_response = _query(args.mode, args.base_url, REFEREE_PAYLOAD)

    _assert_recommendation(recommendation_response)
    _assert_derived_filter_recommendation(derived_filter_recommendation_response)
    _assert_referee(referee_response)

    print(json.dumps({
        "status": "ok",
        "mode": args.mode,
        "recommendation_strategy": recommendation_response.get("strategy"),
        "recommendation_hits": [
            _metadata(hit).get("game_id") for hit in recommendation_response["hits"]
        ],
        "derived_filter_recommendation_hits": [
            _metadata(hit).get("game_id") for hit in derived_filter_recommendation_response["hits"]
        ],
        "referee_strategy": referee_response.get("strategy"),
        "referee_hits": [
            {
                "game_id": _metadata(hit).get("game_id"),
                "section": hit.get("section_title"),
            }
            for hit in referee_response["hits"]
        ],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"RAG mainline smoke failed: {exc}", file=sys.stderr)
        raise

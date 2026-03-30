from __future__ import annotations

from typing import Any, Dict, Optional


def _append_where_clause(effective_where: Dict[str, Any], clause: Dict[str, Any]) -> Dict[str, Any]:
    if not clause:
        return effective_where

    if not effective_where:
        return dict(clause)

    existing_and = effective_where.get("$and")
    if isinstance(existing_and, list):
        existing_and.append(clause)
        return effective_where

    return {"$and": [effective_where, clause]}


def query_python_rag(
    query: str,
    top_k: int = 5,
    mode: Optional[str] = None,
    active_game_id: Optional[str] = None,
    where: Optional[Dict[str, Any]] = None,
    where_document: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    from rag.retrieval import query_documents

    effective_where = dict(where or {})
    if mode:
        effective_where = _append_where_clause(effective_where, {"mode": mode})
    if active_game_id:
        effective_where = _append_where_clause(effective_where, {"game_id": active_game_id})

    response = query_documents(
        query=query,
        top_k=top_k,
        where=effective_where or None,
        where_document=where_document,
    )
    return response.model_dump()

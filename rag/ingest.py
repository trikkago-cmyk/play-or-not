from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List

from rag.chunking import chunk_document
from rag.chroma_store import ChromaVectorStore
from rag.config import settings
from rag.embedding_service import get_embedding_service
from rag.models import IngestResponse, KnowledgeDocument


def _load_json(path: Path) -> List[KnowledgeDocument]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        payload = [payload]
    return [KnowledgeDocument.model_validate(item) for item in payload]


def _load_jsonl(path: Path) -> List[KnowledgeDocument]:
    documents: List[KnowledgeDocument] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        documents.append(KnowledgeDocument.model_validate(json.loads(line)))
    return documents


def load_documents(input_path: str) -> List[KnowledgeDocument]:
    path = Path(input_path)
    if not path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    suffix = path.suffix.lower()
    if suffix == ".jsonl":
        return _load_jsonl(path)
    if suffix == ".json":
        return _load_json(path)
    raise ValueError("Only .json and .jsonl are supported for ingest")


def ingest_documents(input_path: str, reset_collection: bool = False) -> IngestResponse:
    documents = load_documents(input_path)
    store = ChromaVectorStore(settings)
    embedder = get_embedding_service()

    if reset_collection:
        store.reset_collection()

    chunks = []
    for document in documents:
        chunks.extend(
            chunk_document(
                document,
                max_chars=settings.chunk_max_chars,
                overlap_chars=settings.chunk_overlap_chars,
            )
        )

    embeddings: List[List[float]] = []
    batch_size = max(1, settings.embedding_batch_size)
    texts = [chunk.retrieval_text or chunk.text for chunk in chunks]
    for start in range(0, len(texts), batch_size):
        embeddings.extend(embedder.embed_documents(texts[start:start + batch_size]))

    chunks_written = store.upsert_chunks(chunks, embeddings)
    return IngestResponse(
        input_path=input_path,
        documents_loaded=len(documents),
        chunks_written=chunks_written,
        collection_name=settings.collection_name,
        reset_collection=reset_collection,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest JSON/JSONL documents into Chroma.")
    parser.add_argument("--input", required=True, help="Path to a JSON or JSONL knowledge file.")
    parser.add_argument(
        "--reset-collection",
        action="store_true",
        help="Delete and recreate the collection before writing chunks.",
    )
    args = parser.parse_args()

    response = ingest_documents(args.input, reset_collection=args.reset_collection)
    print(response.model_dump_json(indent=2))


if __name__ == "__main__":
    main()

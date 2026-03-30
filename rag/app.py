from __future__ import annotations

from fastapi import FastAPI, HTTPException

from rag.config import settings
from rag.ingest import ingest_documents
from rag.models import HealthResponse, IngestRequest, IngestResponse, QueryRequest, QueryResponse
from rag.retrieval import query_documents


app = FastAPI(title=settings.app_name)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        collection_name=settings.collection_name,
        chroma_path=str(settings.chroma_path),
        embedding_provider=settings.embedding_provider,
        embedding_model=settings.embedding_model,
        embedding_cache_dir=str(settings.embedding_cache_dir),
    )


@app.post("/ingest", response_model=IngestResponse)
def ingest(request: IngestRequest) -> IngestResponse:
    try:
        return ingest_documents(
            input_path=request.input_path,
            reset_collection=request.reset_collection,
        )
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.post("/query", response_model=QueryResponse)
def query(request: QueryRequest) -> QueryResponse:
    try:
        return query_documents(
            query=request.query,
            top_k=request.top_k,
            mode=request.mode,
            active_game_id=request.active_game_id,
            where=request.where,
            where_document=request.where_document,
            debug=request.debug,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

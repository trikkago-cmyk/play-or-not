from __future__ import annotations

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response

from tts_service.config import settings
from tts_service.models import HealthResponse, SynthesizeRequest
from tts_service.runtime_client import synthesize_with_cosyvoice


app = FastAPI(title=settings.app_name)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        provider="cosyvoice",
        mode=settings.cosyvoice_mode,
        runtime_url=settings.cosyvoice_runtime_url,
        prompt_wav_configured=bool(settings.cosyvoice_prompt_wav_path),
        prompt_text_configured=bool(settings.cosyvoice_prompt_text),
        speaker_id_configured=bool(settings.cosyvoice_speaker_id),
        sample_rate=settings.cosyvoice_sample_rate,
    )


@app.post("/synthesize")
def synthesize(request: SynthesizeRequest) -> Response:
    try:
        wav_bytes = synthesize_with_cosyvoice(
            text=request.text,
            instruction=request.instruction,
            voice_id=request.voice_id,
        )
    except (FileNotFoundError, ValueError) as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except requests.HTTPError as error:
        detail = error.response.text if error.response is not None else str(error)
        raise HTTPException(status_code=502, detail=detail) from error
    except requests.RequestException as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Cache-Control": "no-store",
            "X-TTS-Provider": "cosyvoice",
            "X-TTS-Mode": settings.cosyvoice_mode,
        },
    )

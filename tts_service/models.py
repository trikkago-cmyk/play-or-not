from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str
    app_name: str
    provider: str
    mode: str
    runtime_url: str
    prompt_wav_configured: bool = False
    prompt_text_configured: bool = False
    speaker_id_configured: bool = False
    sample_rate: int


class SynthesizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    instruction: Optional[str] = None
    speed: Optional[float] = None
    voice_id: Optional[str] = None
    emotion: Optional[str] = None

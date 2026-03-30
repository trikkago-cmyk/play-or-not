from __future__ import annotations

from pathlib import Path
from typing import Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    app_name: str = "boardgame-dm-tts"
    cosyvoice_runtime_url: str = Field(
        default="http://127.0.0.1:50000",
        validation_alias=AliasChoices("COSYVOICE_RUNTIME_URL", "TTS_SERVICE_RUNTIME_URL"),
    )
    cosyvoice_mode: str = Field(default="instruct2", validation_alias="COSYVOICE_MODE")
    cosyvoice_prompt_wav_path: Optional[Path] = Field(default=None, validation_alias="COSYVOICE_PROMPT_WAV_PATH")
    cosyvoice_prompt_text: Optional[str] = Field(default=None, validation_alias="COSYVOICE_PROMPT_TEXT")
    cosyvoice_instruction: str = Field(
        default="请用温柔、自然、亲切、像熟悉桌游的女生朋友一样的语气说话。",
        validation_alias="COSYVOICE_INSTRUCTION",
    )
    cosyvoice_speaker_id: Optional[str] = Field(default=None, validation_alias="COSYVOICE_SPK_ID")
    cosyvoice_sample_rate: int = Field(default=24000, validation_alias="COSYVOICE_SAMPLE_RATE")
    cosyvoice_timeout_seconds: float = Field(default=90.0, validation_alias="COSYVOICE_TIMEOUT_SECONDS")


settings = Settings()

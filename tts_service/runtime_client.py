from __future__ import annotations

import io
import wave
from pathlib import Path
from typing import Optional

import requests

from tts_service.config import settings


def synthesize_with_cosyvoice(
    *,
    text: str,
    instruction: Optional[str] = None,
    voice_id: Optional[str] = None,
) -> bytes:
    mode = settings.cosyvoice_mode.strip().lower()
    runtime_url = settings.cosyvoice_runtime_url.rstrip("/")

    if mode == "instruct2":
        prompt_path = _require_prompt_wav()
        files = {"prompt_wav": _build_file_tuple(prompt_path)}
        data = {
            "tts_text": text,
            "instruct_text": _normalize_instruct_text(instruction),
        }
        endpoint = "/inference_instruct2"
    elif mode == "zero_shot":
        prompt_path = _require_prompt_wav()
        prompt_text = (settings.cosyvoice_prompt_text or "").strip()
        if not prompt_text:
            raise ValueError("COSYVOICE_PROMPT_TEXT is required when COSYVOICE_MODE=zero_shot.")
        files = {"prompt_wav": _build_file_tuple(prompt_path)}
        data = {
            "tts_text": text,
            "prompt_text": _normalize_zero_shot_prompt_text(prompt_text),
        }
        endpoint = "/inference_zero_shot"
    elif mode == "sft":
        speaker_id = (voice_id or settings.cosyvoice_speaker_id or "").strip()
        if not speaker_id:
            raise ValueError("COSYVOICE_SPK_ID is required when COSYVOICE_MODE=sft.")
        files = None
        data = {
            "tts_text": text,
            "spk_id": speaker_id,
        }
        endpoint = "/inference_sft"
    else:
        raise ValueError(f"Unsupported COSYVOICE_MODE: {settings.cosyvoice_mode}")

    response = requests.post(
        f"{runtime_url}{endpoint}",
        data=data,
        files=files,
        timeout=settings.cosyvoice_timeout_seconds,
    )
    response.raise_for_status()

    pcm_bytes = response.content
    if not pcm_bytes:
        raise ValueError("CosyVoice runtime returned empty audio bytes.")

    return pcm_s16le_to_wav_bytes(pcm_bytes, sample_rate=settings.cosyvoice_sample_rate)


def pcm_s16le_to_wav_bytes(pcm_bytes: bytes, *, sample_rate: int) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()


def _require_prompt_wav() -> Path:
    prompt_path = settings.cosyvoice_prompt_wav_path
    if prompt_path is None:
        raise ValueError("COSYVOICE_PROMPT_WAV_PATH is required for the selected CosyVoice mode.")
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt wav not found: {prompt_path}")
    return prompt_path


def _build_file_tuple(path: Path):
    return path.name, path.read_bytes(), "audio/wav"


def _normalize_instruct_text(instruction: Optional[str]) -> str:
    raw_instruction = (instruction or settings.cosyvoice_instruction).strip()
    if "<|endofprompt|>" in raw_instruction:
        return raw_instruction

    normalized = raw_instruction
    if not normalized.lower().startswith("you are a helpful assistant."):
        normalized = f"You are a helpful assistant. {normalized}"

    return f"{normalized}<|endofprompt|>"


def _normalize_zero_shot_prompt_text(prompt_text: str) -> str:
    normalized = prompt_text.strip()
    if "<|endofprompt|>" in normalized:
        return normalized
    return f"You are a helpful assistant.<|endofprompt|>{normalized}"

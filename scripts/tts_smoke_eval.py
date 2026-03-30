#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import wave
from array import array
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://127.0.0.1:8010"
DEFAULT_SAMPLE_RATE = 24000
DEFAULT_MIN_DURATION_SECONDS = 0.6
DEFAULT_TIMEOUT_SECONDS = 120.0


@dataclass
class EvalResult:
    case_id: str
    category: str
    ok: bool
    latency_ms: float
    status_code: int | None = None
    content_type: str | None = None
    audio_bytes: int = 0
    channels: int | None = None
    sample_width_bytes: int | None = None
    frame_rate: int | None = None
    frame_count: int | None = None
    duration_seconds: float | None = None
    peak_abs: int | None = None
    rms: float | None = None
    output_path: str | None = None
    error: str | None = None


def sanitize_filename(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return normalized.strip("._") or "case"


def load_cases(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not payload:
        raise ValueError(f"Expected a non-empty list of cases in {path}.")
    return payload


def parse_wav_metrics(audio_bytes: bytes) -> dict[str, Any]:
    with wave.open(BytesIO(audio_bytes), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        frame_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw_frames = wav_file.readframes(frame_count)

    duration_seconds = frame_count / frame_rate if frame_rate else 0.0
    sample_count = len(raw_frames) // sample_width if sample_width else 0
    samples = array("h")
    if raw_frames:
        samples.frombytes(raw_frames[: sample_count * sample_width])

    if samples:
        peak_abs = max(abs(sample) for sample in samples)
        rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
    else:
        peak_abs = 0
        rms = 0.0

    return {
        "channels": channels,
        "sample_width_bytes": sample_width,
        "frame_rate": frame_rate,
        "frame_count": frame_count,
        "duration_seconds": round(duration_seconds, 3),
        "peak_abs": peak_abs,
        "rms": round(rms, 2),
    }


def fetch_audio(
    base_url: str,
    text: str,
    instruction: str | None,
    timeout_seconds: float,
) -> tuple[int, str | None, bytes]:
    payload = {"text": text}
    if instruction:
        payload["instruction"] = instruction

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        f"{base_url.rstrip('/')}/synthesize",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=timeout_seconds) as response:
        return response.status, response.headers.get("Content-Type"), response.read()


def evaluate_case(
    case: dict[str, Any],
    *,
    base_url: str,
    output_dir: Path,
    expected_sample_rate: int,
    min_duration_seconds: float,
    timeout_seconds: float,
) -> EvalResult:
    case_id = str(case.get("id") or "").strip()
    category = str(case.get("category") or "uncategorized").strip()
    text = str(case.get("text") or "").strip()
    instruction = str(case.get("instruction") or "").strip() or None

    if not case_id or not text:
        return EvalResult(
            case_id=case_id or "missing_id",
            category=category,
            ok=False,
            latency_ms=0.0,
            error="Case must include non-empty id and text.",
        )

    started_at = time.perf_counter()
    try:
        status_code, content_type, audio_bytes = fetch_audio(base_url, text, instruction, timeout_seconds)
    except HTTPError as error:
        message = error.read().decode("utf-8", errors="replace")
        return EvalResult(
            case_id=case_id,
            category=category,
            ok=False,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 1),
            status_code=error.code,
            error=message or str(error),
        )
    except URLError as error:
        return EvalResult(
            case_id=case_id,
            category=category,
            ok=False,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 1),
            error=str(error.reason),
        )
    except Exception as error:  # pragma: no cover - defensive
        return EvalResult(
            case_id=case_id,
            category=category,
            ok=False,
            latency_ms=round((time.perf_counter() - started_at) * 1000, 1),
            error=str(error),
        )

    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)
    result = EvalResult(
        case_id=case_id,
        category=category,
        ok=False,
        latency_ms=latency_ms,
        status_code=status_code,
        content_type=content_type,
        audio_bytes=len(audio_bytes),
    )

    if status_code != 200:
        result.error = f"Unexpected status code: {status_code}"
        return result

    if not content_type or not content_type.startswith("audio/"):
        result.error = f"Unexpected content-type: {content_type or 'missing'}"
        return result

    if not audio_bytes:
        result.error = "Received empty audio payload."
        return result

    try:
        metrics = parse_wav_metrics(audio_bytes)
    except wave.Error as error:
        result.error = f"Invalid WAV payload: {error}"
        return result

    for key, value in metrics.items():
        setattr(result, key, value)

    problems: list[str] = []
    if result.channels != 1:
        problems.append(f"Expected mono audio, got {result.channels}.")
    if result.sample_width_bytes != 2:
        problems.append(f"Expected 16-bit PCM, got {result.sample_width_bytes} bytes.")
    if result.frame_rate != expected_sample_rate:
        problems.append(f"Expected sample rate {expected_sample_rate}, got {result.frame_rate}.")
    if (result.duration_seconds or 0.0) < min_duration_seconds:
        problems.append(
            f"Audio too short: {result.duration_seconds}s < {min_duration_seconds}s."
        )
    if (result.peak_abs or 0) <= 0:
        problems.append("Audio appears silent because peak amplitude is zero.")

    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{sanitize_filename(case_id)}.wav"
    output_path.write_bytes(audio_bytes)
    result.output_path = str(output_path)

    if problems:
        result.error = " ".join(problems)
        return result

    result.ok = True
    return result


def build_report(results: list[EvalResult], *, base_url: str, cases_path: Path) -> dict[str, Any]:
    passed = [result for result in results if result.ok]
    failed = [result for result in results if not result.ok]
    latencies = [result.latency_ms for result in results if result.latency_ms > 0]

    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "base_url": base_url,
        "cases_path": str(cases_path),
        "summary": {
            "total": len(results),
            "passed": len(passed),
            "failed": len(failed),
            "pass_rate": round(len(passed) / len(results), 4) if results else 0.0,
            "latency_ms": {
                "min": round(min(latencies), 1) if latencies else None,
                "max": round(max(latencies), 1) if latencies else None,
                "avg": round(sum(latencies) / len(latencies), 1) if latencies else None,
            },
        },
        "results": [asdict(result) for result in results],
    }

def main() -> int:
    parser = argparse.ArgumentParser(description="Run TTS smoke evals against the local CosyVoice adapter.")
    repo_root = Path(__file__).resolve().parent.parent
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Base URL for the Python TTS adapter.",
    )
    parser.add_argument(
        "--cases",
        default=str(repo_root / "tts_service" / "evals" / "smoke_cases.json"),
        help="Path to the JSON file containing eval cases.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / "tts_service" / "evals" / "artifacts" / "latest"),
        help="Directory where generated WAV files will be written.",
    )
    parser.add_argument(
        "--report",
        default=str(repo_root / "tts_service" / "evals" / "reports" / "tts_smoke_eval_latest.json"),
        help="Path to the JSON report file.",
    )
    parser.add_argument(
        "--expected-sample-rate",
        type=int,
        default=DEFAULT_SAMPLE_RATE,
        help="Expected WAV sample rate.",
    )
    parser.add_argument(
        "--min-duration",
        type=float,
        default=DEFAULT_MIN_DURATION_SECONDS,
        help="Minimum acceptable audio duration in seconds.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help="Per-request timeout in seconds.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Optional limit on how many cases to run from the input file.",
    )
    args = parser.parse_args()

    cases_path = Path(args.cases).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()

    cases = load_cases(cases_path)
    if args.limit > 0:
        cases = cases[: args.limit]

    results: list[EvalResult] = []
    total_cases = len(cases)
    for index, case in enumerate(cases, start=1):
        case_id = str(case.get("id") or f"case_{index}")
        print(f"[{index}/{total_cases}] {case_id}", flush=True)
        results.append(
            evaluate_case(
                case,
                base_url=args.base_url,
                output_dir=output_dir,
                expected_sample_rate=args.expected_sample_rate,
                min_duration_seconds=args.min_duration,
                timeout_seconds=args.timeout,
            )
        )

    report = build_report(results, base_url=args.base_url, cases_path=cases_path)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    failed = [result for result in results if not result.ok]
    print(
        json.dumps(
            {
                "summary": report["summary"],
                "report_path": str(report_path),
                "output_dir": str(output_dir),
                "failed_case_ids": [result.case_id for result in failed],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

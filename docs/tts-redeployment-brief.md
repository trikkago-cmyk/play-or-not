# DM 洛思 TTS Redeployment Brief

Last updated: 2026-03-26

## Goal

- Restore TTS for `DM 洛思`.
- Auto-play the opening greeting when the chat session boots.
- Auto-play every new assistant reply.
- Let the user mute/unmute voice playback from the top-right corner.

## Chosen Path

- Use browser-native `SpeechSynthesis` as the first redeployment path.
- Prefer a warm Chinese female voice at runtime.
- Keep the implementation isolated in a dedicated service so we can swap to a cloud TTS provider later without rewriting `ChatPage`.

## Why This Path

- Zero infra dependency.
- Zero marginal cost.
- Fastest way to get a stable vertical slice online.
- Good fit for the current project stage, where product validation matters more than a heavier backend rollout.

## Current Behavior

- `src/services/dmTtsService.ts`
  - Detects browser TTS support.
  - Persists the mute state in local storage.
  - Prefers Chinese female voices such as `Xiaoxiao`-like voices when available.
  - Cleans markdown and strips evidence appendix before speaking.
  - Cancels previous playback before reading the latest reply.
- `src/pages/ChatPage.tsx`
  - Preloads voices on mount.
  - Speaks each new assistant message once.
  - Skips replaying old history messages on session restore.
  - Stops playback on unmount.
  - Exposes a top-right mute toggle.
- `api/tts.ts`
  - Now runs as a Node.js Vercel function instead of Edge.
  - Adds a Node-compatible request adapter so local tests and Vercel runtime use the same core TTS logic.
  - Proxies `/api/tts -> tts_service -> official CosyVoice runtime`.
- `tts_service/*`
  - Verified locally against the official CosyVoice runtime on port `50001`.
  - Adapter verified on port `8010`.
  - Added local smoke eval inputs at `tts_service/evals/smoke_cases.json`.
  - Added reusable eval runner at `scripts/tts_smoke_eval.py`.

## Checkpoints

### Yellow

- Online preview still needs a reachable TTS runtime URL; `127.0.0.1` only works for local verification.
- The current preview still depends on a temporary public tunnel that points back to the local TTS adapter.
- Startup auto-play can still vary by browser policy, especially before the first user gesture.
- Voice timbre can be improved further by replacing the default prompt wav with a custom Luosi reference voice.
- Browser-native voice quality still depends on the user's device and installed voices.

### Red

- Official CosyVoice runtime on the current local CPU machine is not suitable for real-time DM playback.
- A feasibility run on 2026-03-26 failed 2 out of 2 short-form smoke cases because the Python adapter timed out after about 90 seconds waiting for `inference_instruct2`.
- Latest report:
  `tts_service/evals/reports/tts_smoke_eval_latest.json`
- Representative local observation:
  one short sentence returned playable WAV in about 80.13 seconds after a clean restart, which is far beyond the acceptable latency budget for per-reply auto playback.
- Product decision:
  keep CosyVoice as an offline/local experimentation path for now, but do not use it as the online default path until we have a materially faster serving setup.

### Green

- TTS service implemented.
- Auto greeting playback implemented.
- Per-reply playback implemented.
- Top-right mute toggle implemented.
- Service tests added.
- Full test suite and production build passing.
- Official CosyVoice runtime verified locally as a quality experiment.
- Local Vercel `/api/tts` chain verified end to end.
- Browser speech fallback verified by automated tests and remains the production-safe path today.

## Root Cause Fixed

- `api/tts.ts` previously used the TypeScript `satisfies` operator inside the parsed request body.
- Vercel's Edge function bundler failed to compile that syntax in this file, so `/api/tts` returned `FUNCTION_INVOCATION_FAILED` instead of audio.
- `/api/tts` now uses an explicit typed object, runs on Node.js instead of Edge, and gets a longer function duration budget in `vercel.json`.

## Follow-up

- When Notion auth is restored, mirror this brief and the milestone status to the shared Notion page.
- If more voice consistency is needed across devices, add a second backend option:
  browser TTS as default, cloud TTS as optional enhanced mode.
- If we revisit CosyVoice for production, do it only with a faster serving plan:
  GPU host, Triton/TRT-LLM path, or a different low-latency provider with similar timbre.

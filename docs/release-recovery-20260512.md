# Release Recovery - 2026-05-12

## Production Rollback

- Rolled `play-or-not-dm.vercel.app` back to pre-500 stable deployment:
  - `https://play-or-not-8asroaoc8-trikkagos-projects.vercel.app`

## Recovery Branch

- Worktree: `/Users/yusijua/Downloads/app-2-release-recovery`
- Branch: `codex/release-recovery-20260512`

## Fixes Included

- Disabled silent browser speech fallback on hosted domains so DM TTS no longer drops to a mechanical browser voice when server-side TTS is unavailable.
- Restored `doubao_tts` support in `api/tts.ts` for the clean release branch.
- Set the clean-branch Doubao default voice to `zh_female_tianmeixiaoyuan_uranus_bigtts`.
- Removed internal wording from recommendation/referee responses:
  - `召回`
  - `候选池`
  - `参考依据`
  - evidence labels like `[证据1]`
- Added localized-title guardrails so untranslated expansion titles are not surfaced by default in user-facing recommendations.
- Hid duplicate English subtitles when `titleCn` and `titleEn` are effectively the same string.

## Validation

- `npm exec vitest -- --run api/__tests__/tts.test.ts src/services/__tests__/dmTtsService.test.ts src/services/__tests__/llmService.refereeEvidence.test.ts src/services/__tests__/llmService.recommendationLanguage.test.ts src/services/__tests__/llmService.test.ts`
  - Passed: `25/25`
- `npm run build`
  - Passed

## Preview

- Latest preview deployment:
  - `https://play-or-not-6lc9yp4v7-trikkagos-projects.vercel.app`
- Smoke checks:
  - `POST /api/tts` returns `200`
  - `x-tts-provider: doubao_tts`
  - `x-tts-voice-id: zh_female_tianmeixiaoyuan_uranus_bigtts`
  - bundled frontend still contains 500-game data (`Wispwood` present)

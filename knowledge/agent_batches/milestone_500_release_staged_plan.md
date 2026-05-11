# Milestone 500 Release Staged Plan

Snapshot time: `2026-05-11 22:05:00 +08:00`

## Scope

This file is the release-side staged deployment plan for `/Users/yusijua/Downloads/app-2-boardgame-release`.

It intentionally tracks the frozen conservative release candidate and should be treated as the local source of truth for release-side work, even though the live MELT expansion continues in `/Users/yusijua/Downloads/app 2`.

## Current position

- Release workspace: `/Users/yusijua/Downloads/app-2-boardgame-release`
- Release branch: `codex/release-500-slice-1`
- Frozen boardgame release snapshot in this repo: `500 / 500`
- Main mixed workspace milestone: `500 / 500`
- Main workspace accepted delta absorbed beyond the old `484` release freeze: `16` games across batches `072`, `073`, and `074`
- Main runner state: heartbeat healthy, runner intentionally stopped while the final `6` games await a safe conservative queue
- Release-side rule: continue to freeze deliberate boardgame slices here instead of ever copying the mixed main workspace wholesale

## What is actually staged today

- The earlier `484` runtime/data slice is committed as `cedeb84`.
- The release-gate support slice is committed as `d578507`.
- The refreshed `500` candidate currently exists as a worktree delta on top of those commits and should be committed as its own release-freeze step after proof review.

## Conservative surfaces

### Surface A: release bookkeeping and status

- `knowledge/agent_batches/milestone_500_boardgame_release_checklist.md`
- `knowledge/agent_batches/milestone_500_release_staged_plan.md`
- `knowledge/agent_batches/milestone_500_boardgame_release_pathspec.txt`

Purpose: preserve the release decision record and the exact conservative slice boundary.

### Surface B: runtime parity slice for `/api/rag`

- `api/rag.ts`
- `api/__tests__/rag.test.ts`

Status: already proven on preview and should remain separate from the boardgame content slice during staging review.

### Surface C: boardgame runtime content slice

- `src/data/gameDatabase.ts`
- `src/data/gameDatabaseAutoExpansion.ts`
- `src/data/gameDatabaseExpansion.ts`
- `src/data/gameDatabaseCatalogExpansion.ts`
- `src/data/gameDatabaseCatalogRuleSupplements.ts`
- `src/data/recommendationProfile.ts`
- `knowledge/boardgame_kb.jsonl`
- `knowledge/boardgame_kb_sections.jsonl`
- `knowledge/boardgame_recommendation_kb.jsonl`
- `public/game-covers/`

Status: this surface is now the refreshed `500` slice described by `knowledge/agent_batches/milestone_500_boardgame_release_pathspec.txt`, with the minimal delta concentrated in `src/data/gameDatabaseAutoExpansion.ts`, regenerated KB exports, and `16` added cover assets.

### Surface D: release gate support and reproducibility

- `src/data/__tests__/gameDatabase.test.ts`
- `src/data/__tests__/recommendationProfile.test.ts`
- `scripts/audit_auto_expansion_release.mjs`
- `scripts/generate_auto_expansion_release_eval_cases.mjs`
- `scripts/localize_game_covers.mjs`
- `scripts/lib/`
- `rag_evals/config/auto_expansion_release_suite.json`
- `rag_evals/data/auto_expansion_recommendation_eval_cases.jsonl`
- `rag_evals/data/auto_expansion_referee_eval_cases.jsonl`
- `rag_evals/data/auto_expansion_referee_primary_eval_cases.jsonl`
- `rag_evals/data/auto_expansion_referee_flow_eval_cases.jsonl`
- `rag_evals/data/auto_expansion_referee_faq_eval_cases.jsonl`
- `rag_evals/data/catalog_referee_supplement_eval_cases.jsonl`

Status: this surface is still optional from a minimal production-runtime point of view, but it is now part of the proven `500` release candidate because its generated eval inputs and guardrail tests were refreshed and revalidated against the exact frozen `500` content.

### Surface E: now intentionally included in the full 500 proof

- `rag/retrieval.py`
- `scripts/export_boardgame_kb.mjs`

Status: both files were exercised by the refreshed `500` proof in this repo and should be treated as part of the candidate if we want the proof to remain reproducible.

## Current verdict

- The release candidate is now refreshed around the local `500` snapshot.
- The main repo is no longer ahead in boardgame count; this repo now matches the local merged milestone.
- The refreshed candidate has already passed the release-side full proof in this repo: export, audit, eval generation, ingest, retrieval eval, test, and build.
- The remaining release risk is no longer “can this candidate pass gates?” but “commit, push, preview, and promote it without mixing unrelated dirty files.”

## Minimal-risk update path when a future safe batch is ready

1. Wait for a deliberate release refresh decision instead of passively inheriting main-repo progress.
2. Freeze that exact accepted batch into a new release candidate instead of copying the mixed main worktree wholesale.
3. Explicitly decide whether `rag/retrieval.py` and `scripts/export_boardgame_kb.mjs` remain part of the proof surface for that refresh.
4. Re-run the release-side proof on the exact frozen candidate:
   - `node scripts/localize_game_covers.mjs`
   - `node scripts/export_boardgame_kb.mjs`
   - `node scripts/audit_auto_expansion_release.mjs`
   - `node scripts/generate_auto_expansion_release_eval_cases.mjs`
   - `PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_kb.jsonl --reset-collection`
   - `PYTHONPATH=. ./.venv/bin/python rag_evals/run_suite.py --suite-config rag_evals/config/auto_expansion_release_suite.json --fail-on-threshold`
   - `npm test`
   - `npm run build`
5. If the `/api/rag` runtime slice changed, re-prove preview parity on that same exact candidate before any ship decision.

## No-go rules

- Do not ship directly from `/Users/yusijua/Downloads/app 2`.
- Do not absorb future main-repo boardgame changes wholesale just because the local milestone is already complete.
- Do not mix unrelated dirty files such as `docs/boardgame-source-expansion-agent.md` or `package-lock.json` into this release candidate without a separate reasoned review.
- Do not assume the existing preview/prod state changed just because the local `500` candidate is now green.

## Immediate recommendation

Commit and push this refreshed `500` candidate first. Then use the exact pushed branch tip for preview verification and staged deployment review.

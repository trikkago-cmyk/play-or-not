# Milestone 500 Release Staged Plan

Snapshot time: `2026-05-11 19:20:00 +08:00`

## Scope

This file is the release-side staged deployment plan for `/Users/yusijua/Downloads/app-2-boardgame-release`.

It intentionally tracks the frozen conservative release candidate and should be treated as the local source of truth for release-side work, even though the live MELT expansion continues in `/Users/yusijua/Downloads/app 2`.

## Current position

- Release workspace: `/Users/yusijua/Downloads/app-2-boardgame-release`
- Release branch: `codex/boardgame-release-484`
- Frozen boardgame release snapshot in this repo: `484 / 500`
- Main mixed workspace milestone: `494 / 500`
- Main workspace latest accepted delta beyond this release snapshot: batch `072` merged five rows (`ancientknowledge`, `fiftyfirststate`, `flamingpyramids`, `kamon`, `carnuta`)
- Main runner state: heartbeat healthy, runner intentionally stopped while the final `6` games await a safe conservative queue
- Release-side rule: do not absorb main-repo work here until a future batch is accepted as full-tier and deliberately re-frozen

## What is actually staged today

- Nothing is staged in the Git index right now.
- `git diff --cached --name-status` is empty.
- The candidate release state lives as worktree-only release dirt: `14` tracked modified paths and `16` untracked paths/directories.
- This means the safest deployment rehearsal is to stage by slice, not to assume the repo already contains a preselected index snapshot.

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

Status: this is the frozen conservative `484` slice described by `knowledge/agent_batches/milestone_500_boardgame_release_pathspec.txt`.

### Surface D: release gate support and reproducibility

- `src/data/__tests__/gameDatabase.test.ts`
- `src/data/__tests__/recommendationProfile.test.ts`
- `scripts/export_boardgame_kb.mjs`
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

Status: keep this as a separate optional slice. It is useful for a release rehearsal because it preserves the exact scripts, tests, and generated eval inputs that validated the frozen `484` candidate, but it is not the minimal production runtime payload.

### Surface E: intentionally out of scope for conservative boardgame promotion

- `rag/retrieval.py`

Status: modified in this release repo, but still excluded from authoritative conservative release proof.

## Current verdict

- The release candidate remains frozen around the conservative `484` snapshot.
- The main repo is ahead at `494`, but that newer state is still mixed workspace state, not release-frozen state.
- The accepted `072` batch is real progress, but it is still not safe to absorb here without a deliberate new freeze and a full rerun of the release-side proof.
- The release-side non-Python gates already proved the `484` candidate is coherent enough to keep as the deployment base.

## Minimal-risk update path when a future safe batch is ready

1. Wait for a deliberate release refresh decision instead of passively inheriting main-repo progress.
2. Freeze that exact accepted batch into a new release candidate instead of copying the mixed main worktree wholesale.
3. Keep `rag/retrieval.py` out unless it is intentionally promoted as a separately reviewed release surface.
4. Re-run the release-side proof on the exact frozen candidate:
   - `node scripts/localize_game_covers.mjs`
   - `node scripts/export_boardgame_kb.mjs`
   - `node scripts/audit_auto_expansion_release.mjs`
   - `node scripts/generate_auto_expansion_release_eval_cases.mjs`
   - `npm test`
   - `npm run build`
5. If the `/api/rag` runtime slice changed, re-prove preview parity on that same exact candidate before any ship decision.

## No-go rules

- Do not ship directly from `/Users/yusijua/Downloads/app 2`.
- Do not absorb the main-repo `494 / 500` state wholesale just because the newest accepted batch already exists.
- Do not treat Python ingest or retrieval eval from this dirty release worktree as conservative release proof while `rag/retrieval.py` remains modified and out of slice.
- Do not rely on tracked-only staging, because `src/data/gameDatabase.ts` depends on untracked catalog source files and `public/game-covers/`.

## Immediate recommendation

Keep this repo as the frozen conservative release sidecar. If the user asks for a staged deployment rehearsal, use:

- `knowledge/agent_batches/milestone_500_boardgame_release_pathspec.txt` for the boardgame content slice
- `api/rag.ts`
- `api/__tests__/rag.test.ts`

and continue to leave `rag/retrieval.py` out.

# Milestone 500 Boardgame Release Checklist

Snapshot time: `2026-05-11 19:20:00 +08:00`

## Release workspace snapshot

- Release workspace: `/Users/yusijua/Downloads/app-2-boardgame-release`
- Branch: `codex/boardgame-release-484`
- Main workspace milestone: `494 / 500` on `2026-05-11`
- Main workspace latest accepted batch: batch `072` promoted the prior `072h` queue into a fully accepted five-row merge (`ancientknowledge`, `fiftyfirststate`, `flamingpyramids`, `kamon`, `carnuta`)
- Release snapshot milestone re-exported here: `484 / 500`
- Main runner state: heartbeat healthy, runner intentionally stopped
- Release candidate state: remain frozen on the conservative `484` snapshot until a future main-repo batch is deliberately re-frozen here
- Important constraint: do not wholesale-promote the mixed `494` main workspace into this release branch

## Git index status in the release repo

- `git diff --cached --name-status` is empty right now.
- The frozen release candidate exists in the working tree, not in the index.
- Current worktree shape: `14` tracked modified paths plus `16` untracked paths/directories.
- Consequence: nothing is staged for deployment review yet, so safe promotion depends on explicit slice staging rather than assuming the release repo is already frozen in Git.

## Conservative deploy slice status

The conservative data slice for staged release must include all of the following, and each item is present in this release workspace:

- `src/data/gameDatabase.ts`
- `src/data/gameDatabaseAutoExpansion.ts`
- `src/data/gameDatabaseExpansion.ts`
- `src/data/gameDatabaseCatalogExpansion.ts`
- `src/data/gameDatabaseCatalogRuleSupplements.ts`
- `src/data/recommendationProfile.ts`
- `knowledge/boardgame_kb.jsonl`
- `knowledge/boardgame_kb_sections.jsonl`
- `knowledge/boardgame_recommendation_kb.jsonl`
- full `public/game-covers/`

Additional verified facts:

- `public/game-covers/` currently contains `486` files.
- `node scripts/localize_game_covers.mjs` localized `484` game covers with `0` downloads, `0` reuses, and `0` placeholders.
- A direct cover audit confirmed `0` missing files for every currently referenced `/game-covers/*` asset in the runtime data sources.
- `src/data/gameDatabase.ts` imports `src/data/gameDatabaseCatalogExpansion.ts` and `src/data/gameDatabaseCatalogRuleSupplements.ts`, so tracked-only promotion is unsafe.
- `public/game-covers/`, `src/data/gameDatabaseCatalogExpansion.ts`, and `src/data/gameDatabaseCatalogRuleSupplements.ts` are still untracked in this release workspace and must be staged explicitly.
- `src/data/__tests__/`, `scripts/localize_game_covers.mjs`, `scripts/audit_auto_expansion_release.mjs`, `scripts/generate_auto_expansion_release_eval_cases.mjs`, `scripts/lib/`, and the release eval fixtures are also untracked, so any rehearsal slice that depends on them must stage them deliberately too.

## Files that must stay out of the conservative slice

- `rag/retrieval.py`

Why it stays out:

- The file is modified in this release workspace but is not part of the approved conservative data slice.
- Any ingest or Python retrieval eval run against the dirty worktree would exercise code that is explicitly out of scope for this staged rollout.
- Treat Python RAG eval results from this worktree as non-authoritative for the conservative slice until `rag/retrieval.py` is either reverted out of the branch or split into a separate reviewed step.

## Runtime parity status

- Release preview `/api/rag` had already been verified `200` before this check.
- The runtime parity slice remains relevant:
  - `api/rag.ts`
  - `api/__tests__/rag.test.ts`
- Keep that runtime slice separate from the conservative boardgame data slice when reviewing or staging.

## Gate results run in this release workspace

Passed on `2026-05-11`:

- `node scripts/localize_game_covers.mjs`
  - result: `Localized 484 game cover(s) into public/game-covers (downloaded: 0, reused: 0, placeholders: 0).`
- `node scripts/export_boardgame_kb.mjs`
  - result: `484` games, `968` knowledge documents, `4837` section documents
- `node scripts/audit_auto_expansion_release.mjs`
  - result: `pass: true`, `429` auto-expansion games, `0` failures, `0` warnings
- `node scripts/generate_auto_expansion_release_eval_cases.mjs`
  - result: `858` recommendation cases and `1287` referee cases
- `npm test`
  - result: `12` test files passed, `51` tests passed
  - includes `api/__tests__/rag.test.ts` with `7` passing cases
- `npm run build`
  - result: passed
  - note: existing Vite chunk-size warning still appears

Not accepted as a release proof:

- `PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_kb.jsonl --reset-collection`
  - intentionally stopped during this check
  - reason: it would validate the dirty `rag/retrieval.py` path, which is explicitly excluded from the conservative slice

## Current verdict

What is ready:

- The release workspace still preserves a frozen `484` boardgame snapshot rather than the mixed `494` main workspace.
- The required conservative data files are present.
- Cover assets are complete for the current runtime references.
- The release-side boardgame export/audit/build/test gates that do not rely on `rag/retrieval.py` are green.

What is still red:

- Conservative promotion is not yet one-command safe because required files are partly untracked.
- The release workspace is missing a clean separation between the conservative slice and the dirty `rag/retrieval.py` diff unless staging follows an explicit pathspec.
- Python ingest / retrieval eval must not be used as acceptance proof from this dirty worktree while `rag/retrieval.py` remains modified and out of slice.
- The main repo is ahead at `494`, but that accepted progress is not release-frozen here and should still be treated as out of scope for this conservative release branch.

## Future safe-batch absorption rule

When the main workspace eventually produces a new accepted full-tier batch beyond `494`, absorb it into this release candidate only with all of the following:

1. Freeze the exact accepted batch into a new conservative release snapshot instead of copying the mixed main worktree wholesale.
2. Keep `rag/retrieval.py` out of the boardgame-only promotion slice unless it becomes an intentional reviewed release step.
3. Re-run the release-side non-Python proof on the exact frozen candidate:
   - `node scripts/localize_game_covers.mjs`
   - `node scripts/export_boardgame_kb.mjs`
   - `node scripts/audit_auto_expansion_release.mjs`
   - `node scripts/generate_auto_expansion_release_eval_cases.mjs`
   - `npm test`
   - `npm run build`
4. Reuse the already-proven `/api/rag` runtime parity slice only if that surface remains unchanged, otherwise revalidate it separately.
5. Promote only after the exact same frozen candidate still matches the conservative pathspec and preview smoke checks.

## Recommended next step

For the staged rollout, keep this release workspace frozen around the current `484` candidate. Review and stage only the files in `knowledge/agent_batches/milestone_500_boardgame_release_pathspec.txt`, plus the already-verified runtime parity slice if that step is intentionally included:

- `api/rag.ts`
- `api/__tests__/rag.test.ts`

Do not stage `rag/retrieval.py` into the conservative boardgame deployment step. The next possible refresh candidate is the already-accepted main-repo progress above `484`, but only after a deliberate new freeze and the full release-side proof rerun in this repo.

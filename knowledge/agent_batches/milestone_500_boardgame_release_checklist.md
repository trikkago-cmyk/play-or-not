# Milestone 500 Boardgame Release Checklist

Snapshot time: `2026-05-11 22:05:00 +08:00`

## Release workspace snapshot

- Release workspace: `/Users/yusijua/Downloads/app-2-boardgame-release`
- Branch: `codex/release-500-slice-1`
- Main workspace milestone: `500 / 500` on `2026-05-11`
- Main workspace latest accepted batches beyond the old `484` freeze:
  - batch `072`: `ancientknowledge`, `fiftyfirststate`, `flamingpyramids`, `kamon`, `carnuta`
  - batch `073`: `kingoftokyoduel`, `dicehospitaler`, `ageofchampagne`, `sirocelotscave`, `giftoftulips`
  - batch `074`: `trailblazers`
- Release snapshot re-frozen here: `500 / 500`
- Main runner state: heartbeat healthy, runner intentionally stopped
- Release candidate state: the old conservative `484` snapshot has now been deliberately refreshed into a clean `500` candidate on top of the earlier release commits
- Important constraint: this branch was refreshed by copying only the minimal verified boardgame delta from the main workspace, not by wholesale-promoting the mixed main worktree

## Git index status in the release repo

- The previous `484` content slice is already committed as `cedeb84` (`Prepare 484 boardgame release slice`).
- The release-gate support slice is already committed as `d578507` (`Prepare boardgame release support slice`).
- The refreshed `500` candidate currently exists as a worktree delta on top of those two commits and has now passed the full gate chain locally.

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

- `public/game-covers/` now contains the `16` additional assets needed to move from the frozen `484` snapshot to the local `500` snapshot.
- `node scripts/localize_game_covers.mjs` now reports `Localized 500 game cover(s) ... downloaded: 0, reused: 0, placeholders: 0`.
- A direct cover audit and the release audit both confirmed `0` missing files for every currently referenced `/game-covers/*` asset in the refreshed runtime data sources.
- `src/data/gameDatabase.ts` still imports `src/data/gameDatabaseCatalogExpansion.ts` and `src/data/gameDatabaseCatalogRuleSupplements.ts`, but those files themselves remain unchanged between the `484` and `500` release candidates.

## Files intentionally included in the refreshed 500 proof

- `rag/retrieval.py`
- `scripts/export_boardgame_kb.mjs`

Why they are included now:

- `rag/retrieval.py` matches the main workspace version that passed the local milestone proof and was exercised by the release-side `rag.ingest` and `rag_evals/run_suite.py` acceptance proof in this turn.
- `scripts/export_boardgame_kb.mjs` is part of the release-side self-export proof; the current worktree version successfully re-exported the refreshed `500` runtime state in this repo before audit, eval generation, ingest, and eval.
- This means the refreshed `500` release candidate is no longer only a non-Python rehearsal. It now has a reproducible full gate proof inside the clean release workspace.

## Runtime parity status

- Release preview `/api/rag` had already been verified `200` before this check.
- The runtime parity slice remains relevant:
  - `api/rag.ts`
  - `api/__tests__/rag.test.ts`
- Keep that runtime slice separate from the conservative boardgame data slice when reviewing or staging.

## Gate results run in this release workspace

Passed on `2026-05-11` for the refreshed `500` candidate:

- `node scripts/localize_game_covers.mjs`
  - result: `Localized 500 game cover(s) into public/game-covers (downloaded: 0, reused: 0, placeholders: 0).`
- `node scripts/export_boardgame_kb.mjs`
  - result: `500` games, `1000` knowledge documents, `4997` section documents
- `node scripts/audit_auto_expansion_release.mjs`
  - result: `pass: true`, `445` auto-expansion games, `0` failures, `0` warnings
- `node scripts/generate_auto_expansion_release_eval_cases.mjs`
  - result: `890` recommendation cases and `1335` referee cases
- `PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_kb.jsonl --reset-collection`
  - result: `1000` documents loaded, `4998` chunks written
- `PYTHONPATH=. ./.venv/bin/python rag_evals/run_suite.py --suite-config rag_evals/config/auto_expansion_release_suite.json --fail-on-threshold`
  - result: recommendation strict hit@5 `1.000`, referee primary strict hit@5 `1.000`, referee flow strict hit@5 `1.000` with pass_rate `0.998`, referee FAQ strict hit@5 `1.000` with pass_rate `0.984`
- `npm test`
  - result: `12` test files passed, `51` tests passed
  - includes `api/__tests__/rag.test.ts` with `7` passing cases
- `npm run build`
  - result: passed
  - note: existing Vite chunk-size warning still appears

## Current verdict

What is ready:

- The release workspace now preserves a deliberately refreshed clean `500 / 500` boardgame candidate rather than the older frozen `484` snapshot.
- The required boardgame runtime files are present and self-consistent inside this repo.
- Cover assets are complete for the refreshed runtime references.
- The release-side boardgame export, audit, eval generation, ingest, retrieval eval, test, and build gates are all green.

What is still red:

- The refreshed `500` candidate is not yet committed or pushed on this branch.
- `docs/boardgame-source-expansion-agent.md` and `package-lock.json` still remain dirty and are not part of this refreshed release candidate.
- Online deployment is still a separate step after the candidate is committed and pushed.

## Future safe-batch absorption rule

When a future boardgame delta beyond this local `500` candidate needs to be absorbed, follow all of the following:

1. Freeze the exact accepted batch into a new conservative release snapshot instead of copying the mixed main worktree wholesale.
2. Decide explicitly whether `rag/retrieval.py` and `scripts/export_boardgame_kb.mjs` stay part of the proof surface; do not let them drift implicitly.
3. Re-run the full release-side proof on the exact frozen candidate:
   - `node scripts/localize_game_covers.mjs`
   - `node scripts/export_boardgame_kb.mjs`
   - `node scripts/audit_auto_expansion_release.mjs`
   - `node scripts/generate_auto_expansion_release_eval_cases.mjs`
   - `PYTHONPATH=. ./.venv/bin/python -m rag.ingest --input knowledge/boardgame_kb.jsonl --reset-collection`
   - `PYTHONPATH=. ./.venv/bin/python rag_evals/run_suite.py --suite-config rag_evals/config/auto_expansion_release_suite.json --fail-on-threshold`
   - `npm test`
   - `npm run build`
4. Reuse the already-proven `/api/rag` runtime parity slice only if that surface remains unchanged, otherwise revalidate it separately.
5. Promote only after the exact same frozen candidate still matches the conservative pathspec and preview smoke checks.

## Recommended next step

For the staged rollout, commit and push this refreshed `500` candidate first. Then re-check the preview/runtime parity path on the exact same branch tip before any online promotion decision.

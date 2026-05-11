# Milestone 500 Release Support Slice Plan

Updated: `2026-05-11 20:06 CST`
Branch: `codex/release-484-slice-1`
Scope: boardgame-only release-gate support for the frozen `484` release branch.

## Intent

This slice is limited to release-gate support assets that can be landed without pulling in live-workspace runtime churn.

It is safe to prepare independently from the runtime/data slice because it adds:

- release-only audit and eval-generation scripts
- boardgame guardrail tests for `src/data`
- the release eval suite config and generated eval-case artifacts
- the minimal TypeScript config needed for the new `src/data` tests to type-check during `npm run build`

## Include In This Slice

Use the exact path list in:

- `knowledge/agent_batches/milestone_500_release_support_slice_pathspec.txt`

That list intentionally includes only:

- `rag_evals/config/auto_expansion_release_suite.json`
- `rag_evals/data/auto_expansion_*`
- `rag_evals/data/catalog_referee_supplement_eval_cases.jsonl`
- `scripts/audit_auto_expansion_release.mjs`
- `scripts/generate_auto_expansion_release_eval_cases.mjs`
- `scripts/localize_game_covers.mjs`
- `scripts/lib/game_data_loader.mjs`
- `src/data/__tests__/gameDatabase.test.ts`
- `src/data/__tests__/recommendationProfile.test.ts`
- `tsconfig.app.json`
- this plan file and the matching pathspec

## Keep Excluded

Do not include these current dirty paths in the support slice:

- `docs/boardgame-source-expansion-agent.md`
- `package-lock.json`
- `rag/retrieval.py`
- `scripts/export_boardgame_kb.mjs`

Reasoning:

- `docs/boardgame-source-expansion-agent.md` contains mixed release/live-workspace narrative churn and is not required for gate support landing.
- `package-lock.json` is local install churn and not required for the release-gate support scope.
- `rag/retrieval.py` is explicitly out of scope for this slice.
- `scripts/export_boardgame_kb.mjs` currently carries unrelated wiki-bundle/wikipatch-oriented edits in the dirty tree and must be reviewed separately before landing.

## Minimal Validation Completed

These checks were run in `/Users/yusijua/Downloads/app-2-boardgame-release` without touching prod deploy:

- `node scripts/localize_game_covers.mjs`
  - pass: `Localized 484 game cover(s) ... downloaded: 0, reused: 0, placeholders: 0`
- `node scripts/audit_auto_expansion_release.mjs`
  - pass: `autoExpansionGameCount: 429`, `failureCount: 0`, `warningCount: 0`
- `node scripts/generate_auto_expansion_release_eval_cases.mjs`
  - pass: `858` recommendation cases, `1287` referee cases, `429` primary/flow/faq cases
- `npx vitest run src/data/__tests__/gameDatabase.test.ts src/data/__tests__/recommendationProfile.test.ts`
  - pass: `2` files, `8` tests
- `npm run build`
  - pass with the existing Vite chunk-size warning only

## Staging Command

Recommended safe staging command:

```bash
git add --pathspec-from-file=knowledge/agent_batches/milestone_500_release_support_slice_pathspec.txt
```

## Deferred Check

`scripts/export_boardgame_kb.mjs` was intentionally not part of the slice validation because the current dirty version is excluded from this slice. If that file is later cleaned into a pure boardgame release-support change, rerun:

```bash
node scripts/export_boardgame_kb.mjs
node scripts/audit_auto_expansion_release.mjs
node scripts/generate_auto_expansion_release_eval_cases.mjs
```

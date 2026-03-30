# Boardgame KB Expansion Agent

## Goal

Expand the board-game library with a repeatable pipeline instead of hand-editing every new title.

The agent should produce records that can eventually land in:

- `src/data/gameDatabaseAutoExpansion.ts`
- `knowledge/boardgame_kb.jsonl`
- `knowledge/boardgame_recommendation_kb.jsonl`

Auto-expansion records should default to `knowledgeTier: "catalog"` unless a human has explicitly补全并验收了本地规则资料。

## Current App Contract

Each final game record must match the current `Game` shape used by the app:

- `id`
- `titleCn`
- `titleEn`
- `coverUrl`
- `minPlayers`
- `maxPlayers`
- `playtimeMin`
- `ageRating`
- `complexity`
- `tags`
- `oneLiner`
- `rules.target`
- `rules.flow`
- `rules.tips`
- `FAQ`
- `commonQuestions`
- `knowledgeBase`
- `tutorialVideoUrl`
- `bilibiliId`
- `bestPlayerCount`
- `bggId`
- `bggUrl`

## Source Policy

### Preferred

- `Board Game Arena`
  - Use public pages such as `/gamepanel?game=<slug>`.
  - Good for title, cover, player count, duration, lightweight complexity, and rule-summary context.
  - Fetch politely and cache results.

- `Bilibili`
  - Prefer public search result pages such as `https://search.bilibili.com/all?keyword=...`.
  - Select BV ids conservatively by title matching, not by blindly taking the first result.
  - Always keep a fallback `tutorialVideoUrl` search link even when no BV is found.

### Restricted / Manual Only

- `Xiaohongshu`
  - `https://www.xiaohongshu.com/robots.txt` currently disallows all bots.
  - Do not build an automated crawler for Xiaohongshu.
  - Manual human research is acceptable for naming, phrasing, and popularity validation.

- `BoardGameGeek`
  - BGG's XML API now requires auth and their published terms explicitly prohibit using site/XML data to train AI or LLM systems.
  - Do not auto-ingest BGG raw text into this RAG / knowledge pipeline.
  - External-link metadata such as `bggId` / `bggUrl` may be preserved when surfaced from approved upstream public metadata (for example BGA game panels), but should never be fabricated.

## Recommended Workflow

1. Start from a seed slug list in `knowledge/boardgame_source_seed_slugs.txt`.
2. Run raw harvesting from BGA into `knowledge/boardgame_source_candidates.raw.jsonl`.
3. Default path: render raw harvest records directly into `src/data/gameDatabaseAutoExpansion.ts` as `catalog` games.
4. Optional path: use an LLM for structure polishing and Chinese localization into `knowledge/boardgame_source_candidates.review.jsonl`.
5. Human review the candidate records when titles / tags / one-liners look weak.
6. Re-export JSONL via `npm run kb:export`.
7. Re-ingest into Chroma / rerun RAG evals before shipping.

## Commands

```bash
npm run kb:source:harvest
npm run kb:source:enrich
npm run kb:source:render
npm run kb:source:render:review
npm run kb:export
```

## Review Rules

- Prefer real Chinese common names over literal machine translation.
- `tags` should stay within the unified structured tag pool whenever possible, instead of inventing one-off labels.
- `catalog` games can participate in recommendation recall, but must not be treated as referee-grade authoritative rules.
- Do not invent BGG ids, publishers, awards, or unsupported edge-case rules.
- Do not copy third-party raw rules text directly into runtime `knowledgeBase`; keep runtime catalog records self-authored and normalized.
- If the source evidence is weak, keep the record in review JSONL or leave the Chinese title as English rather than forcing a bad localization.

## Definition Of Done

- New records exist in `src/data/gameDatabaseAutoExpansion.ts`.
- `npm run kb:export` succeeds.
- Chroma ingest succeeds after export.
- The new games appear in recommendation and referee retrieval after ingest.
- `catalog` games appear in recommendation retrieval but do not appear in referee retrieval.
- Eval recall does not regress.

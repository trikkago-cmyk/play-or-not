# RAG Mainline Phase 1 - 2026-05-13

## Decision

The production app has not been running the mature RAG mainline described in the project retrospective.

What exists:

- `rag/` already contains a real Python RAG backend with FastAPI, Chroma, FastEmbed, lexical/BM25 search, hybrid fusion, rerank, query rewrite, and aggregation.
- `knowledge/boardgame_kb.jsonl` and `knowledge/boardgame_kb_sections.jsonl` already provide structured board-game knowledge exports.
- `rag_evals/` already contains retrieval eval datasets and suite gates for recommendation and referee retrieval.
- `api/rag.ts` already knows how to proxy `RAG_SERVICE_URL`.

What has been missing online:

- Vercel Preview/Production has not had `RAG_SERVICE_URL` wired to a live Python RAG service.
- Therefore `/api/rag` has been falling back to `local_sections_lexical`.
- `local_sections_lexical` is useful as an emergency fallback, but it is not the mature vector/hybrid RAG mainline.

## Current Local Proof

Local Python RAG is functional in the recovery branch.

Recommendation smoke:

- Query: `九人局家庭聚会，来个轻松点的`
- Hard metadata filters:
  - `mode = recommendation`
  - `min_players <= 9`
  - `max_players >= 9`
  - `playtime_min <= 30`
  - `complexity <= 2.4`
  - `age_rating <= 8`
- Strategy returned: `hybrid_rrf_rerank_aggregated`
- Hybrid enabled: `true`
- Returned hits satisfy all atomic filters.

Referee smoke:

- Query: `阿瓦隆 刺客什么时候刺杀`
- Hard metadata filters:
  - `mode = referee`
  - `game_id = avalon`
- Strategy returned: `hybrid_rrf_rerank_aggregated`
- Hybrid enabled: `true`
- Returned hits are scoped to `avalon`.

## Target Mainline

The production-quality RAG path should be:

```text
Frontend / llmService
  -> /api/rag on Vercel
  -> Python RAG service via RAG_SERVICE_URL
  -> Chroma vector recall + lexical recall
  -> hybrid RRF fusion + mode-aware rerank + aggregation
  -> LLM generation with grounded candidates/evidence
```

Fallback should be:

```text
Python RAG unavailable
  -> local_sections_lexical
  -> marked with x-rag-fallback: true
```

Acceptance environments should set:

```text
RAG_SERVICE_URL=<live Python RAG service URL>
RAG_REQUIRE_SERVICE=true
```

With `RAG_REQUIRE_SERVICE=true`, `/api/rag` fails closed with `503 rag_service_unavailable` if the Python RAG service is unavailable. This prevents silent regressions where Preview appears healthy but has actually fallen back to local lexical search.

## Retrieval Contracts

### Recommendation

Atomic fields are hard metadata filters:

- player count / player range
- playtime
- complexity
- age rating

Tags are intent/ranking signals:

- occasion tags
- mechanic tags
- interaction tags
- mood tags
- theme tags
- long-term user preference tags

Ranking order:

```text
hard metadata compatibility
  -> current intent fit
  -> long-term user preference
  -> BGA / popularity signal
  -> hybrid retrieval similarity
```

The LLM must receive an already-filtered and reranked shortlist. It should package the selected game in the DM voice, not override hard constraints.

### Referee

Rule questions use hard scoping:

- `mode = referee`
- `game_id = active_game_id`

The retriever should prefer:

- `rules_detail`
- `faq`
- `flow`
- `victory`
- `setup`
- `tips`

Mode switching happens before retrieval. If the user asks for another game or a recommendation while in referee mode, the app should exit referee retrieval and use the recommendation chain instead.

## Phase 1 Changes Added

- Added `/api/rag` observability headers:
  - `x-rag-provider: python_rag | local_sections_lexical | unavailable`
  - `x-rag-fallback: false | true`
  - `x-rag-required: true` on fail-closed responses
- Added `RAG_REQUIRE_SERVICE=true` fail-closed behavior.
- Fixed non-strict fallback to preserve the original POST body when remote RAG fails.
- Added `scripts/rag_mainline_smoke.py`.
- Added npm commands:
  - `npm run rag:ingest`
  - `npm run rag:serve`
  - `npm run rag:smoke`
  - `npm run rag:smoke:http`
- Added `/api/rag` tests for:
  - proxying to configured Python RAG
  - strict fail-closed behavior
  - fallback response headers
  - fallback preserving the original query body

## Phase 2 Execution Plan

1. Run the local mainline gate:

```bash
npm run kb:export
npm run rag:ingest
npm run rag:smoke
npm run rag:eval
npm test
npm run build
```

2. Deploy a Python RAG service reachable by Vercel Preview.

3. Configure Preview env:

```bash
RAG_SERVICE_URL=<python-rag-url>
RAG_REQUIRE_SERVICE=true
```

4. Deploy Preview only.

5. Smoke Preview:

```bash
curl -i <preview-url>/api/rag
curl -i <preview-url>/api/rag \
  -H 'content-type: application/json' \
  -d '{"query":"九人局家庭聚会，来个轻松点的","top_k":3,"where":{"$and":[{"mode":"recommendation"},{"min_players":{"$lte":9}},{"max_players":{"$gte":9}},{"playtime_min":{"$lte":30}},{"complexity":{"$lte":2.4}},{"age_rating":{"$lte":8}}]}}'
```

Required Preview acceptance:

- Response header `x-rag-provider: python_rag`
- Response header `x-rag-fallback: false`
- Strategy is `hybrid_rrf_rerank_aggregated`
- Recommendation hits satisfy all hard filters
- Referee hits remain scoped to `active_game_id`

6. User validates frontend journey manually.

7. Production promotion only after explicit approval.

## Open Deployment Choice

The remaining product/infra decision is where to host the Python RAG service:

- Vercel alone is not a good fit for persistent Chroma + local embedding model.
- The practical next step is a small long-running service with persistent disk, for example Railway, Fly.io, Render, a lightweight VPS, or a container service.
- Once that URL is stable, Vercel only needs `RAG_SERVICE_URL` and `RAG_REQUIRE_SERVICE=true`.

## Phase 2 Completion - 2026-05-13 22:45 CST

Preview now has a verified non-fallback Python RAG mainline.

- Preview URL: `https://play-or-not-mkrsd6vz4-trikkagos-projects.vercel.app`
- Temporary Python RAG sidecar URL: `https://hosted-cathedral-sprint-explore.trycloudflare.com`
- Preview deployment command used `vercel deploy --yes` only; production was not promoted.
- Preview env overrides:
  - `RAG_SERVICE_URL=https://hosted-cathedral-sprint-explore.trycloudflare.com`
  - `RAG_REQUIRE_SERVICE=true`

Additional hardening:

- `/api/rag` now derives missing recommendation hard filters from the user query before proxying to Python RAG.
- Python RAG also derives the same missing hard filters server-side, so direct sidecar calls are protected too.
- Query-derived hard filters cover:
  - player count / player range
  - max playtime
  - complexity min/max
  - age rating
- Explicit caller-provided filters still win; derived filters only fill missing atomic constraints.
- Mid-strategy, low-conflict, one-hour recommendations now penalize too-light/too-short fillers so true medium low-conflict titles rank correctly.

Validation completed:

- `npm run kb:localize` -> `localized title entries: 0`
- `npm run kb:export` -> `500 games`, `1000 knowledge_documents`, `500 recommendation_documents`, `5000 section_documents`
- `npm run kb:validate` -> passed
- `npm run rag:ingest` -> `documents_loaded: 1000`, `chunks_written: 5001`
- `npm run rag:smoke` -> passed, `hybrid_rrf_rerank_aggregated`
- `npm run rag:smoke:http` against local `127.0.0.1:8001` -> passed
- `RAG_SERVICE_URL=https://hosted-cathedral-sprint-explore.trycloudflare.com npm run rag:smoke:http` -> passed
- `npm run rag:eval` -> all suites `pass_rate=1.000`, `strict_hit@5=1.000`
- `npm test` -> `14 files / 92 tests` passed
- `npm run build` -> passed, existing large chunk warning only
- `npm exec vitest -- --run api/__tests__/rag.test.ts` -> `12/12` passed

Preview API acceptance:

- `GET /api/rag`
  - status `200`
  - `x-rag-provider: python_rag`
  - `x-rag-fallback: false`
- Explicit hard-filter recommendation query `九人局家庭聚会，来个轻松点的`
  - strategy `hybrid_rrf_rerank_aggregated`
  - hits: `uno`, `supermegaluckybox`, `flipseven`
  - all hits satisfy players/time/complexity/age hard filters
- Derived hard-filter recommendation query `九人局家庭聚会，30分钟内，规则简单，8岁孩子也能玩`
  - strategy `hybrid_rrf_rerank_aggregated`
  - hits: `uno`, `supermegaluckybox`, `flipseven`
  - all hits satisfy query-derived players/time/complexity/age hard filters
- Referee query `阿瓦隆 刺客什么时候刺杀`
  - strategy `hybrid_rrf_rerank_aggregated`
  - all hits scoped to `game_id=avalon`

Remaining caveat:

- The sidecar is currently exposed through a temporary quick Cloudflare tunnel. It is acceptable for Preview validation, but not for production. Before production promotion, replace it with a stable long-running RAG host and set permanent Vercel env vars.

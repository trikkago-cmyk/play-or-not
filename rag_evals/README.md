# RAG Retrieval Evals (Boardgame Referee)

This folder provides a retrieval-focused evaluation harness for the boardgame DM project.

Goal: measure retrieval quality before response generation, especially in referee mode.

## What Is Included

- `run_eval.py`: executable evaluator with configurable retriever adapters.
- `run_suite.py`: multi-dataset suite runner with threshold gates and combined reports.
- `schemas/eval_case.schema.json`: sample format schema.
- `data/seed_referee_eval_cases.jsonl`: seed evaluation set (win/flow/faq/special-rule coverage).
- `data/expanded_referee_eval_cases.jsonl`: broader referee evaluation set with wider game and rule coverage.
- `data/seed_recommendation_eval_cases.jsonl`: seed recommendation evaluation set.
- `data/expanded_recommendation_eval_cases.jsonl`: broader recommendation evaluation set across player-count / duration / vibe / mechanic slices.
- `data/smoke_cases.jsonl`: tiny smoke dataset.
- `data/smoke_precomputed_results.jsonl`: matching precomputed retrieval results for smoke run.
- `config/*.example.json`: adapter config examples (`http`, `function`, `precomputed`).
- `config/python_rag_eval_suite.json`: project suite definition for seed + expanded regression gates.

## Eval Case Format

Each line in dataset JSONL is one case:

```json
{
  "id": "ref-uno-faq-plus4",
  "mode": "referee",
  "category": "faq",
  "active_game_id": "uno",
  "query": "+4 能不能随便出？被质疑怎么判？",
  "expected": {
    "must_game_ids": ["uno"],
    "any_game_ids": [],
    "must_not_game_ids": [],
    "keyword_groups": [
      ["+4", "Wild Draw Four"],
      ["质疑", "同色牌"]
    ],
    "min_recall_at_k": 0.8,
    "min_distinct_game_ids_at_k": 1,
    "top_1_section_any_of": ["常见问题", "知识库"]
  },
  "notes": "FAQ: +4 质疑"
}
```

Scoring semantics:

- `must_game_ids`: each expected game id contributes one target.
- `any_game_ids`: the whole list contributes one OR target; matching any one of them counts as success.
- `must_not_game_ids`: any listed game id appearing in top-k causes the case to fail.
- `keyword_groups`: each group contributes one target; matching is OR inside group.
- `recall@k`: `matched_targets / total_targets`.
- `hit@k`: at least one target matched.
- `strict_hit@k`: all targets matched.
- `distinct_game_ids@k`: top-k 中不同 `game_id` 的数量。
- `top_1_section_any_of`: when provided, the first hit must land in one of these sections.
- `pass`: `recall@k >= min_recall_at_k` and, when provided, `distinct_game_ids@k >= min_distinct_game_ids_at_k`, with no `must_not_game_ids` hit and a valid `top_1_section_any_of`.

## Retriever Adapters

`run_eval.py` supports:

1. `http` adapter
- Calls an endpoint and parses chunks from common response formats.
- Supports generic field mapping for `query/top_k/mode/active_game_id`.

2. `function` adapter
- Imports and calls local Python function.
- Function can return:
  - `{"chunks":[...]}`
  - `{"results":[...]}`
  - Chroma-like shape with `documents/metadatas/ids`.

3. `precomputed` adapter
- Reads JSONL results by case id (useful for offline regression snapshots).

## Quick Start

Smoke run with built-in precomputed data:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/smoke_cases.jsonl \
  --config rag_evals/config/precomputed_adapter.example.json \
  --top-k 3 \
  --verbose
```

Run seed set against your HTTP retriever:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/seed_referee_eval_cases.jsonl \
  --config rag_evals/config/python_rag_http.example.json \
  --top-k 5 \
  --default-threshold 0.8 \
  --report-json rag_evals/reports/latest.json
```

Run seed set against local function retriever:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/seed_referee_eval_cases.jsonl \
  --config rag_evals/config/python_rag_function.example.json \
  --top-k 5 \
  --report-json rag_evals/reports/latest.json
```

Run recommendation retrieval seed set:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/seed_recommendation_eval_cases.jsonl \
  --config rag_evals/config/python_rag_http.example.json \
  --top-k 5 \
  --default-threshold 1.0
```

Run expanded recommendation retrieval set:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/expanded_recommendation_eval_cases.jsonl \
  --config rag_evals/config/python_rag_function.example.json \
  --top-k 5 \
  --default-threshold 0.67 \
  --report-json rag_evals/reports/expanded_recommendation_eval_latest.json
```

Run expanded referee retrieval set:

```bash
python3 rag_evals/run_eval.py \
  --dataset rag_evals/data/expanded_referee_eval_cases.jsonl \
  --config rag_evals/config/python_rag_function.example.json \
  --top-k 5 \
  --default-threshold 0.8 \
  --report-json rag_evals/reports/expanded_referee_eval_latest.json
```

Run the full project suite with threshold gates:

```bash
PYTHONPATH=. .venv/bin/python rag_evals/run_suite.py \
  --suite-config rag_evals/config/python_rag_eval_suite.json \
  --fail-on-threshold
```

Run only the expanded suite:

```bash
PYTHONPATH=. .venv/bin/python rag_evals/run_suite.py \
  --suite-config rag_evals/config/python_rag_eval_suite.json \
  --group expanded \
  --fail-on-threshold
```

Or use the package scripts:

```bash
npm run rag:eval
npm run rag:eval:seed
npm run rag:eval:expanded
npm run rag:eval:hard
```

## Dataset Strategy

The project now keeps two dataset tiers:

1. `seed_*`
- Small and fast regression suite.
- Use for daily iteration and quick smoke comparisons.

2. `expanded_*`
- Broader stability suite closer to production traffic.
- Recommendation coverage includes: player count, duration, complexity, interaction style, occasion, and mechanic slices.
- Referee coverage includes: `win_condition`, `flow`, `faq`, `special_rule`, with wider game-family coverage and more colloquial phrasing.
- Recommendation evals also support diversity guards such as `min_distinct_game_ids_at_k`, used to catch top-k 被同一游戏重复占满的问题。

3. `hard_*`
- Hard-negative and ranking-sensitive regression set.
- Recommendation cases focus on explicit negative preferences such as “不要阵营推理”“别太伤感情”.
- Referee cases focus on first-hit section quality, ensuring FAQ / flow / win-condition queries first land in the right section family.

## Suite Runner And Gates

`run_suite.py` turns the dataset tiers into a reusable regression gate:

- One config file can define multiple suites with different datasets, thresholds, and tags.
- `--group` lets you run only `seed`, `expanded`, `recommendation`, or `referee`.
- `min_metrics` lets each suite enforce floor values such as `pass_rate` or `strict_hit_at_k`.
- `min_metrics` also supports `distinct_game_ids_at_k_mean` when you want to guard recommendation diversity at suite level.
- `min_metrics` also supports `top_1_section_pass_rate` when you want to guard referee first-hit section quality.
- `--fail-on-threshold` exits non-zero when any suite drops below its guardrail.
- A per-suite report is written for each dataset, plus one combined report at `rag_evals/reports/suite/suite_latest.json`.

Current project convention:

- `seed_*` is the fast inner-loop regression set.
- `expanded_*` is the broader pre-release stability set.
- The default suite config at `config/python_rag_eval_suite.json` enforces `pass_rate=1.0` and `strict_hit_at_k=1.0` on all four suites.
- The default suite config also includes `hard_recommendation` and `hard_referee` suites for negative filtering and ranking stability.
- Recommendation datasets may additionally set per-case `min_distinct_game_ids_at_k` to ensure top-k 候选池足够丰富。

## Project-Specific Adapters

- `config/python_rag_http.example.json`
  - Targets the Python RAG service directly at `http://127.0.0.1:8001/query`
  - Uses nested `where.game_id` for referee mode
- `config/python_rag_function.example.json`
  - Calls `rag.retrieval.query_documents` through `rag_evals.adapters.query_python_rag`
  - Useful when you want to evaluate without running a separate HTTP server process

Note:
- The current project uses one shared knowledge collection for both referee and recommendation retrieval, so the project-specific adapters only scope by `game_id` and do not filter by `mode`.

Both adapters support template placeholders in config:

- `$query`
- `$top_k`
- `$mode`
- `$active_game_id`
- `$case_id`
- `$category`

## How To Expand The Dataset

1. Add a new JSON line to your dataset file.
2. Keep `id` stable; this enables long-term regression tracking.
3. Add `active_game_id` for referee cases to ensure game-scoped retrieval is tested.
4. Prefer 2 to 3 keyword groups per case:
- Group A: mechanic/action term.
- Group B: condition or exception term.
5. Use category labels consistently (for category-level dashboards):
- `win_condition`
- `flow`
- `faq`
- `special_rule`

## Integration Notes

- This harness is retrieval-only and intentionally decoupled from generation quality.
- For RAG evolution, run this before and after chunking/ranking changes.
- Recommended CI gate:
  - no drop in `hit@k`
  - no drop in mean `recall@k`
  - no drop in `pass_rate` for `faq` and `special_rule`

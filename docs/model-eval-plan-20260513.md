# Model Eval Plan - 2026-05-13

## Current Production Status

- Verified on `2026-05-13 CST`.
- Production alias still points to rollback deployment:
  - `https://play-or-not-pdksw0kaf-trikkagos-projects.vercel.app`
- Direct `POST https://play-or-not-dm.vercel.app/api/chat` currently returns:
  - `model: doubao-1-5-pro-32k-250115`
  - This means the **production chat backend default model is already serving Doubao 1.5 Pro 32K**.
- This does **not** automatically prove the whole online user journey is healthy, because:
  - frontend is still the rollback version
  - recommendation / referee prompt quality and render timing still depend on the deployed frontend + service wiring

## What We Are Actually Choosing For

This product really has **two different LLM jobs**, and they should not be evaluated as if they were one task:

1. Recommendation / DM sales pitch
- Goal: fast first token, natural tone, strong persona fit, no stiffness, no template feel
- Failure mode: sounds like a database card, overthinks, slow first output, broken Markdown

2. Referee / rule ruling
- Goal: accurate, grounded, clear, low hallucination, can explain a rule in human language
- Failure mode: wrong ruling, fake certainty, raw wiki dumping, over-verbose reasoning

## Candidate Matrix

We should not brute-force every historical model. We should evaluate the **currently relevant text models** from each family.

### Doubao

- `doubao-1-5-pro-32k-250115`
  - Best current recommendation candidate in our stack
  - Already integrated
  - Measured in our local tests at about `2.2s`
- `doubao-1.5-lite-32k`
  - Fast / cheap challenger
  - Good to test for recommendation only
- `doubao-1.5-thinking-pro`
  - Reasoning candidate for referee
  - Likely slower; probably not suitable for recommendation
- `doubao-seed-2-0-mini-260428`
  - Strong reasoning candidate
  - Measured in our local tests at about `8.3s - 10.3s`
  - Too slow for recommendation by default

### DeepSeek

- `deepseek-v4-flash`
  - Best DeepSeek recommendation candidate
  - Supports thinking and non-thinking mode
- `deepseek-v4-pro`
  - Best DeepSeek referee candidate
  - Supports thinking and non-thinking mode

### GLM

- `glm-4.7-flashx`
  - Best GLM recommendation candidate
  - Should test with thinking disabled
- `glm-4.7`
  - Best balanced GLM candidate
  - Strong candidate for both recommendation and referee
- `glm-5-turbo`
  - Fast newer GLM challenger
  - Worth testing for recommendation
- `glm-5.1`
  - Flagship GLM candidate
  - Likely overkill for recommendation, but strong upper bound for referee

## My Current Prior

Before running the benchmark, my ranking is:

### Recommendation

1. `doubao-1-5-pro-32k-250115`
2. `glm-4.7-flashx`
3. `deepseek-v4-flash`
4. `glm-5-turbo`
5. `doubao-1.5-lite-32k`

Why:
- recommendation needs low latency and natural prose more than deep chain-of-thought
- your current product punishes overthinking harder than it rewards extra reasoning depth
- Doubao 1.5 Pro is already giving us much better latency than Seed in the current stack

### Referee

1. `glm-4.7`
2. `deepseek-v4-pro`
3. `doubao-seed-2-0-mini-260428`
4. `glm-5.1`
5. `doubao-1.5-thinking-pro`

Why:
- referee needs grounded explanation plus human-readable restatement
- GLM-4.7 looks especially interesting because its official positioning explicitly emphasizes more natural dialogue, stronger role consistency, and better multi-turn collaboration
- DeepSeek V4 Pro is likely a very strong accuracy / tool-use baseline
- Seed is already integrated and may remain a good fallback, but its latency is expensive
- GLM-5.1 may be strongest on paper, but it is more likely to be overkill for this product path

### If We Must Pick One Model For Everything

- First choice: `glm-4.7`
- Second choice: `deepseek-v4-pro`

### If We Allow Split Routing

- Recommendation: `doubao-1-5-pro-32k-250115`
- Referee: `glm-4.7` or `deepseek-v4-pro`

## Evaluation Architecture

We should evaluate in **two layers**:

1. Retrieval layer
- Keep using existing `rag_evals`
- Purpose: make sure candidate games / rule passages are actually retrieved

2. Generation layer
- New suite for recommendation + referee outputs
- Purpose: measure answer quality, tone, latency, and render hygiene

## Metrics

### 1. Answer Accuracy

Scoring:

- `0`: wrong / fabricated / misses the core answer
- `1`: partially correct but missing an important constraint
- `2`: correct answer with minor omissions
- `3`: fully correct and complete enough for user action

Recommendation accuracy checks:

- recommended game must be compatible with player count / duration / vibe
- must respect explicit negative preferences
- must not recommend untranslated title unless user explicitly asked for it
- must not drift to a second game in the same turn

Referee accuracy checks:

- ruling must match the expected rule answer
- must mention the decisive condition, not only a vague summary
- must not invent rulebook certainty when evidence is weak

### 2. Persona / “讲人话”

Scoring:

- `0`: robotic / wiki dump / internal jargon leak
- `1`: understandable but stiff
- `2`: mostly natural, still templated
- `3`: natural, vivid, consistent with DM persona

Automatic failure triggers:

- leaks words like `召回`, `候选池`, `参考依据`, `内部识别码`
- always uses same bullet template
- sounds like rulebook copy instead of a human explanation

### 3. Latency

Track:

- `ttfb_ms`: first visible token latency
- `total_ms`: completion latency
- `stream_gap_p95_ms`: long pauses between chunks

Targets:

- recommendation:
  - `ttfb_ms <= 2500`
  - `total_ms <= 8000`
- referee:
  - `ttfb_ms <= 3500`
  - `total_ms <= 12000`

### 4. Render Hygiene

Binary checks:

- no broken `**bold`
- no raw JSON shown to user
- no unclosed list markers
- no `[证据1]` / section labels leaked
- no mojibake / replacement chars / control chars
- Markdown should render as one clean paragraph or one short list

## Evaluation Set Design

We should start with `48` generation cases:

### Recommendation: 24 cases

- `6` player-count / duration fit
- `6` vibe / social intent fit
- `4` negative preference filtering
- `4` follow-up turn continuity
- `4` render / formatting edge cases

Examples:

1. `rec-gen-2p-date-soft`
- Input: `我们俩想约会玩一个，不想太伤感情，半小时以内`
- Expected:
  - only one game
  - should emphasize atmosphere / interaction
  - should not sound like a spec sheet

2. `rec-gen-6p-loud-party`
- Input: `6个人，想闹一点，越快热起来越好`
- Expected:
  - only one game
  - may use short bullets if needed, but only for one game
  - should sell table energy, not only quote player count

3. `rec-gen-4p-no-deduction`
- Input: `4个人，别给我阵营推理，也别太吵`
- Expected:
  - must respect negative constraint

4. `rec-gen-alt-after-reject`
- History:
  - assistant already recommended game A
  - user says `这个不想玩，换一个`
- Expected:
  - must avoid previous game
  - still only one new game

### Referee: 24 cases

- `8` direct win-condition / flow / FAQ
- `8` edge-case rulings
- `4` ambiguous evidence cases
- `4` explanation-quality cases

Examples:

1. `ref-gen-uno-plus4`
- Input: `+4能不能随便出？被质疑怎么判？`
- Expected:
  - correct ruling
  - one decisive explanation
  - no evidence labels

2. `ref-gen-avalon-five-fails`
- Input: `如果连续5次组队都没过，谁赢？`
- Expected:
  - correct winner
  - concise explanation

3. `ref-gen-unknown-edge`
- Input:
  - asks about a rule not clearly covered in KB
- Expected:
  - cautious answer
  - must not fake certainty

4. `ref-gen-humanized-flow`
- Input: `这一步到底先干嘛，别跟我背规则书`
- Expected:
  - same ruling as standard flow case
  - wording must be human

## Judge Design

We should use a hybrid judge:

1. Deterministic programmatic checks
- single-game constraint
- forbidden phrase leak
- Markdown hygiene
- latency
- untranslated title leak

2. LLM judge
- accuracy rubric
- persona / naturalness rubric
- should compare output against:
  - user query
  - active game / expected answer
  - retrieved evidence summary

3. Human blind review
- only on finalists
- score recommendation feel and referee trustworthiness

## Suggested Tournament

### Round 1: Smoke

Run `8` models on `12` cases:

- Doubao: `1.5-pro`, `1.5-lite`, `seed-2.0-mini`
- DeepSeek: `v4-flash`, `v4-pro`
- GLM: `4.7-flashx`, `4.7`, `5.1`

Filter rule:

- fail immediately if:
  - multi-game recommendation
  - obvious markdown leak
  - average `ttfb_ms` too slow

### Round 2: Full eval

Run top `4` models on full `48`-case generation set + current retrieval suite.

### Round 3: Human blind review

Take top `2` and review:

- `20` recommendation outputs
- `20` referee outputs

## Recommended Decision Rule

Use weighted score:

- accuracy: `45%`
- persona / human tone: `25%`
- latency: `20%`
- render hygiene: `10%`

And impose hard gates:

- recommendation single-game compliance: `100%`
- render hygiene pass rate: `100%`
- referee hallucination-critical failure rate: `0`

## Next Step

Best practical next step:

1. Keep online recommendation on `doubao-1-5-pro-32k-250115`
2. Benchmark referee on:
- `glm-4.7`
- `deepseek-v4-pro`
- `doubao-seed-2-0-mini-260428`
3. Build the new generation eval runner on top of existing `rag_evals` inputs


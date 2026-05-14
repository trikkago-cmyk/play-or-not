# Model Spot Check Results - 2026-05-13

## Models

- `deepseek-v3-2-251201`
- `glm-4-7-251222`
- `doubao-seed-2-0-mini-260428`
- `doubao-seed-2-0-pro-260215`

## Cases

- `rec-party`
  - `6个人，想热闹一点，30到45分钟，别太烧脑，推荐一个桌游。`
- `rec-date`
  - `我们俩约会，不想太伤感情，半小时内，想有来有回一点，推荐一个桌游。`
- `ref-uno`
  - `UNO 里 +4 能不能随便出？如果被质疑，一般怎么判？`
- `render`
  - `推荐一个适合4个人破冰的桌游，简单说亮点就行。`

All four cases used the same lightweight DM / referee system instructions and were sent through Ark Responses streaming.

## Timing Summary

### DeepSeek-V3.2

- `rec-party`
  - `ttfb_ms: 1662`
  - `total_ms: 3169`
- `rec-date`
  - `ttfb_ms: 1230`
  - `total_ms: 2297`
- `ref-uno`
  - `ttfb_ms: 1236`
  - `total_ms: 7418`
- `render`
  - `ttfb_ms: 1217`
  - `total_ms: 5026`

### GLM-4.7

- `rec-party`
  - `ttfb_ms: 33302`
  - `total_ms: 33925`
- `rec-date`
  - `ttfb_ms: 15892`
  - `total_ms: 16610`
- `ref-uno`
  - `ttfb_ms: 17478`
  - `total_ms: 22055`
- `render`
  - `ttfb_ms: 13619`
  - `total_ms: 16061`

### Doubao-Seed-2.0-mini

- `rec-party`
  - `ttfb_ms: 9253`
  - `total_ms: 10864`
- `rec-date`
  - `ttfb_ms: 6595`
  - `total_ms: 8352`
- `ref-uno`
  - `ttfb_ms: 11468`
  - `total_ms: 14356`
- `render`
  - `ttfb_ms: 11853`
  - `total_ms: 15723`

### Doubao-Seed-2.0-pro

- `rec-party`
  - `ttfb_ms: 15403`
  - `total_ms: 17320`
- `rec-date`
  - `ttfb_ms: 33311`
  - `total_ms: 34547`
- `ref-uno`
  - `ttfb_ms: 43152`
  - `total_ms: 49521`
- `render`
  - `ttfb_ms: 22101`
  - `total_ms: 25644`

## Quality Notes

### DeepSeek-V3.2

- Fastest by a large margin.
- Recommendation tone felt natural and usable.
- Stayed within single-game recommendation constraint.
- Render output was readable and mostly clean, but slightly over-decorated with emoji / marketing punctuation.
- Referee answer was generally clear and human-readable.

### GLM-4.7

- Much slower than expected for this product path.
- Recommendation style was lively, but one date-case recommendation drifted to a weak-fit pick.
- Referee answer sounded capable but introduced a subtle rule-condition risk in the detailed explanation.
- Render output was readable but more templated and heavy than ideal.

### Doubao-Seed-2.0-mini

- Recommendation writing quality was decent.
- Latency was substantially slower than DeepSeek-V3.2.
- Markdown style was slightly unstable in one recommendation output (`《**情书**》` style nesting).
- Referee answer contained a rule-direction error in the tested UNO case, so trust is not high enough.

### Doubao-Seed-2.0-pro

- Recommendation tone was strong and persuasive.
- Latency was too slow for recommendation path and borderline unacceptable for interactive UX.
- Referee answer was the most complete among the Seed pair in this small sample, but still far too slow for the live experience.

## Practical Conclusion

Based on this spot check only:

1. Best overall single model: `deepseek-v3-2-251201`
2. Best Doubao variant in quality: `doubao-seed-2-0-pro-260215`
3. Best Doubao variant in cost / speed tradeoff: `doubao-seed-2-0-mini-260428`
4. Worst fit for this product UX in current small sample: `glm-4-7-251222`, mainly because of latency

## Important Caveat

This is still a **small-sample spot check**, not the full benchmark. It is directionally useful, but not enough to settle referee accuracy on its own.


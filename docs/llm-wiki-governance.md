# LLM + Structured Wiki Governance

## Production Path

The production recommendation and referee journeys use structured local wiki retrieval, not Python RAG.

- Recommendation: identify intent, apply hard structured filters for player count/range, playtime, complexity, and age, rank compatible local candidates by intent fit, long-term preference, and popularity signals, pick exactly one game, then let DM 洛思 write the final recommendation copy.
- Referee: first decide whether the user is asking a current-game rules question; if yes, hard-lock to `active_game_id`, compile only that game's rules / FAQ / knowledge sections, and let the model answer from those internal chapters.
- Referee knowledge gaps: production defaults to local wiki plus the model's general board-game knowledge. Do not call Ark `web_search` unless `VITE_ENABLE_ARK_WEB_SEARCH=true` is explicitly enabled after the account-side plugin is activated. When no authoritative local rule covers the detail, the model must avoid fake certainty, give the best practical ruling it can support, and clearly mark any version-sensitive detail that should be checked against the physical rulebook / official FAQ.
- Python RAG, `/api/rag`, Chroma ingest, and RAG eval suites may remain as experiment, audit, and regression tooling, but they must not be required by the production recommendation or referee main path.

## User-Facing Rules

- Do not expose retrieval jargon such as `召回`, `候选池`, chunk IDs, confidence, or evidence labels.
- Recommendation output should sell one game only, so the UI can attach one card cleanly.
- Referee output should answer the question directly, then explain only the necessary rule logic in plain language.
- If structured filters produce no safe recommendation, ask the user to relax or clarify the hard condition instead of freelancing an incompatible title.

## Release Gate

Before any release branch is merged or promoted:

- Unit tests must prove recommendation and referee main paths do not call `/api/rag`.
- Recommendation tests must cover player count/range, playtime, complexity, and age as hard constraints.
- Referee tests must cover active-game hard lock and no evidence leakage.
- Referee tests must cover that paid Ark Web Search is disabled by default and only enabled behind the explicit environment flag.
- Build must pass locally before Preview deploy.

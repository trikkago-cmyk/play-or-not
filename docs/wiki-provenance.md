# Board Game Wiki Provenance

This project treats board game knowledge as a structured internal Wiki. The provenance layer is a confidence ledger for that Wiki: it records where each exported document or section came from, how fresh the evidence is, and whether it should be trusted as source-backed or queued for review.

## What The Score Means

`confidence_score` is not a claim-level truth score. It is a conservative source-coverage heuristic:

- BGA public game panels can support platform metadata, and BGA rules excerpts can support rule-like sections more strongly.
- BGG pages help identify community metadata, but they do not automatically prove every local rule summary.
- Bilibili tutorial links are useful learning evidence, but they are weaker than official or platform rule excerpts.
- Local curated/generated Wiki text stays visible, but it is marked as `reviewed` or `needs_review` unless stronger source evidence exists.

The current method is recorded as `confidence_method=wiki_source_coverage_heuristic_v1` and explained in `confidence_basis_text`.

## Statuses

- `source_backed`: strong enough source coverage exists for this export pass. Today this requires BGA public gamepanel evidence.
- `reviewed`: the Wiki section has usable structure and source hints, but has not been checked at claim level.
- `needs_review`: the Wiki section mostly depends on local curated/generated content or weaker evidence, so it should be reviewed before treating it as authoritative.
- `stale`: the section has passed its suggested review date.

## Freshness

Each row carries `verified_at`, `source_retrieved_at`, `stale_after_days`, and `stale_at`.

Recommendation sections use a shorter freshness window because popularity, teaching videos, and player-fit language drift faster. Referee sections use a longer window, but rule expansions, FAQ changes, and platform variants still need periodic review.

## Runtime Use

The app can use these fields as quality signals while still keeping the user-facing answer natural. Higher-confidence Wiki sections get a small retrieval boost; `needs_review` and `stale` content is penalized, especially in referee mode. The model should still answer in DM language and should not expose internal field names or source ledgers to users.

## Current Limitations

This first pass does not automatically verify every sentence against official rulebooks. It gives us a transparent queue: which sections are strongly source-backed, which are merely reviewed, and which need evidence repair next.

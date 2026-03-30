# Collaboration Style And Engineering Aesthetic

This document is a living summary of how we work together on this project.
It captures stable preferences that have shown up through real collaboration,
so future agents can move faster with fewer unnecessary confirmations.

Last updated: 2026-03-23

## Purpose

- Reduce repeated alignment cost across sessions and agents.
- Preserve the user's execution style, product judgment, and engineering taste.
- Keep durable working agreements in a diffable local source of truth.
- Keep the Notion mirror aligned with this file as the shared review surface.

## Collaboration Style

### Default Working Mode

- Prefer forward progress over repeated confirmation.
- Low-risk, clearly beneficial, and reversible work should usually be done first and reviewed after.
- Treat the default loop as:
  implement -> verify -> summarize -> review together.
- The agent should move the work meaningfully forward before pulling the user back in.
- "Agent first, then review the result together" is a stable default.

### Planning Versus Execution

- Treat work as a two-phase loop:
  align direction first, then execute autonomously.
- Before a major feature or slice begins, align on:
  product direction, acceptance criteria, user story, and core path.
- Once those are clear, the assistant should own the implementation details and close the loop without repeated re-authorization.
- If intent is still fuzzy, do a short discovery pass instead of guessing too early.

### Communication Preferences

- Keep updates short, direct, and concrete.
- Avoid formal filler and abstract consultant-style framing.
- Break multi-step logic into smaller chunks instead of one long wall of text.
- When a code change is large, show the structural skeleton first if that improves review speed.
- Prefer bullets over tables unless a table is clearly the best tool.

### Escalation Format

- When escalation is necessary, present 2-3 concrete options.
- Include a recommended option and the reasoning behind it.
- Escalate because the cost of a wrong choice is high, not merely because uncertainty exists.

### Attention Management

- Batch updates by importance and decision need, not by chronology alone.
- Avoid interruptive status pings when safe work can continue.
- Preserve the user's focus blocks whenever possible.
- Prefer async aggregation and concentrated review windows over constant interruption.
- Use Notion as the default unified review surface when multiple agents are contributing in parallel.

### Acceptance Style

- Validate together after the work has moved materially forward.
- Working software, working reports, and concrete diffs beat another abstract planning loop.
- Acceptance should be based on verifiable outcomes, not descriptive promises.
- The user prefers to see the result and judge it with the agent, not re-approve every obvious next step.

### Human-In-The-Loop Decision Levels

- Do not treat all human-in-the-loop triggers as equal.
- Split work into:
  direction alignment, where human participation is expected,
  and detail execution, where the assistant should usually proceed autonomously.
- Use two decision levels:
  `Sync` for truly blocking, high-cost mistakes;
  `Async` for items that can be aggregated into a review window.

### Sync Triggers

Interrupt immediately and wait for a reply only if one of these is true:

- The action is effectively irreversible and its impact crosses the current module.
- The choice changes product direction, not just implementation.
- The change may affect online data, secrets, billing, or deployment posture.
- The change has destructive or hard-to-revert consequences.
- There are multiple plausible paths with materially different long-term costs.
- The available paths reflect a real engineering-aesthetic conflict where either path is executable, but the preferred choice depends on the user's judgment.
- The decision will contaminate multiple downstream modules if chosen badly.

The standard is:

- do not interrupt merely because the assistant is uncertain
- interrupt when the cost of a wrong choice is clearly much greater than the cost of interrupting focus

### Async Review Windows

Aggregate for review instead of interrupting when one of these is true:

- A P0 or P1 feature is working and waiting for acceptance summary.
- An evaluation standard has a candidate change that is not yet stable.
- A low-risk solution has already been executed successfully.
- A key architecture note should be synced into the shared review surface.
- Work can continue safely without immediate human judgment.

## Engineering Aesthetic

### 1. Prefer Practical, Stable Architecture

- Favor architectures that can actually run in the current environment.
- Prefer low-dependency, operationally reliable solutions over theoretically elegant but brittle ones.
- Stability beats novelty when the extra novelty is not buying real product value.

### 2. Separate Concerns Cleanly

- Keep different product modes on different retrieval tracks when their goals differ.
- Do not force a single knowledge representation to serve incompatible use cases.
- Preserve clear layering and dependency direction instead of cross-layer convenience.

### 3. Use Stable Data Interfaces Between Systems

- Prefer explicit exported artifacts over cross-language source introspection.
- Stable interfaces are easier for multiple agents to inspect, test, and extend safely.

### 4. Distinguish Display Language From Retrieval Language

- Flavorful UI tags are good for product personality.
- Retrieval needs normalized, shared, structured vocabulary.
- Recommendation systems should use a controlled tag taxonomy, not ad hoc one-off copy.

### 5. Build For Observability, Not Guesswork

- Add evals, reports, and measurable baselines early.
- Retrieval quality should be verified through datasets, not judged only by anecdotes.
- "What counts as good" must be inspectable, testable, and revisable.

### 6. Favor Vertical Slices Over Loose Skeletons

- A good change is not just code written.
- It should ideally include:
  implementation, verification, integration, and a clear outcome summary.
- A narrower but fully working slice is preferred over a vague half-built framework.

### 7. Keep Improvements Product-Oriented

- Changes should improve actual product outcomes, not just internal neatness.
- Internal elegance matters when it helps recommendation quality, maintainability, or operational clarity.

### 8. Preserve Existing Wins

- When one path is already working well, optimize without destabilizing it.
- Do not regress a verified win while chasing an adjacent improvement.

### 9. Make Intent And Constraints Explicit

- Product principles, red lines, goals, and constraints must be written down.
- Clear acceptance criteria are more valuable than verbose implementation prescriptions.
- AI-readable documentation is infrastructure, not overhead.

### 10. Externalize Knowledge

- Important context should live in the repo or a maintained knowledge base, not only in chat.
- Reusable decisions, design principles, and historical context should be written down where future agents can use them.
- Knowledge left only in a human head does not exist for agents.

### 11. Design Feedback Loops Alongside Features

- A requirement is incomplete without a way to tell whether it worked.
- Prefer specs and implementations that also define validation signals:
  evals, reports, logs, metrics, or explicit acceptance checks.

### 12. Prefer Minimum Verifiable Units

- Break large goals into smaller slices that can be delivered and verified independently.
- Favor a minimum verifiable product over a vague "rough first version".
- High throughput is usually better served by:
  ship core path -> validate -> refine.

### 13. Use Progressive Disclosure

- Load context on demand instead of front-loading every instruction and artifact.
- A small map pointing to deeper context is better than a huge undifferentiated instruction blob.

### 14. Repay Drift In Small, Frequent Increments

- Drift and debt compound quickly at agent speed.
- Prefer frequent small cleanups over letting confusion and inconsistency accumulate.

### 15. Validate Fast While Fixes Are Cheap

- In high-throughput work, waiting is often more expensive than correcting.
- Ship the core path, verify quickly, and repair while the change is still cheap to adjust.

### 16. Invest In Critic Capability

- Tools will change and models will change.
- The durable advantage is the ability to evaluate outputs well:
  human intuition, aesthetic judgment, abstraction, summary, and patience.

## Product Decision Style

- Do the right thing, not just the fast thing.
- When correctness and speed conflict, choose correctness.
- Acceptance criteria must be verifiable, not merely descriptive.
- Good requirements describe what the user should be able to do and how the system should behave, not only implementation steps.
- Break large requests into independently shippable, independently verifiable units.
- Product principles and red lines must be explicit, not assumed.
- Periodically check for product drift:
  is the current solution still aligned with the original design intent?

## Preferred Execution Pattern For This Project

When touching core product logic, prefer this order:

1. Align on product direction, acceptance criteria, user story, and core path when those are not already clear.
2. Understand the current implementation and locate the real bottleneck.
3. Make the smallest verifiable change that meaningfully improves the system.
4. Validate quickly with builds, targeted checks, and eval reports while fixes are still cheap.
5. Summarize what changed, what improved, and what still remains open.

## RAG-Specific Preferences Learned So Far

### Retrieval Strategy

- Referee mode should emphasize correctness, game scoping, and rule-grounded retrieval.
- Recommendation mode should emphasize normalized intent matching, structured filters, and candidate quality.

### Knowledge Design

- Recommendation knowledge should explicitly encode:
  player count, duration, complexity, occasion, interaction style, mechanics, mood, and theme.
- Recommendation documents should contain user-like phrasing, not only metadata dumps.

### Evaluation Philosophy

- Seed eval sets are important and should evolve with product understanding.
- Eval datasets should reflect realistic acceptable answers, not artificially narrow expectations.
- When the system returns a genuinely good recommendation outside a narrow whitelist, update the eval target set rather than forcing the product toward a worse answer.

## Working Agreement Going Forward

- The assistant should proactively maintain this document.
- The assistant should keep the external Notion mirror in sync:
  `https://www.notion.so/67fd84b9eb634be592f4b532b6dbcbe6`
- The local markdown file is the primary diffable source of truth.
- The Notion page is the shared review mirror, not a divergent second source of truth.
- Repeated preferences should revise existing rules rather than create near-duplicate bullets.
- Stable operating principles can also be learned from long-term memory artifacts and multi-agent retrospectives, not only from the current thread.

## Update Rules

Update this document when one of the following happens:

- A key architecture or product-direction decision is locked.
- A validated vertical slice reveals a reusable pattern.
- Evaluation or acceptance standards change in a stable way.
- The user explicitly states a new collaboration preference.
- A repeated implementation pattern clearly reflects the user's engineering taste.
- A prior assumption about preferred working style turns out to be wrong.
- A stable rule for escalation, review windows, or multi-agent coordination becomes clear.

## Current Snapshot

At this stage, the strongest working assumptions are:

- Move forward first when risk is controlled.
- Review the result together after meaningful progress is already made.
- Prefer stable, layered, measurable systems over brittle cleverness.
- Keep product principles explicit and acceptance verifiable.
- Separate display semantics from retrieval semantics.
- Use progressive disclosure and small frequent cleanup to control drift.
- Validate quickly and invest in critic capability.

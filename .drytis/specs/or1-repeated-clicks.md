# OR-1 Correction — repeated same-target clicks

## Problem (from A-Slice re-audit 2026-08-19)

Two deliberate clicks on `#add1` (3.5s apart, counter 1 → 2) were merged into ONE
IR step by OR-1 (`applyReadabilityRules`), carrying only the LAST state's assertions
("2 items"). Replay performs ONE click → counter reaches 1 → the soft textMatch
"2 items" and COUNT `#cart-items > * == 2` fail HONESTLY but PERMANENTLY. The plan
asserts a state its own action list cannot reach.

History: OR-1 was originally "focus+click on the same element" (Phase 8.2), reworded
to "click + click … single user action" (Phase 1.3, no timing guard implemented),
and given the freshest-assertion carryover in Phase 4c to paper over stale assertions.
Spec B7.1 §4.4 (Rule OR-3) marks duplicate-click merging PROVISIONAL, requires
"extreme caution", and says "when in doubt, keep both steps".

Also latent: the loop `i += 2` is PAIRWISE — three clicks → two steps (1+2 merged,
3 alone), four → two. Not a true run collapse.

## Decision

OR-1 merges only GENUINELY REDUNDANT duplicate clicks:

- Merge consecutive same-element CLICK steps ONLY when the second step carries
  NO new resulting-state assertions (assertions empty). This is the structurally
  provable duplicate case (double-fire / focus+click residue) — the merge loses
  nothing because the second click asserts nothing new.
- When the second click HAS resulting-state assertions (distinct observed state),
  the clicks are DISTINCT user actions → keep BOTH steps, each with its own
  `sourceEventId`, `id`, and assertions.
- Run-length correct: collapse maximal runs of no-new-state duplicates
  (a, a*, a* …), not fixed pairs. A run [stateful, stateless, stateful] stays
  three steps; [stateful, stateless, stateless] stays two.
- Different elements: never merged (existing guard, unchanged).
- Focus+click dedup preserved: a no-assertion second click still merges into
  the first (that's exactly the empty-assertions case).

## Guard predicate

```ts
const isRedundantDuplicate = (next: IRStep): boolean =>
  next.assertions.length === 0; // no new resulting state to preserve
```

While the following `next` is a redundant duplicate, skip it; otherwise keep it.

## Files

- `src/generation/ir-bridge.ts` — applyReadabilityRules only.
- `tests/generation/ir-bridge-repeated-clicks.test.ts` — new regression file.

## Acceptance criteria

- [ ] Two same-element clicks with DIFFERENT resulting-state assertions → 2 steps,
      each keeping its own sourceEventId + assertions; ids renumbered 0,1.
- [ ] Two same-element clicks, second WITHOUT assertions → 1 step (dedup preserved),
      keeping the FIRST step's identity.
- [ ] Three same-element clicks (stateful, stateless, stateful) → 3 steps.
- [ ] Three same-element clicks (stateful, stateless, stateless) → 2 steps.
- [ ] Consecutive clicks on different elements → 2 steps (regression guard).
- [ ] Focus+click residue (second click no assertions) still merges.
- [ ] Full suite green; real-Chrome re-audit: 2 recorded ATC clicks → 2 IR steps,
      replay 2 clicks, counter reaches 2, "2 items" textMatch + COUNT 2 PASS.

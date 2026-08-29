# Defect 1 + 2a + 2c — Replay Wait Wiring, Alternate Test-ID Semantic Coverage, Entity Identity-Attribute Locator Priority

**Date:** 2026-08-20 · **Branch:** `capability-surgical-removal` (base `dc63957`)
**Source evidence:** `.drytis/notes/adanione-clone-audit-2026-08-20.md` (real-Chrome audit of an
AdaniOne-class clone, 19 PASS / 3 FAIL at `1703e43`+uncommitted)
**Scope decision (user-approved):** implement Defect 1 + 2a + 2c, with a **10-second content-script
wait cap**. **2b is OUT OF SCOPE — the id-less counter locator policy is NOT loosened.** No timing
rule is reintroduced into OR-1.

## Background

The AdaniOne-clone audit exposed:

1. **Defect 1 (execution):** replay resolves elements single-shot
   (`ir-executor-impl.ts` RESOLVE_LOCATOR / content-script `EXECUTE_STEP` inline resolve).
   `resolveElementWithWait()` in `locator-resolver.ts:326` is dead code on the execution path.
   Late-rendered SPA elements (widget injection +700ms, debounced options, skeleton swaps)
   fail replay with ElementNotFound. 7 of 8 replay failures = this single cause.
2. **Defect 2 (understanding/generation):**
   - **2a:** `DEFAULT_SEMANTIC_SELECTORS` covers `data-testid`-style conventions only. Sites using
     `data-auto-id` (AdaniOne's own convention) or `data-test-id` produce zero semantic
     counters/collections/entities → nothing derivable.
   - **2c:** entity presence assertions derive an ancestor `#id` (e.g. `div#cart-root`) from the
     domPath instead of the entity's own identity attribute (`[data-sku="F1"]`) — a vacuous
     target for the exact entity the interaction produced.

## Root-cause notes (verified in this session, jsdom experiment)

- Old entity entry `[data-product-id], [data-item-id], [data-sku]` uses `idAttribute:
  'data-product-id'`; on the clone cart rows (`data-auto-id` + `data-sku`, no `data-product-id`)
  it captures with `entityId: null`. The new co-occurrence entry captures the SAME element with
  `entityId: "F1"`. Observer dedup keys differ (`path` vs `entity:F1`) → **duplicate entity items**;
  the null-entityId one still derives the vacuous `#cart-root` presence. 2c must therefore ALSO
  hold at derivation time: a null-identity entity whose attributes carry an identity-attribute
  value is a duplicate of the identity-keyed one, and must not win a locator.
- `getElementPath` (tap/dom-observer) includes every ancestor id → `idFromDomPath` on
  `body > main#app-root > div#cart-root > div` yields `cart-root` (ancestor), never the row's own
  identity. Ancestor `#id` is NOT the entity's coordinate.
- `identityAttributeSelector` requires `item.entityId`; entities captured by an entry with a
  different `idAttribute` (entityId=null) never recover their own `[data-sku="X"]` attribute.

## Files to change

| File | Change |
|---|---|
| `src/execution/executor-content-script.ts` | (already on disk, uncommitted) inline `resolveWithWait()` capped 10s; `EXECUTE_STEP` uses it with `executionParameters.timeoutMs`; `RESOLVE_LOCATOR` accepts optional `timeoutMs` |
| `src/execution/ir-executor-impl.ts` | (already on disk, uncommitted) pass `timeoutMs` on both RESOLVE_LOCATOR sends |
| `src/generation/assertion-derivation.ts` | entity branch first: own identity attribute → `[data-sku="X"]`, else ancestor `#id`, else skip |
| ` branch of decideLocator | entity identity-key grouping: drop duplicates whose identity attribute equals another item's, so the null-identity double-capture never emits |
| `src/understanding/page-content/page-content-config.ts` | (already on disk, uncommitted) counter/collection/entity entries for `data-auto-id` / `data-test-id` / `data-test` with value-bearing co-occurrence guard for entities |

## Acceptance criteria

### Defect 1 — replay wait
- [ ] `RESOLVE_LOCATOR` without `timeoutMs` → single-shot, immediate not-found (legacy contract; pinned by unit test).
- [ ] `RESOLVE_LOCATOR` with `timeoutMs>0` → polls ≤100ms interval until found or cap; element appearing at 300ms resolves found at ~300ms (unit test; real timers with a controllable performance clock — rationale in the test header).
- [ ] Wait is capped at **10s** regardless of `timeoutMs` (unit test).
- [ ] `EXECUTE_STEP` honors `executionParameters.timeoutMs` for its inline resolve (unit test).
- [ ] `EXECUTE_STEP` without `timeoutMs` fails fast when element absent (unchanged) (unit test).
- [ ] Executor passes `step.executionParameters.timeoutMs ?? 0` on both RESOLVE_LOCATOR sends (unit test: fake sendTabMessage asserts `timeoutMs` present).
- [ ] `waitStrategy:'none'` steps never wait: content script maps it to single-shot (`timeoutMs→0` effective) — pinned by unit test.
- [ ] AdaniOne-clone replay: steps whose targets render late pass instead of ElementNotFound.

### Defect 2a — alternate test-ID capture
- [ ] Counter `span[data-auto-id="cart-count"]` (no id) IS captured (kind=counter, numericValue).
- [ ] Collection `[data-auto-id*="results"]`-style container captured (kind=collection).
- [ ] Entity `[data-auto-id][data-sku]` captured with `entityId` from `data-sku` (co-occurrence guard).
- [ ] Decorative-only `data-auto-id` (no value-bearing identity attr) is NOT classified as entity (noise guard).
- [ ] `data-test-id` / `data-test` variants covered by the same entries (selector includes them).
- [ ] a-slice replica DOM (`data-testid` conventions, ids on counter/collections) produces IDENTICAL items/assertions as before (regression pin).

### Defect 2c — entity locator priority
- [ ] Entity item with own identity attribute derives `[data-sku="F1"]` even when an ancestor has `#id` (unit test: clone cart row under `div#cart-root`).
- [ ] Null-identity duplicate (same identity VALUE as another item) never emits an assertion (dedup by identity value at derivation).
- [ ] Entity with NO identity attribute and NO ancestor id → skipped (no fragile locator) — unchanged.
- [ ] Entity with no identity attr but ancestor #id → still `#id` (behavior preserved for pre-2a sites; tier 'id').
- [ ] OR-1 repeated qty-plus clicks: each keeps its own entity presence assertion on its own sourceEventId — unchanged semantics, separate steps (regression pin).

### 2b — explicitly held (pins)
- [ ] Id-less counter (`cart-count`/`cart-total` spans, no id, no ancestor id) → NO assertion derived (locator policy unchanged; capture improves, derivation policy held).
- [ ] Id-less counter with ancestor `#id` → counter textMatch still targets `#ancestor-id` — policy unchanged (pin).
- [ ] No counter assertion ever uses a `[data-auto-id]`-attribute locator — 2b not loosened (pin).

### Build + gates
- [ ] `npm run build` succeeds; `dist/src/execution/executor-content-script.js` emitted and contains `resolveWithWait`-equivalent poll code.
- [ ] Full `vitest run` green.
- [ ] **Gate 1 — AdaniOne clone re-audit (real Chrome):** all previously-passing checks stay PASS; the 3 baseline FAILs resolve as: entity assertions target `[data-sku=...]` (2c), counters captured at capture-level (2a), soft assertions evaluated ≥3 incl. entity presences on their steps (wait wiring). Re-anchored checks live in the gate harness (`.drytis/notes/evidence/defect1-2a-2c-gates/adanione-clone/harness-gate.mjs`) and the two counter checks are re-anchored to capture-level (2b held → no step assertion derives for id-less counters). Steps 7/8 replay outcomes are the documented inter-step pacing gap (NEW out-of-scope defect, see `.drytis/notes/defect1-2a-2c-validation-record.md`) — pinned by the harness as "qty steps exercised the 10s wait".
- [ ] **Gate 2 — a-slice regression (real Chrome):** 35 PASS / 0 FAIL unchanged (run6 baseline).

## Out of scope
- 2b (any loosening of id-less counter locator policy)
- OR-1 timing rules (structurally fixed; separate steps with distinct assertions)
- EXTRACT_DOM_CONTEXT substring matching improvements (healing hint exact-match limitation)
- EVALUATE_ASSERTIONS single-shot resolution (assertion targets resolve post-action; late-appearing assertion targets remain a known, separate limitation)

## Tests

- `tests/execution/executor-resolve-wait.test.ts` (on disk — extend with waitStrategy:'none' + cap + executor timeoutMs pass-through)
- `tests/generation/assertion-derivation-alt-testid.test.ts` (NEW — 2a/2c + pins)
- `tests/understanding/page-content-alt-testid.test.ts` (NEW — capture-level via real observer)
- Real-Chrome gates via CDP harnesses (existing technique, `.drytis/notes/real-chrome-cdp-validation-technique.md`)

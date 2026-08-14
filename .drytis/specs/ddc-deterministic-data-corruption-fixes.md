# Deterministic Data-Corruption Fixes (DDC-1 … DDC-8)

**Parent context:** Post-audit follow-up to Network Evidence Hardening (c2a3b1e).
The M9 pipeline must not persist corrupted or fabricated Application Understanding
data. Eight deterministic issues identified. Classification done BEFORE code
changes (required by user).

## Classification (decided before implementation)

| # | Issue | Class |
|---|-------|-------|
| 1 | PerformanceObserver duplication + fabricated status 200 | **Must fix now** — double votes + synthetic success corrupt outcomes table |
| 2 | Synthetic nav `fromUrl: ''` | **Must fix now** — view-transition graph broken for full-reload apps |
| 3 | Click→network→outcome attribution lost on reload | **Must fix now** — the causal link "user action → app consequence" |
| 4 | `priorRecordedWorkflows` always `[]` | **Must fix now** — M9.7 cross-session capability inert in production |
| 5 | Silent truncation signals unread | **Must fix now (scoped)** — `mainThreadBlocked`/`domChangeOverflow`/`coarseMode` must downgrade confidence + suppress outcome fabrication; full delayed-evidence re-collection deferred |
| 6 | Target-state gaps | **Must fix now (scoped)** — checked / ariaExpanded / ariaChecked / ariaPressed / selectedValues / controlledValue; scrollTop/scrollLeft deferred (low signal) |
| 7 | GraphQL `operationName` | **Must fix now** — bodies already captured; parsing is deterministic |
| 8 | Unconditional +0.1 success fallback | **Must fix now** — fabricates success with zero evidence |

**Deferred (not corruption):** visibilityChanges extractor, scroll-position
diffing, delayed-evidence re-collection, 5s recovery lookback tuning.
**AI/architectural (out of scope):** response-body capture, entity identity
resolution, multi-entity attribution, text semantics, novel-domain generalization.

## Changes

### DDC-1 — PerformanceObserver dedup + real status
`public/assets/network-inject.js`:
- PO entries dispatch with explicit `source: 'performance-observer'` … but the
  CustomEvent detail cannot carry arbitrary fields? — **Decision:** dispatch
  stays `resourceType: 'navigation'|'resource'`; the ISOLATED-world bridge
  treats any main-world entry whose `resourceType` is `navigation`/`resource`
  as PO-sourced and routes it through a **cross-channel dedup**: a PO entry is
  dropped when a fetch/XHR patch entry (resourceType `fetch`/`xhr`/`unknown`,
  source main-world) with same URL exists within DEDUP_WINDOW_MS (method NOT
  compared — PO cannot read method).
- Fabricated status: PO entries never carry a status → `status: null`. No more
  synthetic 200s. (PO evidence then yields `succeeded: null` → no outcome vote
  from status, only URL-classified operation.)
- Bridge: add `source: 'performance-observer'` to TimestampedNetworkActivity
  (union) and extend `deduplicate()` to drop PO dupes of fetch/xhr.

### DDC-2 — Synthetic nav `fromUrl`
`src/background/service-worker.ts`:
- Module-level `lastCommittedUrls = new Map<number, string>()` (tabId → URL),
  updated on every `webNavigation.onCommitted` BEFORE synthetic evidence is
  created. `attachSyntheticNavEvidence` uses the PREVIOUS committed URL
  (captured before overwrite) as `fromUrl`.
- ring buffer + map are memory-bounded (e.g. 50 tabs, shift-evict).

### DDC-3 — Click→outcome attribution on reload
`src/background/service-worker.ts` `recoverNetworkForNavigation`:
- Extend lookback to 10s (matches ring buffer TTL).
- Recovered entries are attached ONLY to the synthetic nav (guaranteed path).
- The **preceding click interaction** gets the outcome vote via the pipeline:
  `UnderstandingPipeline.run()` Stage 3 (outcome determination) receives, per
  interaction, an optional `forwardedEvidence` field on the OutcomeDeterminer
  input? — **Decision:** deterministic post-pass in the pipeline: after Stage 3,
  for each synthetic-navigation interaction whose signals include an
  `api-operation` with `source: 'webrequest'` (i.e. recovered) AND a form-submit
  click exists within the prior 10s with no apiOperations of its own, re-run
  `determine()` for the click with the recovered api-ops merged in. Replaces
  the click's `incomplete` outcome (if its votes are empty) with a properly
  evidenced one. Bounded: nearest preceding click within 10s, ≤3 recovered ops.

### DDC-4 — Cross-session recorded workflows
- `knowledge-types.ts`: add `KnowledgeRecordedWorkflowRow` (10th table).
- `knowledge-database.ts`: version(2).stores adds `knowledgeRecordedWorkflows`
  (additive migration — new table only; V1 users upgrade cleanly).
- `knowledge-repository.ts`: `upsertRecordedWorkflow` (merge by patternId:
  union sessionIds, max occurrenceCount, union instances, keep newer label/steps),
  `getRecordedWorkflows(appId)`.
- `knowledge-persistence-service.ts`: `persistRecordedWorkflows` (called in
  persist()) — persists ALL patterns (occurrenceCount≥1), not just recurring.
- Pipeline Stage 6: `enrichSemantically` now receives
  `priorRecordedWorkflows` loaded from repo via loader, and merges.
- `knowledge-loader.ts`: load rows → RecordedWorkflow[] passed through to
  enrichment input as `priorRecordedWorkflows`.

### DDC-5 — Truncation signals wired
`behavioral-evidence-types.ts` NetworkActivity unchanged. In
`outcome-determiner.ts`:
- `collectVotes` reads `input.transition` … transition has no perf data.
  **Decision:** extend `OutcomeDeterminerInput` with optional
  `performanceCondition` (read from the interaction's behavioral evidence by
  the pipeline) + `domChangeOverflow` + `coarseMode`. When
  `mainThreadBlocked === true` or `domChangeChangeOverflow > 0` or coarseMode:
  - outcome confidence multiplied by 0.5 (downgrade) — recorded in evidence detail.
  - the +0.1 fallback (DDC-8) is suppressed.
`state-builder.ts` processSignals: when perf degradation present, append a
change `evidence-degraded: main-thread-blocked` etc. so the transition record
carries the marker into persistence (stateTransitions.changes).

### DDC-6 — Target-state gap fixes
`target-state-signals.ts`: diff `checked`, `ariaExpanded`, `ariaChecked`,
`ariaPressed`, `selectedValues`, `controlledValue`. Produce a new
`ControlStateChangeSignal` (`type: 'control-state-change'`) with
`property` (checked|expanded|checked-aria|pressed|selection|controlled-value),
oldValue/newValue (string form), elementLabel. Coordinator routes it into a new
`controlStateChanges: ControlStateChangeSignal[]` SignalSet bucket.
`state-builder.ts`: process control-state changes → changes[] entries +
attribute update on the entity derived from the same interaction's form-field
entity (typed per property, e.g. `state: <field> → checked`). Keep it evidence-
based: record change + update entity attribute; no lifecycle semantics beyond
what EntityStateTracker already does via notifications/badges.

### DDC-7 — GraphQL operationName
`network-signals.ts`:
- If requestBody exists and contains a `query`/`operations` field whose string
  starts with `mutation|query` (or JSON `{"query": ...}`), extract the top-level
  operation name via regex `/\b(?:mutation|query)\s+([A-Za-z0-9_]+)/` (first
  match) or `operationName` field. Use as the classified operation (string
  label, e.g. `graphql:AddToCart`); confidence 0.8. Falls back to existing
  URL classification. Entity hints still extracted from body fields.
- Also accept `application/json` raw body string in `requestBody.__raw` if
  provided by webRequest raw data (best-effort).

### DDC-8 — Remove +0.1 success fallback
`outcome-determiner.ts` lines ~295-313: delete the fallback vote block.
`categorize()`: votes.length===0 && stateChanges.length>0 → **`incomplete`**
(indeterminate), not success. `computeConfidence`: incomplete → 0.

### Tests
`tests/understanding/ddc-fixes.test.ts` (+ extend network-evidence-hardening
tests where relevant):
1. PO-vs-fetch/XHR dedup (same URL, PO dropped) — bridge test.
2. PO navigation entry (no fetch twin) survives.
3. PO status is null, never 200.
4. Synthetic nav fromUrl = previous committed URL (SW test with mocked
   webNavigation details).
5. Reload attribution: click int-19 (no api ops) + synthetic nav int-20 with
   recovered add-to-cart op → click outcome becomes evidenced success
   (api vote), nav interaction keeps its own outcome.
6. Recorded workflows persisted across two pipeline runs (fake-indexeddb),
   recurring pattern after 2 identical sessions, occurrenceCount=2.
7. Entity states via control-state change (checkbox toggle → entity attribute
   + transition change string).
8. GraphQL: body `{query: "mutation AddToCart($asin:String!){...}"}` → operation
   `graphql:AddToCart`, entity hints still extracted (ASIN in variables —
   extract from `variables` JSON string if present).
9. No-evidence interaction → outcome incomplete / confidence 0 (fallback gone).
10. Degraded window (mainThreadBlocked) → confidence halved + no fabrication.

## Acceptance criteria

- [ ] vitest: all new tests green; full regression green.
- [ ] TSC 0 errors; clean build; ZIP rebuilt.
- [ ] No M1–M8 file modified (only additive).
- [ ] Amazon scenario: int-19 click gets evidenced success via recovered POST;
      view-transition edge product-detail→cart-confirmation now recorded.
- [ ] SPA scenario: fetch/XHR captured once (PO dupe dropped), status from real
      fetch/XHR channel only.
- [ ] Traditional form-submit app: view graph edges present across reloads.
- [ ] GraphQL app: operations classified via operationName, entity hints work.
- [ ] priorRecordedWorkflows non-empty after ≥2 sessions.
- [ ] No fabricated success with zero evidence anywhere.

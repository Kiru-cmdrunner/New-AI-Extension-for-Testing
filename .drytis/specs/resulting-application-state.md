# Resulting Application State — capture what the app became after an action

**Status: PROPOSED — awaiting approval. No implementation.**

Source investigation: Architecture Investigation — Resulting Application State
(2026-08-19, read-only) + consequence-settling design (2026-08-18, implemented).
Grounded in verified file reads of `page-content-observer.ts`, `page-content-config.ts`,
`page-content-types.ts`, `page-content-signals.ts`, `page-content-evidence-extractor.ts`,
`state-builder.ts` / `types.ts`, `evidence-collector.ts`, `sw-integration.ts`,
`behavioral-evidence-types.ts`.

---

## 0. Product goal

For each recorded action, capture **the resulting application state** as the user
experiences it — rendered content of the affected region, read once after the
action's consequence has settled:

- Add to Cart → cart contents + absolute count
- Save/Edit/Update → resulting record state
- Delete → remaining list/result set
- Form submission → confirmation/record state
- Search/filter → result set as delivered
- Login/logout → authenticated UI state
- Approve/reject/publish/checkout → post-action record/list/status

Evidence tiers (decision, carried from the investigation):

1. **DOM/application evidence first** — sufficient for ~90% of UI workflows.
2. **API evidence complementary** — request bodies + status codes already
   captured; response bodies stay deferred (breaks the `payload-unrecorded`
   invariant; separate product decision).
3. **No database connection during recording.** DB is a test-time
   verification oracle, fed later from recorded entity ids/attributes.

## 0.1 Inviolable constraints (inherited)

- **INV-CS1** Click and Navigation remain SEPARATE interactions. Each window's
  scan attaches to that window's OWN evidence. No cross-window merge.
- **INV-CS2** Vivo page-reload behavior stays byte-identical: the
  `isUnloading` (settleDelay 0) path never scans; the destination page is
  scanned by the post-nav window's own close, never by the click window.
- **INV-CS3** No fixed post-action timeout. Scan fires at consequence
  settlement (`consequence-settled`) / post-nav stabilization — the
  quiescence model, not a new delay.
- **INV-GEN4** Generic selectors only: roles, aria, testid, data-attribute
  patterns. No product-specific selectors (5a/5b rule).
- **INV-CS4** All data bounded: 50 items, 200 chars, 30 attributes per item —
  M9.4 bounds reused, no new unbounded fields.
- **INV-CS5** `sw-integration.ts` attach semantics unchanged in behavior: the
  network-supplement shape guard stays correct; richness scoring unchanged.
- **INV-CS6** Existing extractors (CounterSignal, ListSignal, Notifications)
  are NOT modified. Double-recording is prevented by the existing
  `counterPaths` / `collectionPaths` skip-guard in `StateBuilder.processPageContent`.

---

## 1. What already exists (verified)

| Piece | File | State |
|---|---|---|
| Bounded semantic scanner | `src/understanding/page-content/page-content-observer.ts` | Complete, **zero production call sites** (all `.scan(` calls are tests) |
| Selector registry | `src/understanding/page-content/page-content-config.ts` | 13 generic selectors in 5 groups; `registerDomainSelectors` for future packs |
| Snapshot/signal types | `src/understanding/page-content/page-content-types.ts` | `PageContentSnapshot`, `ObservedItem`, `PageContentSignal`, `SemanticSelector` |
| Snapshot→signal conversion | `src/understanding/page-content/page-content-signals.ts` | `extractFromSnapshot`, `mergePageContentSignal` — also unwired |
| Evidence-derived stand-in (D2) | `src/understanding/signal-extractors/page-content-evidence-extractor.ts` | **Only live page-content producer**; reads `newSurfaces[]` only |
| StateBuilder consumption | `src/understanding/state-builder/state-builder.ts` `processPageContent` L411 | Fully implemented incl. dedup guards; fed today only by D2's surface-derived items |
| Outcome voting | `src/understanding/outcome/outcome-determiner.ts` | `pageContentEntity .15 / pageContentCounter .2 / pageContentNotification .2` weights already wired |
| Consequence settling | `src/tap/evidence-collector.ts` settle branch L604–624 | Implemented: `enterSettleMode` → quiescence + causal-network-idle → `closeWindow` delivers once with `'consequence-settled'` |
| Post-nav destination window | `openPostNavWindow` L527 + INV-C2 guard L1299 | Implemented; closes via its own AdaptiveWindow stabilization / 3s cap |
| Persistence | Dexie `behavioralEvidence`, `cmdrunner_knowledge` | Object stores carry whole objects; additive optional fields need no schema bump |

**The single structural gap:** the scanner exists, is tested, is consumed
downstream — and is never invoked. We photograph the target element; we never
photograph the resulting page.

## 2. What is missing

1. A production **invocation point** for `PageContentObserver.scan()` — none exists.
2. A **browser `DOMAdapter`** implementation (only test mocks exist).
3. A **wire format** for the snapshot inside `ApplicationEvidence` (the
   understanding-side type must not be imported by `src/shared`).
4. **D2 extraction** currently ignores everything except `newSurfaces` — no
   path for a settled full-page snapshot's items.
5. **Provenance**: `EntitySource` lacks an "observed from rendered content" kind.
6. Consumers: generation `deriveAssertions()` still returns `[]` (Track 3);
   sidepanel renders nothing for page content; contract read-side surfacing.

## 3. Design

### 3.1 Wire type (new file `src/shared/page-content-wire.ts`)

Structural duplicates of `ObservedItem` / `PageContentSnapshot` with **no
imports** from `src/understanding` (keeps `shared` import-clean — verified
`shared` never imports `understanding` today):

```ts
export interface WireObservedItem {
  kind: 'counter' | 'notification' | 'collection' | 'entity' | 'status-badge' | 'entity-title';
  matchedSelector: string;
  text: string;                 // ≤200 chars (M9.4 bound)
  numericValue: number | null;
  entityId: string | null;
  entityType: string | null;
  domPath: string;
  attributes: Record<string, string>;  // ≤30 entries
  visible: boolean;
}
export interface WirePageContentSnapshot {
  url: string;
  viewId: string | null;
  items: WireObservedItem[];    // ≤50
  itemsOverflow: number;
  scannedAt: number;            // performance.now() at scan start
  scanDurationMs: number;
}
```

`ApplicationEvidence` gains ONE optional field (backward-compatible everywhere):

```ts
/** M-RES: semantic snapshot of the rendered page content at window close
 *  (consequence settlement / post-nav stabilization). Null when the window
 *  produced no semantic items. INV-CS1: belongs to THIS window only. */
resultingState?: WirePageContentSnapshot | null;
```

### 3.2 Browser DOM adapter (new file `src/tap/page-content-dom-adapter.ts`)

Implements the observer's `DOMAdapter` over the live `Document`:

- `querySelectorAll/querySelector` → `document.querySelectorAll(...)` (the
  observer already try/catches invalid selectors).
- `isVisible()` → shared visibility check consistent with `dom-observer.ts`
  semantics (`getBoundingClientRect` + computed `display/visibility/opacity` +
  `hidden`), implemented locally to avoid coupling.
- **`getPath()` MUST reuse `dom-observer.ts`'s `getElementPath`** (export it —
  currently a module-private function at L154). This is the load-bearing
  detail: `processPageContent`'s double-record guard skips items whose
  `domPath` is in `counterPaths`/`collectionPaths`, and those sets come from
  `domChanges[].targetPath` / `listChanges[].containerPath` built by
  `getElementPath`. Same path function ⇒ the guard works; a different path
  algorithm ⇒ double-recorded counters (the exact D2 bug class).

### 3.3 EvidenceCollector integration (`src/tap/evidence-collector.ts`)

- Constructor gains optional dependency (default: lazily constructed in
  `start()` when `document` exists; `undefined` in unit tests → no scan,
  current behavior):
  ```ts
  private pageContentObserver?: PageContentObserver;
  ```
- New private method, runs at most once per window:
  ```ts
  private captureResultingState(state: ObservationWindowState):
      WirePageContentSnapshot | null
  ```
  - Skips when: observer absent, `!this.isRunning`, window already scanned
    (`state.resultingStateScanned` flag), or scan throws (try/catch → null).
  - Runs `scan(null)`; converts `PageContentSnapshot` → wire shape (pure
    field copy — structurally identical); records `scanDurationMs` (already
    produced by the observer).
- **Hook point A — Click windows:** in the `closeWindow` settle branch
  (L604–624), after `enrichFromMetadata`, before `buildAndDeliverEvidence`:
  ```ts
  evidence.applicationEvidence.resultingState = this.captureResultingState(state);
  ```
  Pass through to `buildAndDeliverEvidence` via a new optional param that
  defaults to `undefined` (callers that don't pass it are unchanged).
- **Hook point B — post-nav windows:** in the regular `closeWindow` delivery
  path, gated `if (state.isPostNavWindow)`. This IS the "destination page
  scan at pageshow" — the post-nav window lives on the destination document
  and closes there; no extra `pageshow` listener needed. Non-post-nav
  companion windows that close through this path do NOT scan (keeps Click
  evidence single-scanned; INV-CS1).
- **Never scans:** `executeFinalization` / `finalizeWithoutWindow` /
  `isUnloading` path (INV-CS2 — page is dying; Vivo shape unchanged),
  `closeWindowSilently`, G3 late-network supplements (targetless by design).

### 3.4 D2 extractor merge (`page-content-evidence-extractor.ts`)

`deriveObservedItems` gains a second source: `applicationEvidence.resultingState?.items`
(converted wire→`ObservedItem`, structurally identical). Merge rules:

- Read `newSurfaces[]` exactly as today (unchanged rules: aria status/alert/log
  → status-badge; BADGE/COUNTER tags → counter).
- Add snapshot items (richer kinds: entity/collection/notification/counter/status-badge).
- **Dedup key `kind + ':' + domPath`**, snapshot item wins on collision
  (richer: carries entityId/entityType/attributes); surface-derived item kept
  otherwise. Synthetic snapshot metadata (url/scannedAt) now taken from the
  real snapshot when present.
- Header comment updated: domChanges still NOT read (CounterSignal/ListSignal
  own those; unchanged).

### 3.5 StateBuilder (`state-builder.ts` + `types.ts`)

- `EntitySource` gains `'content-observed'` (additive union member; no
  exhaustive switches found — grep shows only assignments).
- `processPageContent` entity upsert stamps `source: 'content-observed'`
  instead of `'view-derived'` **only when the signal's snapshot came from a
  real scan** (distinguish via `snapshot.scanDurationMs >= 0 && snapshot.url !== ''`
  — D2's synthetic snapshot uses `url: ''` today). Surface-derived items keep
  `'view-derived'`.
- No other StateBuilder change needed — counters (absolute values via
  `counterTracker.record`, fixing the first-render/no-delta blind spot),
  collections (`setCount` absolute), notifications, status badges, and the
  `counterPaths`/`collectionPaths` skip-guards are already implemented and
  tested.

### 3.6 sw-integration hardening (one line, behavior-preserving)

`isNetworkSupplement` adds `(app.resultingState?.items?.length ?? 0) === 0` so a
future targetless producer carrying page content can never be misclassified as
a network-only supplement. Existing supplements (G3) never set the field, so
classification of all current producers is unchanged.

### 3.7 Deliberately unchanged

- `scheduleLateNetworkReCollect` (G3) — fires +1000ms post-close, display-only.
- Richness scoring — additive field must not perturb replacement policy; the
  shape guard (null-target never replaces target-bearing) already protects the
  dangerous direction.
- Selector list — Phase 1 ships with the existing 13 generic selectors.
- Response bodies, DB connections, contract read-side, Track-3 assertions,
  sidepanel rendering — later phases.

## 4. Data flow (end to end)

```
Action → window opens → lifecycle completes → enterSettleMode
  → quiescence + causal-network-idle → closeWindow (settle branch)
  → captureResultingState()  ← scan #1 (Click window, same document)
  → evidence.applicationEvidence.resultingState
  → BEHAVIORAL_EVIDENCE → SW attach (Tier-1 eventId; unchanged)
  → live storage → STOP → Dexie behavioralEvidence

[full-page nav] webNavigation.onCommitted → capture record → CS pageshow pull
  → openPostNavWindow (destination doc) → own AdaptiveWindow stabilization
  → closeWindow regular branch (isPostNavWindow) → captureResultingState()
  ← scan #2 (destination page, DIFFERENT window, DIFFERENT interaction) → INV-CS1

[both] STOP → understanding pipeline → D2 extractor (newSurfaces + resultingState)
  → PageContentSignal → StateBuilder.processPageContent
    → entities ('content-observed', attributes from rendered content)
    → counters (absolute) → collections (absolute + bounded)
    → notifications → status badges (M9.9 lifecycle)
  → OutcomeDeterminer (pageContent votes already weighted) → resultingEntities
  → KnowledgePersistenceService → cmdrunner_knowledge
```

## 5. Workcase → mechanism map

| Workcase | Scan finds (generic selectors) | StateBuilder outcome |
|---|---|---|
| Add to Cart | cart-count counter (absolute); `[data-asin]`/`[data-product-id]` entities w/ attributes; cart-items collection count; "Added" notification | CounterRecord absolute value + delta; cart-item entities observed (not inferred); Collection.count |
| Save | status-badge; re-rendered record fields if idAttribute-bearing | Entity attributes + currentState (M9.9) |
| Edit/Update | merged record view entities/badges | lastUpdated bump; attribute merge |
| Delete | remaining collection count; absence of removed entity id | Collection.count; entity disappearance via list delta (existing) |
| Form submit | confirmation-view entities (`[data-order-id]`), notifications | resultingEntities w/ attributes |
| Search/filter | results collection count; result entities | Collection.count observed |
| Login/logout | account-name/nav-swap surfaces (status/notification selectors), counters | NotificationRecord + view classification (existing) |
| Approve/publish/checkout | status badges, counters, entities | M9.9 lifecycle transitions |

## 6. Files to change (complete list)

**New (3):**
1. `src/shared/page-content-wire.ts` — wire types (§3.1)
2. `src/tap/page-content-dom-adapter.ts` — browser DOMAdapter (§3.2)
3. `tests/tap/resulting-state-capture.test.ts` — collector scan tests

**Modified (7):**
4. `src/shared/behavioral-evidence-types.ts` — `ApplicationEvidence.resultingState?`
5. `src/tap/dom-observer.ts` — `export function getElementPath` (additive export, no body change)
6. `src/tap/evidence-collector.ts` — observer dep, `captureResultingState`, hook A (settle branch), hook B (post-nav regular close), optional `buildAndDeliverEvidence` param
7. `src/understanding/signal-extractors/page-content-evidence-extractor.ts` — merge snapshot items, dedup, real snapshot metadata
8. `src/understanding/state-builder/types.ts` — `EntitySource += 'content-observed'`
9. `src/understanding/state-builder/state-builder.ts` — source stamping (§3.5)

**Touched, one line (1):**
10. `src/runtime/sw-integration.ts` — shape-guard clause (§3.6)

**Test updates (existing files):**
11. `tests/understanding/page-content-evidence-extractor` coverage (or new file under `tests/understanding/`) — merge/dedup
12. `tests/understanding/state-builder.test.ts` — absolute counter first-render, content-observed source
13. `tests/runtime/network-supplement-shape-guard.test.ts` — resultingState clause
14. `tests/tap/post-nav-window.test.ts` — destination scan assertion

**Explicitly NOT touched:** `src/understanding/page-content/page-content-observer.ts`
(works as-is), `adaptive-window.ts`, `recorder-entry.ts`, the three dirty
under-review files (`knowledge-loader.ts`, `contract-queries.ts`,
`knowledge-contract.ts`), generation layer, sidepanel (Phase 2), persistence
schema.

## 7. Phases

- **Phase 1 — Capture (tap layer):** wire types, adapter, collector hooks,
  tests 3/13/14. Acceptance: settle-closed click windows and stabilized
  post-nav windows deliver `resultingState`; unloading path byte-identical.
- **Phase 2 — Understanding (signal layer):** D2 merge + StateBuilder source
  stamping, tests 11/12. Acceptance: observed entities/counters/collections
  reach ApplicationState; no double-recorded counters (guard test).
- **Phase 3 — Verification round:** full suite + reviewer + tester on a real
  recording (add-to-cart, search, form-submit scenarios).
- **Phase 4 (follow-up, separate approval):** sidepanel rendering, contract
  read-side (`describeActionAsContext`), Track-3 assertion adapter
  (`deriveAssertions`), optional selector-pack registry activation
  (`registerDomainSelectors`).

## 8. Acceptance criteria

- [ ] AC1 A settle-closed click window's delivered evidence contains
      `applicationEvidence.resultingState` with ≤50 bounded items when the
      page has semantic content, and `null`/absent when it has none.
- [ ] AC2 `endReason: 'consequence-settled'` windows and only those run the
      click-side scan; `isUnloading` finalize path never scans (Vivo diff
      test: identical evidence shape without the field).
- [ ] AC3 Post-nav windows attach a destination-page `resultingState` to the
      NAVIGATION interaction's evidence; the click interaction's evidence is
      unchanged by a subsequent navigation (INV-CS1).
- [ ] AC4 A counter that renders for the first time on a destination page
      (no prior value) produces a `CounterRecord` with an absolute value and
      `delta: null` (first-render blind spot fixed).
- [ ] AC5 Entities observed via scan carry attributes read from the rendered
      content and `source: 'content-observed'`; request-body-inferred entities
      still work (`'inferred'` path untouched).
- [ ] AC6 No double-recorded counters/collections when a scan item's domPath
      is already covered by `counterChanges`/`listChanges` (guard test).
- [ ] AC7 `isNetworkSupplement` classification of all existing producers is
      unchanged (G3, network drains, real click evidence — regression suite
      incl. the iPhone 34-row burst case stays green).
- [ ] AC8 `deriveObservedItems` dedups by `kind + domPath`, snapshot item
      winning; a surface-derived counter and a snapshot counter at the same
      path yield ONE counter observation.
- [ ] AC9 Full test suite green; no timing assertions added anywhere (scan
      placement is event-driven, INV-CS3).
- [ ] AC10 No selector in `page-content-config.ts` references a specific site
      (INV-GEN4 audit).

## 9. Scenario matrix (how the design handles each)

- **AJAX/modal consequence** — in-flight blocks settle → mutations re-arm →
  settle-close scan sees the dialog's rendered content.
- **Delayed UI (async chain)** — each hop re-arms quiescence; scan runs at
  final settlement. Residual limit unchanged (300ms gap with no signal).
- **Normal navigation** — click window may scan pre-unload only if it settles
  first; destination state belongs to the post-nav window (INV-CS1/CS2).
- **Continuous polling** — poll mutations keep re-arming until the 10s cap;
  cap-close keeps raw endReason but **still scans** (partial-but-real state).
- **Slow network** — causal-idle gate holds the window; cap backstop; G3
  supplement merges late rows (unchanged).
- **No consequence** — settle ~350ms; scan returns null/empty; evidence shape
  unchanged.
- **Multiple mutations** — bounded snapshot; domChanges caps unchanged.
- **Long-running ops** — bounded by cap; partial snapshot flagged via
  `itemsOverflow`.
- **Scan cost** — runs after quiescence on a stable DOM; `scanDurationMs`
  recorded per snapshot; skipped entirely without an observer.

## 10. Regression risks & mitigations

| Risk | Mitigation |
|---|---|
| Double-recorded counters/collections (D2 bug class) | Same `getElementPath` for adapter (§3.2); AC6 guard test; existing `counterPaths`/`collectionPaths` skips |
| Vivo page-reload evidence shape changes | No scan on unloading path; AC2 byte-diff test |
| Shape-guard misclassification perturbed | One additive clause; AC7 regression incl. 34-row burst case |
| Richness-replacement flips | Score unchanged; shape guard unchanged; additive optional field |
| Post-nav click-window cross-contamination | Scan gated per-window; each evidence carries its own snapshot |
| Selector false-positives on odd pages | Bounded 50 items; first-match-wins; invalid selectors skipped; INV-GEN4 audit |
| PII in item text | 200-char cap (same exposure class as existing notification text) |
| Conflicts with under-review work | Zero overlap with the 7 dirty files; additive-only changes |
| Knowledge persistence schema | Additive optional fields only; no Dexie version bump (objects stored whole) |
| jsdom adapter gaps | Adapter has its own unit tests; observer behavior already covered by 604-line suite |

## 11. How this feeds Application Knowledge (§5 of the ask)

- `State₀ → action → State₁` becomes **observed** at State₁ for the first
  time: entities gain attributes read from the rendered result (not
  request-body hints), counters gain absolute values, collections gain
  observed counts + bounded contents, outcomes gain `resultingEntities` with
  attributes.
- The knowledge repository (`cmdrunner_knowledge`) already persists
  entities/collections/counters/outcomes/transitions — no schema change; the
  data simply becomes real.
- Downstream consumers (currently stubs) become unblocked: `deriveAssertions()`
  (Track 3, `src/generation/ir-bridge.ts:355`) can map observed post-conditions
  to assertions; `describeActionAsContext` (contract read-side) can surface
  resulting state — both Phase 4.

## 12. API/DB testing support (§6 of the ask)

- Each interaction already stores `networkActivity` (url/method/status/
  requestBody). Pairing that with `resultingState` yields **expected
  post-conditions for API tests**: POST /cart (200, asin+qty) → cart counter
  4, 4 cart-item entities with attributes. The repo becomes the seed both
  generators read.
- **DB as oracle, later:** recorded entity ids + attribute sets become the
  expected rows a per-project test-time connector validates. No recorder
  DB access ever (decision documented in investigation §4).
- Response-body capture explicitly deferred — it would break the documented
  `payloadSchema: 'unrecorded'` invariant (`contract-types.ts:209`) and needs
  its own PII/size/retention product decision.

---

**Approval gate:** no code changes until this spec is approved. On approval,
Phase 1 starts with the tap-layer wiring and its tests.

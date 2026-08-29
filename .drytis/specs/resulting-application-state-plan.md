# Resulting Application State — Complete Phased Implementation Plan

**Status: PROPOSED — read-only planning. No code changes, staging, commit, push, or ZIP.**

Companion to `.drytis/specs/resulting-application-state.md` (the design spec,
AC1–AC10). This document sequences the full path:

    Phase 1  Capture (tap layer)            — scan fires, evidence carries it
    Phase 2  Understanding (signal layer)   — evidence becomes ApplicationState
    Phase 3  End-to-end verification round  — full gate + reviewer + tester + real recording
    Phase 4  Consumer surfacing             — sidepanel / contract read-side / Track-3 assertions
    Phase 5  API seeds + DB oracle (future) — test-time verification tiers

Every phase is additive. No phase modifies the 7 files currently under review
(`behavioral-evidence-types.ts` is on that list and IS touched by Phase 1 — see
the conflict note in Phase 1 §7; the touch is one optional field appended to an
interface, merging trivially).

---

## Global invariants (binding on ALL phases)

| ID | Invariant |
|---|---|
| INV-CS1 | Click and Navigation remain SEPARATE interactions; each window's scan attaches to that window's own evidence only |
| INV-CS2 | Vivo page-reload path byte-identical: `isUnloading` finalize never scans |
| INV-CS3 | No fixed post-action timeout — scan fires at consequence settlement / post-nav stabilization |
| INV-CS4 | All data bounded (≤50 items, ≤200 chars, ≤30 attributes) — reuse M9.4 bounds, no unbounded fields |
| INV-CS5 | sw-integration attach semantics behavior-preserving; G3 supplement + shape guards unchanged in behavior |
| INV-GEN4 | Generic selectors only — no product/site-specific selectors (5a/5b rule) |
| INV-APP-1/2/3 | No causal claims; summarized/capped data; coarseMode semantics unchanged |
| INV-DB | No database connection at recording time, ever |
| INV-PAYLOAD | `payloadSchema: 'unrecorded'` invariant stands until a separate product decision approves response bodies |
| INV-REV | Zero semantic overlap with under-review work; conflicts resolved additively |

Validation commands available in all phases: `npm test` (vitest run, jsdom),
`npm run build` (node scripts/build.mjs — also type-checks via esbuild/tsc as
configured).

---

# Phase 1 — Resulting-state capture (tap layer)

## 1. What will be fixed
The recorder will photograph the **resulting page**, not just the target
element: one bounded semantic scan per window, at consequence settlement
(Click windows) and at destination-page stabilization (post-nav windows).
This closes the "machine exists, never invoked" gap.

## 2. Exact files/components affected

**New (3):**
- `src/shared/page-content-wire.ts` — `WireObservedItem`, `WirePageContentSnapshot`
  (structural duplicates of the understanding-side types; **zero imports** from
  `src/understanding` — keeps `shared` import-clean, verified).
- `src/tap/page-content-dom-adapter.ts` — browser `DOMAdapter`
  (`querySelectorAll/querySelector/url` over live `Document`; `isVisible()` via
  rect + computed display/visibility/opacity/hidden; `getPath()` delegating to
  the newly exported `getElementPath`).
- `tests/tap/resulting-state-capture.test.ts` — the phase's test file.

**Modified (3):**
- `src/shared/behavioral-evidence-types.ts` — one optional field on
  `ApplicationEvidence`:
  `resultingState?: WirePageContentSnapshot | null;`
- `src/tap/dom-observer.ts` — add `export` to `getElementPath` (L154). No body
  change.
- `src/tap/evidence-collector.ts`:
  - `ObservationWindowState` gains `resultingStateScanned?: boolean`.
  - Optional injectable scan dependency (constructor param or setter — tests
    inject a fake; production lazily builds `PageContentObserver` +
    browser adapter from `createDefaultPageContentConfig()` in `start()` when
    `document` exists).
  - `captureResultingState(state): WirePageContentSnapshot | null` — at-most-once
    per window, try/catch → null, skips when observer absent / not running.
  - **Hook A (Click):** settle branch of `closeWindow` (L604–624), after
    `enrichFromMetadata`, before `buildAndDeliverEvidence`.
  - **Hook B (Navigation):** regular `closeWindow` delivery path, gated
    `if (state.isPostNavWindow)`.
  - `buildAndDeliverEvidence` gains optional `resultingState` param
    (default `undefined` — non-passing callers unchanged).
  - **Never scans:** `executeFinalization`, `finalizeWithoutWindow`,
    `isUnloading` path, `closeWindowSilently`, G3 supplements.

**Test updates (2):**
- `tests/runtime/network-supplement-shape-guard.test.ts` — resultingState clause.
- `tests/tap/post-nav-window.test.ts` — destination-scan assertion.

## 3. Architecture / data-flow changes

```
Click:    finalize → enterSettleMode → quiescence+causal-idle → closeWindow(settle)
          → captureResultingState()  [scan #1, same document]
          → evidence.applicationEvidence.resultingState → BEHAVIORAL_EVIDENCE → SW attach (unchanged)

Full-nav: onCommitted record → CS pageshow pull → openPostNavWindow (dest doc)
          → own stabilization/3s cap → closeWindow regular branch (isPostNavWindow)
          → captureResultingState()  [scan #2, destination document, NAVIGATION interaction]

SPA pushState: navigation evidence stays in-window; scan still runs at settle —
          destination content of a soft nav lands in the same Click window's
          snapshot, which is correct (no separate interaction was created).
```

No new message types, no SW changes beyond the one shape-guard clause (which
belongs to Phase 1 or 2 — placed here so the wire field and guard land
together), no persistence changes (optional field rides existing stores).

Wait — the shape-guard clause: keep in Phase 1 (§2 modification list below).

## 4. Tests and validation (Phase 1)
- **Unit (new file):** with injected fake observer returning a canned snapshot:
  - settle-closed click window delivers `resultingState` (AC1)
  - `max-duration` cap close still scans (bounded, partial state)
  - `isUnloading`/executeFinalization paths never scan; evidence without field
    when observer returns null (AC2, INV-CS2)
  - at-most-once per window (double close / G3 after-close does not re-scan)
  - post-nav window attaches destination snapshot (AC3 capture half)
  - non-post-nav window through regular close does NOT scan
  - observer throws → null, no delivery failure
  - scan omitted when dependency not injected (unit-test default = today's behavior)
- **Adapter tests:** browser adapter over jsdom `document` — path equality with
  `getElementPath` output on the same nodes (load-bearing for Phase 2 dedup),
  visibility filtering, attribute extraction bounds.
- **Regression:** full existing tap suite (consequence-settling, post-nav,
  window-accumulation, adaptive-window, dom-observer) + `network-supplement-shape-guard`
  incl. the iPhone 34-row burst case (AC7).
- `npm test` + `npm run build`.

## 5. Dependencies on previous phases
None. Self-contained capture layer.

## 6. Regression risks
| Risk | Mitigation |
|---|---|
| Vivo page-reload evidence shape drift | No scan on unload path; explicit diff test |
| Shape-guard classification change | Additive clause only; burst-case regression stays green |
| Scan cost inside closeWindow | Runs post-quiescence on stable DOM; `scanDurationMs` recorded; bounded selectors; try/catch |
| `behavioral-evidence-types.ts` merge conflict (file under review) | One optional field append; resolve by taking both |
| Memory (50 items × 30 attrs) on every window | Bounded; rides existing evidence object lifecycle |

## 7. What remains for later phases
Understanding-side consumption (Phase 2); user-visible surfacing (Phase 4);
API/DB pairing (Phase 5).

---

# Phase 2 — Understanding consumption (signal layer)

## 1. What will be fixed
`resultingState` stops being dead weight: D2 extracts it into the
`PageContentSignal`, StateBuilder turns it into observed entities/counters/
collections/notifications/lifecycle states, OutcomeDeterminer's existing
page-content votes fire on real observations, and the knowledge repository
receives observed (not inferred) state.

## 2. Exact files/components affected

**Modified (3):**
- `src/understanding/signal-extractors/page-content-evidence-extractor.ts`
  - `deriveObservedItems` second source: `applicationEvidence.resultingState?.items`
    (wire → `ObservedItem`, pure copy).
  - Merge dedup key `kind + ':' + domPath`; snapshot item wins collisions
    (richer). Real snapshot metadata replaces the synthetic
    `{url:'', scannedAt: Date.now()}` when present.
  - Header note: `domChanges[]` still NOT read (CounterSignal/ListSignal own it).
- `src/understanding/state-builder/types.ts` — `EntitySource` gains
  `'content-observed'` (additive; no exhaustive switches exist — verified).
- `src/understanding/state-builder/state-builder.ts` — `processPageContent`
  stamps `source: 'content-observed'` when snapshot is real
  (`snapshot.url !== ''` distinguishes from D2's synthetic `url: ''`), else keeps
  `'view-derived'`. Nothing else changes — counters/collections/notifications/
  status-badges + `counterPaths`/`collectionPaths` skip-guards already exist.

**New/updated tests (3):**
- `tests/understanding/page-content-evidence-extractor.test.ts` (new) — merge,
  dedup, snapshot-wins, synthetic-fallback.
- `tests/understanding/state-builder.test.ts` (update) — absolute counter
  first-render (`delta: null`, value recorded — the Vivo blind-spot fix, AC4),
  `'content-observed'` source stamping (AC5), inferred path untouched.
- `tests/understanding/dedup-regression.test.ts` (update) — snapshot counter at
  a path ALSO covered by `counterChanges` records exactly once (AC6); same for
  collections.

## 3. Architecture / data-flow changes
No new data flow — Phase 1's field enters the EXISTING path:

```
D2 extractor → PageContentSignal → coordinator ('page-content', latest-wins)
→ StateBuilder.processPageContent → Entity/Counter/Collection/Notification/state badge
→ OutcomeDeterminer (existing pageContent weights .15/.2/.2) → resultingEntities
→ KnowledgePersistenceService → Dexie cmdrunner_knowledge (no schema change)
```

## 4. Tests and validation
- Unit tests above; plus pipeline-level: `tests/understanding/pipeline/` — a
  fixture interaction whose evidence carries `resultingState` yields
  transitions with `page-content entity/counter/collection` change strings and
  outcome votes containing `page-content` evidence kinds.
- Full `npm test`, `npm run build`.

## 5. Dependencies
**Phase 1** (the field must exist in delivered evidence). Cannot ship before it.

## 6. Regression risks
| Risk | Mitigation |
|---|---|
| Double-recorded counters/collections (D2 bug class) | Path-identity via shared `getElementPath` (Phase 1 adapter) + existing skip-guards + AC6 test |
| Counter tracker delta corruption from re-observations of the same value | `counterTracker.record` semantics unchanged; delta computed from history — add a repeat-same-value test |
| Entity source flip breaks consumers | Additive union member; grep verified no exhaustive switches; persistence serializes source verbatim |
| Outcome confidence inflation from richer signals | Existing weights already cap page-content votes; add a confidence-sanity assertion |
| D2 confidence (0.7) on now-richer signal | Keep 0.7 — deliberate, matches existing calibration |

## 7. What remains
Nothing in understanding; surfacing (Phase 4) and pairing (Phase 5).

---

# Phase 3 — End-to-end verification round (gate)

## 1. What will be fixed
Nothing new — this phase PROVES Phases 1–2 on the real stack and closes the
loop per the full-verification default (this is a major change: new capture
machinery + evidence shape).

## 2. Files/components affected
None in `src/`. Test/verification artifacts only:
- Reuse of local fixture pages (the `public/` test harness pages) and the
  real-Chrome CDP validation technique documented in
  `.drytis/notes/real-chrome-cdp-validation-technique.md`.
- Possibly a fixture page addition for cart/counter/list scenarios (test asset,
  not product code).

## 3. Data-flow validation (per workcase)
Recorded end-to-end and asserted on the delivered evidence + resulting
knowledge: add-to-cart (counter 3→4 + cart entities), save (record state),
delete (remaining count), form submit (confirmation state), search (result
count + entities), login (nav-state markers), and Vivo-style full-reload
(byte-identical click evidence; destination state on the NAVIGATION side).

## 4. Tests and validation
- Full `npm test` + `npm run build`.
- **Infrastructure Gate**: kill stray dev processes; services green; env keys
  intact; Caddy root proxy present; preview reachable.
- **infra_verifier** delegation — env/service/preview/hardcoding audit.
- **reviewer** delegation — spec-compliance read of AC1–AC10.
- **tester** delegation — browser-visible recording flow on the preview URL.
- Real-Chrome run (CDP technique) for at least: AJAX add-to-cart, full-reload
  navigation, polling page (bounded cap-close + scan).

## 5. Dependencies
Phases 1–2 complete.

## 6. Regression risks
Finding real-world issues here is the POINT. Budget up to 3 fix→re-verify
rounds (fixes route back into Phase 1/2 files with tests).

## 7. What remains
Phase 4+ (surfacing and verification tiers).

---

# Phase 4 — Consumer surfacing (three independent sub-phases)

Each is separately approvable and independently shippable after Phase 3.

## 4a — Sidepanel evidence rendering
- **Fixed:** the Evidence panel shows the resulting-state snapshot (kind chips:
  counter value, collection count, entity id/type, notification text, badge
  state) — the user can SEE "cart = 4, 4 items observed".
- **Files:** `src/sidepanel/evidence-renderer.ts` (+ its test) — one new render
  block reading `applicationEvidence.resultingState`, bounded to the same
  50-item cap; the NO data state renders nothing (no layout change for
  old recordings).
- **Flow:** pure read-side; no recorder change.
- **Tests:** renderer unit test + tester delegation on the preview.
- **Deps:** Phase 1 (field exists). **Risks:** visual noise — bounded, grouped
  by kind. **Remains:** contract + assertions (4b/4c).

## 4b — Contract read-side surfacing
- **Fixed:** the CP8 knowledge contract exposes resulting state:
  `describeActionAsContext` and `getAction` summaries include observed
  post-conditions ("after: cart-count=4; 4 product entities observed").
- **Files:** `src/understanding/contract/contract-queries.ts`,
  `knowledge-contract.ts` (**both currently dirty/under review — must
  rebase additively after that review merges; INV-REV**), + contract tests.
- **Flow:** query-side joins outcomes + `resultingEntities` + counter values —
  all Phase 2 data; no schema change.
- **Tests:** contract query tests; envelope shape unchanged.
- **Deps:** Phase 2 + the under-review contract work merged.
- **Risks:** merge conflicts with review branch; contract is consumer-facing —
  additive fields only, envelope versioned if needed.
- **Remains:** Track 3 (4c).

## 4c — Track-3 assertion derivation (generated tests gain assertions)
- **Fixed:** `deriveAssertions()` stops returning `[]`: observed post-conditions
  become `IRAssertion[]` via a `GenerationEnrichment.elementAssertions` adapter
  at the service-worker call site (counter value, collection count,
  notification text contains, badge state, entity present).
- **Files:** `src/generation/ir-bridge.ts` (replace stub, L355),
  `src/generation/generation-types.ts` (if mapping types need widening),
  `src/adapters/playwright/assertion-renderer.ts` +
  `test-function-renderer.ts` (`NO_ASSERTIONS_BANNER` logic — now conditional
  on real absence), SW call site wiring, + generation tests.
- **Flow:** knowledge (Phase 2) → enrichment adapter → IR steps → Playwright
  `expect(...)` calls.
- **Tests:** unit (mapping matrix per assertion kind), golden-file generation
  tests, INV-GEN-7 graceful degradation when no enrichment (banner still shown
  for unasserted plans).
- **Deps:** Phase 2 (observed post-conditions exist); design sign-off that
  generated assertions are wanted by default (flagged for explicit approval —
  it changes generated-test output).
- **Risks:** flaky selectors in generated assertions (mitigate: assert by
  semantic selector/role/text from the snapshot, not domPath); assertion
  over-generation (cap: one assertion per observed item kind per step).
- **Remains:** Phase 5 tiers.

---

# Phase 5 — API seeds + DB test-time oracle (future, gated)

## 5a — API verification seeds (no new capture)
- **Fixed:** pair stored `networkActivity` (url/method/status/requestBody) with
  `resultingState` post-conditions → an **expected-outcomes seed** per API op
  ("POST /cart 200 {asin,qty} ⇒ cart-count 4, 4 entities"). Read-side query in
  the contract (`getApiSurface` enrichment or sibling query) — feeds future
  API test generation.
- **Files:** `src/understanding/contract/contract-queries.ts` (+ types),
  tests. No recorder change. INV-PAYLOAD untouched (bodies still unrecorded).
- **Deps:** Phases 2 + 4b. **Risks:** correlating op → post-condition across
  concurrent windows — reuse the CER membership join, never timing.

## 5b — Response-body capture (EXPLICITLY GATED — not planned)
Breaks the documented `payload-unrecorded` invariant
(`contract-types.ts:209`). Requires a separate product decision on PII, size
bounds, retention. **Out of scope for this plan until approved.**

## 5c — DB test-time verification oracle (test-time tooling only)
- **Fixed:** recorded entity ids + attribute sets become expected rows; a
  per-project DB connector (configured at TEST time, never in the recorder)
  verifies them after replay.
- **Files (new area, later):** test-runner-side connector config + verifier —
  lives outside the extension recorder path entirely. INV-DB binding.
- **Deps:** Phases 2 + 4c (assertions must exist for the oracle to hang off).
- **Risks:** credential handling at test time; environment drift — both
  acceptable BECAUSE it's test-time-only by design.

---

# Cross-phase summary

| Phase | Scope | New src files | Modified src files | Gate |
|---|---|---|---|---|
| 1 | Capture | 2 | 3 (+1 test-only export) | unit + regression + build |
| 2 | Understanding | 0 | 3 | unit + regression + build |
| 3 | Verification round | 0 | 0 | full suite + infra gate + infra_verifier + reviewer + tester + real-Chrome |
| 4a | Sidepanel | 0 | 1 | renderer test + tester |
| 4b | Contract read-side | 0 | 2 (after review merges) | contract tests |
| 4c | Track-3 assertions | 0 | ~4 | generation golden tests + full gate |
| 5a | API seeds | 0 | 1–2 | contract tests |
| 5b/5c | Gated future | — | — | separate decisions |

**Acceptance criteria:** AC1–AC10 (design spec) close at Phase 3; 4a/4b/4c/5a
each add their own (renderer visibility; contract fields present; generated
tests contain real `expect()` calls with INV-GEN-7 preserved; API seed rows
present).

**Publishing:** local checkpoints throughout; single publish after Phase 3
approval (and again after any Phase 4/5 batch), never mid-phase.

**Order is strict through Phase 3.** Phases 4a/4b/4c are parallelizable
after 3; Phase 5 follows 4c.

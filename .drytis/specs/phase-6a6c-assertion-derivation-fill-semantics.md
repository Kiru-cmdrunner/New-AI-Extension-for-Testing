# Phase 6A+6C — Changed-Element Seeding + Dual-Sample Fill Semantics

Status: APPROVED FOR IMPLEMENTATION (owner review 2026-08-21 post real-Chrome validation gate).
Pins P1–P10 written & red-run 2026-08-21 @ 568adfe (27 failed / 16 passed, zero regressions).
P11 added per owner decision 2026-08-21 (native `<select>` intermediate change). Implementation phase active.
Supersedes: the draft spec of the same name (pre-review version).
Base: 568adfe (6D.0 committed, unpushed per protocol). Branch: capability-surgical-removal.
Doctrine: Application Understanding Engine first — AdaniOne is a validation benchmark only.
No timing rules. No site-specific selectors or tokens. No selector-widening.

Owner decisions (2026-08-21, after multi-pattern real-Chrome validation 12 PASS / 3 FAIL):
- 6A CONFIRMED as generic Application Understanding work: semantic seeding only, no selector
  expansion, no site-specific fixes.
- 6C CONFIRMED: typedValue/committedValue separation in TextEntry + IR fill.
- P11 APPROVED into 6C scope: native `<select>` intermediate ArrowDown `change` completion.
- F3/F5 (async/transient state pinning) DEFERRED to future lifecycle work (6D.x) — outside 6A/6C.

---

## 0. Review verdicts (owner's five questions)

1. **Changed-element seeding architecture — CONFIRMED, with placement delta.**
   Seeding rides the ONE existing observation moment (`captureResultingState`,
   evidence-collector.ts:1515–1533) and the window's own accumulation
   (`domObserver.getAccumulatedSummaries()` — does NOT clear, dom-observer.ts:391).
   DELTA vs draft: the seeded pass runs **AFTER** `DEFAULT_SEMANTIC_SELECTORS`
   (not before) and only adds items for paths the selector pass did not already
   cover — selector-matched snapshots stay byte-identical (existing pins safe).
2. **Not selector-based — CONFIRMED, with a hard boundary rule.**
   The seed module never queries the DOM for a pattern. It receives change
   summaries + resolves the changed element's own path structurally
   (segment walk over `children`, tag + `#id` match — NOT `querySelector(path)`),
   then reads FACTS off that element (role, aria-label, data-* identity, text,
   child count). The only `querySelectorAll` in the seeded path is the
   pre-existing Phase-2b `uniqueInSnapshot` verification stamp
   (page-content-observer.ts:282) — reused mechanism, not new selector logic.
3. **Transient React/hydration filtering — SPECIFIED (was the thinnest part of the draft).**
   Concrete gates below (§2.4): no-op deltas, skeleton/loading text vocabulary,
   punctuation-only text, invisible elements, net-zero non-semantic childList,
   unresolvable/detached paths. All content-based or shape-based — zero timing.
4. **Interaction ownership boundaries — PRESERVED structurally.**
   Seeds introduce NO new capture moment and NO new scan site. They are a filter
   on what the ALREADY-owned settle-time scan looks at; every existing guard
   applies unchanged: `resultingStateScanned` at-most-once (:1517),
   `settleSuperseded` (:1521, :1566–1575), post-nav-only Hook B (:947),
   companion-window claimant rule. The accumulation envelope equals the
   existing `domChanges` envelope (Fix Pair 2 / INV-C1 sharing semantics) —
   no new ownership semantics invented.
5. **typedValue/committedValue contract — CONFIRMED, plus one grammar-consistent
   renderer extension the draft missed.** `textValue` stays committed-state
   (blur-wins) for ALL existing consumers; `typedValue` is intent (input/change
   sample, never overwritten by blur; autofill-only fills backfill
   typed := committed). IR fill + description read `typedValue ?? textValue`.
   The committed-value assertion needs `equality`/`equals`/`property='value'`,
   which the evaluator ALREADY supports (assertion-evaluator.ts:83,
   extractPropertyValue case 'value') but the Playwright renderer does NOT map
   (renderEquality default falls to `toHaveAttribute('value','true')` — wrong).
   Addition: `renderEquality` case EQUALS + property 'value' → `toHaveValue`.
   This is the one file beyond the draft's list (assertion-renderer.ts).

---

## 1. Problem (verified at file:line, 2026-08-21 re-audit)

- **O8/C1:** every assertion derives from `WirePageContentSnapshot.items`, which
  come exclusively from `DEFAULT_SEMANTIC_SELECTORS` (page-content-config.ts:16–165).
  Real-site conventions (#id-only counters, no data-count, aria-label cells,
  widget-named data-auto-id) match nothing → snapshot empty → 0 assertions.
  Confirmed: `scan()` (page-content-observer.ts:78–155) is the ONLY DOM-querying
  path; sole production call site evidence-collector.ts:1525.
- **O5/C4:** text-entry.ts:48–67 — input/change sets `ctx.data.textValue`
  (:52); blur unconditionally overwrites it (:60–61). `buildResult` emits one
  `textValue`; ir-bridge `extractInputValue` (:305–310) and
  `generateDescription` TextEntry (:218) read `textValue` only. Typed intent
  survives nowhere → IR fill = committed value → replay divergence (int-28/32).

---

## 2. 6A design — changed-element seeding

### 2.1 Data flow (unchanged envelope, one new input)

```
window settles (existing settle/post-nav guards)
  → captureResultingState(state)                       [evidence-collector.ts:1515]
      summaries = domObserver.getAccumulatedSummaries()  (no clear — :391)
      seeds = classifyChangedSummaries(summaries)        [NEW pure module]
      snapshot = observer.scan(null, seeds)              [2nd param, optional]
  → toWireSnapshot → ApplicationEvidence.resultingState  (unchanged)
  → deriveStepAssertions → IR assertions                 (unchanged join)
```

### 2.2 New module `src/understanding/page-content/changed-element-seed.ts` (pure)

Input: `DomChangeSummary[]` (shared type — understanding already imports shared).
Output: `ChangedElementSeed[]` = `{ summary, candidateKinds }` — NO DOM access.

Kind inference table (change shape × resolved-element facts):

| Change shape | Element facts required (at resolution) | Kind |
|---|---|---|
| `characterDataDelta.new` contains a standalone number token | visible; tag ∉ {INPUT,TEXTAREA,SELECT}; not noise text | counter |
| `attributes` ∋ `data-count`, new value numeric | visible | counter |
| `attributes` ∋ `role` alert/status (set or changed) | visible | notification (presence-only) |
| `characterData` non-numeric text ≥2 chars | `role` = alert/status → notification; else `aria-label` present → status-badge; else DROP | notification / status-badge |
| `childList` added>0 | parent role ∈ {list,listbox,grid,tree} or tag ul/ol → collection (count = live children.length); each added-carrying child w/ value-bearing identity attr → entity (bounded scan of parent children only) | collection / entity |
| `attributes` ∋ identity attr (IDENTITY_ATTR_NAMES family) w/ non-null new value | element carries it now | entity |

Entity identity family = the existing config vocabulary (data-asin, data-product-id,
data-item-id, data-sku, data-order-id/number). entityType 'unknown' fallback
(mirrors buildItem). NO new attribute names.

### 2.3 Observer change — `scan(viewId, seeds?)`

- Selector loop runs FIRST, byte-identical (order, dedup, matchedSelectors count).
- Seed pass runs SECOND: for each seed, resolve path → element(s) via
  `DOMAdapter.resolvePath?(path): {element, siblings} | null` (optional method;
  absent adapter → seeded pass silently skips — test mocks unaffected).
  Resolution = structural segment walk (children + tag/#id match),
  intermediate ambiguity continues through ALL matches, final segment
  disambiguated by content anchoring: `textContent.trim() === delta.new`
  (picks the RIGHT sibling among structurally identical ones, e.g. date
  cells; a delta whose new text matches no candidate is an honest skip).
  [Implementation note: the spec's original "candidate cap 32/seed" is
  dead-letter text — bounding comes from the seed cap 24 + item cap 50 +
  MAX_SEED_CHILDREN 8 child walk; no separate candidate cap exists.]
- Build `ObservedItem` via the SAME buildItem path (kind from the table,
  `matchedSelector: 'changed-element-seed'` sentinel for provenance,
  attributes = allowlisted extraction set + aria-label, uniqueInSnapshot stamp
  via the refactored shared helper — stamp logic takes (kind, attributes) now).
- Dedup against selector items by the SAME rules (entityId for entities, path
  otherwise). MAX_ITEMS/50, text/200, attrs/30 bounds all apply; seeds dropped
  at the cap count into `itemsOverflow`.
- Shadow-context paths (`[ctx] > …`): document-level adapter cannot reach open
  shadow roots — same blindness the selector scan has today; seeds from shadow
  paths are dropped (documented limitation, unchanged).

### 2.4 Noise gates (question 3 — all content/shape-based, no timing)

Applied in order; any hit drops the seed:
1. SKIP_TAGS (script/style/template/… — observer's existing set).
2. Not visible at resolution (adapter `isVisible`, same semantics — checked
   immediately after `resolvePath`, before any item assembly; functionally
   identical to a post-resolution gate, just earlier in the flow).
3. No-op delta: `characterDataDelta.old === new`, or old ∈ {null,'','""'} with
   new equal — hydration placeholder echo.
4. Skeleton/loading text: trimmed text empty, punctuation/space-only
   (`/^[\W_]*$/`), or generic loading vocabulary
   (lowercased text === 'loading' / 'loading…' / 'loading...' / 'skeleton',
   or startsWith 'loading' with length ≤ 16). Generic web words, not site tokens.
5. Net-zero childList (added === removed, no characterData, no semantic
   attrs/role/tag shape) — mount/unmount churn; drops via kind table anyway,
   stated explicitly as a gate.
6. Unresolvable path (detached / candidate cap exceeded) → drop.
7. Virtual-scroll churn — already filtered upstream by dom-observer `isNoise`.

### 2.5 Fill committed-value assertion (Pin 2/5) — derivation, not observation

Controlled-input `value` writes produce NO DOM mutations, so the fill's own
committed state cannot come from seeds. It derives in
`assertion-derivation.ts::deriveStepAssertions` (already receives
`ComponentInteraction[]` — has `.type`, `.metadata`, `.trigger.stableId`):

- TextEntry ∧ `userTyped` ∧ committed `textValue` non-empty ∧
  `trigger.stableId` non-empty →
  `{ type:'equality', comparison:'equals', severity:'soft', property:'value',
     expectedValue: textValue, targetCss: '#'+stableId, targetName, derivedFrom:'fill-committed-value' }`.
- Requires NO resulting-state snapshot (controlled-input commits produce no
  DOM mutations — the whole point); derives from the interaction's own
  metadata alone. Snapshot-kind derivation still requires the snapshot.
- Emitted FIRST (before snapshot kinds), inside the shared 3-per-step cap.
- #id tier only — no id ⇒ no assertion (honest skip; consistent with
  LOCATOR_CONFIDENCE; 6B may later add tiers via its own ranking, not here).
- Renderer: extend `renderEquality` with `comparison===EQUALS &&
  property==='value'` → `toHaveValue(escaped)`. Pure case addition to the
  existing matrix; evaluator already handles equality/value end-to-end.

---

## 3. 6C design — typedValue/committedValue contract

| Field | Set when | Overwritten by blur? | Semantics |
|---|---|---|---|
| `typedValue` | input/change `valueAfter` (last wins) | NEVER | user intent (replay input) |
| `textValue` | input/change `valueAfter`, then blur `valueAfter` when non-empty | yes (existing) | committed application state |

- Blur branch additionally backfills `typedValue ??= blurValueAfter` when no
  input/change ever fired (autofill/paste-without-input) — typed := committed,
  IR fill unchanged for those flows (no intent existed to lose).
- `buildResult` emits `{ targetName, textValue, typedValue, userTyped }`.
- `metadata` is a free-form record — no schema/persistence migration.
- Consumers UNCHANGED (committed semantics preserved):
  meaning-resolver, interaction-renderer, output-adapter,
  evidence-collector enrichFromMetadata (:1978), episode-builder, sidepanel.
- ir-bridge `extractInputValue` TextEntry → `typedValue ?? textValue ?? null`;
  `generateDescription` TextEntry → same source (Fill "<typed>").
- NOISE_TYPES untouched; event-tap value capture untouched (blur valueAfter is
  load-bearing).

### §3b P11 — native `<select>` intermediate-change completion (same family as 6C)

Observed live (V4/F4): keyboard-driven native `<select>` fires a trusted
`change` after **every** ArrowDown. dropdown.ts:190 completes on the FIRST
change → `selectedValue` pins the intermediate option ("Low") while the user
kept driving to "high"; subsequent changes fall to Unclassified interactions.
Generated spec replays the wrong choice.

Contract (mirrors DatePicker's typed-wins precedent, opposite side):
- **selectedValue = final committed choice** (the value the control settles on),
  not the first observed change.
- The lifecycle must stay open while the user is still driving the SAME select —
  completion only when the interaction structurally ends.

Structural rule (NO timing): while lifecycle members show `keydown` events on
the same `<select>` trigger, the dropdown is still being driven — the change
events observed between keydowns are INTERMEDIATE. Completion conditions,
in priority order:
1. `blur` on the trigger select → complete with the LAST change value observed
   (or read the value at blur via `event.valueAfter`, identical by definition
   for native selects).
2. Discrete action on a DIFFERENT element (existing outside-action path /
   shouldCancelOnOutside) → complete/abandon with the last change value.
3. Click on the trigger select itself (toggle behavior) → keep open.

Implementation shape (dropdown.ts, native-SELECT branch only):
- On `change` where `ctx.trigger.tag === 'SELECT'`: record
  `ctx.data.selectedValue = event.valueAfter` (provisional) and DO NOT
  complete; mark `ctx.data.nativeSelectActive = true`.
- On `blur` of the same select: complete with current `selectedValue`
  (blur `valueAfter` as fallback).
- S3' displaced-end logic and combobox/listbox paths UNCHANGED (6A/6C scope
  guard; the must-not-change list names S3' explicitly).
- No timers, no debounce, no site tokens. The ArrowDown cadence never gates
  anything — keydown presence is the structural "still driving" fact.

Edge cases: mouse-driven select (click option) — the option click path already
completes via existing logic, unchanged; single Enter-to-commit with no
ArrowDown — first change is final, blur completes with it (same value);
recording stops mid-drive — STOP drains open lifecycles with last provisional
value (honest: better than intermediate-first).

---

## 4. Constraints (inviolate — re-verified)

- No timing rules anywhere in the design. No site tokens. No selector widening
  (`DEFAULT_SEMANTIC_SELECTORS` untouched; no new CSS selector strings except
  the pre-existing verification stamp).
- MUST NOT CHANGE: evidence-ledger.ts, projection-engine.ts, NOISE_TYPES
  (ir-bridge.ts:83–86), dropdown.ts S3' containment (:127/:207/:241 — the
  displaced-end logic; P11 touches ONLY the native-SELECT completion branch),
  locator-ranking.ts (:228, 6B scope), event-tap.ts value capture (:300–305),
  sw-integration attach semantics.
- Seeds ride existing guards; no new scan sites; nothing derived from STOP
  re-drain (O6 exclusion).
- INV-CS1 per-window evidence; INV-GEN-4 generic locators only; INV-GEN-8 no
  domain imports in generation types.

## 5. Files

| File | Change |
|---|---|
| NEW `src/understanding/page-content/changed-element-seed.ts` | pure classify/filter (§2.2, §2.4) |
| `src/understanding/page-content/page-content-observer.ts` | `scan(viewId, seeds?)` seed pass after selectors; stamp helper refactor to (kind, attributes) |
| `src/tap/page-content-dom-adapter.ts` | `resolvePath()` structural walker (production only) |
| `src/tap/evidence-collector.ts` | `captureResultingState` passes summaries→seeds→scan (sole call site :1525) |
| `src/definitions/text-entry.ts` | typedValue dual-sample (§3) |
| `src/definitions/dropdown.ts` | P11: native-SELECT completion keeps window open on intermediate changes (structural — see §3b) |
| `src/generation/ir-bridge.ts` | extractInputValue + description `typedValue ?? textValue`; Dropdown selectedValue uses final change |
| `src/generation/assertion-derivation.ts` | TextEntry committed-value branch (§2.5) |
| `src/adapters/playwright/assertion-renderer.ts` | EQUALITY/EQUALS/value → toHaveValue |
| `.drytis/patterns.md` | document `matchedSelector:'changed-element-seed'` sentinel + typedValue contract |

## 6. TDD pins (fail-first, before implementation)

**PIN FILES WRITTEN & RED-RUN RECORDED (2026-08-21, @ 568adfe, pre-implementation):**

| Pin file | Pins | Red state recorded |
|---|---|---|
| `tests/understanding/changed-element-seed.test.ts` | §2.2/§2.4 classification + noise gates + cap | module-not-found (new module absent) |
| `tests/understanding/seeded-scan.test.ts` | P1, P3, P4, dedup, byte-identity, mock-adapter compat, bounds | 7/11 red: `scan(null, seeds)` → null (seeds ignored today); 4 green = today's-behavior guards |
| `tests/generation/assertion-derivation-6a6c.test.ts` | P2 (+P5 derivation half), seeded kinds | 3/9 red: no committed-value branch → 0 assertions; 6 green = seeded kinds already derive + honest skips |
| `tests/definitions/text-entry-6c.test.ts` | P5 dual-sample, autofill backfill, Bug 4, consumer guards | 9/9 red: `typedValue` undefined everywhere; committed `textValue` correct |
| `tests/generation/ir-bridge-6c-fill.test.ts` | P5 IR half (input + description + plainEnglish), legacy fallbacks | 4/6 red: fill input = committed `'Sat, 05 Sep'` (int-28 reproduced); 2 green = legacy textValue fallback guards |
| `tests/adapters/playwright/assertion-renderer-6c-value.test.ts` | P10 toHaveValue + existing-matrix guards | 3/4 red: renders `not.toHaveAttribute('value','true')`; 1 green = existing cases pinned |
| `tests/tap/resulting-state-seeding.test.ts` | P6a wiring, P6b/c idempotence, P7 ownership | 1/4 red: P6a seeds-undefined (THE wiring pin); P6b/c/P7 green = existing guards must STAY green |

Red-run totals: **27 failed / 16 passed of 43 new tests**; full suite 221 files / 4,107 tests otherwise green (zero regressions). Harness corrections during red-run (documented for the record): flush-between-events breaks TextEntry lifecycles (process sequentially, mirror core-definitions); ownership ordering = finalize arrives AFTER the click window opens (mirror A-Slice test); house escaper does not escape double quotes.

## 6a. Real-Chrome validation gate (2026-08-22, @ 568adfe dist, pre-implementation)

Full report: `notes/multipattern-validation-2026-08-22.md` + `notes/evidence/multipattern-validation-2026-08-22/`.
Three generic patterns (classic #id-only / reactish className-only + controlled rewrite + typeahead / shop aria-steppers)
driven with trusted CDP input events. Gate: **12 PASS / 3 FAIL**; capture & generation layers healthy;
understanding layer is the bottleneck — **6A+6C confirmed aimed at the right generic gap**.

**V-findings → pin/spec deltas:**
- **V1 (F1)** O8 zero-observation on #id-only apps → confirms P1–P4 as written. No change.
- **V2 (F2)** typed/committed loss on TextEntry blur-rewrite → confirms P5 as written (DatePicker's
  typed-wins contract is the in-repo proof it works). No change.
- **V4 (F4) NEW — Dropdown completes on intermediate trusted `change`** (keyboard-driven native select:
  change fires per ArrowDown; first change wins → `selectedValue: "Low"` while committed = "high"; generated
  spec replays the WRONG choice). Same typed/committed family, different lifecycle → **new pin P11**:
  `tests/definitions/dropdown-intermediate-change.test.ts` — RED today, expected amber (same family as 6C;
  if owner prefers, park as 6C.2 — the correct fix is dropdown.ts completion semantics, NOT a new selector).
- **V3/V5 (F3/F5)** transient-state pinning ("Planning…" asserted instead of settled "Trip planned") →
  6A's noise gates filter transients in the SEED pass only; scan-moment-vs-settle semantics is an
  ownership/settle question → **out of 6A scope**, logged as 6D.x candidate (do not expand 6A).
- **V-cap** capture layer validated healthy via trusted events (trust gate at event-tap.ts:204 filters
  synthetic change/input — first-run harness artifact, NOT a product bug).

Design delta discovered while pinning (folded here): a `<ul>` appended directly to `<body>` produces a childList summary targeting the PARENT (`body`) — seed resolution must include a bounded scan of the added children (cap applies). Encoded in seeded-scan + seed-classification pins.

Original pin list (implemented above):

1. **P1 selector-independent counter:** #id counter, no data-count/aria-label/
   testids, numeric characterData delta → snapshot counter item + textMatch via
   own-#id tier (today: 0 items).
2. **P2 fill committed assertion:** #id-only input fill → step carries the soft
   equality/value assertion on committed state; IR input = typed value.
3. **P3 counter w/o data-count:** numeric characterData only → count-tier #id
   assertion (variant of P1 via attribute-less path).
4. **P4 aria-label-only element:** no id/testids, structurally ambiguous
   siblings, distinct texts → content-anchored resolution picks the changed
   sibling; verified-attr tier (uniqueInSnapshot + allowlist); no class chain.
5. **P5 int-28 divergence:** focus→input("Sat, 22 Aug")→blur("Sat, 05 Sep") →
   metadata.typedValue="Sat, 22 Aug", textValue="Sat, 05 Sep"; IR fill="Sat,
   22 Aug"; description uses typed; assertion expects committed "Sat, 05 Sep".
6. **P6 idempotence/O6:** duplicate behavioral evidence w/ identical
   resultingState → assertion map unchanged; double-close → 1 scan; seeded
   count identical on repeat.
7. **P7 ownership:** TextEntry settle window superseded by later click → its
   seeded scan does NOT include the click's consequence items (extends
   resulting-state-consequence-ownership.test.ts).
8. **P8 noise gates:** skeleton text, punctuation-only, no-op delta, net-zero
   childList, invisible, unresolvable → no items; hydration echo old='""' →
   real content still seeds.
9. **P9 bounds:** seed cap, 50-item cap, overflow accounting; selector pass
   output byte-identical when seeds present and when adapter lacks resolvePath.
10. **P10 renderer:** equality/equals/value → `toHaveValue('…')`; existing
    matrix cases unchanged.
11. **P11 native-select intermediate change (owner-approved 2026-08-21):**
    keyboard-driven native `<select>` fires a trusted `change` per ArrowDown;
    Dropdown completes on the FIRST change → `selectedValue` pins an intermediate
    option ("Low") while the committed choice is later ("high"); generated spec
    replays the wrong choice. Pin: `tests/definitions/dropdown-intermediate-change.test.ts`
    — same lifecycle-family fix as 6C (completion reads the FINAL change, not the first).
    RED today; structural, no timing.
12. **Existing suites stay green:** core-definitions (admin/secret123 blur),
    capture-bugfix Bug 1/Bug 2, ir-bridge fill pins, output-adapter display
    pins, assertion-derivation locator policy + cap, alt-testid stamps,
    state-builder dedup joins, page-content-observer/alt-testid suites.
13. **Clone E2E gate (validation, not vitest):** re-run canonical 29-check gate
    — fill steps ≥1 assertion; soft assertions ≥13 passing; NO skeleton-state
    assertions; counter/collection assertions on id-only widgets; a-slice
    35/35, R3 43/43, Amazon 8/8, ZIP 5/5, PaxAndClass 17/17 regression matrix.

## 7. Risks

- R1 scan cost: bounded (seed cap 24, child walk cap 8, existing item
  bounds — no separate candidate cap; see §2.2 implementation note);
  `scanDurationMs` already reported — watch clone gate timings.
- R2 content-anchored resolution when siblings share text: equivalent
  assertions, bounded, honest.
- R3 higher item counts on churny pages → overflow counts rise: observable,
  bounded, honest.
- R4 description now shows typed value — IR description pins / clone gate
  regexes may need updating to the new expected strings (part of pin work).
- R5 `matchedSelector` sentinel flows to knowledge repository: typed as plain
  string everywhere; documented in patterns.md.

## 8. Out of scope (unchanged)

6B (identity vocab/ranking), 6D.1 definitions, 6D.2 popup anchoring (frozen),
Phase 5b, KL-1, dead-code housekeeping, P1/P2 probes (user-run evidence loop).

## Stage 1 addendum — Understanding-first, three consumers (owner directive 23:41)

Layering rationale (confirmed against code):
- Generation NEVER imports understanding (INV-GEN-8/10, assertion-derivation.ts
  header). Knowledge NEVER feeds generation determinism.
- resultingState has TWO parallel consumers by design:
  1. LEARNING: PageContentEvidenceExtractor (wired in
     src/understanding/pipeline/understanding-pipeline.ts) → ObservedItem →
     entities/outcomes → Dexie repo (cmdrunner_knowledge v30) — SAME SESSION,
     zero wiring: seeded items enter the Knowledge Repository automatically.
  2. EXPLAINING: evidence-renderer.ts renderResultingState (:551+, Phase 4a
     display-only) renders every snapshot item grouped by kind (counters,
     collections, entities, status badges, notifications) under
     "📸 Resulting State (N observed)" — seeded items appear in their kind
     groups with ZERO presentation changes.
  3. DERIVING: deriveStepAssertions — unchanged, reads the same snapshot.
- Therefore 6A does NOT enrich Observed Workflow directly (presentation is a
  projection); it enriches OBSERVATION, and explanation/learning/derivation
  all consume it in their intended roles.

Design principle (owner: "reusable application understanding signals, not
assertion inputs"): seeded items are FULL-FIDELITY WireObservedItems — kind,
domPath, text, numericValue, attributes, visible, uniqueInSnapshot — never
assertion-shaped shortcuts. Every consumer can use them; none is privileged.

New pin ⑧ — display path: renderResultingState(jsdom) includes seeded items
in kind groups; absent seeder → section absent (existing behavior pinned).
New pin ⑨ — knowledge path: PageContentEvidenceExtractor maps seeded
WireObservedItems to ObservedItems (wireToObservedItem round-trip) with
kind+domPath keys — proving repository reusability, not just derivation.

DECISION POINT (owner): optional provenance field
`origin?: 'selector' | 'changed-element'` on WireObservedItem — additive,
optional, wire-compatible (INV-CS1 additive). Value: knowledge curation can
distinguish observed-by-selector vs observed-by-change; cost: touches
shared/page-content-wire.ts (+ ~2 producer sites). Default: DEFER unless
owner wants it in Stage 1.

## Semantic Observation Contract — changed-element → ObservedItem (pre-code, 23:55)

Purpose: define, BEFORE changed-element-seed.ts exists, how a changed DOM
element becomes a semantic observation. Designed for Application Knowledge
Repository learning first; assertion derivation is a downstream consumer.

### Inputs (per window, at captureResultingState time — observation time only)
- The window's OWN accumulated DomChangeSummary set (non-destructive read) +
  SurfaceChanges. Never another window's, never STOP re-drain (ownership guard
  pin ⑦; O6 pin ⑥).
- The settled live DOM via the existing DOMAdapter (path → element resolution).

### Determinism & doctrine
- Seeding is a PURE function of (change summaries, settled DOM). Structural
  decisions only — kind inference NEVER reads clocks/timing fields
  (firstMutationAt etc. remain diagnostics on the summary, unused here).
- Honesty over fabrication: ambiguous resolution or unverifiable identity ⇒
  SKIP (element stays in domChanges raw evidence; nothing is invented).
- Skip ≠ loss: skipped elements remain in the evidence ledger's domChanges.

### Kind-inference ladder (ordered, first match wins)
0. Skeleton/transient filter: class matches /skeleton|loading|placeholder|
   spinner|shimmer/i on target or added/removed symmetric churn ⇒ SKIP (E8).
1. Unresolvable (path matches 0 or >1 live elements) ⇒ SKIP.
2. role=status|alert (self or nearest ancestor) ⇒ notification. Text stored
   verbatim (≤200); downstream asserts PRESENCE only (INV volatile text).
3. Numeric-bearing: characterDataDelta.new (or live textContent) parses as a
   number ⇒ counter. numericValue = parsed; text = verbatim. Identity attrs
   still recorded (E1, E2).
4. Allowlisted identity attribute present (data-auto-id | data-test-id |
   data-test | aria-label via verified-attr) AND non-numeric text ⇒ entity.
   entityId = identity-attr value; entityType = attr-name semantics
   (data-auto-id prefix before '-', else tag-based default) (E6).
5. Non-numeric, short, badge/label-shaped text (≤60) with verified attr ⇒
   status-badge (E3).
6. childList-only change on a container whose own/ancestor #id resolves ⇒
   collection; numericValue = live direct-child count at scan (E5).
7. Anything else (class-only, no #id, no allowlisted attr) ⇒ SKIP (E9).
8. input/textarea/select value or attribute deltas ⇒ SKIP in Stage 1 —
   kind vocabulary has no field kind; explicit boundary, Stage 4 decision
   (field kind + committed-value assertion, gated by failing pin) (E7).

### Item construction (full fidelity — never assertion-shaped)
- kind, domPath (observer path — string-identical to Counter/List signal
  paths for state-builder dedup joins), text (≤200 ws-normalized),
  numericValue, entityId/entityType, attributes (allowlisted only, ≤30),
  visible, uniqueInSnapshot (observer-verified querySelectorAll===1 on the
  allowlisted attr — same Phase 2b rule), matchedSelector = synthetic
  'changed-element:<targetPath>' marker.
- Provenance: origin 'changed-element' (KR curation distinguishes
  observation mode; wire addition is the deferred Stage-1/2 decision).
- Merge discipline: selector items WIN collisions on kind+domPath (seeds are
  the COMPLEMENT — first-match-wins preserved, config order unchanged).

### KR learning mapping (why this is repository-ready)
- Stable identity: kind+domPath (extractor itemKey) + entityId for
  cross-session entity matching.
- Outcome deltas: counter/collection numericValue sequences become outcome
  evidence per interaction (CP episode outcomes).
- Signature evolution: attributes + domPath feed element signatures (6B
  benefits without change).
- Provenance lets curation weight observation confidence later.
- Pin ⑨ proves the extractor round-trip (WireObservedItem → ObservedItem).

### PIN ② CORRECTION (honesty): #id-only INPUTS (E7) are Stage-1 SKIPS —
kind vocabulary boundary. Pin ② re-scoped: fill windows seed their honest
non-input items; the committed-value assertion on the input itself is the
Stage-4 failing-pin gate. Clone FILL-step assertions in Stage 2 come from
window-honest items (e.g. option-list close, count changes), not fabricated
field assertions.

### Examples (9)
E1 span[data-auto-id=cart-count] text 1→2 (attr allowlisted)  → counter,
   numericValue 2, attrs {data-auto-id}, uniqueInSnapshot true  [AdaniOne real]
E2 span#pax_adults text "1"→"2" (#id only, no attrs)           → counter via
   own-#id, numericValue 2, attributes {}
E3 span.ticket-status class flip + text "Confirmed" (attr-verified) → status-
   badge, text "Confirmed"
E4 span[role=alert] characterData (O7 AdaniOne)                → notification,
   text verbatim; presence-only downstream
E5 div#flight-list childList +6 (no text change)               → collection,
   numericValue = live child count, domPath div#flight-list
E6 li[data-auto-id=flight-card] added, text "AI-887 · 02h 30m" → entity,
   entityId flight-card, entityType flight-card/data-auto-id
E7 input#origin attribute delta value ''→'BOM'                 → SKIP (ladder
   8) — Stage 4 field-kind gate
E8 div.skeleton-card added+removed symmetric churn             → SKIP (ladder
   0) — clone gate :205 no-skeleton protection
E9 div.trip-duration text "02h 30m", class-only, no id/attr    → SKIP (ladder
   7) — stays raw evidence; interaction classified later by 6D.1 (int-53)

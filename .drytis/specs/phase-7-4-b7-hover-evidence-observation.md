# Spec: Phase 7.4-B7 — Hover as Evidence-Grounded Observation

**Status:** PROPOSED — audit-amended 2026-08-28 (implementation-readiness audit findings
R-1…R-5 and W-1/W-3/W-5/W-8 folded; amendment log in §13). Specification only; no implementation.
**Supersedes:** `.drytis/specs/evidence-based-hover.md` (confidence-model era — its thresholds,
weights, and `meaningful` promotion are repealed by this spec) and the capture/vocabulary
portions of `.drytis/specs/milestone-c3.2-hover-foundation.md` (its structural window/gesture
mechanics are retained where cited).
**Lineage:** Hover timing audit (12 real-Chrome scenarios) → semantic/evidence-adequacy study →
generic-feasibility determination → conceptual target architecture → contradiction audit
(A-1..A-3, B-1..B-8, amendments 1–6 folded) → final revised architecture → vision challenge
(V1–V8) → approved implementation plan (P1–P4).

---

## 1. Vision alignment

The Application Understanding Engine observes app use like a human. A human who watches a user
hover a "Products" menu does not measure milliseconds — they see *what the application did
because of the hover*: a submenu appeared, a fetch fired, a tooltip rendered, nothing happened.
Meaning is **derived after the fact from recorded consequence evidence**, never asserted at
gesture time by thresholds, vocabularies, or fixed conditions.

**Doctrine constraints (hard, non-negotiable):**

| # | Constraint | Consequence in this spec |
|---|---|---|
| DC-1 | No timing-based semantics | Every dwell/transit/stationary constant is deleted. The only surviving clock is the pre-existing 5-min lifecycle idle timeout (leak protection, produces `abandoned`, never meaning). Adaptive-window quiescence timers are delivery mechanics only — they decide when facts are *flushed*, never whether they *count*. |
| DC-2 | No site-specific vocabulary | `OVERLAY_ROLE_RE`, `OVERLAY_CSS_RE`, nav-ancestor heuristics deleted. Discovery keeps only the existing structural gate `isInteractiveElement` (tags/roles/tabIndex/INTERACTIVE_CLASS_RE), now imported from `src/definitions/patterns.ts` as the single shared source (it already imports only shared types). |
| DC-3 | No fixed meaningfulness condition | `metadata.meaningful` is deleted as a *stored judgment*. The production filter instead applies the evidence-keyed admission rule (§6). |
| DC-4 | No guessing | Unattributed stays unattributed (V1 floor). Sequential-hover reverts may misattribute (V3) — pinned by test, never silently "fixed" by a heuristic. |
| DC-5 | Deterministic-first, AI-last | Everything in this spec is deterministic evidence recording + derivation. No AI component is added or altered. |
| DC-6 | Honesty over fabrication | Gesture-only hovers are recorded but not admitted; IR gains only assertions derivable from recorded facts; KR never invents hover knowledge. |

## 2. Problem (from the audit, with evidence)

- **F-1** `aria-expanded` signal bypassed the 500 ms transit gate → sub-500 ms pass-throughs
  promoted at confidence 100.
- **F-2** Vocabulary asymmetry: `.menu-link` matched overlay evidence but not the interactive
  class gate → hovers never started. "Works sometimes" traced to class-synonym luck.
- **F-3** Silent total loss on every non-leave terminal (STOP interrupt, 5-min idle, mid-hover
  removal) with no Unclassified backstop.
- **F-4** Uncapped confidence stacking (295 observed); only the first signal recorded in
  `evidenceReason`.
- **F-5** Dedup fold keeps first dwell only.
- **F-6** Wall-clock dwell inflates under background-tab throttling.
- **F-7** Zero behavioral evidence: the revealed surface is never recorded; "effect" is inferred
  from the trigger-side attribute flip alone.
- **F-8** Layer starvation: no evidence window (capture-only membership), no stamp eligibility,
  no episode anchoring (not in `DISCRETE_ACTION_TYPES`), no ledger claim, `meaningful` hardcoded
  in the projection filter, no understanding handling, zero KR, IR replays a naked gesture.

## 3. Scope

**In scope:** the Hover interaction type end-to-end — capture, evidence, network attribution,
ledger, definition/terminals, projection/admission, episodes/provenance, KR persistence, IR
assertions, panel presentation.

**Out of scope (explicit):** click-commit of TextEntry (B6.2), `form.submit()` (B6.3), IME
composition, typeahead/debounce non-commit (F4 family — honest no-commit stands), any AI-layer
change, any stamp-expiry redesign (V1's real fix — deferred), provenance child-identity phase 2,
`WORKFLOW_GAP_MS` revision (adjacent doctrine debt, flagged only).

**InteractionType isolation guarantee:** no other type's capture, definition, stamp class,
filter rule, episode membership, KR signature, or IR rendering changes. §9 is the isolation
matrix every phase must re-verify.

---

## 4. Target model (approved final architecture, restated as contracts)

**Hover is an observation, not a judgment.** The definition records the gesture's structural
boundaries and facts; every consumer derives meaning from evidence.

```
gated enter ──► Hover lifecycle ──► lifecycle-held evidence window ──► recorded facts
   │                │                                                        │
   │                ├─ terminals (all structural, §5.3)                      ├─ reveal / insertion / removal
   │                │                                                        ├─ stamped fetch (T1 secondary / T4)
   │                └─ pointer-path facts (subsequent trusted enters)        ├─ nav events
   │                                                                         └─ settle revert (after leave)
   └─► ledger claim (discovered-enters only) ──► Unclassified backstop for non-completed
                                             └─► projection-skip for rescued/completed

STOP ──► admission rule (§6): completed ∧ consequence-bearing ──► production list
              │                                                          │
              ├─ not admitted ──► recorded interaction + panel row (grouped) │
              └─ admitted ──► understanding (outcome voting on real evidence)
                             ├─ episode anchor (decomposed anchor set)
                             ├─ ProvenanceLink surface-reuse (degraded, phase 1)
                             ├─ KR signature + consequenceProfile (schema unchanged)
                             └─ IR: HOVER step + surface-visible assertion (P4)
```

---

## 5. Layer-by-layer changes

### 5.1 Stage B7-P1 — Evidence enablement (purely additive)

**Changes:**

1. **Window eligibility becomes per-lifecycle, not per-event-type.**
   `src/tap/evidence-collector.ts`: the `CAPTURE_ONLY_EVENTS` membership check that today
   excludes `mouseenter`/`mouseleave`/`mousemove` from ever opening a window is replaced by:
   a window may open for a pointer event **iff** a gated-enter predicate (shared
   `isInteractiveElement` from `src/definitions/patterns.ts`) accepts the target. Raw capture
   throttling (`MOUSEMOVE_MIN_INTERVAL_MS = 50`) is untouched — mousemoves still never open
   windows.
2. **Provisional hover windows.** Content script `onAfterEvent` seam (`src/tap/event-tap.ts:64`,
   fired synchronously in the content-script call stack, lines 168–176/247) opens a provisional
   window on a gated enter. The window binds retroactively to the hover lifecycle through the
   existing `LIFECYCLE_BOUND → setHoldOpen` path (`evidence-collector.ts` `handleLifecycleBound`)
   — the same mechanism B6 uses. **R-2 (binding race):** the hover lifecycle is created in the
   service worker only after a message round-trip; under MV3 cold-start or container resume that
   round-trip can exceed the ~300ms companion/settle window, which would close the window
   **before** it ever binds — silent evidence loss. Unbound provisional hover windows therefore
   open with `holdOpen` already set and are closed ONLY by: (a) binding + lifecycle terminal,
   (b) STOP force-close, or (c) pagehide finalize — **never** by settle/quiescence mechanics.
   **R-5 (long gestures):** `holdOpen` suspends AdaptiveWindow `maxDuration` (10s) for both
   unbound provisional and bound hover windows — a 30s mega-menu rest keeps its window open
   until a structural terminal; only displacement, STOP, or pagehide close it. (Verification
   that `holdOpen` actually suspends `maxDuration` is a pinned P1 test in §8.) Both rules are
   delivery mechanics — no clock decides meaning.
3. **Member events = pointer-path facts + terminal event.** For a hover window, member events
   are: the discovery enter, every subsequent trusted `mouseenter` (gated **or not** — an enter
   proves the target was rendered and unobscured; this is the only passive channel that can see
   pure-CSS reveals), and the terminal event. Mousemoves cease to be member events. New bound
   `MAX_POINTER_PATH_FACTS = 20` per window (drop-oldest, count recorded).
4. **`TRIGGER_REMOVED(lifecycleId)`** content→SW notification when the hover target is removed
   from the DOM mid-gesture (MutationObserver fact already flowing; the notification makes the
   terminal observable *because the window exists to receive it*).
5. **Displacement class.** `enforceMaxConcurrent` (`MAX_CONCURRENT_WINDOWS = 5`) keeps
   oldest-first force-close with reason `displaced`, but provisional/unbound hover windows are
   evicted before any window bound to a non-hover lifecycle. A click's evidence window is never
   displaced by hover churn (B-4-adjacent risk closed).
6. **Settle mode on leave.** On the `left` terminal the window stays open through the existing
   adaptive settle (quiescence as delivery mechanics) to record the **revert fact**: attribute
   flip-back or removal of the revealed surface after the pointer left.
7. **Dialog/window.open drain membership (R-3).** The evidence-collector's last-resort
   dialog/window.open stamp drain (`src/tap/evidence-collector.ts` ~1935–1975) defers when a
   candidate owner window exists; its predicate today is `WINDOW_OPEN_EVENTS ∪ {'submit'}` and
   its comments explicitly assume "no window ever opens for a Hover" — an assumption B7-P1
   invalidates. Hover windows join the candidate-owner predicate via the same P1 eligibility
   rule, with two named consequences: (a) a genuinely hover-triggered dialog is now claimed by
   the hover's window close-time read (a feature — previously the stamp was claimed by whatever
   read later, or orphaned); (b) a click-triggered dialog arriving while a hover window is open
   still defers to the click window's close-time read — the click window remains the designed
   claimant. The historical "abandoned Hover steals a stamp" defect class does not return
   because admission gating (not window existence) decides hover visibility. Regression test
   required: click-dialog-during-open-hover (§8).

**Untouched:** definition, terminals, confidence model, `meaningful`, projection filter, ledger,
episodes, KR, IR, stamp classes (pointer events remain stamp-ineligible in P1).

**P1 is invisible by construction:** hover interactions still fail the production filter, so
IR/understanding/KR outputs are byte-identical; the only observable delta is
`behavioralEvidence` present on raw recorded Hover entries.

### 5.2 Stage B7-P2 — Definition, terminals, stamps, ledger, admission (atomic swap)

**5.2.1 Definition rewrite (`src/definitions/hover.ts`)** — observe-only:

- **Deleted:** `CONFIDENCE_THRESHOLD`, `HOVER_TRANSIT_THRESHOLD_MS`, `SUSTAINED_DWELL_MS`,
  `POINTER_STATIONARY_RADIUS_PX`, the confidence accumulator, `evidenceReason`, all overlay/nav
  vocabulary regexes, `metadata.meaningful` as a stored judgment, click-cancellation.
- **Discovery:** unchanged structural gate (shared predicate). One Hover lifecycle at a time
  (global pointer claim) — unchanged.
- **Recorded facts (not judgments):** terminal type, pointer-path fact list, revert fact,
  presence of window evidence classes. Duration remains a recorded *fact* (doctrine bans rules
  on it, not the measurement) for panel display only.

**5.2.2 Terminals (all structural, zero clocks):**

| Terminal | Trigger | endState |
|---|---|---|
| `left` | same-element `mouseleave` → settle mode records revert | `completed` |
| `consumed-by-click` | any click anywhere (click no longer cancels; it is its own interaction; overlap resolved by existing settle-supersession: mutations after a newer window opened belong to the newer interaction) | `completed` |
| `navigation` | `shouldCompleteOnNavigation` hook (B6.1 precedent), commitSignal `'navigation'` | `completed` |
| `target-removed` | `TRIGGER_REMOVED` notification | `completed` |
| `recording-end` | STOP via new optional `completesAtRecordingEnd` declaration consulted by `flush()` (`component-runtime.ts`) | `completed` |
| idle-timeout | pre-existing 5-min `cleanupStaleComponents` path | `abandoned` (leak protection — B-2 resolved: endState split from hook truthiness) |

**5.2.3 Stamp eligibility (A-1/A-2 resolved):**

- Discovery enter stamps **secondary (create-only)** — the `submit`/G5-A precedent. It can
  create a frame's first stamp but can never overwrite a click's, TextEntry's, or DragDrop's
  primary stamp (R14 stamp-steal guard holds for all existing types).
- **R-4 (stamp-site gate feasibility):** `stampClass(eventType, key)` sees only event type +
  key and cannot distinguish a gated discovery enter from any trusted mouseenter. The gate is
  therefore computed at the **dispatcher call site** (`service-worker.ts` ~1740–1770): the
  observed-event payload carries `target.tag`, `target.ariaRole`, `target.className`, and
  `domContext.tabIndex`, and `isInteractiveElement(tag, ariaRole, className, tabIndex)`
  (`patterns.ts:244`, scalar 4-arg signature, shared-types-only import) is evaluated there;
  only a gated trusted `mouseenter` takes the `setLastTrustedActionIfAbsent` secondary path.
  Ungated mouseenters are treated as `ineligible` exactly as today. `stampClass` itself either
  gains an optional gated-enter classification or is bypassed for `mouseenter` at this one call
  site — implementation choice, no contract change for any other type.
- All other mouse events (`mouseleave`, `mousemove`) remain `ineligible`.
- Consequence, named honestly: after the first primary action in a frame, hover-initiated
  fetches ride **T4 interval attribution** (window overlap with uiOwnership horizons) or surface
  as `unattributedConsequences` (panel-visible). T1 for hovers is opportunistic-first-action
  only. This is the V1 bounded gap, documented, not hidden.

**5.2.4 `DISCRETE_ACTION_TYPES` decomposition (A-3 — "five sets wearing one coat"):**

`src/runtime/evidence-ledger.ts:27` export stays (compat), but each consumer switches to an
explicit named predicate; the monolithic set gains no new members:

| Predicate | Members | Consumers |
|---|---|---|
| `LEDGER_APPENDABLE` | click, contextmenu, mousedown, keydown, dragstart, drop, **+ gated `mouseenter` (discovered hovers only)** | ledger `append()` filter |
| `ANCHOR_ELIGIBLE` | `LEDGER_APPENDABLE` **excluding `mousedown`**, + admitted hovers (see §6 — anchoring keys on admission, not raw enter) | episode-builder anchor gate |
| `RUNTIME_CLAIMABLE` | unchanged from today's set | component-runtime absorption/claim step |
| `GESTURE_SUPERSESSION_ELIGIBLE` | today's set **excluding pointer events** | gesture-record supersession (2c) |
| `STAMP_ELIGIBLE` | click, contextmenu, change, drop, keydown(Enter) primary, submit secondary, **+ gated enter secondary** | SW stamp call site |

**5.2.5 Ledger + projection rules (B-1/F-3 resolved):**

- Ledger claims are minted for **discovered hovers only** (the same gated-enter predicate).
  Undiscovered pointer crossings never touch the ledger — no Unclassified flood.
- Projection rule: disposition `pending` hover claims **never** mint an Unclassified twin
  (projection already mints only from `unclaimed`; hover `pending` claims are excluded from
  twin-minting explicitly). Disposition `abandoned` (idle-timeout) hover claims **do** mint the
  twin — the capture-guarantee backstop F-3 demanded.
- Rescued/completed hovers auto-suppress their own twins via `coveredEventIds`
  (trigger enter + memberEvents) — the B6.1 projection-skip mechanism, unchanged.

**5.2.6 Navigation winner election generalization (B-7):**

`flushOnNavigation` ranking generalizes from terminal-Enter-`captureSeq` to **pre-nav
commit-marker ranking**: candidates carrying commit metadata (TextEntry `commitSignal`
'navigation'/'submit'/'network'; Hover commitSignal 'navigation') rank by commit-marker
`captureSeq`; marker-less candidates rank after marker-bearing ones. A marker-less hover loses
deterministically to a marker-bearing TextEntry — B6/B6.1 outcomes preserved byte-for-byte.

**5.2.7 Admission rule (DC-3 replacement — the single semantic gate):**

`filterProductionInteractions` (`src/presentation/output-adapter.ts` Hover branch): delete
`metadata.meaningful === true`; admit iff

```
endState === 'completed'  ∧  consequence-bearing
consequence-bearing ⇔ evidence contains ≥1 recorded fact of class:
  reveal        — surface emergence 'revealed' or attribute-driven reveal fact in this window
  insertion     — domChange childList with addedNodesCount > 0
  removal       — domChange childList with removedNodesCount > 0
  stamped-fetch — network row stamped (T1 secondary) or attributed (T4) to this lifecycle
  nav           — navigation event recorded in this window/own lifecycle
  revert        — settle-mode revert fact after leave
  pointer-reach — trusted enter on element E where E's identity (path/role join, degraded
                  form — B-3) matches an insertion/reveal fact recorded in this same window
```

The `pointer-reach` join is the precision form of the approved "pointer-path-enter" class: a raw
enter on a pre-existing unrelated element is user movement, not application consequence, and
does **not** admit (false-positive boundary). Same shape as the precedented TextEntry
(`userTyped`/`textValue`) and ColorInput (`userAdjusted`) rules.

**Compat bridge (B-4 coupling):** in the same commit, the filter writes derived
`metadata.consequenceClasses: string[]` and continues emitting
`metadata.meaningful = (classes.length > 0)` as a **derived read-only projection** so the panel
keeps rendering during P2→P4; P4 replaces panel reads with the derived field and deletes the
bridge.

**Intended intermediate state after P2:** admitted hovers enter `productionInteractions` →
generic outcome voting runs on real evidence; IR gains honest HOVER steps (no assertions yet);
episodes still skip them (anchoring lands in P3); KR still zero (P3).

### 5.3 Stage B7-P3 — Attribution, episodes, knowledge

1. **Anchoring.** `ANCHOR_ELIGIBLE` admits *admitted* hovers (anchor keys on the admission
   outcome — an abandoned or gesture-only hover never anchors). `episode-builder.ts:296-298`
   filter switches to the predicate. Hover episodes use the frozen signature identity
   `appId|Hover|normalizedTarget|anchorViewId` — signatureKey v1 untouched (INV frozen
   identities).
2. **Provenance (N6 phase 1 — degraded).** The reserved `ProvenanceLink` slot
   (`model-types.ts:331`, non-causal, emits no CausalEdge, never affects confidence — honored)
   emits `surface-reuse` links: hover episode (producer) → click episode whose interaction
   entered/clicked an element matching an insertion/reveal fact in the producer's window
   (path-prefix/role join). Bounded confidence, labeled degraded. Phase 2 (deferred, out of
   scope): bounded (≤20) child-identity snapshot on surface records for exact joins.
3. **KR.** Zero schema change. The mapper already iterates `model.episodes`; hover episodes
   persist as `KnowledgeEpisodeRow`/`KnowledgeEdgeRow` (T1–T4 edges with `EvidenceRef[]`), and
   `KnowledgeActionSignatureRow` accumulates `occurrenceCount` + `consequenceProfile` under
   existing caps (`MAX_CONSEQUENCES_PER_SIGNATURE = 48`, `MAX_BEHAVIOR_SESSIONS_PER_APP = 50`,
   `STALE_AFTER_SESSIONS = 10`, `DIVERGENCE_AFTER_SESSIONS = 3`). Consumers stay read-only
   (7.3 boundary: the KR surface explains; it never alters capture).
4. **V3 pinned, not fixed.** A targeted `leave → enter-next` attribution test asserts and
   documents the known defect candidate: the predecessor's collapse attributes to the successor's
   window under settle-supersession. Test references V3; no heuristic "fix" (DC-4).

### 5.4 Stage B7-P4 — Presentation, IR assertions, full gate

1. **Panel.** Hover rows render evidence-derived badges (per-class chips); gesture-only hovers
   grouped via the existing toggle-row pattern (**grouping never destruction** — D4);
   `unattributedConsequences` surfaced (V1 honest floor); dedup folds become presentation-only
   for gesture-only hovers and are disabled for admitted ones (F-5's data loss scoped away).
   Panel reads switch from `metadata.meaningful` to `consequenceClasses`; the compat bridge is
   deleted.
2. **IR.** `surface-visible` joins `DERIVABLE_KINDS` ({counter, collection, status-badge,
   notification, entity, **surface-visible**}) with locator-honesty skipping (INV-GEN-4): a
   HOVER step gains an assertion only when a derivable locator for the revealed surface exists
   in recorded facts. `MAX_ASSERTIONS_PER_STEP = 3` unchanged. `NOISE_TYPES` unchanged
   ({Scroll, Unclassified}) — admitted hovers already flow; OR-1 click collapsing untouched.
   **P4-amendment (2026-08-29 grounding audit) — ownership-safe `surface-visible`:** the
   revealed-surface fact must be OWNED by the hover's window, not merely contained in it.
   The first-window fact ownership computation (B7-P3 §5.3.2, `factOwner`) is extended from
   hover-producers-only to ALL window-bearing interactions — click episodes enter the map as
   fact claimants (Channel A: a click-revealer's mutations must be owned by the click's
   window, and a hover window merely containing them is not evidence of hover causation).
   **Ownership rule (adversarial, not naive first-reporter):** naive first-reporter keyed on
   anchor order FAILS Channel A Variant 1 — the hover opens BEFORE the click, so the hover
   would claim first-report. The rule that passes: a Hover owns a reveal/insertion fact iff
   (a) the fact was recorded at/after the hover window's open (not replayed pre-open
   history — compare `firstBatchIndex`/`firstMutationAt` against the window's
   `openedBatch`/open epoch, both already recorded on `DomChangeSummary`), AND (b) NO
   click-family anchor (click/contextmenu — the primary-stamp classes) on the same tab has
   `T0 ∈ [hover_open, fact_recorded]`. A click in that interval is the proximate primary
   action; ownership defaults to it. The canonical menu case (pure hover reveal, no click
   inside the interval) still yields hover ownership. Source of truth: ONE shared pass in
   the causal-graph module, consumed at TWO seams: (a) provenance links (unchanged
   semantics for hover producers), (b) the `surface-visible` assertion derivation — a
   Hover mints `surface-visible` ONLY from facts in its OWNED set; facts owned by a click
   window produce no hover assertion (the click's own step remains free to derive them).
   Verified against Channel A Variant 1: the revealer click's T0 lies inside the hover
   window's interval → the click owns the staggered insertions → the hover's re-report is
   replay → owned-nothing → no surface-visible assertion, no exported false `expect`.
   Variant 2 (revealed-child inheritance): same rule — the click that revealed the child
   is inside the interval → hover owns nothing. INV-GEN-4 locator honesty remains AND
   composes: owned ∧ locator-derivable are both required. Known residual (named, not
   fixed — same V3 family): two simultaneous windows with NO primary action between open
   and fact (pure-CSS `:hover` reveals produce no MutationObserver facts anyway — no
   assertion either way); ambient churn during the interval with no click would still
   attribute to the hover (T4-class confidence floor applies, and no assertion is minted
   unless locator-derivable); late consequences after the hover's window closed are still
   not delivered to it (Channel A false-negative mirror, unchanged by this amendment).
3. **Docs.** ROADMAP entry; doctrine notes naming V1–V4 as documented limitations
   (V1 API-tier weakness w/ T4-unattributed floor; V2 accepted flattening of nested sequences;
   V3 defect candidate; V4 no negative knowledge — gesture-only hovers excluded from KR by
   design).
4. **Full verification:** complete suite + tsc 8-error baseline + Infrastructure Gate +
   infra_verifier + reviewer + tester.

---

## 6. Constants introduced / removed

| Constant | Value | Fate |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | 50 | **removed** |
| `HOVER_TRANSIT_THRESHOLD_MS` | 500 | **removed** |
| `SUSTAINED_DWELL_MS` | 3000 | **removed** |
| `POINTER_STATIONARY_RADIUS_PX` | 10 | **removed** |
| overlay/nav regex family | — | **removed** |
| `MAX_POINTER_PATH_FACTS` | 20 | **added** (drop-oldest) |
| `MAX_CONCURRENT_WINDOWS` | 5 | unchanged; displacement preference added |
| 5-min idle timeout | 300000 | unchanged; produces `abandoned` only |
| `DEDUP_WINDOW_MS` | 2000 | presentation-only for gesture-only hovers |

## 7. Honest limitations & trade-offs (carried from the vision challenge — named, not hidden)

- **V1** API pillar weak for hover: post-first-click hover fetches ride T4/unattributed. Real
  fix (stamp expiry) deferred. Surfaced via `unattributedConsequences`.
- **V2** Nested hover sequences (Products → Laptops → sub-menu) flatten into one observation
  with a pointer-path trail; inner triggers are not targets. Accepted.
- **V3** Sequential-hover revert misattribution under settle-supersession. Pinned by test.
  **P4-amendment residuals (same V3 family — named, not fixed):** pure-CSS `:hover` reveals
  produce no MutationObserver facts (invisible to the ownership pass); ambient churn with no
  click in the interval still attributes to the hover (T4 floor, watch metric); late
  consequences arriving after the hover window closed are not delivered to it (delivery ≠
  attribution, unchanged).
- **V4** No negative knowledge: "hovered, nothing happened" is not learnable (gesture-only
  hovers stay out of KR). Named trade-off.
- **V5/V7/V8** Outcome vocabulary flattening, ambient-churn attribution at T4 confidence
  (watch metric added in P4), impoverished intent labels — documented flattenings, unchanged by
  this spec.
- Un-entered, attribute-less CSS reveals remain below the observability line (accepted: the
  pointer cannot report what it never touched).
- Transit hovers become *visible* recorded gestures (panel rows) where today they are silently
  discarded — a deliberate honesty improvement, with D4 grouping to control noise.

## 8. Test plan

**Unit/integration (red-first per phase):**

- **P1:** window opens on gated enter only; binds via `LIFECYCLE_BOUND`; **R-2: unbound
  provisional window survives past companion/settle deadlines — closes only via binding,
  STOP, or pagehide; R-5: `holdOpen` suspends `maxDuration` (10s) — a 30s dwell does not
  force-close the hover window; R-3: dialog-drain deferral includes hover windows in the
  candidate-owner predicate (click-dialog during open hover still defers to the click
  window)**; displacement preference (hover window evicted before click window at cap);
  pointer-path fact recording + cap (W-6: cap enforced at the member-push site,
  `component-runtime.ts:500-501` eventId-guarded push, or in the definition — either, named
  at implementation); `TRIGGER_REMOVED` delivery; reveal/insertion/removal/stamped-fetch/nav
  facts land in hover evidence; mousemoves are not members; **regression: IR/KR/panel outputs
  byte-identical**.
- **P2:** each terminal → endState; `completesAtRecordingEnd` vs idle-abandon split; secondary
  stamp create-only (never overwrites a click primary — R14 suite extended; **R-4: ungated
  mouseenter never stamps; gated enter stamps only via the dispatcher-site gate**); ledger
  discovered-only; **R-1: `pending` never mints a twin (explicit projection-engine
  hover-claim rule), `unclaimed` and `abandoned` mint — truth table covers all three
  dispositions; W-8: hover claims its discovery enter via the lifecycle path
  (`coveredEventIds`), NOT via runtime step-3 absorption**; admission-rule truth table
  (every class × completed/abandoned); `pointer-reach` join (matching insertion admits;
  pre-existing element does not); nav election (marker-bearing TextEntry beats marker-less
  hover; marker-bearing hover beats marker-less hover); compat bridge derivation; **W-3:
  anchor-set change pins that no existing anchor's `triggerEventType` is `mousedown`
  (or keeps `mousedown` in `ANCHOR_ELIGIBLE` if any is found)**; **W-1: the three post-filter
  recovery passes (network drain by `sourceEventId`, attribution-ledger attach, status
  enrichment) run correctly over admitted hovers and do not double-attach or drop hover
  network rows**.
- **P3:** hover anchors an episode; gesture-only/abandoned never anchor; `surface-reuse` link
  emission + degraded confidence; no CausalEdge emitted; KR mapper rows (episode, edges,
  signature occurrenceCount increment); V3 pinning test; caps respected.
- **P4:** `surface-visible` derivation + locator-honesty skipping; panel badges/grouping;
  **W-5: hover dedup removed from `normalizeWorkflow` (pre-filter today — a real normalizer
  behavior change) and re-implemented as presentation-only grouping in the panel renderer;
  regression suite covers the moved behavior end-to-end**; bridge deletion.

**Real Chrome (self-asserting CDP harnesses under `.drytis/`, trusted input only, fresh
recording per scenario — extending the audit fixture set):**

- **P1:** menu/tooltip/rehover/docpath fixtures re-run — evidence present in recording JSON;
  IR/KR/panel unchanged.
- **P2:** aria-flip menu → completed + admitted; sub-500 ms transit over same menu → completed +
  admitted (F-1 fixed by construction); `.menu-link` overlay → discovered (F-2); 3 s
  gesture-only dwell → completed, **not** admitted; no-leave + STOP → completed via
  `recording-end` (F-3 fixed); hover → click reveal-consume → **both** captured, click owns its
  window; idle-abandon (shortened via test seam) → Unclassified twin; B6 + B6.1 harnesses
  byte-identical outcomes (regression).
- **P3:** same menu hovered across two recordings → KR `occurrenceCount` increments; panel KR
  chip renders Hover signature; reveal-consume produces a `surface-reuse` link.
- **P4:** generated Playwright code for a menu scenario contains `hover` + a surface-visible
  `expect`; replay passes; gesture-only scenario generates no hover step.

## 9. InteractionType isolation matrix (re-verified at every phase)

| Type | Capture | Stamps | Ledger | Filter | Episodes | KR | IR |
|---|---|---|---|---|---|---|---|
| Click/Link/Contextmenu | unchanged | primary, protected by create-only hover stamp | unchanged | unchanged | unchanged | unchanged | unchanged (OR-1 intact) |
| TextEntry (B6/B6.1) | unchanged | Enter primary / submit secondary — beats marker-less hover in election | unchanged | unchanged | unchanged | unchanged | unchanged; harnesses byte-identical |
| Dropdown/Expander/Tab/Modal | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged | unchanged |
| Scroll | unchanged | ineligible | unchanged | unchanged | unchanged | unchanged | NOISE_TYPES intact |
| DragDrop | unchanged | drop primary — create-only hover stamp cannot overwrite | unchanged | unchanged | unchanged | unchanged | unchanged |
| Unclassified | unchanged | ineligible | unchanged | twin-mint rules extended only for hover claims | unchanged | unchanged | unchanged |

## 10. Wiring facts verified at P0 (pinned; each gets a pinning test)

1. `onAfterEvent` fires synchronously in the content-script call stack after every observed
   event (`src/tap/event-tap.ts:64,168-176,247`) — the provisional-window seam.
2. `buildIRPlan` consumes `productionInteractions` (`src/background/service-worker.ts:646+`,
   filter at `:446`) — **one admission rule bounds IR, understanding, and KR simultaneously**;
   pinning test asserts the understanding pipeline receives the same filtered list.
3. `isInteractiveElement` lives in `src/definitions/patterns.ts` importing only shared types —
   single shared gate, no two-world drift.
4. `flush()`/`cleanupStaleComponents` choose endState by hook existence today; the new
   `completesAtRecordingEnd` declaration is consulted by `flush()` only (B-2).
5. `enforceMaxConcurrent` force-closes the oldest window with reason `displaced`
   (`src/tap/evidence-collector.ts:1095-1100`) — displacement preference added in P1.
6. Projection mints twins from `unclaimed` **and `pending`** dispositions today (INV-PE-1,
   `src/runtime/projection-engine.ts:17`) — R-1: the `pending`-never-mints rule for hover
   claims is an explicit new projection-engine extension, not a restatement. Disposition
   `unclaimed` and `abandoned` hover claims mint the twin; `pending` does not.
7. `ProvenanceLink` is reserved, non-causal, counted by panel/KR coverage — first emitters land
   in P3.

## 11. Acceptance criteria

- [x] P1: hover lifecycles hold evidence windows; pointer-path facts capped; TRIGGER_REMOVED
      observable; displacement prefers hover windows; IR/KR/panel byte-identical.
      (SHIPPED 2026-08-28 — 6 P1 suites/26 tests; full suite 324/4,954; tsc 8-baseline;
      real-Chrome zz-b7-p1-validate.mjs 10/10; B6+B6.1 harnesses re-verified; baseline-vs-post
      canonical diff = only the three intended evidence deltas; reviewer+infra+tester PASS.)
- [x] P2: all six terminals structural; no dwell/confidence/vocabulary constants remain;
      stamps secondary create-only; ledger discovered-only; pending-never-mints; abandoned
      mints; admission rule replaces `meaningful`; nav election generalized; B6/B6.1 real-Chrome
      harnesses byte-identical.
      (SHIPPED 2026-08-28 — atomic swap + STOP pre-pipeline hover evidence drain
      (STOP_EVIDENCE_DRAIN, S5 no-leave admission) + consuming-click ownership regression fix
      + T4 target-removed lifecycle wiring (completesOnTriggerRemoved +
      completeTriggerRemoved + resolveTriggerRemovedLifecycle R-2 fallback + CS→SW
      TRIGGER_REMOVED notification; reviewer round-1 FAIL remediated, round-2 PASS).
      9 new/updated suites; full suite 334 files / 4,982 tests green; tsc 8-baseline;
      real-Chrome zz-b7-p2-validate.mjs S1–S7 all PASS (S7 target-removed: completed,
      classes ["reveal","removal"], no twin); B6 + B6.1 harnesses re-verified PASS;
      infra PASS after download-server re-sync (public /download md5-matched T4 ZIP);
      README regenerated with install guidance + current checksums; reviewer+tester PASS.)
- [x] P3: admitted hovers anchor episodes; `surface-reuse` links emitted (degraded, non-causal);
      KR persists hover signatures + consequence profiles under existing caps; V3 pinned.
      (Done 2026-08-28: anchor gate switched to isAnchorEligibleInteraction in
      src/runtime/evidence-ledger.ts (ANCHOR_ELIGIBLE = DISCRETE_ACTION_TYPES; Hover anchors
      iff completed ∧ consequenceClasses non-empty) — non-hover anchoring provably
      byte-identical (truth-table + horizon parity pins). New shared pure module
      src/shared/surface-join.ts: deterministic id-exact / chain-degraded / tag-floor-degraded
      joins between recorded DOM-path facts and identity-grammar anchors (no vocabulary).
      causal-graph.ts emits surface-reuse ProvenanceLinks: hover producer → click consumer,
      strictly NON-CAUSAL (no CausalEdge, no registry claims, no confidence change), tab +
      recorded-order guards, deterministic prov-<producer>-<consumer> ids, plus
      FIRST-WINDOW FACT OWNERSHIP (replay boundary): facts are owned by the earliest
      reporting window — INV-C1 global-accumulator replay windows (hover-into-already-open-
      panel) fabricate no links. Pointer-reach admission join fixed to the shared join
      (was real-Chrome-dead exact string equality). KR: zero schema change, mapper
      untouched; hover episodes persist; signatures accumulate under frozen
      appId:sig:hash identity — real-Chrome KR harness (3 sessions): occurrenceCount
      reinforcement 1→2, no key fork; hover-wins-T4 session carries its own
      consequenceProfile entry; reveal→consume sessions count provenanceLinks in the
      session manifest. V3 pinned by two suites (supersession + settle-supersession), not
      fixed. Real-Chrome: zz-b7-p3-validate.mjs 7/7 PASS; zz-b7-p3-kr-validate.mjs PASS;
      B6 + B6.1 harnesses PASS. Suite 341 files / 5,031 tests green; tsc exactly 8
      pre-existing errors. Reviewer PASS (4 cosmetic WARNs remediated: dangling JSDoc,
      stream-of-reasoning comment, no-op alias, ownership-comment wording); tester PASS
      (public surface; README regenerated to the P3 build and re-synced).
      **2026-08-29 post-P4 regression + C-1…C-6 fix:** the P4 ownership authority flip
      zeroed P3 S1/S2 links and KR coverage.provenanceLinks session-wide (consumer
      clicks' `lc-` synthetic windows carried no `openedBatch`, making rule (b)'s
      fact-granularity guard inert). Fixed per the approved amendment (C-1/C-2 capture
      + attach-carry); validated in ONE combined real-Chrome run with P4: S1 links=1,
      S2 links=2, KR coverage.provenanceLinks=1, canonical sv=2, V1 sv=0, V2 sv=0,
      CQ Step 2 PASS, B6.1 PASS. The P3 acceptance state above is restored as
      reproducible on the current tree.)
- [x] P4: panel evidence badges + gesture-only grouping; `surface-visible` assertions with
      locator honesty **AND adversarial window ownership (P4-amendment: facts owned by the
      hover's window only — no in-interval click; shared ownership pass extended to click
      claimants; Channel A Variants 1+2 must yield NO hover surface-visible assertion in
      the real-Chrome harness, canonical menu scenario MUST still yield one)**; docs name
      V1–V4 (+ the amendment's named residuals); compat bridge deleted. (2026-08-29:
      SHIPPED — unit/integration green incl. ownership V1/V2/canonical/replay/legacy pins;
      panel chips + toggle-row grouping + capture-level Hover dedup exemption; bridge
      deleted with ledger/panel deriving admission at read time; real-Chrome matrix ALL
      PASS — canonical 2 assertions (#nav-products, #mega-panel-products as
      expect.soft(...).toBeAttached()), V1 0, V2 0; full suite 350 files / 5,125 tests
      green, tsc at the 8-error pre-existing baseline; reviewer PASS (one docs FAIL
      remediated: doctrine note .drytis/notes/hover-doctrine-v1-v4-b7.md written — V1–V4,
      amendment residuals, ambient-churn watch metric); infra_verifier PASS (0 FAILs,
      2 cosmetic WARNs); tester PASS 5/5 (download surface: zip integrity 40/40 entries,
      served SHA-256 exact match); dist rebuilt v10.9.0 + re-zipped + download re-synced.)

      **2026-08-29 provenance-regression amendment (C-1…C-6) applied.** Final grounding
      audit found the P4 ownership pass had killed P3 surface-reuse links session-wide
      (S1/S2 links=0; KR coverage.provenanceLinks=0): rule (b)'s fact-granularity guard
      went inert on consumer clicks whose `lc-` lifecycle windows carry no `openedBatch`.
      See §13 amendment log for the C-1…C-6 contract. Acceptance for the fix: P3 S1/S2 +
      P3-KR + P4 canonical/V1/V2 PASS **together in one real-Chrome run**; CQ Step 2 and
      B6.1 harnesses green; full suite + tsc 8-error baseline; no new timing heuristic, no
      second ownership authority (the DOM-observer counter stays the single ordinal
      source, read at the same capture-phase instant). P4's own shipped validation results
      above stand as recorded at ship time; this amendment supersedes nothing in them —
      it completes the inputs rule (b) was already specified to consume.)

      **C-1…C-6 IMPLEMENTED & VALIDATED 2026-08-29.** C-1: `clickOrdinals`
      recorded in `onAfterEvent` for click-family events before the
      companion-suppression early return (same synchronous capture-phase read
      of the DOM-observer counter `openWindow` stamps); `finalizeWithoutWindow`
      stamps the `lc-` synthetic window's `openedBatch` from the recorded
      observation-time value. C-2: `carryOrdinal` helper in
      `sw-integration.ts` applied at both attach replacement paths
      (resulting-state replace + score-based richness replace) — a replacement
      can never strip a delivered ordinal. Pins:
      `tests/tap/click-ordinal-capture-c1-c2-b7-p4.test.ts` (4) +
      `tests/understanding/behavior-model/surface-ownership-click-ordinals-b7-p4.test.ts`
      (6). Validation 2026-08-29: full suite 352 files / 5,135 green; tsc
      exactly the 8 pre-existing; ONE combined real-Chrome gate on the rebuilt
      dist — zz-b7-p3-validate S1 links=1/S2 links=2 PASS,
      zz-b7-p3-kr-validate PASS (coverage.provenanceLinks=1),
      zz-b7-p4-validate canonical sv=2 + V1 sv=0 + V2 sv=0 ALL PASS,
      zz-clickqual-step2 PASS, zz-b61-e2e PASS. Same-batch tie (C-3)
      exercised in pins; no P3 link was eaten by it in the live gate.
- [ ] Cross-phase: suite monotonically green; tsc at the 8-error baseline; every phase ships a
      self-asserting CDP harness; no clock, vocabulary regex, or stored `meaningful` judgment
      introduced anywhere.

## 12. Rollout order & abort boundaries

Each stage lands green and independently verifiable; any stage may halt without unwinding its
predecessors. P2 is the atomic swap stage (definition + stamps + ledger + admission in one
commit) — it must not be split. If the admission rule proves too permissive in real-Chrome
validation (transit-noise admissions), the tuning lever is the class list/joins, never a
reintroduced threshold.

---

## 13. Amendment log

**2026-08-29 grounding-audit amendment (P4 blocker):** `surface-visible` made
ownership-safe. The revealed-surface fact must be OWNED by the hover's window, not merely
contained in it. The P3 `factOwner` first-window pass (§5.3.2) is extended from
hover-producers-only to ALL window-bearing interactions — click episodes enter the map as
claimants — and is consumed at a second seam: the `surface-visible` assertion derivation.
**The ownership rule is adversarial, not naive first-reporter:** a Hover owns a fact iff
the fact was recorded at/after its window open AND no click-family anchor on the same tab
has T0 between the hover's open and the fact's recording (a naive earliest-reporter rule
keyed on anchor order FAILS Variant 1 — the hover opens first and would claim first-report;
the in-interval click is the proximate primary action and takes ownership). Rationale:
Channel A Variant 1/2 (hover window inherits a click-revealer's mutations via the INV-C1
global accumulator) would otherwise export a false `expect` in Playwright code — the first
place Channel A false causality leaves KR display and becomes an executable shared
artifact. Ownership composes with INV-GEN-4 locator honesty (both required). Residuals
named, not fixed (V3 family): no-primary-action intervals (pure-CSS `:hover` reveals
produce no MutationObserver facts; ambient churn in a clickless interval still attributes
to the hover at T4 floor); late consequences still not delivered to a closed hover window.
No earlier-phase behavior changes; P1/P2/P3 shipped states are untouched.

**2026-08-29 provenance-regression amendment (P3 blocker, C-1…C-6 — owner approved 2026-08-29):**
The P4 authority flip exposed an input-completeness hole, not a rule defect. Rule (b)'s
fact-granularity guard ("a fact recorded before the click's first post-open batch cannot be
the click's consequence" — `fact.batchIndex < c.openedBatch` ⇒ no veto) is INERT whenever
the click-family anchor's delivered window lacks `openedBatch`. Empirically the click
population splits exactly along the two contracts: revealer clicks (V1/V2) keep collector
windows (ordinals present, guard works, veto fires), while consumer clicks (P3 S1/S2 —
hover reveal → click the revealed item) are consumed by the in-flight hover lifecycle:
their fresh `ev-{click}` window is silently closed by `closeWindowSilently` (the click
eventId sits in the hover lifecycle's member list, so `finalizeForInteraction`'s
window-matching sweep kills it), and the click's own lifecycle later finalizes via
`finalizeWithoutWindow`, whose synthetic `lc-` window carries no ordinal. Every fact in the
hover's window is then vetoed by the window-span rule even when recorded ten seconds before
the click — P3 surface-reuse provenance links died session-wide (0 links; KR
`coverage.provenanceLinks=0`), violating this amendment's own "P3 untouched" clause.

The approved contract:

- **C-1 (capture-time ordinal).** The evidence collector records the DOM-observer global
  batch counter at event-observation time for click-family `WINDOW_OPEN` events (click,
  contextmenu) — in `onAfterEvent`, before the companion-suppression early return, same
  synchronous capture-phase stack (no microtask can advance the counter in between).
  `openWindow` continues to stamp `state.openedBatch` from the same counter; the recorded
  value is used only when the event's own window never opens or is silently closed — the
  lifecycle synthetic (`finalizeWithoutWindow`) and any surviving suppressed-window path
  stamp `window.openedBatch` from it. No timing is introduced: the ordinal is the existing
  counter, read at the same instant the window path already reads it. Same-session click
  ordinals are then always delivered, so rule (b)'s guard is always computable.
- **C-2 (replacement preserves ordinals).** `attachEvidenceToInteraction`'s replace paths
  (resulting-state replace, richness replace) carry over the existing `window.openedBatch`
  when the incoming window lacks it. Ordinals are never destroyed by attach races — the
  late-network display supplement and any thinner replacement cannot strip the boundary.
- **C-3 (same-batch tie is P4-safe).** A fact whose batch equals the click's stamped
  ordinal is unprovable as pre-click ⇒ the veto stands (hover under-claims; a false
  negative only, never a false `surface-visible` assertion). Batch-granularity honesty,
  consistent with the no-timing doctrine.
- **C-4 (absent ordinal = genuinely legacy).** After C-1/C-2, same-session click windows
  always carry ordinals; an absent ordinal therefore means a pre-P4 recorded session, where
  hovers are also legacy and the shipped first-reporter fallback already governs. No new
  fallback branch; `passVerifiedWindow` stays exactly as shipped.
- **C-5 (rule (b) interval stays window-span).** With ordinals present,
  click-in-window ∧ `fact.batch ≥ click.openedBatch` is equivalent at batch granularity to
  the spec-literal "fact recorded after the click". Shipped V1 behavior and its unit pin
  (revealer fixture without ordinal → window-span veto) are untouched.
- **C-6 (standing cross-phase gate).** The P4 real-Chrome validation matrix is extended:
  P3 S1/S2 (links ≥ 1 / ≥ 2) and P3-KR (`coverage.provenanceLinks` counts links; schema
  unchanged) must PASS in the SAME run as canonical (sv ≥ 1) and V1/V2 (sv = 0). Two
  contract harnesses that never run together is precisely how this regression escaped.

Non-goals: no change to rules (a)/(c), `passVerifiedWindow`, the provenance consumer join,
`deriveForOwnedSurfaceFacts`, KR anchoring/signatures, CQ, or B6/B6.1. Click-owned facts
never become surface-visible assertions and never make clicks provenance producers — the
pass only gains veto completeness and container-precedence claims, both conservative
directions.

**2026-08-28 readiness audit:**

| Finding | Severity | Amendment applied |
|---|---|---|
| R-1 projection truth | blocker | §5.2.5 rewritten — pending-never-mints is a new projection-engine hover-claim rule; §10.6 corrected; §8 P2 disposition truth table (pending/unclaimed/abandoned) |
| R-2 binding race | blocker | §5.1.2 — unbound provisional windows holdOpen, closed only by binding/STOP/pagehide; §8 P1 test |
| R-3 dialog-drain membership | blocker | §5.1 item 7 — hover windows join the candidate-owner predicate; click-dialog-during-open-hover regression named; §8 P1 test |
| R-4 stamp-site gate feasibility | blocker | §5.2.3 — gate computed at the dispatcher call site from target.tag/ariaRole/className + domContext.tabIndex; ungated enters remain ineligible; §8 P2 test |
| R-5 maxDuration vs long gestures | blocker | §5.1.2 — holdOpen suspends maxDuration for hover windows; verification pinned as P1 test |
| W-1 post-filter recovery passes | warning | §8 P2 — network drain / attribution-ledger attach / status enrichment exercised over admitted hovers |
| W-3 anchor-set mousedown pin | warning | §8 P2 — pin no-existing-mousedown-anchor or keep mousedown in ANCHOR_ELIGIBLE |
| W-5 dedup location | warning | §8 P4 — normalizer branch removal + panel-renderer re-implementation covered by regression suite |
| W-6 pointer-path cap site | warning | §8 P1 — cap enforcement point named (member-push site or definition) |
| W-8 hover claim wiring | warning | §5.2.5 — lifecycle-path claim via coveredEventIds (B6.1 precedent), never runtime absorption; §8 P2 test |

No code, tests, or fixtures were modified in this amendment pass — specification only. The
spec is now implementation-ready per the audit's recommendation, with every blocker resolved
in-section and every warning carried into the test plan.

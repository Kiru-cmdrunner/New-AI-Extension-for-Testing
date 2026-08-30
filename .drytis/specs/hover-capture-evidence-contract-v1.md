# Hover Capture-Time Evidence Contract — v1

**Status:** DECISIONS LOCKED — implementation-ready pending final owner approval of this rev. No implementation until approved.
**Date:** 2026-08-30 · **Rev 2.1** (candidate/baseline doctrine, R-I independence case, universal evidence disclosure; D1/D2/D3 resolved)
**Branch:** `capability-surgical-removal`
**Predecessor specs:** `phase-7-4-b7-hover-evidence-observation.md`, `hover-capture-generic-fix-v1.md`, `click-capture-qualification-v1.md`
**Root-cause audit:** this conversation, 2026-08-30 (read-only trace; findings RC-A…RC-F below)
**Related notes:** `hover-doctrine-v1-v4-b7.md`, `capture-model-exclusion-first-audit-2026-08-26.md`

---

## 0. One-line summary

Hover becomes a **capture-time earned classification** with a frozen qualification
record and a recorded reason — mirroring Click Qualification v1.2 — and a physical
click can **never** become, hide inside, or disappear with a Hover.

```
physical mouseenter/click
  → immutable raw capture (facts, frozen at dispatch)
  → mouseenter = Hover CANDIDATE (not automatically a Hover)
      · baseline snapshot recorded AT ENTER
  → NEW, target-local evidence observed in the enter's own window
      · evidence that did NOT hold at the baseline
  → capture-time Hover verdict (evidenced | gesture-only) + deterministic reason
  → STOP only PROJECTS the recorded verdict (never decides it)
```

The anti-pattern being retired:

```
physical event → guessed interaction ("looks hoverable") → STOP-time cleanup
```

**Hover is a candidate, never an assumption.** A trusted `mouseenter` on a
hover-shaped anchor makes the interaction a **Hover candidate** — the type is
not yet claimed. The classification is earned later, only if **new, target-local
evidence** appears in the enter's own observation window relative to the
**baseline recorded at enter**. Absent that evidence the record stays
`gesture-only` — honestly, visibly, with a reason.

---

## 1. Problem (audited root causes)

Manual exploratory testing found: a physical click on a dropdown icon can be
represented as **Hover**, or as **Hover + Click**, and at STOP the Hover is
reconciled away and the real **Click disappears with it**.

The read-only audit traced the full lifecycle
(`event-tap → ledger → component-runtime → interaction → STOP projection/IR`)
and located the mechanisms:

| ID | Location | Mechanism |
|----|----------|-----------|
| **RC-A** | `src/definitions/hover.ts:99` + `src/runtime/component-runtime.ts:431-448` | `HOVER_TERMINAL_EVENTS` includes `click`/`contextmenu` **unconditionally**. The `memberEvents.pop()` that keeps the click independent only fires when the hover is the click's FIRST owner (`!handled`). When a lifecycle above the hover absorbs the click first, the click **stays a Hover member**, discovery never runs for it, and `completeComponent` **claims the click's ledger row for the Hover** (`absorbed → claimed` is terminal and irreversible). |
| **RC-B** | `src/tap/event-tap.ts:245-260` (RC-1) | The enter resolves via `resolveHoverTarget()`; the click resolves via `resolveTarget()` — **divergent anchor policies**. One physical act can yield two identities, producing the Hover+Click pair and defeating elementKey joins. |
| **RC-C** | `src/tap/evidence-collector.ts:536-547` | Companion suppression (300 ms) gives the consuming click **no evidence window of its own**; the hover's provisional window captures the click's consequences, which then serve as the hover's admission evidence. |
| **RC-D** | `src/runtime/projection-engine.ts:317-342` | `coveredEventIds` is built from completed interactions' `triggerEvent` + `memberEvents` **before** admission runs. A click sitting in a completed Hover's members suppresses its Unclassified twin. If the Hover is then dropped by admission, the click has **no carrier left**. |
| **RC-E** | `src/presentation/output-adapter.ts:67-178` | Hover admission = `deriveConsequenceClasses().length > 0`, derived **at STOP** from window contents. `insertion`/`removal` fire on `addedNodesCount > 0` **anywhere** in the window — global DOM churn qualifies a Hover. Pure-CSS reveals (no MutationObserver facts) conversely yield zero classes. This is the `guessed interaction → STOP-time cleanup` shape. |
| **RC-F** | `src/generation/ir-bridge.ts:98` | Unclassified (incl. CQ-invalid clicks) is dropped from the IR by `NOISE_TYPES` (D2) — the last hop where a click that lost its card also loses its replay step. |

**Dead seam found (to be revived):** `src/sidepanel/understanding-badge.ts:123`
already renders `why: hover evidence — ${metadata.evidenceReason}` for Hover —
but no code writes `metadata.evidenceReason` (deleted in B7-P2 as a "stored
judgment"). The DatePicker why-line
(`why: detected via gridcell children`, `understanding-badge.ts:144-147`) proves
the renderer pattern works; this contract generalizes it to a **per-interaction,
capture-time recorded reason**.

**Evidence screenshot (2026-08-30, `userDocs/image_280af002.png`):** DatePicker
card `int-44` shows `why: detected via gridcell children` alongside 14 DOM
changes and 5 network rows — classification earned by a structural fact while
global evidence remains display-only. Hover must adopt exactly this shape.

---

## 2. Doctrine (normative)

1. **D-HEC-1 (Immutability).** Every trusted physical event is captured once,
   frozen, and never rewritten. Ledger dispositions may advance
   (`pending → absorbed → claimed|unclaimed`) but no later stage may change an
   event's type, target identity, or facts.
2. **D-HEC-2 (Earned semantics).** A Hover semantic type is **earned** by
   explicit, **new**, target-local evidence recorded in the enter's own evidence
   window — evidence that **did not hold at the enter-time baseline**.
   Affordance (shape/CSS `:hover` rules) is necessary but never sufficient.
   Pre-existing visible elements, global DOM/network activity, dwell time, and
   unrelated mutations never qualify a Hover.
3. **D-HEC-3 (Recorded reason).** Every Hover carries a recorded
   `evidenceReason` explaining **why** it was classified — structural
   vocabulary only (W3C roles/attributes, CSS facts, join methods, terminals).
   No selectors, no URLs, no site tokens, no text mappings.
4. **D-HEC-4 (Click precedence).** A trusted click/contextmenu is **never**
   property of a Hover: never a Hover member, never a Hover-claimed ledger row.
   A click's representation and fate are independent of Hover qualification.
5. **D-HEC-5 (Honest absence).** Without earning evidence, the record says
   `gesture-only` with a reason — it is never silently reclassified, filtered at
   capture, or "cleaned up" at STOP.
6. **D-HEC-6 (STOP projects, never judges).** STOP finalizes evidence delivery
   (ordering mechanics) and projects the recorded verdict. No STOP-stage code
   path may derive, override, or invalidate a Hover classification.
7. **D-HEC-7 (No special cases).** No hardcoded selectors, site-specific rules,
   text mappings, or per-site vocabularies anywhere in the contract. All joins
   are structural (identity ↔ recorded path/role) via the shared surface-join
   module.
8. **D-HEC-8 (Candidate, not assumption).** `mouseenter` = Hover **candidate**.
   The runtime may form the lifecycle (pointer-path facts, terminals, dedup
   exemption all behave as today), but the semantic type is provisional until
   the capture-time verdict is computed at window close. Nothing downstream of
   capture may treat an unevidenced candidate as a confirmed Hover.
9. **D-HEC-9 (Universal evidence disclosure).** **Every interaction type** —
   not only Hover — must expose its available AND unavailable evidence
   (DOM changes, visibility changes, new surfaces, collections, counters,
   network rows, etc.) and explain its classification from recorded evidence,
   in the DatePicker's style (`why: detected via gridcell children`). Evidence
   disclosure is presentation-layer only: it reads recorded facts and never
   influences classification or admission.

---

## 3. Scope

**In scope**
- Hover discovery/anchoring at capture (enter path only).
- HoverQualification record: capture, freeze, transport, persistence.
- Click-precedence enforcement in the runtime member/claim mechanics.
- Anchor unification so Hover and Click identities join.
- Hover admission reading the recorded verdict.
- Renderer why-line for Hover (existing seam).
- **Enter-time baseline capture** (§4-T1b) for new-evidence determination.
- **Universal evidence disclosure** for all interaction types (§9b) —
  presentation-only.
- Tests: unit pins + real-Chrome matrix.

**Out of scope (explicitly)**
- IR representation policy for Unclassified/CQ-invalid clicks (D2 NOISE_TYPES)
  — RC-F is documented and pinned, changing it is a separate decision.
- Attribution of click-window consequences to Click interactions (RC-C's
  suppression stays; Clicks have no consequence-based admission).
- TextEntry/Dropdown/DatePicker/other definitions' trigger logic.
- F4 fact-level causal stamps, KR admission semantics, stamp-expiry redesign
  (B7 V1 limitation stays open).
- Any downstream filtering as a "fix" — prohibited by this contract.
- Changing any NON-Hover type's classification semantics (D-HEC-9 disclosure is
  presentation-only; no other type's classification logic moves).

---

## 4. Fact tiers

All facts are captured/frozen at their natural instants and are the ONLY inputs
to the verdict. Nothing is re-derived from the live DOM at STOP.

### T1 — Physical (necessary, never sufficient)
- Trusted `mouseenter` on raw element R (dispatch instant).
- Full D1 `ElementIdentity` of the resolved anchor A.
- `captureSeq`, `pageId`, `captureOrigin`, timestamp.

### T1b — Enter-time baseline (NEW, normative)
At the gated-enter instant, the content script records a **baseline snapshot**
against which all later evidence is compared:

- **T1b-1 Owned-surface baseline.** For each element of the owned surface set
  (§6.1): its recorded identity, its reveal-state attributes
  (`aria-expanded`, `open`, `aria-selected`, `aria-checked`, `aria-hidden`,
  `hidden`), its visibility-computed facts (`display`/`visibility` when already
  captured), and its DOM-connected state.
- **T1b-2 Owned-surface membership.** The set of surfaces already present
  (path/identity) — so a surface that merely *becomes visible later* is NOT
  "new" unless it emerged after the baseline.
- **T1b-3 Scope of the baseline.** The baseline covers **only the owned surface
  set** — not the document, not global state. It is a local fact vector, not a
  page snapshot.

**Normative baseline rule (T1b-R):** a T3 earning fact must express a
**transition** — an attribute flip, a surface emergence, a revert — where the
**"from" state is taken from the baseline and the "to" state from the window's
recorded facts**. A state that already held at baseline is NOT evidence of a
hover's effect. Concretely: an element that is *already visible at enter* and
merely stays visible earns nothing; a surface already in the DOM at enter whose
`display` flips from `none` only AFTER the enter **does** earn `reveal` (that is
a genuine target-local transition) — the never-qualify list is about states,
not transitions.

### T2 — Affordance (necessary, never sufficient)
- `isHoverDiscoveryShape(A)` — declared affordance (tag/role/tabindex/
  aria-haspopup/click-handler-attribute/pointer-cursor), unchanged (RC-8).
- `hoverReveal` CSS fact — a `:hover` rule that *sets a reveal property* matches
  A or an ancestor within depth 5 (G3, unchanged).
- **Change (T2-a):** on the gated-enter capture path, ALSO record the
  click-policy anchor: `clickAnchor = resolveTarget(R)` computed with the
  enter's composed path at the same instant (see §7). Recorded fact only.

T2 says "this element is hoverable". It never earns `evidenced`.

### T3 — Earning evidence (the contract's core)
At least **one** NEW, target-local transition, recorded in the enter's own
evidence window, relative to the T1b baseline (§4-T1b):

| Class | Earning fact (ALL target-local, ALL new relative to baseline) |
|-------|--------------------------------|
| `reveal` | A state attribute flipped open — `aria-expanded`/`open`/`aria-selected`/`aria-checked` `false→true`, `aria-hidden` `true→false|null`, `hidden` removed — on an element of the **owned surface set** (§6.1), where the `false`/`true` values are the **baseline → window** transition; OR a `newSurfaces` entry with `emergence === 'revealed'` joined to the owned surface set. Transient flips reverting before window close do not count (unchanged). |
| `pointer-reach` | A later gated enter whose element identity joins an **insertion or reveal fact recorded in the same window** (B7-P3 B-3 parity join via `joinsRecordedSurface`). The joined insertion/reveal must itself be baseline-relative (post-enter). |
| `revert` | On a same-element `mouseleave` terminal, a joined revealed surface flips back (`display →none`, `visibility visible→hidden`, `aria-hidden false→true`) — the revert fact is inherently a post-leave transition, so it is baseline-relative by construction. |

**NEVER qualifies (exhaustive, normative):**
- `addedNodesCount > 0` / `removedNodesCount > 0` **outside** the owned surface
  set — global DOM churn does not earn Hover.
- Any `networkActivity` row (telemetry, prefetch, ads, analytics).
- `dwellMs` or any timing/duration fact.
- Mousemove counts / pointer jitter.
- Navigation events in the window — consequence metadata only, **never an
  earning class (Decision D1, locked)**.
- Page title/favicon/spinner churn, animation frames outside the owned set.
- Element text content, class-name vocabularies, URLs, or site tokens.
- **Any state that already held at the T1b baseline** — pre-existing visible
  elements, an already-open surface, an already-expanded attribute. Existing
  state is context, never evidence of the hover's effect.
- **Unrelated mutations** — any mutation not joined to the owned surface set,
  regardless of type or count.

### T4 — Disambiguation
- Trusted `click`/`contextmenu` whose `elementKey(target)` equals the hover's
  anchor key or `clickAnchor` key (§7). Drives the Click-precedence terminal
  fact; never earns `evidenced`.

---

## 5. The `HoverQualification` record

Computed **once**, at hover-window close (the terminal instant — leave, consumed,
target-removed, recording-end drain), as a **pure function of the window's
recorded facts**. Frozen (deep) and transported on the delivered evidence; the
Hover definition copies it into `metadata` verbatim at `buildResult`.

```ts
interface HoverQualification {
  /** The verdict. 'evidenced' ⇔ ≥1 T3 earning fact held. */
  verdict: 'evidenced' | 'gesture-only';

  /** Which earning class fired (null ⇔ gesture-only). */
  evidenceClass: 'reveal' | 'pointer-reach' | 'revert' | null;

  /**
   * Structural reason string, e.g.:
   *   "reveal: aria-expanded false→true on joined [role=button] descendant"
   *   "pointer-reach: enter joined insertion target via surface-join"
   *   "revert: display none on leave of anchored surface"
   *   "gesture-only: no target-local consequence in enter window"
   * Vocabulary: attribute/role names, join method, terminal names. NOTHING else.
   */
  evidenceReason: string;

  /** Anchor-resolution facts (recorded at enter capture, echoed here). */
  anchorFacts: {
    resolution: 'self' | 'ancestor-lift' | 'reveal-target' | 'body';
    anchorKey: string;        // elementKey(A)
    clickAnchorKey: string;   // elementKey(resolveTarget(R)) — §7
    hoverReveal: boolean;     // T2 CSS fact probed?
    shaped: boolean;          // isHoverDiscoveryShape(A)
  };

  /** Window facts the verdict was computed from (counts, no payloads). */
  factSummary: {
    domChangesInOwnedSet: number;
    domChangesTotal: number;
    newSurfacesJoined: number;
    pointerPathEnters: number;
    networkRows: number;      // recorded, never qualifying
  };
}
```

Rules:
- **R-Q1.** Computed at window close in the content script (where the DOM facts
  were recorded); persisted with the delivered evidence. Never recomputed.
- **R-Q2.** Frozen (`Object.freeze` deep), like `ClickQualification` (§10.3 of
  CQ v1.2).
- **R-Q3.** `evidenced` ⇔ at least one baseline-relative T3 transition. There
  is no score, no threshold, no confidence.
- **R-Q4.** `evidenceReason` for `gesture-only` is mandatory and honest —
  the record explains what was looked for and not found.
- **R-Q5.** The record rides: window close → delivered evidence → interaction
  `behavioralEvidence` → `metadata.hoverQualification` (+ the flat
  `metadata.evidenceReason` for the existing renderer seam).
- **R-Q6.** STOP may not mutate it. Projection copies, never edits.
- **R-Q7.** `evidenceReason` is **deterministic** — a pure function of the
  recorded fact vector (same facts ⇒ same string), so it is stable across
  replays and diffable in tests. **Max 200 characters (Decision D3, locked)**;
  any truncation is deterministic suffix-omission, never re-wording.
- **R-Q8.** The verdict computation reads the T1b baseline for every `from`
  state; a missing baseline entry degrades honestly to `gesture-only` (never
  fabricates a transition).
- **R-Q9.** Legacy sessions (recorded before this contract): rows without a
  `hoverQualification` record default to `gesture-only` with the legacy
  reason. **No retroactive qualification, no consequence-class fallback**
  (Decision D2, locked).

---

## 5b. Normative case: Hover → revealed item → Click (independence)

**The reference scenario:** *Hover "Services" → menu reveals "Book Flight" →
Click "Book Flight"* must produce **two independent interactions**:

1. **Hover = Services** — `evidenced`, with an evidence reason explaining **what
   it revealed** (e.g. `reveal: aria-expanded false→true on joined descendant`
   or, for a surface-emergence reveal,
   `reveal: surface emerged [role=menu] joined to anchor`).
2. **Click = Book Flight** — its own interaction, its own ledger row, its own
   evidence window rights, its own card and IR step.

**Normative rules:**

- **R-I1 (No absorption).** The Click on the revealed item must never absorb,
  replace, rename, or delete the Hover. The Hover's identity, target, trigger,
  verdict, and evidence are untouched by the click's existence.
- **R-I2 (No reverse absorption).** The Hover must never claim, host, or
  subsume the Click — the click is not a Hover member, not a Hover-claimed
  ledger row (§8), and its Unclassified twin is never suppressed by the Hover
  (RC-D closed by R-C1).
- **R-I3 (Both recorded).** Both interactions appear in the panel and both are
  IR-represented (Hover HOVER step iff admitted; Click CLICK step). Neither
  ordering, dedup, subsumption, nor admission may drop either.
- **R-I4 (Evidence independence).** The reveal evidence belongs to the Hover's
  window (T3, baseline-relative). The click's own consequences (menu closing,
  navigation, etc.) belong to the click's own representation — companion
  suppression (RC-C) must not transfer the click's effects into the Hover's
  evidence or vice versa.
- **R-I5 (Generic).** This case is a **generic structural guarantee** (§8 +
  T3), not a Services/Book-Flight-specific rule. No vocabulary, selector, or
  text mapping may appear anywhere in the implementation of it. Any test
  fixture exercising it uses arbitrary structural markup.
- **R-I6 (Order preserved).** Interactions are emitted in capture order
  (existing behavior); the Click after the Hover must not reorder or merge
  them.

---

## 6. Target-locality: the owned surface set

### 6.1 Definition (per hover window)
`O(w)` — the owned surface set of window `w` — is computed from **recorded
facts only**:
1. The anchor A itself (its recorded identity/path).
2. DOM descendants of A at capture (derived from recorded paths, not live DOM).
3. Any surface whose recorded `targetPath`/identity **joins** A via the shared
   `joinsRecordedSurface` module (B7-P3 B-3 parity join).
4. Containment-proven semantic children (the generic
   `semanticChildRoles`/`semanticChildTags` mechanism — registry-driven, not
   site-specific).

No timing, no class vocabularies, no global document scans.

### 6.2 Consequence classes vs earning classes
`deriveConsequenceClasses` (output-adapter) remains as a **display/provenance
derivation** for all types. For **Hover admission it is demoted**: the earning
decision is the frozen `hoverQualification.verdict`. Global `insertion`/
`removal` classes may still be *displayed* as consequences; they can no longer
*qualify* a Hover because earning requires the §6.1 join.

---

## 7. Anchor unification (Hover ↔ Click joinable identity)

**Problem (RC-B):** enter uses `resolveHoverTarget`, click uses `resolveTarget`
— divergent anchors for one physical act.

**Contract:**
- **R-A1.** At gated-enter capture, record BOTH:
  - `anchorKey = elementKey(resolveHoverTarget(R, revealTarget))` (hover
    anchor, unchanged), and
  - `clickAnchorKey = elementKey(resolveTarget(R))` computed on the enter's
    composed path at the same instant (T2-a).
- **R-A2.** The **join set** for a hover = `{anchorKey, clickAnchorKey}`. Any
  click/contextmenu whose `elementKey(target)` ∈ join set is the
  **same-physical-act click** (T4).
- **R-A3.** Click resolution itself is UNCHANGED — CQ v1.2's click-lifting
  (`resolveTarget`) is frozen and untouched. Unification is achieved by
  recording the click-side anchor on the enter, never by changing click
  resolution.
- **R-A4.** `anchorFacts.resolution` records which hover strategy produced A
  (`self` / `ancestor-lift` / `reveal-target` / `body`) so divergent-lift cases
  are auditable in the panel.

---

## 8. Click precedence invariant (runtime mechanics)

Normative rules (implementation maps to `component-runtime.ts` step 3 +
`hover.ts`):

- **R-C1.** A trusted `click`/`contextmenu` is **never** pushed onto a Hover's
  `memberEvents`, and never claimed by a Hover interaction
  (`hasLedgerLife`-driven `setDisposition(...,'claimed', <Hover>)` must be
  structurally impossible for click-family rows via Hover).
- **R-C2.** `terminal: 'consumed-by-click'` remains a recorded **fact** on the
  Hover (completion terminal, unchanged metadata shape).
- **R-C3.** The completing-event pop for a **non-retaining** definition
  (`retainsDiscreteEvents === false`) completing on a discrete event becomes
  **unconditional** — the `!handled` carve-out no longer applies to that case.
  Rationale: the event is never the non-retaining definition's property, so the
  push must always be undone. `handled` itself is still only ever
  OR-ed (`handled = handled || retainCompletingEvent`), so a lifecycle ABOVE
  that already absorbed the click keeps `handled === true` and no twin is
  minted — **B6/B6.1 semantics preserved byte-for-byte** (pinned by the
  existing B6 harness).
- **R-C4.** Consequence: a click always ends in exactly one of:
  (a) trigger/member of a completed **non-Hover** interaction,
  (b) claimed by a prior gesture record (S1'/3b — unchanged), or
  (c) pending/unclaimed → projected as an Unclassified card (incl. CQ-invalid
  with `invalidityCauses`).
  **Never** solely inside a Hover. (Formalized as guarantee HEC-G, §12.)
- **R-C5.** `coveredEventIds` (projection) therefore can never suppress a
  click's twin via a Hover — R-C1 makes it structurally impossible.

---

## 9. STOP semantics (projection only)

May do:
- Deliver/close open windows (drain mechanics, unchanged S5).
- Project completed interactions + Unclassified twins (unchanged M5).
- Apply `isProductionInteraction` reading the **recorded** verdict:
  `Hover admitted ⇔ endState==='completed' ∧ metadata.hoverQualification.verdict==='evidenced'`.
- Keep R-1 (pending gated mouseenter never mints a twin) and F-5 (Hover exempt
  from capture-level dedup) exactly as-is.

May NOT:
- Derive, recompute, override, or invalidate a Hover classification.
- Reassign event ownership, rewrite dispositions of terminal rows, or detach
  members from interactions.
- Filter a physical click out of the ledger's representation guarantee.

Panel: gesture-only Hovers remain visible, grouped behind the toggle
(V4 presentation-only grouping, D4), now showing the capture-time
`evidenceReason` instead of a render-time "not meaningful" guess.

---

## 9b. Universal evidence disclosure (all interaction types)

**Doctrine D-HEC-9 made concrete.** Every interaction type — Hover, Click,
Dropdown, DatePicker, TextEntry, Checkbox, RadioButton, Slider, ColorInput,
FileUpload, Tab, Link, Modal, Expander, DragDrop, KeyboardShortcut, Scroll,
Navigation, Unclassified — must expose, in its recorded representation, **what
evidence exists and what does not**, and explain its classification from
recorded evidence, in the DatePicker's style.

### 9b.1 The `evidenceDisclosures` block
A presentation-oriented block computed at emission/projection time from
**recorded facts only** (never from live DOM), shape:

```ts
interface EvidenceDisclosures {
  /** Human/structural summary of the recorded evidence. */
  domChanges:   { available: boolean; count: number; inOwnedSet?: number };
  visibilityChanges: { available: boolean; count: number };
  newSurfaces:  { available: boolean; count: number; joinedToTarget?: number };
  collections:  { available: boolean; count: number };   // entries with structured collections
  counters:     { available: boolean; count: number };   // aggregated counters
  network:      { available: boolean; count: number };
  navigation:   { available: boolean; count: number };
}
```

`available: true` ⇔ the interaction's window recorded ≥1 row of that kind.
Counters are honest counts, never thresholds or scores.

### 9b.2 The why-line for every type
Every type's panel card renders a why-line derived **exclusively from recorded
metadata keys the definitions already write** (DatePicker's
`why: detected via gridcell children` is the canonical example). Rules:

- **R-E1.** The why-line explains **why the interaction was classified** as its
  type — from recorded evidence, structural vocabulary only.
- **R-E2.** For Hover: `why: hover evidence — <evidenceReason>` (existing seam,
  revived).
- **R-E3.** For all other types: derived from each definition's existing
  recorded facts (e.g. DatePicker → semantic children shape; Dropdown →
  containment-proven option join; TextEntry → recorded keys/values). Where a
  type has no recorded reason key today, the why-line renders nothing until
  that definition gains one — **honesty over fabrication** (no invented
  defaults). A follow-up backlog item, not a Hover-contract requirement.
- **R-E4.** Disclosures never influence classification, admission, IR, or KR
  semantics — presentation only.
- **R-E5.** Unavailable evidence is disclosed as unavailable (`available:
  false`), not omitted or hidden — users see the full honesty picture
  (mirrors the DatePicker card: 14 DOM changes shown, 5 network rows shown,
  classification independent of them).

### 9b.3 Source of truth
The disclosures read the interaction's `behavioralEvidence.applicationEvidence`
— the same recorded structure `deriveConsequenceClasses` consumes today — plus
`metadata.hoverQualification` for Hover. Nothing new is captured; the contract
requires the **exposition**, not new facts.

---

## 10. Preserved contracts (verification obligations)

| Contract | Obligation under HEC v1 |
|---|---|
| **CQ v1.2** | Frozen vector, universal pre-gate, `provably-invalid` handling — untouched. Click resolution (`resolveTarget`) untouched (R-A3). |
| **B6/B6.1** | Twin-Click prevention for retaining types — untouched; the unconditional pop is provably twin-safe (R-C3) and must be pinned by the existing B6 harness (IR `[fill, click, navigate]` etc.). |
| **B7-P1** | Pointer-path member facts, `applyMemberPolicy` (mousemove pop, MAX_POINTER_PATH_FACTS drop-oldest) — untouched. |
| **B7-P2** | Terminal vocabulary (`left`/`consumed-by-click`/`navigation`/`target-removed`/`recording-end`), nav commit marker, R-1 — untouched. |
| **B7-P3** | Surface-join module is REUSED as the join authority (§6.1) — no new matcher. |
| **B7-P4** | Provenance/ownership seams (C-1 ordinals, F-3 backstop, F-5 dedup exemption) — untouched. |
| **B7-P5 / P3/P4 fixes** | Ownership-safe derivations, honest degradation — untouched; `deriveConsequenceClasses` demoted for Hover admission only. |
| **R-1** | Pending gated enter never mints an Unclassified twin — untouched. |
| **F-5** | Hover exempt from capture-level dedup — untouched. |
| **M5 / capture guarantee v2** | Projection authority, Unclassified floor — extended by HEC-G (§12), never weakened. |

---

## 11. Change map (files, NO code yet)

| File | Change |
|---|---|
| `src/shared/component-types.ts` | Add `HoverQualification` type (§5). |
| `src/tap/event-tap.ts` | Gated-enter path: record `clickAnchor` + `anchorFacts.resolution` (T2-a, R-A1). |
| `src/tap/evidence-collector.ts` | At hover-window close: compute + freeze `HoverQualification` (pure, recorded facts only); attach to delivered evidence. |
| `src/definitions/hover.ts` | `buildResult`: copy qualification into `metadata.hoverQualification` + flat `metadata.evidenceReason` (revives the dead renderer seam). Terminal/membership semantics per §8. |
| `src/runtime/component-runtime.ts` | Step-3 completing-event pop: unconditional for non-retaining definitions on discrete events (R-C3), scoped so retaining definitions are byte-identical. |
| `src/presentation/output-adapter.ts` | Hover admission reads the recorded verdict (§9); `deriveConsequenceClasses` demoted for Hover admission. Add `buildEvidenceDisclosures` (§9b, presentation-only). |
| `src/sidepanel/understanding-badge.ts` | No logic change expected — verify the existing `evidenceReason` path renders; extend only if the reason needs truncation. Render `evidenceDisclosures` availability row (§9b). |
| `tests/…` | New pins + regression guards per §14. |

---

## 12. Acceptance criteria

Implementation is complete only when ALL hold:

**Capture & record**
- [ ] **AC-1** Every Hover interaction carries `metadata.hoverQualification` with `verdict`, `evidenceClass`, `evidenceReason`, `anchorFacts` (incl. both anchor keys) — verified on unit fixtures and real-Chrome dumps.
- [ ] **AC-2** `verdict === 'evidenced'` iff ≥1 NEW, baseline-relative, target-local T3 transition held at window close; no threshold/score/confidence exists anywhere in the pipeline.
- [ ] **AC-3** `evidenceReason` for `gesture-only` is always present and states what was absent (e.g. `gesture-only: no target-local consequence in enter window`).
- [ ] **AC-4** The record is frozen and byte-identical from window close through panel render (STOP/projection never mutate it — property test).
- [ ] **AC-5** Gated enters record `clickAnchorKey` (R-A1) and `anchorFacts.resolution`.
- [ ] **AC-20** Enter-time baseline (T1b) recorded for every gated enter: owned-surface state attributes + membership; verdict transitions always read `from`-state from the baseline. Pre-existing visible elements / already-open states never earn `reveal` (unit fixtures: baseline-expanded surface ⇒ `gesture-only`; surface flipping open post-enter ⇒ `evidenced`).
- [ ] **AC-21** Baseline is missing/incomplete for an owned-surface element ⇒ verdict degrades to `gesture-only` (never fabricates), and the reason records the degraded lookup honestly.

**Click precedence (the loss chains)**
- [ ] **AC-6 (HEC-G)** For any recording, every ledger row with `eventType ∈ {click, contextmenu}` is represented by (a) a completed non-Hover interaction (trigger or member), (b) a gesture-record claim, or (c) an Unclassified projected card — **never solely by a Hover**. Added as a STOP self-consistency check alongside the M5 check.
- [ ] **AC-7** Dropdown-icon repro: mousedown-started lifecycle above a live hover + consuming click → Click card present; hover card carries `terminal: 'consumed-by-click'` without the click in its members; click ledger row not Hover-claimed.
- [ ] **AC-8** Hover+Click same element: BOTH cards emitted; identities join via the §7 join set; no twin Click, no lost Click (B6 harness green).
- [ ] **AC-9** CQ-invalid click under a live hover: Unclassified card with `invalidityCauses` (pre-gate unchanged); never swallowed by the hover.
- [ ] **AC-22 (the critical case)** Hover anchor "A" → owned surface reveals item "B" → user clicks B. Result: **two independent interactions** — Hover(A) `evidenced` with a reason naming the revealed surface, and Click(B) — neither absorbs, replaces, renames, or deletes the other; both cards present; both ledger rows claimed by their own interaction; HEC-G holds; IR = [HOVER, CLICK] (generic structural markup fixture, no site vocabulary — R-I5).

**Earning semantics**
- [ ] **AC-10** Genuine reveal-on-hover (aria-expanded flip on anchor/owned surface) → `evidenced`, class `reveal`, reason names the attribute flip.
- [ ] **AC-11** Hover with unrelated page churn (global insertions/removals, network) outside the owned set → `gesture-only`; churn counts visible in `factSummary` but non-qualifying.
- [ ] **AC-12** Pure-CSS `:hover` reveal with no MutationObserver facts → honestly `gesture-only` (reason recorded); the known V4/P4 residual remains documented, not heuristically patched.
- [ ] **AC-13** Network activity NEVER earns a Hover (RC-4/G4 stays; property pin).

**Admission & STOP**
- [ ] **AC-14** `isProductionInteraction(Hover)` reads only `endState` + recorded verdict; unit pin proves STOP cannot alter outcomes.
- [ ] **AC-15** R-1 and F-5 behaviors unchanged (existing pins green).
- [ ] **AC-16** Panel why-line renders `why: hover evidence — <reason>` for evidenced hovers and the gesture-only reason in the grouped section.
- [ ] **AC-26** Navigation in a hover window never earns `evidenced` (D1): unit fixture with nav-only window ⇒ `gesture-only`, nav row disclosed as consequence metadata.
- [ ] **AC-27** Legacy sessions: rows without `hoverQualification` ⇒ `gesture-only` with legacy reason, not admitted; no consequence-class fallback fires (D2).
- [ ] **AC-28** `evidenceReason` ≤ 200 chars in every recorded case; determinism pin: same fact vector ⇒ identical string across repeated runs (D3).

**Evidence disclosure (all types)**
- [ ] **AC-23** Every interaction type's panel card exposes `evidenceDisclosures` with honest `available` flags and counts for: domChanges, visibilityChanges, newSurfaces, collections, counters, network, navigation — from recorded facts only (no live-DOM reads at render; unit pin + real-Chrome dump check).
- [ ] **AC-24** Hover card's disclosure block additionally names its verdict/class/reason; the DatePicker card's why-line (`why: detected via gridcell children`) remains unchanged and still renders alongside its disclosures.
- [ ] **AC-25** Disclosures never affect classification/admission/IR/KR — pin that a zero-evidence card and a rich-evidence card of the same type differ ONLY in the disclosure block, not in type/admission decisions.

**No special cases**
- [ ] **AC-17** No new site vocabularies/selectors/text mappings introduced (grep gate over the diff: no new literal selector strings outside the existing frozen sets).

**Suites**
- [ ] **AC-18** Full automated suite green; B6, B7-P1…P5, CQ, P3/P4 pin suites green unmodified.
- [ ] **AC-19** Real-Chrome matrix (§13) executed with evidence dumps archived under `.drytis/notes/evidence/hover-evidence-contract-v1/`.

---

## 13. Real-Chrome test matrix

Common: fresh profile, extension loaded from the packaged ZIP, recording ON,
dumps captured at STOP (interactions + ledger + qualification records).
Per-scenario expected columns: **Cards** (side panel), **Hover verdict**,
**Click fate**, **IR steps**.

| # | Scenario | Action | Expected |
|---|----------|--------|----------|
| 1 | **Dropdown icon click** (the reported bug) | Physically click a dropdown chevron/icon that opens a menu (e.g. a combobox trigger with an icon child) | Cards: **Click** on the icon (+ Hover only if a real target-local reveal occurred, with reason). Click never inside the Hover; ledger row claimed by the Click; IR contains the CLICK step. |
| 2 | **Hover + click same element** | Hover an interactive element ≥300 ms, then click it | Cards: **Hover** (verdict per evidence, reason recorded) **and Click**, joined identities, both present; IR: [HOVER (if evidenced), CLICK]; no twins, no losses. |
| 2b | **Hover → revealed item → Click (critical case)** | Hover anchor "Services"-shaped control; owned surface reveals a "Book Flight"-shaped item; click that item | **Two independent interactions**: Hover = anchor, `evidenced`, reason names the revealed surface; Click = the item. Neither absorbs/renames/deletes the other (R-I1…R-I6); HEC-G holds; IR: [HOVER, CLICK]. Generic markup — no site tokens. |
| 3 | **Genuine reveal-on-hover** | Hover a pure hover-reveal menu (aria-expanded flip or surface emerges on the anchor's owned set), leave | Cards: **Hover** `evidenced`, class `reveal`, reason names the flip/surface; admitted; IR: HOVER. |
| 3b | **Pre-existing visible elements (baseline test)** | Hover an element whose menu/subtree is ALREADY open and visible at enter | Hover `gesture-only` — the baseline held the open state; no NEW transition; reason states `no new target-local transition` (AC-20). |
| 4 | **Hover with unrelated page churn** | Hover a quiet element while an unrelated widget on the page inserts/removes nodes and fires network calls | Cards: Hover `gesture-only` with honest reason; `factSummary` shows churn counts; NOT admitted (grouped in panel); IR: no HOVER. |
| 4b | **Related-but-unrelated mutation** | Hover where an owned-set element mutates in a non-reveal way (text change, class-only, style tweak) | Hover `gesture-only` — mutation is target-local but not a reveal/revert/pointer-reach transition; disclosed as an owned-set domChange count, non-qualifying. |
| 5 | **Pure CSS hover** | Hover an element revealed only via CSS `:hover` rules (no attribute flips, no MO facts) | Hover `gesture-only` (documented P4 residual stands); panel shows reason; no fabricated evidence. |
| 6 | **Icon-only elements** | Click/hover `<i class="icon-…">` / SVG icons (no text) | Same guarantees as 1–2; names via existing S2 icon-token cascade; no special-casing. |
| 7 | **DatePicker** | Open a calendar, click a date cell | Cards: **DatePicker** with `why: detected via gridcell children` (unchanged); any hover on the trigger stays independent; cell click never becomes/enters a Hover; IR unchanged vs baseline. |
| 8 | **Plain div** | Click and hover a non-interactive `<div>` (no shape, no CSS fact) | Click → Click card (CQ-qualified) or Unclassified w/ causes if provably invalid; NO Hover lifecycle starts (gate unchanged); nothing disappears. |
| 9 | **Navigation links** | Hover a nav link, click through | Cards: Hover (`evidenced` only if a T3 reveal/revert/pointer-reach transition held — **nav alone never earns, D1**) + Click/Link + Navigation; nav terminal/commit marker semantics unchanged (B7-P2 §5.2.6); click survives. |
| 10 | **CQ-invalid clicks** | Click a disabled/`pointer-events:none`/zero-size-lifted control while a hover is live | Cards: **Unclassified** with `invalidityCauses` (pre-gate); never claimed by Hover; IR policy unchanged (RC-F documented, out of scope). |

Matrix pass condition: every row matches its Expected column AND AC-6 (HEC-G) and AC-22 hold in every dump. Additionally, on every card in every scenario, the `evidenceDisclosures` block (AC-23) is present with honest availability flags.

---

## 14. Test plan (automated)

**Unit pins (new)**
1. `hover-qualification-verdict` — window fixtures → verdict/class/reason table
   (evidenced ×3 classes; gesture-only ×churn/network/dwell/CSS-only;
   **baseline fixtures**: already-open surface ⇒ gesture-only, post-enter
   flip ⇒ evidenced).
2. `hover-click-precedence` — the four loss chains:
   (mousedown-lifecycle-above-hover × hover-admitted/dropped) → click survives
   in all four (AC-7, AC-8).
3. `hec-g-self-consistency` — STOP check: click represented solely by Hover ⇒
   failure (AC-6).
4. `hover-qualification-frozen` — deep-freeze + no-mutation property through
   projection (AC-4).
5. `anchor-join-set` — enter/click divergence fixtures join via
   `{anchorKey, clickAnchorKey}` (AC-5).
6. `admission-reads-verdict` — admission pure-read pin (AC-14).
7. `hover-reveal-then-click-independence` — R-I1…R-I6: generic markup, two
   interactions, no absorption either way, order preserved, HEC-G (AC-22).
8. `evidence-disclosures` — per-type disclosure fixtures: available flags and
   counts from recorded facts; zero-evidence vs rich-evidence cards differ only
   in disclosures (AC-23, AC-25).
9. `baseline-degradation` — missing baseline entry ⇒ `gesture-only` with
   honest reason; no fabricated transitions (AC-21).
10. `decision-pins` — D1: nav-only window ⇒ `gesture-only`, nav disclosed as
    consequence metadata (AC-26); D2: legacy row ⇒ `gesture-only` + legacy
    reason, no fallback admission (AC-27); D3: reason ≤ 200 chars +
    determinism (same facts ⇒ same string) (AC-28).

**Regression guards (existing, must stay green unmodified)**
- B6/B6.1 harness (twin-Click IR sequences).
- B7-P1…P5 suites (pointer-path, terminals, R-1, F-5, surface-join parity).
- CQ v1.2 suites (vector, pre-gate, no-consumer pins where still applicable).
- P3/P4 provenance suites.
- M5 projection self-consistency.

**Integration**
- Full STOP pipeline on synthetic streams containing hovers + clicks + churn →
  projected output invariants (HEC-G, admission, ordering).

---

## 15. Decisions — RESOLVED (locked 2026-08-30)

- **D1 — Does `nav` earn `evidenced`?** **NO.** `nav` alone does not qualify
  as `evidenced`; it requires target-local transition evidence (a T3 class).
  Navigation events in a hover window are recorded as consequence metadata
  only. A hover→nav-commit lifecycle (B7-P2 §5.2.6 marker path) is therefore
  `gesture-only` unless an independent `reveal`/`pointer-reach`/`revert`
  transition held. `nav` is removed from any earning role (it was already
  outside the T3 classes; this makes it explicit and normative).
- **D2 — Legacy sessions** (recorded before this contract, no
  `hoverQualification` on metadata): **default `gesture-only`.** Do NOT
  reconstruct Hover meaning from old evidence — no
  `deriveConsequenceClasses` fallback, no retroactive qualification. Legacy
  rows display honestly in the panel with an explicit legacy reason
  (e.g. `legacy session: no recorded hover evidence`) and are NOT admitted.
- **D3 — `evidenceReason` length cap:** **max 200 characters.** Deterministic
  and based only on recorded evidence. The reason is a pure function of the
  recorded fact vector (R-Q7); any truncation is deterministic
  suffix-omission, never re-wording.

---

## 16. Explicitly prohibited implementations

- Any STOP-time reclassification, filtering, or "cleanup" of Hover/Click.
- Thresholds, dwell gates, confidence scores, timing-based earning.
- Site-specific selectors/class vocabularies/text mappings.
- Solving RC-D by re-minting twins at STOP instead of fixing ownership at
  capture (R-C1 makes the re-mint unnecessary).
- Weakening any preserved contract (§10) to make a test pass.
- **Timing as a correctness input anywhere in delivery, ownership, or
  suppression** (Amendment A, §17). Wall-clock deadlines may appear ONLY as
  documented liveness guards against hung renderers/channels — they must
  never decide whether evidence is captured, attributed, suppressed, or
  admitted.

---

## 17. Amendment A — Evidence Delivery Integrity (P1/P2/P3, approved 2026-08-30)

### 17.1 Doctrine: D-EDI — no timing-based correctness

Every correctness decision in the capture → evidence → STOP chain must be a
function of **recorded facts and event identity**, never of elapsed time.
Timers are permitted in exactly two roles:

1. **Liveness guards** — bounded waits for a hung renderer / dead channel,
   after which the system logs honestly and proceeds WITHOUT the missing
   party. A liveness guard firing is an observable, diagnosable failure
   (logged), never a silent data-loss decision.
2. **Transport scheduling** — deciding WHEN to photograph a window's
   consequences (quiescence, caps). The photograph is honest about its own
   bounds (`endReason`, coarseMode) and NEVER the last word: late evidence
   still delivers and attaches (P2), and classification never reads the cap.

### 17.2 P2 — ACK-based evidence delivery (R-ED1–R-ED4)

- **R-ED1 (channel):** `deliverEvidence` AWAITS the `BEHAVIORAL_EVIDENCE`
  sendMessage promise. The SW handler responds `{ok:true, attached}` after
  attach/persist completes (`attached`: interactionId, `'pending'`, or
  `'late'`). Failure/null responses leave the evidence in the CS page
  buffer (existing `cmdrunner_evidence_buffer` mechanics, cap 50) for
  START-time re-flush — no loss on SW restart/idle.
- **R-ED2 (no silent loss):** an unacked delivery is retried on the next
  recording start flush; the buffer is only pruned of SW-confirmed items
  (unchanged rule).
- **R-ED3 (idempotent attach):** the SW's attach path is idempotent by
  `sourceEventId` — a re-flushed duplicate must not double-attach or replace
  richer recorded evidence with a weaker shape.
- **R-ED4 (ordering):** ACKs change WAITING, not MEANING. Attachment
  semantics (tiers, merge rules, R-Q6 ordinal carry) are unchanged.

### 17.3 P1 — Closed-loop STOP drain (R-SD1–R-SD4)

- **R-SD1 (handshake):** the CS `STOP_EVIDENCE_DRAIN` handler responds with
  a structured ACK `{ok:true, remainingOpen:0, delivered:number}` AFTER it
  has force-closed open provisional hover windows and awaited their
  delivery ACKs (R-ED1). The listener holds the channel (`return true`).
- **R-SD2 (await ACKs, not clocks):** `drainHoverEvidenceBeforeStop` awaits
  each recording tab's drain ACK (or its channel rejection — an event
  signal: no CS = nothing to drain). NO poll loop, NO `Date.now()` deadline.
  On the last ACK, everything attachable is attached; the stop pipeline
  runs on verified state.
- **R-SD3 (liveness guard only):** a generous guard bounds a hung renderer
  (channel that never answers). Guard expiry logs `hover-drain: tab N did
  not ACK` and proceeds — honest, observable, never the happy path.
- **R-SD4 (no reclassification):** STOP still only projects recorded
  verdicts (R-Q1/§5); the handshake transports evidence, it never
  qualifies, disqualifies, or mints anything.

### 17.4 P3 — Identity-based companions (R-IC1–R-IC3)

Replaces both 300ms heuristics (`companionSuppressUntil`,
`COMPANION_WINDOW_MS`) with recorded facts:

- **R-IC1 (suppression):** a post-finalization click/contextmenu is
  suppressed as a companion IFF same anchor identity (hover
  `clickAnchorKey` / `elementKey` join via `joinsRecordedSurface`) AND its
  recorded click ordinal (C-1 `clickOrdinals` batch counter) equals the
  finalized window's close batch. Different anchor ⇒ its own window,
  ALWAYS. Same anchor + later batch ⇒ its own window.
- **R-IC2 (supersede):** the A-slice settle-supersede rule uses the same
  identity test — a newer window supersedes an older settling one IFF it is
  a DISTINCT physical act (different anchor or later batch), never because
  it opened ≥300ms later.
- **R-IC3 (no ms constant becomes correctness):** `COMPANION_WINDOW_MS` and
  `companionSuppressUntil` are removed from every correctness path; any
  surviving numeric constant must be a documented liveness/transport
  guard under §17.1.

### 17.5 Acceptance criteria (Amendment A)

- **AC-ED1:** injected multi-second delay between window close and evidence
  delivery at STOP ⇒ Hover still admitted (impossible pre-amendment).
- **AC-ED2:** immediate STOP after leave under churn ⇒ earned Hover
  admitted (M4c, now ACK-guaranteed rather than 1500ms-hoped).
- **AC-ED3:** click on anchor B 1ms after a lifecycle finalize on anchor A
  ⇒ B opens its own evidence window (no time-window suppression).
- **AC-ED4:** same anchor + same batch ⇒ companion suppressed (preserved
  behavior, now identity-decided).
- **AC-ED5:** hung tab (drain never ACKs) ⇒ STOP terminates via liveness
  guard with an honest log line; other tabs' evidence intact.
- **AC-ED6:** prolonged churn (minutes) ⇒ no false Hover; earned reveals
  still admitted via drain ACKs.
- **AC-ED7:** no `Date.now()`/`performance.now()` deadline decides capture,
  ownership, suppression, or admission (grep-verifiable in the stop
  pipeline + suppression/supersede paths).
- **AC-ED8:** all §10 preserved contracts and §13 matrix rows green
  unchanged.

### 17.6 Prohibitions (Amendment A)

- Poll loops with wall-clock deadlines in the stop pipeline.
- Suppression/supersede decisions reading elapsed time.
- Liveness guards that silently drop evidence instead of logging.
- Weakening R-ED3 idempotence or the R-Q6 ordinal carry.

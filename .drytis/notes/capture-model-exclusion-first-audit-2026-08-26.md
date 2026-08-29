# Capture-Model Exclusion-First Audit (2026-08-26)

Read-only architectural study per owner Google Doc (14C14m990cIP9Qrm5FndgbsbMIcOGT-EVq6-vfrd8YuU).
No code/tests/specs/commits modified.

## 1. Current Architecture Trace

```
Physical Event (trusted)
  │
  ▼
EventTap.handleRawEvent (event-tap.ts:210)
  ├─ Filter: isTrusted only (line 212)
  ├─ resolveTarget → Shadow DOM pierce (line 233)
  ├─ extractIdentity → immutable ElementIdentity (line 237)
  ├─ extractDomContext → immutable DomContext (line 240, dom-context-extractor.ts:25)
  │   ├─ tag, ariaRole, ariaLabel, className, accessibleName
  │   ├─ ariaExpanded, ariaHasPopup, ariaAutoComplete, listId
  │   ├─ ancestorRoles (10-deep, "tag[role=x]" format)
  │   ├─ ancestorClasses (10-deep)
  │   ├─ tabIndex, pointerCursor (computed style), clickHandler (onclick attr)
  │   └─ disabled, readOnly, required, isContentEditable, inputType
  ├─ assembleObservedEvent → ObservedEvent (line 269)
  └─ config.onEvent → ledger append (INV-1: capture precedes classification)
      │
      ▼
ComponentRuntime.process() (component-runtime.ts)
  ├─ Dedup by eventId (line ~350)
  ├─ Offer to active lifecycles (stack top→bottom, isInScope check)
  ├─ tryDiscovery: iterate ALL_DEFINITIONS by priority ascending
  │   ├─ DragDrop(5), KeyboardShortcut(8), DatePicker(10), ColorInput(15),
  │   │   Dropdown(20), Slider(25), Checkbox(30), FileUpload(35),
  │   │   RadioButton(40), TextEntry(50), Hover(60), Tab(65), Link(70),
  │   │   Modal(75), Expander(80), Scroll(110), Navigation(120), Click(180)
  │   ├─ Each definition.detectTrigger(event) → ComponentTrigger | null
  │   └─ First non-null claim wins (priority order)
  ├─ Click.detectTrigger (click.ts:32):
  │   ├─ Gate 1: isInteractiveElement (tag ∈ INTERACTIVE_TAGS, role ∈ INTERACTIVE_ROLES,
  │   │          tabIndex≥0, className matches INTERACTIVE_CLASS_RE)
  │   ├─ Gate 2 (S6/LP1): isInsideOpenSelectionSurface (ancestor role/class)
  │   ├─ Gate 3 (W-B): autoId / dataAutoId (QA instrumentation)
  │   ├─ Gate 4 (M1): pointerCursor / clickHandler (computed affordance)
  │   └─ ALL FAIL → return null → no definition claims → Unclassified
  ├─ completeComponent → dedup check → emit interaction
  └─ Ledger: setDisposition('claimed' | 'unclaimed')
      │
      ▼
Projection Engine (projection-engine.ts)
  ├─ Completed interactions → emitted as-is
  └─ Unclaimed/pending ledger entries → createUnclassifiedFromLedger
      │ (preserves real ElementIdentity, ancestorRoles/Classes)
      ▼
isProductionInteraction (output-adapter.ts:43)
  ├─ Unclassified → return true (capture guarantee v2, B4 D2)
  └─ Various no-op filters for other types
      │
      ▼
IR Bridge (ir-bridge.ts:620)
  ├─ NOISE_TYPES = {Scroll, Unclassified} → DROPPED (B4 D2)
  └─ Remaining → INTERACTION_TO_IR_ACTION map → IRStep
      │
      ▼
Understanding Pipeline → Episode Builder
  └─ actionType = s.anchor.raw.type → signatureKey(appId, actionType, normalizedTarget, anchorViewId)
      │
      ▼
Knowledge Repository (KR) — cross-session behavior signatures
```

**Where positive qualification determines Click vs Unclassified:**
click.ts detectTrigger (line 37-71). Four sequential gates, ALL must pass. If all fail → null → Unclassified.
The gates are INCLUSIVE proofs: "prove this element IS interactive" — not "prove it is NOT interactive."

## 2. Exclusion-First Feasibility

**Smallest architectural change:** Insert an invalidity filter BEFORE tryDiscovery in ComponentRuntime.process(), replacing the current Click.detectTrigger inclusion gates with a deterministic rejection filter.

Current shape:
```
tryDiscovery() → iterate definitions → Click.detectTrigger (inclusion) → null? → Unclassified
```

Proposed shape:
```
tryDiscovery() → invalidity filter (rejection) → retain? → iterate semantic definitions → Click fallback
```

The insertion point is in ComponentRuntime.process() at the discovery step (before the definition loop), or alternatively by rewriting Click.detectTrigger as a rejection filter.

**Feasibility assessment:** Technically possible but structurally dangerous. See trade-offs (§9).

## 3. Define "Provably Invalid"

### Safe deterministic rejection (structural facts at event time):
| Signal | Source | Safe? | Rationale |
|--------|--------|-------|-----------|
| `disabled` attribute (HTML) | dom-context-extractor.ts:84 | YES | HTML spec: disabled elements don't fire click events in practice |
| `aria-disabled="true"` | dom-context-extractor.ts:85 | YES | W3C: explicitly declares non-interactivity |
| `fieldset[disabled]` ancestor | dom-context-extractor.ts:88 | YES | HTML spec: disables all form descendants |
| `isTrusted === false` | event-tap.ts:212 | YES | Already filtered — synthetic/programmatic events never enter ledger |
| `pointer-events: none` (computed style) | NOT captured | YES but MISSING | Would need new DomContext field; safe if captured at event time |
| `aria-hidden="true"` | NOT captured | YES but MISSING | W3C: hidden from accessibility tree |

### Potentially unsafe rejection:
| Signal | Safe? | Rationale |
|--------|-------|-----------|
| tag ∈ {BODY, HTML} | DANGEROUS | B3 S4 deliberately REMOVED these from NON_INTERACTIVE_TAGS — body click-away dismissals are real user actions. Rejecting them recreates F4. |
| No ARIA role | DANGEROUS | Most custom interactive elements (React/Vue) are bare DIVs with delegated handlers. No role ≠ not interactive. |
| No tabIndex | DANGEROUS | Many custom components work without tabIndex (delegated handlers, CSS cursor, framework-specific). |
| No pointer:cursor | DANGEROUS | Some frameworks style interactivity through parent containers. Many legitimately clickable elements don't set cursor:pointer. |
| No onclick attribute | DANGEROUS | React/Vue/Angular NEVER use onclick attributes — they attach listeners via addEventListener or delegation. This would reject ~all React clicks. |
| No detected event listener (getEventListeners) | IMPOSSIBLE | Chrome DevTools API only — not available in content scripts. getEventListeners() is not a web API. |
| No semantic role | DANGEROUS | Same as no ARIA role — the majority of web interactions happen on roleless DIVs. |

### Heuristic (can guide but not prove):
| Signal | Notes |
|--------|-------|
| INTERACTIVE_CLASS_RE | Catches btn/button/clickable etc. — but absence doesn't prove non-interactive |
| Ancestry in open-selection-surface | S6/LP1 — structural fact, but only useful for clicks inside known surfaces |

### Framework-dependent:
| Signal | Problem |
|--------|---------|
| React event delegation (document root) | Every element technically "has a handler" — useless as exclusion signal |
| Vue @click (compiles to addEventListener) | Invisible from DOM inspection |
| Angular (click) (compiles to addEventListener) | Same |
| CSS class frameworks (Tailwind, styled-components) | Custom class names, no universal vocabulary |

### Currently missing (would need new DomContext fields):
- `pointerEvents: none` computed style — safe deterministic rejection
- `aria-hidden="true"` — safe deterministic rejection
- `isVisible` (display:none, visibility:hidden, opacity:0, zero-size) — safe but expensive

### Critical asymmetry:
**Inclusion proof failure → visible Unclassified card (KR learning signal, owner can see and fix).**
**Exclusion proof failure → silently fabricated Click IR step against a nameless div that replays to nothing.**
For a test-generation product, silently-wrong is worse than visibly-missing.

## 4. Real-World Evidence (B3 Census)

From `b3-full-final3/censusflow-storage.json` — 16 interactions, 14 Unclassified:

| Unclassified card | tag | class | type | verdict |
|---|---|---|---|---|
| int-5–14 (9 cards) | INPUT | — | keydown | correctly rejected noise (per-key keydown, no-focus typing) |
| int-15 | BODY | — | click-away | legitimate interaction (B3 S4 captured it deliberately) |
| int-16 | DIV | plain | click | correctly rejected (no handler, no affordance — fixture demonstrates gate-reject) |
| int-17 | DIV | responding | click | evidence-consequential (div mutates text on click — flag=true) |
| int-20 | DIV | backdrop | click | correctly rejected on census fixture (no handler on backdrop div) |

From B2 storage dump (`b2-storage.json`):
| Unclassified card | tag | class | verdict |
|---|---|---|---|
| int-11 | BUTTON | save-btn | dedup-resurrected (B3 S2 fixed — not a qualification failure) |
| int-17 | BUTTON | save-btn | dedup-resurrected mousedown twin (same fix) |

**FlixBus A/C Sleeper scenario:** The owner referenced a physical click on a DIV that produced network activity but stayed Unclassified. This is the `responding-div` (int-17) pattern — a DIV with no interactive signals but with behavioral evidence (DOM mutation / network activity). Under inclusion-first, it's visible as Unclassified with `flag=true`. Under exclusion-first, it would become a Click — but the locator would be `//div` or `div.responding` which is brittle and non-semantic. The test would replay a click on an unstyled div with no assertion of what it does.

**Classification of existing Unclassified:**
1. **Correctly rejected/noise:** 9 per-key keydowns, 1 plain-div (no handler), 1 backdrop div (no handler) = 11
2. **Invalid click:** 0
3. **Dedup-resurrected:** 2 (B3 S2 fixed — NOT a qualification issue)
4. **Structural rejection:** 1 BODY (B3 S4 deliberately captured — NOT rejected)
5. **Legitimate click lost due to qualification failure:** 1 responding-div (has behavioral evidence but no interactive signal) — but this is the HONEST outcome: the element genuinely lacks semantic identity. Promoting it to Click doesn't make it a better test step; it makes the IR step dishonest (claiming a Click against a nameless div).

## 5. Interaction with Existing Definitions

Under exclusion-first, semantic definitions would become refinements of an already-retained click rather than claim gates. Priority would need to change from "first claim wins" to "first semantic match labels the retained click."

**Can it coexist with current lifecycle/claim system?** No, not cleanly. The current system's invariant is:
- INV-2: "Every Entry Receives Exactly One Disposition" — claimed by exactly one definition or unclaimed
- The lifecycle/claim system is built on the assumption that a definition CLAIMS an event (owns it)
- Under exclusion-first, the Click "owns" everything by default; semantic definitions would need a different relationship (relabeling, not claiming)

This would require:
1. A new "capture disposition" layer before semantic classification
2. Separating ownership (Click always owns) from labeling (semantic type)
3. Rewriting the lifecycle absorption system (absorbed events currently belong to the claiming definition's lifecycle)

This is a fundamental architecture change, not a "smallest architectural change."

## 6. Unclassified Policy Under Exclusion-First

- **Would Unclassified become much rarer?** Yes — only keydown events and truly rejected clicks would be Unclassified. Click-shaped events would always be Click.
- **Should unclassified trusted click become generic Click?** This is the proposal. But it means Click no longer means "we recognized this as interactive" — it means "we couldn't prove it's NOT interactive." This is a weaker semantic.
- **What happens to B4 D2 DROP?** Unclassified would still be dropped in IR (it would be much rarer — only keydown and non-click events). But the Click IR step would now include clicks on non-interactive elements, which is worse for IR quality.
- **B3 evidence/promotion mechanism:** The promotion substrate (evidence join, actionabilityEvidence flag) becomes less necessary — if clicks are retained by default, there's nothing to promote. But the evidence channel remains useful for semantic refinement.
- **KR signatureKey:** `appId|actionType|normalizedTarget|anchorViewId`. If Unclassified → Click, then previously-Unclassified anchors now hash as `Click|<target>` instead of `Unclassified|<target>`. This is a KR identity migration requiring recompute of all existing signatures. The vocabulary freeze (D1, B4) explicitly forbids this.
- **Existing knowledge invalidated:** Yes. All existing KR rows with `actionType=Unclassified` would no longer match new sessions where the same interaction is typed `Click`. Cross-session correlation breaks.

## 7. Deduplication and Lifecycle Safety

**Critical risk.** Exclusion-first changes what enters the dedup system:

- **mousedown→click normalization:** Currently, mousedown on an interactive element may start a lifecycle; the completing click is claimed. Under exclusion-first, ALL clicks enter as Click — mousedown pairing must handle every click, not just recognized ones. The pairPhysicalPress logic in projection-engine.ts already pairs mousedown+click on the same element, so this is compatible IF the target identity is stable.
- **Lifecycle absorption:** Definitions that absorb events (Dropdown absorbs option clicks, DatePicker absorbs calendar clicks) currently work because the definition OWNS the lifecycle. Under exclusion-first, the Click "owns" everything — absorption would need to become a semantic-layer concern, not a lifecycle-layer concern. This is a major rewrite.
- **Duplicate suppression (isDuplicate):** Currently per-type (same type + same element + within 2000ms). Under exclusion-first, every retained click is type=Click — the per-type dedup becomes global Click dedup. This would suppress legitimate distinct clicks on different non-interactive elements within 2 seconds.
- **B3 dedup-resurrection defect:** B3 S2 fixed this by folding duplicates into the prior interaction. Under exclusion-first with universal Click typing, the dedup window would apply to ALL clicks, not just per-type — this could suppress rapid clicks on different elements (e.g., clicking two different buttons within 2 seconds on a form).
- **releaseClaims / projected Unclassified:** With fewer Unclassified projections, the projection engine has less work. But the degradation path (post-restart dedup) becomes riskier — a universal Click dedup window post-restart could suppress everything.

## 8. Evidence Role

Under exclusion-first, evidence must NOT be required for Click (that recreates positive proof). Options:
- **Evidence as rejection signal:** If evidence shows the click had NO effect, reject it. But "no observed effect" ≠ "invalid" — the effect may be delayed, network-based, or visual-only.
- **Evidence as supporting signal:** Evidence attaches to the Click but doesn't determine whether it's retained. This is the current B3 model (actionabilityEvidence flag) and is compatible.
- **Evidence as later semantic signal:** Evidence could refine Click → a more specific type post-hoc. This is the "semantic refinement" model from §5, which requires the architecture change.

**Current model already does this correctly:** The actionabilityEvidence flag (B3 S5) marks Unclassified cards that have behavioral evidence, without requiring evidence for Click survival. Evidence is supporting, not gating.

## 9. Trade-Off Matrix

| Dimension | A (Inclusion-first, current) | B (Exclusion-first) | C (Hybrid) |
|---|---|---|---|
| **False positives** (non-action Click retained) | LOW — must pass 4 gates | HIGH — any non-proven-invalid click | MEDIUM — deterministic filter catches clear cases |
| **False negatives** (real action lost) | MEDIUM — gate miss → Unclassified (visible) | LOW — only provably-invalid rejected | LOW-MEDIUM |
| **React/custom-DIV compatibility** | MEDIUM — M1 affordance gate helps | HIGH — everything passes | HIGH |
| **Framework independence** | MEDIUM — class regex is framework-specific | HIGH — no framework knowledge needed | MEDIUM |
| **Accessibility assumptions** | MEDIUM — relies on ARIA/tabIndex | LOW — doesn't require ARIA | LOW |
| **Test-generation quality** | HIGH — Click means "recognized interactive" | LOW — Click means "not-proven-non-interactive"; locator is often brittle | MEDIUM |
| **Locator quality** | HIGH — element passed interactivity gates | LOW — may be `//div` or `div.generic` | MEDIUM |
| **Replay reliability** | HIGH — clicking a recognized element | LOW — clicking a nameless div may do nothing | MEDIUM |
| **KR contamination** | LOW — Unclassified is a distinct, stable type | HIGH — noise clicks pollute Click signatures | MEDIUM |
| **Dedup safety** | HIGH — per-type dedup | LOW — universal Click dedup risks suppression | MEDIUM |
| **Evidence dependence** | LOW — evidence is supporting, not gating | LOW — evidence not required (correct) | LOW |
| **Implementation complexity** | LOW (already built) | HIGH — architecture rewrite | MEDIUM |
| **Maintenance burden** | MEDIUM — add gates for new patterns | LOW — fewer rules to maintain | MEDIUM |
| **Future extensibility** | HIGH — new definition = new claim gate | MEDIUM — semantic refinement is new concept | HIGH |

**Where A fails:** Gate miss on a genuinely interactive custom element → Unclassified (visible, fixable, KR learning signal). Example: React component using a non-standard class name with no ARIA and no cursor:pointer.

**Where B fails:** Click retained on a non-interactive div → IR step fabricated → test replays a click on `//div` → either no-op or unpredictable behavior. Example: user clicks a text paragraph to select text → retained as Click → test clicks that paragraph → irrelevant step in generated test.

**Where C fails:** The deterministic invalidity filter must be conservative (reject only provably-invalid). If too aggressive, it recreates A's false negatives. If too permissive, it recreates B's false positives. The filter's quality determines everything.

## 10. Migration Strategy

### Phase 1: Capture disposition / invalidity layer
Add `pointer-events: none` and `aria-hidden` to DomContext (safe deterministic signals).
Insert a pre-discovery invalidity filter that rejects only:
- disabled/aria-disabled (already captured)
- pointer-events: none (new)
- aria-hidden="true" (new)
Does NOT change Click.detectTrigger or existing definitions.

### Phase 2: Retained-but-unclassified → Click
Change Click.detectTrigger from inclusion gates to: "if not invalidity-rejected, return Click."
Existing semantic definitions (priority < 180) still claim first.
Risk: all previously-Unclassified clicks now become Click → KR migration.

### Phase 3: Semantic definitions as refinements
Change the claim system to: Click always owns; semantic definitions relabel.
This is the deepest change — lifecycle/absorption rewrite.

### KR migration concern:
Phase 2 requires migrating all existing KR rows with `actionType=Unclassified` to `actionType=Click`. This is a signatureKey recompute that breaks cross-session correlation. The vocabulary freeze (D1) was established precisely to prevent this.

### B1–B5 regression:
Phase 1 is safe (additive). Phase 2 breaks all Click-count pins, Unclassified-count pins, census baselines. Phase 3 breaks lifecycle pins.

## 11. What Should NOT Change

- **Trusted-event boundary:** isTrusted filter must remain the first gate (INV-1)
- **No fabrication from DOM consequences:** DOM mutations alone cannot create interactions (architecture invariant)
- **Dedup semantics:** Per-type dedup prevents cross-type suppression; must not become universal
- **signatureKey doctrine:** `appId|actionType|normalizedTarget|anchorViewId` is FROZEN (D1, vocabulary freeze). Changing Unclassified→Click is a migration requiring explicit approval.
- **Vocabulary freeze:** InteractionType union is pinned; changing type assignments is a KR migration
- **Evidence semantics:** Evidence is supporting, not gating (B3 model). Must not become a requirement for Click survival.
- **Replay safety:** IR steps must correspond to actions a human can replay. Clicking a nameless div is not a reliable replay.
- **Existing valid specialized definitions:** B1–B5 definitions (Expander, Modal, Dropdown, TextEntry, DatePicker, etc.) must not lose their claim priority.

## 12. Final Recommendation

### Architecture diagrams:

**Current (A):**
```
Trusted click → isInteractiveElement? → YES → Click(180) → emit
                                      → NO → S6/LP1? → YES → Click → emit
                                                          → NO → autoId? → YES → Click → emit
                                                                            → NO → cursor/handler? → YES → Click → emit
                                                                                                 → NO → Unclassified
```

**Proposed (B):**
```
Trusted click → isProvablyInvalid? → YES → reject
                                   → NO → Click → semantic refinement (Modal/Expander/etc.)
```

**Proposed (C — Hybrid):**
```
Trusted click → isProvablyInvalid? → YES → reject
                                   → NO → tryDiscovery (semantic definitions first)
                                          → claimed? → typed interaction (Modal/Expander/etc.)
                                          → not claimed? → Click fallback → emit
```

### Exact insertion point:
ComponentRuntime.process(), before the tryDiscovery call. A new `isProvablyInvalid(event)` function that checks only deterministic structural signals (disabled, aria-disabled, pointer-events:none, aria-hidden).

### Existing rules that can safely become exclusion rules:
- `disabled` / `aria-disabled` (already captured in DomContext)
- `fieldset[disabled]` ancestor (already captured)
- `isTrusted === false` (already filtered at EventTap)

### Rules that must NOT become exclusion rules:
- No ARIA role (would reject ~all React custom components)
- No tabIndex (would reject legitimate framework components)
- No pointer:cursor (would reject elements with delegated handlers)
- No onclick attribute (would reject ALL React/Vue/Angular clicks)
- tag ∈ {BODY, HTML} (B3 S4 deliberately captured these)
- No detected event listener (impossible in content script)

### Impact on Click/Unclassified:
- Click count increases (previously-gate-rejected clicks now pass)
- Unclassified count decreases to near-zero for click events
- Unclassified persists only for keydown and non-click events

### Impact on KR and IR:
- KR: signatureKey identity migration (Unclassified → Click) — breaks vocabulary freeze
- IR: more Click steps, but many against non-interactive elements with brittle locators

### Impact on B1–B5:
- B1–B5 definitions remain as claim gates (they fire before Click(180))
- B3 census baselines invalidated (Unclassified counts change)
- B4 D2 DROP becomes less relevant (fewer Unclassified to drop)
- All Click-count and Unclassified-count test pins need updating

### Recommended architecture: **A (current inclusion-first), with targeted additions from C**

The current model already has:
1. Capture-first at EventTap/ledger layers (every event enters the ledger)
2. Inclusion gates as PROOFS (native HTML tags, ARIA roles, tabIndex, QA instrumentation, computed affordances)
3. Unclassified as a visible, honest signal (KR learning, owner can see and fix)
4. B3 evidence/promotion mechanism (actionabilityEvidence flag for evidence-consequential cards)
5. B4 D2 DROP for IR (Unclassified doesn't pollute IR output)

The exclusion-first model's core claim — "proving NOT is easier than proving IS" — is true in general, but the exclusion set for web clicks is NOT small enough to be safe:
- Disabled/aria-disabled: already handled (DomContext.disabled)
- pointer-events:none: safe but needs new DomContext field
- aria-hidden: safe but needs new DomContext field
- Everything else is framework-dependent, impossible, or dangerous

The asymmetry decides it: **qualification miss → visible Unclassified (fixable); exclusion miss → silent fabricated IR step (not fixable in post).** For a test-generation product, silently-wrong is worse than visibly-missing.

**Targeted additions (from C):**
1. Add `pointer-events: none` to DomContext (safe deterministic exclusion signal)
2. Add `aria-hidden="true"` to DomContext (safe deterministic exclusion signal)
3. These strengthen the CURRENT inclusion gates by providing additional rejection signals that Click.detectTrigger can check before falling through to Unclassified

This gives the exclusion-first model's safe benefits without its dangerous costs.

### Migration plan: **None required for recommended architecture**
The targeted additions (pointer-events:none, aria-hidden) are additive — they add new rejection signals to the existing inclusion model without changing the architecture. No KR migration, no vocabulary change, no B1–B5 regression.

### Risks and unresolved questions:
1. The FlixBus A/C Sleeper scenario (DIV click with network activity but no interactive signal) — under current model it's visible Unclassified with `flag=true`. Is this actually a problem? The owner can see it in the panel and decide to add ARIA/className to the element. The recorder's job is to HONESTLY report what happened, not to guess.
2. If pointer-events:none and aria-hidden are added, should they also gate the OTHER definitions (not just Click)? Currently only Click uses the inclusion gates; other definitions have their own detectTrigger logic.
3. The 9-per-key keydown cards from B3 — these are correctly Unclassified (no-focus typing). Under exclusion-first they would still be Unclassified (they're keydown, not click). No change.

### Recommended next milestone:
**7.4-C→D capability layer** (as previously recommended). The capture-model question is resolved: inclusion-first is correct, with targeted additions. The next major work is building capability derivation on the finished IDENTIFY vocabulary (B1–B5). Modal (B5) was the last IDENTIFY rung.

If the owner wants the targeted additions (pointer-events:none, aria-hidden) before C→D, that's a small B6 slice — two DomContext fields + Click.detectTrigger gate + tests. But it's additive, not architectural.
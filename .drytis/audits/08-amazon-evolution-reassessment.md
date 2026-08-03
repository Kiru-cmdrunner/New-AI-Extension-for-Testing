# Amazon Failure → R1/R2/R3 Evolution: What Was Intentional vs What Is Broken

## The Amazon Failure and What It Taught

### The Problem

On Amazon.in, left-rail filter checkboxes (`<a class="s-navigation-item">` with inner `<i class="a-icon-checkbox">`) were captured as **Link** interactions instead of **Checkbox**. The structural classifier saw `<a>` tag → Link. The behavioral effect (class transitioning `opt` → `opt selected`) was invisible because DOM capture fires **before** the page's click handler runs.

### What the Amazon Failure Proved

**Structural/DOM interpretation alone is insufficient for CLASSIFICATION.** Not for grouping, not for enrichment, not for every downstream concern — specifically for determining *what type of interaction this is*. A checkbox implemented as `<a>` with CSS toggling must be understood as a toggle.

### What R1/R2/R3 Built

The evolution moved classification from structural cascades to **behavioral evidence voting**:
- **R1**: Deleted dormant V2 subsystem (3,837 lines) to unify capture path
- **R2**: Last structural detection expansion (CSS patterns for custom sliders)
- **R3**: Post-handler attribute re-snapshot + annotation deferral + 4 behavioral generators. Deliberate weight calibration: behavioral (+0.5 to +0.7) > structural (+0.1 to +0.4). The Amazon `<a>` filter toggle now classifies correctly: behavioral toggle signal (+0.5) overrides structural link signal (+0.4).

### The Deleted Code

The old AI deleted an entire **structural classification pipeline**:
- `src/pipeline/recognition/` — 12+ files that tried to classify interactions from structural patterns
- `src/pipeline/channels/` — 5 evidence channels feeding structural data to classification
- `src/classifier/evidence/providers/` — DOM, ARIA, CSS classname, event sequence, mutation providers

**These were all CLASSIFICATION systems** — they answered "what type of interaction is this?" using structure alone.

### What Replaced It

A **two-layer architecture**:
1. **Classification layer** (Component Runtime + evidence engine): Determines interaction type using behavioral evidence (R3). Works correctly.
2. **Recognition/grouping layer** (Phase 4/5 recognition orchestrator): Groups multiple interactions into composite components (dropdown, radio group, tabs). Runs AFTER classification. **Never fully wired.**

---

## Critical Distinction: Classification vs Grouping

This is the key to understanding what's broken vs what's intentional.

| Concern | Question | Layer | Mechanism | Status |
|---------|----------|-------|-----------|--------|
| **Classification** | "Is this a checkbox or a link?" | Component Runtime + evidence engine | Behavioral evidence voting (R3) | ✅ Works |
| **Grouping** | "Are these 3 interactions part of one dropdown?" | Recognition orchestrator | Structural + behavioral patterns on domain entities | ❌ Starved of data |

The Amazon failure was a **classification** problem. R1/R2/R3 solved it by making classification behavioral.

The recognition orchestrator (structural-recognizer.ts, behavioral-recognizer.ts, orchestrator.ts) addresses a **completely different problem**: grouping already-classified interactions into composite components. It does NOT classify — it receives interactions that are already typed by the Component Runtime.

**The structural recognizer does NOT override Component Runtime classification.** It runs AFTER classification, on domain entities derived from already-classified interactions. Its structural matching only affects component grouping (linking a radio button to its radio group), not type reassignment.

---

## Reassessment: Real Broken Connection vs Intentional Decision

### D-R1: ancestorRoles truncated to [target] only — BROKEN CONNECTION

**Evidence it's broken, not intentional:**
1. Ancestor roles ARE captured at observation time (`dom-context-extractor.ts:278`, 10-level walk)
2. Every component definition READS ancestor roles for classification (dropdown.ts, checkbox.ts, radio-button.ts, etc.)
3. The domain adapter PRESERVES them on `UiElement.ancestorRoles` (`domain-adapter-v2.ts:445`)
4. The pipeline runner DISCARDS them at line 109 — passes `[roleInfo]` instead of the full chain
5. The structural recognizer's `RecognitionInput.ancestorRoles` type explicitly expects the full chain (documented at structural-recognizer.ts:56-67 with example: combobox → listbox → option)
6. The type conversion from `string[]` to `ElementRoleInfo[]` was simply never implemented

**Why the Amazon lesson does NOT apply here:** The Amazon lesson was "don't use structure ALONE for classification." Passing ancestor roles to the recognition layer doesn't change classification — it enables grouping. An radio button is ALREADY classified as RadioButton by the Component Runtime. The ancestor chain tells the recognizer "this radio is inside a radiogroup" — that's grouping, not classification.

**Verdict: BROKEN CONNECTION.** The data exists at every upstream layer. The pipeline runner's `ancestorRoles: [roleInfo]` is an incomplete wiring, not an intentional architectural decision.

### D-R2: relatedElementIds always [] — BROKEN CONNECTION (but sibling capture is a genuine gap)

Two separate issues here:

**relatedElementIds for behavioral recognition:** The behavioral recognizer needs to know which other elements are related (DOM descendants/ancestors) so it can evaluate transition sequences across related elements. This data was captured (ancestorRoles exist) but never passed. BROKEN CONNECTION.

**Sibling elements for structural recognition:** No code at ANY layer captures sibling element roles. The `OrchestratorInput.siblingElementRoles` field exists as a forward-looking type definition. This is a GENUINE GAP — not a deletion, not a broken connection, just never implemented.

**Why the Amazon lesson does NOT apply:** Sibling elements are used for grouping (identifying radio options in a group, dropdown options in a listbox). The Amazon failure was about classification, not about grouping siblings.

**Verdict: relatedElementIds = BROKEN CONNECTION. Sibling capture = GENUINE GAP (needs new implementation, following the ancestorRoles pattern).**

### D-R4: Multi-operation lifecycles unachievable — BROKEN CONNECTION

**Evidence it's broken, not intentional:**
1. The dropdown definition (`dropdown.ts:514-607`) captures multi-step interactions (trigger click → option selection) into ONE ComponentInteraction with `metadata.subActions[]` containing structured per-step data
2. The domain adapter ignores subActions entirely — produces ONE transition with one operation
3. The pattern catalogue's `expectedLifecycle: [CLICK, SELECT]` (dropdown) expects multiple operations
4. The orchestrator's `isLifecycleComplete()` does set-containment checking across multiple operations
5. The design clearly intended multi-step interactions to produce evidence of their lifecycle stages

**The Amazon lesson connection:** R3 taught that behavioral effects (what the app did after the click) matter. The domain adapter was built BEFORE R3 and never updated to carry behavioral data. The subActions contain exactly the kind of behavioral evidence R3 captures (option selection, panel emergence, value changes). Expanding subActions into transitions would CARRY R3 behavioral intelligence forward, not undo it.

**Verdict: BROKEN CONNECTION.** The subActions data exists. The adapter's one-transition-per-interaction mapping predates R3 and was never updated to reflect the behavioral intelligence R3 added.

### D-R5: componentId never assigned — BROKEN CONNECTION

**Evidence it's broken, not intentional:**
1. `assignTransitionToComponent()` exists at `observed-transition.ts:235` — deliberately written
2. Zero call sites in the entire codebase
3. The recognition orchestrator calls `registry.addTransition()` which updates the component's reference but not the transition's back-reference
4. The enrichment orchestrator's `transitions.filter(t => t.componentId === ...)` is written to consume this data
5. The semantic aggregator partitions by `componentId` — the partitioning code exists

**Why the Amazon lesson does NOT apply:** This is pure plumbing — linking recognized components to their transitions. Nothing about behavioral vs structural reasoning.

**Verdict: BROKEN CONNECTION.** The function was written, the consumers were written, but the call was never wired.

### D-A1: Slider operation='click' — BROKEN CONNECTION

The `INTERACTION_TO_OPERATION` map was written before R2/R3. R2 added slider detection to the Component Runtime, but the adapter's operation map wasn't updated to reflect the new Slider interaction type's semantics.

**Verdict: BROKEN CONNECTION.** R2 added Slider classification; the adapter operation map was never updated.

### D-A-RadioButton: RadioButton→toggle vs pattern expects select — PARTIALLY INTENTIONAL

The adapter maps RadioButton→TOGGLE. The pattern expects SELECT. This could be:
- A genuine mismatch (the adapter author and pattern author disagreed on semantics)
- An intentional choice (toggle is what the user DID — they toggled the radio)

The behavioral evidence engine classifies radio selection as `select` intent (panel-emergence/selection-state generators). But the adapter collapses this to `toggle` operation. The disconnect is between the adapter (pre-R3) and the pattern catalogue (designed alongside R3).

**Verdict: BROKEN CONNECTION (adapter predates R3, pattern was designed with R3 semantics).**

### D-E1: NoOp DomInspector — ARCHITECTURAL CONSTRAINT (intentional boundary)

**Evidence it's intentional:**
1. The MV3 service worker genuinely cannot access the page DOM
2. The design (STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md) described DomInspector with real DOM queries, but this was designed before MV3 constraints were fully understood
3. NoOp is a pragmatic solution — not a bug, not a broken connection

**However:** The Amazon lesson teaches us that behavioral data captured AT OBSERVATION TIME (when the content script HAS DOM access) is the right approach. The subActions data already captures option information at observation time. Fix 7 (derive optionSets from subActions) follows this principle — it doesn't restore DOM access, it uses data already captured behaviorally.

**Verdict: ARCHITECTURAL CONSTRAINT. The NoOp itself is intentional. The fix should follow the Amazon lesson: capture at observation time, not query at analysis time.**

### R3 evidence flow broken at domain adapter — BROKEN CONNECTION (the most important one)

This is the single most significant finding from the Amazon investigation:

**R3 invested heavily in behavioral evidence:**
- 4 behavioral generators (value-change, panel-emergence, selection-state, slider-value)
- Post-handler attribute re-snapshot via setTimeout(0)
- Annotation deferral (Click waits for attribute-change)
- Weight calibration (behavioral > structural)

**ALL of this behavioral intelligence is captured in `ComponentInteraction.metadata.evidenceTrail` (IntentVote[]) and `ComponentInteraction.intent`/`confidence`.**

**The domain adapter does not read ANY of it.** The adapter produces transitions with only VALUE_CHANGE, STATE_CHANGE, and NAVIGATION evidence. It never produces MUTATION evidence. It never populates cascadeEffects.

This means the behavioral recognizer — which was designed to consume behavioral evidence from transitions — is structurally blinded. 5 of 9 signals can never fire.

**Why this is a broken connection, not an intentional decision:**
- R3 was the last thing built before the freeze
- R3's spec says behavioral signals "must be post-handler" — and they ARE (captured via annotation deferral)
- The domain adapter was built before R3 and was never updated to carry R3's output
- The behavioral recognizer was designed to consume this evidence
- The adapter is the exact boundary where R3's intelligence is lost

**Verdict: BROKEN CONNECTION. The most consequential one. R3's behavioral intelligence is captured but never carried past the domain adapter.**

---

## Summary Table: Reassessed

| ID | Original Classification | Reassessed Classification | Reasoning |
|----|------------------------|--------------------------|-----------|
| D-R1 | Disconnect | **BROKEN CONNECTION** | Data captured, used by definitions, preserved by adapter, discarded by pipeline runner |
| D-R2 | Disconnect | **BROKEN CONNECTION** (relatedElementIds) + **GENUINE GAP** (sibling capture) | Related element IDs exist as ancestors but not passed; siblings never captured |
| D-R4 | Disconnect | **BROKEN CONNECTION** | subActions captured but adapter collapses to single transition |
| D-R5 | Disconnect | **BROKEN CONNECTION** | assignTransitionToComponent written but never called |
| D-A1 | Disconnect | **BROKEN CONNECTION** | R2 added Slider; adapter map never updated |
| D-A-RadioButton | Disconnect | **BROKEN CONNECTION** | Adapter predates pattern catalogue's R3-era semantics |
| D-E1 | Disconnect | **ARCHITECTURAL CONSTRAINT** (intentional) | MV3 has no DOM access; fix should capture-at-observation |
| D-E2 | Disconnect | **BROKEN CONNECTION** (consequence of D-R5) | componentId null → contracts empty |
| R3 evidence | (not previously categorized) | **BROKEN CONNECTION** (most critical) | R3 evidence captured but lost at domain adapter boundary |

### What Is Intentional (Should NOT Be Changed)

1. **Behavioral > structural for classification** — The weight hierarchy (behavioral +0.5-0.7 > structural +0.1-0.4) is the correct response to the Amazon failure. Classification should remain behavioral-primary.

2. **Annotation deferral** — Click stays pending until attribute-change arrives. This is how R3 sees post-handler behavioral effects. Should not be reverted.

3. **Structural recognizer as Tier 1 (secondary)** — The two-tier recognition (structural first, behavioral fallback) is intentional. Structural recognition is faster and deterministic for ARIA-compliant components; behavioral is the fallback for custom components.

4. **NoOp DomInspector** — The MV3 constraint is real. The fix should NOT restore DOM access to the service worker. Instead, capture structural context at observation time (content script) and carry it through.

5. **Deletion of old structural classification pipeline** — The deleted `src/pipeline/recognition/` system was a classification pipeline that tried to classify from structure alone. Its deletion was correct. The NEW recognition orchestrator (Phase 4/5) serves a different purpose (grouping, not classification).

### What Is Broken (Should Be Fixed)

All fixes should follow the Amazon lesson's principle: **capture at observation time, carry through the pipeline, never query DOM at analysis time.**

1. **Fix 1 (ancestor bridge)** — Data already captured. Convert string[] → ElementRoleInfo[], pass to orchestrator. Low risk.

2. **Fix 2 (sibling capture)** — New content script capture, following ancestorRoles pattern. Medium risk. This is NOT restoring deleted code — it's implementing a gap that was always intended (OrchestratorInput.siblingElementRoles was defined but never fed).

3. **Fix 3 (subAction expansion)** — Data already captured. Adapter emits multiple transitions from subActions. Medium risk.

4. **Fix 4 (operation mappings)** — Map corrections. Low risk.

5. **Fix 5 (R3 evidence mapping)** — Data already captured (evidenceTrail). Adapter maps IntentVote[] → TransitionEvidence[], produces MUTATION evidence. Medium-high risk. **This is the fix that carries R3's behavioral intelligence past the adapter boundary.**

6. **Fix 6 (componentId wiring)** — Call existing function. Low risk.

7. **Fix 7 (optionSets from subActions)** — Extract from captured data instead of querying DOM. Medium risk. Follows the capture-at-observation principle.

---

## The Central Insight

The Amazon failure taught: **classification must be behavioral, not structural-only.**

R1/R2/R3 implemented this lesson in the Component Runtime classification layer.

The downstream pipeline (domain adapter → recognition → enrichment) was built BEFORE R3 and was never updated to carry the behavioral intelligence forward. Every broken connection is the same pattern: **R3 data exists at observation/classification time but is lost at the domain adapter boundary.**

Restoring ancestor roles, expanding subActions, mapping R3 evidence, wiring componentId — none of these undo the Amazon lesson. They complete the pipeline that was supposed to carry behavioral intelligence from the classification layer to the recognition/enrichment layers. The Amazon lesson is about HOW to classify; these fixes are about CARRYING that classification forward correctly.

The old AI didn't reduce structural information because it thought structure was wrong — it reduced it because the focus was on fixing classification first, and the downstream pipeline wiring was never completed before the freeze.

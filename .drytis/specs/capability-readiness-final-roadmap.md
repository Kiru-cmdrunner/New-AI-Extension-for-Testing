# Capability Readiness — Final Implementation Roadmap

**Date:** 2026-08-08
**Status:** Architecture design and roadmap — no implementation
**Prerequisite:** Track 1 complete (0 tsc errors, 2578 tests passing)
**Scope:** Complete the deterministic foundation before AI Understanding (Track 3)

---

## Governing Principle

> **The objective is not to capture every possible event. It is to ensure that every
> captured interaction produces sufficient evidence for high-precision capability
> inference. We measure readiness by evidence quality, not event count.**

The roadmap is organized into 5 permanent architectural layers. Every gap is assigned
to exactly one layer. Every layer depends only on the layers below it. The dependency
chain is strict: no layer reads above itself.

```
Layer 5: Capability Model     ← "what did the user accomplish?"
    ↑ reads evidence
Layer 4: Component Definitions ← "what kind of interaction was this?"
    ↑ reads evidence + events
Layer 3: Semantic Effects      ← "what did the interaction change?"
    ↑ reads observation results
Layer 2: Evidence Layer        ← "what evidence do we have?"
    ↑ reads raw capture
Layer 1: Observation Layer     ← "what can we see?"
    (Event Tap + State Cache + Observation Coordinator + Network Tap)
```

---

## Part 1: Gap Verification and Layer Reassignment

### Methodology

Each gap from the original Capability Readiness Review has been re-examined against:
1. The actual codebase (verified file paths, line numbers, data flow)
2. The Capability Model Final Architecture (`.drytis/specs/capability-model-final-architecture.md`)
3. Its correct architectural layer (where the fix must live)

### Layer Assignment Audit

| # | Original Gap | Original Layer | Correct Layer | Verification |
|---|-------------|----------------|---------------|-------------|
| 1 | Observation windows only for click+change | CR-1 (misc) | **Layer 1** | `recorder-entry.ts:362-365` — confirmed: `onAfterEvent` called only for click/change |
| 2 | No drag/drop, pointer, touch events | CR-2 (events) | **Layer 1** | `event-tap.ts` — confirmed: 13 event types registered, no pointer/drag/touch |
| 3 | CSS visibility / aria-hidden not interpreted | CR-3 (effects) | **Layer 3** | `effect-rules.ts` — confirmed: 7 rules, none inspect aria-hidden or computed styles |
| 4 | No aria-selected tracking | CR-1 (snapshot) | **Layer 1** + **Layer 3** | `element-state-cache.ts` — confirmed: 9 fields, no aria-selected. Effect rules don't check it. |
| 5 | No network/focus/selection evidence | CR-3 (effects) | **Layer 1** + **Layer 2** + **Layer 5** | Cross-cutting: observation needs capture, evidence needs types, capability needs rules |
| 6 | 15 missing component definitions | CR-4 | **Layer 4** | `definitions/index.ts` — confirmed: 14 definitions. All 15 proposed additions are absent. |
| 7 | 14+ missing capability types | CR-5 | **Layer 5** | `capability-types.ts` — confirmed: 12 types + Unclassified |
| 8 | Generation layer gaps (RadioButton, FileUpload, iframe, Shadow DOM) | Not categorized | **Generation Layer** (post-IR) | `ir-bridge.ts:55-71` — confirmed: RadioButton→SELECT, FileUpload→FILL, no iframe context in IR |
| 9 | Aspirational Architecture C types disconnected | Not categorized | **Layer 2** (Technical Debt) | `evidence-types.ts` — confirmed: 407 lines of types never wired into the pipeline |

### Newly Identified Gaps (not in original review)

| # | Gap | Layer | Impact | Source |
|---|-----|-------|--------|--------|
| N1 | DocumentObserver does not observe Shadow DOM roots | **Layer 1** | Mutations inside Shadow DOM components (common in MUI, Lit, Fast) are invisible to observation windows | `document-observer.ts` observes `document.body` only |
| N2 | ObservationCoordinator has no timing/dwell tracking | **Layer 1** | No general-purpose timing evidence (only Hover tracks dwell internally) | `observation-coordinator.ts` — window has no duration tracking exposed |
| N3 | Evidence Extractor doesn't extract post-interaction value | **Layer 2** | PhysicalEvidence has no `valueAfter` — the final value of an input element after interaction | `evidence-extractor.ts` — extracts `tag`, `ariaRole`, `accessibleName`, `href` but not value |
| N4 | Enrichment layer (componentType, businessMeaning) not consumed by capability engine | **Layer 5** | The three-layer enrichment produces componentType and businessMeaning but the capability engine ignores them entirely — it re-derives signals from raw evidence | `evidence-extractor.ts` reads `interaction.trigger` directly; never reads `interaction.componentType` or `interaction.businessMeaning` |
| N5 | SequenceContext doesn't track time gaps | **Layer 2** | No temporal context (how long between interactions, dwell time, session pacing) | `evidence-extractor.ts` — `extractSequence()` has no timing fields |
| N6 | Generated code has no assertion generation | **Generation Layer** | `deriveAssertions()` always returns `[]` — no post-action verification | `ir-bridge.ts:252-263` |
| N7 | Iframe interactions generate locators that won't resolve | **Generation Layer** | `inIframe` and `iframeContext` exist on ElementIdentity but IR doesn't carry them; Playwright output has no `frameLocator` | `ir-bridge.ts:103-112` — `resolveElementTarget()` ignores iframe context |
| N8 | Shadow DOM locators missing from generated code | **Generation Layer** | Playwright supports `>>` piercing syntax but IR doesn't emit it | `ir-bridge.ts` — `resolveLocatorsForIR()` doesn't produce shadow-piercing locators |
| N9 | Aspirational evidence types in `evidence-types.ts` (407 lines) are completely disconnected | **Layer 2** (debt) | `InteractionSnapshot`, `RawEvidence`, `SnapshotForAI`, `AIIntentResult`, `CoalescingConfig` — all defined, none imported by any live module. Creates confusion about which evidence model is active. | `evidence-types.ts` imports from `architecture-types.ts` which itself may be dead |
| N10 | Visual evidence: ScreenshotService exists but is unused | **Layer 1** | `src/screenshots/screenshot-service.ts` exists but Phase 5 pipeline never calls it | Researcher confirmed: not called from any Phase 5 code path |

### Gaps Removed from Roadmap (Reassigned as Technical Debt)

| Gap | Reason |
|-----|--------|
| Accessibility tree snapshot | This is an AI-enhancement feature (Track 3), not deterministic foundation. Individual ARIA attributes are already captured deterministically. A full a11y tree is visual enrichment. |
| Canvas/WebGL interaction | Canvas drawing is inherently non-deterministic (pixel-level). This is an AI vision problem, not a deterministic evidence problem. Deferred to Track 3 + visual evidence. |
| Keyboard shortcut modeling | Keydown events ARE captured. The gap is no Component Definition classifies keyboard-only workflows. This is Layer 4, but low priority — shortcuts are rare in test scenarios. |
| Non-English keyword dictionary | The keyword dictionary is English-only. This is a localization concern, not an architectural gap. The deterministic evidence pipeline works regardless of language; only keyword matching is affected. |

---

## Part 2: Layered Architecture — Detailed Gap Inventory

### Layer 1: Observation Layer

**Purpose:** Capture raw browser events, DOM state, mutations, and environmental signals.

**Current state:**
- 13 event types registered (click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll, navigation)
- Observation windows open ONLY for click and change events (3s duration)
- MutationObserver observes document.body (childList, attributes, characterData, subtree)
- Element State Cache: 9 fields (value, checked, className, disabled, ariaExpanded, ariaChecked, ariaPressed, textContent, childCount)
- Shadow DOM: composedPath() resolves targets, but MutationObserver does NOT observe shadow roots
- Iframe: detected at recording time, but cross-origin iframes are inaccessible

**Layer 1 Gaps:**

| Gap ID | Description | Impact | Blocked By | Unblocks |
|--------|-------------|--------|-----------|----------|
| L1-01 | Observation windows only open for click+change | 70%+ of classified interactions produce ZERO behavioral evidence. TextEntry, Slider, Hover, Scroll, DatePicker, ColorInput interactions have no semantic effects. | Nothing | L3-* (all effect rules need observation data) |
| L1-02 | No drag/drop, pointer, or touch events registered | Entire class of modern interactions invisible | Nothing | L4-DragDrop |
| L1-03 | No aria-selected in ElementStateSnapshot | Tab/listbox/tree selection invisible to snapshot and effect rules | Nothing | L3-06 |
| L1-04 | No aria-hidden in ElementStateSnapshot | SPA show/hide via aria-hidden produces only 'unclassified' mutations | Nothing | L3-07 |
| L1-05 | No aria-current in ElementStateSnapshot | Current page/step/breadcrumb selection invisible | Nothing | L3-08 |
| L1-06 | No computed style capture (display, visibility, opacity) | CSS-based visibility changes completely invisible | Nothing | L3-07, L3-09 |
| L1-07 | No network request interception | Cannot correlate actions with API calls | Nothing | L2-03, L5-NetworkRules |
| L1-08 | DocumentObserver doesn't observe Shadow DOM roots | Mutations inside Shadow DOM components invisible (MUI, Lit, Fast) | Nothing | L3-* for shadow components |
| L1-09 | No general-purpose timing/dwell tracking | Temporal evidence unavailable | Nothing | L2-04 |
| L1-10 | ScreenshotService exists but unused | No visual evidence | Nothing | Track 3 (visual analysis) |
| L1-11 | No focus tracking during observation windows | Focus management invisible (modal focus traps, focus shifts) | Nothing | L3-10 |

### Layer 2: Evidence Layer

**Purpose:** Transform raw capture into structured evidence types consumed by definitions, effects, and capability rules.

**Current state:**
- EvidenceLedger tracks capture guarantees (dispositions: pending → absorbed → claimed/unclaimed)
- EvidenceExtractor produces ExtractedEvidence with 4 sub-objects: Physical, Behavioral, Sequence, Keywords
- Aspirational Architecture C types (InteractionSnapshot, RawEvidence, SnapshotForAI, AIIntentResult) exist but are completely disconnected (407 lines of dead types)

**Layer 2 Gaps:**

| Gap ID | Description | Impact | Blocked By | Unblocks |
|--------|-------------|--------|-----------|----------|
| L2-01 | PhysicalEvidence has no post-interaction value | Cannot evidence what value an element held after interaction | L1-01 (need observations to capture it) | L5-* rules that reason about final values |
| L2-02 | Aspirational evidence types disconnected (407 lines) | Confusion about which evidence model is active; dead code | Nothing (cleanup) | Clarity |
| L2-03 | No NetworkEvidence type | Cannot represent API calls/responses as evidence | L1-07 (needs network tap) | L5-NetworkRules |
| L2-04 | No temporal/timing evidence | No time-between-interactions, dwell time, or session pacing evidence | L1-09 | L5-temporal-aware rules |
| L2-05 | Enrichment (componentType, businessMeaning) not consumed by EvidenceExtractor | Capability engine re-derives signals from raw identity; ignores the semantic enrichment already computed | Nothing | L5-rules could use componentType as signal |
| L2-06 | SequenceContext doesn't track modifier keys | Multi-select (Ctrl/Shift+click) indistinguishable from single click | L1-01 (modifier keys ARE on ObservedEvent but not surfaced) | L4-MultiSelect |

### Layer 3: Semantic Effects

**Purpose:** Interpret DOM changes into categorized semantic effects that describe what an interaction did.

**Current state:**
- 7 effect categories: state-toggle, expand-collapse, enable-disable, content-change, visibility-change, no-observable-effect, unclassified
- Direct-property rules (state-toggle, expand-collapse, enable-disable) are always HIGH confidence
- Structural rules (content-change, visibility-change) degrade on noise/early-close
- `class` and `style` attribute changes → unclassified (no rule interprets them)

**Layer 3 Gaps:**

| Gap ID | Description | Impact | Blocked By | Unblocks |
|--------|-------------|--------|-----------|----------|
| L3-01 | class attribute changes → unclassified | Framework state changes (active/selected/open/focus classes) are the primary mechanism for Angular, Vue, and custom widgets | Nothing | Better classification of custom components |
| L3-02 | style attribute changes → unclassified | CSS display/visibility/opacity toggles produce no semantic effect | L1-06 (need computed style to validate) | L3-07 (proper visibility-change from CSS) |
| L3-03 | aria-hidden changes not interpreted | Most common SPA show/hide mechanism after class toggling | L1-04 (snapshot needs aria-hidden) | Visibility inference |
| L3-04 | aria-selected changes not interpreted | Tab/listbox/tree selection produces no semantic effect | L1-03 (snapshot needs aria-selected) | Tab/SwitchTab capability |
| L3-05 | aria-current changes not interpreted | Current page/breadcrumb/step changes produce no semantic effect | L1-05 (snapshot needs aria-current) | Navigation context |
| L3-06 | No "element appeared" inference | Cannot infer content was shown (only sees childList additions as content-change) | Nothing (can be derived from childList + computed style) | OpenModal, ExpandCollapse improvements |
| L3-07 | No proper visibility-change from CSS | visibility-change fires ONLY on element-removed. Cannot detect display:none toggling. | L1-06 (need computed style) | Show/hide inference |
| L3-08 | No value-change effect | JavaScript property mutations (element.value set by framework) not detected as semantic effects | L1-01 (need observation to capture) | Better value tracking for custom widgets |
| L3-09 | No focus-change effect | Focus shifts during observation windows produce no semantic effect | L1-11 (need focus tracking) | Modal detection, focus trap detection |
| L3-10 | No selection-change effect | Text selection range changes produce no semantic effect | Nothing (selectionchange event needed in Layer 1) | Copy/paste capability |

### Layer 4: Component Definitions

**Purpose:** Classify raw events into typed interactions with rich metadata.

**Current state:**
- 14 definitions registered, priority 10–180
- 10 are "fully complete" (rich metadata + lifecycle logic)
- 4 are "basic but functional" (Tab, Link, FileUpload, Navigation)

**Layer 4 Gaps:**

| Gap ID | Description | Priority | Blocked By | Unblocks |
|--------|-------------|----------|-----------|----------|
| L4-01 | RadioButton doesn't emit selectedValue (TD-1) | High | Nothing | Correct Playwright codegen |
| L4-02 | Tab definition lacks aria-selected tracking | Medium | L1-03 | SwitchTab capability |
| L4-03 | Link definition lacks link-type classification | Low | Nothing | Internal vs external navigation |
| L4-04 | No DragDrop definition | High | L1-02 (needs drag events) | DragAndDrop capability |
| L4-05 | No MultiSelect definition | Medium | L2-06 (needs modifier key evidence) | MultiSelect capability |
| L4-06 | No Autocomplete definition | Medium | L1-01 (needs observation for cross-element sequences) | Search refinement capability |
| L4-07 | No RichTextEditor definition | Low | L1-01 (needs contentEditable observation) | FormatText capability |
| L4-08 | No Carousel/Gallery definition | Low | Nothing | Paginate refinement |
| L4-09 | No Stepper/QuantityCounter definition | Low | Nothing | AdjustValue refinement |
| L4-10 | No TreeView definition | Low | L1-03 (needs aria-selected, aria-level) | Expand/collapse in trees |
| L4-11 | No ContextMenu (custom) definition | Low | Nothing | Custom menu interaction |
| L4-12 | No TimePicker (custom) definition | Low | Nothing | Time selection |

### Layer 5: Capability Model

**Purpose:** Infer what the user accomplished from the available evidence.

**Current state:**
- 12 capability types + Unclassified fallback
- 12 rules, priority-ordered (UploadFile=10, OpenDetail=10, AdjustValue=22, ToggleControl=20, etc.)
- Conflict resolver: highest confidence → most distinct streams → lowest priority number → direct-property tiebreaker

**Layer 5 Gaps:**

| Gap ID | Description | Impact | Blocked By | Unblocks |
|--------|-------------|--------|-----------|----------|
| L5-01 | No DragAndDrop capability | Cannot classify DnD intent | L4-04 | DnD test generation |
| L5-02 | No OpenModal / CloseModal capability | Cannot classify modal interactions | L3-06 (needs "element appeared" inference) | Modal test generation |
| L5-03 | No SwitchTab capability | Cannot classify tab switching | L3-04 (needs aria-selected effect) | Tab test generation |
| L5-04 | No HoverReveal capability | Cannot classify tooltip/popover reveals | L1-01 (hover needs observation) | Hover test generation |
| L5-05 | No network-aware capability rules | Cannot distinguish async vs sync operations | L2-03 (needs NetworkEvidence) | Async behavior classification |
| L5-06 | Capability engine ignores enrichment (componentType, businessMeaning) | The three-layer enrichment produces semantic information that the capability engine discards | Nothing (architectural decision needed) | Higher-precision inference |
| L5-07 | No CopyPaste / clipboard capability | Cannot classify clipboard operations | L3-10 (needs selection-change effect) | Clipboard test generation |
| L5-08 | No multi-select capability | Cannot classify Ctrl/Shift+click multi-select | L4-05 (needs MultiSelect definition) | Multi-select test generation |

### Generation Layer (Post-IR)

**Purpose:** Compile ComponentInteraction[] into ExecutionIRPlan, then into framework-specific code.

**Current state:**
- 15 InteractionTypes mapped to 10 IRActions
- Playwright adapter handles all 10 IRAction types
- Scroll and Unclassified filtered as noise
- `deriveAssertions()` always returns `[]` (Track 3 dependency)

**Generation Gaps:**

| Gap ID | Description | Impact | Blocked By |
|--------|-------------|--------|-----------|
| G-01 | RadioButton → SELECT (should be CLICK on radio element) | Generated code uses `selectOption('')` which fails on radio inputs | Nothing (TD-1 related) |
| G-02 | FileUpload → FILL (should use setInputFiles) | Generated code cannot upload files | Nothing |
| G-03 | No iframe frameLocator in output | Generated code fails on iframe-contained elements | Nothing |
| G-04 | No Shadow DOM piercing locators | Generated code may fail on Shadow DOM elements | Nothing |
| G-05 | Slider/ColorInput → FILL (may not trigger React onChange) | Generated code may not work with controlled inputs | Nothing |
| G-06 | No assertion generation | Tests have no post-action verification | Track 3 (AI Understanding) |

---

## Part 3: The Final Implementation Roadmap

### Sequencing Principles

1. **Unblock the maximum number of downstream gaps first.** L1-01 (observation expansion) unblocks the most Layer 3, 4, and 5 work.
2. **Never introduce a new evidence stream without adding at least one consumer.** Dead evidence types are the lesson from Architecture C (407 lines of unused types).
3. **Every phase must independently pass tsc + tests + build.** No half-states.
4. **Generation Layer fixes are independent of the evidence pipeline.** They can run in parallel with the deterministic foundation work.
5. **Technical debt cleanup is scheduled, not opportunistic.** L2-02 (dead types) gets its own milestone.

### Roadmap Overview

```
Phase DF-1: Observation Expansion          [Layer 1]    — highest ROI, unblocks 70% of evidence
Phase DF-2: Evidence Foundation            [Layer 2]    — extract real values, clean dead types
Phase DF-3: Effect Interpretation          [Layer 3]    — interpret class, style, ARIA state changes
Phase DF-4: Definition Completeness        [Layer 4]    — fix TD-1, enrich Tab/Link, add high-value definitions
Phase DF-5: Capability Expansion           [Layer 5]    — new rules + enrichment consumption
Phase DF-6: Network Evidence               [Cross-cutting] — capture, type, and consume network evidence
Phase DF-7: Generation Layer Hardening     [Generation] — fix RadioButton, FileUpload, iframe, Shadow DOM
Phase DF-8: Shadow DOM Observation         [Layer 1]    — observe mutations inside shadow roots
```

### Phase DF-1: Observation Expansion (Layer 1)

**Goal:** Give every classified interaction behavioral evidence by opening observation windows for all event types that produce interactions.

**Why first:** This is the single highest-ROI change. Currently, only click and change events open observation windows. TextEntry, Slider, Hover, Scroll, DatePicker, ColorInput — 7 of 14 definitions — produce interactions with ZERO behavioral evidence. No semantic effects, no mutation observation, nothing.

**Changes:**

| Step | What | File(s) | Layer |
|------|------|---------|-------|
| DF-1.1 | Expand `onAfterEvent` triggers from `{click, change}` to all discrete interaction triggers (focus, blur, mouseenter, mouseleave, input, keydown) | `recorder-entry.ts:362-365` | Layer 1 |
| DF-1.2 | Add `aria-selected`, `aria-hidden`, `aria-current`, `aria-controls`, `aria-owns`, `aria-describedby` to ElementStateSnapshot | `element-state-cache.ts` (9 → 15 fields) | Layer 1 |
| DF-1.3 | Add lightweight computed-style proxy: capture `display`, `visibility`, `opacity` on trigger element in before/after snapshots | `element-state-cache.ts` | Layer 1 |
| DF-1.4 | Add pointerdown, pointerup, pointermove, dragstart, dragend, drop event listeners to EventTap | `event-tap.ts` (13 → 20 types), `component-types.ts` BrowserEventType | Layer 1 |
| DF-1.5 | Add touchstart, touchend, touchmove (as fallback for non-pointer-event browsers) | `event-tap.ts` (20 → 23 types) | Layer 1 |

**Risk:** Medium. Opening more observation windows increases MutationObserver activity. Mitigation: the observer is already refcounted; multiple windows share one observer. Performance impact is bounded by the existing `PerformanceCondition` throttle.

**Validation:**
- Existing 2578 tests pass unchanged (behavior for click/change is identical)
- New tests: verify observation windows open for focus, input, mouseenter events
- tsc: 0 errors (BrowserEventType union must be updated)
- Build: passes

**Unblocks:** L3-01 through L3-10 (all effect rule additions), L4-04 (DragDrop), L4-06 (Autocomplete)

**Estimated new test files:** 3–4 (observation expansion tests, new snapshot field tests, pointer event tests)

---

### Phase DF-2: Evidence Foundation (Layer 2)

**Goal:** Make the evidence extractor produce real, complete evidence — and remove the dead Architecture C types that create confusion.

**Changes:**

| Step | What | File(s) | Layer |
|------|------|---------|-------|
| DF-2.1 | Add `valueAfter` to PhysicalEvidence — the element's value after interaction (from metadata or triggerEvent.valueAfter) | `evidence-extractor.ts` | Layer 2 |
| DF-2.2 | Add `timeSincePrevious` and `dwellTime` to SequenceContext (computed from startTime/endTime deltas) | `evidence-extractor.ts` | Layer 2 |
| DF-2.3 | Add `modifierKeys` to SequenceContext (shift/ctrl/alt/meta from triggerEvent) | `evidence-extractor.ts` | Layer 2 |
| DF-2.4 | Add `componentType` and `businessMeaning` to PhysicalEvidence (read from interaction.componentType/businessMeaning enrichment) | `evidence-extractor.ts` | Layer 2 |
| DF-2.5 | Delete or archive `src/shared/evidence-types.ts` (407 lines of disconnected Architecture C types) | `evidence-types.ts` | Layer 2 (debt) |
| DF-2.6 | Verify `src/shared/architecture-types.ts` is not imported by live code; if dead, delete it | `architecture-types.ts` | Layer 2 (debt) |

**Risk:** Low for DF-2.1–DF-2.4 (additive). Medium for DF-2.5–DF-2.6 (deletion — must verify zero live imports first, following the same protocol as TD-2 deletion).

**Validation:**
- All 2578 tests pass
- New tests: verify PhysicalEvidence.valueAfter, SequenceContext.timeSincePrevious, etc.
- tsc: 0 errors
- Build: passes

**Unblocks:** L5-06 (enrichment consumption), L4-05 (MultiSelect needs modifierKeys)

---

### Phase DF-3: Effect Interpretation Enhancement (Layer 3)

**Goal:** Interpret the DOM changes that currently fall through to 'unclassified' into meaningful semantic effects.

**Changes:**

| Step | What | File(s) | Layer |
|------|------|---------|-------|
| DF-3.1 | Add `class-state-change` effect rule: detect semantic class additions/removals (active, selected, checked, open, focus, current, disabled, hidden) | `effect-rules.ts`, `effect-types.ts` | Layer 3 |
| DF-3.2 | Add `aria-hidden` detection to visibility-change rule: when aria-hidden attribute toggles, emit visibility-change effect | `effect-rules.ts` | Layer 3 |
| DF-3.3 | Add `aria-selected` detection to a new `selection-change` effect rule | `effect-rules.ts`, `effect-types.ts` | Layer 3 |
| DF-3.4 | Add `aria-current` detection to a new `navigation-state` effect rule | `effect-rules.ts`, `effect-types.ts` | Layer 3 |
| DF-3.5 | Enhance visibility-change rule: use computed-style proxy (from DF-1.3) to detect `display:none` ↔ `display:block` and `visibility:hidden` ↔ `visibility:visible` transitions | `effect-rules.ts` | Layer 3 |
| DF-3.6 | Add `value-change` effect rule: detect JavaScript property mutations (element.value changed without a matching input/change event) | `effect-rules.ts`, `effect-types.ts` | Layer 3 |
| DF-3.7 | Add `focus-change` effect rule: emit effect when `document.activeElement` changes during observation window | `effect-rules.ts`, `effect-types.ts` | Layer 3 |

**Risk:** Medium. New effect rules are additive (the interpreter runs all rules and collects results). The main risk is over-classification — too many effects could confuse the capability conflict resolver. Mitigation: each new effect category must be tested against the existing 12 capability rules to verify no spurious claims.

**New EffectCategory union members (from 7 to ~13):**
```
state-toggle, expand-collapse, enable-disable, content-change,
visibility-change, no-observable-effect, unclassified,
class-state-change, selection-change, navigation-state,
value-change, focus-change
```

**Validation:**
- All existing tests pass (existing effects unchanged)
- New tests: one test per new effect rule (trigger condition, effect output, confidence)
- Integration tests: verify new effects flow through evidence-extractor → capability rules
- tsc: 0 errors
- Build: passes

**Unblocks:** L5-02 (OpenModal needs "element appeared" from visibility-change), L5-03 (SwitchTab needs selection-change), L5-04 (HoverReveal needs observation + visibility-change)

---

### Phase DF-4: Definition Completeness (Layer 4)

**Goal:** Fix metadata gaps in existing definitions and add high-value new definitions.

**Changes:**

| Step | What | Priority | Blocked By | Layer |
|------|------|----------|-----------|-------|
| DF-4.1 | Fix TD-1: RadioButton `buildResult()` emits `selectedValue` | High | Nothing | Layer 4 |
| DF-4.2 | Enrich Tab definition: track aria-selected, associate with aria-controls/tabpanel | Medium | DF-1.2 (aria-selected in snapshot) | Layer 4 |
| DF-4.3 | Enrich Link definition: classify link type (internal, external, mailto, tel, download, target=_blank) | Low | Nothing | Layer 4 |
| DF-4.4 | Add DragDrop definition (mousedown→mousemove→mouseup / dragstart→drop lifecycle) | High | DF-1.4 (pointer/drag events) | Layer 4 |
| DF-4.5 | Add MultiSelect definition (click + modifier key: Ctrl/Shift+click on same-list elements) | Medium | DF-2.3 (modifierKeys evidence) | Layer 4 |
| DF-4.6 | Add Autocomplete definition (TextEntry + delayed Click on suggestion element) | Medium | DF-1.1 (observation for cross-element sequences) | Layer 4 |
| DF-4.7 | Add Stepper/QuantityCounter definition (repeated +/- clicks on adjacent elements with value tracking) | Low | Nothing | Layer 4 |

**Definition priority assignments for new types:**
- DragDrop: priority 55 (after Hover=60, before TextEntry=50 — no, between Checkbox=30 and TextEntry=50). Actually: DragDrop should be checked early because mousedown is also claimed by other definitions. Priority: 5 (before DatePicker=10) or handled via gesture coalescing like Scroll.
- MultiSelect: priority 175 (just before Click=180) — it's a Click variant with modifier semantics.
- Autocomplete: priority 45 (between RadioButton=40 and TextEntry=50).
- Stepper: priority 170 (just before Click=180) — it's a Click variant with cumulative semantics.

**Risk:** Medium. New definitions must not break the priority discovery chain. Each definition is self-contained (AP7: additive extensibility) and tested independently. The risk is priority conflicts — a new definition claiming events that an existing definition should have gotten.

**Validation:**
- All existing tests pass (no existing definition's priority changes)
- New tests: one test file per new definition (detectTrigger, handleEvent, buildResult)
- Integration test: new definitions produce correct interactions when fed realistic event sequences
- TD-1 fix verified: RadioButton test checks `metadata.selectedValue` is non-null
- tsc: 0 errors
- Build: passes

---

### Phase DF-5: Capability Expansion (Layer 5)

**Goal:** Add capability rules that consume the new evidence types and effect categories to infer new capabilities.

**Changes:**

| Step | What | Priority | Blocked By | Layer |
|------|------|----------|-----------|-------|
| DF-5.1 | Wire enrichment into EvidenceExtractor: `componentType` and `businessMeaning` flow into PhysicalEvidence as supporting signals | — | DF-2.4 | Layer 5 |
| DF-5.2 | Add DragAndDrop capability rule (consumes DragDrop definition type) | 15 | DF-4.4 | Layer 5 |
| DF-5.3 | Add OpenModal capability rule (consumes content-change + visibility-change showing "element appeared" on a dialog/modal ancestor) | 28 | DF-3.5 (CSS visibility inference) | Layer 5 |
| DF-5.4 | Add SwitchTab capability rule (consumes selection-change effect + Tab definition type) | 27 | DF-3.3 (selection-change effect) | Layer 5 |
| DF-5.5 | Add HoverReveal capability rule (consumes Hover definition type + visibility-change effect on tooltip/popover) | 26 | DF-1.1 (hover observation), DF-3.5 | Layer 5 |
| DF-5.6 | Add MultiSelect capability rule (consumes MultiSelect definition type) | 16 | DF-4.5 | Layer 5 |
| DF-5.7 | Expand CapabilityType union: add DragAndDrop, OpenModal, CloseModal, SwitchTab, HoverReveal, MultiSelect | — | — | Layer 5 |

**Risk:** Low–Medium. New rules are additive. The conflict resolver handles arbitrary numbers of rules. The risk is two rules producing equal-confidence claims on the same interaction — resolved by priority ordering.

**Validation:**
- All existing capability tests pass (existing 12 rules unchanged)
- New tests: one test per new rule (required signals, supporting signals, confidence levels)
- Integration: new rules don't produce spurious claims on existing test interactions
- tsc: 0 errors
- Build: passes

---

### Phase DF-6: Network Evidence (Cross-Cutting)

**Goal:** Capture network requests triggered by interactions and make them available as evidence for capability rules.

**Why separate from DF-1–DF-5:** Network evidence is a new evidence stream that spans three layers (Observation capture → Evidence type → Capability rule). It requires new infrastructure (a network tap) and has distinct risks (performance, privacy, cross-origin restrictions). It should not block or be blocked by the effect/definition/capability work.

**Changes:**

| Step | What | File(s) | Layer |
|------|------|---------|-------|
| DF-6.1 | Add NetworkTap module: monkey-patch `fetch` and `XMLHttpRequest.prototype.open/send` in the content script to capture requests during observation windows | New file: `src/tap/network-tap.ts` | Layer 1 |
| DF-6.2 | Add NetworkEvidence type: `requestsTriggered[]`, `hasApiCall`, `apiEndpoint`, `responseIndicatedSuccess` | `evidence-extractor.ts` | Layer 2 |
| DF-6.3 | Integrate NetworkTap with ObservationCoordinator: start/stop capture per observation window | `observation-coordinator.ts` | Layer 1 |
| DF-6.4 | Add `hasNetworkEvidence` and `apiEndpoint` to ExtractedEvidence as a new evidence sub-object | `evidence-extractor.ts` | Layer 2 |
| DF-6.5 | Update capability rules to optionally consume network evidence: Search (confirms async search), SubmitForm (confirms form submission), FilterSelection (confirms server-side filtering) | Rules in `src/capabilities/rules/` | Layer 5 |

**Risk:** High. Network interception is the most invasive new subsystem:
- `fetch`/XHR monkey-patching can break application code if not done carefully
- Privacy: request bodies may contain sensitive data (PII, tokens). Must NOT capture request/response bodies in the evidence — only method, URL, status, timing.
- Cross-origin: content script can only intercept same-origin requests. Cross-origin requests from the page itself (not via fetch/XHR in the content script context) are invisible.
- Performance: high-volume API apps (real-time dashboards) could generate excessive capture

**Mitigations:**
- Capture ONLY: method, URL (pathname only — strip query params for privacy), status code, durationMs, initiatedBy ('fetch'|'xhr'|'beacon')
- Rate-limit: max 50 requests per observation window
- Privacy: never capture request/response bodies, headers, or cookies

**Validation:**
- All existing tests pass (network evidence is additive — rules that don't read it are unaffected)
- New tests: NetworkTap captures fetch/XHR correctly, privacy filters work, rate limiting works
- Integration: SubmitForm rule gets HIGH confidence when network evidence confirms a POST
- tsc: 0 errors
- Build: passes

---

### Phase DF-7: Generation Layer Hardening (Generation)

**Goal:** Fix the known correctness gaps in the IR Bridge and Playwright adapter.

**Changes:**

| Step | What | File(s) | Severity |
|------|------|---------|----------|
| DF-7.1 | Fix RadioButton: change INTERACTION_TO_IR_ACTION from SELECT to CLICK (or add new IRAction.RADIO_SELECT). Radio buttons in Playwright are clicked, not selectOption'd. Resolve TD-1 dependency. | `ir-bridge.ts:55-71` | High |
| DF-7.2 | Fix FileUpload: add IRAction.UPLOAD_FILE and map FileUpload → UPLOAD_FILE. Adapter generates `locator.setInputFiles()`. | `ir-bridge.ts`, `action-renderer.ts`, `types.ts` (execution-ir) | High |
| DF-7.3 | Add iframe context to IR: extend ResolvedTarget with `iframeContext` field. Adapter generates `page.frameLocator(...)` wrapping. | `ir-bridge.ts`, `action-renderer.ts` | High |
| DF-7.4 | Add Shadow DOM piercing locators: when `identity.shadowDom` is true, emit CSS selector with `>>` piercing syntax for Playwright | `ir-bridge.ts:resolveLocatorsForIR()`, `locator-ranking.ts` | Medium |
| DF-7.5 | Fix Slider mapping: add IRAction.SET_RANGE. Adapter generates keyboard-based slider interaction (focus + ArrowLeft/ArrowRight to target value) as primary, with `fill()` as fallback. | `ir-bridge.ts`, `action-renderer.ts` | Medium |
| DF-7.6 | Fix ColorInput mapping: add IRAction.SET_COLOR. Adapter generates `locator.evaluate()` for hex value setting. | `ir-bridge.ts`, `action-renderer.ts` | Medium |

**Risk:** Medium. IRAction changes are additive (new enum members). The risk is that changing existing mappings (RadioButton SELECT→CLICK) changes generated code — this MUST be verified with before/after snapshot tests.

**Validation:**
- Snapshot test: generate Playwright code from a fixed set of 14 interaction types BEFORE changes. After changes, diff the output. Only the intentionally-changed types (RadioButton, FileUpload, Slider, ColorInput) should differ.
- All existing tests pass
- New tests: iframe frameLocator in output, Shadow DOM piercing selector in output, setInputFiles in output
- tsc: 0 errors
- Build: passes

---

### Phase DF-8: Shadow DOM Observation (Layer 1)

**Goal:** Make MutationObserver observe mutations inside open Shadow DOM roots.

**Why last:** Shadow DOM observation is architecturally complex (roots can be added/removed dynamically, nested shadow trees). It's important for enterprise apps using web components but doesn't block the core deterministic foundation.

**Changes:**

| Step | What | File(s) | Layer |
|------|------|---------|-------|
| DF-8.1 | Add `observeShadowRootsRecursive()`: traverse document, find all open shadow roots, attach MutationObservers (refcounted with the main document observer) | `document-observer.ts` | Layer 1 |
| DF-8.2 | Handle dynamic shadow root insertion: when a MutationObserver detects a new element with a shadow root, attach an observer to it | `document-observer.ts` | Layer 1 |
| DF-8.3 | Update mutation target paths: include shadow root boundary markers in CSS paths (for accurate effect targeting) | `document-observer.ts`, `element-state-cache.ts` | Layer 1 |

**Risk:** Medium–High. Performance: each shadow root adds a MutationObserver. Deeply nested shadow trees (MUI Slider → multiple shadow roots) could create excessive observers. Mitigation: limit to depth 5, clean up observers on window close.

**Validation:**
- All existing tests pass
- New tests: shadow DOM mutations are captured during observation windows
- Performance test: observe a page with 50 shadow components and verify no PerformanceCondition degradation
- tsc: 0 errors
- Build: passes

---

## Part 4: Dependency Graph

```
DF-1 (Observation Expansion)
 ├──→ DF-3 (Effect Interpretation) — needs new snapshot fields + observation windows
 │     ├──→ DF-5 (Capability Expansion) — needs new effect categories
 │     └──→ DF-4 (Definition Completeness) — some definitions need effect evidence
 │
 ├──→ DF-4 (Definition Completeness) — DragDrop needs pointer events, Autocomplete needs observation
 │     ├──→ DF-5 (Capability Expansion) — needs new definition types
 │     └──→
 │
 └──→ DF-8 (Shadow DOM Observation) — independent of effect rules

DF-2 (Evidence Foundation)
 ├──→ DF-5 (Capability Expansion) — needs new evidence fields
 └──→ DF-4 (Definition Completeness) — MultiSelect needs modifierKeys

DF-6 (Network Evidence) — independent track
DF-7 (Generation Hardening) — independent track
```

**Critical path:** DF-1 → DF-3 → DF-5 (Observation → Effects → Capabilities)
**Parallel tracks:** DF-2, DF-6, DF-7 can run alongside the critical path.
**Independent:** DF-8 can run anytime after DF-1.

---

## Part 5: Definition of "Deterministic Foundation Complete"

The deterministic foundation is complete when ALL of the following hold:

### Evidence Completeness
- [ ] Every classified interaction type (14 existing + new from DF-4) has observation windows that capture behavioral evidence
- [ ] ElementStateSnapshot covers all ARIA state attributes used by the 14+ definitions (aria-selected, aria-hidden, aria-current, aria-expanded, aria-checked, aria-pressed, aria-disabled)
- [ ] Computed style proxy captures display/visibility/opacity for visibility inference
- [ ] Network evidence is available as an optional evidence stream

### Effect Completeness
- [ ] No DOM attribute change that has semantic meaning falls through to 'unclassified' — every meaningful ARIA state change, class state change, and CSS visibility change produces a categorized effect
- [ ] The 'unclassified' category is reserved for genuinely ambiguous mutations (data-* attributes, non-semantic class changes)

### Definition Completeness
- [ ] TD-1 resolved (RadioButton emits selectedValue)
- [ ] All "basic" definitions (Tab, Link) enriched with their domain-specific metadata
- [ ] At least DragDrop, MultiSelect, and Autocomplete definitions exist (the three highest-value missing types)

### Capability Completeness
- [ ] Capability engine consumes enrichment (componentType, businessMeaning) as supporting signals
- [ ] At least DragAndDrop, OpenModal, SwitchTab capability rules exist
- [ ] No classified interaction falls to 'Unclassified' capability when deterministic evidence exists to classify it

### Generation Correctness
- [ ] RadioButton generates `.click()` not `.selectOption('')`
- [ ] FileUpload generates `.setInputFiles()` not `.fill()`
- [ ] Iframe interactions generate `frameLocator()` wrappers
- [ ] Shadow DOM elements generate piercing locators

### Codebase Hygiene
- [ ] Zero tsc errors maintained
- [ ] Dead Architecture C types (`evidence-types.ts`) removed or archived
- [ ] `deterministic-recorder.ts` (TD-3, ~2700 lines dead code) deleted
- [ ] Every new evidence type has at least one consumer (no dead evidence)

---

## Part 6: What This Roadmap Does NOT Do

1. **No AI Understanding** — AI is advisory, never deterministic. It enters in Track 3.
2. **No visual screenshot analysis** — Screenshots may be captured (DF-1 enables the hook), but visual analysis (pixel diff, "what did the user see") is Track 3.
3. **No accessibility tree** — Individual ARIA attributes are captured. Full a11y tree analysis is Track 3.
4. **No business context integration** — Jira/user story correlation is Track 3+.
5. **No Canvas/WebGL** — These are inherently non-deterministic at the DOM level. They require visual AI analysis (Track 3).
6. **No closed Shadow DOM** — Closed roots are inaccessible by design. Not solvable without browser extension APIs beyond content scripts.
7. **No cross-origin iframe observation** — Content scripts cannot be injected into cross-origin frames. This is a browser security limitation.

---

## Part 7: Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Observation expansion degrades recorder performance | Medium | High (recorder must stay responsive) | PerformanceCondition already throttles; test with 100+ mutation pages |
| New effect rules over-classify (too many effects → confused capability resolver) | Medium | Medium | Test each new effect against existing 12 capability rules; verify no spurious claims |
| Network tap breaks application fetch/XHR | Low | Critical (breaks the app being recorded) | Monkey-patch must preserve original behavior; test on React/Angular/Vue apps |
| Shadow DOM observer leak (observers not cleaned up) | Medium | Medium (memory leak) | Refcounted lifecycle; test with dynamically added/removed shadow components |
| Definition priority conflicts (new definition steals events from existing) | Medium | High (wrong classification) | Each new definition tested against all existing definitions' trigger conditions |
| IRAction changes break existing generated code | Low | High (regression) | Snapshot test before/after; only intentionally changed types should differ |
| Dead type deletion breaks hidden import | Low | Medium | tsc catches it; same protocol as TD-2 deletion |

---

## Part 8: Enterprise-Grade Coverage Analysis

### Interaction Coverage Matrix

After the full roadmap (DF-1 through DF-8), the system will cover:

| Domain | Interaction Pattern | Before | After | How |
|--------|-------------------|--------|-------|-----|
| **Forms** | Text input | ✅ | ✅+ | Observation adds behavioral evidence |
| | Checkbox toggle | ✅ | ✅ | Already complete |
| | Radio button selection | ⚠️ | ✅ | TD-1 fix + IRAction fix |
| | Dropdown/select | ✅ | ✅ | Already complete |
| | Slider/range | ⚠️ | ✅ | IRAction fix + observation |
| | Date picker | ⚠️ | ✅+ | Observation + better adapter |
| | Color picker | ⚠️ | ✅ | IRAction fix |
| | File upload | ⚠️ | ✅ | IRAction fix (setInputFiles) |
| | Form submission | ✅ | ✅+ | Network evidence confirms submission |
| **Navigation** | Link click | ✅ | ✅+ | Link-type classification |
| | SPA navigation | ✅ | ✅ | Already complete |
| | Tab switching | ⚠️ | ✅ | aria-selected tracking + SwitchTab rule |
| | Pagination | ✅ | ✅ | Already complete |
| | Breadcrumb | ❌ | ⚠️ | aria-current helps but no dedicated rule |
| **Content** | Expand/collapse | ✅ | ✅ | Already complete |
| | Modal open/close | ❌ | ✅ | "Element appeared" effect + OpenModal rule |
| | Tooltip/popover | ❌ | ✅ | HoverReveal rule |
| | Context menu (native) | ✅ | ✅ | Falls through to Click |
| | Context menu (custom) | ❌ | ❌ | Deferred — rare in test scenarios |
| **Data Manipulation** | Drag and drop | ❌ | ✅ | DragDrop definition + DragAndDrop rule |
| | Multi-select (Ctrl/Shift) | ❌ | ✅ | MultiSelect definition + rule |
| | Reorder (drag) | ❌ | ✅ | DragDrop definition |
| | Autocomplete/typeahead | ❌ | ✅ | Autocomplete definition |
| **Search & Filter** | Search | ✅ | ✅+ | Network evidence confirms async search |
| | Filter | ✅ | ✅+ | Network evidence + class-state-change |
| | Sort | ✅ | ✅ | Already complete |
| **Advanced** | Stepper/quantity | ❌ | ✅ | Stepper definition |
| | Rich text editing | ❌ | ❌ | Deferred — needs contentEditable observation + command correlation |
| | Canvas/drawing | ❌ | ❌ | Deferred — needs visual AI (Track 3) |
| | Media controls | ❌ | ❌ | Deferred — needs media event definitions |
| | Map interaction | ❌ | ❌ | Deferred — needs Canvas/visual AI |

**Coverage summary:**
- **Before (Track 1 end):** 18 of ~30 common patterns fully working (60%)
- **After (DF-1 through DF-8):** 25 of ~30 common patterns fully working (83%)
- **Deferred to Track 3 (AI):** Rich text, Canvas, media controls, map interaction (17%)
- **Permanently deferred (browser limitation):** Closed Shadow DOM, cross-origin iframe observation

---

## Appendix A: Phase Dependency and Ordering

```
Week/Phase     1     2     3     4     5     6     7     8
              DF-1  DF-2  DF-3  DF-4  DF-5  DF-6  DF-7  DF-8
               │      │     │     │     │     │     │     │
               │      │     │     │     │     │     │     └─ Shadow DOM obs
               │      │     │     │     │     │     └─────── Gen layer hardening
               │      │     │     │     │     └───────────── Network evidence
               │      │     │     │     └─────────────────── Capability expansion
               │      │     │     └─────────────────────────── Definition completeness
               │      │     └────────────────────────────────── Effect interpretation
               │      └──────────────────────────────────────── Evidence foundation
               └──────────────────────────────────────────────── Observation expansion
```

**Strict dependencies:**
- DF-3 requires DF-1 (effect rules need new snapshot fields)
- DF-4 requires DF-1 (new definitions need new event types) and DF-2 (some need new evidence)
- DF-5 requires DF-3 (new rules need new effects) and DF-4 (new rules need new definitions)

**Can run in parallel:**
- DF-2 + DF-3 (after DF-1)
- DF-6 (independent — can start after DF-1)
- DF-7 (fully independent — can start immediately)
- DF-8 (after DF-1)

**Recommended execution order for maximum parallelism:**
1. DF-1 (blocks the most downstream work)
2. DF-2 + DF-7 in parallel (independent of each other)
3. DF-3 + DF-6 in parallel
4. DF-4 (needs DF-1, DF-2, DF-3)
5. DF-5 (needs DF-3, DF-4)
6. DF-8 (independent, anytime after DF-1)

---

## Appendix B: New Types Summary

### New BrowserEventType members (DF-1)
```
'pointerdown' | 'pointerup' | 'pointermove' | 'dragstart' | 'dragend' | 'drop' | 'touchstart' | 'touchend' | 'touchmove'
```

### New ElementStateSnapshot fields (DF-1)
```
ariaSelected: boolean | null
ariaHidden: boolean | null
ariaCurrent: string | null   // 'page', 'step', 'location', 'date', 'time', 'true', 'false'
ariaControls: string | null
ariaOwns: string | null
ariaDescribedBy: string | null
computedDisplay: string | null    // 'block', 'none', 'flex', 'inline', etc.
computedVisibility: string | null // 'visible', 'hidden', 'collapse'
computedOpacity: number | null
```

### New EffectCategory members (DF-3)
```
'class-state-change' | 'selection-change' | 'navigation-state' | 'value-change' | 'focus-change'
```

### New InteractionType members (DF-4)
```
'DragDrop' | 'MultiSelect' | 'Autocomplete' | 'Stepper'
```

### New CapabilityType members (DF-5)
```
'DragAndDrop' | 'OpenModal' | 'CloseModal' | 'SwitchTab' | 'HoverReveal' | 'MultiSelect'
```

### New IRAction members (DF-7)
```
'UPLOAD_FILE' | 'SET_RANGE' | 'SET_COLOR'
```

### New evidence sub-objects (DF-2, DF-6)
```
NetworkEvidence {
  requestsTriggered: NetworkRequest[]
  hasApiCall: boolean
  apiEndpoint: string | null
  responseIndicatedSuccess: boolean
}

NetworkRequest {
  method: string
  urlPath: string         // pathname only — no query params (privacy)
  status: number | null
  durationMs: number
  initiatedBy: 'fetch' | 'xhr' | 'beacon'
}
```

---

## Appendix C: Technical Debt Items (Updated)

| ID | Description | Track | Status |
|----|-------------|-------|--------|
| TD-1 | RadioButton Component Definition emits insufficient metadata (selectedValue) | DF-4.1 | Open — scheduled |
| TD-2 | Legacy interaction type registry (interaction-types.ts) | — | Resolved (Phase 1.4.4) |
| TD-3 | Legacy deterministic-recorder.ts dead code (~2700 lines) | DF cleanup | Open — schedule deletion |
| TD-4 (NEW) | Dead Architecture C evidence types (evidence-types.ts, 407 lines) | DF-2.5 | Open — schedule deletion |
| TD-5 (NEW) | `architecture-types.ts` potentially dead — verify and delete if confirmed | DF-2.6 | Open — investigate |
| TD-6 (NEW) | Enrichment layer (componentType, businessMeaning) produced but not consumed by capability engine | DF-5.1 | Open — wire in DF-5 |
| TD-7 (NEW) | ScreenshotService exists but unused in Phase 5 pipeline | Track 3 | Open — visual evidence is Track 3 scope |

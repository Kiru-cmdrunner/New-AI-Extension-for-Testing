# Gen 1 End-to-End Map: Design Intent vs Production Reality

**Date:** 2026-08-03
**Scope:** Phase 0–8 + R1/R2/R3 only. No Capability/P1/P2 changes proposed.
**Purpose:** Complete trace of Start Recording → user interaction → every Gen 1 layer → side panel output. Design intent vs actual production code. Every disconnect identified.

---

## Table of Contents

1. [The Intended Pipeline (As Designed)](#1-the-intended-pipeline-as-designed)
2. [The Actual Pipeline (As Built)](#2-the-actual-pipeline-as-built)
3. [Layer-by-Layer: Design Intent vs Production Reality](#3-layer-by-layer-design-intent-vs-production-reality)
4. [Interaction Type Trace: All Supported Types](#4-interaction-type-trace-all-supported-types)
5. [Disconnect Summary: Every Gap](#5-disconnect-summary-every-gap)
6. [What the User Should See vs What They Actually See](#6-what-the-user-should-see-vs-what-they-actually-see)

---

## 1. The Intended Pipeline (As Designed)

```
User clicks "Start Recording"
  │
  ▼
CONTENT SCRIPT — EventTap (Phase 0-3)
  │  Captures: 19 DOM event types + synthetic events (navigation, attribute-change)
  │  Per event: ElementIdentity (18 fields) + DomContext (30+ fields)
  │  + value transitions + behavioral signals
  │
  ▼
SERVICE WORKER — Component Runtime (Phase 2, R1-R3)
  │  23 lifecycle definitions classify raw events → ComponentInteraction
  │  Click interactions go through Evidence Annotation Pipeline (R3)
  │    - 10 evidence generators vote on intent
  │    - Deferred annotation waits for post-handler attribute-change
  │    - Reclassifies: div+aria-checked → Checkbox, div+aria-expanded → Dropdown, etc.
  │  enrichInteraction() adds Layer 2 (componentType) + Layer 3 (businessMeaning)
  │  enrichConfigurationSession() transforms subActions → ConfigurationSession (Phase 0e)
  │
  ▼
USER clicks "Stop Recording"
  │
  ▼
PIPELINE (Phase 6-7, runs post-STOP)
  │
  ├── DOMAIN ADAPTER: ComponentInteraction → ObservedTransition
  │     One transition per interaction. Type, operation, state changes.
  │
  ├── RECOGNITION: Pattern-based component grouping
  │     Structural (ARIA, 0.95 confidence) + Behavioral (evidence signals)
  │     6 patterns: DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL, TABS, ACCORDION
  │     Progressive: TENTATIVE → DEVELOPING → CONFIRMED / REJECTED
  │     CONFIRMED when expectedLifecycle ⊆ observedOperations
  │
  ├── ENRICHMENT: ObservedTransition → Semantic Output
  │     1. OptionSet extraction (DOM inspection via DomInspector)
  │     2. InteractionContract derivation (constraints from domAttributes)
  │     3. BehavioralContract synthesis (state machines, validation behavior)
  │     4. Semantic Aggregation → LogicalAction[] (lifecycle segmentation)
  │     5. Workflow + Surface derivation
  │     6. Fragment Assembly → ApplicationKnowledgeFragment
  │
  ├── CAPABILITY DERIVATION (P1, designed but separate)
  │     Fragment → CapabilityCandidate
  │     [OUT OF SCOPE for Gen 1 analysis]
  │
  └── IR BRIDGE (Phase 8): ComponentInteraction[] → ExecutionIRPlan
        Reads ComponentInteraction[] directly (bypasses domain adapter)
        Multi-config/subAction/modal expansion
        Readability optimization
        → Playwright TypeScript code

SIDE PANEL DISPLAY
  Timeline: detected interactions with type/icon/description
  IR Steps: ordered steps with locators, inputs, assertions
  Playwright: generated .spec.ts files
  Knowledge Fragment: collapsible JSON
```

### Key Design Principles

| Principle | Source | Intent |
|-----------|--------|--------|
| **Observation is immutable** | SEMANTIC_INTERACTION_BOUNDARY.md:51 | "SemanticInteraction contains ONLY observations. Every projection lives in a separate type." |
| **Three layers of understanding** | three-layer-component-model.md | L1: interaction type. L2: component type. L3: business meaning. |
| **Evidence sovereignty** | R3 spec:42 | "Deterministic evidence always overrides AI." |
| **Graceful degradation** | INTERACTION_TAXONOMY.md:994 | Novel interactions degrade to Click with evidence trail, never break. |
| **Pure transforms** | STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md:S1 | "No I/O, no DOM access, no async operations" in enrichment. |
| **Provenance** | Knowledge Model | Every classification decision carries an evidence trail. |

---

## 2. The Actual Pipeline (As Built)

Traced from production code (`service-worker.ts:277-510`, `pipeline-runner.ts`, `domain-adapter-v2.ts`, `ir-bridge.ts`):

### STOP flow (service-worker.ts:277):

```
handleStopRecording()
  │
  ├─ stopRecording() → ComponentInteraction[] (allInteractions)
  │
  ├─ Extract unique ObservedEvents from interactions → RecordedEvent[]
  │
  ├─ Store allInteractions → DETECTED_INTERACTIONS (for side panel)
  │
  ├─ runPipeline(events, allInteractions, sessionId, sourceUrl)
  │    │
  │    ├─ adaptToDomainEntitiesV2() → { elements, transitions }
  │    ├─ runRecognition(entities) → ComponentGrouping[]
  │    ├─ enrichSession({...}) → ApplicationKnowledgeFragment
  │    │     ⚠️ Uses createNoOpDomInspector() — no DOM access in SW
  │    └─ deriveCapability() → CapabilityCandidate
  │
  ├─ Store pipeline results (DOMAIN_ENTITIES, KNOWLEDGE_FRAGMENT, etc.)
  │
  ├─ enrichInteractions(allInteractions) → Interaction Enrichment Pass
  │    Adds: locators, assertion suggestions
  │
  ├─ buildIRPlan({events, interactions, understanding, ...})
  │    │
  │    └─ → ExecutionIRPlan → PlaywrightCodeGenerator → .spec.ts files
  │
  ├─ persistSession() → Repository V2 (Dexie/IndexedDB)
  │
  └─ healFromRecording() → Cross-session element healing (R4)
```

### What's different from the design diagram:

The production pipeline has **two parallel paths** after STOP:

1. **Pipeline path** (domain adapter → recognition → enrichment → capability):
   Consumes ComponentInteraction[] via domain adapter → ObservedTransition[].
   Produces ApplicationKnowledgeFragment.

2. **IR Bridge path** (ComponentInteraction[] → ExecutionIRPlan):
   Consumes ComponentInteraction[] **directly**, bypassing the domain adapter entirely.
   This is the **production-wired path that works**.

The IR Bridge re-accesses original ComponentInteraction[] for `intent` and `evidenceTrail` via `componentInteractionById` map (ir-bridge.ts:1133). These fields bypass the domain adapter/recognition/enrichment layers.

---

## 3. Layer-by-Layer: Design Intent vs Production Reality

### 3.1 Event Capture (Phase 0–3)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| Event types captured | All user-initiated events | 19 types + synthetic (navigation, attribute-change) | ✅ |
| Element identity | 18-field signature | identity-extractor.ts implements full cascade | ✅ |
| DomContext | Rich structural + behavioral context | 30+ fields including R3 attributeChanges, R2 slider values | ✅ |
| Value transitions | valueBefore/valueAfter | Captured at focus/input/blur + SPA post-click polling | ✅ |
| Post-handler behavioral data | R3: capture attribute changes after click handler | setTimeout(0) re-snapshot → synthetic 'attribute-change' event | ✅ |
| SPA navigation | Synthetic navigation events | history.pushState/replaceState monkey-patch + popstate/hashchange | ✅ |
| Rate limiting | Don't flood SW | scroll: 16ms, mousemove: 50ms | ✅ |
| Iframe support | Events in iframes captured | EventTap runs in each frame, frameId tracked | ✅ |
| Shadow DOM support | Events in shadow DOM captured | identity-extractor traverses shadow roots | ✅ |

**Verdict: ✅ Fully working as designed.** Event capture is the most mature layer.

---

### 3.2 Component Runtime — Lifecycle Classification (Phase 2)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| 23 lifecycle definitions | INTERACTION_TAXONOMY.md calls for: TextEntry, Dropdown, Checkbox, RadioButton, Slider, DatePicker, Click, Hover, Scroll, Navigation, Tab, Modal, Stepper, TagInput, OtpInput, DragAndDrop, Link, NewTab, NewWindow, Breadcrumb, KeyboardShortcut, HotkeySequence, FileUpload | `src/definitions/index.ts:65` — ALL 23 registered | ✅ |
| Priority ordering | Most specific definitions claim events first; Click is fallback at priority 180 | Correctly ordered, Click is lowest priority | ✅ |
| Surface tracking | Components can claim events in their surface (dropdown popup, modal dialog) | `trackSurface()` + `closeAllSurfaces()` in component-runtime.ts | ✅ |
| Concurrent sessions | Multiple interactions can be active simultaneously (e.g., TextEntry inside Dropdown surface) | `resolveConcurrentSessions()` handles session stacking | ✅ |
| Stale cleanup | Abandoned interactions cleaned up after timeout | 15s timeout in component-runtime.ts | ✅ |
| SubActions | Compound interactions emit subActions (dropdown config: adults=2, class=economy) | Implemented in dropdown.ts, stepper.ts | ✅ |

**Verdict: ✅ Fully working as designed.** The Component Runtime is the production heart of the system.

---

### 3.3 Evidence Annotation — R3 Behavioral Reasoning

| Aspect | Design Intent (R3 spec) | Production Code | Match? |
|--------|------------------------|----------------|--------|
| 10 evidence generators | ariaEvidence, behavioralEvidence, tagEvidence, structuralEvidence, navigationEvidence, triggerEvidence, valueChangeEvidence, panelEmergenceEvidence, selectionStateEvidence, sliderValueEvidence | All 10 in `generators.ts:509` | ✅ |
| Weight calibration | Standards 0.7–0.9, Behavioral 0.5–0.7, Structural 0.1–0.4 | Implemented as designed | ✅ |
| Intent fusion | Sum weights per intent, pick highest | `intent-inference.ts` | ✅ |
| Type derivation | Map intent → specific type (toggle→Checkbox/Switch, select→Dropdown/Slider, input→TextEntry) | `type-deriver.ts:44` | ✅ |
| Reclassify threshold | Confidence ≥ 0.5 → reclassify | `RECLASSIFY_THRESHOLD = 0.5` | ✅ |
| Unrecognized flag | Confidence < 0.3 → `metadata.unrecognized = true` | Implemented | ✅ |
| Annotation deferral | R3.4: defer Click annotation until attribute-change arrives | `pendingAnnotations` in sw-integration.ts:112-118 | ✅ |
| "Canonical architecture" | R3 spec:34: "Future work must not assume the Click definition has a lifecycle window" | Click remains synchronous, annotation deferred | ✅ |

**Verdict: ✅ Fully working as designed.** R3 is complete and correctly implemented.

**What R3 adds for custom/novel interactions:**
- A `div` with no ARIA role but aria-checked transition → **Checkbox** (behavioral evidence)
- A `div` with aria-expanded transition → **Dropdown** (panel emergence evidence)
- A `div` with aria-valuenow → **Slider** (slider value evidence)
- A `div` with CSS class transitions matching `/select|active|chosen/i` → **Dropdown/select** (selection state evidence)
- A `div` with contentEditable or value change → **TextEntry** (value change evidence)
- Everything else → **Click** with evidence trail (graceful degradation)

---

### 3.4 Live Enrichment (Phase 0e + Three-Layer Model)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| Layer 2: Component Type | detectComponent(triggerEvent) → componentType (DataGrid, IconButton, etc.) | `component-detector.ts` | ✅ |
| Layer 3: Business Meaning | resolveMeaning(interaction, detection) → human-readable description | `meaning-resolver.ts` | ✅ |
| ConfigurationSession | Transform subActions → field-based state description | `enrichConfigurationSession()` in sw-integration.ts:157 | ✅ |
| Applied when | On emit (live, during recording) — before display | `enrichInteraction()` called in onEmit callback | ✅ |

**Verdict: ✅ Fully working as designed.** Live enrichment runs during recording and populates the side panel timeline.

---

### 3.5 Domain Adapter (Phase 6 — ComponentInteraction → ObservedTransition)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| One transition per interaction | Phase 6: single ObservedTransition per ComponentInteraction | domain-adapter-v2.ts:348 | ✅ |
| Operation mapping | TextEntry→FILL, Checkbox→TOGGLE, Dropdown→SELECT, etc. | INTERACTION_TO_OPERATION map | ✅ |
| State before/after | Capture value/checked/expanded transitions | Built from first event + metadata | ✅ |
| Evidence entries | VALUE_CHANGE, STATE_CHANGE, NAVIGATION | domain-adapter-v2.ts:208 | ✅ |
| sourceInteractionType (Tier 1) | Carry type from ComponentInteraction to transition | domain-adapter-v2.ts:465 | ✅ |
| domAttributes (Tier 1, C3) | Build from DomContext fields (required, inputType, pattern, min, max, etc.) | domain-adapter-v2.ts:415-433 | ✅ |

**Fields NOT transferred to ObservedTransition (by design):**
- `intent` — not on ObservedTransition type; IR Bridge reads from original ComponentInteraction
- `evidenceTrail` — same; IR Bridge bypasses adapter for these fields
- `confidence` — same
- `subActions` — preserved on original ComponentInteraction, consumed by IR Bridge directly
- `memberEvents` detail — flattened to trigger identity only

**Verdict: ✅ Working as designed.** The domain adapter is intentionally lossy — it's a projection for the recognition/enrichment pipeline. The IR Bridge reads the original ComponentInteraction directly, so no information is actually lost.

---

### 3.6 Recognition / Grouping (Phase 4–5)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| 6 pattern definitions | DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL, TABS, ACCORDION | pattern-catalogue.ts | ✅ |
| Tier 1: Structural recognition | ARIA-based, confidence 0.95, ~40-50% coverage | structural-recognizer.ts:126 | ⚠️ |
| Tier 2: Behavioral recognition | Evidence signatures, ~35-45% coverage | behavioral-recognizer.ts:434 | ⚠️ |
| Lifecycle progression | TENTATIVE → DEVELOPING → CONFIRMED / REJECTED | component-registry.ts | ⚠️ |
| ancestorRoles | Full ancestor role chain for structural matching | ❌ pipeline-runner.ts:109 | ❌ |
| relatedElementIds | Constituent elements for behavioral matching | ❌ pipeline-runner.ts:110 | ❌ |
| structuralRecognition flag | All patterns should be eligible | ❌ Only ACCORDION has `structuralRecognition: false`, BUT no other pattern sets it to `true` explicitly | ⚠️ |

#### Disconnect Details:

**D-R1: ancestorRoles truncated to [target] only**
- **Design:** structural-recognizer.ts builds role chain from `input.ancestorRoles[]`. Should include the full ancestor hierarchy (radiogroup → fieldset → form, etc.) so that a radio button's ancestor radiogroup can be detected.
- **Code:** pipeline-runner.ts:109: `ancestorRoles: [roleInfo]` — only the target element itself, never its ancestors.
- **Impact:** Structural recognition can only match when the *target element itself* has a rootAriaRole. A `<div role="radio">` inside a `<div role="radiogroup">` won't trigger RADIO_GROUP recognition because `ancestorRoles` only contains `[radio]`, not `[radio, radiogroup]`.
- **Severity:** HIGH — this is why structural recognition rarely fires.

**D-R2: relatedElementIds always empty**
- **Design:** Behavioral recognition needs constituent element IDs to detect evidence signals (CHILD_ELEMENT_BECAME_VISIBLE requires knowing about child elements).
- **Code:** pipeline-runner.ts:110: `relatedElementIds: []` — always empty.
- **Impact:** Behavioral recognition can't detect popup emergence, child element visibility, or constituent interactions. It has no elements to work with.
- **Severity:** HIGH — this is why behavioral recognition rarely fires.

**D-R3: structuralRecognition flag — defaults not explicit**
- **Design:** Patterns without explicit `structuralRecognition: false` should be structurally recognizable.
- **Code:** Only ACCORDION explicitly sets `structuralRecognition: false`. The structural recognizer checks `if (def.structuralRecognition === false) continue` — so DROPDOWN, CHECKBOX, RADIO_GROUP, MODAL, TABS pass this check (their flag is `undefined`, not `false`).
- **Impact:** This is actually CORRECT — undefined ≠ false, so structural recognition CAN fire for 5 of 6 patterns. But combined with D-R1 (truncated ancestorRoles), the matching still fails for most cases.

**D-R4: Lifecycle mismatch — single transition can't satisfy multi-operation lifecycles**
- **Design:** DROPDOWN expects `[CLICK, SELECT]`, requires BOTH operations observed.
- **Code:** Domain adapter creates ONE transition per ComponentInteraction. A Dropdown interaction has type=Dropdown, operation=SELECT. Only SELECT is observed. `{SELECT} ⊄ {CLICK, SELECT}` → never CONFIRMED.
- **Impact:** DROPDOWN, ACCORDION never reach CONFIRMED. CHECKBOX works (single TOGGLE). RADIO_GROUP expects SELECT but gets TOGGLE (mismatch). MODAL and TABS work (single CLICK).
- **Severity:** MEDIUM — components still produce standalone transitions and LogicalActions; they just don't get grouped or get a BehavioralContract.

**D-R5: componentId never assigned to transitions**
- **Design:** After recognition, transitions should have componentId set so the semantic aggregator can group them.
- **Code:** `assignTransitionToComponent()` exists in the recognition orchestrator but is effectively dead code — the recognition pipeline doesn't reliably call it because recognition rarely fires (D-R1, D-R2).
- **Impact:** All transitions remain standalone (componentId=null). Semantic aggregation produces standalone actions, not component-grouped actions.
- **Severity:** MEDIUM — standalone actions still carry correct type, businessField, and constraints; they just lack component-level grouping.

#### What recognition DOES correctly:
- Pattern definitions themselves are well-formed.
- Structural recognizer logic is correct (given proper ancestorRoles).
- Behavioral recognizer logic is correct (given proper relatedElementIds).
- The recognition pipeline is non-fatal — failures don't break the pipeline.
- Lifecycle check logic is correct (given proper inputs).

**Verdict: ⚠️ Recognition pipeline is architecturally sound but starved of inputs.** The two missing wirings (ancestorRoles, relatedElementIds) prevent it from functioning. This is the C4/D3 finding from earlier audits.

---

### 3.7 Enrichment (Phase 5)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| InteractionContract derivation | From domAttributes: required, type, format/regex, min/max/step, minLength/maxLength | interaction-contract-deriver.ts | ✅ |
| domAttributes populated | From DomContext captured at record time | domain-adapter-v2.ts:415-433 (Tier 1 C3) | ✅ |
| OptionSet extraction | DOM inspection of confirmed components to find all options | enrichment-orchestrator.ts:73 | ❌ |
| BehavioralContract | State machines, validation behavior for confirmed components | enrichment-orchestrator.ts:116 | ⚠️ |
| Semantic aggregation | Lifecycle occurrence segmentation → LogicalAction[] | semantic-aggregator.ts | ✅ |
| businessField for standalone | From accessibleName (Tier 1 C2) | semantic-aggregator.ts:buildStandaloneAction | ✅ |
| businessField for components | From component.businessField (depends on optionSet extraction) | semantic-aggregator.ts:buildComponentAction | ⚠️ |
| Workflow derivation | Navigation boundaries, branch points | workflow-deriver.ts | ✅ |
| Surface derivation | Group elements by source URL | surface-deriver.ts | ✅ |
| Fragment assembly | Combine all into ApplicationKnowledgeFragment | fragment-assembler.ts | ✅ |

#### Disconnect Details:

**D-E1: OptionSet extraction returns null in production**
- **Design:** STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md §5.3: "Rather than calling document.querySelector directly... the pass will accept a DOM inspector interface." Design intended a browser adapter providing real DOM access.
- **Code:** pipeline-runner.ts:152: `enrichSession({..., domInspector: createNoOpDomInspector()})`. The service worker has no DOM access. NoOpDomInspector returns null for all queries.
- **Impact:** OptionSets never extracted. businessField for components is null. Users never see dropdown options in the knowledge fragment.
- **Severity:** MEDIUM — this is a fundamental MV3 constraint. The SW cannot access the DOM post-recording. Options must be captured DURING recording by the content script, or the enrichment must run in a content script context.
- **Design gap:** The design assumed DOM access would be available during enrichment. MV3 architecture doesn't provide this.

**D-E2: BehavioralContract only for confirmed components**
- **Design:** BehavioralContract should be synthesized for confirmed components.
- **Code:** enrichment-orchestrator.ts:116: gates on `component.lifecycleState === 'CONFIRMED'`.
- **Impact:** Since recognition rarely confirms components (D-R1 through D-R5), BehavioralContracts are rarely produced.
- **Severity:** LOW-MEDIUM — this is a downstream effect of the recognition disconnects.

**Verdict: ⚠️ Enrichment pipeline is architecturally sound but limited by NoOp DomInspector and recognition disconnects.** InteractionContracts and LogicalActions work correctly. OptionSets and BehavioralContracts are degraded.

---

### 3.8 IR Bridge (Phase 8)

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| Consume ComponentInteraction[] directly | Phase 8: IR Bridge accepts ComponentInteraction[], not ObservedTransition[] | ir-bridge.ts:1124 | ✅ |
| Type → IRAction mapping | CLICK→click, FILL→fill, SELECT→select, etc. | DEFAULT_BRIDGE_TYPE + IRAction mapping | ✅ |
| ConfigurationSession expansion | One IR step per configuration field (Adults=2, Class=Economy) | ir-bridge.ts:1150-1157 | ✅ |
| subAction expansion | Compound dropdown subActions → multiple steps | ir-bridge.ts:1208-1220 | ✅ |
| modalSubActions expansion | Modal dialog interactions → sub-steps | ir-bridge.ts | ✅ |
| intent + evidenceTrail mapping | Carry from original ComponentInteraction | ir-bridge.ts:1347-1367 | ✅ |
| Confidence-based wait strategy | confidence < 0.7 → 'visible' wait, else default | ir-bridge.ts:1344 | ✅ |
| Readability optimization | Merge consecutive same-element clicks/fills | ir-bridge.ts:1050 | ✅ |
| Assertions from InteractionContract | Derive from constraints | ir-bridge.ts | ✅ |
| Playwright code generation | ExecutionIRPlan → .spec.ts | PlaywrightCodeGenerator | ✅ |

**Verdict: ✅ Fully working as designed.** The IR Bridge is the most complete production path. It reads ComponentInteraction[] directly, correctly handles compound interactions, and produces working Playwright code.

---

### 3.9 Side Panel Display

| Aspect | Design Intent | Production Code | Match? |
|--------|--------------|----------------|--------|
| Live timeline during recording | Show interactions as they happen | LIVE_INTERACTIONS_KEY → renderProductionInteractions() | ✅ |
| Interaction type icons + labels | Per-type visual identification (🖱️ ⌨️ 📋 etc.) | interaction-renderer.ts:364 | ✅ |
| ConfigurationSession display | "Configure Economy: Adults=2, Children=1" | configurationSession in description | ✅ |
| subActions display | "Adults: +×3, Class=Premium Economy" | subActions in description | ✅ |
| Business meaning display | Human-readable description | businessMeaning field | ✅ |
| IR Steps view | Ordered steps with locators, inputs, assertions | sidepanel.ts:501-568 | ✅ |
| Playwright files | Generated .spec.ts with copy button | sidepanel.ts:579-644 | ✅ |
| Knowledge fragment | Collapsible JSON | sidepanel.ts (CAPABILITY_REVIEW section) | ✅ |
| Non-completed filtering | Hide incomplete interactions | production filter in renderProductionInteractions | ✅ |
| Metadata warnings | ⚠️ no typing detected, ⚠️ no-op selection | interaction-renderer.ts | ✅ |

**Verdict: ✅ Fully working as designed.** Side panel is comprehensive and production-ready.

---

## 4. Interaction Type Trace: All Supported Types

For each interaction type, traced through the complete production pipeline:

### Legend
- ✅ Working as designed
- ⚠️ Degraded but functional
- ❌ Broken

---

### TextEntry

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | focus → input → blur events with inputType, valueBefore/After, required, pattern, minLength, maxLength | ✅ |
| **Runtime** | textEntry.ts (pri 50): detectTrigger checks for text input/textarea/contentEditable. Lifecycle: focus → input → blur → complete. | ✅ |
| **R3** | Not applicable (deterministic lifecycle, confidence=1.0) | ✅ |
| **Live enrichment** | componentType: usually Generic. businessMeaning: "Enter text in [field name]" | ✅ |
| **Domain adapter** | type=TextEntry, operation=FILL, stateBefore/After from value transitions | ✅ |
| **Recognition** | No pattern matches (text inputs aren't composite). Remains standalone. | ✅ (by design) |
| **Enrichment** | InteractionContract: required, inputType, format/regex, lengthRange. LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | FILL step with value, locator, assertions from constraints | ✅ |
| **Side panel** | ⌨️ Text Entry icon + field name + entered value | ✅ |

---

### Click (Button, Link, Generic)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click event with element identity + DomContext | ✅ |
| **Runtime** | click.ts (pri 180, fallback). Claims any click not claimed by higher-priority definitions. | ✅ |
| **R3 annotation** | Deferred annotation. Waits for attribute-change event. 10 generators vote: | ✅ |
| | - If aria-checked transition → reclassify as **Checkbox** | ✅ |
| | - If aria-expanded transition → reclassify as **Dropdown** | ✅ |
| | - If aria-valuenow present → reclassify as **Slider** | ✅ |
| | - If value change → reclassify as **TextEntry** | ✅ |
| | - If opensNewTab → reclassify as **NewTab** | ✅ |
| | - Otherwise remains **Click** with evidence trail | ✅ |
| **Live enrichment** | componentType detected from trigger. businessMeaning resolved. | ✅ |
| **Domain adapter** | type=Click (or reclassified subtype), operation=CLICK | ✅ |
| **Recognition** | May match MODAL pattern (if opens dialog) or TABS pattern. Usually standalone. | ⚠️ |
| **Enrichment** | LogicalAction: businessField from accessibleName. No InteractionContract (no input constraints). | ✅ |
| **IR Bridge** | CLICK step with locator. No assertions (no constraints to validate). | ✅ |
| **Side panel** | 🖱️ Click icon + target name | ✅ |

---

### Checkbox (Native + Custom)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click event. DomContext includes aria-checked, attributeChanges[]. | ✅ |
| **Native** | checkbox.ts (pri 30): detectTrigger checks `role=checkbox` or `<input type=checkbox>`. Lifecycle: click → complete. | ✅ |
| **Custom (R3)** | Click claims first → R3 evidence detects aria-checked transition → reclassifies as **Checkbox** (confidence 0.8) | ✅ |
| **Live enrichment** | componentType: ToggleSwitch/Switch. businessMeaning: "Toggle [label]" | ✅ |
| **Domain adapter** | type=Checkbox, operation=TOGGLE, stateBefore/After from checkedBefore/checkedAfter | ✅ |
| **Recognition** | CHECKBOX pattern matches structurally (role=checkbox). But ancestorRoles truncated → may not match for nested checkboxes. Lifecycle [TOGGLE] satisfied by single transition. | ⚠️ |
| **Enrichment** | InteractionContract: no input constraints (boolean). LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | TOGGLE step with target. Assertion: checked state. | ✅ |
| **Side panel** | ☑️ Checkbox icon + label + checked/unchecked state | ✅ |

**Note on behavioral recognizer mismatch (A5 from prior audit):** behavioral-recognizer.ts expects `expectedOperation='click'` for CHECKBOX pattern, but domain adapter maps Checkbox → TOGGLE. This is a latent bug in behavioral recognition, but since behavioral recognition rarely fires (D-R2), it doesn't cause production issues.

---

### RadioButton

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click event on radio element. | ✅ |
| **Native** | radio-button.ts (pri 40): detectTrigger checks `role=radio` or `<input type=radio>`. Lifecycle: click → complete. | ✅ |
| **Custom** | No ARIA radio → Click fallback → R3 may detect class transitions matching `/select\|active\|chosen/i` → reclassify, but type deriver doesn't produce RadioButton from R3 evidence (it produces Dropdown or Click). | ⚠️ |
| **Live enrichment** | componentType: Generic. businessMeaning: "Select [radio label]" | ✅ |
| **Domain adapter** | type=RadioButton, operation=TOGGLE | ✅ |
| **Recognition** | RADIO_GROUP pattern expects rootAriaRoles=['radiogroup']. The radio element has role=radio, not radiogroup. Would need ancestorRoles to find parent radiogroup. But ancestorRoles truncated → RADIO_GROUP never matches. | ❌ |
| **Lifecycle mismatch** | RADIO_GROUP expects SELECT, adapter maps RadioButton → TOGGLE. Even if matched, `{TOGGLE} ⊄ {SELECT}` → never CONFIRMED. | ❌ |
| **Enrichment** | Standalone LogicalAction: businessField from accessibleName. No InteractionContract (no input constraints). | ✅ (standalone) |
| **IR Bridge** | TOGGLE step (from operation=TOGGLE) or CLICK step (from type=RadioButton→DEFAULT_BRIDGE_TYPE→Click). Value: selected radio label. | ✅ |
| **Side panel** | 🔘 Radio icon + label | ✅ |

---

### Dropdown (Native SELECT)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click + change events on `<select>`. DomContext: inputType='select-one', ariaExpanded, ariaHasPopup. | ✅ |
| **Runtime** | dropdown.ts (pri 20): detectTrigger checks for combobox/listbox/SELECT/aria-haspopup. Lifecycle: click → surface opens → option click → complete. | ✅ |
| **Live enrichment** | componentType: Select/Dropdown. businessMeaning: "Select [value] from [label]". | ✅ |
| **Domain adapter** | type=Dropdown → subtype resolved to CustomDropdown (via DEFAULT_V2_TYPE). operation=SELECT. stateAfter: selectedValue. | ✅ |
| **Recognition** | DROPDOWN pattern expects rootAriaRoles=['combobox','listbox']. Native `<select>` has tag=SELECT but no combobox/listbox role. Won't match structurally. | ❌ |
| **Lifecycle** | DROPDOWN expects [CLICK, SELECT]. Only one transition (SELECT). Never CONFIRMED. | ❌ |
| **Enrichment** | Standalone LogicalAction: businessField from accessibleName. InteractionContract: inputType='select-one'. OptionSet: null (NoOp DomInspector). | ⚠️ |
| **IR Bridge** | SELECT step with selected value and locator. | ✅ |
| **Side panel** | 📋 Dropdown icon + label + selected value | ✅ |

---

### Dropdown (Custom ARIA combobox)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click on combobox → popup opens (aria-expanded=true) → click on option → popup closes. | ✅ |
| **Runtime** | dropdown.ts matches combobox/listbox/aria-haspopup. Full lifecycle: click → surface opens → absorb option click → complete. subActions[] populated with selected options. | ✅ |
| **R3** | If not matched by lifecycle (e.g., novel combobox without standard ARIA), R3 panel-emergence generator detects aria-expanded transition → reclassifies as Dropdown. | ✅ |
| **Live enrichment** | componentType: Dropdown. businessMeaning: "Select [value] from [label]". ConfigurationSession if multi-config. | ✅ |
| **Domain adapter** | type=CustomDropdown, operation=SELECT. stateAfter: selectedValue. | ✅ |
| **Recognition** | DROPDOWN pattern matches structurally IF ancestorRoles includes combobox/listbox. But ancestorRoles truncated → only matches if target itself is combobox. | ⚠️ |
| **Lifecycle** | DROPDOWN expects [CLICK, SELECT]. Only SELECT observed. Never CONFIRMED. | ❌ |
| **Enrichment** | Standalone. businessField from accessibleName. OptionSet: null (NoOp). | ⚠️ |
| **IR Bridge** | SELECT step. If subActions present, expanded to multiple steps (one per subAction). | ✅ |
| **Side panel** | 📋 Dropdown icon + ConfigurationSession display if multi-config | ✅ |

---

### DatePicker

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click on date input → calendar popup → click on date cell → complete. DomContext: inputType='date'. | ✅ |
| **Runtime** | date-picker.ts (pri 10): detectTrigger checks for date input/calendar elements. Lifecycle: click → date select → complete. | ✅ |
| **Live enrichment** | componentType: DatePicker/Calendar. businessMeaning: "Select date [value]". | ✅ |
| **Domain adapter** | type=DatePicker, operation=SELECT_DATE. stateAfter: dateValue from metadata. | ✅ |
| **Recognition** | No DATEPICKER pattern registered. Always standalone. | ✅ (by design — no pattern exists) |
| **Enrichment** | InteractionContract: inputType='date', dateFormat. LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | SELECT_DATE step with date value and locator. | ✅ |
| **Side panel** | 📅 Date Picker icon + label + selected date | ✅ |

---

### Slider (Native range + Custom ARIA)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Native capture** | mousedown on range input → mousemove → mouseup. DomContext: inputType='range', nativeMin/Max. valueBefore/After. | ✅ |
| **Custom capture (R2)** | R2 added slider geometry detection: aria-valuenow/min/max, CSS class patterns (`.slider`, `.range-handle`), pointer displacement during drag. | ✅ |
| **Runtime** | slider.ts (pri 25): detectTrigger checks for range input, aria-valuenow, slider CSS classes. Lifecycle: drag → complete. | ✅ |
| **R3** | If Click fallback: slider-value generator detects aria-valuenow → reclassifies as Slider. | ✅ |
| **Live enrichment** | componentType: Slider/RangeSlider. businessMeaning: "Set [label] to [value]". | ✅ |
| **Domain adapter** | type=Slider, operation=CLICK (mapped from INTERACTION_TO_OPERATION — Slider not in map, defaults to CLICK). Wait: Slider → CustomSlider via DEFAULT_V2_TYPE. | ⚠️ |
| **domAttributes** | aria-valuemin, aria-valuemax, aria-valuenow populated via C3 (domain-adapter-v2.ts:431-433). nativeMin/Max mapped to min/max. | ✅ |
| **Recognition** | No SLIDER pattern registered. Always standalone. | ✅ (by design) |
| **Enrichment** | InteractionContract: valueRange (min/max/step) from domAttributes. LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | FILL step (slider not in IR action map → defaults to FILL) with value and locator. | ⚠️ |
| **Side panel** | 🎚️ Slider icon + label + value | ✅ |

**Note:** Slider's operation is CLICK (not ideal — should be a SET_VALUE or similar), and IR action is FILL (not ideal — should be a DRAG or SET). These are semantic gaps but don't break functionality.

---

### Hover

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | mouseenter → (delay) → mouseleave. Rate limited at 50ms. | ✅ |
| **Runtime** | hover.ts (pri 60): requires meaningful delay (not passing mouse). Lifecycle: mouseenter → delay → complete. | ✅ |
| **Live enrichment** | componentType: Generic. businessMeaning: "Hover over [label]". | ✅ |
| **Domain adapter** | type=Hover, operation=HOVER. | ✅ |
| **Recognition** | No HOVER pattern. Standalone. | ✅ |
| **Enrichment** | LogicalAction: businessField from accessibleName. No constraints. | ✅ |
| **IR Bridge** | HOVER step with locator. | ✅ |
| **Side panel** | Only shown if metadata.meaningful=true (filters out accidental hovers). | ✅ |

---

### Scroll

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | scroll event. Rate limited at 16ms. scrollDeltaY/X captured. | ✅ |
| **Runtime** | scroll.ts (pri 110): Lifecycle: scroll → complete. Filters: hasDelta must be true. | ✅ |
| **Domain adapter** | type=Scroll → PageScroll (via DEFAULT_V2_TYPE). operation=SCROLL. | ✅ |
| **Recognition** | No SCROLL pattern. Standalone. | ✅ |
| **Enrichment** | LogicalAction: businessField=null (scroll target is page). | ✅ |
| **IR Bridge** | Filtered out (PageScroll is a noise type in IR Bridge). | ✅ |
| **Side panel** | Only shown if hasDelta=true. | ✅ |

---

### Navigation

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | SPA: history.pushState/replaceState monkey-patched → synthetic navigation event. Traditional: page unload → restore on reload. | ✅ |
| **Runtime** | navigation.ts (pri 120): Lifecycle: navigation → complete. | ✅ |
| **Domain adapter** | type=Navigation → PageNavigation. operation=NAVIGATE. elementId='__page__'. | ✅ |
| **Recognition** | Skipped (elementId='__page__', no element to recognize). | ✅ |
| **Enrichment** | RecordedWorkflow surface transitions. | ✅ |
| **IR Bridge** | NAVIGATE step with URL. | ✅ |
| **Side panel** | 🧭 Navigation icon + URL | ✅ |

---

### Tabs

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click on tab element. | ✅ |
| **Runtime** | tab.ts (pri 65): detectTrigger checks for role=tab. Lifecycle: click → complete. | ✅ |
| **Domain adapter** | type=Tab, operation=CLICK. | ✅ |
| **Recognition** | TABS pattern expects rootAriaRoles=['tablist']. Tab element has role=tab, not tablist. ancestorRoles truncated → won't find tablist ancestor. | ❌ |
| **Enrichment** | Standalone LogicalAction. businessField from accessibleName. | ✅ |
| **IR Bridge** | CLICK step with locator. | ✅ |
| **Side panel** | 🖱️ Click icon + tab label | ✅ |

---

### Modal Dialog

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click that opens dialog → events inside dialog → close. | ✅ |
| **Runtime** | modal-dialog.ts (pri 22): detectTrigger checks for aria-haspopup=dialog or dialog opens on click. Surface tracking: dialog claims all events. subActions populated with dialog interactions. | ✅ |
| **Domain adapter** | type=ModalDialog, operation=CLICK. | ✅ |
| **Recognition** | MODAL pattern matches dialog/alertdialog roles. expectedLifecycle=[CLICK] → single click satisfies. | ✅ (when role=dialog is present) |
| **Enrichment** | Component-grouped LogicalAction if confirmed. subActions expanded in IR Bridge. | ✅ |
| **IR Bridge** | CLICK step to open + sub-steps for dialog interactions + close. | ✅ |
| **Side panel** | 🪟 Modal icon + subActions display | ✅ |

---

### FileUpload

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | change event on file input. | ✅ |
| **Runtime** | file-upload.ts (pri 35): detectTrigger checks for `<input type=file>`. Lifecycle: change → complete. | ✅ |
| **Domain adapter** | type=FileUpload, operation=CLICK (default). | ⚠️ |
| **Recognition** | No FILE_UPLOAD pattern. Standalone. | ✅ |
| **Enrichment** | No InteractionContract. LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | FILL step (file upload not in IR action map → defaults to FILL). | ⚠️ |
| **Side panel** | 📎 File Upload icon + label | ✅ |

---

### Drag and Drop

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | dragstart → dragover → drop → dragend events. | ✅ |
| **Runtime** | drag-and-drop.ts (pri 15): Lifecycle: dragstart → drop → complete. Displacement threshold checked. | ✅ |
| **Domain adapter** | type=DragAndDrop, operation=CLICK (default). | ⚠️ |
| **Recognition** | No DRAG_DROP pattern. Standalone. | ✅ |
| **Enrichment** | LogicalAction: businessField from accessibleName. | ✅ |
| **IR Bridge** | DRAG_DROP step with source + target. | ✅ |
| **Side panel** | 🤚 Drag icon + source → target | ✅ |

---

### Stepper (+/- buttons)

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click on +/- button. | ✅ |
| **Runtime** | stepper.ts (pri 28): detectTrigger checks for stepper patterns. Lifecycle: click → complete. Typically produces subActions inside Dropdown sessions. | ✅ |
| **Live enrichment** | subActions display: "Adults: +×3". | ✅ |
| **Side panel** | Filtered out as internal-tier type (not shown standalone, shown as subAction inside Dropdown). | ✅ |

---

### TagInput

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | input + Enter/comma keypress. | ✅ |
| **Runtime** | tag-input.ts (pri 45): detectTrigger checks for tag input patterns. Lifecycle: input → tag add → complete. | ✅ |
| **Domain adapter** | type=TagInput, operation=FILL (from TextEntry default). | ⚠️ |
| **IR Bridge** | FILL step with tag value. | ✅ |

---

### OTP Input

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | consecutive focus/blur on adjacent single-char inputs. | ✅ |
| **Runtime** | otp-input.ts (pri 46): detectTrigger checks for OTP input patterns. Lifecycle: focus → input → auto-advance → complete. | ✅ |
| **IR Bridge** | FILL step with OTP value. | ✅ |

---

### Keyboard Shortcut / Hotkey

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | keydown with modifier keys. | ✅ |
| **Runtime** | keyboard-shortcut.ts (pri 5) / hotkey-sequence.ts (pri 6). | ✅ |
| **IR Bridge** | PRESS_KEY step. | ✅ |

---

### Link / NewTab / NewWindow / Breadcrumb

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | click on `<a>` or click with target=_blank. | ✅ |
| **Runtime** | link.ts (pri 70), new-tab.ts (pri 68), new-window.ts (pri 68), breadcrumb.ts (pri 68). | ✅ |
| **R3** | navigationEvidence generator detects opensNewTab/Window → reclassifies. | ✅ |
| **IR Bridge** | NAVIGATE step with URL (or CLICK for breadcrumb). | ✅ |

---

### Novel / Unrecognized Interactions

| Stage | What Happens | Status |
|-------|-------------|--------|
| **Capture** | Raw events captured normally. | ✅ |
| **Runtime** | No lifecycle definition claims the events → Click fallback (pri 180). | ✅ |
| **R3** | Evidence pipeline runs 10 generators. If no meaningful evidence → confidence < 0.3 → `metadata.unrecognized = true`. Evidence trail still populated (shows what was checked). | ✅ |
| **Live enrichment** | componentType: Generic. businessMeaning: generic description. | ✅ |
| **Domain adapter** | type=Click, operation=CLICK. | ✅ |
| **Enrichment** | Standalone LogicalAction. businessField from accessibleName. | ✅ |
| **IR Bridge** | CLICK step. Confidence < 0.7 → 'visible' wait strategy (more cautious). | ✅ |
| **Side panel** | 🖱️ Click icon. If unrecognized: no special badge in current UI (evidence trail in collapsible JSON). | ✅ |

**This is the Gen 1 vision working as designed for novel interactions.** The system never breaks — it degrades to Click with evidence trail, which is exactly what the INTERACTION_TAXONOMY.md and R3 spec prescribe.

---

## 5. Disconnect Summary: Every Gap

### Classification

| ID | Category | Layer | Description | Severity |
|----|----------|-------|-------------|----------|
| **D-R1** | Missing wiring | Recognition | ancestorRoles truncated to [target] only | HIGH |
| **D-R2** | Missing wiring | Recognition | relatedElementIds always empty | HIGH |
| **D-R4** | Design mismatch | Recognition | Single-transition adapter can't satisfy multi-operation lifecycles | MEDIUM |
| **D-R5** | Missing wiring | Recognition | componentId never assigned to transitions | MEDIUM |
| **D-E1** | MV3 constraint | Enrichment | NoOp DomInspector — no DOM access in SW for optionSet extraction | MEDIUM |
| **D-E2** | Downstream effect | Enrichment | BehavioralContract gated on CONFIRMED, which rarely happens | LOW-MEDIUM |
| **D-A1** | Semantic gap | Domain adapter | Slider operation = CLICK (should be SET_VALUE or similar) | LOW |
| **D-A2** | Semantic gap | Domain adapter | DragAndDrop operation = CLICK (should be DRAG) | LOW |
| **D-A3** | Semantic gap | IR Bridge | Slider → FILL (should be SET or DRAG) | LOW |
| **D-A4** | Semantic gap | IR Bridge | FileUpload → FILL (should be UPLOAD or SET_FILE) | LOW |
| **D-A5** | Lifecycle mismatch | Recognition | CHECKBOX behavioral recognizer expects CLICK but adapter sends TOGGLE | LOW (latent) |
| **D-A6** | Lifecycle mismatch | Recognition | RADIO_GROUP expects SELECT but adapter sends TOGGLE | LOW (latent) |
| **D-A7** | Lifecycle mismatch | Recognition | DROPDOWN expects [CLICK, SELECT] but only SELECT observed | LOW (latent) |

### Detailed impact analysis:

#### HIGH severity (prevents recognition from functioning):

**D-R1 + D-R2 together** make the recognition pipeline effectively inert. Without ancestorRoles, structural recognition can't detect composite widgets (radiogroup, tablist, dialog). Without relatedElementIds, behavioral recognition can't detect popup emergence or constituent interactions. This means ALL transitions remain standalone — no component grouping occurs in production.

However, this doesn't break the core recording/generation flow:
- ComponentInteractions are still correctly classified by the Component Runtime (23 definitions + R3 evidence).
- The IR Bridge reads ComponentInteractions directly and produces correct Playwright code.
- The side panel displays correct interaction types and descriptions.
- Only the ApplicationKnowledgeFragment's ComponentGrouping[] is empty, which means no BehavioralContracts and no component-level businessField enrichment.

#### MEDIUM severity (degrades enrichment quality):

**D-E1 (NoOp DomInspector)** means optionSets are never extracted. This is a fundamental MV3 constraint — the SW cannot access the page DOM after recording stops. The design assumed DOM access during enrichment.

The design document (STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md §5.3) says: "the pass will accept a DOM inspector interface" — implying a browser adapter would provide real DOM access. In practice, the SW has no DOM. Options must be captured DURING recording by the content script, or enrichment must happen in a content script context.

**D-R4 + D-R5** mean that even if recognition fired, components wouldn't reach CONFIRMED (multi-operation lifecycles) and transitions wouldn't be grouped (componentId=null). This is the C7 finding — the lifecycle model was designed for event-level transitions but Phase 3 unified to ComponentInteraction where one interaction = one complete semantic unit.

#### LOW severity (semantic naming gaps):

**D-A1 through D-A4** are operation/action naming mismatches. Slider maps to CLICK/FILL instead of SET_VALUE. DragAndDrop maps to CLICK instead of DRAG. FileUpload maps to FILL instead of UPLOAD. These don't break functionality — the IR Bridge still produces executable steps — but they're semantically imprecise.

**D-A5 through D-A7** are lifecycle mismatches in the behavioral recognizer and pattern definitions. They're latent bugs that would surface if recognition actually fired (which it currently doesn't due to D-R1/D-R2).

---

## 6. What the User Should See vs What They Actually See

### What the user DOES see (working correctly):

✅ **Live timeline during recording:** Each interaction appears immediately with correct type icon, label, and description.
✅ **TextEntry:** "Enter text in Email Address" with value "user@example.com"
✅ **Click:** "Click Submit button"
✅ **Checkbox:** "Toggle Subscribe to Newsletter" with checked state
✅ **Dropdown:** "Select Economy from Cabin Class" (with ConfigurationSession for multi-config)
✅ **DatePicker:** "Select date 2026-08-15 from Departure Date"
✅ **Slider:** "Set Maximum Price to 1000"
✅ **Navigation:** "Navigate to https://example.com/results"
✅ **Hover:** "Hover over Product Image" (only meaningful hovers)
✅ **Custom controls:** R3 correctly reclassifies div-based checkboxes, div-based dropdowns, div-based sliders
✅ **Novel interactions:** Degrades to Click with evidence trail
✅ **IR Steps:** Ordered list with locators, inputs, and assertions
✅ **Playwright code:** Working .spec.ts files
✅ **Knowledge fragment:** Elements, transitions, LogicalActions, InteractionContracts (with constraints)

### What the user DOES NOT see (gaps):

❌ **Component grouping:** No "Radio Group: Economy selected" — each radio button is a standalone action.
❌ **OptionSets:** No "Available options: Economy, Premium, Business" — the system can't see unselected options.
❌ **BehavioralContracts:** No "This dropdown validates that at least one option is selected" — no behavioral state machine.
❌ **Component-level business field:** No semantic grouping of radio buttons under a common field name.
❌ **Annotated evidence in UI:** The evidence trail exists on ComponentInteraction but the side panel doesn't display it prominently (it's in collapsible JSON only).

### What's NOT a gap (commonly assumed but actually working):

✅ **Custom checkbox recognition (R3):** Works — div with aria-checked transition → Checkbox.
✅ **Custom dropdown recognition (R3):** Works — div with aria-expanded transition → Dropdown.
✅ **Slider detection (R2):** Works — div with aria-valuenow → Slider.
✅ **Novel interaction handling:** Works — graceful degradation to Click with evidence.
✅ **Evidence trail:** Populated with full audit trail for every interaction.
✅ **confidence:** Correctly set (1.0 for deterministic, 0.0–1.0 for R3-classified).
✅ **subActions:** Correctly captured for compound interactions (dropdown config, modal dialog).

---

## Summary: Gen 1 Health Assessment

| Layer | Status | Notes |
|-------|--------|-------|
| Event Capture (Phase 0–3) | ✅ Complete | All event types, full DomContext, SPA support, iframe/shadow DOM |
| Component Runtime (Phase 2) | ✅ Complete | 23 lifecycle definitions, correct priority ordering, concurrent sessions |
| Evidence Annotation (R3) | ✅ Complete | 10 generators, deferred annotation, behavioral reclassification |
| Live Enrichment (Phase 0e) | ✅ Complete | Three-layer model, ConfigurationSession |
| Domain Adapter (Phase 6) | ✅ Complete | One transition per interaction, correct type/operation mapping |
| Recognition (Phase 4–5) | ⚠️ Starved | Pipeline correct but ancestorRoles + relatedElementIds not wired |
| Enrichment (Phase 5) | ⚠️ Degraded | InteractionContracts + LogicalActions work; OptionSets + BehavioralContracts don't |
| IR Bridge (Phase 8) | ✅ Complete | Direct ComponentInteraction consumption, multi-config expansion |
| Playwright Generation | ✅ Complete | Working .spec.ts output |
| Side Panel Display | ✅ Complete | Timeline, IR steps, code, fragment — all rendering correctly |

### The single most impactful gap:

**D-R1 + D-R2 (ancestorRoles + relatedElementIds not wired)** is the root cause of recognition being inert. Fixing these two wirings would unlock:
- Structural recognition for RADIO_GROUP, DROPDOWN, MODAL, TABS
- Behavioral recognition for DROPDOWN, CHECKBOX, ACCORDION
- Component grouping (componentId assignment)
- BehavioralContract synthesis
- Component-level businessField

But even without this fix, the **core Gen 1 flow works end-to-end**: capture → classify → enrich → generate → display. The user records interactions, sees them correctly classified, and gets working Playwright code. The gaps are in the *depth* of semantic understanding (component grouping, option sets, behavioral contracts), not in the *breadth* of interaction coverage.

### What Gen 1 was designed to be (and largely is):

A general-purpose semantic recorder that:
1. ✅ Watches any web application
2. ✅ Captures all user interactions with full context
3. ✅ Classifies them into correct interaction types (including custom/novel ones via R3)
4. ✅ Enriches them with component type and business meaning
5. ✅ Generates executable test code (Playwright)
6. ✅ Produces semantic understanding (ApplicationKnowledgeFragment)
7. ⚠️ Groups multi-element components into semantic units (partially — pipeline starved)
8. ⚠️ Extracts full option sets (blocked by MV3 constraint)
9. ⚠️ Synthesizes behavioral contracts (downstream of recognition)

Gen 1 achieves the CANONICAL_ROADMAP.md vision statement: "Build a general-purpose semantic recorder that understands user capabilities and intent across diverse web applications, regardless of how those applications implement their interactions" — with the caveat that component grouping depth is limited.

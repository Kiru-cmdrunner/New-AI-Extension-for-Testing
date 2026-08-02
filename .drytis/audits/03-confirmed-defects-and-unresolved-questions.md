# Confirmed Defects, Suspected Issues, and Unproven Items

**Status:** Assessment / audit result — NOT an approved design decision
**Date:** 2025-08-02
**Source:** Production source code (frozen baseline a59dc52), test suite
**Scope:** Read-only analysis. No code modified.

---

## 1. Confirmed Implementation Defects (Class A)

These are verified against production source code with specific file:line
references. Each was confirmed by reading the actual implementation path and
verifying the defect exists in the production code path (not just in tests).

### A1 — domAttributes Always Empty (Validation Constraints Lost)

**Location:** domain-adapter-v2.ts:393–394
**Description:** The domain adapter reads
`firstEvent.domContext?.domAttributes` to populate UiElement.domAttributes.
However, the DomContext type in component-types.ts does not have a
`domAttributes` property. The DomContext type in recorded-event.ts DOES have
one, but it is a different type. The adapter receives component-types.ts
DomContext, which has individual typed fields (inputType, required, min, max,
step, pattern, minLength, maxLength) but NOT a domAttributes Record.

**Effect:** UiElement.domAttributes is always `{}`. All downstream
InteractionContract.constraints are null/default. Validation constraints
captured at observation time are lost at the domain boundary.

**Evidence:**
- dom-context-extractor.ts captures inputType, required, min, max, step,
  pattern, minLength, maxLength as individual DomContext fields.
- component-types.ts DomContext interface has these fields but NO
  domAttributes property.
- domain-adapter-v2.ts:393–394 reads domAttributes from the wrong type.
- Tests use FixtureDomInspector mocks that populate domAttributes, masking
  the defect.

**Severity:** High — prevents validation constraints from reaching
DataRequirements.

---

### A2 — componentId Never Assigned (Universal Blocker)

**Location:** domain-adapter-v2.ts:419–428, ui-element.ts (assignToComponent),
pipeline-runner.ts
**Description:** The Domain Adapter creates ObservedTransition objects but does
NOT set componentId. The method assignToComponent() exists in ui-element.ts but
is NEVER called anywhere in the production pipeline. The Recognition Orchestrator
does not assign componentId. The Pipeline Runner does not assign componentId.

**Effect:** ALL transitions enter the semantic aggregator (semantic-aggregator.ts)
with componentId=null. The aggregator partitions transitions by componentId
(lines 146–193): null-componentId transitions go to standalone[], which get
businessField=null and sourceInteractionType=null. This is independent of pattern
coverage — even if every pattern matched perfectly, transitions would still be
standalone.

**Evidence:**
- `grep -r "assignToComponent" src/` returns only the definition in
  ui-element.ts. No call site in production code.
- semantic-aggregator.ts:146–193 partitions by componentId. null goes to
  standalone.
- capability-deriver.ts:202 `if (!action.businessField) continue` skips all
  standalone actions.

**Severity:** CRITICAL — universal blocker. Prevents ALL interactions from
contributing to capability inputs.

---

### A3 — businessField Reads from Dead Source

**Location:** option-set-extractor.ts:124–128
**Description:** The deriveBusinessField function (called during enrichment)
queries `inspector.querySelector(elementId)?.accessibleName`. In production,
the inspector is NoOpDomInspector, which returns null for all queries. But
UiElement.identity.accessibleName already has the value at this point — the
function circumvents the entity and reads from a dead source.

**Effect:** businessField is null for ALL interactions. This causes
capability-deriver.ts:202 to skip all actions. CapabilityCandidate.inputs is
always [].

**Evidence:**
- pipeline-runner.ts creates NoOpDomInspector and passes it to enrichment.
- option-set-extractor.ts:124–128 calls inspector.querySelector.
- NoOpDomInspector returns null for all methods.
- UiElement.identity.accessibleName is populated at capture time.

**Severity:** CRITICAL — prevents ALL interactions from contributing to
capability inputs. Compounds A2.

---

### A4 — ancestorRoles Truncated

**Location:** pipeline-runner.ts:109
**Description:** The pipeline runner passes `ancestorRoles: [roleInfo]` to the
recognition orchestrator, where roleInfo is only the target element's role. The
full ancestor chain (up to 10 roles) exists on UiElement.ancestorRoles but is
not passed.

**Effect:** RADIO_GROUP pattern root is 'radiogroup' container. A radio button
with role='radio' won't match without 'radiogroup' in the ancestor chain.
Structural recognition for container-based patterns fails.

**Evidence:**
- pipeline-runner.ts:109: `ancestorRoles: [roleInfo]`
- UiElement.ancestorRoles has the full chain.
- structural-recognizer.ts checks ancestor roles for container matching.

**Severity:** Medium — blocks specific pattern matches (RADIO_GROUP primarily).

---

### A5 — Checkbox Behavioral Signature Mismatch

**Location:** behavioral-recognizer.ts (CHECKBOX_BEHAVIORAL) vs
domain-adapter-v2.ts (Checkbox → TOGGLE)
**Description:** The CHECKBOX behavioral recognition pattern expects
expectedOperation='click' (reflecting the initial classification before
reclassification). But the Domain Adapter maps Checkbox → TOGGLE. The
behavioral recognizer never matches.

**Effect:** Checkbox components stuck at DEVELOPING, never reach CONFIRMED,
never reach enrichment.

**Evidence:**
- behavioral-recognizer.ts: CHECKBOX_BEHAVIORAL.expectedOperation = 'click'
- domain-adapter-v2.ts: Checkbox → TransitionOperation.TOGGLE
- isLifecycleComplete checks expected lifecycle operations.

**Severity:** Medium — blocks checkbox recognition specifically.

---

### A6 — RadioGroup Lifecycle Mismatch

**Location:** domain-adapter-v2.ts:54 (RadioButton → TOGGLE) vs
pattern-catalogue.ts:406 (RADIO_GROUP.expectedLifecycle = [SELECT])
**Description:** RadioButton interactions are mapped to TOGGLE operation, but
RADIO_GROUP pattern expects SELECT operation in its lifecycle. The lifecycle
never completes.

**Effect:** Radio group components stuck at DEVELOPING.

**Evidence:**
- domain-adapter-v2.ts:54: RadioButton → TOGGLE
- pattern-catalogue.ts:406: RADIO_GROUP.expectedLifecycle = [SELECT]

**Severity:** Medium — blocks radio group recognition.

---

### A7 — Dropdown Lifecycle Over-Specified

**Location:** domain-adapter-v2.ts (one SELECT transition) vs
pattern-catalogue.ts (DROPDOWN.expectedLifecycle = [CLICK, SELECT])
**Description:** The Domain Adapter produces one transition with SELECT for
dropdown interactions. The DROPDOWN pattern expects TWO lifecycle events:
CLICK (open the dropdown) then SELECT (choose an option). A single-transition
adapter cannot produce two operations.

**Effect:** Dropdown components stuck at DEVELOPING.

**Evidence:**
- domain-adapter-v2.ts: Dropdown interaction → one SELECT transition.
- pattern-catalogue.ts: DROPDOWN.expectedLifecycle = [CLICK, SELECT].

**Severity:** Medium — blocks dropdown recognition.

---

## 2. Missing Pattern Coverage (Class B)

### B1 — No SLIDER Pattern

**Description:** No PatternDefinition registered for SLIDER in the pattern
catalogue. Slider interactions are classified by ComponentRuntime (R2 geometry)
but have no recognition pattern.

**Effect:** Slider components never receive recognition → never CONFIRMED →
never enriched → no capability contribution.

**Note:** This is a coverage gap, not a defect. Adding a pattern would enable
recognition IF the lifecycle and componentId issues are also resolved.

---

### B2 — No DATE_PICKER Pattern

**Description:** No PatternDefinition registered for DATE_PICKER.

**Effect:** Same as B1.

---

### B3 — No FILE_UPLOAD Pattern

**Description:** No PatternDefinition registered for FILE_UPLOAD.

**Effect:** Same as B1.

---

## 3. Architectural Dependencies (Class C)

### C1 — CONFIRMED-Only Enrichment Gating

**Location:** enrichment-orchestrator.ts:74
**Description:** Only CONFIRMED components are processed by enrichment.
TENTATIVE and DEVELOPING components are excluded. Single-element interactions
that don't form multi-element components have no path to CONFIRMED.

**Effect:** Makes PatternDefinition a prerequisite for enrichment. Even if an
interaction is correctly classified by ComponentRuntime + R3 evidence, without
a matching pattern that reaches CONFIRMED, no enrichment occurs.

**Note:** This is an intentional design choice — enrichment was designed for
multi-element CONFIRMED components. Whether it should also handle standalone
transitions is an architectural decision (see Unresolved Questions G5).

---

### C2 — Enrichment Requires Live DOM Access (optionSet)

**Location:** option-set-extractor.ts
**Description:** Deriving optionSet for dropdowns requires reading the dropdown's
option elements from the live DOM. NoOpDomInspector returns null in production.

**Note:** This is a LEGITIMATE limitation. The options in a dropdown are not
captured at interaction time because the user only interacts with one option.
Reading the DOM later is necessary to enumerate all options. This is the one
case where live DOM access during enrichment is architecturally justified —
but the current implementation uses NoOpDomInspector which makes it non-functional.

---

## 4. Intentional Boundaries (Class D)

### D1 — Non-Data Types Produce No DataRequirements

**Description:** Clicks (navigation), scrolls, and other non-data interactions
correctly produce no DataRequirements. They are not data-driven.

**Classification:** Intentional and correct.

---

## 5. Suspected Issues (Require Further Validation)

### S1 — businessField Normalization Function Missing

**Description:** P1 spec examples show normalized identifiers ('email',
'maxPrice', 'category', 'onSale'). Implementation returns raw accessibleName
(e.g., 'On Sale', 'Max Price'). humanizeLabel in capability-mappers.ts:313
expects camelCase input. element-binding-resolver.ts:82 requires exact string
match DataRequirement.field === LogicalAction.businessField. No normalization
function exists anywhere in the codebase. P2 walkthrough test manually
constructs normalized values.

**Status:** SUSPECTED — the absence of normalization means that even if
businessField were populated, the binding resolver's exact-match requirement
would likely fail for most real-world labels. Requires validation: would
'On Sale' (accessibleName) match 'onSale' (DataRequirement.field)?

---

### S2 — R3 Annotations Not Carried to Domain Layer

**Description:** The annotated ComponentInteraction carries intent, confidence,
and evidenceTrail from R3. These fields are not present on UiElement or
ObservedTransition. The enrichment layer must re-derive behavioral contracts
from raw interaction evidence.

**Status:** SUSPECTED — this may be intentional (enrichment should derive its
own contracts from raw evidence) or a defect (the R3 understanding is lost and
must be re-derived). Requires architectural clarification.

---

### S3 — businessField Provenance for Standalone Actions

**Description:** In the semantic aggregator, standalone actions (componentId=null)
get businessField=null. Even if componentId were assigned, standalone actions
would still need a businessField derivation path.

**Status:** SUSPECTED — the current derivation path (accessibleName) may not be
sufficient for all interaction types. Requires validation of the full derivation
chain.

---

### S4 — P2 Not Production-Wired

**Description:** generateCapabilityIR() has zero production callers. Only called
from tests. P2CapabilityContract stored in chrome.storage.local but never
consumed.

**Status:** INTENTIONAL per roadmap (P3 will call P2), but worth noting that
the P2 path is completely unexercised in production.

---

## 6. Unproven Items (Require Further Investigation)

### U1 — Does the IR Bridge Generate Correct Playwright Code for Real Apps?

**Description:** The IR Bridge has 69 golden-master snapshots (3 layers: L1
single-element, L2 multi-step, L3 full-flows). These validate output
CONSISTENCY between adapter paths. But golden-master tests use constructed
fixtures, not real DOM recordings. The actual behavioral correctness of
generated Playwright code against real web applications is UNPROVEN.

**Status:** UNPROVEN — would require running generated code against real
websites to validate.

---

### U2 — Classification Correctness for All 23 Types

**Description:** 34 test files provide code-path coverage with constructed
fixtures. But whether all 23 ComponentDefinitions correctly classify real-world
implementations of their respective control types is UNPROVEN for production.

**Status:** UNPROVEN — requires real-world validation.

---

### U3 — Whether Single-Element Interactions Should Bypass Pattern Recognition

**Description:** The architecture currently requires PatternDefinition for
enrichment (via CONFIRMED gating). Single-element interactions (checkbox, slider,
text input) are semantically complete after classification + R3 evidence. Should
they contribute to capability knowledge without component-level recognition?

**Status:** UNRESOLVED architectural question (see G5 below).

---

## 7. Unresolved Architectural Questions (Require Design Decisions)

These questions must be answered before implementation changes. They are NOT
implementation details — they are architectural design decisions.

### G1: What is businessField — Raw Label or Normalized ID?

**Context:** P1 spec examples show normalized identifiers. Implementation
returns raw accessibleName. humanizeLabel expects camelCase.
element-binding-resolver requires exact match. No normalization exists.

**Options:**
- (a) Raw accessibleName → requires changing element-binding-resolver to
    fuzzy-match.
- (b) Normalized identifier → requires adding a normalization function.
- (c) Both → accessibleName stored, normalized ID used for binding.

**Impact:** Determines whether DataRequirements can be bound to LogicalActions.

---

### G2: Should domAttributes Be Aggregated or Should Consumers Read Individual Fields?

**Context:** DomContext has individual typed fields (inputType, required, min,
max, step, pattern). The adapter reads a non-existent domAttributes Record.

**Options:**
- (a) Aggregate individual fields into a domAttributes Record at adaptation
    time.
- (b) Change consumers (InteractionContract deriver) to read individual
    DomContext fields directly.

**Impact:** Determines how validation constraints reach DataRequirements.

---

### G3: Should RadioButton Be SELECT or TOGGLE at Domain Layer?

**Context:** Adapter maps RadioButton→TOGGLE. RADIO_GROUP pattern expects
SELECT. Radio buttons are conceptually SELECT (choosing one of many), not
TOGGLE (on/off).

**Options:**
- (a) Change adapter: RadioButton→SELECT.
- (b) Change pattern: RADIO_GROUP.expectedLifecycle=[TOGGLE].

**Impact:** Determines whether radio groups reach CONFIRMED.

---

### G4: Is Dropdown [CLICK, SELECT] Lifecycle Achievable?

**Context:** Adapter produces one SELECT transition. Pattern expects
[CLICK, SELECT]. The dropdown open-click and option-select are two separate
interactions in the recording.

**Options:**
- (a) Change adapter to emit two transitions (CLICK for open, SELECT for
    choose).
- (b) Change pattern to expect [SELECT] only.
- (c) Track the lifecycle across two interactions (open click + option select)
    and map to one component.

**Impact:** Determines whether dropdowns reach CONFIRMED.

---

### G5: Should Single-Element Interactions Contribute to Capability Knowledge Without Component-Level Recognition?

**Context:** Enrichment only processes CONFIRMED components. Single-element
interactions (checkbox, slider, text input) are semantically complete after
classification but don't form multi-element components.

**Options:**
- (a) Add patterns for all types (makes PatternDefinition exhaustive).
- (b) Allow enrichment for standalone transitions with known semantic type
    (removes the pattern gate).
- (c) Create synthetic single-element components (auto-promote to CONFIRMED
    for known types).

**Impact:** Determines whether PatternDefinition remains a complement or
becomes an exhaustive gate. This is the most consequential architectural
decision.

---

### G6: When Should P2 Be Wired to Production?

**Context:** P2 is implemented and tested but has no production caller. The
roadmap indicates P3 will call P2.

**Options:**
- (a) Wire P2 now (requires fixing upstream defects first).
- (b) Wait for P3 (per roadmap).

**Impact:** Determines sequencing of remaining work.

---

## 8. Test Suite Status

- **3241/3242 tests pass** (1 pre-existing JSDOM timing flake in
  milestone4-performance-scaling.test.ts).
- **151 test files.**
- **No test runs the full production pipeline from recording to P2 output.**
- Tests use FixtureDomInspector (working mock) and construct UiElements with
  populated domAttributes, masking production defects.
- The golden-master tests validate IR Bridge output consistency, not behavioral
  correctness against real apps.
- P2 tests manually construct P2CapabilityContracts with working values, masking
  the businessField/domAttributes defects.

---

## 9. Summary Defect Table

| ID | Defect | Class | Severity | Universal? |
|---|---|---|---|---|
| A1 | domAttributes empty | A | High | Yes (all data types) |
| A2 | componentId never assigned | A | CRITICAL | Yes (all types) |
| A3 | businessField reads dead source | A | CRITICAL | Yes (all types) |
| A4 | ancestorRoles truncated | A | Medium | No (container patterns) |
| A5 | Checkbox signature mismatch | A | Medium | No (checkbox) |
| A6 | RadioGroup lifecycle mismatch | A | Medium | No (radio) |
| A7 | Dropdown lifecycle over-specified | A | Medium | No (dropdown) |
| B1 | No SLIDER pattern | B | Medium | No (slider) |
| B2 | No DATE_PICKER pattern | B | Medium | No (datepicker) |
| B3 | No FILE_UPLOAD pattern | B | Medium | No (fileupload) |
| C1 | CONFIRMED-only enrichment gating | C | High | Yes (all single-element) |
| C2 | optionSet requires live DOM | C | Low | No (dropdown) |
| S1 | businessField normalization missing | Suspected | High | Yes |
| S2 | R3 annotations not carried forward | Suspected | Medium | Yes |
| S3 | Standalone businessField provenance | Suspected | Medium | Yes |
| S4 | P2 not production-wired | Intentional | Low | N/A |
| U1 | Playwright code real-world correctness | Unproven | Unknown | N/A |
| U2 | Classification real-world correctness | Unproven | Unknown | N/A |
| U3 | Single-element enrichment path | Unresolved | High | Yes |

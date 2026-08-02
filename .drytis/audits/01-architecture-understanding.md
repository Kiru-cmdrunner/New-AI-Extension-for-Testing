# Architecture Understanding — Reconstructed from Repository

**Status:** Assessment / audit result — NOT an approved design decision
**Date:** 2025-08-02
**Source:** Git history (146 commits), design documents, phase specs, source code
**Scope:** Read-only analysis. No code or design documents were modified.

---

## 1. The Core Idea

The CmdRecorder AI Extension is a **semantic recorder**: instead of recording
"the user clicked at coordinates X,Y on element with selector #foo", it tries to
understand **what the user did** in semantic terms — "the user toggled the 'On
Sale' filter to ON" — and then builds higher-level knowledge from that
understanding.

The product vision (from CANONICAL_ROADMAP.md and design docs) is an
**AI-powered QA platform**: record once, understand the application's
capabilities, derive reusable test scenarios, parameterize them, execute them
against arbitrary test data, and self-heal when the application changes.

The architecture was built in phases. Each phase solved a specific limitation
of the previous one. Understanding that progression is essential to
understanding why each module exists.

---

## 2. The Phase Progression (Why Each Tier Exists)

### Phase 0 — Component Runtime (M0–M7)
**Problem:** Different web controls implement the same user action in radically
different DOM structures. A checkbox might be `<input type="checkbox">` or a
`<div role="checkbox">` or an `<a class="toggle">` with no semantic markup.

**Decision:** Build a ComponentRuntime with 23 ComponentDefinitions —
deterministic structural detectors that look at DOM attributes (tag, role,
aria-*, class, type) to classify an interaction into a known InteractionType.

**What was produced:** ComponentInteraction[] — a list of semantically typed
interactions. This was sufficient to generate Playwright code.

### R1 — Foundation Cleanup (5e9d75f)
**Problem:** The codebase had a dormant V2 subsystem — dual content scripts with
one dead path. Maintenance burden and confusion about which path was active.

**Decision:** Eliminate the V2 subsystem entirely, unify to a single capture
path. This was infrastructure cleanup, not a capability change.

### R2 — Slider Detection (5a6f5d5)
**Problem:** Custom div-based sliders (e.g., jQuery UI Slider, no native range
input) could not be detected by structural rules alone — the thumb element has
no semantic markup.

**Decision:** Extend detection to use **geometry** — mouse down on a slider
track, mouse move with significant displacement, mouse up — to classify slider
interactions even without `type="range"`.

### R3 — Behavioral Semantic Reasoning (1b2fa89)
**Problem:** This was the fundamental advance. ComponentDefinitions are
structural — they look at attributes at the moment of interaction. But many
custom controls have NO semantic markup at all. A custom toggle might be just
`<a href="#" class="toggle-filter">On Sale</a>` with nothing that says "I am a
checkbox."

**Decision:** Observe **what happens** after the interaction, not just what the
element looks like at click time. The key mechanism: **post-interaction
re-snapshot via setTimeout(0)** — after a click handler fires, the DOM may
change (class added, aria-expanded toggled, child elements appear). Capture
that behavioral evidence and use it to reclassify.

**What was produced:** An evidence engine (10 generators, calibrated weights)
that annotates interactions with behavioral evidence and can reclassify a
Click to a more specific type (Checkbox, Toggle, Tab, Accordion) based on
observed behavior.

**Architectural limitation addressed:** Structural-only classification cannot
handle custom implementations. Behavioral evidence closes that gap for
controls that match a known behavioral signature.

### R4 — Element Identity & Matching (5c814d1, b4d558a)
**Problem:** To heal broken tests when an application changes, the system needs
to match the recorded element to the new version of that element. Early
matching resolved silently (picked the "best" match) which masked ambiguity.

**Decision:** Build a durable element identity model (18 extraction fields → 9
nullable comparison fields) with an 8-dimension weighted scoring system.
Crucially: report MATCHED / AMBIGUOUS / UNMATCHED instead of resolving
silently. AMBIGUOUS means "more than one element scored above threshold" —
this surfaces genuine uncertainty rather than hiding it.

### P1 — Capability Lifecycle Management (cc44c74, b3e14fe)
**Problem:** ComponentInteraction[] answers "what did the user do in this
recording?" but not "what reusable capabilities does this application have?"
Without a managed lifecycle, recordings are ephemeral and can't be reused.

**Decision:** Introduce a capability lifecycle: CapabilityCandidate → review →
Capability (human-approved) → CapabilityVersion (versioned, immutable) →
DataRequirement (formalized input expectations) → SuccessCriterion (pass/fail
criteria). P1 transforms the recorder from a tool into a managed platform.

### P2 — Capability-Derived IR Generation (57128cb, 84c3089)
**Problem:** Even with approved capabilities, test execution requires a concrete
plan: navigate to the page, locate elements, perform actions, verify outcomes.
The recording-derived IR Bridge (ir-bridge.ts) produces code from the specific
recording, but it can't parameterize or substitute test data.

**Decision:** Build a capability-derived IR generator that takes an approved
P2CapabilityContract and produces an ExecutionIRPlan: NAVIGATE → data-driven
action steps (with elements resolved via R4) → VERIFY. This plan can be
re-generated with different test data without re-recording.

**Status:** Implemented and tested. NOT production-wired (no production caller
of generateCapabilityIR). This is intentional per the roadmap — P3 will call P2.

---

## 3. Module-by-Module Architecture (Recording → Highest Knowledge)

The pipeline below traces a user interaction from browser event to the
highest-level reusable knowledge currently implemented.

### 3.1 Event Capture — `event-tap.ts`
**Purpose:** Universal event listener. Captures all user interactions on the
page.
**Why separate:** Isolation from application logic. Must work on any website.
**Receives:** Raw browser DOM events (click, input, change, keydown, etc.).
**Produces:** ObservedEvent (typed wrapper around the raw event + minimal
metadata).
**Intelligence:** Event filtering (ignore non-meaningful events), capture-phase
listeners for reliability.
**Must preserve:** Event type, target element reference, timestamp.
**Must NOT survive:** Raw DOM node references (they mutate / become stale).
**Consumed by:** DOM Context Extractor, ComponentRuntime.
**Wired:** Production.
**Without it:** No recording at all.

### 3.2 DOM Context Extraction — `dom-context-extractor.ts`
**Purpose:** Extract ALL deterministic facts about the DOM state at the moment
of interaction. This is the immutable observation layer.
**Why separate:** Because the DOM mutates immediately after interaction, this
must capture everything later layers might need. The file's own comment says:
"they CANNOT access the DOM later (it mutates)."
**Receives:** ObservedEvent (with target element reference).
**Produces:** DomContext (~35–50 fields): tag, role, type, aria-*, text,
ancestorRoles (up to 10), attributeChanges, inputType, required, min, max, step,
pattern, minLength, maxLength, slider geometry (min, max, step, value, orientation).
**Intelligence:** Identity extraction (18 fields), structural extraction, form
constraint extraction, slider geometry measurement.
**Must preserve:** Everything that is deterministic and observable. This is the
sole source of truth for all later layers.
**Must NOT survive:** Nothing — this is the foundation, everything should be
preserved.
**Consumed by:** ComponentRuntime (via process()), IR Bridge, IdentityMatcher.
**Wired:** Production.
**Without it:** Later layers would have no DOM facts to reason about.

### 3.3 ElementIdentity — `identity-extractor.ts` (within dom-context-extractor)
**Purpose:** Create a durable, comparable identity for the element — independent
of its current position in the DOM. This is what R4 matching uses.
**Why separate:** DOM structure changes. Identity must survive re-renders.
**Receives:** Target element + DOM context.
**Produces:** ElementIdentity (18 extraction fields → ElementIdentityRecord with
9 nullable comparison fields).
**Intelligence:** Extracts the most stable identifiers (test-id, aria-label,
accessible name, form name, role, ancestor roles) and degrades gracefully.
**Must preserve:** All 18 identity fields.
**Consumed by:** R4 Element Repository, HealingService, P2 IR Generation
(reconstructs ElementIdentity from raw interactions for target resolution).
**Wired:** Production.
**Without it:** No durable element matching. Tests would break on any DOM change.

### 3.4 ComponentRuntime — `component-runtime.ts` (1033 lines)
**Purpose:** Classify each interaction into a known InteractionType using a
priority-ordered stack of 23 ComponentDefinitions.
**Why separate:** Classification is the first semantic transformation — turning
raw observations into typed knowledge. Keeping it separate from capture allows
the definition stack to evolve independently.
**Receives:** ObservedEvent (with DomContext).
**Produces:** ComponentInteraction (typed interaction: type, identity, DomContext,
target, subActions, lifecyclePhase, surface).
**Intelligence:** Priority-ordered matching (most specific definitions first,
Click as universal fallback at priority 180). Each definition has a `matches()`
predicate. Lifecycle management (start → complete → timeout at 15s). Dedup
(because mouseup+click both fire). Surface tracking (dropdown menu belongs to
the trigger element).
**Must preserve:** InteractionType, ElementIdentity, DomContext, value transitions.
**Must NOT survive:** Temporary processing artifacts (lifecycle timers, dedup
state).
**Consumed by:** Domain Adapter (production pipeline), IR Bridge.
**Wired:** Production.
**Without it:** Interactions would be untyped — no semantic understanding
possible. Everything would be "click."

### 3.5 Base Interaction Classification — ComponentDefinitions
**Purpose:** Deterministic structural detection for known control types.
**Why separate from Runtime:** Each definition is independently testable,
evolvable, and prioritizable. New definitions can be added without touching the
runtime engine.
**Receives:** DomContext.
**Produces:** Match/no-match + initial InteractionType.
**Intelligence:** Structural predicates: tag, role, aria-*, class patterns, type
attribute. Click (priority 180) is the universal fallback — any interaction that
doesn't match a more specific definition becomes a Click.
**Must preserve:** The assigned InteractionType.
**Consumed by:** ComponentRuntime.
**Wired:** Production.
**Without it:** All interactions would be Clicks. No differentiation.

### 3.6 Evidence Generation — `evidence-generators.ts` (521 lines, 10 generators)
**Purpose:** Generate behavioral evidence about what happened during/after an
interaction. This is the R3 behavioral reasoning layer.
**Why separate:** Structural classification (ComponentDefinitions) can only see
attributes at click time. Evidence observes the EFFECT of the interaction.
**Receives:** Pre-interaction DomContext + post-interaction DomContext
(captured via setTimeout(0) re-snapshot).
**Produces:** Evidence[] — typed behavioral signals with calibrated weights
(ARIA evidence: 0.7–0.9, behavioral: 0.5–0.7, structural: 0.1–0.4).
**Intelligence:** Detects: aria-checked/expanded toggles, class changes, child
element appearance/disappearance, value changes, surface changes, visibility
changes, attribute additions/removals. Each evidence piece has a type, weight,
and source description.
**Must preserve:** Evidence type, weight, description, pre/post values.
**Consumed by:** Evidence Annotation Layer.
**Wired:** Production.
**Without it:** R3 behavioral reclassification impossible. Custom controls
without semantic markup would all remain as Click.

### 3.7 Evidence Annotation — `annotation-layer.ts`
**Purpose:** Decide whether accumulated evidence justifies reclassifying an
interaction to a more specific type.
**Why separate:** Decouples evidence collection from the reclassification
decision. Allows threshold tuning without changing generators.
**Receives:** ComponentInteraction (initially classified) + Evidence[].
**Produces:** Annotated ComponentInteraction with: evidenceTrail, intent
(semantic label), confidence (0–1), possibly reclassified InteractionType.
**Intelligence:** RECLASSIFY_THRESHOLD=0.5 — if total evidence weight ≥ 0.5,
reclassify to the evidence-suggested type. UNRECOGNIZED_THRESHOLD=0.3 — if
confidence < 0.3 AND maxWeight < 0.3, flag as unrecognized. Uses annotation
deferral pattern: if evidence is insufficient at first, defer and re-check
after additional interactions.
**Must preserve:** evidenceTrail, final InteractionType, confidence, intent.
**Must NOT survive:** Intermediate evidence before deferral resolution.
**Consumed by:** Domain Adapter (receives annotated ComponentInteraction).
**Wired:** Production.
**Without it:** Evidence would be collected but never acted upon. Reclassification
threshold would be uncalibrated.

### 3.8 ComponentInteraction (domain entity)
**Purpose:** The central domain object of the recording layer — one typed,
annotated interaction.
**Why it exists:** Single representation that carries: type, identity, DomContext,
evidence, lifecycle phase, surface. Consumed by multiple downstream consumers
without each needing to re-derive.
**Receives:** From ComponentRuntime + Evidence Annotation.
**Produces to:** Domain Adapter, IR Bridge, Persistence.
**Wired:** Production.

### 3.9 Domain Adapter — `domain-adapter-v2.ts`
**Purpose:** Transform the recorder-centric ComponentInteraction into the
domain-centric representation (UiElement + ObservedTransition) that the
recognition and enrichment layers use.
**Why separate:** The recorder and the domain have different vocabularies.
ComponentInteraction is about "what happened." UiElement/ObservedTransition is
about "what exists and what changed." Separation allows the domain model to
evolve independently from the capture model.
**Receives:** ComponentInteraction[].
**Produces:** UiElement[] + ObservedTransition[] (one transition per interaction).
**Intelligence:** Maps InteractionType → TransitionOperation (Click→CLICK,
Checkbox/Toggle→TOGGLE, Dropdown→SELECT, etc.). Extracts UiElement identity,
ancestorRoles, domAttributes from DomContext.
**Must preserve:** Identity, TransitionOperation, value transitions, businessField
(later), ancestorRoles, domAttributes.
**CRITICAL DEFECT (confirmed):** Validation constraints (required, min, max, step,
pattern, inputType) are captured as individual DomContext fields but NOT
aggregated into UiElement.domAttributes. domain-adapter-v2.ts:393–394 reads
`firstEvent.domContext?.domAttributes` which is an empty `{}`. All
InteractionContract.constraints derived downstream are null/default.
**CRITICAL DEFECT (confirmed):** componentId is NOT set on ObservedTransition
during domain adaptation. assignToComponent() exists in ui-element.ts but is
NEVER called in the production pipeline. All transitions enter the semantic
aggregator with componentId=null.
**Consumed by:** Recognition Orchestrator.
**Wired:** Production.
**Without it:** The recorder and domain would share a single vocabulary, making
independent evolution impossible. Recognition would have to work with
ComponentInteraction directly.

### 3.10 UiElement (domain entity)
**Purpose:** Domain representation of a UI element with its identity and attributes.
**Receives:** From Domain Adapter.
**Fields:** identity (ElementIdentity), tag, role, ancestorRoles, domAttributes,
assignToComponent() method (exists but uncalled in pipeline).
**Wired:** Production (as a data structure).

### 3.11 ObservedTransition (domain entity)
**Purpose:** Domain representation of a single state change observed on an element.
**Receives:** From Domain Adapter.
**Fields:** operation (TransitionOperation), fromValue, toValue, componentId
(always null in production — confirmed defect), element reference.
**Wired:** Production (as a data structure).

### 3.12 Component Recognition — `recognition-orchestrator.ts` + `structural-recognizer.ts` (267 lines) + `behavioral-recognizer.ts` (537 lines)
**Purpose:** Recognize multi-element component patterns (Dropdown, Checkbox
Group, Radio Group, Modal, Tabs, Accordion) from sequences of transitions.
**Why separate:** Individual interactions are single-element. Components are
multi-element structures with lifecycles. Recognition is the bridge from
individual actions to component-level understanding.
**Receives:** UiElement[] + ObservedTransition[].
**Produces:** RecognizedComponent[] (component type, member elements, lifecycle
state: TENTATIVE → DEVELOPING → CONFIRMED → REJECTED).
**Intelligence:** Two tiers:
- **Tier 1 (Structural):** ARIA role-based recognition. High confidence (0.95).
If a container has `role="radiogroup"` with children, it's immediately CONFIRMED.
- **Tier 2 (Behavioral):** Evidence-based recognition. Moderate confidence
(0.50–0.75). Uses behavioral evidence (transitions, state changes) to infer
component structure when ARIA is absent.
**Must preserve:** Component type, member elements, lifecycle state, evidence
supporting recognition.
**DEFECT:** ancestorRoles is truncated. pipeline-runner.ts:109 passes only the
target element's role, not the full ancestor chain. RADIO_GROUP pattern root is
'radiogroup' container — the radio target alone won't match without its ancestors.
**DEFECT:** Lifecycle mismatches: RadioButton→TOGGLE vs RADIO_GROUP expected
[SELECT]; Dropdown single-transition adapter vs DROPDOWN expected [CLICK,SELECT];
Checkbox behavioral signature expectedOperation='click' vs adapter's TOGGLE.
**Consumed by:** ComponentGrouping.
**Wired:** Production.
**Without it:** Every interaction would remain isolated. No component-level
understanding. Radio buttons would never be grouped. Dropdowns would be a trigger
click + a separate selection click with no semantic connection.

### 3.13 Pattern Catalogue — `pattern-catalogue.ts`
**Purpose:** Registry of PatternDefinitions — declarative descriptions of
multi-element component structures and their expected lifecycles.
**Why separate:** Recognition logic should be data-driven, not hard-coded.
Adding a new component pattern should be a configuration change, not a code
change.
**Receives:** Nothing (static registry).
**Produces:** PatternDefinition[] (6 patterns: DROPDOWN, CHECKBOX, RADIO_GROUP,
MODAL, TABS, ACCORDION).
**Intelligence:** Each pattern defines: trigger role/structure, member roles,
expected lifecycle sequence (e.g., DROPDOWN expects [CLICK, SELECT]),
completion criteria.
**Coverage gap:** No SLIDER, DATE_PICKER, FILE_UPLOAD patterns. These interaction
types are classified by ComponentRuntime but have no recognition pattern, so they
never receive component-level recognition or enrichment.
**Consumed by:** Recognition Orchestrator.
**Wired:** Production.
**Without it:** Recognition would need hard-coded logic for each component type.

### 3.14 Component Grouping — `component-registry.ts`
**Purpose:** Maintain the lifecycle state of recognized components as more
transitions arrive.
**Receives:** RecognizedComponent[] + new transitions.
**Produces:** Updated ComponentGrouping[] with lifecycle states (TENTATIVE →
DEVELOPING → CONFIRMED → REJECTED).
**Intelligence:** Lifecycle progression: add transitions, check completion
criteria, promote/demote.
**Consumed by:** Enrichment Orchestrator (CONFIRMED only).
**Wired:** Production.
**Without it:** Components would be stateless snapshots with no progression.

### 3.15 Enrichment Orchestrator — `enrichment-orchestrator.ts`
**Purpose:** Derive application-level knowledge from CONFIRMED components.
**Why separate:** This is the transformation from "what was observed" to "what
the application can do." It requires confirmed component understanding, not raw
transitions.
**Receives:** CONFIRMED ComponentGrouping[] (CRITICAL: only CONFIRMED — line 74
gating).
**Produces:** ApplicationKnowledgeFragment (LogicalAction[], InteractionContract,
BehavioralContract, businessField, optionSet).
**Intelligence:** 7-step enrichment:
1. Derive businessField (from accessibleName — BUT uses NoOpDomInspector which
   returns null; CONFIRMED DEFECT: should read entity.identity.accessibleName
   which already has the value).
2. Derive InteractionContract (validation constraints from domAttributes —
   empty due to upstream defect).
3. Derive BehavioralContract (behavioral evidence summary).
4. Derive optionSet (for dropdowns — legitimate live-DOM access via DomInspector;
   NoOpDomInspector returns null for all production recordings).
5. Derive LogicalAction (semantic action description).
6. Aggregate into fragment.
7. Return fragment.
**GATING DEFECT:** Only CONFIRMED components are enriched. Single-element
interactions (checkbox toggle, slider change, text input) that don't form
multi-element components never reach enrichment. This makes PatternDefinition
an unintended gate: even if an interaction is correctly classified, if it
doesn't match a pattern, it gets no enrichment → no LogicalAction → no
CapabilityCandidate → no capability knowledge.
**Consumed by:** Capability Deriver.
**Wired:** Production.
**Without it:** ComponentGrouping[] would be terminal — no capability knowledge.

### 3.16 ApplicationKnowledgeFragment (domain entity)
**Purpose:** The output of enrichment — the application-level understanding of
what was observed.
**Receives:** From Enrichment Orchestrator.
**Fields:** LogicalAction[], InteractionContract[], BehavioralContract,
businessField, optionSet.
**Consumed by:** Capability Deriver.
**Wired:** Production.

### 3.17 LogicalAction (domain entity)
**Purpose:** Semantic action description — "set filter 'On Sale' to ON" rather
than "click element #toggle."
**Receives:** From Enrichment Orchestrator.
**Fields:** actionType (no enum — purely structural description), businessField
(source field identifier), sourceInteractionType.
**CRITICAL DEFECT:** businessField is null for all interactions due to the
NoOpDomInspector defect in enrichment. LogicalActions are produced but carry no
field binding.
**Consumed by:** Capability Deriver.
**Wired:** Production (but degraded — businessField always null).

### 3.18 InteractionContract (domain entity)
**Purpose:** Formalize what an interaction expects: input constraints, value
ranges, accepted values.
**Receives:** From Enrichment Orchestrator (via domAttributes).
**Fields:** constraints (required, min, max, step, pattern, inputType).
**DEFECT:** All constraints null/default due to domAttributes always being `{}`.
**Consumed by:** Capability Deriver (to produce DataRequirements).
**Wired:** Production (but degraded — constraints always null).

### 3.19 BehavioralContract (domain entity)
**Purpose:** Summarize the behavioral evidence supporting the interaction's
classification — what changed after the interaction that justifies calling it
a checkbox toggle vs a plain click.
**Receives:** From Enrichment Orchestrator.
**Consumed by:** Capability Deriver.
**Wired:** Production.

### 3.20 businessField (derived field)
**Purpose:** The normalized identifier for the data field this interaction
operates on — "email", "maxPrice", "onSale" — so that data-driven test
parameters can be bound to the right interaction.
**UNRESOLVED QUESTION (G1):** What should businessField be? P1 spec examples show
normalized identifiers ('email', 'maxPrice'). Phase 5 spec says "from
accessibleName/label" → raw label text. Implementation returns raw
accessibleName. humanizeLabel in capability-mappers.ts expects camelCase input.
element-binding-resolver.ts requires exact string match
DataRequirement.field === LogicalAction.businessField. No normalization
function exists. P2 walkthrough test manually constructs normalized values.
**DEFECT:** deriveBusinessField in enrichment queries DOM via
NoOpDomInspector.inspector.querySelector(elementId)?.accessibleName which
returns null. But UiElement.identity.accessibleName already has the value. The
function circumvents the entity and reads from a dead source.
**Wired:** Production (but broken — always null).

### 3.21 CapabilityCandidate (domain entity)
**Purpose:** Proposed capability extracted from a recording — awaiting human
review.
**Receives:** From Capability Deriver (via ApplicationKnowledgeFragment).
**Fields:** actions (LogicalAction[]), inputs (CapabilityInput[]), source
interaction types, capability name/description.
**DEFECT:** inputs is always empty [] because deriveInputs skips all actions
where businessField is null (capability-deriver.ts:202).
**Consumed by:** SessionPersistenceService → Capability Review.
**Wired:** Production.

### 3.22 SessionPersistenceService
**Purpose:** Persist recording sessions and match interactions to existing
capabilities.
**Receives:** RecordingSession (with ComponentInteraction[],
CapabilityCandidate[]).
**Produces:** Persisted RecordingSession + CapabilityReview records.
**Intelligence:** matchCapability — compares new candidates against existing
approved capabilities to detect duplicates vs new capabilities.
**Consumed by:** Side Panel (display), Capability Review.
**Wired:** Production.

### 3.23 P1 Review Lifecycle — `capability-review` components
**Purpose:** Human-in-the-loop: review CapabilityCandidates and approve or reject
them. Transforms candidates into durable, versioned capabilities.
**Receives:** CapabilityCandidate (from persistence).
**Produces:** Capability (approved) or rejection. If approved: CapabilityVersion
(immutable version), DataRequirement[], SuccessCriterion[].
**Intelligence:** Human judgment — the reviewer decides whether the candidate
correctly represents a reusable application capability.
**Consumed by:** Side Panel (display), P2 (when approved).
**Wired:** Production.

### 3.24 Capability + CapabilityVersion (domain entities)
**Purpose:** Durable representation of one reusable application capability.
**Receives:** From P1 review.
**Fields:** Capability = name, description, current version, status. Capability
Version = immutable snapshot: DataRequirements, SuccessCriteria,
sourceSessionId, sourceInteractionType.
**Consumed by:** P2 IR Generation.
**W/target:** Production (created by review, stored in chrome.storage.local).

### 3.25 DataRequirement (domain entity)
**Purpose:** Formalize what data an interaction needs to execute. "Set filter
'On Sale' requires a boolean." "Set price range requires two numbers: min, max."
**Receives:** From Capability Deriver (via InteractionContract).
**Fields:** kind (boolean, string, number, etc.), inputMethod (text input, radio
selection, checkbox toggle, slider drag, etc.), field (the businessField binding).
**DEFECT:** Because businessField is null and domAttributes is empty, the derived
DataRequirements lack field bindings and validation constraints. They carry only
the kind (inferred from interaction type) and inputMethod.
**Consumed by:** P2 IR Generation (to create data-driven action steps).
**Wired:** Production (but degraded).

### 3.26 InputMethod (domain entity / enum)
**Purpose:** How data is provided to the interaction — orthogonal to data kind.
A boolean can be provided via checkbox toggle, radio selection, or toggle link.
**Wired:** Production.

### 3.27 SuccessCriterion (domain entity)
**Purpose:** Define pass/fail conditions for a capability — when does "filter by
On Sale" succeed? When the product grid updates and shows only sale items.
**Receives:** From Capability Deriver or human review.
**Wired:** Production.

### 3.28 P2CapabilityContract (domain entity)
**Purpose:** The complete contract for generating an execution IR from an approved
capability. Bundles: DataRequirements, sourceSessionId (for target resolution),
sourceInteractionType, SuccessCriteria.
**Receives:** From Capability + CapabilityVersion (after P1 approval).
**Consumed by:** P2 IR Generator.
**Stored in:** chrome.storage.local under CAPABILITY_INVENTORY_contract.
**Wired:** Production (stored) but NOT consumed by any production code.

### 3.29 Element Repository — R4 — `element-repository.ts` + `element-matching-service.ts`
**Purpose:** Store durable element identities and match recorded elements against
current DOM state.
**Why separate:** Matching is a separate concern from recording. Elements need
to survive across sessions and be matchable against future DOM states.
**Receives:** ElementIdentity records (from recording), query ElementIdentity
(from a broken test).
**Produces:** MatchResult (MATCHED / AMBIGUOUS / UNMATCHED + score).
**Intelligence:** 8-dimension weighted scoring: BUSINESS_IDS (0.25),
ACCESSIBLE_NAME (0.20), FORM_NAME (0.15), ARIA_ROLE (0.10), ARIA_LABEL (0.10),
ANCESTOR_ROLES (0.10), TAG (0.05), PAGE_SCOPE (0.05). MATCH_THRESHOLD=0.70,
MIN_MARGIN=0.05. Report ambiguity rather than resolving silently.
**Consumed by:** HealingService, P2 IR Generation (target resolution).
**Wired:** Production.

### 3.30 HealingService
**Purpose:** When an executed test fails because an element can't be found, use
R4 matching to find the element in the current DOM and update the test.
**Receives:** Broken element identity + current DOM context.
**Produces:** Healed locator or failure.
**Consumed by:** Execution engine (future).
**Wired:** Production (logic exists; execution engine is future roadmap).

### 3.31 Recording-Derived IR Bridge — `ir-bridge.ts` (1717 lines)
**Purpose:** Generate concrete Playwright code directly from a recording's
ComponentInteraction[].
**Why separate:** Immediate playback/preview doesn't need capability
understanding — it just replays what was recorded. This is the "what did the
user do" path.
**Receives:** ComponentInteraction[] (raw, from recording).
**Produces:** IRStep[] → Playwright code (via Playwright Generator).
**Intelligence:** One step per interaction. Uses identity to generate locators.
Handles all InteractionTypes for code generation. Does NOT depend on
businessField, recognition, or enrichment.
**Consumed by:** Side Panel (Playwright code tab).
**Wired:** Production.
**Without it:** No Playwright code output. No preview of the recording.

### 3.32 Capability-Derived P2 IR — `capability-ir-generator.ts`
**Purpose:** Generate an ExecutionIRPlan from an approved capability contract,
enabling data-driven test generation without re-recording.
**Why separate from IR Bridge:** The IR Bridge replays the recording. P2 generates
a new plan from the capability — parameterizable with different test data.
**Receives:** P2CapabilityContract (with sourceSessionId for target resolution).
**Produces:** ExecutionIRPlan: NAVIGATE → data-driven action steps (elements
resolved via R4) → VERIFY.
**Intelligence:**
1. Recover RecordingSession via sourceSessionId.
2. Build interaction/event identity indexes.
3. Recover full ElementIdentity from raw interactions.
4. Call matchElements() against stored Elements.
5. Generate action steps from DataRequirements.
6. Generate verify steps from SuccessCriteria.
**Provenance dependency:** P2 needs sourceSessionId to recover the original
recording's element identities for target resolution. This is a
target-resolution dependency, not a semantic dependency.
**Consumed by:** Nothing in production. Only called from
tests/p2-e2e-walkthrough.ts and tests/p2-capability-ir-gates.test.ts.
**NOT PRODUCTION-WIRED.** Implemented + tested only.
**Without it:** No data-driven test generation. Tests can only replay recordings.

### 3.33 ExecutionIRPlan (domain entity)
**Purpose:** Complete execution plan: navigate, perform actions with resolved
targets, verify outcomes.
**Receives:** From P2 IR Generator (or IR Bridge for immediate playback).
**Consumed by:** Playwright Generator (P2 path) or execution engine (future).
**Wired:** Test-only (via P2). Production playback uses IR Bridge output.

### 3.34 Playwright Generation — `playwright-generator.ts`
**Purpose:** Convert IR steps into readable, executable Playwright test code.
**Receives:** IRStep[] (from IR Bridge or P2).
**Produces:** Playwright test code string.
**Wired:** Production.

### 3.35 Side Panel — UI components
**Purpose:** Present recording results to the user: timeline, Playwright code,
capability review card, capability inventory, capability detail.
**Receives:** RecordingSession, CapabilityCandidate[], Capability[],
P2CapabilityContract[].
**Produces:** User-facing display. Review decisions.
**Wired:** Production.

---

## 4. Two Parallel IR Paths

### Path 1: Recording-Derived IR Bridge (Production)
```
ComponentInteraction[] → IR Bridge → IRStep[] → Playwright Code
```
- Works independently of recognition, enrichment, capability derivation.
- One step per interaction.
- Generates working Playwright code for all InteractionTypes.
- Does NOT depend on businessField.
- This is the path the side panel shows today.

### Path 2: Capability-Derived P2 IR (Implemented, NOT Wired)
```
P2CapabilityContract → P2 IR Generator → ExecutionIRPlan → Playwright Code
```
- Requires DataRequirements with field bindings (businessField).
- Requires sourceSessionId for target resolution.
- Produces NAVIGATE → data steps → VERIFY.
- NOT called by any production code.
- Only exercised by tests that manually construct contracts with working values.

---

## 5. The Capability Pipeline Gap

The intended complete pipeline is:

```
ComponentInteraction → Domain Adapter → Recognition → Enrichment →
ApplicationKnowledgeFragment → CapabilityCandidate → Review → Capability →
DataRequirement → P2CapabilityContract → P2 IR → ExecutionIRPlan
```

Today, the pipeline breaks down at multiple points (detailed in the defect
audit). The recording-derived path (ComponentInteraction → IR Bridge →
Playwright) works end-to-end. The capability-derived path is implemented but
degraded by upstream defects that prevent meaningful DataRequirements from
being derived.

---

## 6. Distinction: Novel Implementation vs Novel Semantic Type

This is a crucial architectural distinction:

**Novel implementation of a known semantic interaction:**
A custom `<div>` toggle with no ARIA attributes that behaves like a checkbox.
The architecture is designed to handle this: ComponentDefinitions attempt
structural classification → Click fallback → R3 evidence engine observes
behavior → reclassifies to Checkbox/Toggle based on behavioral evidence.

**Entirely new semantic interaction type:**
A control that does not correspond to any known InteractionType. The
architecture does NOT invent new InteractionTypes. It classifies to the closest
existing type or flags as unrecognized (confidence < 0.3). Inventing new types
is explicitly deferred to future roadmap (R3 spec: "not inventing new types —
that is deferred").

This distinction matters because:
- PatternDefinitions are for multi-element component recognition (Dropdown,
  RadioGroup, etc.). Missing patterns do NOT prevent classification — they
  prevent component-level recognition and enrichment.
- A novel implementation of a known type can be classified (by ComponentRuntime
  + R3 evidence) even without a pattern. But it cannot reach enrichment
  (CONFIRMED gating) or capability derivation (businessField null) without
  pattern-level recognition.

---

## 7. What Today's Implementation Can Actually Do

| Capability | Status | Notes |
|---|---|---|
| Record interactions | ✅ Production | Event capture → ComponentInteraction |
| Classify 23 interaction types | ✅ Production | ComponentRuntime + 23 definitions |
| Behavioral reclassification (R3) | ✅ Production | Evidence engine, Click → Checkbox/Toggle/Tab/Accordion |
| Generate Playwright code (recording-derived) | ✅ Production | IR Bridge, all types |
| Show recording timeline | ✅ Production | Side panel |
| Durable element identity (R4) | ✅ Production | 18 fields, 8-dimension scoring |
| Element matching with ambiguity detection | ✅ Production | R4 matching service |
| Multi-element recognition | ⚠️ Degraded | 6 patterns, lifecycle mismatches, ancestorRoles truncation |
| Enrichment → LogicalAction | ⚠️ Degraded | CONFIRMED gating, businessField always null |
| Capability candidate creation | ⚠️ Degraded | inputs always [] due to businessField |
| P1 review lifecycle | ✅ Production | Candidate → review → Capability + Version |
| DataRequirement derivation | ⚠️ Degraded | Lacks field bindings and constraints |
| P2 capability-derived IR | 🔶 Not wired | Implemented + tested, no production caller |
| Capability-derived Playwright code | 🔶 Not wired | Via P2, test-only |
| HealingService | ✅ Logic exists | Execution engine is future roadmap |

---

## 8. Summary — Module Dependency Graph

```
Browser Event
    │
    ▼
EventTap ──────────────────────────────────────┐
    │                                           │
    ▼                                           │
DomContextExtractor ──► ElementIdentity         │
    │                              │            │
    ▼                              ▼            │
ComponentRuntime ──► ComponentInteraction       │
    │                              │            │
    ▼                              ▼            │
EvidenceEngine ──► AnnotationLayer              │
    │                                           │
    ▼                                           ▼
    └──► ComponentInteraction[] ──────► IR Bridge ──► Playwright Code (Path 1)
            │
            ▼
        Domain Adapter ──► UiElement + ObservedTransition
            │
            ▼
        Recognition Orchestrator
            │
            ▼
        Component Grouping (CONFIRMED only)
            │
            ▼
        Enrichment Orchestrator ──► ApplicationKnowledgeFragment
            │
            ▼
        Capability Deriver ──► CapabilityCandidate
            │                    (inputs=[] due to defects)
            ▼
        SessionPersistenceService
            │
            ▼
        P1 Review ──► Capability + CapabilityVersion
            │              │
            │              ▼
            │         DataRequirement (degraded)
            │              │
            │              ▼
            │         P2CapabilityContract (stored, not consumed)
            │              │
            │              ▼
            │         P2 IR Generator ──► ExecutionIRPlan (test-only)
            │
            ▼
        Side Panel (timeline, code, review card)
```

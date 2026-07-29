# CmdRecorder — Architecture Freeze & Implementation Strategy

**Purpose:** Define the frozen architectural contracts, evaluate future-proofing, and specify the controlled implementation strategy.  
**Prerequisite:** Reads as the sequel to `ARCHITECTURE_REVIEW.md` and `SIMPLIFICATION_JUSTIFICATION.md`.  
**Date:** July 2026

---

## Table of Contents

1. [Future-Proofing Analysis](#1-future-proofing-analysis)
2. [Phase 0 — Architecture Freeze: Core Contracts](#2-phase-0--architecture-freeze-core-contracts)
3. [Implementation Strategy](#3-implementation-strategy)
4. [Risk Analysis & Mitigation](#4-risk-analysis--mitigation)
5. [Completion Criteria](#5-completion-criteria)

---

## 1. Future-Proofing Analysis

### The Long-Term Vision

CmdRecorder is one component of CmdRunner. The broader vision includes:

| Capability | What It Requires from the Recorder |
|-----------|----------------------------------|
| AI-generated test cases | A semantic model rich enough for an LLM to understand what happened and generate variations |
| AI-assisted execution | Execution-time context about what the test is doing and what "success" looks like |
| AI reasoning over workflows | Cross-interaction understanding — not just "click this" but "this click opens a form, these entries fill it, this submission authenticates the user" |
| AI-generated assertions | Knowledge of expected states, validation rules, option sets, and behavioral contracts |
| Self-healing locators | Rich element identity with multiple fallback strategies + behavioral signatures |
| Cross-framework support | Framework-agnostic identity and interaction models |
| Mobile / Desktop / API expansion | Extensible interaction types that aren't DOM-coupled |

I'll evaluate the proposed architecture against each.

---

### 1.1 Is `SemanticInteraction` Rich Enough for AI Reasoning?

#### Proposed SemanticInteraction Schema (Preliminary)

```typescript
interface SemanticInteraction {
  // Identity
  id: string;
  order: number;
  type: InteractionType;          // 19 consolidated types
  variant?: string;               // e.g., 'double', 'right', 'native', 'custom'
  
  // What the user interacted with
  target: {
    identity: ElementIdentity;    // accessibleName, role, tag, locators, etc.
    pageUrl: string;              // where on the site
    pageTitle: string;
    context: DomContext;          // ARIA state, surface, ancestor roles, framework metadata
  };
  
  // What happened
  label: string;                  // human-readable: "Select Belgian for Nationality"
  value?: string;                 // final value entered/selected
  beforeState?: ElementState;     // value, checked, expanded BEFORE
  afterState?: ElementState;      // value, checked, expanded AFTER
  semanticAction?: string;        // 'configure', 'authenticate', 'navigate', etc.
  configuredFields?: Record<string, string>;  // for multi-config panels
  
  // Evidence provenance
  evidence: Evidence[];           // what evidence led to this classification
  confidence: number;
  
  // Temporal
  timestamp: string;
  duration?: number;              // for multi-event interactions
  
  // Session context
  componentType?: string;         // which lifecycle produced this
  sessionEventCount?: number;     // how many raw events were collapsed
  
  // Assertions (derived)
  assertions?: Assertion[];
}
```

#### Gap Analysis Against AI Needs

**AI workflow reasoning needs:**

| Need | Available in SemanticInteraction? | Gap? |
|------|----------------------------------|------|
| "What did the user click?" | `target.identity.accessibleName`, `target.identity.ariaRole` | ✅ |
| "What page were they on?" | `target.pageUrl`, `target.pageTitle` | ✅ |
| "What value did they enter/select?" | `value`, `afterState` | ✅ |
| "What was the state before?" | `beforeState` | ✅ |
| "Was this part of a form submission?" | `semanticAction: 'authenticate'`, `componentType: 'formSubmit'` | ✅ |
| "What fields were configured in that panel?" | `configuredFields` | ✅ |
| "How confident is this classification?" | `confidence`, `evidence[]` | ✅ |
| "What workflow was this recording demonstrating?" | NOT in individual interactions | ⚠️ GAP |
| "What are all the elements on this page?" | NOT in individual interactions | ⚠️ GAP (derivable) |
| "What are the valid options for this dropdown?" | NOT available (no DOM access) | ⚠️ GAP (existing) |
| "What validation rules apply to this field?" | NOT available (no DOM access) | ⚠️ GAP (existing) |

**Assessment:** SemanticInteraction is rich enough for per-interaction AI reasoning. The gaps are:

1. **Workflow-level understanding** — "this recording demonstrates User Login" — is a cross-interaction concern. It should be an optional derived analysis, not embedded in individual interactions. The capability inference function handles this.

2. **Option sets and validation rules** — these require DOM access that neither current nor proposed architecture has in the service worker. This is a genuine gap in both architectures. The solution is DOM evidence collection at capture time.

3. **Element catalog** — derivable from interactions by grouping by `target.identity.elementId`. Available on demand. No information loss.

#### What I'd Add to SemanticInteraction for Future-Proofing

Three fields that cost nothing today but enable future capabilities:

```typescript
interface SemanticInteraction {
  // ... existing fields ...
  
  // Future AI: intent classification (lightweight, derived)
  intentCategory?: string;        // 'navigation', 'data_entry', 'selection', 
                                  // 'configuration', 'authentication', 'verification'
  
  // Future AI: element relationships
  relationships?: {
    parentForm?: string;          // elementId of containing form/panel
    relatedTo?: string[];         // elementIds of related elements (label→input)
    opensSurface?: string;        // elementId of modal/drawer opened by this action
  };
  
  // Future AI: behavioral signature (for self-healing)
  behavioralSignature?: {
    surroundingText?: string[];   // text near the element at interaction time
    visualPosition?: { x: number; y: number };  // approximate viewport position
    nearbyLandmarks?: string[];   // headings, section titles near the element
  };
}
```

These fields are optional and nullable. They enrich the AI's understanding without adding complexity to the core pipeline. They can be populated incrementally — behavioral signatures first (cheap to capture), relationships and intent categories later.

**Verdict:** ✅ With these three additions, SemanticInteraction is sufficient for AI reasoning. No architectural change needed to support future AI features.

---

### 1.2 Workflow-Level Understanding Without Another Pipeline

**The concern:** "Can business understanding evolve naturally without introducing another major pipeline?"

**Current approach:** 4-stage domain pipeline (adapt → recognize → enrich → capability) produces ApplicationKnowledgeFragment + CapabilityCandidate.

**Proposed approach:** Inline enrichment + optional on-demand analysis.

**Why this works:**

Business understanding is fundamentally a **projection** over SemanticInteraction[]. It answers questions like:
- "What did the user accomplish?" → Sequence of interaction types + targets
- "What capability does this demonstrate?" → Pattern match over the sequence
- "What pages were visited?" → Group by pageUrl
- "What forms were filled?" → Group by parentForm relationship
- "What assertions should hold?" → Before/after states

None of these require a 4-stage pipeline. They're queries over the interaction array:

```typescript
// Capability inference: a function, not a pipeline
function inferCapability(interactions: SemanticInteraction[]): Capability {
  const hasPassword = interactions.some(i => 
    i.target.identity.inputType === 'password');
  const hasSubmitNav = interactions.some(i => 
    i.semanticAction === 'authenticate');
  const hasFormFill = interactions.filter(i => 
    i.type === 'Fill').length >= 2;
  
  if (hasPassword && hasSubmitNav) return { type: 'authentication', confidence: 0.9 };
  if (hasFormFill && interactions.some(i => i.type === 'Click' && i.label.includes('Save'))) 
    return { type: 'data_entry', confidence: 0.7 };
  // ... extensible pattern registry
}
```

**How business understanding evolves:**

| Evolution | Current Architecture | Proposed Architecture |
|-----------|---------------------|----------------------|
| Add a new capability pattern | Add an enrichment module (~200 lines) | Add a pattern to the registry (~10 lines) |
| Add workflow-level assertions | Add an enrichment module | Add assertion rules to the IR bridge |
| Add cross-page analysis | Modify domain adapter + recognition | Add a derived-view function |
| LLM-based understanding | Not supported (structured data only) | Feed SemanticInteraction[] to LLM — the model is already LLM-friendly |

**The key insight:** The proposed architecture doesn't REMOVE business understanding — it makes it a **first-class query over a rich data model** instead of a separate pipeline. This is more extensible because adding understanding patterns is adding functions, not adding pipeline stages.

**Verdict:** ✅ Business understanding evolves more naturally in the proposed architecture than in the current one.

---

### 1.3 On-Demand Element Catalog: Performance & Scalability

**The concern:** "Will moving the element catalog to an on-demand model create performance issues for future AI features?"

**Analysis:**

Computing UiElement[] from SemanticInteraction[] is an O(n) group-by:

```typescript
function buildElementCatalog(interactions: SemanticInteraction[]): UiElement[] {
  const map = new Map<string, UiElement>();
  for (const i of interactions) {
    const key = i.target.identity.elementId;
    if (!map.has(key)) {
      map.set(key, {
        elementId: key,
        tagName: i.target.identity.tag,
        role: i.target.identity.ariaRole,
        accessibleName: i.target.identity.accessibleName,
        locators: i.target.identity.locators,
        firstSeenOnPage: i.target.pageUrl,
        firstSeenAt: i.timestamp,
        interactions: [],
      });
    }
    map.get(key)!.interactions.push({ type: i.type, timestamp: i.timestamp });
  }
  return [...map.values()];
}
```

For a typical recording (50-200 interactions), this completes in <1ms. Even for a large recording (1000+ interactions), it's <10ms.

**AI feature scenarios:**

| Scenario | Catalog Size | Computation Time | Performance Issue? |
|----------|-------------|-----------------|-------------------|
| Single test case analysis | 20-50 elements | <1ms | ❌ No |
| Batch analysis of 100 test cases | 2000-5000 elements | ~50ms | ❌ No |
| Real-time during recording | Incremental (add to catalog as interactions arrive) | <1ms per interaction | ❌ No |
| LLM context window | Need to fit in 128K tokens | Depends on element count — but catalog is compact (~200 bytes/element) | ❌ No for typical sizes |

**Verdict:** ✅ No performance or scalability concern. On-demand computation is fast enough for any realistic AI workload.

---

### 1.4 Cross-Domain Expansion (Mobile, Desktop, API)

**The concern:** "Is the architecture flexible enough for future automation domains?"

**Current architecture:** Deeply coupled to DOM events, HTML elements, CSS selectors, browser APIs.

**Proposed architecture:** The 3-stage model is domain-agnostic IF the contracts are designed correctly.

#### Domain Extension Points

```
Stage 1: CAPTURE
  Web:     DOM events → CapturedEvent
  Mobile:  Accessibility events (XCUITest/Espresso) → CapturedEvent
  Desktop: UI Automation events → CapturedEvent
  API:     HTTP request/response → CapturedEvent

Stage 2: INTERACTION ENGINE
  Same lifecycle engine, same evidence model
  Different lifecycle definitions per domain:
    Web:     dropdown, date_picker, autocomplete, ...
    Mobile:  picker_wheel, sheet, alert_action, ...
    API:     request_chain, pagination, auth_flow, ...

Stage 3: IR + CODE GENERATION
  Different adapters:
    Web:     Playwright
    Mobile:  XCUITest / Espresso
    Desktop: Windows App Driver
    API:     Supertest / REST Assured
```

#### What Makes This Possible

The key is that SemanticInteraction is **semantically typed** (Select, Fill, Navigate, Toggle) not **mechanically typed** (Click, Input, Change). "Select Belgian for Nationality" is the same semantic interaction whether it happened via:
- A DOM dropdown click (web)
- A picker wheel selection (mobile)
- An API enum parameter (API)

The `target.identity` differs by domain (CSS selector vs accessibility identifier vs API endpoint), but the `type`, `label`, `value`, and `beforeState/afterState` are domain-agnostic.

#### What the IR Contract Needs

The IRStep must support domain-specific locator strategies:

```typescript
interface ResolvedLocator {
  type: LocatorStrategyType;
  value: string;
  priority: number;
  confidence: number;
}

// LocatorStrategyType must be extensible:
type LocatorStrategyType = 
  // Web
  | 'ROLE' | 'ACCESSIBLE_NAME' | 'TEST_ID' | 'TEXT' 
  | 'PLACEHOLDER' | 'CSS' | 'XPATH'
  // Mobile (future)
  | 'ACCESSIBILITY_IDENTIFIER' | 'LABEL' | 'PREDICATE'
  // API (future)
  | 'PATH_PARAM' | 'QUERY_PARAM' | 'HEADER'
  // Universal
  | 'INDEX';
```

#### Honest Limitation

The current evidence providers (DOM, ARIA, CSS, EventSequence, Mutation) are web-specific. Mobile/API domains would need their own providers. But the **evidence provider interface** is domain-agnostic:

```typescript
interface EvidenceProvider {
  name: string;
  onEvent(event: CapturedEvent, context: SessionContext): Evidence[];
  onCommit(buffer: SessionBuffer): Evidence[];
}
```

A mobile accessibility provider and a DOM provider both implement this interface. The lifecycle engine doesn't care which domain produced the evidence.

**Verdict:** ✅ The 3-stage architecture supports cross-domain expansion. The contracts (CapturedEvent, Evidence, SemanticInteraction, IRStep) are domain-agnostic by design. Domain-specific logic lives in providers, lifecycle definitions, and code generation adapters — not in the pipeline structure.

---

### 1.5 Future-Proofing Summary

| Future Capability | Architecture Supports It? | What's Needed |
|-------------------|--------------------------|---------------|
| AI-generated test cases | ✅ | SemanticInteraction[] is LLM-friendly; add 3 optional fields |
| AI-assisted execution | ✅ | IRStep carries enough context; add execution hints |
| AI workflow reasoning | ✅ | Per-interaction + optional derived analysis |
| AI-generated assertions | ⚠️ Partially | before/after states available; option sets and validation rules need DOM evidence |
| Self-healing locators | ✅ | Element identity is rich; add behavioral signature field |
| Cross-framework support | ✅ | Framework adapters are pluggable |
| Mobile/Desktop/API expansion | ✅ | 3-stage model is domain-agnostic; need domain-specific providers + lifecycle definitions + code adapters |

**The one genuine gap:** Option sets and validation rules require DOM access at capture time. This gap exists in BOTH the current and proposed architectures. The solution is the same for both: collect DOM evidence via Control Model discovery at capture time, pass it through as context.

**Recommendation:** Add DOM evidence collection to the capture layer (via Control Model) in a future phase. This is orthogonal to the architecture simplification — it enhances both designs equally.

---

## 2. Phase 0 — Architecture Freeze: Core Contracts

Before any implementation changes, these contracts are frozen. They define the stable foundation upon which all implementation phases build.

### 2.1 Interaction Taxonomy (Frozen: 19 Types)

```typescript
type InteractionType =
  // Single-action types
  | 'Click'           // variant: 'single' | 'double' | 'right'
  | 'Fill'            // text entry, slider value
  | 'Select'          // variant: 'native' | 'custom' | 'autocomplete' | 'multi'
  | 'DateSelect'      // variant: 'date' | 'time' | 'datetime'
  | 'Toggle'          // checkbox, switch
  | 'RadioSelect'     // radio button
  | 'Upload'          // variant: 'browse' | 'dragdrop'
  | 'Scroll'          // variant: 'page' | 'container' | 'infinite'
  | 'Hover'           // hover with visible change
  
  // Navigation types
  | 'Navigate'        // variant: 'page' | 'refresh' | 'forward' | 'back'
  
  // Semantic link types (kept distinct for semantic meaning)
  | 'Link'            // navigational link click
  | 'Tab'             // tab panel switch
  | 'Breadcrumb'      // hierarchical navigation
  | 'Menu'            // menu item click
  
  // Composite types (multi-event lifecycles)
  | 'DragDrop'        // drag source → drop target
  | 'Surface'         // variant: 'modal' | 'drawer' | 'popover' | 'tooltip'
  
  // System types
  | 'Alert'           // variant: 'dialog' | 'newtab' | 'newwindow'
  | 'Unknown';        // unclassified
```

**Variant is metadata, not a separate type.** `Click` with `variant: 'double'` is the same IR action as `Click` with `variant: 'single'` — only the Playwright method changes.

### 2.2 SemanticInteraction Schema (Frozen)

```typescript
interface SemanticInteraction {
  // ─── IDENTITY ──────────────────────────────────────
  id: string;                         // "interaction-0001"
  order: number;                      // 0-based sequence position
  type: InteractionType;
  variant?: string;                   // type-specific qualifier
  
  // ─── TARGET ────────────────────────────────────────
  target: InteractionTarget;
  
  // ─── SEMANTICS ─────────────────────────────────────
  label: string;                      // "Select Belgian for Nationality"
  value?: string;                     // final committed value
  beforeState?: ElementState;
  afterState?: ElementState;
  semanticAction?: SemanticAction;    // 'configure' | 'authenticate' | etc.
  configuredFields?: Record<string, string>;
  
  // ─── EVIDENCE PROVENANCE ───────────────────────────
  evidence: EvidenceSummary[];        // which providers contributed
  confidence: number;                 // 0.0–1.0
  
  // ─── TEMPORAL ──────────────────────────────────────
  timestamp: string;                  // ISO 8601
  durationMs?: number;                // for multi-event interactions
  
  // ─── SESSION CONTEXT ───────────────────────────────
  componentType?: ComponentType;      // which lifecycle produced this
  sourceEventCount?: number;          // raw events collapsed into this
  
  // ─── ASSERTIONS ────────────────────────────────────
  assertions?: Assertion[];
  
  // ─── FUTURE AI (optional, nullable) ────────────────
  intentCategory?: IntentCategory;
  relationships?: ElementRelationships;
  behavioralSignature?: BehavioralSignature;
}

interface InteractionTarget {
  identity: ElementIdentity;
  pageUrl: string;
  pageTitle: string;
  context: DomContext;
}

interface ElementIdentity {
  // Core identity
  accessibleName: string;
  ariaRole: string;
  ariaLabel?: string;
  tag: string;
  name?: string;
  placeholder?: string;
  
  // Locator candidates (ranked at IR time)
  testId?: string;
  dataCy?: string;
  dataQa?: string;
  stableId?: string;
  cssSelector: string;
  xPath: string;
  
  // Technical metadata
  inputType?: string;
  className?: string;
  
  // Synthetic key
  elementId: string;
  
  // Frame context
  inIframe?: boolean;
  iframeContext?: IframeContext;
  shadowDom?: boolean;
}

interface ElementState {
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

interface EvidenceSummary {
  provider: string;
  suggestedType: InteractionType;
  confidence: number;
  weight: number;
  reason: string;
}

type SemanticAction = 
  | 'configure'      // multi-config panel
  | 'authenticate'   // login/registration
  | 'navigate'       // page navigation
  | 'filter'         // search/filter action
  | 'submit'         // form submission
  | undefined;       // default: no special semantic action

type IntentCategory =
  | 'navigation'
  | 'data_entry'
  | 'selection'
  | 'configuration'
  | 'authentication'
  | 'verification'
  | 'navigation_aux'    // breadcrumb, tab, menu
  | undefined;

interface ElementRelationships {
  parentForm?: string;
  parentPanel?: string;
  relatedTo?: string[];
  opensSurface?: string;
}

interface BehavioralSignature {
  surroundingText?: string[];
  visualPosition?: { x: number; y: number };
  nearbyLandmarks?: string[];
}

interface Assertion {
  type: AssertionType;
  target: string;               // elementId or 'page'
  property: string;             // 'value', 'visible', 'checked', etc.
  expectedValue?: string;
  description: string;
}

type AssertionType = 
  | 'presence'      // element should exist/be visible
  | 'equals'        // value should equal X
  | 'contains'      // value should contain X
  | 'matches'       // value should match regex
  | 'is_true'       // boolean property should be true
  | 'is_false'      // boolean property should be false
  | 'range'         // value should be within min/max
  | 'url_equals'    // page URL should equal X
  | 'url_contains'; // page URL should contain X
```

**Frozen properties:** Field names, types, nullability. These cannot change during implementation without an explicit contract revision.

**Extensible properties:** All `?` (optional) fields and all `Future AI` fields can be added to without breaking the contract.

### 2.3 Lifecycle Definition Format (Frozen)

```typescript
interface LifecycleDefinition {
  type: string;                      // 'dropdown', 'date_picker', etc.
  
  // When to start tracking this interaction
  activation: {
    signals: ActivationSignal[];
    priority: number;                // higher = checked first
    requireNoActiveSession?: boolean; // don't activate if same-type session active
  };
  
  // What events to absorb into the active session
  absorption: {
    eventTypes?: string[];           // 'click', 'scroll', 'input', etc.
    targetMatchers?: TargetMatcher[];
    keywordFilter?: string[];        // accessibleName keywords to absorb
    alwaysAbsorbTypes?: string[];    // PageScroll, Hover, etc.
  };
  
  // When the interaction is complete → emit SemanticInteraction
  completion: {
    signals: CompletionSignal[];
    extractValue?: (session: SessionData) => string;
    extractLabel?: (session: SessionData) => string;
  };
  
  // When to cancel the session without emitting
  cancellation: {
    signals: CancellationSignal[];
  };
  
  timeout: number;                   // ms before forced commit/cancel
  
  // Pluggable handlers for complex logic
  handlers?: {
    onActivate?: (interaction: SemanticInteraction) => void;
    onAbsorb?: (interaction: SemanticInteraction, session: SessionData) => void;
    onComplete?: (session: SessionData) => Partial<SemanticInteraction>;
    onCancel?: (session: SessionData) => SemanticInteraction | null;
    onTimeout?: (session: SessionData) => SemanticInteraction | null;
  };
}

interface ActivationSignal {
  field: string;                     // 'target.identity.ariaRole'
  equals?: string | string[];
  contains?: string | string[];
  matchesRegex?: string;
  minConfidence?: number;
}

interface TargetMatcher {
  field: string;
  equals?: string | string[];
  contains?: string | string[];
  matchesRegex?: string;
}

interface CompletionSignal {
  eventType?: string;
  targetMatcher?: TargetMatcher;
  valueChange?: boolean;
  keywordInLabel?: string[];
}

interface CancellationSignal {
  type: 'navigation' | 'newTab' | 'outsideClick' | 'contextSwitch';
}

interface SessionData {
  sessionId: string;
  componentType: string;
  triggerInteraction: SemanticInteraction;
  absorbed: SemanticInteraction[];
  startTime: string;
  lastEventTime: string;
  // Extensible bag for handler-specific data
  [key: string]: unknown;
}
```

### 2.4 Evidence Provider Interface (Frozen)

```typescript
interface EvidenceProvider {
  name: string;
  
  // Called for each event as it arrives
  onEvent(
    event: CapturedEvent,
    context: SessionContext
  ): Evidence[];
  
  // Called when a session is about to commit
  onCommit(
    session: SessionData
  ): Evidence[];
}

interface Evidence {
  provider: string;
  suggestedType: InteractionType;
  confidence: number;                // 0.0–1.0
  weight: number;                    // 0.0–1.0
  metadata?: Partial<InteractionTarget['identity'] | ElementState>;
  reason: string;
}

interface SessionContext {
  activeSessions: SessionData[];
  recentInteractions: SemanticInteraction[];
  pageUrl: string;
}
```

### 2.5 IR Contract (Frozen)

```typescript
interface ExecutionIRPlan {
  testCaseId: string;
  title: string;
  description?: string;
  tags: string[];
  environment: {
    baseUrl: string;
    browser?: string;
    viewport?: { width: number; height: number };
  };
  steps: IRStep[];
}

interface IRStep {
  id: string;                        // "step-0001"
  order: number;
  action: IRAction;
  description: string;
  target?: ResolvedTarget;
  input?: string;
  assertions?: Assertion[];
  executionParameters?: ExecutionParameters;
}

type IRAction =
  | 'NAVIGATE'
  | 'CLICK'
  | 'FILL'
  | 'SELECT'
  | 'SELECT_DATE'
  | 'TOGGLE'
  | 'HOVER'
  | 'VERIFY'
  | 'WAIT';

interface ResolvedTarget {
  kind: 'element' | 'url' | 'none';
  locators: ResolvedLocator[];       // ranked, top 3 kept
  elementId?: string;
}

interface ResolvedLocator {
  type: LocatorStrategyType;
  value: string;
  priority: number;
  confidence: number;
}

interface ExecutionParameters {
  waitStrategy?: 'immediate' | 'visible' | 'enabled' | 'stable';
  timeoutMs?: number;
  retryCount?: number;
}
```

### 2.6 Success Criteria per Interaction Type (Frozen)

These define what constitutes a correct recording for each interaction type. They serve as acceptance criteria for implementation and as test specifications.

#### Dropdown / Select

| Criterion | Requirement |
|-----------|-------------|
| Trigger click | NOT emitted as standalone interaction |
| Option navigation | Absorbed (scroll, prev/next month, keyword clicks) |
| Option selection | Emitted as single `Select` interaction with `value` = selected option text |
| Label resolution | Field label from trigger element (accessible name, form-group sibling label, placeholder — NOT date-format placeholder) |
| Outside click cancel | If no option selected, trigger passes through as `Click` |
| Native `<select>` | Single interaction with value from change event, no trigger delay |

#### Date Picker / DateSelect

| Criterion | Requirement |
|-----------|-------------|
| Trigger click | NOT emitted as standalone interaction |
| Calendar navigation | Absorbed (prev/next month, year selectors, today button) |
| Date selection | Emitted as single `DateSelect` with ISO value + display value |
| Date format | `variant` = 'date' / 'time' / 'datetime' based on input type |
| Label resolution | Field label from form-group sibling, NOT from `yyyy-mm-dd` placeholder |
| No intermediate states | User navigating months does NOT produce intermediate dateSelect events |

#### Text Entry / Fill

| Criterion | Requirement |
|-----------|-------------|
| Per-keystroke input | NOT emitted (coalesced at capture layer for performance) |
| Focus event | Starts text entry session |
| Blur event | Completes text entry session |
| Final value | Emitted as single `Fill` with committed value |
| Before state | `beforeState.value` captured at focus time |
| Empty entry | If focus → blur with no value change, interaction may be suppressed |

#### Autocomplete (Select variant='autocomplete')

| Criterion | Requirement |
|-----------|-------------|
| Trigger focus/type | NOT emitted as standalone interaction |
| Typing | Absorbed into session |
| Suggestion selection | Emitted as `Select` with `value` = selected suggestion |
| No selection (timeout) | Emitted as `Fill` with typed text (fallback) |

#### Checkbox / Toggle

| Criterion | Requirement |
|-----------|-------------|
| Before state | `beforeState.checked` captured at mousedown |
| After state | `afterState.checked` captured via deferred read |
| Single event | Emitted immediately (no lifecycle needed) |
| Inside MultiConfig | Absorbed as `configuredFields[label] = 'On'/'Off'` |

#### Radio Button / RadioSelect

| Criterion | Requirement |
|-----------|-------------|
| Selection | Emitted immediately with value = selected option |
| Inside MultiConfig | Absorbed as `configuredFields[label] = value` |

#### Multi-Config Panel (semanticAction='configure')

| Criterion | Requirement |
|-----------|-------------|
| Panel trigger | NOT emitted as standalone interaction |
| Field interactions | Absorbed, fields extracted into `configuredFields` |
| Done/Apply/Close | Emitted as single interaction with `semanticAction='configure'` and all configured fields |
| Outside click with fields | Commits the session (same as Done) |
| Outside click without fields | Cancels session, trigger passes through as Click |

#### Form Submit (semanticAction='authenticate')

| Criterion | Requirement |
|-----------|-------------|
| Username/email entry | Emitted normally as `Fill` (not absorbed) |
| Password entry | Activates formSubmit session |
| Submit click | Emitted with `semanticAction='authenticate'` |
| Navigation after submit | Merged with submit click if within 3s (Navigation Lookback) |

#### Navigation / Navigate

| Criterion | Requirement |
|-----------|-------------|
| Full page load | Captured via webNavigation API |
| SPA route change | PLANNED: capture via History API interception (currently a gap) |
| Merge with preceding click | If click → navigation within 3s, merged into single Navigate interaction |
| Consecutive same URL | Deduped (skipped) |
| Transition type | variant: 'page' | 'refresh' | 'forward' | 'back' |

#### Hover

| Criterion | Requirement |
|-----------|-------------|
| Visible change required | CSS `:hover` rule change OR MutationObserver-detected reveal |
| Post-click cooldown | 1.5s suppression after any click |
| Container exclusion | No hover events inside modal/calendar/grid |

#### Scroll

| Criterion | Requirement |
|-----------|-------------|
| Minimum delta | 100px (smaller scrolls ignored) |
| Post-click suppression | 1s after any click |
| Debounce | 200ms coalescing |
| Inside active session | Absorbed as session noise |

#### Click (generic)

| Criterion | Requirement |
|-----------|-------------|
| Container noise | Suppressed if container tag AND name > 80 chars or ≤ 2 chars |
| Label suppression | Suppressed if HTMLLabelElement wrapping a form control |
| Date picker events | Suppressed if inside calendar popover |
| Untrusted events | Rejected |

---

## 3. Implementation Strategy

### 3.1 Component Retention Map

Every component in the current codebase categorized as: **Retain**, **Refactor**, or **Remove**.

#### Retain (Unchanged or Minor Updates)

| Component | Location | Why Retained | Changes Needed |
|-----------|----------|-------------|----------------|
| Service Worker message routing | `service-worker.ts` | Works well | Split into modules later |
| Recording Session storage | `recording-session.ts` | Works well | None |
| Event persistence + restore | `service-worker.ts` | Works well | None |
| Control Model | `v2/control-model.ts` | Superior target resolution | Activate (flip flag) |
| Locator ranking | `domain/locator-ranking.ts` | Well-designed | None |
| IR types | `domain/execution-ir/types.ts` | Clean contract | None |
| Playwright locator renderer | `adapters/playwright/locator-renderer.ts` | Works well | None |
| Playwright action renderer | `adapters/playwright/action-renderer.ts` | Works well | None |
| Playwright assertion renderer | `adapters/playwright/assertion-renderer.ts` | Works well | None |
| Repository V2 persistence | `repository-v2/` | Works well | None |
| Self-healing | `healing/` | Works well | None |
| Execution engine | `execution/` | Works well | None |
| Content script injection + health | `service-worker.ts` | Works well | None |

#### Refactor (Logic Retained, Structure Changed)

| Component | Current Location | Target Location | What Changes |
|-----------|-----------------|----------------|--------------|
| Event listeners (13) | `deterministic-recorder.ts` | `capture/event-listeners.ts` | Extract from monolith |
| Target resolution | `deterministic-recorder.ts` | `capture/target-resolver.ts` | Integrate with Control Model |
| Identity extraction | `deterministic-recorder.ts` | `capture/identity-extractor.ts` | Extract from monolith |
| Context capture | `deterministic-recorder.ts` | `capture/context-capture.ts` | Extract from monolith |
| Value tracker | `deterministic-recorder.ts` | `capture/state-observer.ts` | Rename, keep as performance coalescing |
| Guard rails (30) | `deterministic-recorder.ts` | `engine/filter/guard-rails.ts` | Extract to filter layer |
| Evidence providers (5) | `evidence/providers/*.ts` | `engine/providers/*.ts` | Keep logic, update interface |
| Evidence combination | `evidence/engine.ts:combineEvidence` | `engine/lifecycle/engine.ts` | Merge into lifecycle engine |
| Semantic reasoner logic | `semantic/reasoner.ts` | `engine/lifecycle/definitions/*.ts` | Convert to declarative definitions |
| Semantic detectors | `semantic/detectors.ts` + `panel-form-detectors.ts` | `engine/lifecycle/definitions/*.ts` | Convert to declarative signals |
| IR bridge | `generation/ir-bridge.ts` | `generation/ir-bridge.ts` (same) | Add inline assertion + label generation |
| Assertion generation | `pipeline/enrichment/` | `generation/ir-bridge.ts` | Move inline |
| Capability inference | `pipeline/capability/` | `engine/analysis/capability.ts` | Simplify to function |
| Timeline renderer | `sidepanel/timeline-renderer.ts` | `sidepanel/timeline-renderer.ts` (same) | Update for new types |
| Side panel | `sidepanel/sidepanel.ts` | `sidepanel/sidepanel.ts` (same) | Minor updates |

#### Remove (Dead Code or Fully Replaced)

| Component | Location | Why Removed | Replaced By |
|-----------|----------|------------|------------|
| V1 classifier | `classifier/interaction-detector.ts` | Redundant with V2 | Evidence providers only |
| Merge layer | `classifier/merge/merge-layer.ts` | Nothing to merge | — |
| `dateSelect` synthetic event | `deterministic-recorder.ts` inline | Lifecycle engine handles dates | Lifecycle definition |
| Evidence engine buffers | `evidence/engine.ts` (buffer logic) | Replaced by lifecycle sessions | Lifecycle engine |
| Semantic reasoner (imperative) | `semantic/reasoner.ts` | Replaced by declarative engine | Lifecycle engine + definitions |
| Domain adapter | `pipeline/domain-adapter.ts` | Derivable inline | IR bridge inline computation |
| Recognition pipeline | `pipeline/recognition/` | No DOM access → shallow | Optional future enhancement |
| Enrichment pipeline | `pipeline/enrichment/` (10 modules) | Derivable inline | IR bridge inline computation |
| Capability derivation (4-stage) | `pipeline/capability/` | Over-engineered | Lightweight function |
| Foundation Pipeline (37 files) | `pipeline/` | Absorbed into production | Lifecycle engine + definitions |
| `DefaultIRGenerator` | `domain/execution-ir/generator.ts` | ATC path, unused in recording | — |

### 3.2 Responsibility Redistribution

#### Current State: Responsibilities Scattered

| Responsibility | Where It Lives Today | Problem |
|---------------|---------------------|---------|
| Event capture | deterministic-recorder.ts (3033 lines) | Monolith |
| Pre-classification | deterministic-recorder.ts (inline) | Mixed with capture |
| Lifecycle: date debounce | deterministic-recorder.ts | Capture layer |
| Lifecycle: value tracking | deterministic-recorder.ts | Capture layer |
| Lifecycle: hover detection | deterministic-recorder.ts | Capture layer |
| Classification: V1 | interaction-detector.ts | Parallel to V2 |
| Classification: V2 | evidence/engine.ts | Parallel to V1 |
| Merge | merge-layer.ts | Glue for V1+V2 |
| Lifecycle: components | semantic/reasoner.ts | Third lifecycle layer |
| Understanding | pipeline/ (4 stages) | Over-engineered |
| IR generation | ir-bridge.ts | OK |
| Code generation | adapters/playwright/ | OK |

#### Target State: Clear Ownership

| Responsibility | Owner | Collaborators |
|---------------|-------|---------------|
| Event capture | `capture/event-listeners.ts` | Control Model |
| Target resolution | `capture/target-resolver.ts` | Control Model, Framework Adapters |
| Identity extraction | `capture/identity-extractor.ts` | Framework Adapters |
| State observation | `capture/state-observer.ts` | — |
| Event coalescing | `capture/coalescer.ts` | — |
| Noise filtering | `engine/filter/guard-rails.ts` | — |
| Classification + lifecycle | `engine/lifecycle/engine.ts` | Evidence Providers, Lifecycle Definitions |
| Evidence collection | `engine/providers/*.ts` | — |
| Enrichment (assertions, labels) | `generation/ir-bridge.ts` | — |
| Capability inference | `engine/analysis/capability.ts` | — |
| IR generation | `generation/ir-bridge.ts` | Locator Ranking |
| Code generation | `adapters/playwright/` | — |

**One owner per responsibility. No overlaps.**

### 3.3 Feature Parity Throughout Migration

#### The Golden Recording Approach

Feature parity is validated through **golden recordings** — reference recordings of specific user flows that produce known-correct output.

**Golden recording definition:**

```typescript
interface GoldenRecording {
  name: string;                      // "orangehrm-my-info-full"
  description: string;
  events: CapturedEvent[];           // raw events (serialized, version-controlled)
  expectedInteractions: SemanticInteraction[];  // expected semantic output
  expectedIR: ExecutionIRPlan;       // expected IR
  expectedCode: string;              // expected Playwright code
  appUrl: string;                    // where it was recorded
  recordedAt: string;
  schemaVersion: string;
}
```

**Golden recording library:**

| Recording | App | Covers |
|-----------|-----|--------|
| `orangehrm-login` | OrangeHRM | FormSubmit lifecycle, text entry, navigation merge |
| `orangehrm-my-info-full` | OrangeHRM | Text entry, dropdown (nationality), date picker (DOB), radio, checkbox, container noise suppression, label resolution |
| `orangehrm-employee-search` | OrangeHRM | Autocomplete, search filter, table interaction |
| `adanione-flight-search` | AdaniOne | MultiConfig panel (cabin + passengers), autocomplete (airport), date picker |
| `bootstrap-form` | Generic Bootstrap app | Native dropdown, native date input, checkbox, radio, file upload |
| `mui-dashboard` | Generic MUI app | MUI-specific class patterns, drawer, tabs |
| `antd-table` | Generic AntD app | AntD select, table sorting, pagination |
| `simple-click-flow` | Basic HTML page | Links, buttons, navigation, scroll |
| `drag-drop` | Drag-drop demo | DragDrop lifecycle |

**How golden recordings validate parity:**

1. Before each migration phase, run all golden recordings through the current pipeline. Capture the output as the "baseline."
2. Make the migration change.
3. Run all golden recordings through the updated pipeline.
4. Compare output to baseline.
5. Any difference is either:
   - An **intentional change** (documented in the phase spec) — update the golden recording
   - An **unintentional regression** — fix it before proceeding

This is differential testing. It catches regressions automatically.

**Beyond golden recordings:**

Golden recordings are the safety net. But they only cover known scenarios. To catch unknown regressions:

- Run the full existing test suite (3800+ tests) at every phase
- Record fresh sessions on OrangeHRM + AdaniOne after each phase
- Compare interaction counts, types, and values between phases

### 3.4 Migration Phases (Revised)

The phases from `SIMPLIFICATION_JUSTIFICATION.md` are preserved, but now build on the frozen contracts.

#### Phase 0: Architecture Freeze (No Code Changes)

- Write all frozen contracts (§2 above) as TypeScript interfaces
- Write golden recording infrastructure
- Capture 5-10 golden recordings from real apps
- Write success criteria as executable tests
- All team members review and approve the contracts

**Exit criteria:** Contracts frozen, golden recordings captured, all stakeholders agree.

#### Phase 1: Extract Guard Rails (Low Risk)

**What:** Move guard rails from capture monolith to filter layer.

**Files changed:**
- Create `engine/filter/guard-rails.ts` — move `isContainerNoiseClick()`, `isDateFormatPlaceholder()`, `isDateTriggerElement()`, `isCalendarCell()`, `isInsideCalendarPopover()`, `isTextEntryElement()`
- Modify `deterministic-recorder.ts` — call filter functions instead of inline checks
- No pipeline structure changes

**Feature parity:** Guard rails run at the same point in the flow (between capture and classification). Identical behavior.

**Validation:** Golden recordings produce identical output. Full test suite passes.

**Exit criteria:** All golden recordings match baseline. 3800+ tests pass.

#### Phase 2: Remove V1 + Merge Layer (Low Risk)

**What:** Fix V2 gaps, then remove V1 classifier and merge layer.

**Prerequisite:** V2 gap analysis (record on OrangeHRM, AdaniOne, standard apps; identify V1-only patterns).

**Files changed:**
- Fix V2: Add navigation subtype detection to EventSequenceProvider (~5 lines). Add menuitem→Menu to AriaProvider or CssClassnameProvider (~3 lines).
- Add feature flag: `classificationEngine: 'v2-only' | 'v1v2-merged'` (default: 'v1v2-merged')
- Test with 'v2-only' mode against golden recordings
- When confident: remove `interaction-detector.ts`, `merge-layer.ts`, the merge step in service-worker.ts
- Remove the feature flag

**Feature parity:** V2-only must produce identical (or better) output to V1+V2+merge.

**Validation:** V2-only golden recordings match or improve baseline. Differential test: V2-only vs V1+V2 on 5+ real app recordings.

**Exit criteria:** V2-only output ≥ V1+V2 output quality on all golden recordings. V1 + merge removed.

#### Phase 3: Unify Lifecycle into Single Engine (Medium Risk)

**What:** Replace evidence engine buffers + semantic reasoner with a single lifecycle engine driven by declarative definitions.

**This is the keystone phase.** It's the highest-value and highest-risk change.

**Sub-steps:**

3a. **Port lifecycle definitions.** Convert each component type's activation/absorption/completion/cancellation logic from imperative code (reasoner.ts + detectors.ts + panel-form-detectors.ts) into declarative LifecycleDefinition objects.

3b. **Wire lifecycle engine.** Connect the Foundation Pipeline's lifecycle engine (or a new implementation) to process the interaction stream using the definitions + evidence providers.

3c. **Port complex handlers.** Move MultiConfig field extraction and FormSubmit enrichment into pluggable handler functions.

3d. **Remove date debounce.** Stop creating `dateSelect` synthetic events. Send raw change/click events for date inputs. The lifecycle engine's date_picker definition handles grouping.

3e. **Feature flag:** `lifecycleEngine: 'unified' | 'legacy'` (default: 'legacy'). Test with 'unified'.

3f. **When confident:** Remove evidence engine buffers, semantic reasoner, detectors. Remove the feature flag.

**Feature parity:** The unified lifecycle engine must produce identical semantic interactions for all 5 component types.

**Validation:**
- Component-aware-reasoning tests (24 tests) must pass
- Golden recordings must match or improve baseline
- Special focus on date pickers (date debounce removal is the riskiest change)
- Record fresh sessions on OrangeHRM (nationality dropdown, DOB picker) and AdaniOne (flight options panel)

**Risk mitigation:**
- Feature flag allows instant rollback
- Date debounce: if lifecycle engine can't handle raw date events cleanly, keep the debounce in capture as a performance optimization (not ideal, but safe)
- Pluggable handlers mean complex logic is isolated and testable

**Exit criteria:** All golden recordings match or improve baseline. Component lifecycle tests pass. No `dateSelect` synthetic events in the codebase.

#### Phase 4: Collapse Domain Pipeline (Low Risk)

**What:** Move assertion generation and label resolution inline into IR bridge. Simplify capability inference to a function.

**Files changed:**
- Add assertion generation to `ir-bridge.ts` (from before/after states in interactions)
- Add label resolution to `ir-bridge.ts` (from accessibleName/placeholder in interactions)
- Create `engine/analysis/capability.ts` — lightweight capability inference function
- Remove domain adapter, recognition pipeline, enrichment modules from the pipeline call chain
- Keep modules as library code (not deleted, just not called)

**Feature parity:** IR output must be identical or improved.

**Validation:** Golden recordings produce identical IR. Full test suite passes.

**Exit criteria:** IR output matches baseline. Domain pipeline stages removed from active call chain.

#### Phase 5: Consolidate Interaction Types (Low Risk)

**What:** Reduce 38 types to 19 with variant qualifiers.

**Files changed:**
- Update InteractionType union (frozen contract from Phase 0)
- Update evidence providers to emit consolidated types
- Update lifecycle definitions to use consolidated types
- Update IR bridge mapping
- Update code generator (locator/action renderers)
- Update timeline renderer
- Update all tests

**Feature parity:** Generated Playwright code must be identical.

**Validation:** Golden recordings produce identical code. Full test suite passes.

**Exit criteria:** 19 types in use. Generated code unchanged.

#### Phase 6: Activate Control Model (Medium Risk)

**What:** Flip `recorderEngine` to `'control'` for superior target resolution.

**Files changed:**
- Integrate Control Model with evidence providers
- Comprehensive testing on real apps
- Keep heuristic cascade as fallback initially

**Feature parity:** Target resolution accuracy must be ≥ heuristic cascade.

**Validation:** Golden recordings match or improve. Fresh recordings on 5+ real apps.

**Exit criteria:** Control Model active, heuristic cascade as fallback. Accuracy ≥ baseline.

#### Phase 7: Archive Foundation Pipeline (Low Risk)

**What:** After lifecycle engine is wired and validated, archive absorbed Foundation Pipeline files.

**Files changed:**
- Move any remaining useful components to production locations
- Archive `src/pipeline/`

**Validation:** No behavior change. Codebase size reduction.

**Exit criteria:** `src/pipeline/` archived. No dormant parallel architecture.

#### Phase 8: Framework Adapters (Low Risk)

**What:** Extract scattered framework logic into pluggable adapters.

**Files changed:**
- Create adapter interface
- Extract OXD logic into `OXDAdapter`
- Extract MUI/AntD/Bootstrap into adapters
- Register in central registry

**Validation:** Full test suite passes. Same behavior.

**Exit criteria:** Framework logic centralized. Adding a framework = adding one adapter.

### 3.5 Validation Strategy Summary

| Validation Method | When | What It Catches |
|-------------------|------|-----------------|
| Golden recording differential | Every phase | Output regressions |
| Full test suite (3800+) | Every phase | Unit-level regressions |
| Fresh app recordings | Phases 2, 3, 6 | Real-world accuracy |
| Component lifecycle tests (24) | Phase 3 | Lifecycle behavior |
| Playwright code comparison | Phases 5 | Code generation parity |
| Manual OrangeHRM + AdaniOne test | Phases 2, 3, 6 | User-visible behavior |

---

## 4. Risk Analysis & Mitigation

### Risk Matrix

| # | Risk | Probability | Impact | Phase | Mitigation |
|---|------|------------|--------|-------|-----------|
| R1 | V2 has blind spots V1 catches | Medium | High | Phase 2 | Comprehensive gap analysis before removal. Feature flag for rollback. |
| R2 | Lifecycle engine can't handle date picker events without debounce | Medium | High | Phase 3 | Keep debounce in capture as fallback. Test extensively on OrangeHRM DOB. |
| R3 | Declaring lifecycle definitions can't express all current logic | Low | Medium | Phase 3 | Pluggable handlers for complex cases (MultiConfig, FormSubmit). |
| R4 | Control Model produces different target resolution than heuristic | Medium | Medium | Phase 6 | Keep heuristic as fallback. Extensive testing on 5+ apps. |
| R5 | Interaction type consolidation breaks code generation | Low | Medium | Phase 5 | Golden recording code comparison. Playwright output must be byte-identical. |
| R6 | Migration takes too long; interim state is worse than current | Medium | Low | All | Feature flags allow instant rollback at every phase. Each phase is independently deployable. |
| R7 | Frozen contracts need revision mid-migration | Low | High | All | Contracts are designed for extensibility (optional fields, pluggable handlers). Only a fundamental design error would require contract revision. |
| R8 | Performance regression from moving logic downstream | Low | Medium | Phase 3 | Event coalescing stays in capture layer. Net message count unchanged. |

### The Biggest Risk: Phase 3 (Lifecycle Unification)

Phase 3 is the keystone — highest value, highest risk. The specific dangers:

1. **Date picker without debounce:** Today the capture layer waits 800ms after the last date change before emitting a `dateSelect`. In the unified model, the lifecycle engine sees raw change events and must decide when the date picker is "complete." If the completion signal (gridcell click) is missed, the session hangs until timeout.

   **Mitigation:** The date_picker lifecycle definition has BOTH completion signals (gridcell click AND change-with-value). If either fires, the session completes. The 15s timeout is the safety net.

2. **Buffer→session transition:** The evidence engine's `isRelatedToBuffer()` detects relationships between events (trigger↔option). The lifecycle engine's absorption logic must replicate this. If absorption rules are too loose, unrelated events get absorbed. If too strict, related events leak through.

   **Mitigation:** Convert `isRelatedToBuffer()` patterns directly into lifecycle absorption definitions. Test with the 24 component-aware-reasoning tests.

3. **Regression in semantic output quality:** The semantic reasoner currently produces high-quality merged interactions. If the lifecycle engine produces different (lower-quality) output, recordings degrade.

   **Mitigation:** Feature flag. Run both engines in parallel during Phase 3 testing. Compare outputs.

---

## 5. Completion Criteria

### When Is the Migration Complete?

The migration is complete when ALL of the following are true:

#### Objective Criteria

| # | Criterion | Measurable How |
|---|-----------|---------------|
| C1 | One classifier (V2 only, no V1, no merge) | Codebase grep: no `interaction-detector.ts`, no `merge-layer.ts` |
| C2 | One lifecycle engine (no evidence buffers, no semantic reasoner) | Codebase grep: no `evidence/engine.ts` buffer logic, no `semantic/reasoner.ts` |
| C3 | No `dateSelect` synthetic events | Codebase grep: no `dateSelect` in recorder |
| C4 | 19 interaction types (not 38) | Type definition count |
| C5 | Domain pipeline not in active call chain | Service worker: no `runPipeline()` call |
| C6 | Foundation Pipeline archived or absorbed | No `src/pipeline/` directory (or marked deprecated) |
| C7 | Capture layer < 500 lines | Line count of capture module |
| C8 | Guard rails in filter layer | `engine/filter/guard-rails.ts` exists, capture layer has no inline classification |
| C9 | Framework logic centralized | Framework adapter registry exists, no OXD/MUI logic in capture layer |
| C10 | All golden recordings pass | Differential test: output matches or improves baseline |

#### Quality Criteria

| # | Criterion | Measurable How |
|---|-----------|---------------|
| Q1 | No classification regression | V2-only output quality ≥ V1+V2 on 10+ real app recordings |
| Q2 | No lifecycle regression | Component tests (24) pass. Date picker, dropdown, autocomplete, multiConfig, formSubmit all produce correct output on OrangeHRM + AdaniOne |
| Q3 | No code generation regression | Generated Playwright code byte-identical to pre-migration for golden recordings |
| Q4 | Full test suite passes | 3800+ tests green (excluding pre-existing flaky tests) |
| Q5 | No hardcoded framework logic outside adapters | Grep for OXD/MUI/AntD patterns in capture/engine modules |

#### Architecture Health Criteria

| # | Criterion | Measurable How |
|---|-----------|---------------|
| A1 | 3 pipeline stages (not 8) | Pipeline call chain in service worker |
| A2 | 3 intermediate models in critical path | CapturedEvent, SemanticInteraction, IRStep only |
| A3 | One owner per responsibility | Responsibility map (§3.2) — no overlaps |
| A4 | Declarative lifecycle definitions | Adding a component type = adding a definition file, no engine code changes |
| A5 | Frozen contracts unchanged | Phase 0 contracts still valid at completion |

### Definition of Done

The migration is declared complete when:
1. All Objective Criteria (C1–C10) are met
2. All Quality Criteria (Q1–Q5) are met
3. All Architecture Health Criteria (A1–A5) are met
4. At least 3 team members have reviewed and approved
5. The architecture document (`CMDRECORDER_ARCHITECTURE.md`) is updated to reflect the final state

---

## Summary

### Future-Proofing: Confident

The proposed architecture supports all stated future capabilities. The three additions to SemanticInteraction (intentCategory, relationships, behavioralSignature) enable AI reasoning without architectural changes. Cross-domain expansion (mobile/API/desktop) is supported by the domain-agnostic 3-stage model.

### Architecture Freeze: Defined

Six frozen contracts: interaction taxonomy (19 types), SemanticInteraction schema, lifecycle definition format, evidence provider interface, IR contract, and success criteria per interaction type. These provide the stable foundation for implementation.

### Implementation Strategy: Controlled & Verifiable

9 phases (0–8), each independently deployable with feature flags. Golden recording differential testing at every phase. The keystone phase (Phase 3: lifecycle unification) carries the most risk but also the most value. Feature flags allow instant rollback at every step.

### The Honest Bottom Line

This migration is not a rewrite — it's a series of extractions, consolidations, and removals that each make the system simpler while preserving behavior. The riskiest change (Phase 3) has comprehensive mitigations (feature flags, golden recordings, parallel testing). The safest changes (Phases 1, 4, 5) can proceed immediately after the Architecture Freeze.

The frozen contracts ensure that implementation never drifts from the agreed design. The golden recordings ensure that behavior never regresses. The feature flags ensure that any phase can be rolled back instantly.

**The question is not whether this architecture is achievable — it is. The question is whether to start with Phase 0 (Architecture Freeze) now.**

---

*This document defines the frozen contracts and implementation strategy. No code has been modified.*

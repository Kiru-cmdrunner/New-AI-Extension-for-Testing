# Phase 2 — Engineering Specifications

**Status:** Engineering specification — no implementation  
**Date:** 2026-07-17  
**Scope:** Complete engineering contracts (M9), processing logic (M10), and runtime behaviour (M11) for CmdRunner  
**Constraint:** Preserve all frozen architecture, AI philosophy, semantic interaction language, component specs. Implementation-level specifications only.

---

## Document Structure

This document contains three milestones:

- **Milestone 9** — Data Models & Interface Contracts (§1–§7)
- **Milestone 10** — Algorithms & Decision Logic (§8–§14)
- **Milestone 11** — Runtime Behaviour (§15–§22)
- **Cross-Phase Engineering Review** (§23–§24)

---

# MILESTONE 9 — DATA MODELS & INTERFACE CONTRACTS

## 1. Data Model Catalogue

The following 42 shared objects are exchanged between CmdRunner components. They are organized by layer and tagged with ownership, lifecycle zone, and persistence.

### 1.1 Object index

| # | Object | Layer | Owner (Writer) | Zone | Persisted? |
|---|--------|-------|----------------|------|:----------:|
| | **RECORDING** | | | | |
| R1 | `BrowserEvent` | Recording | Browser (DOM) | Ephemeral | ❌ |
| R2 | `RawElementIdentity` | Recording | DOM Snapshot Manager | Transient | ❌ |
| R3 | `ElementIdentity` | Recording | Event Pipeline | Transient→Permanent | ✅ |
| R4 | `SessionEvent` | Recording | Event Pipeline | Transient→Permanent | ✅ |
| R5 | `ScreenshotMetadata` | Recording | Screenshot Manager | Transient→Permanent | ✅ |
| R6 | `RecordingContext` | Recording | Event Pipeline | Transient→Permanent | ✅ |
| R7 | `RecorderActionInfo` | Recording | Recorder | Transient | ❌ |
| | **CONTEXT** | | | | |
| C1 | `SessionContext` | Context | Session Context Manager | Transient | ❌ |
| C2 | `DeterministicState` (L1) | Context | State Tracker | Transient | ❌ |
| C3 | `MentalModel` (L2) | Context | AI Observer | Transient | ❌ |
| C4 | `ContextUpdate` | Context | State Tracker / AI Observer | Transient | ❌ |
| C5 | `WorkflowContext` | Context | Workflow Analyzer | Transient | ❌ |
| | **INTELLIGENCE** | | | | |
| I1 | `ActionElementInfo` | Intelligence | Event Pipeline | Transient | ❌ |
| I2 | `AIUnderstanding` | Intelligence | AI Observer | Transient | ❌ |
| I3 | `ClassifiedInteraction` | Intelligence | Stage 3a Classifier | Transient→Permanent | ✅ (in Step) |
| I4 | `ClassificationEvidence` | Intelligence | Stage 3a Classifier | Transient | ❌ |
| I5 | `ConfidenceState` | Intelligence | Confidence Engine | Transient (in L2) | ❌ |
| I6 | `WorkflowHypothesis` | Intelligence | Workflow Analyzer | Transient (in L2) | ❌ |
| I7 | `CanonicalStep` (pre-JSON) | Intelligence | Stage 3b Generator | Transient→Permanent | ✅ |
| | **EXECUTION** | | | | |
| E1 | `ExecutionJsonObject` | Execution | Execution JSON Generator | Permanent | ✅ |
| E2 | `ExecutionAction` | Execution | Execution JSON Generator | Permanent | ✅ (in E1) |
| E3 | `ExecutionTarget` | Execution | Execution JSON Generator | Permanent | ✅ (in E1) |
| E4 | `ExecutionLocator` | Execution | Locator Resolution Engine | Permanent | ✅ (in E1) |
| E5 | `ExecutionContext` | Execution | Execution JSON Generator | Permanent | ✅ (in E1) |
| E6 | `ExecutionTrace` | Execution | Execution JSON Generator | Permanent | ✅ (in E1) |
| E7 | `ExecutionMeta` | Execution | Execution JSON Generator | Permanent | ✅ (in E1) |
| E8 | `TestStep` | Execution | Stage 3b + Stage 4 | Permanent | ✅ |
| E9 | `GenerationResult` | Execution | Generation Engine | Transient | ❌ |
| | **REVIEW** | | | | |
| V1 | `ReviewItem` | Review | Review Engine | Permanent | ✅ |
| V2 | `ValidationResult` | Review | Validation Engine | Transient | ❌ |
| V3 | `EvidenceBundle` | Review | Evidence Manager | Transient | ❌ |
| V4 | `RepositoryTestCase` | Review | Approval Manager | Permanent | ✅ |
| | **INFRASTRUCTURE** | | | | |
| F1 | `UIState` | Infrastructure | Event Pipeline | Permanent | ✅ |
| F2 | `TestCaseDraft` | Infrastructure | Event Pipeline / Review | Permanent | ✅ |
| F3 | `AIConfig` | Infrastructure | Configuration Manager | Permanent | ✅ |
| F4 | `ProviderSettings` | Infrastructure | Configuration Manager | Permanent | ✅ (in F3) |
| F5 | `AuditEvent` | Infrastructure | Audit Manager | Permanent | ✅ |
| F6 | `LogEntry` | Infrastructure | Logging Manager | Transient | ❌ (console) |
| F7 | `ErrorObject` | Infrastructure | Any component | Transient | ❌ |
| F8 | `TestRepository` | Infrastructure | Approval Manager | Permanent | ✅ |

### 1.2 Object dependency graph (simplified)

```
BrowserEvent → RawElementIdentity → ElementIdentity → SessionEvent → ClassifiedInteraction
                                                                          ↓
                                                              CanonicalStep → TestStep
                                                                                ↓
                                                       ExecutionJsonObject → Playwright Code
```

---

## 2. Recording Layer Data Models

### R1. BrowserEvent

**Purpose:** The raw browser DOM event captured by a content script listener. This is the most ephemeral object — it exists only during event handler execution.

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `type` | `string` | ✅ | One of: click, mousedown, change, blur, input, mouseenter, mouseover, submit | — |
| `target` | `HTMLElement` | ✅ | Must be attached to DOM (`isConnected`) | — |
| `isTrusted` | `boolean` | ✅ | Must be `true` (Gate 1 rejects synthetic) | — |
| `timeStamp` | `number` | ✅ | Positive number (ms since navigation) | — |
| `bubbles` | `boolean` | ✅ | — | — |
| `composed` | `boolean` | ✅ | Indicates Shadow DOM crossing | `false` |
| `defaultPrevented` | `boolean` | ✅ | If true, page handler called preventDefault | `false` |

**Ownership:** Browser → Browser Event Collector (read-only)  
**Consumers:** Browser Event Collector routes to specialized recorders  
**Lifecycle:** Ephemeral. GC'd after handler returns. Never persisted.  
**Serialization:** Not serialized. In-process DOM object only.  
**Versioning:** N/A (browser standard).  
**Interface contract:** Producer = Browser DOM. Consumer = Browser Event Collector. No guarantees beyond handler scope.

### R2. RawElementIdentity

**Purpose:** The complete DOM-derived identity of an interaction target element, extracted before any processing. This is the raw material for locator resolution and AI understanding.

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `tag` | `string` | ✅ | Non-empty, lowercase HTML tag name | — |
| `accessibleName` | `string` | ✅ | May be empty string | `""` |
| `ariaRole` | `string \| null` | ✅ | Must be valid ARIA role or null | `null` |
| `ariaLabel` | `string \| null` | ❌ | — | `null` |
| `ariaLabelledBy` | `string \| null` | ❌ | Must reference existing element ID | `null` |
| `placeholder` | `string \| null` | ❌ | — | `null` |
| `className` | `string \| null` | ❌ | Space-joined class list | `null` |
| `name` | `string \| null` | ❌ | HTML `name` attribute | `null` |
| `stableId` | `string \| null` | ❌ | HTML `id` attribute | `null` |
| `testId` | `string \| null` | ❌ | `data-testid` or `data-test` | `null` |
| `dataCy` | `string \| null` | ❌ | `data-cy` attribute | `null` |
| `dataQa` | `string \| null` | ❌ | `data-qa` attribute | `null` |
| `cssSelector` | `string \| null` | ❌ | Unique CSS selector for element | `null` |
| `xPath` | `string \| null` | ❌ | XPath expression | `null` |
| `inIframe` | `boolean` | ✅ | — | `false` |
| `shadowDom` | `boolean` | ✅ | — | `false` |
| `iframeContext` | `IframeContext \| null` | ❌ | Required if `inIframe = true` | `null` |

**IframeContext sub-object:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `frameSrc` | `string` | ✅ | iframe's src URL |
| `frameName` | `string \| null` | ❌ | iframe's name attribute |
| `frameId` | `string \| null` | ❌ | iframe element's id |
| `frameSelector` | `string \| null` | ❌ | CSS selector to reach iframe in parent |
| `frameXPath` | `string \| null` | ❌ | XPath to reach iframe in parent |
| `frameIndex` | `number` | ✅ | iframe's position among siblings (0-based) |
| `frameDepth` | `number` | ✅ | Nesting depth (0 = top-level iframe) |

**Ownership:** Writer = DOM Snapshot Manager. Consumers = Recorder, Event Pipeline.  
**Lifecycle:** Transient. Created per interaction. Not persisted independently (embedded in SessionEvent).  
**Serialization:** JSON-serializable (plain object). Transported via `chrome.runtime.sendMessage`.  
**Versioning:** Additive only. New fields can be added; existing fields never removed or renamed (implicit contract — all recorders depend on these 18 fields).  
**Interface contract:** Producer = DOM Snapshot Manager. Consumer = Recorder (5-Gate), Event Pipeline (persist as ElementIdentity). Output guarantee: all 18 fields populated (null if absent).

### R3. ElementIdentity

**Purpose:** RawElementIdentity after the Event Pipeline has assigned a unique `elementId`. This is the persisted form.

```
ElementIdentity = RawElementIdentity + { elementId: string }
```

| Additional Field | Type | Required | Validation | Default |
|------------------|------|:--------:|------------|---------|
| `elementId` | `string` | ✅ | Format: `elem-NNNN` (sequential) | — |

**Ownership:** Writer = Event Pipeline. Consumers = all downstream stages.  
**Lifecycle:** Crosses Transient→Permanent boundary (persisted in SessionEvent). Immutable after creation.  
**Versioning:** Same as RawElementIdentity (additive). elementId format stable.

### R4. SessionEvent (the Timeline entry)

**Purpose:** The fundamental recorded unit. Each SessionEvent represents one meaningful user interaction appended to the Timeline. This is the B3 immutable record.

**Discriminated union by `type` field:**

| Type | Interface | Additional Fields |
|------|-----------|-------------------|
| `'navigation'` | `NavigationEvent` | `url: string`, `title: string` |
| `'click'` | `ClickEvent` | `elementIdentity: ElementIdentity` |
| `'text'` | `TextEntryEvent` | `elementIdentity: ElementIdentity`, `value: string` |
| `'hover'` | `HoverEvent` | `elementIdentity: ElementIdentity` |
| `'checkbox'` | `CheckboxEvent` | `elementIdentity: ElementIdentity`, `checked: boolean` |
| `'radio'` | `RadioEvent` | `elementIdentity: ElementIdentity` |
| `'select'` | `SelectEvent` | `elementIdentity: ElementIdentity`, `value: string` |
| `'dateSelect'` | `DateSelectEvent` | `elementIdentity: ElementIdentity`, `dateType: DateSelectSubType`, `displayValue: string`, `isoValue: string`, optional range fields |

**Common fields (all types):**

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `actionId` | `string` | ✅ | Format: `{type}-NNNN` (e.g., `click-0001`) | — |
| `type` | `string` | ✅ | One of the 8 types above | — |
| `timestamp` | `string` | ✅ | ISO 8601 | — |

**DateSelectSubType:** `'date' | 'dateRange' | 'time' | 'dateTime' | 'month' | 'week'`

**Ownership:** Writer = Event Pipeline (sole appender). B3 invariant: NEVER modified after creation.  
**Consumers:** AI Observer (reads for context), Stage 3a (reads for classification), Stage 3b (reads for step generation), Review (reads for evidence).  
**Lifecycle:** Created in Event Pipeline → persisted to `chrome.storage.local` (SESSION_EVENTS) → crosses to Permanent → consumed by Generation Engine → persisted in RepositoryTestCase.  
**Serialization:** JSON. Stored as `SessionEvent[]` array in chrome.storage.local.  
**Versioning:** Additive. New event types can be added to the union. New optional fields on existing types are backward-compatible. Existing type values never change (frozen by C3-C6 milestones).  
**Interface contract:** Producer = Event Pipeline. Guarantees: unique actionId, sequential order, immutable after creation. Consumer guarantee: read-only access, never modify.

### R5. ScreenshotMetadata

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `screenshotId` | `string` | ✅ | Format: `shot-NNNN` | — |
| `timestamp` | `string` | ✅ | ISO 8601 | — |
| `actionId` | `string` | ✅ | Must reference existing SessionEvent | — |
| `elementId` | `string \| null` | ✅ | null for navigation events | `null` |
| `actionType` | `string` | ✅ | The event type (click, text, etc.) | — |
| `dataUrl` | `string` | ✅ | Base64-encoded PNG data URL, < 500KB | — |

**Ownership:** Writer = Screenshot Manager. Sole owner.  
**Lifecycle:** Created async after action → persisted → crosses to Permanent → consumed by Evidence Manager during review.  
**Serialization:** JSON. Stored as `ScreenshotMetadata[]` in chrome.storage.local (SCREENSHOTS key). dataUrl is base64 PNG.  
**Versioning:** Additive. Future: video clip reference, region coordinates.  
**Interface contract:** Producer = Screenshot Manager. Guarantee: linked to valid actionId. Non-blocking (capture failure does not affect recording).

### R6. RecordingContext

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `startUrl` | `string` | ✅ | Valid URL | — |
| `startTitle` | `string` | ✅ | Page title at recording start | — |
| `capturedAt` | `string` | ✅ | ISO 8601 | — |

**Ownership:** Writer = Event Pipeline (captured once on START_RECORDING). Immutable after capture.  
**Lifecycle:** Transient→Permanent. Persisted to chrome.storage.local.  
**Interface contract:** Producer = Event Pipeline (on START_RECORDING). Guarantee: captured before any events; never replaced.

### R7. RecorderActionInfo

**Purpose:** The semantic snapshot sent to the AI Observer. Stripped of all DOM-specific data (no CSS selectors, XPath). Contains only semantic information.

| Field | Type | Required | Validation |
|-------|------|:--------:|------------|
| `actionType` | `string` | ✅ | The capture-time event type |
| `text` | `string` | ✅ | Accessible name of the element |
| `tag` | `string` | ✅ | HTML tag name |
| `role` | `string \| null` | ✅ | ARIA role |
| `className` | `string \| null` | ✅ | CSS classes (for icon/icon-library detection) |

**Ownership:** Writer = Event Pipeline (constructs from SessionEvent). Consumer = AI Observer.  
**Lifecycle:** Transient. Created per action, consumed immediately by AI Observer.  
**Interface contract:** L10 DOM-agnostic: NO cssSelector, xPath, or elementId sent to AI. Only semantic fields.

---

## 3. Context Layer Data Models

### C1. SessionContext

**Purpose:** The 3-layer container that holds all recording-session state.

```
SessionContext = {
  layer1: DeterministicState,    // L1 — State Tracker writes
  layer2: MentalModel | null,    // L2 — AI Observer writes
  layer3: SessionEvent[],        // L3 — Event Pipeline appends
}
```

**Ownership:** Container = Session Context Manager. Each layer has its own sole writer (TS3).  
**Lifecycle:** Created on START_RECORDING. Discarded on STOP_RECORDING (L1, L2). L3 persists.  
**Serialization:** Not serialized as a whole. L1/L2 are in-memory only. L3 persisted separately.  
**Interface contract:** Readers receive deep copies (cannot mutate originals). Single-writer enforcement per layer.

### C2. DeterministicState (L1)

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `currentUrl` | `string` | ✅ | Current page URL |
| `pageTitle` | `string` | ✅ | Current page title |
| `openDialogs` | `ElementDescriptor[]` | ✅ | Currently open modals/dialogs |
| `openDropdowns` | `ElementDescriptor[]` | ✅ | Currently expanded dropdowns |
| `activeForm` | `ElementDescriptor \| null` | ✅ | Form containing current focus |
| `activeElement` | `ElementDescriptor \| null` | ✅ | Currently focused element |

**ElementDescriptor:**

| Field | Type | Required |
|-------|------|:--------:|
| `tag` | `string` | ✅ |
| `role` | `string \| null` | ✅ |
| `accessibleName` | `string` | ✅ |
| `className` | `string \| null` | ✅ |

**Ownership:** Sole writer = State Tracker.  
**Lifecycle:** Transient (in-memory). Updated on each DOM mutation. Lost on SW restart.

### C3. MentalModel (L2)

**Purpose:** AI-derived understanding of the recording session. Structure defined by AI Observer Architecture; reasoning behavior defined by AI Philosophy.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `appIdentity` | `Hypothesis \| null` | ✅ | What application is being used |
| `workflow` | `WorkflowHypothesis \| null` | ✅ | Current workflow being executed |
| `currentFocus` | `Hypothesis \| null` | ✅ | Which UI component is active |
| `userIntent` | `Hypothesis \| null` | ✅ | What the user appears to be doing |
| `recentChange` | `ChangeAnalysis \| null` | ✅ | What changed after the last action |
| `confidence` | `ConfidenceState` | ✅ | Multi-track confidence scores |
| `lastUpdated` | `string` | ✅ | ISO timestamp of last AI update |

**Hypothesis:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `primary` | `string` | ✅ | Best guess |
| `confidence` | `number` | ✅ | 0.05–0.95 (P5 bounds) |
| `evidence` | `string[]` | ✅ | Action IDs supporting this hypothesis (P6 citation) |
| `alternatives` | `{ value: string, confidence: number }[]` | ✅ | Competing hypotheses (P4 max 3) |

**Ownership:** Sole writer = AI Observer.  
**Lifecycle:** Transient. Created on first AI observation. Updated per interaction. Consumed by Stage 3a (advisory) and Stage 3b (naming). Discarded after STOP_RECORDING.  
**Versioning:** Structure frozen by AI Observer Architecture. Behavioral evolution (reasoning questions, confidence algorithms) deferred to AI Philosophy — but the data STRUCTURE is stable.

### C4. ContextUpdate

**Purpose:** A delta notification when Session Context changes. Used for efficient consumer notification.

| Field | Type | Required |
|-------|------|:--------:|
| `layer` | `'L1' \| 'L2' \| 'L3'` | ✅ |
| `changeType` | `'create' \| 'update' \| 'append'` | ✅ |
| `timestamp` | `string` | ✅ |

**Ownership:** Produced by whichever component wrote to the layer. Consumed by anyone subscribed to context changes.

### C5. WorkflowContext

**Purpose:** Subset of MentalModel focused on workflow progression.

```
WorkflowContext = WorkflowHypothesis (see I6 below)
```

---

## 4. Intelligence Layer Data Models

### I1. ActionElementInfo

*(Same as R7. RecorderActionInfo — the semantic snapshot for AI. Documented in Recording section as R7 since it's constructed by the Event Pipeline.)*

### I2. AIUnderstanding

**Purpose:** The normalized AI response after parsing. This is what the AI Observer extracts from the provider's raw response.

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `businessName` | `string` | ✅ | Non-empty human-readable name | — |
| `controlType` | `string` | ✅ | Element type (button, link, field, etc.) | — |
| `userIntent` | `string` | ✅ | What the user is trying to do | — |
| `confidenceScore` | `number` | ✅ | Clamped to [0.0, 1.0] | — |

**Ownership:** Writer = AI Observer (after parsing provider response). Consumer = Mental Model (merged into L2).  
**Lifecycle:** Transient. Created per AI invocation. Merged into Mental Model.  
**Interface contract:** Output guarantee: confidenceScore always in [0, 1] (P5 enforcement at parse time).

### I3. ClassifiedInteraction

**Purpose:** A Timeline action classified into one of the 10 canonical types by Stage 3a.

| Field | Type | Required | Validation |
|-------|------|:--------:|------------|
| `canonicalType` | `CanonicalType` | ✅ | One of 10 types (L1) |
| `actionId` | `string` | ✅ | References source SessionEvent |
| `originalEvent` | `SessionEvent` | ✅ | The raw event |
| `classificationTier` | `1 \| 2 \| 3` | ✅ | Which tier made the decision |
| `evidence` | `string` | ✅ | Human-readable classification reason |

**CanonicalType:** `'navigate' | 'click' | 'fill' | 'select' | 'toggle' | 'selectDate' | 'hover' | 'pressKey' | 'upload' | 'drag'`

**Ownership:** Writer = Stage 3a Classifier. Immutable after assignment (L6).  
**Lifecycle:** Transient→Permanent. Created during generation, embedded in TestStep.  
**Interface contract:** Producer = Stage 3a. Guarantee: every action gets exactly one canonicalType (L5 default click). Immutable (L6).

### I4. ClassificationEvidence

**Purpose:** Structured evidence trail for why an interaction was classified as a specific type. Supports debugging and review.

| Field | Type | Required |
|-------|------|:--------:|
| `ruleId` | `string` | ✅ |
| `ruleDescription` | `string` | ✅ |
| `matchedSignals` | `string[]` | ✅ |
| `tier` | `1 \| 2 \| 3` | ✅ |

### I5. ConfidenceState

| Field | Type | Required | Validation | Default |
|-------|------|:--------:|------------|---------|
| `intent` | `number` | ✅ | [0.05, 0.95] | `0.3` |
| `workflow` | `number` | ✅ | [0.05, 0.95] | `0.3` |
| `appFocus` | `number` | ✅ | [0.05, 0.95] | `0.3` |
| `uiFocus` | `number` | ✅ | [0.05, 0.95] | `0.3` |
| `change` | `number` | ✅ | [0.05, 0.95] | `0.3` |
| `composite` | `number` | ✅ | [0.05, 0.95] | `0.3` |

**Weights:** intent=0.35, workflow=0.25, appFocus=0.15, uiFocus=0.15, change=0.10  
**Ownership:** Writer = Confidence Engine. Stored in MentalModel (L2).  
**Versioning:** Weights and track names are frozen by AI Philosophy P5. New tracks are additive.

### I6. WorkflowHypothesis

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `workflowType` | `string` | ✅ | e.g. "login", "checkout", "unknown" |
| `currentStep` | `number` | ✅ | Position in workflow (1-based) |
| `totalSteps` | `number \| null` | ✅ | Total steps if known |
| `expectedNextAction` | `string \| null` | ✅ | Advisory prediction |
| `confidence` | `number` | ✅ | [0.05, 0.95] |

### I7. CanonicalStep (pre-Execution-JSON)

**Purpose:** The TestStep after Stage 3b but before Stage 4 populates executionJson. This is the human-readable artifact.

| Field | Type | Required |
|-------|------|:--------:|
| `stepId` | `string` | ✅ |
| `plainEnglish` | `string` | ✅ |
| `actionId` | `string` | ✅ |
| `elementId` | `string \| null` | ✅ |
| `aiConfidence` | `number` | ✅ |
| `timestamp` | `string` | ✅ |
| `executionJson` | `ExecutionJsonObject \| null` | ✅ |

**Note:** `executionJson` starts null and is populated by Stage 4. This makes Stage 3b and Stage 4 independent — 3b can run without 4.

---

## 5. Execution Layer Data Models

### E1. ExecutionJsonObject (B5.2 frozen contract)

**Purpose:** The machine-executable representation of one Canonical Test Step. Six frozen sections.

```typescript
interface ExecutionJsonObject {
  action: ExecutionAction;       // §1 What to do
  target: ExecutionTarget;       // §2 What to interact with
  locators: ExecutionLocator[];  // §3 How to find it (0–3)
  context: ExecutionContext;     // §4 Environmental factors
  trace: ExecutionTrace;         // §5 Source links
  meta: ExecutionMeta;           // §6 Operational data
}
```

**Ownership:** Writer = Execution JSON Generator. Immutable after generation (B5.2).  
**Versioning:** B5.2 §8.1 — extension by addition only. New sections may be added (Layers 1–4); existing sections never modified.  
**Interface contract:** Producer = Execution JSON Generator. Consumers = Playwright Generator, future engines, Review UI. Guarantee: all 6 sections present, locators ≤ 3.

### E2–E7. Sub-sections of ExecutionJsonObject

*(Already defined in `src/generation/contracts/execution-json-types.ts` — fully documented in Component Technical Specifications §18–§19. Frozen by B5.2.)*

| Object | Key Fields | Notes |
|--------|-----------|-------|
| E2 `ExecutionAction` | `type: string`, `value: string \| null` | Verb + payload |
| E3 `ExecutionTarget` | `kind: "element" \| "navigation"`, `tag`, `role`, `name`, `url` | Discriminated by kind |
| E4 `ExecutionLocator` | `strategy: LocatorStrategy`, `value: string`, `role: LocatorRole` | 0–3 per step |
| E5 `ExecutionContext` | `iframe: boolean`, `shadowDom: boolean`, `frame: IframeContext \| null` | |
| E6 `ExecutionTrace` | `interactionId: string`, `stepId: string` | Bidirectional link |
| E7 `ExecutionMeta` | `status: "generated" \| "error"`, `warnings: string[]`, `generatedAt: string` | |

### E8. TestStep

**Purpose:** The complete step artifact — human-readable description + machine-executable JSON. This is the primary output of the generation pipeline.

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `stepId` | `string` | ✅ | Format: `step-NNNN` |
| `plainEnglish` | `string` | ✅ | Human-readable description |
| `actionId` | `string` | ✅ | Links to source SessionEvent |
| `elementId` | `string \| null` | ✅ | Links to element identity |
| `executionJson` | `ExecutionJsonObject \| null` | ✅ | Machine-executable (null if generation failed) |
| `aiConfidence` | `number` | ✅ | 0.0–1.0 (0 if no AI) |
| `timestamp` | `string` | ✅ | ISO 8601 generation timestamp |

**Ownership:** Writer = Stage 3b (creates) → Stage 4 (populates executionJson). Then immutable.  
**Versioning:** Additive. New optional fields can be added.  
**Interface contract:** Producer = Generation Engine (batch). Consumer = Review, Playwright Generator, Repository.

### E9. GenerationResult

| Field | Type | Required |
|-------|------|:--------:|
| `success` | `boolean` | ✅ |
| `steps` | `TestStep[]` | ✅ |
| `playwrightCode` | `string \| null` | ✅ |
| `errors` | `GeneratorError[]` | ✅ |

---

## 6. Review & Infrastructure Data Models

### V1. ReviewItem

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `stepId` | `string` | ✅ | Which step |
| `status` | `'pending' \| 'approved' \| 'edited' \| 'rejected'` | ✅ | Review state |
| `originalStep` | `TestStep` | ✅ | Pre-review snapshot |
| `editedStep` | `TestStep \| null` | ✅ | If edited, the modified version |
| `reviewNotes` | `string \| null` | ❌ | Reviewer comments |

### V2. ValidationResult

| Field | Type | Required |
|-------|------|:--------:|
| `stepId` | `string` | ✅ |
| `passed` | `boolean` | ✅ |
| `errors` | `string[]` | ✅ |
| `warnings` | `string[]` | ✅ |

### V3. EvidenceBundle

| Field | Type | Required |
|-------|------|:--------:|
| `actionId` | `string` | ✅ |
| `screenshot` | `ScreenshotMetadata \| null` | ✅ |
| `elementIdentity` | `ElementIdentity \| null` | ✅ |
| `classificationEvidence` | `ClassificationEvidence \| null` | ✅ |
| `aiUnderstanding` | `AIUnderstanding \| null` | ✅ |

### V4. RepositoryTestCase

| Field | Type | Required |
|-------|------|:--------:|
| `id` | `string` | ✅ |
| `name` | `string` | ✅ |
| `steps` | `TestStep[]` | ✅ |
| `events` | `SessionEvent[]` | ✅ |
| `createdAt` | `string` | ✅ |

### F1. UIState

| Field | Type | Required |
|-------|------|:--------:|
| `recordingState` | `RecordingState` | ✅ |
| `lastChanged` | `string` | ✅ |

### F2. TestCaseDraft

*(Documented in shared/types.ts — full interface with 11 fields: id, name, expectedResult?, projectId, projectName, featureId, featureName, scenarioId, scenarioName, status, createdAt.)*

### F3. AIConfig

| Field | Type | Required |
|-------|------|:--------:|
| `activeProvider` | `AIProviderId` | ✅ |
| `providers` | `Partial<Record<AIProviderId, ProviderSettings>>` | ✅ |

### F4. ProviderSettings

| Field | Type | Required |
|-------|------|:--------:|
| `apiKey` | `string` | ✅ |
| `model` | `string` | ✅ |
| `baseUrl` | `string \| undefined` | ❌ |
| `connectionStatus` | `'connected' \| 'disconnected' \| 'untested'` | ✅ |
| `lastTestedAt` | `string \| undefined` | ❌ |

### F5. AuditEvent

| Field | Type | Required |
|-------|------|:--------:|
| `type` | `string` | ✅ |
| `timestamp` | `string` | ✅ |
| `entityId` | `string` | ✅ |
| `details` | `Record<string, unknown>` | ✅ |

### F6. LogEntry

| Field | Type | Required |
|-------|------|:--------:|
| `level` | `'debug' \| 'info' \| 'warn' \| 'error'` | ✅ |
| `category` | `string` | ✅ |
| `message` | `string` | ✅ |
| `timestamp` | `string` | ✅ |
| `data` | `Record<string, unknown> \| undefined` | ❌ |

### F7. ErrorObject

| Field | Type | Required |
|-------|------|:--------:|
| `code` | `string` | ✅ |
| `message` | `string` | ✅ |
| `component` | `string` | ✅ |
| `recoverable` | `boolean` | ✅ |
| `context` | `Record<string, unknown> \| undefined` | ❌ |

### F8. TestRepository

```
TestRepository = {
  projects: Project[]
}
Project = { id, name, features: Feature[] }
Feature = { id, name, scenarios: Scenario[] }
Scenario = { id, name, testCases: RepositoryTestCase[] }
```

---

## 7. Serialization & Versioning Strategy

### 7.1 Serialization format

All objects are JSON-serializable (no functions, no DOM references, no circular references). This is enforced by the data model design:

- **chrome.storage.local**: JSON objects stored directly (chrome handles serialization)
- **chrome.runtime.sendMessage**: JSON-serializable objects only (Chrome structured clone algorithm)
- **Repository export**: JSON file
- **Playwright code**: String output (not JSON)

### 7.2 Versioning principles

| Principle | Rule | Rationale |
|-----------|------|-----------|
| Additive only | New fields can be added; existing fields never removed or renamed | B5.2 §8.1 extension model |
| Optional fields | New fields must be optional (have defaults) | Old data remains valid |
| Type widening | Field types can be widened (string → string \| null) but never narrowed | Forward compatibility |
| Discriminated unions | New union members can be added to `type` discriminators | New event types, new interaction types |
| Schema version field | Future: add `schemaVersion: number` to persisted objects | Enables migration when needed |

### 7.3 Compatibility matrix

| Change Type | Backward Compatible? | Forward Compatible? | Action |
|-------------|:--------------------:|:-------------------:|--------|
| Add optional field | ✅ | ✅ | No migration needed |
| Add new union member | ✅ | ⚠️ (old code ignores) | Additive |
| Remove field | ❌ | ❌ | FORBIDDEN by B5.2 §8.1 |
| Rename field | ❌ | ❌ | FORBIDDEN |
| Change field type | ❌ | ❌ | FORBIDDEN |

---

---

# MILESTONE 10 — ALGORITHMS & DECISION LOGIC

## 8. Recording Algorithms

### 8.1 Algorithm: Event Capture (5-Gate Decision)

**Purpose:** Determine whether a raw DOM event represents a meaningful user interaction that should be recorded.

**Inputs:** `BrowserEvent`, `RawElementIdentity` (pre-extracted), before-state value (for stateful elements)  
**Outputs:** Decision: capture or discard. If capture: ownership marker + message to Event Pipeline.

**Preconditions:** Recording is active (RecordingState === Recording). Content script is injected and listening.

**Processing logic:**

```
GATE 1: IS_TRUSTED
  IF event.isTrusted === false → DISCARD (synthetic event)
  Reason: Prevents false recordings from test frameworks, analytics, ads.

GATE 2: NOT_ALREADY_OWNED
  IF target.closest('[data-cmdrunner-handled]') !== null → DISCARD
  IF target.closest('[data-cmdrunner-pending-select]') !== null → DISCARD
  Reason: Prevents duplicate recording by multiple recorders.

GATE 3: NOT_SKIPPED
  IF target matches SKIP_SELECTORS for this recorder → DISCARD
  Reason: Explicitly excluded elements (calendar overlays handled by datepicker,
  date inputs handled by datepicker, icon elements that misclassify as img, etc.)

GATE 4: MEANINGFUL_STATE_CHANGE
  SWITCH event type:
    CASE checkbox: IF element.checked === beforeState → DISCARD (no change)
    CASE radio: always capture (radio click always changes selection)
    CASE select: IF element.value === beforeState → DISCARD
    CASE text/blur: IF element.value is empty → DISCARD
    CASE dateSelect: IF no date-like value committed → DISCARD
    CASE hover: IF no observable UI change after dwell → DISCARD
    CASE click: ALWAYS PASS (default fallback — click is always meaningful)
  Reason: Filters incidental interactions (clicking without toggling, hovering
  without effect).

GATE 5: NOT_DUPLICATE
  IF same target + same event type within 500ms debounce window → DISCARD
  Reason: Prevents double-fire from event propagation or rapid clicks.

ALL GATES PASSED → CAPTURE:
  1. Set data-cmdrunner-handled on target (permanent ownership marker)
  2. Package RawElementIdentity + type-specific fields
  3. Send chrome.runtime.sendMessage with *_CAPTURED message type
```

**Decision points:** All 5 gates are deterministic. No AI involvement at capture time.

**AI vs Deterministic:** 100% deterministic. The Recorder never invokes AI. Event classification is evidence-based only.

**Complexity:** O(1) per gate (constant-time DOM queries). O(d) for Gate 2 where d = DOM depth to closest ancestor with marker (typically < 5).

**Failure handling:** If any gate throws (e.g., detached element), the event is discarded. Recording continues.

**Extensibility:** New skip selectors (Gate 3) can be added per recorder. New event types add new Gate 4 cases. Existing gates unchanged.

### 8.2 Algorithm: Event Filtering (Skip Rules)

**Purpose:** Maintain a per-recorder set of CSS selectors that identify elements this recorder should NOT capture.

**Inputs:** Target element, recorder's SKIP_SELECTORS constant  
**Outputs:** Boolean (should skip)

**Processing logic:**

```
FOR each selector in SKIP_SELECTORS:
  IF target.matches(selector) OR target.closest(selector) → return true (skip)
RETURN false (don't skip)
```

**Skip selector categories (click recorder):**
- `input[type="date"]`, `input[type="time"]`, `input[type="datetime-local"]` — handled by datepicker
- `[role="gridcell"]`, `[data-cmdrunner-handled="dateSelect"]` — calendar cells
- `[role="menuitem"]` — handled by select recorder (ARIA menu pattern)
- `[class*="calendar"]`, `[class*="datepicker"]` — calendar containers
- `[class*="date_picker"]`, `[data-datepicker]` — expanded calendar patterns
- Text inputs with date keywords (`placeholder*="depart"`, etc.)

**Decision type:** Deterministic (static selector list). No AI.

### 8.3 Algorithm: Event Normalization

**Purpose:** Transform a captured raw event + RawElementIdentity into a standardized SessionEvent ready for persistence.

**Inputs:** Message type (`*_CAPTURED`), payload (RawElementIdentity + type-specific fields)  
**Outputs:** `SessionEvent` with actionId, elementId, timestamp

**Processing logic:**

```
1. GENERATE actionId:
   prefix = messageTypeToPrefix(message.type)  // "CLICK_CAPTURED" → "click"
   counter = incrementCounter(prefix)
   actionId = `${prefix}-${pad(counter, 4)}`  // "click-0001"

2. GENERATE elementId (if element-bearing event):
   counter = incrementCounter("elem")
   elementId = `elem-${pad(counter, 4)}`
   elementIdentity = { ...rawIdentity, elementId }

3. CONSTRUCT SessionEvent:
   event = {
     actionId,
     type: messageTypeToEventType(message.type),
     timestamp: new Date().toISOString(),
     ...typeSpecificFields  // value, checked, dateType, etc.
   }

4. APPEND to Timeline (B3 immutable — existing events untouched)
```

**Decision type:** Deterministic (sequential counters, static mappings).

---

## 9. Context Algorithms

### 9.1 Algorithm: Session Context Layer Update

**Purpose:** Update a layer of Session Context when new data arrives.

**Inputs:** Layer number (1, 2, or 3), update payload, writer identity  
**Outputs:** Updated layer state

**Processing logic:**

```
1. VALIDATE WRITER:
   IF writer !== registeredWriter[layer] → REJECT (TS3 single-writer rule)

2. APPLY UPDATE:
   SWITCH layer:
     CASE 1 (L1): REPLACE entire DeterministicState with new state
     CASE 2 (L2): REPLACE entire MentalModel with new model
     CASE 3 (L3): APPEND to SessionEvent[] (never modify existing)

3. NOTIFY CONSUMERS (if subscribed):
   Emit ContextUpdate { layer, changeType, timestamp }
```

**Decision type:** Deterministic (access control + data operations).

### 9.2 Algorithm: State Tracking (MutationObserver Processing)

**Purpose:** Detect relevant DOM mutations and update L1 DeterministicState.

**Inputs:** `MutationRecord[]` (batched, 100ms debounce)  
**Outputs:** Updated `DeterministicState`

**Processing logic:**

```
FOR each mutation in batch:
  IF mutation.type === 'childList':
    // Element added or removed
    FOR each addedNode:
      IF addedNode matches [role="dialog"], .modal, [aria-modal="true"] → add to openDialogs
      IF addedNode matches [role="listbox"], [role="menu"] → add to openDropdowns
    FOR each removedNode:
      IF removedNode was in openDialogs → remove from openDialogs
      IF removedNode was in openDropdowns → remove from openDropdowns

  IF mutation.type === 'attributes':
    IF mutation.attributeName === 'aria-expanded':
      IF newValue === 'true' → add target to openDropdowns
      IF newValue === 'false' → remove target from openDropdowns
    IF mutation.attributeName === 'aria-hidden':
      // Visibility change — update state if relevant
    // Ignore class/style mutations unless they indicate dialog/dropdown state

WRITE updated DeterministicState to L1
```

**Decision type:** Deterministic (DOM queries and attribute checks). No AI.

**Complexity:** O(n × d) where n = mutation count, d = depth of DOM queries per mutation. Batched to amortize cost.

---

## 10. Intelligence Algorithms

### 10.1 Algorithm: AI Observation (Per-Interaction Understanding)

**Purpose:** Derive semantic understanding from a captured interaction using the configured AI provider.

**Inputs:** `ActionElementInfo` (semantic snapshot), `AIConfig` (provider settings), previous `MentalModel`  
**Outputs:** Updated `MentalModel` or null (if AI fails)

**Preconditions:** Recording is active. AI provider has apiKey configured (otherwise skip).

**Processing logic:**

```
1. RESOLVE PROVIDER:
   provider = AIConfig.providers[AIConfig.activeProvider]
   IF !provider || !provider.apiKey → RETURN null (AI optional, P7)

2. BUILD SEMANTIC SNAPSHOT:
   input = { actionType, text, tag, role, className }
   // L10: NO cssSelector, xPath, elementId — semantic only

3. BUILD CONTEXTUAL PROMPT:
   prompt = buildUnderstandingPrompt(input, contextFromL1, last5ActionsFromL3, previousMentalModel)
   // 3-channel design: current snapshot + sliding window + prior understanding (O(1) summary)

4. INVOKE PROVIDER (async, 10s timeout):
   response = await providerAdapter.complete(prompt)
   // Fire-and-forget from Event Pipeline's perspective

5. ON SUCCESS — PARSE RESPONSE:
   parsed = parseUnderstandingResponse(response)
   // Strip markdown, extract JSON, clamp confidence

   IF parse fails → RETURN null (log, continue)

6. ON SUCCESS — UPDATE MENTAL MODEL:
   updatedModel = mergeUnderstandingIntoMentalModel(parsed, previousMentalModel)
   // Apply P4 (max 3 hypotheses per domain)
   // Apply P6 (cite evidence: actionId)
   // Apply P5 (confidence bounds)

   WRITE updatedModel to L2

7. ON FAILURE (timeout, network, rate limit):
   LOG warning
   RETURN null (system continues without AI for this interaction)
```

**Decision points:**

| Decision | Type | Rule |
|----------|------|------|
| Should AI run? | Deterministic | Run iff apiKey configured |
| What to send? | Deterministic | Semantic snapshot only (L10) |
| Confidence clamping | Deterministic | [0.05, 0.95] (P5) |
| Hypothesis management | Deterministic envelope | Max 3 per domain (P4) |
| AI response interpretation | Non-deterministic (AI) | AI provides the interpretation; envelope normalizes |

**AI vs Deterministic:** The envelope (steps 1-3, 5-7) is deterministic. Step 4 (the AI call) is non-deterministic. The system is correct regardless of AI output quality (P3 Evidence Sovereignty — AI never overrides facts).

**Complexity:** O(1) for envelope. O(network latency) for AI call. Non-blocking.

**Failure handling:** All failure paths return null → system continues. No retry beyond 1 backoff for rate limit (429). AI failure NEVER blocks recording.

### 10.2 Algorithm: Semantic Classification (3-Tier Decision)

**Purpose:** Classify each recorded action into one of the 10 canonical interaction types.

**Inputs:** `SessionEvent[]` (Timeline), `SessionContextSnapshot` (L1+L2+L3)  
**Outputs:** `ClassifiedInteraction[]`

**Processing logic:**

```
FOR each event in Timeline:
  APPLY TIER 1 RULES (priority-ordered, first match wins):

  Rule 1: NAVIGATION
    IF event.type === 'navigation'
    → canonicalType = 'navigate', tier = 1
    → NEXT

  Rule 2: TEXT ENTRY (FILL)
    IF event.type === 'text' AND value is non-empty
    → IF dateLike(value) AND target is date input → canonicalType = 'selectDate'
    → ELSE canonicalType = 'fill', tier = 1
    → NEXT

  Rule 3: DATE SELECTION
    IF event.type === 'dateSelect'
    → canonicalType = 'selectDate', tier = 1
    → NEXT

  Rule 4: CHECKBOX (TOGGLE)
    IF event.type === 'checkbox'
    → canonicalType = 'toggle', tier = 1
    → NEXT

  Rule 5: RADIO (SELECT)
    IF event.type === 'radio'
    → canonicalType = 'select', tier = 1 (L4: radios are select)
    → NEXT

  Rule 6: SELECT (SELECT)
    IF event.type === 'select' AND value present
    → canonicalType = 'select', tier = 1
    → NEXT

  Rule 7: HOVER
    IF event.type === 'hover'
    → canonicalType = 'hover', tier = 1
    → NEXT

  Rule 8: UPLOAD
    IF event involves file input change
    → canonicalType = 'upload', tier = 1
    → NEXT

  Rule 9: DRAG
    IF event has mousedown→mousemove→mouseup with drop target
    → canonicalType = 'drag', tier = 1
    → NEXT

  Rule 10: PRESS KEY
    IF event is non-text key press (Enter, Tab, Escape, F-keys)
    → canonicalType = 'pressKey', tier = 1
    → NEXT

  Rule 11: CLICK (ACTIVATION)
    IF event.type === 'click'
    → GOTO AMBIGUITY CHECK (Rules 12-14)
    → NEXT

  Rule 12: CLICK vs SELECT AMBIGUITY
    IF target has role=option/menuitem/treeitem
    OR target is inside [role=listbox/menu/tree]
    → Tier 1 evidence strong → canonicalType = 'select', tier = 1
    → Tier 1 evidence weak:
      → TIER 2: Check Mental Model advisory
        IF MentalModel.userIntent suggests 'select' with confidence > 0.7
        → canonicalType = 'select', tier = 2
      → TIER 3: DEFAULT
        → canonicalType = 'click', tier = 3 (L5 fallback)

  Rule 13: CLICK vs TOGGLE AMBIGUITY
    IF target has aria-expanded or matches toggle class patterns
    AND binary state change evidence (checked/expanded flipped)
    → canonicalType = 'toggle', tier = 1
    → ELSE canonicalType = 'click', tier = 1

  Rule 14: DEFAULT FALLBACK
    → canonicalType = 'click', tier = 3 (L5: click is always valid)

  CREATE ClassifiedInteraction:
    { canonicalType, actionId, originalEvent, classificationTier, evidence }
```

**AI vs Deterministic responsibility matrix:**

| Decision | AI? | Deterministic? | Notes |
|----------|:---:|:--------------:|-------|
| Navigation detection | ❌ | ✅ | event.type === 'navigation' |
| Text entry detection | ❌ | ✅ | event.type === 'text' |
| Checkbox toggle | ❌ | ✅ | event.type === 'checkbox' |
| Radio → select | ❌ | ✅ | L4 frozen decision |
| Select detection | ❌ | ✅ | event.type === 'select' |
| Date select | ❌ | ✅ | event.type === 'dateSelect' |
| Hover | ❌ | ✅ | event.type === 'hover' |
| Click vs select (clear evidence) | ❌ | ✅ | ARIA roles are deterministic |
| Click vs select (ambiguous) | ⚠️ Advisory | ✅ Default | AI Tier 2 suggests; Tier 3 defaults to click |
| Default fallback | ❌ | ✅ | L5: click is always valid |

**Key principle:** Tier 2 (AI advisory) is consulted ONLY when Tier 1 evidence is ambiguous AND Mental Model is available. If AI is disabled or Mental Model is null, Tier 3 default (click) is used. The system is fully functional without AI.

**Complexity:** O(n × r) where n = Timeline length, r = rules checked per event (max 14, typically 1-2 for first-match-wins). O(n) total.

**Extensibility:** New rules inserted into the priority chain. New canonical types get a new rule. Existing rules unchanged (L8 additive).

### 10.3 Algorithm: Canonical Step Generation

**Purpose:** Transform classified interactions into human-readable test steps.

**Inputs:** `ClassifiedInteraction[]`, `MentalModel | null`, `RecordingContext`  
**Outputs:** `TestStep[]`

**Processing logic:**

```
FOR each classified interaction (in order):
  1. SELECT TEMPLATE by canonicalType:
     navigate → "Navigate to {url}"
     click → "Click the {name} {controlType}"
     fill → "Enter '{value}' in the {name} field"
     select → "Select '{value}' from the {name} {controlType}"
     toggle → "{action} the {name} checkbox"  (action = Check/Uncheck)
     selectDate → "Select {displayValue} as the {name} date"
     hover → "Hover over the {name} element"
     pressKey → "Press {key}"
     upload → "Upload {filename}"
     drag → "Drag {source} to {target}"

  2. RESOLVE {name}:
     IF MentalModel AND MentalModel.userIntent.confidence > 0.5:
       name = MentalModel.businessName
     ELSE:
       name = accessibleName || ariaLabel || placeholder || `${tag} element`

  3. RESOLVE {controlType}:
     IF MentalModel: controlType = MentalModel.controlType
     ELSE: controlType = inferFromTag(tag)  // BUTTON→"button", A→"link", etc.

  4. CONSTRUCT TestStep:
     { stepId, plainEnglish, actionId, elementId, executionJson: null, aiConfidence, timestamp }

APPLY READABILITY OPTIMIZATION (OR-1 merge):
  Scan for consecutive fills on the same form → merge into compound step
  Conditions for merge:
    (a) Same canonicalType
    (b) Same parent container (form/fieldset)
    (c) No intervening different-type interaction
    (d) Merge improves readability
  NOTE: Merge produces compound step; all actionIds preserved in trace.
  Timeline is NEVER modified (B3 invariant).
```

**AI vs Deterministic:** Template selection and OR-1 merge are deterministic. Name resolution uses AI advisory (MentalModel) when available, with deterministic fallback chain.

**Complexity:** O(n) for generation. O(n) for OR-1 scan (single pass).

### 10.4 Algorithm: Confidence Calculation

**Purpose:** Compute multi-track confidence scores from evidence per AI Philosophy P5.

**Inputs:** `AIUnderstanding` (new evidence), `ConfidenceState` (previous)  
**Outputs:** Updated `ConfidenceState`

**Processing logic:**

```
// Domain weights (frozen by AI Philosophy P5)
WEIGHTS = { intent: 0.35, workflow: 0.25, appFocus: 0.15, uiFocus: 0.15, change: 0.10 }

// For each domain track:
function updateTrack(current, evidenceStrength, supports):
  IF supports:
    delta = evidenceStrength * (1 - current) * 0.3  // Diminishing returns toward 1.0
  ELSE:
    delta = -evidenceStrength * current * 0.5  // Sharper decline
  newScore = current + delta
  RETURN clamp(newScore, 0.05, 0.95)  // P5 bounds

// Apply per-domain:
intent = updateTrack(prev.intent, aiConfidence, evidenceSupportsIntent)
workflow = updateTrack(prev.workflow, workflowFitScore, actionFitsWorkflow)
appFocus = updateTrack(prev.appFocus, 0.5, elementMatchesApp)
uiFocus = updateTrack(prev.uiFocus, 0.5, elementMatchesUI)
change = updateTrack(prev.change, 0.5, changeIsExpected)

// Composite:
composite = intent*0.35 + workflow*0.25 + appFocus*0.15 + uiFocus*0.15 + change*0.10
composite = clamp(composite, 0.05, 0.95)

RETURN { intent, workflow, appFocus, uiFocus, change, composite }
```

**Decision type:** Deterministic algorithm. AI provides raw evidence (confidenceScore, intent); the algorithm computes calibrated scores.

**Complexity:** O(1) per interaction (fixed arithmetic).

---

## 11. Execution Algorithms

### 11.1 Algorithm: Execution JSON Generation

**Purpose:** Produce the B5.2 six-section Execution JSON for each test step.

**Inputs:** `TestStep[]` (with plainEnglish, no executionJson yet)  
**Outputs:** `TestStep[]` (with executionJson populated)

**Processing logic:**

```
FOR each step:
  1. MAP VERB (canonicalType → execution verb):
     navigate → "navigate"
     click → "click"
     fill → "fill"
     select → "selectOption"
     toggle → "check" (if checked=true) or "uncheck" (if checked=false)
     selectDate → "fill" (date value as ISO string)
     hover → "hover"
     pressKey → "press"
     upload → "setInputFiles"
     drag → "dragTo"

  2. BUILD ACTION:
     action = { type: verb, value: payloadOrNull }
     // payload = value for fill, key for press, etc. null for click/navigate.

  3. BUILD TARGET:
     IF navigate: target = { kind: "navigation", url: event.url }
     ELSE: target = { kind: "element", tag, role, name: accessibleName }

  4. RESOLVE LOCATORS (non-navigation):
     locators = LocatorResolutionEngine.resolve(elementIdentity)
     // Returns 0-3 ExecutionLocator entries
     IF navigate: locators = []  // Navigation exempt (B4.4)

  5. BUILD CONTEXT:
     context = { iframe: identity.inIframe, shadowDom: identity.shadowDom, frame: identity.iframeContext }

  6. BUILD TRACE:
     trace = { interactionId: actionId, stepId }

  7. BUILD META:
     meta = { status: "generated", warnings: [], generatedAt: ISO }

  8. ASSEMBLE:
     step.executionJson = { action, target, locators, context, trace, meta }
```

**Decision type:** 100% deterministic. Static verb mapping table. Same input → same output (B2 AP8).

**Complexity:** O(1) per step (excluding locator resolution). Locator resolution is O(1) amortized (regex checks).

### 11.2 Algorithm: Locator Resolution (B4.4 Priority Strategy)

**Purpose:** Produce 0-3 prioritized locators from ElementIdentity using the 5-tier hierarchy.

**Inputs:** `ElementIdentity`  
**Outputs:** `ExecutionLocator[]` (0-3 entries)

**Processing logic:**

```
candidates = []

// TIER 1: BUSINESS (testId, dataCy, dataQa, dataTest, dataAutomationId)
FOR each field in [testId, dataCy, dataQa]:
  IF field.value is non-empty:
    IF NOT isAutoGeneratedId(field.value):  // 17 regex patterns
      candidates.push({ strategy: field.strategyName, value: field.value, tier: 1 })

// TIER 2: ACCESSIBILITY (ariaLabel, ariaLabelledby)
FOR each field in [ariaLabel, ariaLabelledBy]:
  IF field.value is non-empty AND isElementSpecific(field.value):
    candidates.push({ strategy: ..., value: ..., tier: 2 })

// TIER 3: STABLE TECH (id, name)
IF stableId AND NOT isAutoGeneratedId(stableId):
  candidates.push({ strategy: "id", value: stableId, tier: 3 })
IF name AND isElementSpecific(name):
  candidates.push({ strategy: "name", value: name, tier: 3 })

// TIER 4: CONTENT (text, placeholder)
IF accessibleName AND isUniqueEnough(accessibleName):
  candidates.push({ strategy: "text", value: accessibleName, tier: 4 })
IF placeholder:
  candidates.push({ strategy: "placeholder", value: placeholder, tier: 4 })

// TIER 5: STRUCTURAL (css, xpath)
IF cssSelector:
  candidates.push({ strategy: "css", value: cssSelector, tier: 5 })
IF xPath:
  candidates.push({ strategy: "xpath", value: xPath, tier: 5 })

// SELECT TOP 3 (priority order, prefer different categories)
result = selectDiverseLocators(candidates, maxCount=3)
// Primary = highest tier. Secondary = different tier if possible. Fallback = lowest.

// ASSIGN ROLES:
IF result.length > 0: result[0].role = "primary"
IF result.length > 1: result[1].role = "secondary"
IF result.length > 2: result[2].role = "fallback"

RETURN result
```

**isAutoGeneratedId** checks 17 regex patterns (React `:r1:`, Angular `ng-*`, Vue `v-*`, Emotion `sc-*`, `css-*`, MUI `mui-*`, etc.).

**Decision type:** 100% deterministic. Same identity → same locators (B5.1 AP5).

**Complexity:** O(k) where k = identity fields checked (constant ~15). Regex matching is O(m) per field where m = string length.

### 11.3 Algorithm: Playwright Code Generation

**Purpose:** Translate Execution JSON into runnable Playwright test code.

**Inputs:** `TestStep[]` (with executionJson populated)  
**Outputs:** `string` (complete Playwright test file)

**Processing logic:**

```
// VERB → PLAYWRIGHT API MAPPING (static table):
VERB_MAP = {
  navigate: (step) => `await page.goto('${url}');`,
  click: (step) => `await page.${locatorSyntax}.click();`,
  fill: (step) => `await page.${locatorSyntax}.fill('${value}');`,
  selectOption: (step) => `await page.${locatorSyntax}.selectOption('${value}');`,
  check: (step) => `await page.${locatorSyntax}.check();`,
  uncheck: (step) => `await page.${locatorSyntax}.uncheck();`,
  hover: (step) => `await page.${locatorSyntax}.hover();`,
  press: (step) => `await page.${locatorSyntax}.press('${key}');`,
  setInputFiles: (step) => `await page.${locatorSyntax}.setInputFiles('${path}');`,
  dragTo: (step) => `await page.${sourceLocator}.dragTo(page.${targetLocator});`,
}

// LOCATOR → PLAYWRIGHT SYNTAX MAPPING (static table):
LOCATOR_MAP = {
  testId: (v) => `getByTestId('${v}')`,
  dataCy: (v) => `locator('[data-cy="${v}"]')`,
  ariaLabel: (v) => `getByLabel('${v}')`,
  ariaLabelledby: (v) => `locator('[aria-labelledby="${v}"]')`,
  id: (v) => `locator('#${v}')`,
  name: (v) => `locator('[name="${v}"]')`,
  text: (v) => `getByText('${v}')`,
  placeholder: (v) => `getByPlaceholder('${v}')`,
  css: (v) => `locator('${v}')`,
  xpath: (v) => `locator('xpath=${v}')`,
}

// GENERATE:
output = HEADER  // import { test, expect } ...
FOR each step:
  verb = step.executionJson.action.type
  primaryLocator = step.executionJson.locators[0]
  locatorSyntax = LOCATOR_MAP[primaryLocator.strategy](primaryLocator.value)
  line = VERB_MAP[verb](step, locatorSyntax)
  output += `  // Step ${stepNumber}: ${step.plainEnglish}\n`
  output += `  ${line}\n`
  // Add fallback locators as comments:
  FOR each fallback in step.executionJson.locators.slice(1):
    output += `  // Fallback: ${LOCATOR_MAP[fallback.strategy](fallback.value)}\n`
output += FOOTER  // });
```

**Decision type:** 100% deterministic. Two static mapping tables. No AI (Stage 5 principle).

**Complexity:** O(n) where n = step count. Each step is O(1) (table lookup + string concat).

---

## 12. Recovery Algorithms

### 12.1 Algorithm: MV3 Service Worker Restart Recovery

**Purpose:** Recover from MV3 service worker termination during recording or generation.

**Scenario A: SW restart during recording**

```
1. SW restarts (chrome.runtime.onStartup or first message)
2. First message arrives (e.g., CLICK_CAPTURED)
3. processAction() calls ensureSessionRestored():
   a. Check if session is loaded in memory → NO
   b. Load from chrome.storage.local:
      - events = await StorageService.getEvents()
      - context = await StorageService.getRecordingContext()
      - uiState = await StorageService.getUIState()
   c. If uiState.recordingState === 'recording':
      - Reconstruct in-memory state from persisted data
      - Resume processing
   d. Action ID counters restored from event array length
4. Process the incoming message normally
```

**Impact:** L1 (Deterministic State) and L2 (Mental Model) are lost. L3 (Timeline) is intact (persisted). Recording continues. AI may miss context for a few interactions until Mental Model rebuilds.

**Scenario B: SW restart during generation**

```
1. SW restarts
2. Check TC state:
   IF state === TestCaseState.GENERATING:
     - Previous generation was interrupted
     - Timeline is immutable (safe to re-run)
     - Auto-retry: GenerationEngine.generate()
3. Generation completes normally
```

**Decision type:** Deterministic (state check + data recovery from persisted storage).

### 12.2 Algorithm: Generation Failure Recovery

**Purpose:** Handle generator failures during the generation pipeline.

**Processing logic:**

```
FOR each generator in order:
  TRY:
    result = generator.generate(input)
    accumulated.push(result)
  CATCH error:
    errors.push({ generator: generator.name, error: error.message })
    IF generator.isRequired:
      // Critical generator failed — cannot continue
      RETURN GenerationResult { success: false, errors }
    ELSE:
      // Optional generator failed — continue without it
      LOG warning
      accumulated.push(null)

IF errors.length === 0:
  RETURN GenerationResult { success: true, steps, playwrightCode }
ELSE:
  RETURN GenerationResult { success: false, steps: partialResults, errors }
```

**Decision type:** Deterministic (required vs optional check, error collection).

---

## 13. Optimisation Algorithms

### 13.1 Algorithm: Duplicate Detection

**Purpose:** Prevent duplicate event recording within a debounce window.

**Inputs:** Target element identity, event type, timestamp  
**Outputs:** Boolean (is duplicate)

**Processing logic:**

```
key = `${elementIdentity.tag}:${elementIdentity.cssSelector}:${eventType}`
lastTime = recentEvents.get(key)

IF lastTime AND (now - lastTime) < 500ms:
  RETURN true (duplicate)
ELSE:
  recentEvents.set(key, now)
  RETURN false (not duplicate)
```

**Complexity:** O(1) (hash map lookup). Memory: O(k) where k = unique element+type combinations in session.

### 13.2 Algorithm: Incremental Processing

**Purpose:** The generation pipeline processes the full Timeline each time. Future optimization: only reprocess changed actions.

**Current approach:** Full reprocessing (safe, deterministic, simple). Timeline is typically < 500 actions. Full generation < 5 seconds. No optimization needed for current scale.

**Future approach (when needed):**
```
1. Hash each action's content
2. Compare hashes to previous generation
3. Only reprocess actions whose hash changed
4. Reuse previous output for unchanged actions
```

**Complexity:** Current: O(n). Future: O(delta) where delta = changed actions.

---

## 14. AI vs Deterministic Responsibility Matrix

| Process | Step | Deterministic | AI Advisory | AI Decision |
|---------|------|:---:|:---:|:---:|
| Event capture | 5-Gate decision | ✅ All gates | ❌ | ❌ |
| Event normalization | ID assignment | ✅ | ❌ | ❌ |
| State tracking | DOM mutation → L1 | ✅ | ❌ | ❌ |
| AI observation | Provider invocation | ✅ Envelope | — | ✅ Response content |
| AI observation | Mental Model update | ✅ Merge rules (P4,P5,P6) | — | ❌ |
| Semantic classification | Tier 1 (14 rules) | ✅ All rules | ❌ | ❌ |
| Semantic classification | Tier 2 (ambiguous) | ✅ Default fallback | ✅ Advisory hint | ❌ Never decides |
| Semantic classification | Tier 3 (default) | ✅ click (L5) | ❌ | ❌ |
| Step generation | Template selection | ✅ | ❌ | ❌ |
| Step generation | Element naming | ✅ Fallback chain | ✅ Advisory name | ❌ |
| Confidence calculation | All tracks | ✅ Algorithm | ❌ | ❌ |
| Execution JSON | Verb mapping | ✅ | ❌ | ❌ |
| Locator resolution | 5-tier priority | ✅ | ❌ | ❌ |
| Playwright generation | All mappings | ✅ | ❌ | ❌ |
| Review | Approval gates | ✅ | ❌ | ❌ |

**Core invariant:** AI NEVER makes a final decision. AI provides advisory input (Tier 2) that is consumed by deterministic logic. The system always has a deterministic fallback. (P3 Evidence Sovereignty, P7 system works without AI.)

---

---

# MILESTONE 11 — RUNTIME BEHAVIOUR

## 15. State Machines

### 15.1 Test Case Lifecycle State Machine

```
                    ┌────────┐
     User creates   │ DRAFT  │
     TC metadata ──►│        │
                    └───┬────┘
                        │ User clicks "Start Recording"
                        ▼
                    ┌────────┐
                    │RECORDING│
                    │        │
                    └───┬────┘
                        │ User clicks "Stop Recording"
                        ▼
                    ┌────────┐
                    │RECORDED│
                    │        │
                    └───┬────┘
                        │ Generation Engine triggers
                        ▼
                    ┌──────────┐
                    │GENERATING │
                    │          │
                    └───┬──────┘
                        │ Generation completes
                        ▼
                    ┌──────────┐
                    │GENERATED │
                    │          │
                    └───┬──────┘
                        │ User enters review
                        ▼
                    ┌──────────────┐
                    │UNDER_REVIEW  │
                    │              │
                    └──────┬───────┘
                           │ User approves all steps
                           ▼
                    ┌──────────┐
                    │ APPROVED │
                    │          │
                    └───┬──────┘
                        │ Saved to repository
                        ▼
                    ┌────────┐
                    │ SAVED  │
                    │        │
                    └────────┘
```

**Invalid transitions:**

| From | To | Reason |
|------|-----|--------|
| DRAFT | RECORDING (without TC metadata) | TC must have name + project |
| RECORDING | GENERATED (skip GENERATING) | Generation must run |
| SAVED | any | Terminal state (immutable) |
| APPROVED | RECORDING | Cannot re-record an approved TC |

**Entry actions:**

| State | Entry Action |
|-------|-------------|
| RECORDING | Attach content script listeners, capture RecordingContext, init Session Context |
| RECORDED | Detach listeners, trigger Generation Engine |
| GENERATING | Read Timeline, invoke generators in order |
| GENERATED | Persist artifacts, notify UI |
| UNDER_REVIEW | Load artifacts + evidence into review UI |
| APPROVED | Validate all steps, check no errors |
| SAVED | Deep-copy to RepositoryTestCase, persist to repository |

### 15.2 Recording Session State Machine

```
                    ┌────────┐
                    │ READY  │◄──────────────────┐
                    └───┬────┘                    │
                        │ START_RECORDING         │
                        ▼                         │
                    ┌──────────┐                  │
                    │ RECORDING│                  │
                    └───┬──────┘                  │
                        │ STOP_RECORDING          │
                        ▼                         │
                    ┌────────┐                    │
                    │ STOPPED│─── reset ──────────┘
                    └────────┘
```

**Events that trigger transitions:**

| Event | From | To | Action |
|-------|------|-----|--------|
| START_RECORDING | READY | RECORDING | Inject content scripts, attach listeners, capture context |
| STOP_RECORDING | RECORDING | STOPPED | Detach listeners, trigger generation, transition TC to RECORDED |
| Session reset | STOPPED | READY | Clear session data (Timeline, screenshots), reset TC state |

**Invalid transitions:** RECORDING → RECORDING (double start), READY → STOPPED (stop without start).

### 15.3 Generation Pipeline State Machine

```
                    ┌────────┐
                    │  IDLE  │
                    └───┬────┘
                        │ generate() called
                        ▼
                    ┌──────────┐     failure     ┌────────┐
                    │GENERATING│────────────────►│ FAILED │
                    └───┬──────┘                  └───┬────┘
                        │ success                     │ retry
                        ▼                             ▼
                    ┌──────────┐               ┌──────────┐
                    │COMPLETE  │               │GENERATING│
                    └──────────┘               └──────────┘
```

**Invalid transitions:** IDLE → COMPLETE (without GENERATING), GENERATING → IDLE (without completion).

---

## 16. Processing Pipelines

### 16.1 Recording Pipeline (real-time, per interaction)

```
User DOM event
    │
    ├─[Browser Event Collector]──► Route to specialized recorder
    │                                   │
    ├─[DOM Snapshot Manager]──────────► Extract RawElementIdentity
    │                                   │
    ├─[Recorder: 5-Gate Decision]─────► Capture or discard?
    │                                   │
    ├── CAPTURE ─────────────────────► Set ownership marker
    │                                   │
    ├──[Event Pipeline]───────────────► Assign IDs, construct SessionEvent
    │                                   │
    ├──[Storage Manager]──────────────► Append to Timeline (B3 immutable)
    │                                   │
    ├──[Screenshot Manager]───────────► Capture screenshot (async, non-blocking)
    │                                   │
    ├──[AI Observer]──────────────────► Understand interaction (async, non-blocking)
    │                                   │
    └──[Side Panel UI]────────────────► Broadcast EVENTS_UPDATED
```

**Pipeline properties:**
- **Ordering:** Events processed in DOM event order (sequential). Action IDs are sequential.
- **Synchronization:** Main pipeline (capture → persist) is synchronous. Side-effects (screenshot, AI) are async fire-and-forget.
- **Throughput:** ~10ms per interaction (excluding async side-effects).
- **Backpressure:** None — browser events arrive at human speed (~1-2/sec max).

### 16.2 Generation Pipeline (batch, on Stop Recording)

```
Stop Recording
    │
    ├─[Transient→Permanent Boundary]
    │   Timeline + RecordingContext + Screenshots cross to Permanent
    │   Session Context (L1, L2) + Evidence Store discarded
    │
    ├─[Generation Engine]─── Read frozen inputs from storage
    │         │
    │         ├─[Stage 3a: Semantic Classifier]
    │         │    Input: Timeline + Session Context
    │         │    Output: ClassifiedInteraction[]
    │         │    Deterministic: YES (Tier 1 rules, Tier 2 advisory, Tier 3 default)
    │         │
    │         ├─[Stage 3b: Canonical Step Generator]
    │         │    Input: ClassifiedInteraction[] + MentalModel
    │         │    Output: TestStep[] (plainEnglish, no executionJson)
    │         │    Deterministic: YES (templates + OR-1 merge)
    │         │
    │         ├─[Stage 4a: Execution JSON Generator]
    │         │    Input: TestStep[]
    │         │    Invokes: Locator Resolution Engine per step
    │         │    Output: TestStep[] (executionJson populated)
    │         │    Deterministic: YES (B5.2 contract, B4.4 priority)
    │         │
    │         ├─[Stage 4b: AI Enrichment Layer] (FUTURE)
    │         │    Input: TestStep[] + MentalModel
    │         │    Output: TestStep[] (Layer 1 RESILIENCE added)
    │         │    Deterministic: NO (AI-enriched) — but Layer 0 untouched
    │         │
    │         └─[Stage 5: Playwright Generator]
    │              Input: TestStep[]
    │              Output: string (Playwright test code)
    │              Deterministic: YES (static mapping tables)
    │
    ├─[Storage Manager]─── Batch persist all artifacts (atomic)
    │
    └─[Side Panel UI]───── Notify GENERATION_COMPLETE
```

**Pipeline properties:**
- **Ordering:** Strict sequential (Stage 3a → 3b → 4 → 5). Each stage depends on the previous.
- **Synchronization:** Fully synchronous within the Generation Engine. Each stage completes before the next starts.
- **Atomicity:** All artifacts persisted in a single batch. If any stage fails, no partial artifacts are committed.
- **Determinism:** Same Timeline + same MentalModel → same output (B2 AP8). Stage 4b (future) is non-deterministic but doesn't affect Layer 0.

### 16.3 Review Pipeline (interactive, user-driven)

```
GENERATED TC enters review
    │
    ├─[Review Engine]─── Load steps, code, screenshots
    │         │
    │         ├─[Evidence Manager]─── Aggregate evidence per step
    │         │
    │         ├─[Validation Engine]─── Validate Execution JSON structure
    │         │
    │         └─ FOR each step:
    │              User reviews:
    │              ├── APPROVE → mark approved
    │              ├── EDIT → user modifies step
    │              └── REJECT → mark rejected (with reason)
    │
    ├─[Approval Manager]─── Check all approved + no errors
    │         │
    │         ├── TC state → APPROVED
    │         └─ Deep-copy to RepositoryTestCase → SAVED
    │
    └─[Side Panel UI]─── Notify TC saved
```

---

## 17. Concurrency Model

### 17.1 Execution model

CmdRunner runs in a **Chrome Extension MV3** environment with the following execution contexts:

| Context | Runs | Concurrency |
|---------|------|-------------|
| Service Worker (background) | Extension lifecycle | Single-threaded, event-driven. Can be killed by Chrome after 30s idle. |
| Content Scripts (per tab) | Page context (isolated world) | Single-threaded per tab. Multiple tabs = multiple independent instances. |
| Side Panel | Extension UI | Single-threaded. Reactivates on user interaction. |

### 17.2 Synchronization rules

| Rule | Enforcement |
|------|------------|
| Timeline writes are serialized | All writes go through Event Pipeline (single SW context). No concurrent writes possible. |
| Session Context layers have single writers | Runtime writer registration. Concurrent writes to same layer rejected. |
| AI calls are non-blocking | `understand()` returns a Promise that is NOT awaited by Event Pipeline. Recording continues at full speed. |
| Screenshot capture is non-blocking | `capture()` returns a Promise that is NOT awaited. |
| Generation pipeline is sequential | Each stage awaits the previous. No parallel generation. |

### 17.3 Race condition prevention

| Potential Race | Prevention |
|----------------|------------|
| Two recorders capture the same event | Ownership protocol (Gate 2): `data-cmdrunner-handled` marker set before message sent. Second recorder sees marker and discards. |
| Event arrives during STOP_RECORDING | RecordingState checked in processAction. If `stopped`, event discarded. |
| SW restart during generation | TC state = GENERATING checked on restart. Auto-retry (Timeline is immutable). |
| Screenshot arrives after session ends | Screenshot linked to actionId; if action exists, screenshot is valid. If session cleared, screenshot discarded. |
| AI response arrives after session ends | Mental Model update checks if session is still active. If not, discard. |

### 17.4 Ordering guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| Timeline events are ordered by timestamp | Sequential append with monotonically increasing actionId |
| Generation stages execute in dependency order | Topological sort in Generator Registry |
| Test steps are numbered sequentially | Counter in Canonical Step Generator |
| Screenshots link to correct actions | actionId passed to capture request |

---

## 18. Event Ordering

### 18.1 Event sequencing

Events arrive in DOM event order. The Event Pipeline processes them sequentially:

```
Event 1 (click-0001) → persist → side-effects → broadcast
Event 2 (text-0001) → persist → side-effects → broadcast
Event 3 (select-0001) → persist → side-effects → broadcast
```

No event is processed out of order. No event is skipped (unless discarded by 5-Gate).

### 18.2 Navigation event handling

Navigation events from `chrome.webNavigation.onCommitted` arrive asynchronously. They may arrive slightly before or after the click that triggered navigation.

**Resolution:** Navigation events are appended to Timeline with their own actionId (`nav-0001`). The click and the navigation are separate events. Stage 3a classifies the click as `click` and the navigation as `navigate`. Both are recorded.

**Debounce:** Multiple onCommitted events from SPA route changes within 200ms are debounced. Only the last one is recorded.

---

## 19. Lifecycle Definitions

### 19.1 Recording session lifecycle

| Phase | Entry Condition | Exit Condition | Duration |
|-------|----------------|----------------|----------|
| Initialization | START_RECORDING message | Content scripts attached, context captured | < 500ms |
| Active recording | Listeners attached | STOP_RECORDING message | User-driven |
| Tear-down | STOP_RECORDING message | Listeners detached, generation triggered | < 1s |
| Post-session | Generation complete | Session data cleared (on user action or new session) | Until reset |

### 19.2 Session Context lifecycle

| Phase | What Happens |
|-------|-------------|
| Creation | START_RECORDING → Session Context initialized with empty L1/L2/L3 |
| Active | Updated per interaction (L1 mutations, L2 AI updates, L3 appends) |
| Consumption | Stop Recording → Stage 3a/3b read snapshot |
| Disposal | L1 + L2 discarded. L3 already persisted. |

### 19.3 Mental Model lifecycle

| Phase | What Happens |
|-------|-------------|
| Creation | First successful AI observation creates L2 |
| Active | Updated per AI observation (progressive understanding per P2) |
| Consumption | Stage 3b reads for element naming; Stage 3a reads for Tier 2 advisory |
| Disposal | Discarded after Stage 3b completes. Never persisted. |

### 19.4 Artifact lifecycle

| Artifact | Created By | Persisted | Final Destination |
|----------|-----------|:---------:|-------------------|
| Timeline (events) | Event Pipeline | ✅ | RepositoryTestCase.events |
| Screenshots | Screenshot Manager | ✅ | Linked to steps during review |
| Test Steps | Stage 3b + Stage 4 | ✅ | RepositoryTestCase.steps |
| Playwright code | Stage 5 | ✅ | Displayed/exported by user |
| Execution JSON | Stage 4 | ✅ (in TestStep) | RepositoryTestCase.steps[].executionJson |

---

## 20. Runtime Guarantees

### 20.1 Consistency guarantees

| Guarantee | Scope | Mechanism |
|-----------|-------|-----------|
| Timeline immutability (B3) | After append | Existing events never modified. Append-only array. |
| Single-writer per data structure | All layers | Runtime writer registration |
| Atomic artifact persistence | Generation | Batch write to storage (all-or-nothing) |
| Deterministic generation | Stage 3-5 | Same input → same output (B2 AP8) |

### 20.2 Reliability guarantees

| Guarantee | Scope | Mechanism |
|-----------|-------|-----------|
| AI failure never blocks recording | Recording | Async, fire-and-forget. Returns null on failure. |
| SW restart recovers gracefully | All | Session restored from chrome.storage.local |
| Generation auto-retries on SW death | Generation | GENERATING state detected on restart → retry |
| Empty Timeline handled | Generation | Skip generation, report "no actions" |

### 20.3 Idempotency

| Operation | Idempotent? | Notes |
|-----------|:-----------:|-------|
| Event capture | ❌ | Each capture appends a new event |
| Generation | ✅ | Same Timeline → same output |
| Locator resolution | ✅ | Same identity → same locators |
| Playwright generation | ✅ | Same Execution JSON → same code |
| Review approval | ❌ | Changes TC state (one-time action) |

### 20.4 Fault tolerance

| Fault | Impact | Recovery |
|-------|--------|----------|
| AI provider down | No Mental Model updates | System continues with deterministic-only |
| Storage quota exceeded | Cannot persist new data | Clear screenshots (largest); retry |
| Content script not injected | Events from that tab missed | SW re-injects on next navigation |
| Cross-origin iframe | Events in iframe missed | Known limitation; documented |

---

## 21. Pipeline Completion Semantics

### 21.1 Recording pipeline completion

The recording pipeline for a single interaction is "complete" when:
1. Event is appended to Timeline (persisted to storage)
2. EVENTS_UPDATED broadcast sent to UI

Side-effects (screenshot, AI) may still be in-flight. They are not part of "completion."

### 21.2 Generation pipeline completion

The generation pipeline is "complete" when:
1. All registered generators have run (success or error collected)
2. All artifacts batch-persisted to storage
3. TC state transitioned to GENERATED (or failed)
4. GENERATION_COMPLETE (or GENERATION_FAILED) broadcast sent

---

## 22. Runtime Behaviour Summary

### 22.1 Information flow guarantee

**Information flows strictly downward through layers:**

```
Recording → Context → Intelligence → Execution → Review
```

No information flows upward. The only exception is AI Observer (Intelligence) reading from Session Context (Context), which is a read-only cross-layer access validated in the E2E Architecture.

### 22.2 Determinism guarantee

**The entire generation pipeline (Stage 3a → 3b → 4 → 5) is deterministic** for a given Timeline + MentalModel. Re-running generation with the same inputs produces identical output. This is guaranteed by:

- Tier 1 classification rules (deterministic)
- Template selection (static table)
- OR-1 merge rule (deterministic conditions)
- Verb mapping (static table)
- Locator resolution (deterministic priority)
- Playwright generation (static mapping tables)

The ONLY non-deterministic element is Stage 4b (future AI Enrichment Layer), which adds optional resilience metadata without affecting Layer 0.

### 22.3 Failure isolation guarantee

**Component failures are isolated:**

| Failure | Blast Radius |
|---------|:------------:|
| AI Observer fails | Zero (advisory only, non-blocking) |
| State Tracker fails | Reduced context (L1 stale) |
| Recorder fails | Single event lost |
| Event Pipeline fails | Events lost (if persistent) |
| Generation Engine fails | All artifacts (recoverable — Timeline intact) |
| Storage fails | Critical (data loss) |

---

---

# CROSS-PHASE ENGINEERING REVIEW

## 23. Engineering Consistency Review

### 23.1 Data consistency

| Check | Status | Evidence |
|-------|:------:|---------|
| Every shared object has a sole writer | ✅ | §1.1 ownership column; §30 write-collision analysis |
| No object is modified by two components | ✅ | Single-writer-per-layer (TS3); B3 immutable Timeline |
| Transient→Permanent boundary clearly defined | ✅ | §33 state ownership model; STOP_RECORDING boundary |
| All persisted objects are JSON-serializable | ✅ | §7.1 serialization strategy; no DOM refs in persisted data |
| AI never receives DOM-specific data | ✅ | R7 RecorderActionInfo (semantic snapshot only, L10) |

### 23.2 Component interoperability

| Check | Status | Evidence |
|-------|:------:|---------|
| Every interface has typed input/output | ✅ | §1.1 catalogue; component specs interfaces |
| No circular dependencies between components | ✅ | §34.3 dependency analysis |
| Producer/consumer relationships are documented | ✅ | Interface contracts (§32) |
| Failure propagation is bounded | ✅ | §34.4 failure propagation; blast radius analysis |

### 23.3 Algorithm correctness

| Check | Status | Evidence |
|-------|:------:|---------|
| 5-Gate decision is complete (no uncovered cases) | ✅ | Gate 5 (default click) covers all; Gate 1 covers synthetic |
| 3-tier classifier has no uncovered type | ✅ | Rule 14 default fallback (L5) |
| Locator resolution produces max 3 locators | ✅ | B4.4 §3.1 enforced |
| Same input → same output (determinism) | ✅ | B2 AP8; all algorithms are pure functions or stateless |

### 23.4 Runtime consistency

| Check | Status | Evidence |
|-------|:------:|---------|
| State machines have no invalid transitions | ✅ | §15 invalid transitions documented |
| Event ordering is guaranteed | ✅ | §18 sequential processing, monotonic IDs |
| MV3 restart recovery is defined | ✅ | §12.1 recovery algorithm |
| Race conditions are prevented | ✅ | §17.3 race condition table |

### 23.5 Scalability

| Metric | Current Capacity | Bottleneck | Mitigation |
|--------|-----------------|-----------|------------|
| Events per session | ~500 practical | chrome.storage.local write time | Batch writes |
| Timeline array size | ~500 entries | Array serialization time | Not yet a problem |
| Screenshots | ~100 (quota) | Storage quota (10MB default) | Compress, clear old |
| AI calls per session | ~500 | Provider rate limits | Non-blocking, skip on failure |
| Generation time | < 5s for 500 actions | Locator resolution per step | Acceptable |

---

## 24. Recommendations

### Recommendation 1: Formalize AppMessage union completeness

**Issue:** The `AppMessage` union in `types.ts` is missing `DATE_SELECT_CAPTURED`. This was flagged by the reviewer in C6.2 and again in Component Technical Specs.

**Recommendation:** Add the missing message type. Add to `isAppMessage()` type guard. This is a type-completeness fix, not an architectural change.

### Recommendation 2: Extract shared content script utilities

**Issue:** ~200 lines of utility code are duplicated across 6 content scripts (extractIdentity, skip selectors, ownership checks, icon detection).

**Recommendation:** Extract into `src/recorder/shared/recorder-utils.ts`. Reduces duplication and ensures consistency. No architectural impact.

### Recommendation 3: Add schema version field to persisted objects

**Issue:** Currently, persisted objects (SessionEvent, TestStep, RepositoryTestCase) have no schema version. If a breaking change is ever needed, there's no migration path.

**Recommendation:** Add `schemaVersion: number` to persisted objects. Start at 1. Future migrations check this field. Not needed now but prevents future data loss.

### Recommendation 4: Document the Semantic Interaction → Execution Verb mapping as a frozen table

**Issue:** The mapping from 10 canonical types to execution verbs (click→"click", fill→"fill", selectDate→"fill", etc.) is currently implicit in the Execution JSON Generator code.

**Recommendation:** Create an explicit mapping table document and freeze it alongside B5.2. This prevents ambiguity about which verb each type maps to.

---

## 25. Freeze Declaration

### 25.1 Engineering specifications frozen

This document constitutes the complete engineering specification for CmdRunner's data contracts, processing logic, and runtime behaviour. It is consistent with and preserves all previously frozen milestones.

### 25.2 Key engineering decisions frozen

| # | Decision | Status |
|---|----------|--------|
| E1 | 42 shared objects with sole-writer ownership | Frozen |
| E2 | JSON-only serialization; additive versioning | Frozen |
| E3 | 5-Gate event capture (fully deterministic) | Frozen |
| E4 | 3-tier semantic classification (deterministic→advisory→default) | Frozen |
| E5 | AI never makes final decisions (advisory only) | Frozen |
| E6 | Generation pipeline is fully deterministic (Stage 3a→5) | Frozen |
| E7 | TC lifecycle state machine (8 states, defined transitions) | Frozen |
| E8 | MV3 restart recovery (session restore from storage) | Frozen |
| E9 | Race condition prevention via ownership protocol | Frozen |
| E10 | Strict downward information flow (no upward deps) | Frozen |

### 25.3 Compatibility verification

| Frozen Milestone | Preserved |
|-----------------|:---------:|
| Product Foundation v1.0 (PA1-PA12) | ✅ |
| Product Architecture Design | ✅ |
| Artifact Pipeline (B1-B8) | ✅ |
| B5.2 Execution JSON Contract | ✅ |
| B4.4 Locator Priority Strategy | ✅ |
| C3-C6 Interaction Recorders | ✅ |
| E2E Recording Architecture | ✅ |
| AI Observer Architecture | ✅ |
| Mental Model Architecture | ✅ |
| AI Philosophy (P1-P8) | ✅ |
| Semantic Interaction Language (L1-L14) | ✅ |
| Semantic Interaction Language Validation | ✅ |
| Component Technical Specifications (TS1-TS10) | ✅ |
| Execution JSON Evolution (Option D) | ✅ |
| Intelligent Automation Generation | ✅ |

### 25.4 Engineering readiness verdict

The engineering specifications are **implementation-ready**. Every data contract, algorithm, state machine, and runtime behaviour is defined with sufficient detail for consistent implementation across engineering teams.

---

*End of Phase 2 Engineering Specifications — Milestone 9 (42 data models), Milestone 10 (15 algorithms + AI/deterministic matrix), Milestone 11 (3 state machines + 3 pipelines + concurrency + guarantees), Cross-Phase Review (5 consistency checks + 4 recommendations), 10 frozen engineering decisions.*

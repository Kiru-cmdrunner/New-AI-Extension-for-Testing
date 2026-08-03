# Architecture Milestone — AI Observer & Session Context Design

**Status:** Architecture design — validated and frozen  
**Date:** 2026-07-17  
**Scope:** AI Observer responsibilities, Session Context architecture, reasoning model, confidence model  
**Constraint:** No implementation. No redesign of the validated E2E Recording Architecture. All frozen milestones preserved. LLM-independent design.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [AI Observer Responsibilities](#2-ai-observer-responsibilities)
3. [Session Context Architecture](#3-session-context-architecture)
4. [Session Context Lifecycle](#4-session-context-lifecycle)
5. [AI Reasoning Model](#5-ai-reasoning-model)
6. [Confidence Model](#6-confidence-model)
7. [AI and Deterministic Recording Separation](#7-ai-and-deterministic-recording-separation)
8. [AI Constraints](#8-ai-constraints)
9. [Session Context and Semantic Interaction Generation](#9-session-context-and-semantic-interaction-generation)
10. [Scalability for Future Interaction Types](#10-scalability-for-future-interaction-types)
11. [AI Operating Philosophy Validation](#11-ai-operating-philosophy-validation)
12. [Implementation Architecture](#12-implementation-architecture)
13. [Consistency Review Against Frozen Milestones](#13-consistency-review-against-frozen-milestones)
14. [Freeze Declaration](#14-freeze-declaration)

---

## 1. Executive Summary

### Verdict

The proposed AI Observer and Session Context design is **validated as architecturally sound and frozen** as the canonical reference for AI behavior during recording. The operating philosophy — **Observe continuously. Understand progressively. Preserve facts. Generate meaning later.** — is confirmed as the correct long-term direction.

The design is **LLM-independent**: it specifies what the system expects AI to reason about and what structure the Session Context holds, without prescribing prompt engineering, model choice, or provider-specific capabilities.

### Key architectural decisions

| # | Decision |
|---|----------|
| 1 | AI Observer operates per-interaction (not continuously calling AI), but maintains a continuously-updated deterministic state tracker |
| 2 | Session Context is a transient, in-storage data structure with three layers: Deterministic State, AI Understanding, and Action History |
| 3 | AI answers five reasoning domains: Application Identity, Workflow Progression, Current UI Focus, User Intent, and Change Analysis |
| 4 | Confidence is multi-dimensional (five tracks), each with independent evidence accumulation and thresholds |
| 5 | AI never modifies, deletes, merges, reorders, classifies, or generates execution artifacts — it only provides understanding |
| 6 | Session Context is consumed by Stage 3a (Semantic Classification) as an optional enrichment input, never as the sole decision-maker |
| 7 | All Session Context state is persisted to `chrome.storage.local` (MV3-safe) |
| 8 | The system is fully functional without AI — deterministic evidence rules produce correct results alone |

### What this milestone defines (that the E2E Architecture did not)

The validated E2E Architecture (frozen milestone `milestone-e2e-architecture-validation.md`) established:
- Five pipeline stages
- AI operates at Stages 2, 3a, and 4b
- Mental Model is transient and consumed by Stage 3a
- AI never modifies recorded actions

**This milestone adds the internal architecture of the AI Observer and Session Context** — what data structures exist, how AI reasons, how confidence works, and how the Session Context flows into semantic classification. It is the detailed design of Stage 2's AI Observer component and the data it produces for Stage 3a.

---

## 2. AI Observer Responsibilities

### 2.1 Responsibility Matrix

| Responsibility | Owner | Rationale |
|---------------|-------|-----------|
| Capture browser events (click, change, focus, blur, mouseenter, keydown) | **Deterministic Recorder** | Raw facts. No interpretation. |
| Extract element identity (18-field ElementIdentity) | **Deterministic Recorder** | Mechanical DOM extraction. No AI. |
| Capture value before/after snapshots | **Deterministic Recorder** | Factual state diff. No AI. |
| Capture CSS class changes | **Deterministic Recorder** | Factual observation. No AI. |
| Capture DOM mutations (child list, visibility, attribute) | **Deterministic Recorder** | Factual observation. No AI. |
| Determine interaction TYPE (click, select, dateSelect, hover, etc.) | **Deterministic Classifier** (Stage 3a) | Must be reproducible. Evidence rules decide. |
| Extract accessible name, ARIA role, CSS selector, XPath | **Deterministic Recorder** | Mechanical extraction. No AI. |
| Track current page URL and title | **Deterministic State Tracker** | Factual. `chrome.webNavigation` + `chrome.tabs`. |
| Track open UI elements (which dialogs/menus/dropdowns are currently visible) | **Deterministic State Tracker** | DOM observation (MutationObserver). Factual. |
| Identify which application is being used | **AI Observer** | Requires inference (URL patterns, page content, branding). |
| Identify which feature/workflow is active | **AI Observer** | Requires inference (form context, page structure, action sequence). |
| Infer user intent | **AI Observer** | The core AI value proposition. |
| Track workflow progression | **AI Observer** | Requires understanding of sequences and goals. |
| Assess confidence in understanding | **AI Observer** | Self-assessment is inherently AI. |
| Provide business names for elements | **AI Observer** | Semantic naming requires understanding context. |
| Classify control type (Button, Link, Dropdown, Calendar) | **AI Observer** (advisory) | AI can suggest, but the deterministic classifier decides the interaction type. |
| Generate hypotheses about upcoming actions | **AI Observer** | Predictive understanding improves naming and context. |

### 2.2 The critical boundary: Deterministic vs AI

The separation principle is:

> **If the answer can be obtained by reading the DOM or browser APIs, it is deterministic. If the answer requires reasoning about purpose, context, or human intent, it belongs to AI.**

This creates a clean test:
- "What tag is this element?" → Deterministic (`element.tagName`)
- "What is this element called?" → AI (requires understanding context)
- "Did this element's value change?" → Deterministic (before/after comparison)
- "Is this value change a date selection?" → Deterministic classifier (date pattern matching)
- "Why did the user select this date?" → AI (requires understanding workflow)
- "Is a dialog currently open?" → Deterministic (DOM visibility check)
- "What workflow is this dialog part of?" → AI (requires inference)

### 2.3 What AI does NOT determine

AI does NOT determine:
1. **Interaction type.** The deterministic classifier (Stage 3a) assigns type from evidence rules. AI may suggest a type as a hint, but evidence rules always have priority.
2. **Element identity.** The 18-field ElementIdentity is extracted mechanically by the recorder.
3. **Whether an action is recorded.** The recorder captures all events. The classifier decides what becomes a typed interaction. AI has no voice in this.
4. **Execution strategy.** The execution-json-generator (Stage 4a) applies deterministic locator resolution and action mapping.
5. **Playwright code.** The playwright-generator (Stage 5) is deterministic.

### 2.4 Validated responsibilities

The proposed responsibilities are validated with one refinement:

**Refinement:** "Observe UI state changes" must be split into:
- **Deterministic UI state tracking** — which elements are visible, which dialogs are open, which menus are expanded. This is DOM observation, not AI.
- **AI interpretation of UI state changes** — what the state change means in the context of the workflow. This is AI.

The proposed architecture lists "Observe UI state changes" under AI Observer, but the observation itself is deterministic. Only the interpretation is AI.

---

## 3. Session Context Architecture

### 3.1 Design principle

The Session Context is the **single transient data structure** that holds everything the system knows about the recording session — both deterministic facts and AI-derived understanding. It exists from Start Recording to Stop Recording, is persisted to `chrome.storage.local` (MV3-safe), and is consumed by Stage 3a before being discarded.

### 3.2 Three-layer structure

The Session Context has three layers, each with a different owner and mutability profile:

```
┌─────────────────────────────────────────────────────┐
│                 SESSION CONTEXT                       │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 1: DETERMINISTIC STATE                  │  │
│  │  (Owned by: Deterministic State Tracker)       │  │
│  │  (Updated: After every DOM event/navigation)   │  │
│  │  (AI CANNOT write to this layer)               │  │
│  │                                                │  │
│  │  • Current URL and page title                  │  │
│  │  • Open UI elements (dialogs, menus, dropdowns)│  │
│  │  • Active form context (if any)                │  │
│  │  • Visible calendar/picker (if any)            │  │
│  │  • DOM mutation log (summarized)               │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 2: AI UNDERSTANDING                     │  │
│  │  (Owned by: AI Observer)                       │  │
│  │  (Updated: After each AI reasoning cycle)      │  │
│  │  (Deterministic code CANNOT write to this)     │  │
│  │                                                │  │
│  │  • Application identity                        │  │
│  │  • Active feature and workflow                 │  │
│  │  • User intent (primary + alternatives)        │  │
│  │  • Workflow step progression                   │  │
│  │  • Confidence scores (5 tracks)                │  │
│  │  • Business names for interacted elements      │  │
│  │  • Change analysis (what the last action did)  │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  LAYER 3: ACTION HISTORY                       │  │
│  │  (Owned by: Recorder — write-once, immutable)  │  │
│  │  (Updated: When each action is committed)      │  │
│  │  (NEITHER AI NOR deterministic code modifies)  │  │
│  │                                                │  │
│  │  • Chronological list of captured actions      │  │
│  │  • Each action's element identity              │  │
│  │  • Each action's evidence (value, state, etc.) │  │
│  │  • Timestamps                                  │  │
│  │  • This IS the Interaction Timeline (raw)      │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 3.3 Layer 1: Deterministic State

This layer tracks the **current browser/DOM state** mechanically. It is updated by deterministic code (not AI) after every relevant DOM event.

```typescript
interface DeterministicState {
  // ── Page Context ──
  currentUrl: string;
  currentTitle: string;
  previousUrl: string | null;           // for detecting navigation type

  // ── Open UI Elements ──
  openDialogs: string[];                // accessible names or selectors of open dialogs
  openMenus: string[];                  // accessible names or selectors of open menus
  openDropdowns: string[];              // accessible names or selectors of open dropdowns
  openCalendars: string[];              // accessible names or selectors of visible calendars
  visibleOverlays: string[];            // any overlay elements (modals, popovers, tooltips)

  // ── Form Context ──
  activeFormLabel: string | null;       // accessible name of the nearest <form> ancestor
  activeFormFields: string[];           // field names/labels within the active form

  // ── Mutation Summary ──
  lastMutationSummary: {
    childListAdded: number;
    childListRemoved: number;
    attributeChanges: number;
    visibilityChanges: number;
    observedAt: string;                 // ISO timestamp
  } | null;
}
```

**Why this is deterministic:** Every field is obtained by reading the DOM. No inference is required. `openDialogs` is populated by querying for `[role="dialog"]:not([hidden])`, `openMenus` by `[role="menu"]:not([hidden])`, etc.

**Why this is NOT AI:** The question "is a dialog open?" is a DOM query. The question "what workflow is this dialog part of?" is AI. Layer 1 answers the former; Layer 2 answers the latter.

### 3.4 Layer 2: AI Understanding

This layer holds the **AI-derived contextual understanding**. It is updated by the AI Observer after each AI reasoning cycle (triggered per captured interaction). This is the "Mental Model" from the E2E Architecture validation — renamed to "AI Understanding" for clarity and to avoid confusion with cognitive science terminology.

```typescript
interface AIUnderstanding {
  // ── Application Identity ──
  applicationName: string | null;       // "Adani One", "OrangeHRM", "Salesforce"
  applicationCategory: string | null;   // "Travel Booking", "HR Management", "CRM"
  applicationConfidence: number;        // 0.0 - 1.0

  // ── Workflow Understanding ──
  activeFeature: string | null;         // "Flight Search", "Leave Management", "Lead Creation"
  activeWorkflow: string | null;        // "Booking a one-way flight", "Applying for annual leave"
  workflowStep: string | null;          // "Selecting departure date", "Filling personal details"
  workflowConfidence: number;           // 0.0 - 1.0

  // ── Current UI Focus ──
  currentScreenDescription: string | null;  // "Flight search results page with filters"
  currentComponentDescription: string | null; // "Date picker calendar showing July 2026"
  uiFocusConfidence: number;            // 0.0 - 1.0

  // ── User Intent ──
  primaryIntent: string | null;         // "The user is booking a flight from Mumbai to Delhi"
  alternativeIntents: string[];         // ["The user is checking flight prices without booking"]
  intentEvidence: string[];             // ["Entered departure city Mumbai", "Selected one-way trip"]
  intentConfidence: number;             // 0.0 - 1.0

  // ── Change Analysis ──
  lastActionEffect: string | null;      // "Opened the departure date calendar"
  predictedNextAction: string | null;   // "Likely to select a date from the calendar"
  changeConfidence: number;             // 0.0 - 1.0

  // ── Element Naming Cache ──
  elementNames: Record<string, {        // keyed by actionId
    businessName: string;
    controlType: string;
    namingConfidence: number;
  }>;

  // ── Overall ──
  overallConfidence: number;            // weighted average of the 5 tracks
  lastUpdatedAt: string;                // ISO timestamp of last AI reasoning cycle
  reasoningEnabled: boolean;            // false if AI is not configured
}
```

**Key design decisions:**

1. **Confidence is multi-dimensional.** Five independent tracks (Application, Workflow, UI Focus, Intent, Change Analysis) each carry their own confidence. This prevents a single weak area from dragging down the overall score and lets the classifier weight different dimensions differently.

2. **Alternative intents are first-class.** The system explicitly tracks multiple hypotheses. This prevents premature commitment and lets the classifier use intent as a tie-breaker only when confidence is high.

3. **Element naming is cached.** The current implementation already names elements via AI (`AIService.understand()`). This is preserved as a cache within the AI Understanding layer — each element's business name is stored once and referenced by the classifier.

4. **Predictive understanding.** `predictedNextAction` helps the classifier in two ways: (a) if the prediction matches the next captured action, intent confidence increases; (b) it helps the readability optimizer group related steps.

### 3.5 Layer 3: Action History

This layer is the **raw Interaction Timeline** — the immutable factual record. It is identical to the current `session.events` array.

**This layer is write-once.** Neither AI nor deterministic code modifies, deletes, merges, or reorders entries. This is the B3 immutability invariant.

The Action History is included within Session Context (rather than being separate) because the AI Observer needs to read it to build understanding. But it can only read — never write.

### 3.6 What is deliberately NOT in Session Context

| Excluded Item | Why |
|---------------|-----|
| Interaction type assignments | Determined by Stage 3a classifier, not during recording |
| Canonical Test Step data | Generated after Stop, not during recording |
| Execution JSON | Generated after Stop |
| Playwright code | Generated after Stop |
| Element locators (CSS, XPath) | These are in ElementIdentity (Layer 3), not AI-derived |
| Raw screenshots | Stored separately by ScreenshotService |
| User editable metadata (test case name, expected result) | Lives on TestCaseDraft, not Session Context |

---

## 4. Session Context Lifecycle

### 4.1 Lifecycle stages

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  CREATED                                                     │
│  │  Trigger: User clicks "Start Recording"                  │
│  │  Action:  Initialize empty Session Context               │
│  │           Layer 1: Capture initial URL, title, DOM state │
│  │           Layer 2: Empty (no AI reasoning yet)           │
│  │           Layer 3: Empty (no actions yet)                │
│  │           Persist to chrome.storage.local                │
│  │                                                          │
│  ▼                                                          │
│  EVOLVING (during recording)                                 │
│  │  Trigger: Each captured interaction + each navigation   │
│  │                                                          │
│  │  For each interaction:                                   │
│  │    1. Recorder appends to Layer 3 (immutable)           │
│  │    2. State Tracker updates Layer 1 (deterministic)     │
│  │    3. AI Observer updates Layer 2 (async, per-action)   │
│  │                                                          │
│  │  Update frequency:                                       │
│  │    Layer 1: Every DOM event (synchronous, <1ms)         │
│  │    Layer 2: Every captured interaction (async, <2s)     │
│  │    Layer 3: Every captured interaction (synchronous)    │
│  │                                                          │
│  │  Persistence: All layers persisted to storage on        │
│  │  every update (MV3 service worker safety)               │
│  │                                                          │
│  ▼                                                          │
│  CONSUMED                                                    │
│  │  Trigger: User clicks "Stop Recording"                  │
│  │  Action:  Session Context handed to Stage 3a            │
│  │           (Semantic Classification)                     │
│  │                                                          │
│  │  Stage 3a reads:                                        │
│  │    • Layer 3 (Action History) → evidence for rules      │
│  │    • Layer 1 (Deterministic State) → ancestor context   │
│  │    • Layer 2 (AI Understanding) → optional hints        │
│  │                                                          │
│  │  Stage 3b reads:                                        │
│  │    • Layer 2 (elementNames) → plain English display     │
│  │                                                          │
│  ▼                                                          │
│  DISCARDED                                                   │
│     Trigger: After Stage 3 consumption completes           │
│     Action:  Session Context removed from storage          │
│               Only the Interaction Timeline (typed),       │
│               Recording Context, and Screenshots           │
│               cross into the Permanent Zone                │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Lifecycle validation

The proposed lifecycle (Created → Updated → Refined → Consumed → Discarded) is **validated as appropriate.**

**One refinement:** The proposed lifecycle says "Updated after each observed action" and "Refined as additional evidence becomes available." These are the same operation — the AI Observer runs one reasoning cycle per captured interaction, which both updates and refines. The two should be merged into one step: "Updated after each captured interaction."

### 4.3 MV3 service worker lifecycle interaction

Chrome MV3 service workers can be terminated after 30 seconds of inactivity and restarted on the next event. This affects Session Context:

| Event | What Happens |
|-------|-------------|
| Service worker terminated mid-session | Session Context is in `chrome.storage.local` — safe |
| Service worker restarted (new event arrives) | Session Context is rehydrated from storage — transparent |
| AI call in progress when SW terminates | AI call is lost. On restart, the AI Observer detects the gap (last AI update timestamp < last action timestamp) and re-runs reasoning for the most recent action |
| Layer 1 state on restart | DOM state is stale (SW was asleep). State Tracker re-reads the DOM on the next event |

**Design decision:** Session Context is always persisted to `chrome.storage.local` on every update. This is the same pattern the current `RecordingSession` uses for `session.events`.

---

## 5. AI Reasoning Model

### 5.1 The reasoning framework

Rather than asking AI to classify interactions, the AI Observer asks AI to answer **five reasoning domains** after each captured interaction. These domains are independent — each can be answered without the others, and each carries its own confidence.

```
┌─────────────────────────────────────────────────────┐
│              AI REASONING DOMAINS                     │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  1. APPLICATION IDENTITY                     │    │
│  │  "What application is the user using?"       │    │
│  │  Evidence: URL, page title, branding,        │    │
│  │  form structure, navigation patterns         │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  2. WORKFLOW PROGRESSION                     │    │
│  │  "What workflow is the user executing        │    │
│  │   and how far along are they?"               │    │
│  │  Evidence: Action sequence, page changes,    │    │
│  │  form progress, dialog/menu navigation       │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  3. CURRENT UI FOCUS                         │    │
│  │  "What screen/component is the user          │    │
│  │   currently interacting with?"               │    │
│  │  Evidence: Current DOM state (Layer 1),      │    │
│  │  open dialogs/menus/dropdowns, element       │    │
│  │  tag/role/name                               │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  4. USER INTENT                              │    │
│  │  "What is the user trying to accomplish?"    │    │
│  │  Evidence: Action history, workflow context, │    │
│  │  element semantics, form patterns            │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
│  ┌─────────────────────────────────────────────┐    │
│  │  5. CHANGE ANALYSIS                          │    │
│  │  "What did the last action change, and       │    │
│  │   what is the user likely to do next?"       │    │
│  │  Evidence: Before/after DOM state, value     │    │
│  │  changes, mutation summary, visible state    │    │
│  └─────────────────────────────────────────────┘    │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 5.2 The reasoning questions (validated and refined)

The proposed questions are evaluated below:

| Proposed Question | Domain | Validated? | Refinement |
|---|---|---|---|
| What application is currently being used? | Application Identity | ✅ | — |
| What feature is active? | Workflow Progression | ✅ | Merge with "What workflow is active?" |
| What workflow is currently being executed? | Workflow Progression | ✅ | Merge with feature question |
| What screen is currently visible? | Current UI Focus | ✅ | — |
| Which UI component is active? | Current UI Focus | ✅ | — |
| What changed after the previous action? | Change Analysis | ✅ | — |
| What appears to be the user's objective? | User Intent | ✅ | Rename to "intent" for consistency |
| What evidence supports this understanding? | (Cross-cutting) | ✅ | **ADD: evidence must always be cited** |
| What alternative interpretations exist? | User Intent | ✅ | **ADD: alternatives are first-class** |
| How confident is the current understanding? | (Cross-cutting) | ✅ | Multi-dimensional, not a single score |

**Two additions recommended:**

| Additional Question | Domain | Why |
|---|---|---|
| What is the user likely to do next? | Change Analysis | Predictive context improves element naming and step grouping. Does NOT affect classification — the classifier only uses evidence. |
| Has the workflow context changed since the last interaction? | Workflow Progression | Detects workflow transitions (e.g., user finished login, now searching for flights). Prevents stale context. |

### 5.3 Reasoning cadence

**AI reasoning is triggered once per captured interaction.** This is the same cadence as the current `AIService.understand()` call.

```
User clicks an element
  → Recorder captures event → appends to Layer 3
  → State Tracker updates Layer 1 (DOM state)
  → AI Observer triggered:
      → Reads Layer 1 (current state) + Layer 3 (action history)
      → Sends semantic snapshot to AI (NOT raw selectors)
      → AI returns updated Layer 2 (5 domains + confidence)
      → Layer 2 persisted to storage
  → Side panel renders timeline entry (with AI name if available)
```

**What triggers AI reasoning:**
- Each captured interaction (click, text, hover, checkbox, radio, select, dateSelect)
- Each navigation event

**What does NOT trigger AI reasoning:**
- Mouse movement (not a captured interaction)
- DOM mutations (tracked deterministically in Layer 1, not AI)
- Service worker restarts (reasoning is NOT re-run for past actions on restart)

### 5.4 What AI receives (the reasoning input)

The AI Observer sends the AI a **semantic snapshot** — not raw DOM selectors, not CSS, not XPath. This is consistent with the Phase 2 architecture's `SnapshotForAI` model:

```typescript
interface ReasoningInput {
  // ── Current Interaction ──
  currentAction: {
    actionType: string;           // 'click', 'text', 'select', 'dateSelect', etc.
    elementTag: string;
    elementRole: string | null;
    elementName: string;          // accessible name
    elementClass: string | null;
    valueChanged: boolean;
    newValue: string | null;
  };

  // ── Recent Action Sequence (last 5) ──
  recentActions: Array<{
    actionType: string;
    elementName: string;
    valueChanged: boolean;
    timestamp: string;
  }>;

  // ── Current DOM State (from Layer 1) ──
  currentUrl: string;
  pageTitle: string;
  openDialogs: string[];
  openMenus: string[];
  openDropdowns: string[];
  activeFormLabel: string | null;

  // ── Previous AI Understanding (from Layer 2) ──
  previousApplication: string | null;
  previousWorkflow: string | null;
  previousIntent: string | null;
  previousIntentConfidence: number;

  // ── Mutation Summary ──
  lastMutation: {
    childListChanges: number;
    visibilityChanges: number;
  } | null;
}
```

**What is NOT sent to AI:** CSS selectors, XPath, element IDs, data-testid, iframe context, shadow DOM details, raw HTML. AI reasons from semantics, not mechanics.

### 5.5 What AI returns (the reasoning output)

The AI returns an updated `AIUnderstanding` object (Layer 2). The five domains, their confidence scores, alternative intents, and element names.

The return is **validated** by the AI Observer before being persisted:
- Confidence scores are clamped to [0.0, 1.0]
- String fields are sanitized (length-limited, no HTML injection)
- If the response is unparseable, the previous Layer 2 state is preserved (graceful degradation)

### 5.6 Reasoning without AI

When AI is not configured (`reasoningEnabled: false`), Layer 2 remains empty. The system operates identically — the recorder captures facts, the classifier uses evidence rules, and the generation pipeline produces artifacts. The only difference is that element names fall back to accessible names or tag-based heuristics (current behavior).

---

## 6. Confidence Model

### 6.1 Design principles

1. **Confidence is multi-dimensional.** Five independent tracks, each measuring a different aspect of understanding.
2. **Confidence grows with evidence.** More interactions in the same workflow = higher confidence.
3. **Confidence can decrease.** If an action contradicts the current hypothesis, confidence drops.
4. **Confidence is never absolute.** The system avoids `1.0` (certain) and `0.0` (impossible). Maximum practical confidence is 0.95; minimum is 0.05.
5. **Confidence guides classifier usage.** AI hints are used by the classifier only when evidence rules are ambiguous (confidence 0.5–0.9).

### 6.2 The five confidence tracks

| Track | What It Measures | Starting Confidence | Growth Pattern |
|-------|-----------------|--------------------|----------------- |
| Application Identity | "Am I sure what app this is?" | 0.3 (initial guess from URL) | +0.15 per consistent action, max 0.95 |
| Workflow Progression | "Am I sure what workflow this is?" | 0.2 (no evidence yet) | +0.10 per consistent action, -0.15 on contradiction |
| UI Focus | "Am I sure what screen/component is active?" | 0.5 (DOM state is available) | +0.10 per consistent interaction |
| User Intent | "Am I sure what the user wants?" | 0.15 (very uncertain initially) | +0.10 per supporting action, -0.20 on contradiction |
| Change Analysis | "Am I sure what the last action did?" | 0.4 (some DOM evidence) | +0.15 per correctly predicted next action |

### 6.3 Confidence thresholds and their effects

| Threshold | What It Means | System Behavior |
|-----------|--------------|-----------------|
| ≥ 0.85 | High confidence | AI hints may override ambiguous evidence rules. Element names from AI are preferred. Predicted next action is shown in timeline. |
| 0.60 – 0.85 | Moderate confidence | AI hints are used as tie-breakers when evidence rules are ambiguous. AI element names are used but marked with a confidence indicator. |
| 0.35 – 0.60 | Low confidence | AI hints are informational only. Evidence rules decide. AI element names used only if no accessible name exists. |
| < 0.35 | Very low confidence | AI hints are ignored for classification. AI element names not displayed (fallback to accessible name). Intent hypotheses not surfaced. |
| 0.0 (AI disabled) | No AI | System operates on evidence-only rules. Fully functional. |

### 6.4 Confidence update algorithm (per reasoning cycle)

```
For each confidence track:
  1. Read previous confidence value
  2. Read AI's new assessment for this track
  3. Apply evidence-weighted update:
       newConfidence = (previousConfidence × weight) + (aiAssessment × (1 - weight))
       where weight = 0.3 (previous state) and (1 - weight) = 0.7 (new evidence)
  4. If AI detects a contradiction (new action inconsistent with hypothesis):
       newConfidence = newConfidence × 0.5 (penalty)
  5. Clamp to [0.05, 0.95]
  6. Persist
```

**Design rationale:** The 0.3/0.7 weighting means new evidence dominates but previous understanding provides stability. A single unexpected action doesn't destroy confidence, but a clear pattern shift does.

### 6.5 Handling uncertainty

**AI must never claim certainty when evidence is insufficient.** The system enforces this:

1. **Confidence ceiling at 0.95.** Even with overwhelming evidence, the system never reports 1.0. This prevents over-reliance on AI.

2. **Alternative intents are required when intent confidence < 0.7.** The AI must provide at least one alternative hypothesis. This prevents premature commitment.

3. **Contradiction detection.** If a new action is inconsistent with the current primary intent, intent confidence is halved. The system then re-evaluates.

4. **Evidence citation.** Every understanding claim must include `intentEvidence` — what observed actions support this interpretation. If no evidence exists, confidence is capped at 0.3.

### 6.6 Overall confidence

Overall confidence is a weighted average, not a simple mean:

```
overallConfidence = (
  applicationConfidence  × 0.15 +
  workflowConfidence     × 0.25 +
  uiFocusConfidence      × 0.15 +
  intentConfidence       × 0.35 +
  changeConfidence       × 0.10
)
```

**Rationale:** Intent (35%) and Workflow (25%) carry the most weight because they have the highest impact on semantic understanding. Application Identity (15%) and UI Focus (15%) are important but secondary. Change Analysis (10%) is the most volatile and carries the least weight.

---

## 7. AI and Deterministic Recording Separation

### 7.1 Validated separation

The proposed separation is **validated as correct and appropriate:**

| Aspect | Recorder (Deterministic) | AI Observer |
|--------|-------------------------|-------------|
| What it captures | Browser events, element identity, value changes, state transitions, DOM mutations | Nothing — it reads what the recorder captures |
| What it stores | Raw facts in Layer 3 (immutable) | Understanding in Layer 2 (evolving) |
| Can it modify facts? | **NO** — facts are write-once | **NO** — AI cannot touch Layer 3 |
| Can it modify understanding? | **NO** — deterministic code cannot write to Layer 2 | **YES** — this is AI's sole output |
| What happens without it? | System is broken — no recording | System works — evidence-only classification |
| Failure mode | Missing interactions (detection gap) | Missing context (naming fallback to accessible name) |
| Timing | Synchronous (capture phase) | Asynchronous (non-blocking, <2s budget) |
| MV3 persistence | `chrome.storage.local` (session events) | `chrome.storage.local` (session context) |

### 7.2 The write-protection boundary

```
Layer 1 (Deterministic State)     → Written by: State Tracker ONLY
Layer 2 (AI Understanding)        → Written by: AI Observer ONLY
Layer 3 (Action History)          → Written by: Recorder ONLY (write-once)
```

**This write-protection is an architectural invariant.** No component writes to a layer it doesn't own. This prevents:
- AI contaminating the factual record
- Deterministic code making assumptions about intent
- Race conditions between AI and recorder

### 7.3 Read access

| Component | Can Read Layer 1 | Can Read Layer 2 | Can Read Layer 3 |
|-----------|:----------------:|:----------------:|:----------------:|
| Recorder | ❌ (doesn't need it) | ❌ | ✅ (writes only) |
| State Tracker | ✅ (reads previous state) | ❌ | ❌ |
| AI Observer | ✅ (reads current state) | ✅ (reads previous understanding) | ✅ (reads action history) |
| Stage 3a Classifier | ✅ | ✅ (optional hints) | ✅ (evidence) |
| Stage 3b Step Generator | ❌ | ✅ (element names only) | ✅ |
| Side Panel (display) | ❌ | ✅ (display understanding) | ✅ (display timeline) |

---

## 8. AI Constraints

### 8.1 Validated constraints

The proposed constraints are **validated with two additions:**

| Constraint | Status | Rationale |
|-----------|--------|-----------|
| AI must never modify recorded actions | ✅ Validated | B3 immutability |
| AI must never delete actions | ✅ Validated | B3 immutability |
| AI must never merge actions | ✅ Validated | B3 immutability |
| AI must never reorder actions | ✅ Validated | B3 immutability |
| AI must never generate Playwright | ✅ Validated | PA5, PA8 — deterministic generation |
| AI must never generate Execution JSON | ✅ Validated | PA5 — deterministic generation |
| AI must never replace deterministic evidence | ✅ Validated | Evidence is factual |
| AI must never override deterministic decisions | ✅ Validated | Deterministic classifier has final word |
| **AI must never determine interaction type** | ✅ **ADDED** | Type assignment is the classifier's exclusive domain |
| **AI must never block the recording pipeline** | ✅ **ADDED** | AI is async and non-blocking. If AI takes >2s, the pipeline continues without it |

### 8.2 The positive constraint

In addition to the negative constraints ("AI must never..."), there is one positive constraint:

> **AI must always provide evidence for its claims.**

Every understanding assertion must include `intentEvidence` — a list of observed actions or DOM states that support the assertion. If AI cannot cite evidence, its confidence is capped at 0.3 and its hints are ignored by the classifier.

This ensures the system's understanding is **traceable and auditable.** A user reviewing a recording can see not just what AI understood, but why.

### 8.3 Constraint enforcement

Constraints are enforced architecturally, not by convention:

| Constraint | Enforcement Mechanism |
|-----------|----------------------|
| AI cannot modify Layer 3 | Layer 3 has no write API exposed to the AI Observer. The AI Observer receives a read-only reference. |
| AI cannot determine interaction type | The Stage 3a classifier does not read `suggestedType` from AI Understanding. It reads evidence fields. AI hints are a separate input channel used only for confidence adjustment. |
| AI cannot block the pipeline | AI calls are wrapped in a Promise.race with a 2-second timeout. If the timeout fires, the pipeline continues with the previous Layer 2 state. |
| AI must provide evidence | The AI Observer validates the response: if `intentEvidence` is empty and intent is non-null, confidence is forced to 0.3. |

---

## 9. Session Context and Semantic Interaction Generation

### 9.1 Validated relationship

The proposed flow:

```
Observed Action Timeline  →
Session Context           →
Deterministic Evidence    →
                          ↓
               Semantic Understanding
                          ↓
               Semantic Interaction Generation
```

Is **validated as correct** with one clarification:

### 9.2 How Stage 3a consumes Session Context

Stage 3a (Semantic Classification) receives three inputs:

```
┌─────────────────────────────────────────────────────┐
│  INPUT 1: Action History (Layer 3)                  │
│  Role: Primary evidence source                      │
│  Used by: All 14 classifier rules                   │
│  Each rule tests: "Does this action's evidence      │
│  match my conditions?"                              │
│  (value changes, state changes, ancestor context,   │
│  DOM mutations, dwell time, etc.)                   │
└─────────────────────────────────────────────────────┘
                        │
                        │ combined with
                        ▼
┌─────────────────────────────────────────────────────┐
│  INPUT 2: Deterministic State (Layer 1)             │
│  Role: Environmental context                        │
│  Used by: Rules that need ancestor context          │
│  (e.g., "is this inside a calendar?" →              │
│   Layer 1 openCalendars)                            │
│  Also: Snapshot Coalescer uses Layer 1 mutations    │
│  to group related events                            │
└─────────────────────────────────────────────────────┘
                        │
                        │ combined with (optionally)
                        ▼
┌─────────────────────────────────────────────────────┐
│  INPUT 3: AI Understanding (Layer 2)                │
│  Role: Optional refinement                          │
│  Used by: Classifier ONLY when evidence rules are   │
│  ambiguous (confidence 0.5–0.9)                     │
│                                                        │
│  AI hints are a SEPARATE input channel:             │
│    • AI suggests type X with confidence 0.8          │
│    • Evidence rules produce type Y with 0.6          │
│    • If AI confidence ≥ 0.85 AND evidence < 0.7:     │
│      AI hint used (tie-breaker)                     │
│    • Otherwise: evidence wins                        │
│                                                        │
│  Element names from Layer 2 are used by             │
│  Stage 3b for plain English display.                │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
               TYPED INTERACTION TIMELINE
               (each interaction has a type,
                element identity, evidence)
```

### 9.3 How Stage 3b consumes Session Context

Stage 3b (Canonical Step Generation) uses only two things from Session Context:

1. **Layer 2 `elementNames`** — for plain English descriptions ("Click the Login Button" instead of "Click the button")
2. **Layer 3 (typed Timeline)** — for step generation, numbering, and readability optimization

Stage 3b does NOT use Layer 1, workflow context, intent, or confidence. These were consumed by Stage 3a and are no longer needed.

### 9.4 The consumption boundary

After Stage 3a + 3b complete, the Session Context is **consumed and discarded.** No part of it persists into the Execution JSON, Playwright code, or Test Case.

**What persists:** Only the typed Interaction Timeline (which was derived from Layer 3 + classifier decisions) and AI enrichment stored on individual events (business names — these are already on the Timeline events, not from Session Context).

**What does NOT persist:** Workflow understanding, intent hypotheses, confidence scores, change analysis, predicted next actions, alternative intents. These were transient tools for classification — they served their purpose and are discarded.

This is consistent with the E2E Architecture validation: "The Mental Model is transient. It is consumed by Stage 3 and then discarded."

---

## 10. Scalability for Future Interaction Types

### 10.1 The test: does the AI Observer need redesign for new types?

For each future interaction type, we evaluate:

**Does the AI Observer architecture accommodate it without redesign?**

| Future Type | AI Observer Impact | Redesign Needed? |
|-------------|-------------------|------------------|
| Drag & Drop | New evidence pattern (drag start/end coordinates, drop target). AI reasons about it in Change Analysis domain. | NO — AI already receives element semantics + mutations |
| File Upload | New evidence (file input change). AI reasons about it in User Intent domain. | NO |
| Rich Text Editor | Complex contentEditable evidence. AI reasons about formatting intent. | NO — richer evidence, same reasoning model |
| Canvas | Coordinate-based evidence. AI reasons about drawn shapes. | NO — but evidence quality may be lower (AI has less to reason about) |
| Maps | Pan/zoom evidence. AI reasons about location selection. | NO — but intent inference is harder |
| Enterprise Custom Controls | Custom ARIA patterns. AI reasons from whatever semantics are available. | NO — architecture is mechanism-independent |

### 10.2 Why the architecture scales

The AI Observer's five reasoning domains are **interaction-type-agnostic.** They ask:
- What app is this? (not affected by interaction type)
- What workflow? (sequence understanding, not type-specific)
- What UI component? (reads element semantics, works for any control)
- What intent? (derived from action sequence, not type)
- What changed? (DOM diff, not type-specific)

New interaction types add:
- New evidence patterns to the **Deterministic Classifier** (Stage 3a rules)
- New registry configs to the **Interaction Type Registry** (Stage 3b)
- New action verbs to the **Execution JSON** (Stage 4)
- New Playwright mappings to the **Generator** (Stage 5)

But the AI Observer's reasoning model does NOT change. It observes the same five domains regardless of interaction type.

### 10.3 Scalability verdict

**VALIDATED.** The AI Observer architecture naturally supports all listed future interaction types without architectural redesign. The five reasoning domains are interaction-type-agnostic.

---

## 11. AI Operating Philosophy Validation

### 11.1 The proposed philosophy

> **Observe continuously. Understand progressively. Preserve facts. Generate meaning later.**

### 11.2 Validation

| Principle | Validated? | How the architecture enforces it |
|-----------|-----------|----------------------------------|
| Observe continuously | ✅ | State Tracker (Layer 1) updates on every DOM event. AI Observer reads current state on every interaction. |
| Understand progressively | ✅ | AI Understanding (Layer 2) evolves with each interaction. Confidence grows with evidence. |
| Preserve facts | ✅ | Action History (Layer 3) is write-once immutable. AI cannot modify it. |
| Generate meaning later | ✅ | Semantic classification (Stage 3a) happens post-evidence. Canonical steps (Stage 3b) are derived. Execution JSON (Stage 4) and Playwright (Stage 5) are deterministic derivations. |

### 11.3 Additional principle recommended

> **Cite evidence. Never assume.**

The architecture enforces this through:
- The evidence citation requirement (every AI claim must include supporting evidence)
- The confidence ceiling (0.95 — never absolute certainty)
- The evidence-first classifier (evidence rules always have priority over AI hints)

### 11.4 Final validated philosophy

> **Observe continuously. Understand progressively. Preserve facts. Cite evidence. Generate meaning later.**

This is confirmed as the strongest long-term architecture for CmdRunner. It:
- Preserves deterministic recording (facts are immutable)
- Leverages AI for what it's good at (contextual understanding, intent inference)
- Protects against AI failures (evidence-only baseline works without AI)
- Scales to future interaction types (reasoning is type-agnostic)
- Maintains auditability (evidence citation, confidence tracking)
- Is LLM-independent (any provider that can reason about the semantic snapshot works)

---

## 12. Implementation Architecture

### 12.1 Component map (within the existing codebase)

```
src/
  ai/
    ai-service.ts                 ← EXISTS — provider abstraction (unchanged)
    ai-understanding.ts           ← EXISTS — prompt building + response parsing
    provider-manager.ts           ← EXISTS — provider registry (unchanged)
    providers/                    ← EXISTS — 6 providers (unchanged)
    
    ai-observer.ts                ← NEW (future) — orchestrates reasoning cycles
    session-context.ts            ← NEW (future) — Session Context data structure
    state-tracker.ts              ← NEW (future) — deterministic Layer 1 tracker
  
  background/
    service-worker.ts             ← EXISTS — will wire AI Observer into processAction
  
  recorder/
    recording-session.ts          ← EXISTS — will own Session Context lifecycle
```

### 12.2 Integration with current architecture

The current implementation already has the bones of this architecture:

| This Milestone | Current Implementation | Migration |
|---------------|----------------------|-----------|
| Layer 3 (Action History) | `session.events` array (immutable) | Already exists |
| AI per-interaction | `AIService.understand()` called in `processAction()` | Already exists |
| AI understanding stored on events | `session.updateEventWithAI()` | Already exists |
| Element naming | `AIUnderstanding.businessName` | Already exists |
| Confidence | `AIUnderstanding.confidenceScore` | Exists but single-dimensional — needs expansion |
| Layer 1 (Deterministic State) | Not yet implemented — no DOM state tracker | New component |
| Layer 2 (AI Understanding) | Partially exists — only element naming, no session-level understanding | Expand |
| Session Context | Not yet — events are stored, but no unified context | New component |
| Five reasoning domains | Not yet — AI only names elements | Expand prompt |

### 12.3 Migration phases (reference only — not part of this milestone)

| Phase | What Ships | Risk |
|-------|-----------|------|
| AO-1 | Deterministic State Tracker (Layer 1) | Low — new code, no existing changes |
| AO-2 | Session Context data structure (all 3 layers) | Low — new code |
| AO-3 | Expanded AI prompt (5 reasoning domains) | Medium — prompt engineering |
| AO-4 | AI Observer wired into processAction | Medium — replaces current understand() call |
| AO-5 | Classifier reads Session Context (Stage 3a) | High — classification logic change |
| AO-6 | Remove old single-field AI enrichment | Medium — cleanup |

### 12.4 What does NOT change during migration

- `src/ai/providers/` — All 6 providers unchanged
- `src/ai/provider-manager.ts` — Registry unchanged
- `src/ai/ai-service.ts` — Provider abstraction unchanged (AI Observer calls through AIService)
- `src/generation/` — All generators unchanged
- All frozen B1-B8, C3-C6 product decisions — Unchanged
- The `AIProvider` interface — Unchanged
- The `ProviderCapabilities` system — Unchanged

---

## 13. Consistency Review Against Frozen Milestones

### 13.1 E2E Architecture Validation (milestone-e2e-architecture-validation.md)

| Frozen Decision | Alignment | Verdict |
|----------------|-----------|---------|
| Five-stage pipeline | AI Observer operates within Stage 2; Session Context consumed by Stage 3a | ✅ |
| Stage 3 split (3a Classification + 3b Steps) | Session Context feeds 3a (hints) and 3b (names) separately | ✅ |
| Mental Model is transient | Session Context is transient — consumed and discarded | ✅ |
| AI observes but never modifies | Write-protection boundary enforces this | ✅ |
| AI informs but never overrides | Confidence thresholds + evidence-first classifier enforce this | ✅ |
| AI enriches but never replaces core | Session Context never touches Execution JSON core (Layer 0) | ✅ |
| AI never directly generates code | Stage 5 is deterministic — AI absent | ✅ |
| Transient→Permanent boundary at Stop | Session Context is discarded after Stage 3 | ✅ |

### 13.2 Product Architecture PA1-PA12

| Principle | Alignment | Verdict |
|-----------|-----------|---------|
| PA2 (Single Responsibility) | Each Session Context layer has one owner | ✅ |
| PA4 (Canonical Source of Truth) | Session Context does NOT become part of source of truth | ✅ |
| PA5 (Derivation Is One-Way) | AI reads facts, derives understanding — never backward | ✅ |
| PA6 (Transient ≠ Permanent) | Session Context is explicitly transient | ✅ |
| PA9 (Additive Extensibility) | New types don't change AI Observer architecture | ✅ |
| PA10 (Minimal Coupling) | AI Observer reads from layers, doesn't couple to recorders | ✅ |

### 13.3 Phase 2 — Semantic Interaction Architecture

| Recommendation | Alignment | Verdict |
|----------------|-----------|---------|
| Evidence Collector (one unified script) | Unaffected — AI Observer reads evidence, doesn't capture | ✅ |
| Snapshot Coalescer | Uses Layer 1 mutations + Layer 3 events | ✅ |
| Semantic Classifier (14 rules) | Reads Session Context as optional input (Layer 2 hints) | ✅ |
| AI as optional input | Session Context Layer 2 is optional — system works without it | ✅ |
| Two-phase classification | Phase 1 = evidence-only; Phase 2 = AI-refined. Matches exactly. | ✅ |
| AI receives semantic subset (not raw selectors) | `ReasoningInput` sends semantics, not CSS/XPath | ✅ |

### 13.4 Current AI Implementation

| Current Component | Preserved? | Changes |
|-------------------|-----------|---------|
| `AIService.understand()` | ✅ Preserved | Called by AI Observer instead of directly by processAction |
| `AIProvider` interface | ✅ Unchanged | — |
| `ProviderManager` | ✅ Unchanged | — |
| 6 providers | ✅ Unchanged | — |
| `ProviderCapabilities` | ✅ Unchanged | — |
| `ActionElementInfo` | ✅ Preserved | Expanded into `ReasoningInput` (superset) |
| `AIUnderstanding` (current) | ✅ Preserved | Becomes `elementNames` cache within Layer 2 |
| `parseUnderstandingResponse` | ✅ Preserved | Extended to parse 5-domain response |

### 13.5 Overall consistency verdict

**ALL FROZEN DECISIONS ARE PRESERVED.** The AI Observer and Session Context architecture is fully consistent with:
- The validated E2E Recording Architecture
- Product Architecture PA1-PA12
- Phase 2 Semantic Interaction Architecture
- The current AI implementation (additive expansion, not replacement)
- All frozen B1-B8 and C3-C6 milestones

---

## 14. Freeze Declaration

The following architectural decisions from this milestone are declared **frozen**:

| # | Decision |
|---|----------|
| 1 | The AI Observer operates per-interaction, not continuously calling AI. Deterministic State Tracker updates continuously (no AI cost). |
| 2 | Session Context has three layers: Deterministic State (Layer 1), AI Understanding (Layer 2), Action History (Layer 3). Each layer has exactly one writer. |
| 3 | Layer 3 (Action History) is write-once immutable. Neither AI nor deterministic code can modify, delete, merge, or reorder. |
| 4 | The AI Observer reasons about five domains: Application Identity, Workflow Progression, Current UI Focus, User Intent, and Change Analysis. |
| 5 | Confidence is multi-dimensional (five tracks), each with independent evidence accumulation and thresholds. Overall confidence is a weighted average. |
| 6 | Confidence is never absolute (ceiling 0.95, floor 0.05). Alternative intents are required when confidence < 0.7. |
| 7 | AI receives a semantic snapshot (no raw selectors). AI returns understanding with evidence citations. |
| 8 | AI constraints: never modify/delete/merge/reorder actions, never determine interaction type, never generate Execution JSON, never generate Playwright, never block the pipeline, never override deterministic evidence. |
| 9 | Session Context is consumed by Stage 3a (classification hints) and Stage 3b (element names), then discarded. No part persists into Test Case artifacts. |
| 10 | The system is fully functional without AI. Evidence-only classification produces correct results. AI is enhancement, not dependency. |
| 11 | All Session Context state is persisted to chrome.storage.local (MV3-safe). Session rehydration on service worker restart is transparent. |
| 12 | The AI Operating Philosophy is: Observe continuously. Understand progressively. Preserve facts. Cite evidence. Generate meaning later. |
| 13 | The design is LLM-independent. Any provider implementing the AIProvider interface can serve as the reasoning engine. |
| 14 | New interaction types do not require AI Observer redesign. The five reasoning domains are interaction-type-agnostic. |

---

*This document defines the canonical AI Observer and Session Context architecture for CmdRunner. It is consistent with all frozen milestones and the validated E2E Recording Architecture. No frozen decision is modified.*

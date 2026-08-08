# The Capability Model — Final Architecture

**Date:** 2026-08-08
**Status:** Architecture design — no implementation
**Scope:** 5–10 year horizon. Must understand any modern web application.

---

## Governing Principle: Evidence Streams, Not Event Types

> **The system never asks "what event is this?" It asks "what evidence exists that this interaction served a business purpose?"**

The current architecture is definition-centric: each interaction type has a Component Definition that classifies events. This is correct for the physical layer (we need to know a user clicked, typed, or dragged). But capability inference must be **evidence-centric**: the system reasons over a multi-stream evidence record to determine what the user accomplished, regardless of which events fired or which framework rendered the UI.

The architecture separates three concerns permanently:

```
  ┌─────────────────────────────────────────────────────┐
  │                   DETERMINISTIC                       │
  │  Recorder → Evidence Ledger → Capability Engine      │
  │  (facts: what happened, what changed)                │
  │  100% reproducible, no AI, no heuristics             │
  └──────────────────────┬──────────────────────────────┘
                         │ feeds
  ┌──────────────────────▼──────────────────────────────┐
  │                   INTERPRETIVE                        │
  │  AI Understanding Layer                               │
  │  (meaning: why it happened, what it means)            │
  │  Probabilistic, advisory, never overrides facts       │
  └──────────────────────┬──────────────────────────────┘
                         │ feeds
  ┌──────────────────────▼──────────────────────────────┐
  │                    PERSISTENT                         │
  │  Application Knowledge Repository                     │
  │  (memory: what was learned across sessions)           │
  │  Accumulates, degrades gracefully without AI          │
  └─────────────────────────────────────────────────────┘
```

---

## Part 1: Evidence Taxonomy

### The 9 Evidence Streams

Evidence is organized into **9 orthogonal streams**. Each stream is independent — no stream depends on another being present. The capability engine combines any subset to reach a conclusion.

| Stream | What It Captures | Deterministic? | Currently Exists? |
|--------|-----------------|----------------|-------------------|
| **1. Identity** | Element tag, ARIA, accessible name, className, CSS selector, xpath, stable ID, test ID, href, iframe/shadow context | ✅ Deterministic | ✅ Exists (18 fields) |
| **2. DOM Context** | Ancestor roles/classes, inputType, disabled, readOnly, required, contentEditable, tabIndex, aria-expanded/popup | ✅ Deterministic | ✅ Exists (11+ fields) |
| **3. Behavioral** | SemanticEffects: state-toggle, expand-collapse, enable-disable, content-change, visibility-change, value-change, selection-change | ✅ Deterministic | ⚠️ Partial (5 categories; missing value-change, selection-change, CSS visibility) |
| **4. Sequence** | Adjacent interaction context, URL changes, form context, page transitions, timing | ✅ Deterministic | ✅ Exists (11 fields) |
| **5. Network** | XHR/fetch requests triggered by the interaction, response status, timing | ✅ Deterministic | ❌ Missing |
| **6. Visual** | Screenshot before/after, viewport state, scroll position, element rects, computed visibility | ✅ Capture / Interpretive Analysis | ❌ Missing |
| **7. Accessibility** | Full a11y tree snapshot, focus management, aria live regions, heading hierarchy, landmark structure | ✅ Deterministic | ❌ Missing |
| **8. Workflow/Business** | Jira ticket context, user story mapping, acceptance criteria, test plan references | External integration | ❌ Missing |
| **9. AI Observation** | Pattern recognition across sessions, semantic clustering, anomaly detection, inferred business rules | Interpretive | ❌ Track 3 |

### Design Rule: Streams Are Open for Extension

New evidence streams can be added without touching existing ones. Each stream implements:

```typescript
// Conceptual — NOT implementation
interface EvidenceStream {
  readonly streamId: string;
  readonly deterministic: boolean;
  // Produces evidence for a single interaction
  extract(interaction: ComponentInteraction, session: RecordingSession): EvidenceRecord;
}
```

The Evidence Ledger (Part 3) stores whatever streams were captured. Capability rules declare which streams they consume — a rule that only needs Identity + Behavioral runs fine even if Network and Visual are absent.

---

## Part 2: Deterministic vs AI Boundary

### The Immutable Rule

```
DETERMINISTIC EVIDENCE IS ALWAYS GROUND TRUTH.
AI IS ALWAYS ADVISORY.
AI NEVER OVERRIDES, SUPPRESSES, OR CONTRADICTS DETERMINISTIC EVIDENCE.
```

| Responsibility | Layer | Rationale |
|---------------|-------|-----------|
| Event capture | Deterministic | Events are facts — they happened or didn't |
| DOM state snapshot | Deterministic | DOM properties are observable facts |
| Mutation observation | Deterministic | Mutations are structural facts |
| SemanticEffect classification | Deterministic | Category assignment from property deltas is rule-based |
| Interaction classification (type) | Deterministic | Component Definitions use explicit trigger conditions |
| Capability inference (primary) | Deterministic | Rules produce HIGH/MEDIUM confidence from factual evidence |
| Network correlation | Deterministic | Request/response pairs are facts |
| Visual change detection | Deterministic (capture) + Interpretive (analysis) | Pixel diff is deterministic; "what did the user see" is interpretive |
| Component type detection (MUI, Ant, OXD) | Deterministic (class patterns) + AI (novel frameworks) | CSS class regex is deterministic; unknown frameworks need AI |
| Business meaning resolution | Interpretive (keyword dictionary + AI) | Keyword matches are deterministic; true intent needs reasoning |
| Cross-session pattern recognition | Interpretive (AI only) | Requires reasoning over accumulated knowledge |
| Test step naming | Interpretive (templates + AI) | Templates are deterministic; human-quality naming needs AI |

### Confidence Model

```
┌──────────────────────────────────────────────────────────────┐
│  HIGH    Deterministic evidence fully supports the claim     │
│          (e.g., state-toggle effect + checkbox-like element   │
│           + "on/off" accessible name → ToggleControl)         │
│                                                              │
│  MEDIUM  Deterministic evidence partially supports the claim  │
│          (e.g., content-change on a different element +       │
│           "filter" keyword → FilterSelection, but could       │
│           be SortSelection without ordering evidence)         │
│                                                              │
│  LOW     Deterministic evidence is ambiguous; AI advises      │
│          (e.g., a click on a custom-styled div that opened    │
│           a panel — AI says "OpenModal" based on visual       │
│           evidence and cross-session patterns)                │
│                                                              │
│  UNCERTIFIED  No deterministic evidence, AI only              │
│               (carried but never used for test generation     │
│               without human confirmation)                     │
└──────────────────────────────────────────────────────────────┘
```

**The confidence tier is always set by the deterministic evidence available.** AI can suggest a capability upgrade (LOW → MEDIUM) but the final tier requires a deterministic rule to confirm.

---

## Part 3: Evidence Flow Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        RECORDING SESSION                              │
│                                                                       │
│  ┌─────────────┐   ┌──────────────┐   ┌──────────────────────────┐   │
│  │  Event Tap   │   │ State Cache  │   │ Observation Coordinator  │   │
│  │ (all events) │──▶│ (before/after│   │ (mutation observer,      │   │
│  │              │   │  snapshots)  │   │  network interceptor,    │   │
│  └──────┬───────┘   └──────┬───────┘   │  visual capture,         │   │
│         │                  │           │  a11y snapshotter)        │   │
│         │                  │           └───────────┬──────────────┘   │
│         ▼                  ▼                       ▼                   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    EVIDENCE LEDGER                            │    │
│  │                                                               │    │
│  │  Per-interaction evidence record:                             │    │
│  │    identity + domContext + behavioral + sequence              │    │
│  │    + network + visual + accessibility                         │    │
│  │                                                               │    │
│  │  Every discrete event gets a ledger entry with                │    │
│  │  disposition (captured, absorbed, filtered, noise)            │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│                             ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                COMPONENT RUNTIME                              │    │
│  │                                                               │    │
│  │  Evidence Ledger → 14+ Component Definitions                  │    │
│  │  (classifies WHAT happened — deterministic)                   │    │
│  │  Output: ComponentInteraction[]                               │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │              THREE-LAYER ENRICHMENT                            │    │
│  │                                                               │    │
│  │  Layer 1: Interaction type (from Runtime)                     │    │
│  │  Layer 2: Component type + framework (deterministic + AI)     │    │
│  │  Layer 3: Business meaning (keyword dictionary + AI)          │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │                CAPABILITY ENGINE                               │    │
│  │                                                               │    │
│  │  Input: ComponentInteraction[] + Evidence Ledger              │    │
│  │  Rules: N capability rules (pluggable, additive)              │    │
│  │  Output: CapabilityClaim[] with confidence + evidence trail   │    │
│  │                                                               │    │
│  │  A claim carries: capability type, confidence, the evidence   │    │
│  │  that supports it, and the rule that produced it. Every       │    │
│  │  claim is auditable — you can trace back to raw DOM facts.    │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │              AI UNDERSTANDING LAYER (Track 3)                  │    │
│  │                                                               │    │
│  │  Input: ComponentInteraction[] + CapabilityClaim[] +          │    │
│  │         Evidence Ledger + Application Knowledge Repository     │    │
│  │                                                               │    │
│  │  Responsibilities:                                             │    │
│  │    - Upgrade LOW confidence claims with AI evidence           │    │
│  │    - Infer capabilities with no deterministic rule            │    │
│  │    - Name test steps in human language                        │    │
│  │    - Group interactions into test scenarios                   │    │
│  │    - Detect business workflows across interactions             │    │
│  │                                                               │    │
│  │  Output: UnderstandingResult { fragment, capability, models } │    │
│  │          (every AI output is advisory and tagged with source) │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │              GENERATION LAYER (IR Bridge + Adapter)            │    │
│  │                                                               │    │
│  │  Input: ComponentInteraction[] + UnderstandingResult          │    │
│  │  Output: ExecutionIRPlan → Playwright/Cypress/Appium code     │    │
│  └──────────────────────────┬────────────────────────────────────┘    │
│                             │                                          │
│  ┌──────────────────────────▼────────────────────────────────────┐    │
│  │         APPLICATION KNOWLEDGE REPOSITORY                       │    │
│  │                                                               │    │
│  │  Persists: UnderstandingResult, CapabilityRecords,            │    │
│  │            UiElement identities, ObservedTransitions,          │    │
│  │            ComponentGroupings, InteractionContracts            │    │
│  │                                                               │    │
│  │  Cross-session: accumulates evidence across recordings.       │    │
│  │  Next recording's AI has prior session's knowledge.            │    │
│  └───────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Evidence Ledger — The Central Innovation

The Evidence Ledger is NOT the current EvidenceLedger (which tracks capture guarantees). It is the **unified evidence record per interaction** that aggregates all streams.

```
Current architecture:
  ComponentRuntime produces ComponentInteraction[]
  EvidenceExtractor reads interaction + effects → ExtractedEvidence
  CapabilityEngine consumes ExtractedEvidence

Proposed architecture:
  Recorder writes to Evidence Ledger (all streams, raw facts)
  ComponentRuntime reads Evidence Ledger → ComponentInteraction[]
  CapabilityEngine reads Evidence Ledger directly (not via interaction.metadata)
  AI reads Evidence Ledger + Knowledge Repository
```

The key shift: **the Evidence Ledger is the single source of truth that all downstream systems read from.** Today, evidence is scattered across `interaction.metadata`, `ObservedEvent.domContext`, `SemanticEffect[]`, and `ObservationResult`. The Evidence Ledger unifies these into a queryable record that any system can consume without knowing how the recorder captured it.

---

## Part 4: Visual Evidence Integration

### The Two-Layer Visual Model

```
Layer A: Capture (deterministic)
  - Screenshot before interaction (full viewport + element crop)
  - Screenshot after observation window closes
  - Element bounding rect (x, y, width, height, viewport-relative)
  - Viewport scroll position
  - Computed style snapshot (display, visibility, opacity, transform, z-index)

Layer B: Analysis (interpretive — optional)
  - Pixel diff between before/after (deterministic computation)
  - Changed region identification (deterministic computation)
  - "What did the user see change?" (AI — requires visual reasoning)
  - UI state inference ("a modal appeared", "a tooltip showed")
```

### How Visual Evidence Enters Capability Inference

Visual evidence **never replaces** deterministic evidence. It **supplements** it:

1. **Corroboration**: A state-toggle SemanticEffect says `aria-checked` changed. Visual evidence confirms the checkbox visually toggled. → Confidence upgrade from MEDIUM to HIGH.

2. **Disambiguation**: A click on a custom div produced a content-change effect. Was it an OpenModal or an ExpandCollapse? Visual evidence shows a full-screen overlay appeared (not an inline expansion). → OpenModal, not ExpandCollapse.

3. **Discovery**: A click produced no SemanticEffects (no DOM mutations, no property changes). Visual evidence shows the viewport scrolled to a different section. → ScrollToContent capability.

### Storage: Not All Screenshots Persist

- **Recording session**: screenshots stored in memory (chrome.storage.session or IndexedDB blob)
- **Post-understanding**: only screenshots for interactions where visual evidence was the *deciding factor* persist. Others are discarded.
- **Knowledge Repository**: visual patterns (not raw screenshots) persist — "a modal overlay typically has these computed properties"

---

## Part 5: Business Context Integration (Jira, User Stories, Requirements)

### The Optional Enrichment Principle

```
The system works at 100% capability precision with zero business context.
Business context makes output HUMAN-READABLE, not MORE ACCURATE.
```

Business context enriches:
- **Test naming**: "Login as admin" instead of "Fill test@example.com in field3"
- **Test grouping**: interactions grouped into "User Checkout Flow" instead of sequential
- **Assertion generation**: acceptance criteria → assertions ("system should show order confirmation")
- **Coverage reporting**: map generated tests to requirement IDs

### Integration Point: ExternalRequirements Envelope

```typescript
// Conceptual — the integration boundary
interface ExternalRequirements {
  // From Jira/user story/PRD — all optional
  readonly requirements?: RequirementRef[];
  readonly acceptanceCriteria?: AcceptanceCriterion[];
  readonly testScenarios?: TestScenario[];
}

interface RequirementRef {
  readonly source: 'jira' | 'github' | 'manual' | 'prd';
  readonly id: string;          // TICKET-123
  readonly title: string;       // "User can filter products by brand"
  readonly description?: string;
  readonly labels?: string[];
}
```

The AI Understanding Layer correlates recorded interactions with requirements:
- Match by URL patterns, element names, action sequences
- Attach requirement refs to capability claims
- Generate coverage matrix: requirement → test(s)

**When absent**: the system produces identical capability inference. Tests are named by interaction metadata + AI naming. No degradation in test correctness.

---

## Part 6: Future-Proof Architecture — No Rewrites

### The 6 Permanent Extension Points

```
┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 1: Component Definitions (Additive)              │
│                                                                  │
│ To support a new interaction pattern:                            │
│   1. Create definition file (e.g., drag-drop.ts)                │
│   2. Implement ComponentDefinition interface                     │
│   3. Register in ALL_DEFINITIONS                                 │
│                                                                  │
│ NOTHING ELSE CHANGES.                                            │
│ The Runtime, Evidence Ledger, Capability Engine, and Generation  │
│ Layer all consume definitions polymorphically.                   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 2: Capability Rules (Additive)                   │
│                                                                  │
│ To infer a new capability:                                       │
│   1. Create rule file (e.g., open-modal.ts)                     │
│   2. Implement CapabilityRule interface                          │
│   3. Register in capability-bridge.ts                            │
│                                                                  │
│ NOTHING ELSE CHANGES.                                            │
│ The Evidence Extractor, Capability Engine, and Conflict Resolver │
│ are rule-agnostic.                                               │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 3: Evidence Streams (Additive)                   │
│                                                                  │
│ To add a new evidence category (e.g., network correlation):      │
│   1. Add the stream to the Evidence Ledger schema                │
│   2. Add capture logic to the Observation Coordinator             │
│   3. Add extraction logic to the Evidence Extractor               │
│   4. Update capability rules that consume it (opt-in)             │
│                                                                  │
│ EXISTING RULES DON'T BREAK.                                      │
│ Rules declare which streams they read. A rule that only reads     │
│ PhysicalEvidence + BehavioralEvidence continues working unchanged │
│ when a NetworkEvidence stream is added.                          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 4: Semantic Effect Categories (Additive)         │
│                                                                  │
│ To interpret a new DOM change pattern:                           │
│   1. Add category to EffectCategory union                        │
│   2. Add detection rule to effect-rules.ts                       │
│   3. Add to BehavioralEvidence summary flags                     │
│                                                                  │
│ EXISTING EFFECT RULES DON'T BREAK.                               │
│ A new 'selection-change' category doesn't affect 'state-toggle'. │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 5: Generation Adapters (Additive)                │
│                                                                  │
│ To target a new execution framework:                             │
│   1. Create adapter (e.g., cypress-adapter.ts)                  │
│   2. Implement the adapter contract against ExecutionIRPlan      │
│                                                                  │
│ THE IR IS STABLE.                                                │
│ ExecutionIRPlan is the permanent compiler boundary. New adapters │
│ consume the same IR that Playwright consumes today.              │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ EXTENSION POINT 6: AI Models (Swappable)                        │
│                                                                  │
│ The AI Understanding Layer talks to LLMs via an adapter.         │
│ Today: OpenAI-compatible API.                                    │
│ Tomorrow: local model, different provider, fine-tuned model.     │
│                                                                  │
│ THE EVIDENCE LEDGER + CAPABILITY ENGINE DON'T KNOW ABOUT AI.     │
│ AI is a consumer of deterministic evidence, not a producer.      │
│ Swapping the AI model never changes deterministic output.        │
└──────────────────────────────────────────────────────────────────┘
```

### Why This Survives 10 Years

| Future Change | What Happens | What Doesn't Change |
|---------------|-------------|-------------------|
| New web framework (e.g.,_htmx 3.0) | May need new component type detection pattern | Definitions, Capability rules, IR, Evidence Ledger |
| New input device (VR/AR, voice) | New Component Definition + new event types in Event Tap | Capability Engine, Evidence Ledger, Generation Layer |
| New test framework | New adapter | Everything upstream of IR |
| Better AI model | Swap adapter | Everything deterministic |
| New business domain (medical device testing) | New capability rules + keyword dictionaries | Recorder, Evidence Ledger, Runtime, IR |
| New evidence type (e.g., biometric stress testing) | New evidence stream | All existing streams + rules |

---

## Part 7: The Complete Evidence Schema

### What the Evidence Ledger Stores Per Interaction

```
┌─────────────────────────────────────────────────────────────────────┐
│ INTERACTION EVIDENCE RECORD                                         │
│                                                                     │
│ ── Stream 1: Identity (deterministic) ──                            │
│ elementId, tag, ariaRole, accessibleName, ariaLabel,                │
│ ariaLabelledBy, placeholder, className, name, stableId,             │
│ testId, dataCy, dataQa, cssSelector, xPath, inIframe,              │
│ shadowDom, href                                                     │
│                                                                     │
│ ── Stream 2: DOM Context (deterministic) ──                         │
│ inputType, ariaExpanded, ariaHasPopup, isContentEditable,           │
│ disabled, readOnly, required, ancestorRoles[], ancestorClasses[],    │
│ tabIndex,                                                           │
│ + NEW: ariaSelected, ariaCurrent, ariaHidden, ariaControls,         │
│        ariaOwns, ariaDescribedBy, computedDisplay,                  │
│        computedVisibility, computedOpacity                          │
│                                                                     │
│ ── Stream 3: Behavioral (deterministic) ──                          │
│ SemanticEffect[] with categories:                                   │
│   state-toggle, expand-collapse, enable-disable,                    │
│   content-change, visibility-change, value-change,                  │
│   selection-change, focus-change, scroll-change                     │
│ Each effect carries: affectedTarget, confidence,                    │
│   confidenceBasis, evidenceRef, netNodeDelta                        │
│                                                                     │
│ ── Stream 4: Sequence (deterministic) ──                            │
│ previousInteractionType, precededBySamePage,                        │
│ precededByTextEntryOnSameForm, urlChangedAfter,                     │
│ urlPathChangedAfter, hasNextItemSpecificUrl,                        │
│ triggerHasItemSpecificHref, precededByListContext,                  │
│ precededByFormInteraction, pageUrl, pageTitle                       │
│ + NEW: timeSincePreviousInteraction, dwellTime,                     │
│        sameElementReinteraction, modifierKeys                       │
│                                                                     │
│ ── Stream 5: Network (deterministic) ── [NEW]                       │
│ requestsTriggered: [{ method, url, status, durationMs,             │
│   initiatedBy: 'xhr'|'fetch'|'beacon'|'resource' }]                │
│ hasApiCall: boolean                                                 │
│ apiEndpoint: string | null  (e.g., '/api/v1/products/search')       │
│ responseIndicatedSuccess: boolean                                   │
│                                                                     │
│ ── Stream 6: Visual (deterministic capture) ── [NEW]                │
│ beforeScreenshot: BlobRef | null                                    │
│ afterScreenshot: BlobRef | null                                     │
│ elementRect: { x, y, width, height }                               │
│ viewportScroll: { scrollX, scrollY }                               │
│ pixelDiffRegion: { x, y, width, height } | null                    │
│ pixelDiffPercentage: number                                         │
│                                                                     │
│ ── Stream 7: Accessibility (deterministic) ── [NEW]                 │
│ focusBefore: elementId | null                                       │
│ focusAfter: elementId | null                                        │
│ ariaLiveAnnouncements: string[]                                     │
│ headingHierarchyChange: boolean                                     │
│ landmarkStructure: string[] (e.g., ['main', 'navigation'])          │
│                                                                     │
│ ── Stream 8: Workflow/Business (external) ── [NEW, OPTIONAL]        │
│ matchedRequirements: RequirementRef[]                               │
│ matchedAcceptanceCriteria: AcceptanceCriterion[]                    │
│                                                                     │
│ ── Stream 9: AI Observation (interpretive) ── [TRACK 3]            │
│ inferredComponentType: string | null                                │
│ inferredBusinessMeaning: string | null                              │
│ inferredCapabilityUpgrade: { from, to, reason } | null             │
│ crossSessionPattern: string | null                                  │
│ confidenceScore: number (0.0–1.0)                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### What the Capability Claim Carries

```typescript
// Every capability claim is fully auditable
interface CapabilityClaim {
  // What was inferred
  capability: CapabilityType;
  confidence: CapabilityConfidence;  // HIGH | MEDIUM | LOW

  // Why — the evidence trail
  supportingStreams: EvidenceStreamId[];
  deterministicEvidence: {
    stream: EvidenceStreamId;
    fields: string[];        // which fields in that stream
    values: Record<string, unknown>;  // the actual values
  }[];
  aiEvidence?: {
    stream: 'ai-observation';
    reasoning: string;
    modelVersion: string;
  };

  // Which rule produced this
  ruleId: string;
  reason: string;

  // Semantic enrichment
  businessMeaning?: string;
  requirementRef?: RequirementRef;
}
```

This means every capability inference can be traced back to raw DOM facts. A human reviewer can see: "This was classified as FilterSelection because: (1) Behavioral stream detected content-change on a remote element, (2) netNodeDelta was strongly negative, (3) keyword 'filter' matched in accessibleName."

---

## Part 8: Capability Type Taxonomy

### The Permanent Capability Hierarchy

Rather than a flat enum that must be extended for every new capability, the architecture uses a **hierarchical taxonomy** with three levels:

```
Level 1: CAPABILITY DOMAIN (permanent, ~8 domains)
  The broad category of user intent.

Level 2: CAPABILITY TYPE (extensible, ~30-50 types)
  The specific action pattern.

Level 3: CAPABILITY VARIANT (unbounded, AI-named)
  The domain-specific instance.
```

| Domain | Types (examples) | Variants (examples) |
|--------|-----------------|-------------------|
| **Navigation** | Navigate, OpenDetail, Paginate, SwitchTab, ScrollToContent, Breadcrumb | "Navigate to product list", "Open customer detail", "Next page" |
| **Data Input** | FillField, SelectOption, AdjustValue, SetDate, SetColor, ToggleControl | "Enter email address", "Select country", "Set quantity to 5" |
| **Data Manipulation** | DragDrop, Reorder, MultiSelect, ClearSelection | "Drag task to Done column", "Select 3 items" |
| **Form Action** | SubmitForm, CancelForm, ResetForm, SaveDraft | "Submit login", "Save changes" |
| **Content Interaction** | ExpandCollapse, OpenModal, CloseModal, HoverReveal, ToggleMenu | "Open filter panel", "Close dialog", "Show tooltip" |
| **Search & Filter** | Search, FilterSelection, SortSelection | "Search for 'laptop'", "Filter by brand", "Sort by price" |
| **File & Media** | UploadFile, DownloadFile, PlayMedia, PauseMedia, CaptureMedia | "Upload profile photo", "Play tutorial video" |
| **Custom/Compound** | Any interaction that doesn't fit above (AI-classified) | "Draw signature", "Pan map to region" |

### Design Rule: Domains Are Permanent, Types Are Extensible

- **Adding a new Capability Type** = add to the union + create a rule. Does not break existing rules or the conflict resolver.
- **Adding a new Capability Domain** = architectural decision (rare). Requires updating the hierarchy but not the evidence pipeline.
- **AI can create Capability Variants** without code changes. A variant is a named instance of a type — "FilterSelection by brand" is a variant of FilterSelection.

---

## Part 9: The Deterministic-AI Separation Contract

### What AI NEVER Does

1. **AI never classifies events.** Event classification (Click vs TextEntry vs Slider) is deterministic via Component Definitions.
2. **AI never captures evidence.** All evidence capture is deterministic code (event listeners, MutationObserver, network interception).
3. **AI never sets confidence above MEDIUM without deterministic corroboration.** A LOW claim can be upgraded to MEDIUM by AI, but HIGH requires deterministic evidence.
4. **AI never suppresses evidence.** If a SemanticEffect exists, it exists. AI cannot decide to ignore it.
5. **AI never modifies the Evidence Ledger.** AI reads evidence; it writes to a separate advisory layer (Stream 9).

### What AI DOES

1. **AI reads the Evidence Ledger and Knowledge Repository to infer meaning.** Given deterministic evidence that a click opened a panel, AI infers "the user opened the notification settings."
2. **AI names things in human language.** Test steps, test scenarios, test suites.
3. **AI disambiguates when deterministic rules conflict.** If two rules claim FilterSelection and SortSelection with equal confidence, AI resolves based on visual + cross-session evidence.
4. **AI detects patterns across sessions.** "The user always logs in before checking orders" → workflow inference.
5. **AI generates missing assertions.** Given an InteractionContract, AI suggests validation assertions the deterministic rules didn't produce.

### The Boundary Is Enforced by Architecture, Not Convention

```
Evidence Ledger (deterministic) → READ ONLY for AI
Capability Engine (deterministic) → AI cannot register rules
Understanding Layer (AI) → writes to UnderstandingResult only
Generation Layer → reads UnderstandingResult, never calls AI directly
```

The AI Understanding Layer is a **pure function**: `(Evidence Ledger, Knowledge Repository) → UnderstandingResult`. It has no side effects on the deterministic pipeline. If the AI service is unavailable, the system degrades to deterministic-only capability inference — still correct, just less enriched.

---

## Part 10: Implementation Sequencing

This architecture is designed to be built incrementally on the existing codebase. No rewrite is needed — every layer maps to existing modules.

| Phase | What Changes | Existing Code Affected | Risk |
|-------|-------------|----------------------|------|
| **CR-1: Evidence Expansion** | Add fields to ElementStateSnapshot, expand observation windows | effect-rules.ts (+rules), evidence-extractor.ts (+fields) | Low — additive |
| **CR-2: Event Coverage** | New event listeners in Event Tap | recorder-entry.ts (+listeners) | Low — additive |
| **CR-3: Network + Visual** | New observation coordinator modules | new files, no existing changes | Medium — new subsystems |
| **CR-4: Evidence Ledger** | Unify evidence access (currently scattered) | evidence-extractor.ts (refactored) | Medium — refactor |
| **CR-5: Capability Hierarchy** | Migrate flat CapabilityType → domain/type/variant | capability-types.ts, all rules | Medium — type migration |
| **CR-6: AI Integration** | Wire UnderstandingResult into the pipeline | new files, sw-integration.ts (+call) | High — new subsystem |

Each phase is independently valuable. The system is production-quality after any phase.

---

## Summary: Why This Architecture Endures

1. **Evidence is king.** The system's accuracy depends on what it can observe, not what it can reason about. The Evidence Ledger is the single source of truth.

2. **Extension is always additive.** New definitions, new rules, new evidence streams, new adapters, new AI models — all add without modifying existing code. The 6 extension points guarantee this.

3. **Deterministic ground truth + AI advisory.** The system is never wrong about what happened (deterministic). It may be imprecise about what it means (AI). But meaning degrades gracefully — without AI, tests are still correct, just less readable.

4. **The IR is the permanent boundary.** ExecutionIRPlan separates "understand what happened" from "generate code." Any test framework can consume the IR without touching the recorder or capability engine.

5. **Business context is enrichment, not dependency.** The system produces identical test correctness with or without Jira integration. Business context improves human readability, not machine precision.

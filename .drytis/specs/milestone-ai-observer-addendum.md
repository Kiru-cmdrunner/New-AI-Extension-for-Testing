# Architecture Review Addendum — AI Observer & Session Context

**Status:** Architecture review addendum — evaluated and frozen  
**Date:** 2026-07-17  
**Scope:** Three addendum questions on AI advisory input, session windowing, and expected behaviour  
**Base:** `milestone-ai-observer-session-context.md` (frozen)  
**Constraint:** No redesign. All previously frozen principles preserved unless a compelling reason to change is found and justified.

---

## Table of Contents

1. [Question 1 — AI Understanding as Advisory Input](#1-ai-understanding-as-advisory-input)
2. [Question 2 — Sliding Session Window vs Single Interaction Snapshot](#2-sliding-session-window-vs-single-interaction-snapshot)
3. [Question 3 — Expected Application Behaviour Domain](#3-expected-application-behaviour-domain)
4. [Summary of Recommendations](#4-summary-of-recommendations)
5. [Freeze Addendum](#5-freeze-addendum)

---

## 1. AI Understanding as Advisory Input

### 1.1 What the frozen architecture already says

The frozen milestone already establishes the advisory relationship in three places:

| Frozen Decision | Location | What It Says |
|----------------|----------|-------------|
| #6 | Freeze Declaration | "Session Context is consumed by Stage 3a as an optional enrichment input, never as the sole decision-maker" |
| #8 | Freeze Declaration | "AI constraints: never determine interaction type..." |
| §8.1 | AI Constraints | "AI must never determine interaction type. Type assignment is the classifier's exclusive domain." |
| §9.2 | Session Context + Stage 3a | Classifier uses AI hints ONLY when evidence rules are ambiguous (confidence 0.5–0.9). Evidence always wins. |
| §8.3 | Constraint Enforcement | "The Stage 3a classifier does not read `suggestedType` from AI Understanding. It reads evidence fields. AI hints are a separate input channel." |

So the advisory relationship is **already the frozen design.** The question is whether the formalization proposed in the addendum adds clarity or changes anything.

### 1.2 Evaluating the proposed formalization

The addendum proposes clarifying that:
1. The deterministic classifier remains the sole authority
2. AI never directly classifies
3. The classifier may consume AI understanding as **advisory context** when evidence is ambiguous
4. Final ownership always remains deterministic

**Assessment:** All four points are **already in the frozen architecture.** However, the frozen text describes the mechanism (confidence thresholds, evidence-first rules, separate input channels) without naming the relationship pattern explicitly. The addendum proposes giving this pattern a name: **"advisory input."**

### 1.3 Recommendation: ADOPT — formalize as the Advisory Input Pattern

**The Advisory Input Pattern** should be formally named and documented as a first-class architectural concept. This does not change any behavior — it makes the existing design explicit and prevents future misinterpretation.

The formal definition:

> **Advisory Input Pattern:** AI Understanding (Layer 2) is available to the deterministic classifier (Stage 3a) as advisory context. The classifier may consult it when deterministic evidence alone produces an ambiguous result. The classifier retains sole and final authority over the classification decision. AI may never assign, override, or veto a type determination directly.

**Why formalize it:**

1. **Prevents scope creep.** Without a named pattern, future implementers might be tempted to let AI influence classification more directly. The Advisory Input Pattern creates a clear boundary: AI advises, the classifier decides.

2. **Makes the three-tier decision process explicit.** The classifier's decision process is now formally three tiers:

```
┌──────────────────────────────────────────────────────┐
│            CLASSIFIER DECISION PROCESS                │
│                                                       │
│  TIER 1: DETERMINISTIC RESOLUTION (always runs)      │
│  ─────────────────────────────────────────────────   │
│  Evidence rules produce a definitive type.            │
│  Example: input[type=checkbox] + checked state       │
│           change → checkbox (evidence is clear)      │
│                                                       │
│  If Tier 1 resolves → DONE. AI never consulted.      │
│                                                       │
│  TIER 2: ADVISORY RESOLUTION (only if Tier 1 is      │
│          ambiguous)                                   │
│  ─────────────────────────────────────────────────   │
│  Evidence rules produce multiple candidates           │
│  with roughly equal confidence.                       │
│  Example: div with class "select-item" clicked       │
│           inside a container — could be select,       │
│           could be click.                             │
│                                                       │
│  Classifier consults AI Understanding (Layer 2):      │
│    • AI workflow context suggests "selecting          │
│      cabin class"                                     │
│    • AI intent confidence is 0.82                     │
│    • Classifier uses this to break the tie            │
│                                                       │
│  If Tier 2 resolves → DONE. AI was advisory only.     │
│                                                       │
│  TIER 3: DEFAULT FALLBACK (only if both tiers fail)   │
│  ─────────────────────────────────────────────────   │
│  No evidence rule matches. AI unavailable or low      │
│  confidence.                                          │
│  Classifier assigns the default type: 'click'.       │
│                                                       │
│  This is a known, explicit fallback — not a failure.  │
└──────────────────────────────────────────────────────┘
```

3. **Aligns terminology across documents.** The E2E Architecture says "AI informs but never overrides." Phase 2 says "AI is an optional enhancement input." This addendum gives the concept a single name: Advisory Input.

### 1.4 What changes in the frozen architecture

**Nothing changes structurally.** The Advisory Input Pattern is a name for behavior already frozen. The only textual change is to §9.2 of the frozen milestone:

**Current text (§9.2):**
> "Used by: Classifier ONLY when evidence rules are ambiguous (confidence 0.5–0.9)"

**Refined text:**
> "Used by: Classifier as **Advisory Input** — consulted at Tier 2 only when Tier 1 deterministic evidence produces an ambiguous result. The classifier retains sole and final authority."

### 1.5 Verdict

**ADOPT. Formalize the Advisory Input Pattern as a named architectural concept.** This is a clarification, not a change. It makes the existing frozen design explicit and prevents future misinterpretation. The three-tier decision process (Deterministic → Advisory → Default) is the precise mechanism by which the already-frozen principle "AI never determines interaction type" is enforced.

---

## 2. Sliding Session Window vs Single Interaction Snapshot

### 2.1 What the frozen architecture currently specifies

The frozen milestone §5.4 defines `ReasoningInput`, which already includes:

```typescript
// ── Recent Action Sequence (last 5) ──
recentActions: Array<{
  actionType: string;
  elementName: string;
  valueChanged: boolean;
  timestamp: string;
}>;
```

This is **already a limited sliding window** — the last 5 actions are sent alongside the current interaction. The frozen architecture also sends:

- Previous AI Understanding (previousApplication, previousWorkflow, previousIntent, previousIntentConfidence)
- Current DOM State (URL, open dialogs/menus/dropdowns, form context)

So the frozen design is **neither a pure single-interaction snapshot nor a full session window.** It is a hybrid: current interaction + limited recent history + previous understanding + current state.

### 2.2 Evaluating the three options

#### Option A: Pure Single Interaction Snapshot

AI receives only the current interaction + its DOM context. No history.

| Criterion | Assessment |
|-----------|-----------|
| Token efficiency | ✅ Minimal tokens |
| Workflow understanding | ❌ Cannot infer workflow from a single action |
| Intent inference | ❌ Cannot determine if user is "booking a flight" from one click |
| Element naming | ⚠️ Adequate for naming but poor for context |
| Implementation simplicity | ✅ Simplest |

**Verdict:** Insufficient. Intent and workflow reasoning are the highest-value AI capabilities, and they require sequential context.

#### Option B: Full Session Window

AI receives ALL actions captured so far in the session.

| Criterion | Assessment |
|-----------|-----------|
| Token efficiency | ❌ Grows linearly. A 50-action recording could be 10K+ tokens per reasoning cycle |
| Workflow understanding | ✅ Maximum context |
| Intent inference | ✅ Best possible inference |
| Implementation simplicity | ⚠️ Simple to implement but costly to operate |
| Latency | ❌ Degrades as session grows — each reasoning cycle processes more context |

**Verdict:** Overkill. The marginal value of action #40 when reasoning about action #45 is near zero, but the token cost grows linearly. This creates an unacceptable cost/latency profile for long recordings.

#### Option C: Sliding Session Window (Recommended)

AI receives the current interaction + a bounded window of recent actions.

| Criterion | Assessment |
|-----------|-----------|
| Token efficiency | ✅ Bounded cost — constant regardless of session length |
| Workflow understanding | ✅ Sufficient — workflows are inferable from recent context |
| Intent inference | ✅ Strong — last 5–10 actions contain enough pattern signal |
| Implementation simplicity | ✅ Simple — slice the last N entries |
| Latency | ✅ Constant — does not degrade with session length |

**Verdict:** This is the right approach. It is also **what the frozen architecture already specifies** (last 5 actions).

### 2.3 Recommended window configuration

The frozen architecture uses 5 actions. This addendum recommends a **configurable window with a defined default**:

| Parameter | Recommended Value | Rationale |
|-----------|------------------|-----------|
| `RECENT_ACTION_WINDOW` | **5** (current frozen value) | Sufficient for workflow inference; bounded token cost |
| Maximum window (config ceiling) | 10 | Diminishing returns beyond 10; token cost becomes noticeable |
| What's included per action | actionType, elementName, valueChanged, timestamp | Semantic summary, not full identity (keeps tokens low) |

**Why 5 is the right default:**
- Most semantic patterns are visible within 3–5 actions (e.g., "click dropdown → click option" = 2 actions; "navigate → click search → type query → click result" = 4 actions).
- Beyond 5, earlier actions are usually from a different screen or workflow segment, adding noise rather than signal.
- 5 actions at ~15 tokens each = ~75 tokens of history — negligible cost impact.

### 2.4 What the window carries beyond actions

The frozen `ReasoningInput` already includes two additional context channels that complement the action window:

1. **Previous AI Understanding** — the AI's own evolving understanding from the last cycle. This is an O(1) summary of everything the AI has learned so far, regardless of window size. It prevents information loss when actions age out of the window.

2. **Current DOM State (Layer 1)** — what's open right now (dialogs, menus, dropdowns). This provides the "where am I" context that pure action history cannot.

Together, these three channels (action window + previous understanding + current state) form a **complete context package** that gives AI everything it needs without sending the full session.

### 2.5 Recommendation: ADOPT — formalize the Sliding Session Window

**The Sliding Session Window is already the frozen design.** This addendum formalizes it with a name and explicit parameters.

Formal definition:

> **Sliding Session Window:** The AI Observer sends the LLM a bounded context package consisting of: (1) the current interaction's semantic snapshot, (2) the last `RECENT_ACTION_WINDOW` (default: 5) captured actions as semantic summaries, (3) the previous AI Understanding as a compressed summary, and (4) the current Deterministic State from Layer 1. The window is fixed-size — it does not grow with session length. Token cost is constant per reasoning cycle.

### 2.6 What changes in the frozen architecture

**Nothing changes structurally.** The `ReasoningInput` interface already implements the sliding window. The only addition is:

- Name the pattern explicitly ("Sliding Session Window")
- Document that the window is fixed-size (does not grow)
- Document that previous AI Understanding serves as the compressed history beyond the window boundary
- Document the default (5) and ceiling (10)

### 2.7 Verdict

**ADOPT. Formalize the Sliding Session Window as a named architectural concept.** The frozen architecture already implements it. Naming it explicitly prevents future attempts to either (a) strip history for token savings (losing workflow context) or (b) send full history (creating unbounded cost). The three-channel context package (window + previous understanding + current state) is the optimal balance.

---

## 3. Expected Application Behaviour Domain

### 3.1 What is being proposed

A sixth reasoning domain: **Expected Application Behaviour.** After each action, AI would reason about what the application is expected to do in response.

Examples:
- Click dropdown → expect dropdown expansion
- Click Login → expect dashboard navigation
- Click Save → expect success notification
- Select date → expect calendar dismissal and field update

### 3.2 Evaluation against the frozen architecture

The frozen architecture has 5 reasoning domains. Adding a 6th is an **additive change** — it does not modify or conflict with any existing domain. The question is whether it provides enough value to justify inclusion.

### 3.3 What value does Expected Behaviour provide?

| Consumer | How It Uses Expected Behaviour | Value |
|----------|-------------------------------|-------|
| Stage 3a (Classification) | "Did the expected dropdown expansion occur?" confirms a select interaction. If the expected behavior matches the DOM mutation, classification confidence increases. | **Medium** — the classifier already uses DOM mutations as evidence directly. Expected behaviour adds a semantic layer on top of raw mutations. |
| Stage 3b (Canonical Steps) | "After clicking Login, expect to see the Dashboard" could become part of the step description or a future assertion. | **High** — this is the foundation for future assertion generation |
| Stage 4b (AI Enrichment) | Expected behaviour maps to Layer 2 VALIDATION (postcondition) in the Layered Execution Plan. "After clicking Save, expect success notification" becomes `postcondition: "success notification visible"`. | **High** — this is the primary input for the future Validation Layer |
| Stage 5 (Playwright) | Today: unused. Future: generated assertions (`expect(page.locator('.notification')).toBeVisible()`). | **Future High** — not used today but is the foundation for assertion-rich Playwright output |
| Change Analysis (existing domain) | "What did the last action change?" is reactive. Expected Behaviour is proactive — "what SHOULD have changed?" The gap between expected and actual is diagnostic. | **Medium** — enriches existing domain |

### 3.4 Where Expected Behaviour sits in the architecture

**Option A: New 6th reasoning domain (frozen into Layer 2)**

```
Reasoning Domains:
  1. Application Identity
  2. Workflow Progression
  3. Current UI Focus
  4. User Intent
  5. Change Analysis
  6. Expected Application Behaviour  ← NEW
```

| Pros | Cons |
|------|------|
| First-class concept — every reasoning cycle produces it | Adds to every AI prompt even when not needed (token cost) |
| Consumed by multiple downstream stages | Confidence model needs a 6th track |
| Aligns with future Validation Layer (Layer 2 of Execution Plan) | Some actions have no meaningful expected behaviour (e.g., hovering) |

**Option B: Sub-domain of Change Analysis**

```
Domain 5: Change Analysis
  5a. What changed? (existing — reactive)
  5b. What was expected to change? (new — proactive)
  5c. Do they match? (new — diagnostic)
```

| Pros | Cons |
|------|------|
| No new domain — extends existing one | Conceptually different (proactive vs reactive) forced into same bucket |
| Lower prompt overhead | Change Analysis confidence track would need to cover both actual and expected |
| Natural pairing: "what happened" + "what was expected" | |

**Option C: Future enhancement — not in current Session Context**

```
Expected Behaviour is NOT tracked during recording.
It is derived post-hoc by Stage 4b (AI Enrichment) when generating
the Execution JSON, using the typed Timeline + AI Understanding.
```

| Pros | Cons |
|------|------|
| Simplest — zero recording-phase change | Loses the "expected vs actual" comparison during recording |
| Expected behaviour is only needed for assertions, which are future | Cannot confirm interactions during recording (e.g., "dropdown expanded as expected → this IS a select") |
| Keeps the 5-domain model frozen | Loses proactive context that could improve classification |

### 3.5 Recommendation: ADOPT as a sub-domain of Change Analysis (Option B) — with future graduation path

**Rationale for Option B over Option A:**

1. **Conceptual pairing.** "What happened" and "what was expected to happen" are two sides of the same coin. Splitting them into separate domains creates an artificial boundary. Keeping them together as sub-domains of Change Analysis is more natural.

2. **Prompt efficiency.** The AI is already reasoning about what changed. Asking "was this change expected?" in the same prompt adds ~20 tokens, not a full domain's worth (~100+ tokens for a standalone domain with its own reasoning framework).

3. **Confidence model stays at 5 tracks.** No need for a 6th confidence track. Expected-vs-actual alignment is a signal that feeds into the existing Change Analysis confidence.

4. **Graduation path.** If Expected Behaviour proves valuable enough to warrant independence, it can graduate from sub-domain to full domain in a future milestone without breaking the architecture. The data structure is additive either way.

**Rationale for Option B over Option C:**

1. **Proactive context during recording.** When the user clicks a dropdown trigger and the expected behavior (dropdown expansion) matches the observed mutation (child list added, role=menu now visible), this is strong confirmation that the interaction is a select — not just a click. This signal is available to Stage 3a and improves classification accuracy.

2. **Foundation for validation.** The Execution JSON Evolution review recommended Layer 2 (VALIDATION) with postconditions. Expected Application Behaviour is the natural source of postcondition data. Tracking it during recording means it's available when generating the Execution JSON, rather than requiring a second AI pass post-recording.

### 3.6 Formal definition

> **Expected Application Behaviour (sub-domain of Change Analysis):** After each captured interaction, the AI Observer reasons about what the application is expected to do in response. This is recorded as a structured expectation with a confidence score. The expectation is NOT used to validate correctness during recording — it is proactive context that (a) enriches classification when the expected behavior matches observed mutations, (b) provides postcondition data for future Execution JSON validation layers, and (c) serves as the foundation for future assertion generation.

### 3.7 Data structure

The Change Analysis domain in Layer 2 expands from:

```typescript
// CURRENT (frozen)
lastActionEffect: string | null;
predictedNextAction: string | null;
changeConfidence: number;
```

To:

```typescript
// ADDITIVE EXPANSION
lastActionEffect: string | null;
predictedNextAction: string | null;
changeConfidence: number;

// ── Expected Application Behaviour (sub-domain) ──
expectedBehaviour: {
  /** What the application is expected to do in response to the last action. */
  expectation: string | null;          // "Dropdown should expand and show options"
  /** Whether the expected behavior was observed in Layer 1 mutations. */
  observedMatch: boolean | null;       // true = confirmed, false = contradicted, null = unknown
  /** Which DOM state change confirmed or contradicted the expectation. */
  confirmingEvidence: string | null;   // "role=menu became visible with 5 child options"
  /** Confidence in the expectation itself (0.05–0.95). */
  expectationConfidence: number;
} | null;
```

**Key fields:**

| Field | Purpose |
|-------|---------|
| `expectation` | The proactive prediction: "After clicking this dropdown trigger, the dropdown should expand." |
| `observedMatch` | Did Layer 1 (Deterministic State) confirm this? `true` = the mutation matches the expectation. `false` = the mutation contradicts it. `null` = no relevant mutation observed (e.g., async response not yet received). |
| `confirmingEvidence` | What specific DOM change confirmed or contradicted. This is evidence-cited, consistent with the "cite evidence" principle. |
| `expectationConfidence` | How confident the AI is in the expectation itself. Independent from `changeConfidence`. |

### 3.8 How it feeds Stage 3a (Classification)

Expected Behaviour is consumed by the classifier as part of the Advisory Input at Tier 2:

```
Evidence rules produce ambiguous result (Tier 1 failed).
Classifier consults Advisory Input (Tier 2):
  • AI expected behaviour: "Dropdown should expand"
  • Observed match: true (role=menu became visible)
  • Confirming evidence: "5 child options appeared in a [role=menu] container"
  → Classifier uses this as a strong signal: this is a Select interaction.
```

**Critical constraint:** Expected Behaviour is advisory only. The classifier may use it to break ties. It may NOT use it to override clear evidence. If evidence rules say "this is a checkbox" but expected behaviour says "dropdown should expand," the evidence wins.

### 3.9 How it feeds Stage 4b (AI Enrichment)

In the future Layered Execution Plan, Expected Behaviour maps to Layer 2 (VALIDATION):

| Expected Behaviour Field | Execution JSON Layer 2 Field |
|--------------------------|------------------------------|
| `expectation` | `postcondition.description` |
| `confirmingEvidence` | `postcondition.evidence` |
| `expectationConfidence` | `postcondition.confidence` |

This is the foundation for assertion-rich Playwright generation in future milestones.

### 3.10 How it does NOT change existing behavior

- **No change to the 5 confidence tracks.** Expected Behaviour confidence (`expectationConfidence`) is a field within the Change Analysis domain, not a 6th independent track. It feeds into `changeConfidence` as one input.
- **No change to Layer 1 or Layer 3.** This is purely additive to Layer 2.
- **No change to the classifier's Tier 1 (deterministic) resolution.** Expected Behaviour only participates at Tier 2 (advisory).
- **No change to downstream generators.** Stages 3b, 4a, and 5 do not read `expectedBehaviour` today. It is available for future consumption.
- **AI can return null.** When an action has no meaningful expected behaviour (e.g., hovering over an element), AI returns `null` for the expectation. No penalty.

### 3.11 Verdict

**ADOPT as a sub-domain of Change Analysis (Option B).** This is an additive enhancement to the frozen architecture. It provides proactive context that improves classification at Tier 2, seeds future validation/assertion generation, and has a clear graduation path to a full domain if future experience warrants.

---

## 4. Summary of Recommendations

| Question | Recommendation | Type | Frozen? |
|----------|---------------|------|---------|
| 1. AI Understanding as Advisory Input | **ADOPT** — formalize the Advisory Input Pattern with a three-tier decision process (Deterministic → Advisory → Default) | Clarification of existing frozen behavior | **YES — frozen** |
| 2. Sliding Session Window vs Single Snapshot | **ADOPT** — formalize the Sliding Session Window (already implemented in frozen `ReasoningInput`) with explicit parameters (default 5, ceiling 10, three-channel context package) | Clarification of existing frozen behavior | **YES — frozen** |
| 3. Expected Application Behaviour | **ADOPT** as sub-domain of Change Analysis (Option B) with additive data structure and future graduation path to full domain | Additive enhancement | **YES — frozen** |

### What did NOT change

- The five-stage pipeline — unchanged
- Three-layer Session Context — unchanged
- Write-protection boundary — unchanged
- Five confidence tracks — unchanged (Expected Behaviour feeds into Change Analysis, not a 6th track)
- AI constraints (all 10 negative + 2 positive) — unchanged
- Transient nature of Session Context — unchanged
- LLM-independent design — unchanged
- All frozen milestones (PA1-PA12, B1-B8, C3-C6, E2E Architecture, Phase 2) — unchanged

### Net additions to the frozen architecture

| Addition | Impact |
|----------|--------|
| Advisory Input Pattern (named concept) | Zero structural change — names existing behavior |
| Three-tier classifier decision process | Formalizes existing mechanism (Tier 1 deterministic, Tier 2 advisory, Tier 3 default) |
| Sliding Session Window (named concept) | Zero structural change — names existing `ReasoningInput` design |
| Expected Application Behaviour sub-domain | Additive to Layer 2 Change Analysis — new fields, no changes to existing fields |

---

## 5. Freeze Addendum

The following additions to the frozen AI Observer & Session Context architecture are declared **frozen**:

| # | Addition |
|---|----------|
| 15 | **Advisory Input Pattern:** AI Understanding is advisory context to the deterministic classifier. The classifier uses a three-tier decision process: Tier 1 (deterministic evidence rules — always runs), Tier 2 (advisory AI hints — only when Tier 1 is ambiguous), Tier 3 (default fallback — 'click'). Final classification authority is always deterministic. |
| 16 | **Sliding Session Window:** The AI Observer sends a bounded context package per reasoning cycle: (a) current interaction semantic snapshot, (b) last 5 captured actions as semantic summaries (configurable, ceiling 10), (c) previous AI Understanding as compressed history, (d) current Deterministic State from Layer 1. Token cost is constant regardless of session length. |
| 17 | **Expected Application Behaviour (sub-domain of Change Analysis):** After each interaction, AI reasons about what the application should do in response. Tracked as `{ expectation, observedMatch, confirmingEvidence, expectationConfidence }` within the Change Analysis domain. Used as advisory context at Tier 2 classification, and as the foundation for future Execution JSON validation layers and assertion generation. Does NOT add a 6th confidence track. AI may return null when no meaningful expectation exists. |

---

*This addendum is consistent with all frozen milestones and the AI Observer & Session Context architecture. No frozen decision is modified. All additions are additive clarifications or extensions.*

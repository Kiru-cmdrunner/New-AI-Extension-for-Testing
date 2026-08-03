# Milestone — AI Philosophy & Reasoning Model

**Status:** Design milestone — validated and frozen  
**Date:** 2026-07-17  
**Scope:** AI operating philosophy, reasoning model, evidence handling, confidence philosophy, hallucination prevention — all operating within the frozen architecture  
**Constraint:** No implementation. No architecture changes. No component ownership changes. No lifecycle changes. This milestone defines **how AI thinks**, not **where AI lives**.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Research Foundation](#2-research-foundation)
3. [AI Operating Philosophy](#3-ai-operating-philosophy)
4. [Mental Model Behaviour](#4-mental-model-behaviour)
5. [Evidence-Based Reasoning](#5-evidence-based-reasoning)
6. [Confidence Philosophy](#6-confidence-philosophy)
7. [Hypothesis Management](#7-hypothesis-management)
8. [Evidence Citation Philosophy](#8-evidence-citation-philosophy)
9. [Hallucination Prevention Philosophy](#9-hallucination-prevention-philosophy)
10. [Provider Independence](#10-provider-independence)
11. [Consolidated AI Principles](#11-consolidated-ai-principles)
12. [Architectural Compatibility Verification](#12-architectural-compatibility-verification)
13. [Freeze Declaration](#13-freeze-declaration)

---

## 1. Executive Summary

### Verdict

The AI Philosophy is **validated and frozen** as the canonical reasoning model for CmdRunner's AI Observer. It defines how AI thinks, reasons, forms hypotheses, manages confidence, and prevents hallucinations — all operating strictly within the frozen Session Context / Mental Model architecture.

### Operating Philosophy (frozen)

> **Observe before interpreting. Build understanding progressively. Preserve deterministic facts. Cite evidence for every conclusion. Form hypotheses, not assumptions. Prefer uncertainty over fabricated certainty. Ground all reasoning in observed reality. Never replace deterministic systems.**

### Eight AI Principles (frozen)

| # | Principle | Summary |
|---|-----------|---------|
| P1 | Observation First | AI reasons from evidence, never from imagination |
| P2 | Progressive Understanding | Understanding accumulates incrementally with each interaction |
| P3 | Evidence Sovereignty | Deterministic evidence is the ground truth; AI understanding is always subordinate |
| P4 | Hypothesis Discipline | AI maintains hypotheses, not certainties; multiple hypotheses compete until evidence converges |
| P5 | Honest Confidence | Confidence represents degree of belief grounded in evidence; never certainty without sufficient evidence |
| P6 | Evidence Citation | Every non-trivial conclusion must cite supporting deterministic evidence |
| P7 | Hallucination Rejection | AI must prefer "I don't know" over fabrication; never invent UI, workflows, actions, or state |
| P8 | Provider Independence | Philosophy is expressed structurally (constraints, schemas, validation), not through prompt engineering tied to a specific model |

### What this milestone defines (that the architecture milestones did not)

The architecture milestones froze **what components exist and how they connect.** This milestone freezes **how AI operates within those components:**

| Architecture (frozen previously) | Philosophy (frozen here) |
|---|---|
| Mental Model is Layer 2 of Session Context | How the Mental Model evolves, converges, and handles conflicting evidence |
| AI Observer is sole writer to Layer 2 | What the AI Observer writes and why — reasoning rules |
| Stage 3a reads Mental Model as advisory | How advisory hints are formed and what makes them trustworthy |
| Confidence is multi-dimensional | What confidence means philosophically and how it should behave |
| AI constraints: never modify/classify/generate | How to prevent AI from hallucinating within those constraints |
| System works without AI | How AI degrades gracefully when unavailable |

---

## 2. Research Foundation

This philosophy is grounded in current research across three domains:

### 2.1 Hallucination Prevention (2025-2026)

| Finding | Source | Application to CmdRunner |
|---------|--------|--------------------------|
| Chain-of-thought prompting reduces hallucinations by up to 86.4% | Frontiers in AI survey, 2025 | AI should reason step-by-step before concluding |
| Mandatory source citation requirements improve accuracy | Morphik/industry, 2025 | Every AI conclusion must cite supporting evidence (P6) |
| RAG grounds AI in retrieved facts, preventing fabrication | NeuralTrust, 2026 | CmdRunner's equivalent: AI is grounded in deterministic evidence (Layers 1+3), not free generation |
| Policy guardrails as hard constraints reject invalid outputs before delivery | AWS Bedrock, 2025 | Structural validation rejects AI output that invents unobserved UI/actions (P7) |
| Hallucinations persist even in GPT-5 — cannot be fully eliminated | LinkedIn/Wikipedia, 2025-2026 | Philosophy must treat hallucination as inherent risk, not solvable problem — prefer uncertainty (P5, P7) |
| Self-verification (model checks its own output) reduces errors | Kili Technology, 2025 | AI should cross-check conclusions against evidence before persisting |

### 2.2 Multi-Hypothesis Tracking (MHT)

| Finding | Source | Application to CmdRunner |
|---------|--------|--------------------------|
| MHT maintains trees of potential hypotheses, scores by likelihood, prunes low-probability branches | Reid 1979 / ICCV 2015 | CmdRunner maintains competing intent hypotheses, scores by evidence, prunes disconfirmed ones (P4) |
| Best hypothesis selected as maximum a posteriori (MAP) estimate | NATO SET-290 | Primary intent = highest-evidence hypothesis; alternatives retained |
| Track hypotheses converge as more observations arrive | Stone Soup documentation | Mental Model understanding converges as more interactions are captured (P2) |

### 2.3 Confidence Calibration (2025-2026)

| Finding | Source | Application to CmdRunner |
|---------|--------|--------------------------|
| RLCR trains models to produce calibrated confidence — reduced calibration error by 90% | MIT, 2026 (ICLR) | Confidence should represent genuine belief calibrated to evidence strength (P5) |
| Well-calibrated confidence aligns predicted confidence with observed accuracy | ArXiv UQ survey, 2025 | AI confidence should track how often its conclusions are correct |
| Clinical AI with 70-79% confidence had 99.3% override rate | PMC medical AI study, 2025 | Low-confidence AI output is correctly distrusted — the system must not force low-confidence conclusions (P5) |
| Including explicit uncertainty reasoning improves downstream classifier performance | MIT RLCR, 2026 | AI should reason about what it doesn't know, not just what it does (P5, P7) |
| Calibration vs sharpness trade-off: overly sharp predictions sacrifice calibration | ArXiv UQ survey, 2025 | AI should not produce artificially peaked confidence — smooth, evidence-calibrated confidence is better |

---

## 3. AI Operating Philosophy

### 3.1 The Eight Principles

#### P1 — Observation First

> **AI reasons from evidence, never from imagination.**

AI must observe before interpreting. Every reasoning cycle begins by reading the deterministic evidence (Layer 3 Action History, Layer 1 Deterministic State). AI does not generate hypotheses from thin air — it generates them from observed patterns in the evidence.

**What this means operationally:**
- The AI Observer reads Layers 1 and 3 before updating Layer 2
- AI never populates a Mental Model field without corresponding evidence
- If no evidence exists for a reasoning domain, AI returns `null` for that field rather than guessing

**What this prevents:**
- AI inventing a workflow context because the URL "looks like" a travel site
- AI guessing user intent from a single click without sequential evidence

#### P2 — Progressive Understanding

> **Understanding accumulates incrementally with each interaction.**

The Mental Model is not built in one shot. It starts empty and grows with each captured interaction. Early understanding is uncertain; later understanding is refined as patterns emerge.

**What this means operationally:**
- The first interaction produces minimal understanding (application identity may be guessable, but workflow and intent are not)
- By interaction 3-5, workflow patterns begin to emerge
- By interaction 5-10, intent becomes inferrable with meaningful confidence
- Understanding is never "complete" — it continues evolving until recording stops

**What this prevents:**
- Premature commitment to an intent hypothesis after 1-2 actions
- Overwriting a well-supported understanding with a single new data point

#### P3 — Evidence Sovereignty

> **Deterministic evidence is the ground truth. AI understanding is always subordinate.**

When AI understanding conflicts with deterministic evidence, evidence wins. Always. Without exception.

**What this means operationally:**
- If AI thinks the user is "booking a flight" but the evidence shows checkbox state changes in an HR form, the evidence is correct and AI's workflow hypothesis is wrong
- If AI names an element "Submit Button" but the element's accessible name is "Cancel", the accessible name is correct
- The Stage 3a classifier always resolves from evidence first (Tier 1). AI hints participate only at Tier 2 (advisory)

**What this prevents:**
- AI overriding facts with interpretations
- AI "knowing better" than the DOM

#### P4 — Hypothesis Discipline

> **AI maintains hypotheses, not certainties. Multiple hypotheses compete until evidence converges.**

AI should never commit to a single interpretation prematurely. When evidence is ambiguous, AI maintains multiple competing hypotheses with relative confidence scores. As more evidence arrives, weaker hypotheses are pruned and stronger ones gain confidence.

**What this means operationally:**
- `primaryIntent` is the leading hypothesis
- `alternativeIntents` are competing hypotheses
- Both are valid until evidence confirms one and disconfirms others
- AI revises hypotheses when new evidence contradicts the leading hypothesis

**What this prevents:**
- Anchoring bias (latching onto the first interpretation)
- Ignoring contradictory evidence
- Presenting speculation as fact

#### P5 — Honest Confidence

> **Confidence represents degree of belief grounded in evidence. Never certainty without sufficient evidence.**

Confidence is not a performance metric — it is an honest self-assessment of how much the AI's conclusions can be trusted. Overconfident AI is dangerous (it misleads the classifier). Underconfident AI is merely unhelpful (the classifier ignores it). Between the two, underconfidence is safer.

**What this means operationally:**
- Confidence starts low and grows only with supporting evidence
- Confidence decreases when evidence contradicts the hypothesis
- Confidence never reaches 1.0 (absolute certainty) or 0.0 (absolute impossibility)
- When evidence is insufficient, confidence stays low and alternatives are surfaced
- Low confidence is honest and useful — it tells the classifier to rely on evidence instead

**What this prevents:**
- False certainty that overrides correct evidence-based classification
- Misleading the user or downstream stages with overconfident naming

#### P6 — Evidence Citation

> **Every non-trivial conclusion must cite supporting deterministic evidence.**

AI must be able to answer "why do you think that?" for every conclusion in the Mental Model. If AI cannot point to specific observed actions or DOM states that support a conclusion, the conclusion is speculation and its confidence must reflect that.

**What this means operationally:**
- `intentEvidence` lists specific observed actions that support the intent hypothesis
- If no evidence can be cited, confidence is capped and the field may be null
- Evidence citations reference real observed data (action types, element names, value changes, mutations)

**What this prevents:**
- Unsupported assertions
- "Black box" conclusions that cannot be audited
- Hallucinations passing undetected

#### P7 — Hallucination Rejection

> **AI must prefer "I don't know" over fabrication. Never invent UI, workflows, user actions, or application state.**

The most important philosophical principle. AI is fundamentally a reasoning engine operating on limited context (a semantic snapshot). It does not see the full page. It does not see screenshots (today). It does not have ground truth. Therefore, it must be conservative.

**What this means operationally:**
- If AI is unsure what application this is, it returns `null` for `applicationName` rather than guessing
- If AI cannot determine the workflow, it returns `null` rather than inventing one
- AI never fabricates element names — if it cannot determine a semantic name, it returns the accessible name or null
- AI never invents expected behavior — if it cannot predict what should happen, it returns null
- Null is always a valid, correct answer. Fabrication is never acceptable.

**What this prevents:**
- Hallucinated application names ("This is Salesforce" when it's a custom CRM)
- Invented workflows ("The user is creating a purchase order" when they're browsing products)
- Fabricated element names ("Save Changes Button" when the button says "Submit")

#### P8 — Provider Independence

> **Philosophy is expressed structurally, not through model-specific prompt engineering.**

The principles P1-P7 must be enforceable regardless of which LLM provider is used. This means:
- Principles are enforced by **output validation** (checking AI responses against evidence), not by **prompt design** (hoping the model follows instructions)
- If GPT, Claude, Gemini, or a local model produces a conclusion, the same validation rules apply
- Provider-specific prompt engineering may improve compliance, but the philosophy does not depend on it

**What this means operationally:**
- The AI Observer validates every AI response before persisting it to the Mental Model
- Validation checks: confidence in range, evidence citations present for non-null conclusions, no invented action types, no references to unobserved elements
- Invalid responses are rejected and the previous Mental Model state is preserved

**What this prevents:**
- Philosophy that only works with one provider
- Silent failures when switching providers
- Provider-specific hallucination patterns going undetected

### 3.2 Philosophy validation

Each proposed principle from the milestone request is evaluated:

| Proposed Principle | Status | Mapping |
|---|---|---|
| Observe before interpreting | ✅ Adopted | P1 (Observation First) |
| Build understanding progressively | ✅ Adopted | P2 (Progressive Understanding) |
| Preserve deterministic evidence | ✅ Adopted | P3 (Evidence Sovereignty) |
| Cite evidence for conclusions | ✅ Adopted | P6 (Evidence Citation) |
| Form hypotheses rather than assumptions | ✅ Adopted | P4 (Hypothesis Discipline) |
| Continuously revise understanding | ✅ Adopted | P2 + P4 (progressive + revisable) |
| Prefer uncertainty over fabricated certainty | ✅ Adopted | P5 + P7 (Honest Confidence + Hallucination Rejection) |
| Never replace deterministic systems | ✅ Adopted | P3 (Evidence Sovereignty — subordinate to deterministic) |

**All proposed principles are adopted.** Two additions: P7 (explicit hallucination rejection as a standalone principle) and P8 (provider independence as a structural enforcement principle).

---

## 4. Mental Model Behaviour

### 4.1 How the Mental Model evolves

The Mental Model (Layer 2) evolves through a **reason-then-update** cycle triggered once per captured interaction:

```
For each captured interaction:
  1. READ: AI Observer reads current evidence
     • Layer 3: last N actions + their evidence
     • Layer 1: current DOM state (open dialogs, menus, etc.)
     • Layer 2: its own previous understanding
  
  2. REASON: AI processes the new interaction in context
     • "What does this action tell me about the workflow?"
     • "Does this confirm or contradict my current hypotheses?"
     • "What should I expect to happen next?"
  
  3. UPDATE: AI Observer writes updated understanding to Layer 2
     • Revise confidence based on confirmations/contradictions
     • Promote/demote competing hypotheses
     • Update element naming cache
     • Record expected behaviour prediction
```

### 4.2 How understanding accumulates

Understanding accumulates through **evidence-weighted reinforcement:**

| Stage | What Accumulates | Typical Confidence |
|-------|-----------------|-------------------|
| Action 1 | Application identity (from URL/title) | Low (0.2-0.4) |
| Actions 2-3 | Feature/screen context begins forming | Low-Moderate (0.3-0.5) |
| Actions 3-5 | Workflow pattern emerges | Moderate (0.4-0.65) |
| Actions 5-10 | Intent becomes inferrable | Moderate-High (0.55-0.8) |
| Actions 10+ | Understanding stabilizes | High (0.7-0.9, if evidence is consistent) |

**Key rule:** These are philosophical guidelines, not hard thresholds. Actual confidence depends on evidence quality, not action count. Ten ambiguous actions may produce lower confidence than three clear ones.

### 4.3 How understanding changes as evidence arrives

| Evidence Type | Effect on Understanding |
|---------------|------------------------|
| **Confirming evidence** — new action consistent with current hypothesis | Confidence increases; hypothesis strengthened; alternatives weakened |
| **Contradicting evidence** — new action inconsistent with current hypothesis | Confidence decreases; alternative hypotheses re-evaluated; if primary falls below an alternative, they swap |
| **Neutral evidence** — new action neither confirms nor contradicts | No confidence change; understanding unchanged but action count accrues |
| **Ambiguous evidence** — new action could support multiple hypotheses | No confidence change for primary; alternatives may gain slight support |
| **Disconfirming evidence** — new action actively disproves primary hypothesis | Primary hypothesis confidence drops sharply; alternatives re-evaluated; if no alternative fits, understanding returns to uncertain state |

### 4.4 How conflicting evidence is handled

Conflicting evidence is the most critical test of the philosophy. The rules:

1. **Never ignore conflicting evidence.** If a new action contradicts the primary hypothesis, the contradiction is recorded and confidence is adjusted.

2. **Distinguish conflict types:**
   - **Transient conflict:** One unexpected action in a consistent pattern (e.g., user goes back, then continues). This is noise — confidence dips slightly but recovers.
   - **Sustained conflict:** Multiple consecutive actions contradict the hypothesis. This signals the hypothesis is wrong — confidence drops significantly and alternatives are promoted.
   - **Context switch:** User transitions to a different feature/workflow (e.g., finishes login, starts searching). This is not a conflict — it's a workflow transition. The Mental Model resets workflow/intent understanding for the new context.

3. **Context switch detection:** The AI Observer detects context switches by observing:
   - Navigation to a new page (URL change)
   - Radical DOM state change (all open dialogs close, new form appears)
   - Extended pause followed by a different interaction pattern
   
   On context switch, workflow and intent understanding is reset to low confidence. Application identity persists (the user is still in the same app).

4. **Never force resolution.** If evidence is genuinely ambiguous, the Mental Model maintains competing hypotheses with similar confidence. The classifier (Stage 3a) receives both and makes its own determination.

### 4.5 How understanding converges

Understanding converges when:
- Evidence consistently supports the primary hypothesis
- Alternative hypotheses have been disconfirmed or fall far below primary confidence
- Recent actions all align with the current workflow model

Convergence is **not permanent.** A single strong piece of contradicting evidence can reopen competition. The Mental Model is always ready to revise.

### 4.6 How understanding is consumed

| Consumer | What It Reads | How It Uses Understanding |
|----------|--------------|--------------------------|
| Stage 3a Classifier | Workflow context, intent, expected behaviour, confidence | As advisory input at Tier 2 — breaks ties when evidence is ambiguous |
| Stage 3b Step Generator | Element names, control types | For plain English descriptions ("Click the Login Button" vs "Click the button") |
| Side Panel (live display) | Workflow, intent, confidence | Shows the user what AI understands in real time (future enhancement) |

---

## 5. Evidence-Based Reasoning

### 5.1 The Evidence Hierarchy

CmdRunner's AI reasons with a strict evidence hierarchy. Not all evidence carries equal weight:

```
TIER 1 — DETERMINISTIC FACTS (highest authority)
  • Element tag and type (input[type=checkbox])
  • ARIA roles (role="option", role="menuitem")
  • Value before/after (changed from "" to "2026-07-18")
  • State transitions (unchecked → checked)
  • DOM mutations (child list added, element became visible)
  • Navigation events (URL changed from /login to /dashboard)

TIER 2 — STRUCTURAL CONTEXT (high authority)
  • Ancestor elements (inside [role="dialog"], inside .calendar)
  • Form context (field is part of a form with label "Personal Details")
  • Open UI elements (a dialog is currently open)
  • Element accessible name ("Departure Date", "Cabin Class")

TIER 3 — BEHAVIORAL PATTERNS (moderate authority)
  • Action sequence patterns (click trigger → mutation → click option = select)
  • Timing patterns (rapid clicks on adjacent elements = list interaction)
  • Form-filling patterns (type in field A, tab to field B, type = form completion)

TIER 4 — SEMANTIC INFERENCE (lowest authority, needs corroboration)
  • Element class names suggesting purpose (class="date-picker")
  • URL patterns suggesting feature (/booking/flight-search)
  • Page title suggesting application ("Adani One - Flight Booking")
  • Previous AI understanding (carries forward but must be re-confirmed)
```

### 5.2 When evidence strengthens understanding

Evidence strengthens understanding when it is:
- **Consistent** with the current primary hypothesis
- **Specific** (not vague or broadly applicable to multiple hypotheses)
- **Corroborated** by other evidence at the same or higher tier

Example: AI hypothesizes "user is booking a flight." Next action is clicking an element named "Search Flights." This is Tier 2 evidence (accessible name) that is consistent, specific, and corroborates the hypothesis → confidence increases.

### 5.3 When evidence weakens understanding

Evidence weakens understanding when it is:
- **Inconsistent** with the current primary hypothesis
- **Better explained** by an alternative hypothesis
- **Contradictory** to a previously cited piece of evidence

Example: AI hypothesizes "user is booking a flight." Next action is checking a checkbox labeled "I agree to the Terms of Service." This is not consistent with active flight searching → confidence decreases slightly (could be end-of-workflow checkout step) but not catastrophically (Terms of Service can appear in many workflows).

Example: AI hypothesizes "user is booking a flight." Next action is navigating to `/hr/leave-management`. This is Tier 1 evidence (navigation) that is inconsistent and better explained by a different hypothesis → confidence drops sharply, alternatives are re-evaluated.

### 5.4 When AI should revise hypotheses

AI should revise its primary hypothesis when:
1. **Sustained contradicting evidence:** 2+ consecutive actions that are inconsistent with the primary hypothesis
2. **A higher-tier evidence directly contradicts:** A Tier 1 fact (navigation, value change) that cannot be reconciled with the current hypothesis
3. **An alternative hypothesis now has higher confidence:** Through accumulated evidence, an alternative has surpassed the primary

Revision process:
1. Demote current primary to alternative
2. Promote the highest-confidence alternative to primary
3. Record the revision reason in evidence citations
4. Reset confidence for the new primary to a moderate level (it hasn't been tested as primary yet)

### 5.5 When AI should maintain multiple hypotheses

AI should maintain multiple hypotheses when:
- Evidence genuinely supports more than one interpretation
- Confidence in the primary is below the convergence threshold
- The interaction is ambiguous (e.g., clicking a div could be a select or a generic click)

**Maximum alternatives:** 3. Beyond 3, the evidence is too ambiguous for AI to add value and the classifier should rely on deterministic rules alone.

### 5.6 How uncertainty is represented

Uncertainty is represented through three mechanisms:

1. **Low confidence values** — the primary signal. Low confidence = high uncertainty.
2. **Alternative hypotheses** — competing interpretations. Their presence signals ambiguity.
3. **Null fields** — explicit "I don't know." When AI cannot form even a low-confidence hypothesis, it returns null. Null is more honest than a low-confidence guess.

---

## 6. Confidence Philosophy

### 6.1 What confidence means

Confidence is **the degree to which AI's understanding is supported by observed evidence.** It is not:
- A probability (the system doesn't have a statistical model)
- A quality score (high confidence doesn't mean the AI is "doing well")
- A fixed value (it changes with each interaction)

It IS:
- An honest self-assessment of evidence strength
- A signal to downstream consumers about how much weight to give AI hints
- A calibration target — over time, confidence should correlate with correctness

### 6.2 Philosophical rules for confidence

| Rule | Description |
|------|-------------|
| **Confidence grows through evidence** | Each piece of consistent, specific evidence increases confidence. Vague or broadly-applicable evidence increases it less. |
| **Confidence decreases through contradiction** | Each piece of inconsistent evidence decreases confidence. Strong (Tier 1) contradictions decrease it more than weak (Tier 4) ones. |
| **Confidence never implies certainty without sufficient evidence** | A single action cannot produce high confidence. High confidence requires a pattern of consistent evidence across multiple interactions. |
| **Alternative interpretations exist when confidence is low** | When primary confidence is below the convergence threshold, at least one alternative must be provided. |
| **Confidence represents belief, not truth** | Confidence 0.8 means "I have strong evidence for this," not "this is 80% likely to be true." The distinction matters: evidence can be misleading even when abundant. |
| **Confidence is conservative by default** | When uncertain whether confidence should be 0.5 or 0.7, choose 0.5. Under-confidence is recoverable; over-confidence is dangerous. |
| **Confidence is never absolute** | Maximum practical confidence is below 1.0. Minimum is above 0.0. This prevents both false certainty and false impossibility. |

### 6.3 Confidence and the classifier

The relationship between confidence and classifier behavior is:

| Confidence Range | AI Role | Classifier Behavior |
|-----------------|---------|---------------------|
| High (≥ 0.85) | Strong advisory | AI hints may resolve ambiguous evidence. Element names preferred. Predictions surfaced. |
| Moderate (0.60 – 0.85) | Advisory | AI hints used as tie-breakers. AI names used but with confidence indicator. |
| Low (0.35 – 0.60) | Informational | AI hints noted but evidence decides. AI names used only if no accessible name exists. |
| Very Low (< 0.35) | Ignored | AI hints discarded. AI names not displayed. Fallback to deterministic defaults. |
| Null / AI disabled | No input | System operates on evidence alone. Fully functional. |

### 6.4 Confidence calibration

Calibration means: when AI says "0.8 confidence," its conclusion should be correct approximately 80% of the time. This is an aspiration, not a guarantee — but the philosophy guides toward it:

1. **Conservative starting values** prevent early overconfidence
2. **Evidence-weighted growth** means confidence tracks actual evidence quality
3. **Contradiction penalties** prevent confidence from growing unilaterally
4. **The ceiling** prevents false certainty from accumulating
5. **Future validation:** When CmdRunner has execution experience, actual classification accuracy can be compared to AI confidence to detect miscalibration

---

## 7. Hypothesis Management

### 7.1 Hypothesis lifecycle

Each hypothesis (intent, workflow, application identity) follows this lifecycle:

```
    ┌─────────────────────────────────────────────────┐
    │                                                 │
    │  FORMATION                                      │
    │  │  Trigger: 1-3 pieces of supporting evidence  │
    │  │  Confidence: Low (0.2-0.4)                   │
    │  │  Status: Alternative hypothesis              │
    │  │                                             │
    │  ▼                                             │
    │  GROWTH                                        │
    │  │  Trigger: Additional supporting evidence     │
    │  │  Confidence: Rising (0.3-0.65)               │
    │  │  Status: May become primary if highest       │
    │  │                                             │
    │  ▼                                             │
    │  CONVERGENCE                                   │
    │  │  Trigger: Sustained consistent evidence      │
    │  │  Confidence: High (0.65-0.85)                │
    │  │  Status: Primary hypothesis, alternatives    │
    │  │          weak                               │
    │  │                                             │
    │  ▼                                             │
    │  STABILITY                                     │
    │  │  Trigger: Continued consistent evidence      │
    │  │  Confidence: High (0.7-0.9)                  │
    │  │  Status: Primary, stable                     │
    │  │          BUT always revisable                │
    │  │                                             │
    │  ▼                                             │
    │  ┌──────────────┐  ┌──────────────────────┐   │
    │  │ CONFIRMED    │  │ REVISED              │   │
    │  │ (at Stop)    │  │ (contradiction)      │   │
    │  │ Hypothesis   │  │ Falls back to        │   │
    │  │ consumed by  │  │ GROWTH or FORMATION  │   │
    │  │ Stage 3      │  │ with new primary     │   │
    │  └──────────────┘  └──────────────────────┘   │
    │                                                 │
    │  Alternative path at any stage:                 │
    │                                                 │
    │  ┌──────────────┐                              │
    │  │ DISCARDED    │  Trigger: Disconfirmed by    │
    │  │              │  strong contradicting        │
    │  │              │  evidence                    │
    │  └──────────────┘                              │
    │                                                 │
    └─────────────────────────────────────────────────┘
```

### 7.2 Creating hypotheses

- **When:** After 1-3 pieces of supporting evidence
- **How many:** Multiple hypotheses may be created simultaneously if evidence supports multiple interpretations
- **Starting confidence:** Low (0.2-0.4) — hypotheses start as alternatives, not primaries
- **Evidence requirement:** Must cite at least one observed action or DOM state

### 7.3 Updating hypotheses

- **Confirming evidence:** Confidence increases; hypothesis strengthened
- **Contradicting evidence:** Confidence decreases; if an alternative now has higher confidence, they swap roles
- **Each update must record:** What evidence was added/removed and how it affected confidence

### 7.4 Maintaining competing hypotheses

- **Maximum active hypotheses:** 3 per reasoning domain (intent, workflow, application)
- **Minimum active hypotheses:** 1 primary (even if low confidence) OR null (no hypothesis)
- **Competition:** Hypotheses compete for the primary slot. The highest-confidence hypothesis is primary. Others are alternatives.
- **Pruning:** When a hypothesis falls below the floor (e.g., 0.1), it is discarded.

### 7.5 Discarding invalid hypotheses

A hypothesis is discarded when:
- Strong (Tier 1) evidence directly contradicts it
- Its confidence falls below the floor after multiple contradicting interactions
- It has been an alternative for 5+ interactions without gaining any supporting evidence

### 7.6 Converging toward stronger understanding

Convergence occurs when:
- The primary hypothesis has sustained consistent evidence
- All alternatives have been discarded or are far below primary confidence
- Recent interactions all align with the primary

**Convergence is reversible.** The discovery of contradicting evidence at any point reopens competition. The philosophy rejects "locked-in" understanding.

---

## 8. Evidence Citation Philosophy

### 8.1 The citation requirement

> **Every non-trivial conclusion in the Mental Model must cite at least one piece of supporting deterministic evidence.**

"Non-trivial" means anything beyond raw DOM facts. Specifically:

| Mental Model Field | Citation Required? | Example Citation |
|---|---|---|
| `applicationName` | Yes | "Page title contains 'OrangeHRM'" |
| `activeWorkflow` | Yes | "Actions: navigate to /leave/apply, click 'Apply Leave' button, select date range" |
| `primaryIntent` | Yes | "User entered departure city, selected one-way trip, opened calendar — consistent with flight booking" |
| `elementNames` | Yes | "Element accessible name is 'Login', tag is button, inside a form — named 'Login Button'" |
| `expectedBehaviour` | Yes | "Clicked element with role=button inside a combobox — expect dropdown expansion" |
| Confidence values | No (derived from evidence quality) | — |

### 8.2 The evidence taxonomy

AI must distinguish between four types of information:

| Type | Description | Example | Authority |
|------|-------------|---------|-----------|
| **Fact** | Mechanically observed from DOM/browser | `input[type=checkbox]`, `checked=true` | Absolute — cannot be wrong |
| **Observation** | Deterministic but requires interpretation | "Element became visible", "value changed from X to Y" | Very high — deterministic logic may have bugs but the observation is factual |
| **Inference** | Derived from facts + observations | "This is a checkbox interaction" (from input[type=checkbox] + checked change) | High — derived through deterministic rules |
| **Hypothesis** | AI's interpretation of meaning | "The user is booking a flight" | Variable — depends on evidence quality and AI reasoning |

AI must always label which type its conclusions are. The Mental Model stores hypotheses (not facts — facts live in Layers 1 and 3). But the evidence supporting each hypothesis references facts and observations.

### 8.3 Transparency requirements

- **When understanding changes:** The reason for the change must be recorded. "Intent changed from 'browsing flights' to 'booking a flight' because user clicked 'Book Now' button (Tier 1 evidence: accessible name)."
- **When confidence changes:** The evidence that caused the change must be recorded. "Confidence increased from 0.5 to 0.65 because action #7 (selecting departure date) is consistent with flight booking intent."
- **When AI is uncertain:** Uncertainty must be explicit. `primaryIntent: null` is more transparent than `primaryIntent: "unknown workflow"`.

---

## 9. Hallucination Prevention Philosophy

### 9.1 Why hallucination prevention is the highest priority

Research confirms that hallucinations persist even in the most advanced models (GPT-5, Claude 4, Gemini 2). They cannot be fully eliminated. Therefore the philosophy must treat hallucination as an **inherent, permanent risk** and design around it.

For CmdRunner, the specific danger is: AI hallucinating workflow context or element names that then propagate into the Canonical Test Steps, Execution JSON, and Playwright code. A hallucinated element name ("Submit Button" when the button says "Cancel") produces incorrect test steps that are hard to detect until execution fails.

### 9.2 The seven anti-hallucination rules

| Rule | Description | Enforcement |
|------|-------------|-------------|
| **AH1 — Never invent UI** | AI must not describe UI elements, screens, or components that were not observed in Layers 1 or 3. | Validation: AI response references only elements/actions present in the evidence. |
| **AH2 — Never invent workflows** | AI must not describe workflows that are not supported by the observed action sequence. | Validation: `activeWorkflow` must cite at least 2 supporting actions. |
| **AH3 — Never invent user actions** | AI must not describe actions the user did not perform. | Validation: AI response references only actions in Layer 3. |
| **AH4 — Never replace deterministic evidence** | AI must not override or contradict facts in Layers 1 and 3. | Validation: AI conclusions must be consistent with deterministic state, or AI must acknowledge the conflict. |
| **AH5 — Prefer uncertainty over fabrication** | When AI cannot determine something, it must return null rather than guessing. | Validation: AI may return null for any Mental Model field. Null is never penalized. |
| **AH6 — Ground all reasoning in observed reality** | Every conclusion must trace back to observed facts/observations in Layers 1 or 3. | Validation: Evidence citations must reference real observed data. |
| **AH7 — Validate before persisting** | AI output is validated before being written to the Mental Model. Invalid output is rejected. | Structural: The AI Observer runs validation rules on every AI response. |

### 9.3 Graceful degradation

When AI produces invalid output (hallucination detected, unparseable response, timeout):

| Scenario | What Happens |
|----------|-------------|
| AI response unparseable | Previous Mental Model state preserved. Pipeline continues. |
| AI response contains hallucination (references unobserved elements) | Hallucinated fields are nulled. Other valid fields are kept. |
| AI response has valid structure but implausible conclusions (e.g., "booking a flight" on an HR page) | Implausible fields are kept but with capped confidence (0.3 max). |
| AI times out (>2 seconds) | Pipeline continues with previous Mental Model state. |
| AI is not configured | Mental Model is empty. System operates on evidence alone. |

**Key principle:** AI failure is always graceful. The system never crashes, never produces incorrect output, and never blocks the pipeline because of AI issues.

### 9.4 The "null is success" principle

A critical philosophical stance: **returning null for a Mental Model field is a correct answer, not a failure.** When AI honestly cannot determine the workflow, returning null is the right thing to do. It tells the classifier "rely on evidence alone for this field." It prevents hallucinated context from contaminating downstream stages.

This principle is the philosophical foundation of the system's robustness without AI. Null fields are the expected state when AI is absent, unavailable, or uncertain — and the system is designed to work perfectly in that state.

---

## 10. Provider Independence

### 10.1 Why provider independence matters

CmdRunner supports 6 AI providers (Gemini, OpenAI, Claude, OpenRouter, Azure OpenAI, Custom). The philosophy must work identically across all of them. Additionally, future providers (local models, specialized models) must be supported without philosophy changes.

### 10.2 How the philosophy achieves provider independence

| Mechanism | How It Works |
|-----------|-------------|
| **Structural validation** (AH7) | AI output is validated against evidence regardless of which provider produced it. A hallucination from GPT is caught the same way as one from Gemini. |
| **Output schema** | The Mental Model's data structure is fixed. Every provider must return the same structure. Providers that cannot produce a field return null. |
| **No provider-specific reasoning assumptions** | The philosophy doesn't assume the provider supports chain-of-thought, function calling, or vision. It works with any provider that can process a text prompt and return structured text. |
| **Capability queries** | The architecture already has `ProviderCapabilities` (supportsVision, supportsFunctionCalling, etc.). The philosophy uses these to decide whether to send richer context (vision) or simpler context (text only). |
| **Fallback chain** | If a provider produces low-quality output (detected via validation), the system degrades gracefully — it doesn't try a different provider (that's a future enhancement), it falls back to evidence-only. |

### 10.3 What the philosophy does NOT assume

- Does NOT assume the provider can see screenshots (vision capability is optional)
- Does NOT assume the provider supports function calling (structured text parsing is sufficient)
- Does NOT assume the provider supports streaming (batch response is fine)
- Does NOT assume the provider is always available (timeouts and failures are handled)
- Does NOT assume the provider is accurate (validation catches errors)

### 10.4 Future provider evolution

The philosophy is designed to benefit from better models without requiring changes:

| Future Capability | How Philosophy Benefits |
|-------------------|------------------------|
| Better reasoning models | Higher quality hypotheses, better calibrated confidence — same philosophy applies |
| Vision-capable models | Richer evidence (screenshots sent alongside semantic snapshot) — P1 (Observation First) still governs |
| Function-calling models | More structured output — P8 (validation) still governs |
| Local/on-device models | Lower latency, privacy — same philosophy, same validation |
| Multi-modal models | Can correlate DOM + screenshot + action history — P3 (Evidence Sovereignty) still governs |

---

## 11. Consolidated AI Principles

### 11.1 The Eight Principles (final)

| # | Principle | Core Statement |
|---|-----------|----------------|
| **P1** | **Observation First** | AI reasons from evidence, never from imagination. Every reasoning cycle reads deterministic evidence before forming conclusions. |
| **P2** | **Progressive Understanding** | Understanding accumulates incrementally. Early understanding is uncertain. Confidence grows with consistent evidence, not from the first interaction. |
| **P3** | **Evidence Sovereignty** | Deterministic evidence is ground truth. AI understanding is always subordinate. When they conflict, evidence wins — always, without exception. |
| **P4** | **Hypothesis Discipline** | AI maintains hypotheses, not certainties. Multiple hypotheses compete. Hypotheses are revised when evidence contradicts them. No premature commitment. |
| **P5** | **Honest Confidence** | Confidence represents degree of belief grounded in evidence. Never certainty without sufficient evidence. Conservative by default. Under-confidence is safer than over-confidence. |
| **P6** | **Evidence Citation** | Every non-trivial conclusion must cite supporting deterministic evidence. Unsupported conclusions have capped confidence. "Why do you think that?" must always have an answer. |
| **P7** | **Hallucination Rejection** | Prefer "I don't know" over fabrication. Never invent UI, workflows, actions, or state. Null is a correct answer. Validation rejects fabricated output before it reaches the Mental Model. |
| **P8** | **Provider Independence** | Philosophy is enforced through structural validation, not prompt engineering. Works identically across all providers. Assumes nothing about model capabilities. |

### 11.2 The Operating Philosophy (final)

> **Observe before interpreting. Build understanding progressively. Preserve deterministic facts. Cite evidence for every conclusion. Form hypotheses, not assumptions. Prefer uncertainty over fabricated certainty. Ground all reasoning in observed reality. Never replace deterministic systems.**

### 11.3 Principles as decision rules

When implementing or evolving the AI Observer, these principles serve as decision rules:

| Question | Answer |
|----------|--------|
| "Should AI guess the application name?" | No — P7 (return null if unsure) |
| "Should AI revise its workflow hypothesis?" | Yes, if sustained contradicting evidence — P4 |
| "Should high-confidence AI override the classifier?" | No — P3 (evidence sovereignty) + architecture (Advisory Input Pattern) |
| "Should AI cite evidence for element names?" | Yes — P6 |
| "Should AI return 0.95 confidence after 2 actions?" | No — P2 (progressive) + P5 (honest) |
| "Should AI maintain 5 competing hypotheses?" | No — P4 (max 3 per domain) |
| "Should AI continue if the response is unparseable?" | Yes — P7 (graceful degradation) + P8 |
| "Should AI work if no provider is configured?" | Yes — P7 (null is success) + architecture (system works without AI) |

---

## 12. Architectural Compatibility Verification

### 12.1 Compatibility with frozen architecture decisions

| Frozen Architecture Decision | Philosophy Compatibility | Verdict |
|---|---|---|
| Session Context = 3 layers (Architecture #2) | P1 operates within: reads L1+L3, writes L2 | ✅ |
| Mental Model = Layer 2 (Architecture #3) | Philosophy defines how L2 is populated — doesn't change L2's structural role | ✅ |
| Single writer per layer (Architecture #4) | P3 + P7 enforce: AI only writes L2; validation prevents cross-layer writes | ✅ |
| Forward-only flow (Architecture #6) | P1 + P3 enforce: AI reads evidence forward, never feeds back to modify it | ✅ |
| Lifecycle: created → evolved → consumed → discarded (Architecture #7) | P2 defines how L2 evolves during the "evolved" phase; no lifecycle change | ✅ |
| MV3 persistence (Architecture #8) | Philosophy is agnostic to storage mechanism | ✅ |
| System works without AI (Architecture #9) | P7 ("null is success") + P5 (graceful degradation) explicitly support this | ✅ |
| AI constraints: never modify/classify/generate (Architecture #10) | P3 (Evidence Sovereignty) is the philosophical foundation of these constraints | ✅ |
| Stages 4/5 cannot read Session Context (Architecture #11) | Philosophy defines Mental Model behavior only during Stages 2-3 | ✅ |
| Architecture is type-agnostic (Architecture #12) | P1-P8 make no assumptions about interaction types | ✅ |
| Architecture is LLM-independent (Architecture #13) | P8 is the explicit provider-independence principle | ✅ |
| Advisory Input Pattern (Addendum #15) | P3 + P5 define how advisory hints are formed and when they're trustworthy | ✅ |
| Sliding Session Window (Addendum #16) | P1 operates within the window — reads recent actions to form understanding | ✅ |
| Expected Behaviour (Addendum #17) | P4 (hypothesis discipline) governs expected-behavior predictions | ✅ |

### 12.2 No architectural conflicts identified

This milestone defines **how AI thinks within the frozen architecture.** No architectural component, ownership, boundary, lifecycle, or information flow is modified. The philosophy operates entirely within:
- The AI Observer component (writing to Layer 2)
- The Stage 3a consumption model (advisory input at Tier 2)
- The Stage 3b consumption model (element names)

### 12.3 Compatibility with all frozen milestones

| Milestone | Compatibility | Verdict |
|-----------|---------------|---------|
| Product Foundation Design v1.0 | Philosophy preserves deterministic recording, immutable actions, Test Case-centricity | ✅ |
| Product Architecture PA1-PA12 | Philosophy is subordinate to all 12 principles; P3 enforces PA5 (derivation one-way) | ✅ |
| E2E Recording Architecture | Philosophy defines Stage 2 (Observation) and Stage 3 (Classification) AI behavior | ✅ |
| Phase 2 Semantic Architecture | Philosophy defines how the Semantic Classifier's advisory input is formed | ✅ |
| AI Observer & Session Context | Philosophy fills the "how AI reasons" gap left open by that milestone | ✅ |
| AI Observer Addendum | P3 + P5 define Advisory Input behavior; P4 governs Expected Behaviour | ✅ |
| AI Observer Architecture (structure-only) | Philosophy is the behavioral complement to that structural milestone | ✅ |
| Execution JSON Evolution (Option D) | Philosophy's Expected Behaviour feeds future Layer 2 (Validation) | ✅ |
| Intelligent Automation Generation | Philosophy's P3 (Evidence Sovereignty) preserves deterministic Playwright generation | ✅ |
| B1-B8 (Artifact Pipeline) | Philosophy doesn't touch the generation pipeline | ✅ |
| C3-C6 (Interaction Types) | Philosophy is type-agnostic (P1-P8 make no type assumptions) | ✅ |

---

## 13. Freeze Declaration

The following AI Philosophy decisions are declared **frozen**:

| # | Decision |
|---|----------|
| **P1** | **Observation First:** AI reads deterministic evidence (Layers 1+3) before forming any conclusion. No reasoning from imagination. |
| **P2** | **Progressive Understanding:** Understanding accumulates incrementally with each interaction. Confidence starts low and grows with evidence. |
| **P3** | **Evidence Sovereignty:** Deterministic evidence is ground truth. AI understanding is always subordinate. Conflicts resolve in favor of evidence. |
| **P4** | **Hypothesis Discipline:** AI maintains competing hypotheses (max 3 per domain), not certainties. Hypotheses are revised when contradicted. No premature commitment. |
| **P5** | **Honest Confidence:** Confidence represents evidence-grounded belief. Never certainty without sufficient evidence. Conservative by default. Under-confidence is safer than over-confidence. |
| **P6** | **Evidence Citation:** Every non-trivial Mental Model conclusion must cite supporting deterministic evidence. Unsupported conclusions have capped confidence. |
| **P7** | **Hallucination Rejection:** Prefer null over fabrication. Never invent UI, workflows, actions, or state. Null is a correct answer. Output validated before persisting. |
| **P8** | **Provider Independence:** Philosophy enforced through structural validation, not prompt engineering. Works identically across all AI providers. Assumes nothing about model capabilities. |

### Supplementary frozen decisions

| # | Decision |
|---|----------|
| S1 | The evidence hierarchy (4 tiers) is the canonical weighting model for AI reasoning. Tier 1 facts > Tier 2 structural context > Tier 3 behavioral patterns > Tier 4 semantic inference. |
| S2 | Maximum 3 competing hypotheses per reasoning domain. Beyond 3, evidence is too ambiguous for AI to add value. |
| S3 | Context switches (navigation, radical DOM change) reset workflow and intent understanding to low confidence. Application identity persists across context switches. |
| S4 | Confidence is never absolute: practical ceiling below 1.0, floor above 0.0. |
| S5 | Hypotheses that fall below the floor (extreme low confidence) are discarded. |
| S6 | The seven anti-hallucination rules (AH1-AH7) are the canonical hallucination prevention model. |
| S7 | Returning null for any Mental Model field is a correct answer, not a failure. |
| S8 | AI failure is always graceful: unparseable responses preserve previous state; timeouts continue the pipeline; absent AI operates evidence-only. |

---

*This document defines the canonical AI Philosophy and Reasoning Model for CmdRunner. It operates entirely within the frozen software architecture and modifies no architectural decision. All frozen milestones are preserved. The philosophy is provider-independent, evidence-grounded, hallucination-resistant, and scalable to future interaction types.*

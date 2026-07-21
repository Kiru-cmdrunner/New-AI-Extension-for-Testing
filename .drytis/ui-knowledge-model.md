# UI Knowledge Model — Architecture Blueprint

> **Status:** Architecture complete. Phase 1 (foundational entities) implemented.
> Phases 2–7 (recognition, enrichment) designed, not yet built.
>
> **Last updated:** 2026-07-20 — design session capturing the full architecture.

## 1. Vision

CmdRunner's recording pipeline should produce not just executable test steps, but an
**application knowledge model** — a semantic understanding of the application's UI,
behavior, and relationships that serves as the foundation for future AI capabilities
(negative test generation, boundary testing, validation scenarios, alternate flow
generation, accessibility testing, self-healing).

The pipeline's output is dual:
1. **Test steps** (deterministic rendering of what happened)
2. **Application Knowledge Fragment** (semantic understanding of what the application IS)

AI is one consumer of the knowledge model, alongside recording, execution, self-healing,
reporting, and future capabilities. The model is **application-centric, not AI-centric**.

## 2. Core Paradigm: State-Centric Understanding

Shift from **event-centric recording** ("what the user did") to **state-centric
understanding** ("what the application is, how it behaves, and what changed").

- Event-centric: "clicked element A, typed into element B" → log of actions
- State-centric: "set Travel Class to Premium Economy" → state transitions with meaning

This reveals two gaps in the current pipeline:

**Gap 1 — Enrichment:** A single interaction needs richer context beyond "click."
What changed? What evidence confirms it? What else was affected?

**Gap 2 — Aggregation:** Multiple interactions form one business action.
"Open dropdown → Select Premium Economy → Click Done" = one semantic action.
The current coalescer handles micro-level temporal grouping, not semantic grouping.

## 3. The Component-Centric Model

### Elements are atomic. Components are composite.

**UiElement** — the fundamental unit. Every interactive element with mechanical identity,
DOM attributes, intrinsic capabilities, and optional component membership. Elements exist
independently regardless of component membership.

**UiComponent** — an optional composition layer. Multiple elements forming a recognized UI
pattern (dropdown, date picker, radio group, etc.). The Component owns pattern type,
aggregate state, and business meaning. It references Elements — it does not absorb them.

Key architectural rule:
> An Element owns its identity and intrinsic capabilities.
> A Component owns its pattern, aggregate state, and business meaning.
> A Component references Elements — it does not absorb them.
> Elements retain independent existence and can be interacted with directly regardless
> of component membership.

### Element roles within components

Elements have two kinds of capability:

1. **Intrinsic capabilities** — what the element can do as a DOM node (click, acceptText,
   focus, hover). Determined by tag + role + inputType. Belongs to the Element.

2. **Component role** — what the element does within the component (trigger, option,
   commit, cancel, etc.). Assigned by the Component, not inherent to the Element.

## 4. Component Recognition — Progressive, Three-Tiered

Recognition is fundamentally different from classification:
- Classification is per-element, stateless, one snapshot → one type
- Recognition is cross-element, cross-time, accumulates confidence across interactions

### Tier 1 — Structural (deterministic, <1ms)

Uses ARIA composite widget roles and native HTML semantics. When a user interacts with
an element whose ancestor chain includes a composite widget role (combobox, listbox,
menu, radiogroup, tablist, dialog, tree, grid), the component is recognized immediately.

ARIA roles are the page author's explicit declaration of semantic structure → evidence
sovereignty (AP4): structural facts override AI reasoning.

Coverage: ~40-50% of modern UIs (well-built component libraries).

### Tier 2 — Behavioral (deterministic, ~5ms)

Uses coalescer evidence (domMutations, valueChange, stateChange, classChange) to
recognize patterns when ARIA is absent. Each pattern defines a **behavioral signature** —
a combination of evidence signals.

Example dropdown signature: click on element → mutation shows child became visible →
child contains clickable elements → later: click on child → trigger text changed.

Coverage: ~35-45% (non-ARIA but functionally standard patterns).

### Tier 3 — AI-Assisted (async, ~200-500ms, deferred)

When neither structural nor behavioral produces a confident match, the AI Observer reasons
about whether elements form a component. Advisory only, confidence threshold ≥0.7.

Coverage: ~10-20% (unconventional widgets).

### Progressive lifecycle

```
TENTATIVE → DEVELOPING → CONFIRMED
                    ↘ REJECTED
```

- **Tentative:** Component hypothesis created on first evidence. Exists in registry,
  tracks constituent interactions, but isn't confirmed.
- **Developing:** Subsequent evidence consistent with hypothesis → confidence increases.
- **Confirmed:** Expected lifecycle fully observed (e.g., dropdown: open → select → close).
  Semantic Aggregator can emit the business-level action.
- **Rejected:** Evidence contradicts hypothesis → discarded, constituents revert to standalone.

### Constituent association

When a new interaction happens, determine if the element belongs to an existing component:
1. **DOM containment** (strongest) — is element a descendant of the component's root?
2. **Behavioral proximity** (medium) — did it appear in the same mutation batch as the popup?
3. **Temporal-spatial** (weakest, fallback) — appeared after activation, within popup bounds.

## 5. Relevance Filtering — In the Classifier, Not a Separate Stage

The classifier determines both interaction type AND relevance. No separate filtering stage.

**Principle:** An interaction is meaningful if and only if it produced an observable
change in application state.

Three relevance levels on every ClassifiedInteraction:

- **Deliberate** — purposeful action producing observable state change → enters Timeline
- **Supporting** — contextually meaningful but not standalone (component lifecycle mechanics)
  → enters Component Recognition and Session Context, may or may not enter Timeline
- **Noise** — zero observable outcome → filtered, never enters pipeline

Rule 16a (new): if no rule matched AND snapshot has zero evidence (no valueChange,
stateChange, classChange, mutations, navigation) → relevance: noise.

Contextual relevance (is this a standalone action or lifecycle mechanics?) is deferred to
Semantic Aggregation — requires component awareness that classification doesn't have.

## 6. The Domain Model: Three Foundations, Four Views

### Foundational entities (persisted as source of truth)

**1. UiElement** — the atom
- Mechanical identity (existing 18-field ElementIdentity)
- domAttributes: Record<string, string> (required, min, max, step, pattern, type, etc.)
  → source of InteractionContract derivation
- sourceUrl: which page this element was on → source of ApplicationSurface derivation
- domTreePath: DOM position path → source of SemanticRelationship derivation
- intrinsicCapabilities: derived from tag + role + inputType (pure function)
- componentId / componentRole: null if standalone

**2. ObservedTransition** — the behavioral raw data
- transitionId, elementId, componentId, operation, timestamp
- relevance: deliberate | supporting | noise
- stateBefore / stateAfter: ElementState (value, checked, expanded, selected)
- evidence: TransitionEvidence[] (valueChange, stateChange, classChange, mutation, navigation)
- cascadeEffects: CascadeEffect[] (elementId, effect type, detail)
- validationResult: ValidationResult | null (triggered, responseType, message, clearedOn)

**3. ComponentGrouping** — the semantic decision
- groupingId, patternType, rootElementId
- constituents: ConstituentRef[] (elementId + role)
- businessField: semantic name (AI-assigned, null until enrichment)
- recognitionSource: structural | behavioral | ai-assisted
- recognitionConfidence: 0.05–0.95
- lifecycleState: tentative → developing → confirmed | rejected
- optionSet: OptionEntry[] | null (full set extracted from DOM at enrichment)
- observedTransitionIds: string[]

### Derived views (materialized at enrichment, always recomputable)

| View | Computed from | Computation |
|------|--------------|-------------|
| InteractionContract | UiElement.domAttributes + PatternDefinition | Interpret attributes → constraints (required, valueRange, lengthRange, format, validOptions) |
| BehavioralContract | ObservedTransitions + ComponentGrouping + PatternDefinition | Synthesize transitions → stateMachine, validationBehavior, cascadeEffects, successIndicators |
| ApplicationSurface | UiElement.sourceUrl groupings | Page catalog, navigation graph, accessibility structure |
| RecordedWorkflow | ObservedTransitions ordered + ComponentGrouping | Ordered semantic actions, branch points, optional steps |

### SemanticRelationship graph (computed on demand)

Typed edges between entities:
- Structural (contains, labelFor, controls) — from domTreePath
- Behavioral (cascadesTo, dependsOn) — from cascadeEffects
- Semantic (AI-inferred) — from ComponentGrouping + AI reasoning

### Materialization policy

Foundational entities: always persisted. Derived views: materialized as cached snapshots
after enrichment pass (same principle as Execution IR — always regenerable).

## 7. Post-Recording Enrichment

Runs on Stop (after session ends, components confirmed):

1. For each confirmed Component: extract full option set from constituent elements' DOM
2. For each UiElement: build InteractionContract from domAttributes
3. For each confirmed Component: build BehavioralContract from observed transitions
4. Assemble ApplicationKnowledgeFragment (foundations + materialized views)

This is read-only DOM inspection — no interaction simulation, no side effects.

## 8. The Pipeline (End-to-End)

```
Raw Events → Coalescer → Classifier → Component Recognition → Semantic Aggregation
                          ↓                    ↓                    ↓
                     relevance:          ComponentGrouping     Semantic Actions
                     deliberate |         (tentative→confirmed)
                     supporting |
                     noise

→ Observed Workflow → Post-Recording Enrichment → Application Knowledge Fragment
```

- Classifier: unchanged three-tier rule engine, gains relevance field
- Component Recognition: new stage, reads ClassifiedInteraction, no feedback into classifier
- Semantic Aggregation: groups transitions by component lifecycle into business actions
- Enrichment: post-recording pass, materializes derived views from foundations
- Generation pipeline: unchanged — operates on Timeline as before

## 9. Future Capabilities → Knowledge Requirements

Each future capability traces to specific knowledge in the model:

| Capability | Requires | Source |
|-----------|----------|--------|
| Negative test generation | Input constraints + validation behavior | InteractionContract + BehavioralContract |
| Boundary value testing | Value ranges, length limits, option sets | InteractionContract |
| Validation scenario testing | Required flags, trigger timing, response type | InteractionContract + BehavioralContract |
| Alternate user flow generation | Branch points + full option sets | RecordedWorkflow + ComponentGrouping.optionSet |
| Accessibility testing | ARIA profiles, heading hierarchy, landmarks | UiElement.ariaProfile + ApplicationSurface |
| Self-healing | Ranked locator strategies + semantic identity | UiElement.locatorStrategies |

The critical insight: most of this knowledge is **inferred** (from DOM structure), not
**observed** (from user interaction). The enrichment pass is the mechanism that bridges
observed to inferred.

## 10. Design Principles

1. **Application-centric** — entities model the application. AI is a consumer.
2. **Three foundations, four views** — minimal persistence, maximal derivation.
3. **Progressive recognition** — tentative → developing → confirmed.
4. **Relevance in classifier** — no separate filtering stage.
5. **Evidence sovereignty preserved** — structural > behavioral > AI (AP4).
6. **Linear data flow** — recognition is downstream consumer, not feedback loop (AP5).
7. **Additive extensibility** — new patterns add rules, not new systems (AP7).
8. **Session-scoped → project-scoped** — foundations designed for promotion across sessions.

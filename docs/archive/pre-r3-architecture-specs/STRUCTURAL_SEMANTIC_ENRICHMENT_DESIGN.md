# Structural Semantic Enrichment — Formal Design Document

**Document Status:** Design — pending review and agreement  
**Date:** 2026-07-30  
**Relationship to existing architecture:** Sits between the Observation Model output (`ComponentInteraction`) and the downstream consumers (IR Bridge, timeline renderer, Capability Model). Extends `CMDRECORDER_ARCHITECTURE.md` and `OBSERVATION_MODEL_DESIGN.md` with a new enrichment layer. Does not modify either — it adds a layer between them.  
**Predecessor discussions:** Configuration session pattern analysis (2026-07-30), Capability Model Timing Assessment, Observation Model Design §8

---

## Table of Contents

1. [Motivation and Architectural Purpose](#1-motivation-and-architectural-purpose)
2. [The Three-Layer Distinction](#2-the-three-layer-distinction)
3. [Responsibilities and Boundaries](#3-responsibilities-and-boundaries)
4. [Core Concepts](#4-core-concepts)
5. [Data Model](#5-data-model)
6. [Structural Patterns](#6-structural-patterns)
7. [Transformation Rules](#7-transformation-rules)
8. [Discrimination: Configuration Session vs. Simple Interaction](#8-discrimination-configuration-session-vs-simple-interaction)
9. [Downstream Consumer Integration](#9-downstream-consumer-integration)
10. [Relationship with Existing Architecture](#10-relationship-with-existing-architecture)
11. [Design Principles](#11-design-principles)
12. [Invariants](#12-invariants)
13. [Edge Cases and Failure Modes](#13-edge-cases-and-failure-modes)
14. [Framework Agnosticism](#14-framework-agnosticism)
15. [Type Contracts](#15-type-contracts)
16. [Validation Criteria](#16-validation-criteria)
17. [Appendix A: Worked Examples](#appendix-a-worked-examples)
18. [Appendix B: Mapping to Observation Model Concepts](#appendix-b-mapping-to-observation-model-concepts)

---

## 1. Motivation and Architectural Purpose

### 1.1 The Problem

The Observation Model (Phase 0b) correctly groups physical events by surface ownership. When a user opens the Economy dropdown panel and adjusts Adults, Children, and Travel Class before clicking Done, the recorder produces a single `ComponentInteraction` with a `subActions` array:

```json
{
  "type": "Dropdown",
  "metadata": {
    "subActions": [
      { "action": "increment", "label": "Increase adults", "value": "2" },
      { "action": "increment", "label": "Increase children", "value": "1" },
      { "action": "selectOption", "label": "Premium Economy", "value": "Premium Economy" },
      { "action": "confirm", "label": "Done", "value": undefined }
    ],
    "isMultiConfig": true
  }
}
```

This is correct as an observation — it faithfully records what the user did. But it is an **action sequence**, not a **state description**. Downstream consumers must each independently re-interpret the action sequence to extract the information they actually need:

| Consumer | What it needs | What it gets today |
|----------|--------------|-------------------|
| Timeline renderer | "Configure Economy: Adults=2, Children=1, Class=Premium Economy" | Raw action list — must format each action separately |
| IR Bridge | Optimal Playwright strategy (fill vs. click) | Must infer target value from delta of increments |
| Future execution engines | "Set field X to value Y" | Must replay clicks blindly — non-idempotent |
| Capability Model (Phase 2) | Structured fields to classify | Must parse raw subActions to extract fields |
| AI reasoning | "The user configured passenger details" | Must infer field semantics from action labels |

Each consumer re-derives the same structural information from the raw action sequence. This is duplicated logic, inconsistent interpretations, and missed optimization opportunities.

### 1.2 The Insight

The structural information these consumers need — **which fields changed, to what values, and how the session was committed** — is fully derivable from the `subActions` array and the captured `ObservedEvent` data. It requires **zero application knowledge**:

- Field name: extracted from the subAction's label (e.g., "Increase adults" → "Adults")
- Field value: extracted from `valueAfter`, `checkedAfter`, `aria-valuenow`, or delta computation
- Commit action: identified by the `confirm` subAction type
- Session type: inferred from the composition of subAction types

No business context, no knowledge fragment, no application mapping is required.

### 1.3 The Purpose

This document defines a **Structural Semantic Enrichment** layer that transforms action sequences into state-based field representations. It is a **pure data transform** — input is `ComponentInteraction.metadata.subActions`, output is a `ConfigurationSession` object attached to the interaction's metadata.

The enrichment recognizes structural patterns (configuration sessions, commit/apply workflows) using only the data captured by the Observation Model. It does not assign business meaning. It provides a richer semantic representation that downstream consumers read directly, eliminating duplicated interpretation logic.

---

## 2. The Three-Layer Distinction

### 2.1 The Architectural Stack

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: OBSERVATION                                           │
│  "What did the user physically do?"                             │
│                                                                 │
│  EventTap → Component Runtime → ComponentInteraction           │
│  Output: subActions[] (action sequence — clicks, changes)      │
│  Data: physical events, element identities, DOM context         │
│  e.g., "User clicked a button labeled 'Increase adults'"        │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: STRUCTURAL SEMANTIC  ← THIS DOCUMENT                  │
│  "What state did those actions produce?"                        │
│                                                                 │
│  Structural Enrichment → ConfigurationSession                   │
│  Output: fields[] with final values + commit action             │
│  Data: derived from subActions via structural heuristics        │
│  e.g., "Field 'Adults' = 2, Field 'Travel Class' = Premium Eco" │
│  NO business meaning — doesn't know these are passengers        │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: BUSINESS SEMANTIC (Capability Model, Phase 2)         │
│  "What did the user mean in this application?"                  │
│                                                                 │
│  Capability Deriver + Knowledge Fragment                        │
│  Output: capability type, business field labels, workflow       │
│  Data: application knowledge, domain ontology                   │
│  e.g., "Configure Passenger & Cabin — a flight booking          │
│   capability with inputs: adults, children, travel class"       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Distinction: Structural vs. Business

| Property | Structural Semantic (Layer 2) | Business Semantic (Layer 3) |
|----------|-------------------------------|-----------------------------|
| Knows field values | ✅ "Adults = 2" | ✅ |
| Knows field names | ✅ "Adults" (from label) | ✅ "Number of Adult Passengers" (from app model) |
| Knows commit action | ✅ "Done button clicked" | ✅ "Confirmed passenger configuration" |
| Knows business purpose | ❌ | ✅ "Flight booking — passenger selection" |
| Knows application domain | ❌ | ✅ "Travel/E Aviation" |
| Requires app knowledge | ❌ No | ✅ Yes |
| Where it runs | Post-recording enrichment | Post-recording + knowledge fragment |
| When it can run | Immediately after STOP | After knowledge fragment available |

### 2.3 Why This Layer Must Not Merge with Layer 3

1. **Timing**: Layer 2 runs immediately after recording stops — no async knowledge fragment fetch needed. Layer 3 may require AI enrichment or knowledge base lookup.
2. **Determinism**: Layer 2 is a pure structural transform — same input always produces same output. Layer 3 may involve probabilistic classification.
3. **Generality**: Layer 2 applies to every application identically. Layer 3 requires per-application knowledge.
4. **Consumers**: Some consumers (IR Bridge, timeline) need only structural data and should not depend on the Capability Model being available.

---

## 3. Responsibilities and Boundaries

### 3.1 What the Structural Semantic Layer IS Responsible For

| Responsibility | Description |
|---------------|-------------|
| Pattern detection | Recognize whether a `ComponentInteraction` is a configuration session (multi-field changes with a commit action) vs. a simple interaction |
| Field extraction | Extract field name and value from each subAction using structural heuristics (label normalization, value extraction) |
| Value aggregation | Combine multiple subActions on the same field into a single final value (e.g., two `increment` subActions → net delta +2) |
| Commit identification | Identify the commit/apply/confirm action that signals the batch boundary |
| Session classification | Categorize the structural pattern (single-select, multi-field config, search-with-criteria, etc.) |
| Attachment | Attach the derived `ConfigurationSession` to `ComponentInteraction.metadata` for downstream consumption |

### 3.2 What the Structural Semantic Layer is NOT Responsible For

| Not Responsible | Belongs To |
|----------------|------------|
| Capturing events | Observation Model (EventTap, Component Runtime) |
| Classifying interaction type (Dropdown, DatePicker, etc.) | Component Definition (detectTrigger) |
| Assigning business meaning | Capability Model (Phase 2) + Knowledge Fragments |
| Mapping fields to business entities | Capability Model |
| Generating Playwright code | IR Bridge → Action Renderer |
| Rendering the side panel | Timeline Renderer |
| Deciding replay strategy (fill vs. click) | IR Bridge (informed by structural data) |

### 3.3 Boundary Contract

The Structural Semantic Enrichment:

- **Reads**: `ComponentInteraction.metadata.subActions`, `ComponentInteraction.type`, `ComponentInteraction.trigger`, `ComponentInteraction.memberEvents`
- **Writes**: `ComponentInteraction.metadata.configurationSession` (a new optional field)
- **Does NOT modify**: subActions, selectedValue, allSelections, or any existing metadata field
- **Does NOT consume**: Knowledge Fragments, Application Model, AI enrichment, external APIs
- **Does NOT require**: DOM access, network calls, async operations

---

## 4. Core Concepts

### 4.1 ConfigurationField

A single named value that the user changed within a configuration session.

```
ConfigurationField
├── label: "Adults"              (field name, structurally extracted)
├── kind: "counter"              (how the value was set: counter/select/toggle/text/date)
├── finalValue: "2"              (the end-state value after all changes)
├── delta: +2                    (net change for counters; undefined for absolute sets)
├── subActionCount: 2            (how many actions contributed to this field)
└── evidence: SubAction[]        (the raw actions that produced this field)
```

A field groups all subActions that modified the same logical value. Two `increment` subActions on "Adults" produce one `ConfigurationField` with `delta: +2`. A `selectOption` on "Premium Economy" produces one field with `finalValue: "Premium Economy"` and no delta (the value was set absolutely, not adjusted incrementally).

### 4.2 ConfigurationSession

A group of related field changes committed together by a single confirm action.

```
ConfigurationSession
├── fields: ConfigurationField[]    (the state changes)
├── commitAction: SubAction | null  (the Done/Apply/Search that committed)
├── triggerLabel: "Economy"         (what the user clicked to open the panel)
├── pattern: "multiFieldConfig"     (structural pattern recognized)
└── rawInteractionType: "Dropdown"  (the physical interaction type)
```

The session is the compound unit — "the user opened Economy, changed Adults to 2, Children to 1, selected Premium Economy, and clicked Done." The commit action is the structural signal that these changes form a batch.

### 4.3 StructuralPattern

The category of configuration session, recognized from the composition of subActions:

| Pattern | Signature | Example |
|---------|-----------|---------|
| `singleSelect` | One `selectOption`, no steppers/toggles | One Way → Round Trip |
| `multiFieldConfig` | Multiple field types (steppers + selects) + commit | Passenger & Cabin selector |
| `filterApply` | Multiple `selectOption`/`toggle` + `confirm` labeled "Apply" | Filter panel |
| `searchSubmit` | `fillInput` + `selectOption` + `confirm` labeled "Search" | Advanced search |
| `toggleBatch` | Multiple `toggle` + `confirm` | Settings dialog |
| `uncommitted` | Field changes but no commit action detected | User closed panel without Done |

The pattern is a structural observation, not a business classification. "filterApply" means "the user changed multiple selection-type fields and clicked a button labeled Apply" — it does not mean "the user applied filters" in a business sense.

---

## 5. Data Model

### 5.1 ConfigurationField

```typescript
/**
 * A single field that changed within a configuration session.
 * Groups all subActions that modified the same logical value.
 */
interface ConfigurationField {
  /** Field name, structurally extracted from subAction labels.
   *  e.g., "Adults" (from "Increase adults"), "Travel Class" (from group context).
   *  Never a business name — just the best structural label available. */
  label: string;

  /** How the value was set.
   *  - 'counter': value adjusted via stepper +/- (delta is meaningful)
   *  - 'select': value set via option/radio selection (absolute, no delta)
   *  - 'toggle': boolean toggled (finalValue is 'true'/'false')
   *  - 'text': value typed into an input
   *  - 'date': date value selected */
  kind: 'counter' | 'select' | 'toggle' | 'text' | 'date';

  /** The end-state value after all subActions on this field.
   *  For counters: the value captured on the last subAction (aria-valuenow or valueAfter).
   *  For selects: the selected option label.
   *  For toggles: 'true' or 'false'.
   *  For text: the final input value. */
  finalValue: string;

  /** Net change for counters (e.g., +2 for two increments).
   *  Undefined for non-counter kinds (select, toggle, text, date).
   *  Used by the IR Bridge to compute clicksNeeded = target - currentValue. */
  delta?: number;

  /** Number of subActions that contributed to this field.
   *  1 for a single selection; 2 for two stepper clicks on the same field. */
  subActionCount: number;

  /** The raw subActions that produced this field.
   *  Carries element identities for locator resolution by downstream consumers. */
  evidence: DropdownSubAction[];
}
```

### 5.2 ConfigurationSession

```typescript
/**
 * A group of related field changes committed together.
 * Produced by structural enrichment of a ComponentInteraction's subActions.
 *
 * Attached to ComponentInteraction.metadata.configurationSession.
 */
interface ConfigurationSession {
  /** The fields that changed, in the order they were first modified. */
  fields: ConfigurationField[];

  /** The commit/confirm action that finalized the session.
   *  Null if the session was completed by surface closure (no explicit confirm). */
  commitAction: DropdownSubAction | null;

  /** Label of the trigger element that opened the configuration surface.
   *  e.g., "Economy" for the passenger selector trigger. */
  triggerLabel: string;

  /** Structural pattern recognized from subAction composition. */
  pattern: StructuralPattern;

  /** The physical interaction type that produced this session.
   *  e.g., 'Dropdown', 'Modal'. Preserved for downstream type-aware logic. */
  rawInteractionType: string;
}
```

### 5.3 StructuralPattern

```typescript
/**
 * The category of configuration session, derived from subAction composition.
 * Application-independent — based on action types and commit label, not semantics.
 */
type StructuralPattern =
  | 'singleSelect'        // One selectOption, no counter/toggle/fillInput
  | 'multiFieldConfig'    // Multiple field types + commit
  | 'filterApply'         // Multiple select/toggle + confirm labeled Apply/Set
  | 'searchSubmit'        // fillInput + optional selectOption + confirm labeled Search/Find
  | 'toggleBatch'         // Multiple toggles + commit
  | 'uncommitted';        // Field changes detected but no commit action
```

### 5.4 Placement in ComponentInteraction

The `ConfigurationSession` attaches to the existing `metadata` record:

```typescript
// In ComponentInteraction.metadata (existing field, type widened):
metadata: {
  // ... existing fields (selectedValue, allSelections, subActions, etc.) ...
  configurationSession?: ConfigurationSession;  // NEW: populated by structural enrichment
}
```

This is additive — existing consumers that don't read `configurationSession` are unaffected.

---

## 6. Structural Patterns

### 6.1 Pattern Recognition Logic

The enrichment examines the subActions array to determine the pattern:

```
subActions = [increment, increment, selectOption, confirm]

hasCommit    = subActions.some(s => s.action === 'confirm')
fieldChanges = subActions.filter(s => s.action !== 'confirm')
fieldKinds   = unique(fieldChanges.map(s => deriveKind(s)))

if (!hasCommit && fieldChanges.length > 0) → 'uncommitted'
if (fieldChanges.length === 1 && fieldKinds === ['select']) → 'singleSelect'
if (fieldKinds.includes('counter')) → 'multiFieldConfig'
if (fieldKinds === ['select', 'toggle'] && commitLabel matches /apply|set|filter/i) → 'filterApply'
if (fieldKinds.includes('text') && commitLabel matches /search|find|go/i) → 'searchSubmit'
if (fieldKinds === ['toggle']) → 'toggleBatch'
else → 'multiFieldConfig'  (default for multi-field)
```

### 6.2 Pattern-Action Matrix

| Pattern | selectOption | increment/decrement | toggle | fillInput | confirm |
|---------|:---:|:---:|:---:|:---:|:---:|
| singleSelect | 1 | 0 | 0 | 0 | 0-1 |
| multiFieldConfig | ≥0 | ≥1 | ≥0 | ≥0 | 0-1 |
| filterApply | ≥1 | 0 | ≥0 | 0 | 1 (Apply) |
| searchSubmit | 0-1 | 0 | 0 | ≥1 | 1 (Search) |
| toggleBatch | 0 | 0 | ≥2 | 0 | 0-1 |
| uncommitted | ≥1 | ≥0 | ≥0 | ≥0 | 0 |

### 6.3 What Each Pattern Enables

| Pattern | Timeline Display | IR Strategy | Capability Hint |
|---------|-----------------|------------|-----------------|
| singleSelect | `Select "Round Trip" from Trip Type` | `selectOption('Round Trip')` | Simple selection |
| multiFieldConfig | `Configure Economy: Adults=2, Children=1, Class=Premium Economy` | Optimal per field (fill for counters, click for selects) | Multi-input configuration |
| filterApply | `Apply Filters: Status=Active, Department=HR` | Select each + click Apply | Filter capability |
| searchSubmit | `Search: Customer="ABC Ltd", City="Chennai"` | Fill inputs + click Search | Search capability |
| toggleBatch | `Update Settings: Notifications=on, AutoSave=off` | Check/uncheck each + Save | Settings update |
| uncommitted | `Changed: Adults=2 (not confirmed)` | Generate steps but flag for review | Incomplete interaction |

---

## 7. Transformation Rules

### 7.1 Field Name Extraction

The field name is derived from the subAction's label by stripping action verbs:

| SubAction Label | Action Type | Extracted Field Name | Rule |
|----------------|------------|---------------------|------|
| "Increase adults" | increment | "Adults" | Strip `increase/add/plus` prefix, capitalize |
| "Decrease children" | decrement | "Children" | Strip `decrease/remove/minus/less` prefix, capitalize |
| "Premium Economy" | selectOption | "Travel Class" | Use group context if available; otherwise the label IS the value, field name from ancestor/section |
| "Add insurance" | toggle | "Insurance" | Strip `add/enable/toggle` prefix if present |
| "Customer name" | fillInput | "Customer Name" | Use the input's label/placeholder directly |
| "Departure date" | date | "Departure Date" | Use the picker's label directly |

**Normalization rules:**
1. For stepper labels: strip the action verb (`increase`, `decrease`, `add`, `remove`, `plus`, `minus`), trim, title-case the remainder.
2. For option labels: the label IS the value. The field name must come from a higher structural context (the radio group's `aria-label`, the section heading, or the panel trigger label). If no group context is available, use a generic label derived from the interaction type (e.g., "Selection").
3. For toggle labels: strip common prefixes (`enable`, `disable`, `add`, `toggle`) if the remainder is meaningful.
4. For text/date labels: use the label as-is (inputs typically have proper labels).

### 7.2 Field Grouping

Multiple subActions on the same field are grouped by matching their normalized field names:

```
Grouping key = normalizeFieldName(label)

"Increase adults" + "Increase adults" → same field "Adults", delta +2
"Increase adults" + "Decrease adults" → same field "Adults", delta 0 (net)
"Premium Economy" + "Business"       → same field if both are selectOption
                                         on same group → final value "Business"
```

**Counter aggregation:** For `counter` fields, `delta` = (count of `increment` subActions) − (count of `decrement` subActions). `finalValue` = the `value` from the last subAction, or computed if only deltas are available.

### 7.3 Value Extraction

| Kind | Source of `finalValue` | Fallback |
|------|----------------------|----------|
| counter | Last subAction's `value` (aria-valuenow or valueAfter) | Compute from delta if start value is captured |
| select | SubAction's `value` (the option label) | SubAction's `label` |
| toggle | `'true'` if `checkedAfter=true`, else `'false'` | `'true'` (optimistic default for toggles) |
| text | Last subAction's `value` (the typed text) | `''` |
| date | SubAction's `value` (the date display string) | SubAction's `label` |

### 7.4 Commit Action Identification

The commit action is the `confirm`-typed subAction:

```
commitAction = subActions.find(s => s.action === 'confirm') ?? null
```

If no `confirm` subAction exists, `commitAction` is `null` and `pattern` is `uncommitted`. This means the user changed fields but closed the panel without an explicit Done/Apply/Search click.

### 7.5 Transformation Pipeline

```
Input: ComponentInteraction.metadata.subActions (DropdownSubAction[])

Step 1: Filter non-field subActions
  fieldSubActions = subActions.filter(s => s.action !== 'confirm')
  commitAction = subActions.find(s => s.action === 'confirm') ?? null

Step 2: Group by field
  groups = groupBy(fieldSubActions, s => normalizeFieldName(s.label))

Step 3: Derive ConfigurationField from each group
  for each group:
    kind = deriveKind(group[0].action)
    finalValue = extractFinalValue(group, kind)
    delta = computeDelta(group, kind)
    field = { label, kind, finalValue, delta, subActionCount: group.length, evidence: group }

Step 4: Determine pattern
  pattern = classifyPattern(fields, commitAction)

Step 5: Build ConfigurationSession
  session = { fields, commitAction, triggerLabel, pattern, rawInteractionType }

Output: ComponentInteraction.metadata.configurationSession = session
```

---

## 8. Discrimination: Configuration Session vs. Simple Interaction

### 8.1 The Discriminator

Not every dropdown or panel interaction is a configuration session. The enrichment must decide whether to produce a `ConfigurationSession` or leave the interaction as-is.

```
shouldEnrich =
  subActions exists AND
  subActions.length > 0 AND
  (
    subActions.some(s => s.action === 'confirm')     // has commit action
    OR
    uniqueFieldCount(subActions) > 1                  // multiple distinct fields
  )
```

### 8.2 What Gets Enriched vs. What Doesn't

| Scenario | subActions | Result |
|----------|-----------|--------|
| One Way → Round Trip (surface closes) | `[{ selectOption, "Round Trip" }]` | NOT enriched — singleSelect, one field, no commit. Stays a simple `Dropdown`. |
| Native `<select>` change | `[{ selectOption, "USA" }]` | NOT enriched — single selection, no surface session. |
| Economy panel: Adults+2, Premium Economy, Done | `[inc, inc, select, confirm]` | ENRICHED → `multiFieldConfig` with 2 fields + commit. |
| Filter panel: Status=Active, Dept=HR, Apply | `[select, select, confirm]` | ENRICHED → `filterApply` with 2 fields + commit. |
| Settings: toggle Notifications, toggle AutoSave, Save | `[toggle, toggle, confirm]` | ENRICHED → `toggleBatch` with 2 fields + commit. |
| Search: type "ABC Ltd", select Status, Search | `[fillInput, selectOption, confirm]` | ENRICHED → `searchSubmit` with 2 fields + commit. |
| User opens panel, clicks one option, clicks away | `[{ selectOption, "X" }]` | NOT enriched — one field, no commit. Surface closure completes normally. |

### 8.3 Backward Compatibility

When `shouldEnrich` returns false:
- No `configurationSession` is added to metadata
- `subActions`, `selectedValue`, `allSelections` are unchanged
- All existing consumers behave exactly as before

---

## 9. Downstream Consumer Integration

### 9.1 Timeline Renderer

**Current** (reads `subActions` directly):
```
Economy: Increase Adults → Increase Children → Select "Premium Economy" → Done
```

**With structural semantic** (reads `configurationSession`):
```
Configure Economy: Adults=2, Children=1, Class=Premium Economy
```

The renderer checks for `configurationSession` first. If present, render the field-based summary. If absent, fall back to the existing subAction-by-subAction rendering.

**Impact:** `timeline-renderer.ts` L348-381 — add a `configurationSession` branch before the existing `subActions` branch.

### 9.2 IR Bridge

**Current** (expands each subAction into a step):
```js
await page.click('[aria-label="Increase adults"]');
await page.click('[aria-label="Increase adults"]');
await page.click('text=Premium Economy');
await page.click('text=Done');
```

**With structural semantic** (uses field values for optimal strategy):
```js
// Adults = 2 (counter field, target value known)
await page.locator('[data-testid="adults"]').fill('2');
// or: compute clicks needed if no fill input
// Travel Class = Premium Economy (select field)
await page.click('text=Premium Economy');
// Commit
await page.click('text=Done');
```

The IR Bridge reads `configurationSession.fields` to choose the optimal action per field:
- `counter` with known `finalValue` → generate `fill` if the target element accepts text, else generate the correct number of clicks
- `select` → generate `click` on the option (same as today)
- `toggle` → generate `check()` / `uncheck()` based on `finalValue`
- `text` → generate `fill` with `finalValue`
- `date` → generate `fill` with `finalValue`

The commit action always becomes a final `click` step.

**Impact:** `ir-bridge.ts` L600-623 — when `configurationSession` is present, use field-based expansion instead of raw subAction expansion.

### 9.3 Future Execution Engines (Healing, Self-Healing)

When a test breaks because a stepper changed from `+1` clicks to `+2` clicks, the healing engine can read the `ConfigurationField.finalValue` to know the target state is "Adults = 2" and recompute the correct sequence of clicks. Without the structural semantic, the healing engine sees "click Increase adults twice" and cannot know the intended final value.

### 9.4 Capability Model (Phase 2)

The Capability Model reads `configurationSession.fields` to understand what the user configured:

```
ConfigurationSession.fields = [
  { label: "Adults", kind: "counter", finalValue: "2" },
  { label: "Children", kind: "counter", finalValue: "1" },
  { label: "Travel Class", kind: "select", finalValue: "Premium Economy" }
]
```

→ Capability Model (with knowledge fragment) maps this to:
```
Capability: "Configure Passenger & Cabin"
Inputs: [
  { businessField: "adultCount", source: "Adults", type: "number", value: 2 },
  { businessField: "childCount", source: "Children", type: "number", value: 1 },
  { businessField: "travelClass", source: "Travel Class", type: "enum", value: "Premium Economy" }
]
```

The Capability Model doesn't need to parse raw subActions — it reads the structured fields directly. This is the clean handoff between Layer 2 and Layer 3.

### 9.5 AI Reasoning

When the AI reasoning layer (current `reasonAboutInteractions()`) examines a recording, it currently sees raw clicks and changes. With `configurationSession`, it sees "the user opened Economy and set Adults=2, Children=1, Travel Class=Premium Economy" — a much richer input for generating natural-language descriptions and workflow understanding.

---

## 10. Relationship with Existing Architecture

### 10.1 Pipeline Position

The structural enrichment runs **after** the Component Runtime emits `ComponentInteraction`s and **before** the IR Bridge consumes them:

```
Current pipeline (handleStopRecording in service-worker.ts):

  detectInteractions() + detectInteractionsV2() + mergeV1V2()
    → ComponentInteraction[]
      → reasonAboutInteractions()         [existing semantic reasoner]
        → runPipeline()                   [enrichment: classify, enrich, etc.]
          → buildIRPlan()                 [IR Bridge]
            → PlaywrightCodeGenerator     [code generation]
```

**Proposed insertion point:**

```
  detectInteractions() + detectInteractionsV2() + mergeV1V2()
    → ComponentInteraction[]
      → reasonAboutInteractions()
        → enrichConfigurationSessions()   [NEW: structural semantic enrichment]
          → runPipeline()
            → buildIRPlan()
              → PlaywrightCodeGenerator
```

Or alternatively, as a step within `runPipeline()` itself, after classification but before IR generation. The exact insertion point is an implementation decision — the key constraint is that it runs after interactions are finalized and before the IR Bridge consumes them.

### 10.2 What Changes in Existing Files

| File | Change | Nature |
|------|--------|--------|
| `component-types.ts` | No change needed — `metadata` is already `Record<string, unknown>` | None |
| `dropdown.ts` | No change — already produces `subActions` and `isMultiConfig` | None |
| `ir-bridge.ts` | Check for `configurationSession` before falling back to raw `subActions` expansion | Additive |
| `timeline-renderer.ts` | Check for `configurationSession` before falling back to raw `subActions` rendering | Additive |
| New: `structural-enrichment.ts` | The enrichment logic itself | New file |
| `service-worker.ts` | Call enrichment between reasoning and pipeline | One line |

### 10.3 Relationship with Observation Model

The Observation Model produces:
- `ComponentInteraction.metadata.subActions` — the action sequence (Layer 1 output)
- `ComponentInteraction.metadata.isMultiConfig` — whether multiple field types exist
- `ComponentInteraction.metadata.doneClicked` — whether a commit action was seen

The Structural Semantic layer consumes these and produces:
- `ComponentInteraction.metadata.configurationSession` — the state-based representation (Layer 2 output)

The enrichment is a **pure projection** of the observation data. It adds no new information that wasn't captured by the Observation Model — it restructures existing information into a more consumable form.

### 10.4 Relationship with Capability Model

The Capability Model (Phase 2) will consume `configurationSession.fields` to derive business capabilities. The structural semantic layer is the **contract** between the Observation Model and the Capability Model — it defines the shape of the data that Phase 2 will read.

This is analogous to how the Observation Model defined the contract (subActions, surfaceId) that the Structural Semantic layer now consumes. Each layer defines the input contract for the next.

---

## 11. Design Principles

### S1: Pure Transform, No Side Effects

The enrichment is a pure function: `ComponentInteraction → ComponentInteraction` (with `configurationSession` added to metadata). No I/O, no DOM access, no async operations. Same input always produces the same output.

### S2: Additive, Not Destructive

The enrichment adds `configurationSession` to metadata. It never removes or modifies existing fields (`subActions`, `selectedValue`, `allSelections`). Consumers that don't read `configurationSession` are unaffected.

### S3: Structural, Not Semantic

The enrichment recognizes patterns using only structural signals (action types, label patterns, value transitions). It never assigns business meaning. "Adults" is a field label extracted from "Increase adults" — the enrichment doesn't know these are airline passengers.

### S4: Graceful Degradation

When field name extraction fails (label is "element", no group context available), the enrichment uses the raw label as-is. When value extraction fails (no `valueAfter`, no `aria-valuenow`), the field is still recorded with `finalValue: ''`. The enrichment never throws or blocks the pipeline — it produces the best structural representation available and lets downstream consumers decide how to handle gaps.

### S5: Opt-Out, Not Opt-In

When a `ComponentInteraction` has `subActions` that match the configuration session discriminator, the enrichment runs automatically. Downstream consumers opt OUT of using it (by ignoring `configurationSession` and reading `subActions` directly), not opt IN.

### S6: Deterministic Pattern Classification

Pattern recognition is deterministic — the same subActions always produce the same pattern. No probabilistic scoring, no ML, no heuristics that vary between runs.

---

## 12. Invariants

### I1: Field Completeness
Every non-`confirm` subAction MUST be included in exactly one `ConfigurationField.evidence` array. No subAction is lost or duplicated across fields.

### I2: Field Order Preservation
`ConfigurationField[]` is ordered by the timestamp of the first subAction that contributed to each field. Fields are NOT reordered by type, alphabet, or any other criterion.

### I3: Final Value Correctness
For `select` kind: `finalValue` is the label/value of the LAST `selectOption` subAction on that field (user may have changed their mind). For `counter` kind: `finalValue` is from the last subAction, and `delta` reflects the net of all increments and decrements.

### I4: Commit Action Exclusivity
The `commitAction` is excluded from all `ConfigurationField.evidence` arrays. It is not a field change — it is the commit signal. A `confirm` subAction never appears in any field.

### I5: Idempotency
Running the enrichment twice on the same `ComponentInteraction` produces the same `ConfigurationSession`. The enrichment checks whether `configurationSession` already exists and skips if present.

### I6: Non-Intrusiveness
If the enrichment cannot produce a meaningful `ConfigurationSession` (e.g., subActions is empty, all subActions are `confirm`), it produces nothing. `metadata.configurationSession` remains `undefined`. Existing behavior is fully preserved.

### I7: Evidence Preservation
Every `ConfigurationField.evidence` array retains the original `DropdownSubAction` objects (with their `.target` and `.event` fields). Downstream consumers that need locator data (element identities) can access it through the evidence chain without going back to the raw interaction.

---

## 13. Edge Cases and Failure Modes

### 13.1 User Changes Mind on Same Field

```
subActions: [
  { selectOption, "Premium Economy" },
  { selectOption, "Business" },       // user changed their mind
  { confirm, "Done" }
]
```

**Result:** One field `Travel Class`, `finalValue: "Business"` (last wins), `evidence: [both subActions]`. The `delta` is undefined (not a counter). This is correct — the user's final intent is Business.

### 13.2 Stepper Net Zero

```
subActions: [
  { increment, "Adults" },   // +1
  { decrement, "Adults" },   // -1
  { confirm, "Done" }
]
```

**Result:** One field `Adults`, `delta: 0`, `finalValue: "1"` (value from last subAction, which was a decrement back to 1). Pattern: `multiFieldConfig` (counter present). This is correct — the user ended up at the original value.

### 13.3 No Commit Action (Surface Closure)

```
subActions: [
  { increment, "Adults" },
  { increment, "Adults" }
]
// Session completed by detectSurfaceClosure (outside click), no Done button
```

**Result:** `commitAction: null`, `pattern: 'uncommitted'`. Fields are still extracted. The timeline renderer shows a "(not confirmed)" annotation. The IR Bridge still generates steps but may add a comment.

### 13.4 Single Stepper Click (Ambiguous)

```
subActions: [
  { increment, "Adults" },
  { confirm, "Done" }
]
```

**Result:** One field `Adults`, `delta: +1`, `finalValue: "2"` (if captured) or `finalValue: ""` (if not). Pattern: `multiFieldConfig`. The enrichment enriches because there's a counter + commit, even though only one field changed. This is correct — it's still a configuration session, just a minimal one.

### 13.5 Label Is "element" (No Accessible Name)

```
subActions: [
  { increment, "element" },  // stepper button with no aria-label
  { confirm, "Done" }
]
```

**Result:** Field label is "element" (graceful degradation). `finalValue` from `valueAfter` or `aria-valuenow` if available. The enrichment cannot do better without the label — this is an Observation Model capture quality issue, not a structural enrichment issue. The downstream consumer can flag it.

### 13.6 Conflicting Field Types

```
subActions: [
  { increment, "Adults" },       // counter on "Adults"
  { selectOption, "Adults" }     // select on "Adults" (same label)
]
```

**Result:** Two fields both labeled "Adults" — one `counter`, one `select`. This is a degenerate case where field name extraction conflated two different controls that happen to share a label. The enrichment groups by normalized label, so both go into the same field with `kind: 'counter'` (first subAction wins for kind). The evidence array contains both subActions. This is acceptable — the conflict is rare and the evidence chain preserves the raw data for manual review.

### 13.7 Date Range Picker (Two Date Pickers in One Surface)

```
subActions: [
  { dateSelect, "Start Date", "01 Aug 2026" },
  { dateSelect, "End Date", "15 Aug 2026" },
  { confirm, "Apply" }
]
```

**Result:** Two fields: `Start Date` (`kind: 'date'`, `finalValue: "01 Aug 2026"`) and `End Date` (`kind: 'date'`, `finalValue: "15 Aug 2026"`). Pattern: `multiFieldConfig`. This is correct — the date range picker is treated as a multi-field configuration session.

Note: This case requires the DatePicker definition to also produce subActions, which it does not today. This is a future enhancement — the structural enrichment is ready to consume date subActions when they become available.

---

## 14. Framework Agnosticism

### 14.1 No Framework-Specific Code

The enrichment works on `DropdownSubAction` objects, which are framework-neutral data structures. It contains:
- No React/Vue/Angular-specific logic
- No CSS class pattern matching
- No DOM queries
- No `document.querySelector` calls

### 14.2 Label Normalization Is Universal

The field name extraction rules (strip "Increase"/"Decrease", title-case remainder) work across all frameworks because they operate on accessible names and aria-labels, which are accessibility-standard, not framework-standard.

### 14.3 Pattern Recognition Is Compositional

Pattern classification examines the *composition* of subAction types (how many counters, selects, toggles, etc.), not the framework that produced them. A filter panel built with MUI, Ant Design, or custom divs produces the same structural pattern if the user performs the same actions.

---

## 15. Type Contracts

### 15.1 TypeScript Interfaces

```typescript
// ── Configuration Field ──────────────────────────────────────────

interface ConfigurationField {
  label: string;
  kind: 'counter' | 'select' | 'toggle' | 'text' | 'date';
  finalValue: string;
  delta?: number;
  subActionCount: number;
  evidence: DropdownSubAction[];
}

// ── Configuration Session ────────────────────────────────────────

interface ConfigurationSession {
  fields: ConfigurationField[];
  commitAction: DropdownSubAction | null;
  triggerLabel: string;
  pattern: StructuralPattern;
  rawInteractionType: string;
}

// ── Structural Pattern ───────────────────────────────────────────

type StructuralPattern =
  | 'singleSelect'
  | 'multiFieldConfig'
  | 'filterApply'
  | 'searchSubmit'
  | 'toggleBatch'
  | 'uncommitted';

// ── Enrichment Function Signature ────────────────────────────────

/**
 * Enrich a ComponentInteraction with structural semantic data.
 * Pure function — no side effects, no I/O.
 * Returns the interaction with metadata.configurationSession populated
 * if the interaction is a configuration session, or unchanged if not.
 */
function enrichConfigurationSession(
  interaction: ComponentInteraction
): ComponentInteraction;
```

### 15.2 Consumer Interface

Downstream consumers access the structural semantic through a single optional field:

```typescript
// Timeline renderer
const session = interaction.metadata?.configurationSession;
if (session) {
  renderConfigurationSummary(session);
} else {
  renderSubActions(interaction.metadata?.subActions);  // existing path
}

// IR Bridge
const session = interaction.metadata?.configurationSession;
if (session) {
  expandFieldsToSteps(session);  // field-based expansion
} else if (interaction.metadata?.subActions) {
  expandSubActionsToSteps(interaction.metadata.subActions);  // existing path
} else {
  generateSingleStep(interaction);  // simple interaction
}
```

---

## 16. Validation Criteria

### 16.1 Unit Tests

| Test | Description |
|------|-------------|
| Stepper accumulation | Two `increment` subActions on "Adults" → one field, `delta: +2`, `finalValue` from last |
| Stepper net zero | `increment` + `decrement` on same field → `delta: 0` |
| Select option | `selectOption` subAction → `kind: 'select'`, `finalValue` = option label |
| Toggle | `toggle` subAction → `kind: 'toggle'`, `finalValue` = 'true'/'false' |
| Text input | `fillInput` subAction → `kind: 'text'`, `finalValue` = typed value |
| Commit detection | `confirm` subAction → `commitAction` populated, excluded from fields |
| No commit | Field changes without `confirm` → `pattern: 'uncommitted'`, `commitAction: null` |
| Multi-field | Steppers + selects + commit → `pattern: 'multiFieldConfig'` |
| Single select not enriched | One `selectOption`, no commit → no `configurationSession` produced |
| Field grouping | Two subActions with same normalized label → grouped into one field |
| Mind change | Two `selectOption` on same field → `finalValue` = last option |
| Idempotency | Running enrichment twice → same result |
| Empty subActions | `subActions: []` → no `configurationSession` |
| "element" label | `label: "element"` → field created with `label: "element"` (graceful degradation) |
| Evidence preservation | Every non-confirm subAction appears in exactly one field's `evidence` |

### 16.2 Integration Tests

| Test | Description |
|------|-------------|
| Timeline rendering | `configurationSession` present → renders field summary, not raw action list |
| IR Bridge expansion | `configurationSession` present → field-based step generation |
| Backward compatibility | No `configurationSession` → existing subAction expansion works unchanged |
| Mixed recording | Recording with both simple and compound interactions → simple ones unaffected |

### 16.3 Invariant Verification

| Invariant | Verification |
|-----------|-------------|
| I1: Field completeness | `sum(field.subActionCount) === nonConfirmSubActions.length` |
| I2: Field order | `fields[0].evidence[0].timestamp <= fields[1].evidence[0].timestamp` |
| I3: Final value correctness | For `select`: `finalValue === lastSelectOption.value` |
| I4: Commit exclusivity | `!fields.some(f => f.evidence.some(s => s.action === 'confirm'))` |
| I5: Idempotency | `enrich(enrich(i)).metadata.configurationSession === enrich(i).metadata.configurationSession` |
| I6: Non-intrusiveness | `enrich(simpleInteraction).metadata.configurationSession === undefined` |

---

## Appendix A: Worked Examples

### A.1 Passenger & Cabin Selector (Adani One Economy)

**Input subActions:**
```json
[
  { "action": "increment", "label": "Increase adults", "value": "2" },
  { "action": "increment", "label": "Increase children", "value": "1" },
  { "action": "selectOption", "label": "Premium Economy", "value": "Premium Economy" },
  { "action": "confirm", "label": "Done" }
]
```

**Output ConfigurationSession:**
```json
{
  "fields": [
    { "label": "Adults", "kind": "counter", "finalValue": "2", "delta": 1, "subActionCount": 1 },
    { "label": "Children", "kind": "counter", "finalValue": "1", "delta": 1, "subActionCount": 1 },
    { "label": "Premium Economy", "kind": "select", "finalValue": "Premium Economy", "subActionCount": 1 }
  ],
  "commitAction": { "action": "confirm", "label": "Done" },
  "triggerLabel": "Economy",
  "pattern": "multiFieldConfig",
  "rawInteractionType": "Dropdown"
}
```

**Timeline display:** `Configure Economy: Adults=2, Children=1, Premium Economy`

**Playwright code:**
```js
await page.click('text=Economy');                              // open
await page.fill('[data-testid="adults-input"]', '2');          // counter → fill
await page.fill('[data-testid="children-input"]', '1');        // counter → fill
await page.click('text=Premium Economy');                       // select → click
await page.click('text=Done');                                  // commit
```

### A.2 Filter Panel

**Input subActions:**
```json
[
  { "action": "selectOption", "label": "Active", "value": "Active" },
  { "action": "selectOption", "label": "HR", "value": "HR" },
  { "action": "confirm", "label": "Apply" }
]
```

**Output ConfigurationSession:**
```json
{
  "fields": [
    { "label": "Active", "kind": "select", "finalValue": "Active", "subActionCount": 1 },
    { "label": "HR", "kind": "select", "finalValue": "HR", "subActionCount": 1 }
  ],
  "commitAction": { "action": "confirm", "label": "Apply" },
  "triggerLabel": "Filters",
  "pattern": "filterApply",
  "rawInteractionType": "Dropdown"
}
```

**Timeline display:** `Apply Filters: Active, HR`

### A.3 Settings Dialog

**Input subActions:**
```json
[
  { "action": "toggle", "label": "Enable Notifications", "value": "checked" },
  { "action": "toggle", "label": "Auto Save", "value": "unchecked" },
  { "action": "confirm", "label": "Save" }
]
```

**Output ConfigurationSession:**
```json
{
  "fields": [
    { "label": "Enable Notifications", "kind": "toggle", "finalValue": "true", "subActionCount": 1 },
    { "label": "Auto Save", "kind": "toggle", "finalValue": "false", "subActionCount": 1 }
  ],
  "commitAction": { "action": "confirm", "label": "Save" },
  "triggerLabel": "Settings",
  "pattern": "toggleBatch",
  "rawInteractionType": "Dropdown"
}
```

**Timeline display:** `Update Settings: Enable Notifications=on, Auto Save=off`

---

## Appendix B: Mapping to Observation Model Concepts

| Observation Model Concept | Structural Semantic Concept | Relationship |
|--------------------------|---------------------------|--------------|
| `ComponentInteraction` | Input to enrichment | One interaction → zero or one `ConfigurationSession` |
| `metadata.subActions` | Source data for field extraction | Transformed into `ConfigurationField[]` |
| `metadata.isMultiConfig` | Discriminator hint | If false, enrichment likely skips (single field) |
| `metadata.doneClicked` | Commit signal | Maps to `commitAction !== null` |
| `SurfaceEntry` | Session context | `triggerLabel` comes from the session's trigger element |
| `ObservedEvent.target` | Locator evidence | Preserved in `ConfigurationField.evidence[].target` |
| `ObservedEvent.valueAfter` | Field value source | Extracted into `ConfigurationField.finalValue` |
| `ObservedEvent.checkedAfter` | Toggle value source | Extracted into `ConfigurationField.finalValue` ('true'/'false') |

---

*End of document.*

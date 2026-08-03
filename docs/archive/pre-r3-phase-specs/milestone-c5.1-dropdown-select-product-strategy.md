# Milestone C5.1 — Dropdown & Select Product Strategy

**Type:** Product Design and Planning (no implementation)  
**Status:** PERMANENTLY FROZEN  
**Frozen At:** 2026-07-16T06:30:00Z  
**Date:** 2026-07-16  
**Depends On:** Product Foundation (B1-B8), Architecture, C3 (Hover), C4 (Checkbox & Radio) — all PERMANENTLY FROZEN  

---

## Table of Contents

1. [Product Purpose](#1-product-purpose)
2. [User Intent](#2-user-intent)
3. [Recording Rules](#3-recording-rules)
4. [Dropdown Categories](#4-dropdown-categories)
5. [Canonical Test Steps](#5-canonical-test-steps)
6. [Execution Model](#6-execution-model)
7. [Interaction Boundaries](#7-interaction-boundaries)
8. [Validation Strategy](#8-validation-strategy)
9. [Product Principles](#9-product-principles)
10. [Known Assumptions](#10-known-assumptions)
11. [Potential Risks](#11-potential-risks)
12. [Consistency Review Against Frozen Milestones](#12-consistency-review-against-frozen-milestones)
13. [Next Milestone Directive](#13-next-milestone-directive)
14. [Freeze Declaration](#14-freeze-declaration)
15. [Permanent Regression Coverage](#15-permanent-regression-coverage)

---

## 1. Product Purpose

### 1.1 What Is a Dropdown Interaction?

A **Dropdown interaction** is a user's act of selecting a single value from a set of mutually exclusive options presented in a dropdown, listbox, combobox, or similar control. The interaction begins when the user initiates a value selection and completes when a new value is chosen.

The recorded interaction represents the **resulting selected value** — the final option the user committed to — not the physical sequence of clicks, typing, searching, or keyboard navigation used to reach it.

### 1.2 What Is a Select Interaction?

"Select" is the **action verb** used to describe a dropdown value selection in Canonical Test Steps, Execution JSON, and Playwright output. It describes the semantic outcome: the user selected a specific value from a dropdown control.

"Select" is used consistently for both native `<select>` elements and custom dropdown components. The user-facing concept is identical regardless of the underlying implementation.

### 1.3 Why Should Dropdown Interactions Be Recorded?

Dropdown selections are among the most common form interactions in web applications. They carry **critical business data**: country selection, payment method, priority level, user role, shipping method, category, and countless other domain-specific values.

A recorded test that omits the dropdown value is **functionally broken** — it clicks the control but never selects an option. Any downstream logic that depends on the selected value (form submission, validation, price calculation, routing) will fail silently or produce incorrect results.

Today, the CmdRunner recorder captures a native `<select>` interaction as a generic Click — it records "Click Country" but loses the fact that the user selected "India." C5 closes this gap.

### 1.4 What User Value Do They Provide?

| Value | Description |
|-------|-------------|
| **Accurate test reproduction** | Generated tests select the correct option, not just click the control |
| **Business-readable steps** | "Select \"India\"" is immediately meaningful; "Click [select element]" is not |
| **Deterministic execution** | Tests reliably set the same value every time, regardless of dropdown rendering |
| **Framework independence** | The same test step works whether the dropdown is native HTML, React Select, or Material UI |
| **Reduced test noise** | Opening/closing the dropdown is not recorded; only the meaningful selection is |

### 1.5 Differentiation: Meaningful vs Incidental

**Meaningful value change:** The user selects an option that differs from the currently selected value. This is the user's intent — to change the dropdown's value. This MUST be recorded.

**Incidental UI action:** The user opens the dropdown, browses options, then closes it without selecting a new value. Or selects an option that is already the current value. These are NOT the user's intent to change the value. These MUST NOT be recorded.

The distinction is based on **whether the resulting value changed**, not on whether the user clicked, typed, or navigated.

### 1.6 Product Stability Note

> The product requirement is: **record a Select interaction only when the user intentionally changes the dropdown's value to a different option.** The mechanism by which the value change is detected — native `change` event, MutationObserver on ARIA attributes, value comparison, accessibility state inspection — is an implementation detail that may evolve. The product rule is stated in terms of the outcome (value changed), not the detection mechanism.

---

## 2. User Intent

### 2.1 Intent Classification

| Intent Level | Example | Recorded? |
|-------------|---------|-----------|
| **Committed value change** | User selects "India" when "United States" was selected | ✅ YES |
| **Re-selection of current value** | User opens dropdown, clicks "India" which was already selected | ❌ NO — no value change |
| **Browse without selection** | User opens dropdown, scrolls, closes without selecting | ❌ NO — no value change |
| **Search without selection** | User types "ind" in a searchable dropdown, sees results, clears without selecting | ❌ NO — no value change |
| **Cancelled selection** | User clicks an option but the application rejects it (validation error) and reverts | ❌ NO — no committed value change |

### 2.2 What Constitutes "Value Change"?

A value change occurs when:

1. The control's selected value **after** the user interaction is **different** from the selected value **before** the interaction.
2. The change was initiated by a **genuine user action** (not a programmatic `element.value =` assignment).
3. The control is **enabled** and **not read-only**.

> **Product Stability Note:** The "selected value" is the user-visible option text or label, not necessarily the underlying `value` attribute. The product model captures what the user sees and chose — "India" — not the internal value code — "IN" or "IND". However, the execution layer may use either the label or the value for locator purposes. This distinction is documented in §6.4.

### 2.3 Intent Boundary: Multi-Select

For `<select multiple>` elements, each individual option selection/deselection is a separate meaningful interaction. However, **multi-select is out of scope for C5.1** and deferred to a future milestone. The product strategy defined here applies to single-value dropdowns only.

---

## 3. Recording Rules

### 3.1 Decision Tree (5 Gates)

A Dropdown interaction is recorded only when ALL five gates pass:

```
┌─────────────────────────────────────────────────────┐
│ Gate 1: Genuine User Event                          │
│   Was the value change initiated by a real user     │
│   interaction (not a script or framework update)?   │
│   PRODUCT REQUIREMENT: Only genuine user-initiated  │
│   value changes are recorded.                       │
│   IMPLEMENTATION HINT: isTrusted event, focused     │
│   element, user gesture detection.                  │
├─────────────────────────────────────────────────────┤
│ Gate 2: Ownership                                   │
│   Is this element already owned by another          │
│   registered interaction (data-cmdrunner-handled)?  │
│   If yes → skip (another recorder handles it).      │
├─────────────────────────────────────────────────────┤
│ Gate 3: Control Type                                │
│   Is the element a dropdown control?                │
│   Matches: <select>, [role="combobox"],             │
│   [role="listbox"], or a recognized custom          │
│   dropdown pattern (see §4).                        │
├─────────────────────────────────────────────────────┤
│ Gate 4: Meaningful Value Change                     │
│   Is the resulting selected value different from    │
│   the value that was selected before the user       │
│   interacted with the control?                      │
│   If the value is unchanged → skip (no-op).         │
├─────────────────────────────────────────────────────┤
│ Gate 5: Enabled Control                             │
│   Is the control enabled and interactive?           │
│   Disabled, read-only, aria-disabled, or inside a   │
│   disabled fieldset → skip.                         │
└─────────────────────────────────────────────────────┘
```

### 3.2 Product Rule (Recording)

> **A Select interaction is recorded when and only when a genuine user action changes the dropdown control's selected value to a different option, and the control is enabled.**

### 3.3 Exclusion Rules (Do Not Record)

| Scenario | Reason |
|----------|--------|
| Opening a dropdown | No value change — the user is browsing, not selecting |
| Closing a dropdown without selecting | No value change — browsing only |
| Clicking an already-selected option | No value change — the value remains the same |
| Cancelled selection (app rejects) | No committed value change — the value was reverted |
| Disabled control | Gate 5 — the user cannot meaningfully interact |
| Read-only control | Gate 5 — the control refuses changes |
| Programmatic value change (`el.value = x`) | Gate 1 — not a genuine user event |
| Search text entry without selection | No value change — the user searched but didn't commit |

### 3.4 Pre-State Evidence

> **Product Requirement:** The recorder must compare the control's value **before** and **after** the user interaction to determine whether a meaningful change occurred. The "before" state is the evidence that the change was genuine and non-incidental.

> **Product Stability Note:** How the pre-state is captured — at `mousedown`, `focus`, `pointerdown`, or another user-gesture precursor — is an implementation detail. The product requirement is that the comparison is between the user's pre-interaction value and post-interaction value.

### 3.5 Debounce and Timing

Unlike Hover (which has a dwell threshold), Dropdown interactions are **discrete events** — the user either selected a value or didn't. No debounce window is required. The `change` event (or equivalent) fires exactly once per committed selection.

However, for searchable/autocomplete dropdowns where the user may type and then select, the recorder should wait for the **committed selection** (the final value chosen from the dropdown list), not intermediate search text. The search text itself is NOT recorded — only the resulting selected value.

> **Product Stability Note:** How the recorder distinguishes "the user is still searching" from "the user committed a selection" is an implementation detail. The product requirement is that the recorded value is the final selected option, not intermediate search input.

---

## 4. Dropdown Categories

### 4.1 Category Survey

| Category | Examples | DOM Structure | Value Access |
|----------|----------|---------------|--------------|
| **Native HTML `<select>`** | Standard browser dropdown | `<select><option>...</option></select>` | `select.value`, `option.selected`, `option.text` |
| **Searchable Dropdown** | React Select, Ant Design AutoComplete | Custom `<div>` with `<input>` + option list | ARIA `aria-activedescendant`, custom state, option click |
| **Autocomplete** | Google Places, typeahead | `<input>` with dynamic suggestion list | ARIA combobox, option click |
| **Component Library Select** | React Select, MUI Select, Ant Design Select, Chakra Select | Custom `<div>` with trigger + popup | Component state, ARIA attributes, option click |
| **Headless UI Listbox** | Headless UI, Radix UI Select | `<button>` trigger + `<div role="listbox">` popup | ARIA `aria-selected`, option click |
| **Custom ARIA Listbox** | Application-specific | `<div role="listbox">` with `<div role="option">` | ARIA `aria-selected`, option click |

### 4.2 Product Decision: One Interaction Type

**All dropdown categories share a single product model: the `select` interaction type.**

Rationale:
- From the user's perspective, selecting "India" from a native `<select>` is semantically identical to selecting "India" from a React Select component. The user's intent is the same.
- Canonical Test Steps should be identical: `Select "India"` — regardless of the underlying implementation.
- The generation pipeline should produce a consistent execution verb and rely on target metadata to distinguish execution strategy.

**This does NOT mean one detection mechanism.** The recorder may use different strategies to detect value changes in native vs custom dropdowns (see §3.1, Product Stability Notes). The product model is unified; the implementation may vary.

### 4.3 Native vs Custom: The Execution Boundary

The critical distinction is not in the product model or Canonical Step, but in the **execution strategy**:

| Aspect | Native `<select>` | Custom Dropdown |
|--------|-------------------|-----------------|
| **Canonical Step** | `Select "India"` | `Select "India"` |
| **Execution verb** | `"select"` | `"select"` |
| **Playwright API** | `.selectOption('India')` | Click trigger → click option by text |
| **How Playwright knows** | `target.tag === 'SELECT'` | `target.tag !== 'SELECT'` |
| **Value carried** | Option label or value | Option text |

> **Product Stability Note:** The two execution strategies (selectOption vs click-based) are implementation details of the execution engine, not product rules. They exist only within the Playwright generator's translation layer. The product model (Canonical Step, Execution JSON verb, recording rules) does not distinguish them. Future execution improvements — additional framework-specific strategies, improved locator resolution, multi-step interaction patterns — can be implemented entirely within the execution engine without changing any frozen product rule.

**Execution Independence Principle.** The following table confirms the architectural boundary:

| Layer | Native `<select>` | Custom Dropdown | Identical? |
|-------|-------------------|-----------------|------------|
| Product model (what the user did) | Selected value "India" | Selected value "India" | ✅ Yes |
| Canonical Step | `Select "India"` | `Select "India"` | ✅ Yes |
| Execution JSON action.type | `"select"` | `"select"` | ✅ Yes |
| Execution JSON action.value | `"India"` | `"India"` | ✅ Yes |
| Execution JSON target structure | Same 6-section contract | Same 6-section contract | ✅ Yes |
| Playwright strategy | `.selectOption()` | Click trigger → click option | ❌ Execution detail only |
| Framework-specific code | None | May vary by library | ❌ Execution detail only |

The product model, Canonical Step, and Execution JSON are **identical** across both categories. The difference exists exclusively in the Playwright generator's translation logic, which is the execution engine — not the product model.

### 4.4 Category Exclusions

The following are **NOT** dropdown interactions and are handled by existing or future interaction types:

| Element | Handled By |
|---------|------------|
| `<input type="checkbox">` | C4 Checkbox (frozen) |
| `<input type="radio">` | C4 Radio (frozen) |
| Tab panels / accordion | Future milestone (if needed) |
| Context menus | Future milestone (if needed) |
| `<select multiple>` | Deferred — see §2.3 |

---

## 5. Canonical Test Steps

### 5.1 Format

All Dropdown interactions produce a Canonical Test Step in the format:

```
Select "<value>"
```

Where `<value>` is the **user-visible label** of the selected option.

### 5.2 Examples

| Control | Selected Option | Canonical Step |
|---------|----------------|----------------|
| Country dropdown | India | `Select "India"` |
| Priority dropdown | High Priority | `Select "High Priority"` |
| Payment method | Credit Card | `Select "Credit Card"` |
| Role assignment | Administrator | `Select "Administrator"` |
| Shipping method | Express Delivery | `Select "Express Delivery"` |
| Status filter | In Progress | `Select "In Progress"` |

### 5.3 When a Step Is Generated

A Canonical Step is generated for every recorded Select interaction — i.e., every time Gates 1-5 all pass. No Select interaction that passes recording is omitted from Canonical Steps.

### 5.4 When a Step Is Omitted

No Canonical Step is generated for any interaction that was not recorded (failed any gate). This includes opening/closing the dropdown, re-selecting the current value, and interacting with disabled controls.

### 5.5 Readability Optimizer

**No new readability rule for Select interactions.** The following potential optimizations are explicitly **deferred** (consistent with C4.1's OR-4 deferral pattern):

| Rule | Description | Status |
|------|-------------|--------|
| OR-5 | Collapse consecutive Select→Select on the same control (only last value matters) | **DEFERRED** |

Rationale: Consecutive value changes on the same dropdown (e.g., the user explores options before settling) may represent meaningful exploration behavior. Collapsing them could hide intent. This optimization should only be introduced after real-world usage data confirms it's beneficial.

### 5.6 AI Business Name

If AI enrichment is available and provides a `businessName`, it takes precedence over the option label in the Canonical Step (consistent with existing Click/Hover/Text behavior):

```
Select "<AI businessName>"
```

Otherwise, the option label is used.

---

## 6. Execution Model

### 6.1 Interaction Type Registration

A new interaction type `select` is registered in the InteractionRegistry:

| Field | Value |
|-------|-------|
| `actionType` | `'select'` |
| `idPrefix` | `'select'` |
| `badgeColor` | `'#06b6d4'` (cyan) |
| `badgeLabel` | `'Select'` |
| `toPlainEnglish` | `Select "<value>"` (uses option label or AI business name) |
| `renderTitle` | Returns the selected value |
| `executionExtras` | Returns `{ value: <selectedOptionLabel> }` |

### 6.2 Execution Action Verbs

The `mapActionType` function is extended:

| Interaction actionType | Execution verb | Condition |
|------------------------|---------------|-----------|
| `click` | `"click"` | existing |
| `navigation` | `"navigate"` | existing |
| `text` | `"fill"` | existing |
| `hover` | `"hover"` | existing (C3.2) |
| `checkbox` | `"check"` / `"uncheck"` | existing (C4.1, based on `checked`) |
| `radio` | `"select"` | existing (C4.1) |
| `select` | `"select"` | **new (C5.1)** |

**Note:** Both `radio` and `select` (dropdown) produce the same execution verb `"select"`. This is intentional — both represent a selection action. The Playwright generator disambiguates by target metadata (see §6.5).

### 6.3 Execution JSON Structure

The Execution JSON uses the **existing 6-section contract** — no structural change:

```json
{
  "action": {
    "type": "select",
    "value": "India"
  },
  "target": {
    "kind": "element",
    "tag": "SELECT",
    "role": "listbox",
    "name": "Country"
  },
  "locators": [ ... ],
  "context": { "iframe": false, "shadowDom": false, "frame": null },
  "trace": { "interactionId": "select-0001", "stepId": "step-0001" },
  "meta": { "status": "generated", "warnings": [], "generatedAt": "..." }
}
```

Key differences from existing interactions:
- `action.value` carries the **selected option's label** (e.g., `"India"`). For non-select interactions, `action.value` is null (radio) or carries text-entry content (text). For dropdown select, it carries the selected option label.
- `target.role` is `"listbox"` (native `<select>`, per `getImplicitRole` mapping) or `"combobox"` (custom dropdown).

### 6.4 Value Representation

| Field | Native `<select>` | Custom Dropdown |
|-------|-------------------|-----------------|
| `action.value` | Option label text (e.g., `"India"`) | Option label text (e.g., `"India"`) |
| Playwright uses | Label for `.selectOption({ label: 'India' })` or value for `.selectOption('IN')` | Label for `getByText('India')` or `getByRole('option', { name: 'India' })` |

> **Product Rule:** The recorded value is the **user-visible option label** — what the user sees and chose. The execution layer may translate this to an internal value if needed, but the product model and Canonical Step always show the human-readable label.

> **Product Stability Note:** Whether the execution layer uses the label or the internal value attribute for locator resolution is an implementation detail. The product requirement is that the recorded value is the human-readable label.

### 6.5 Playwright Execution

The Playwright generator's existing `case 'select'` already disambiguates radio from dropdown via `target.role === 'radio'`. C5.1 extends this disambiguation:

```typescript
case 'select': {
  // Radio: C4.1 — use .check()
  if (target.role === 'radio') {
    return { statements: [`${selector}.check();`] };
  }

  // Native <select>: use .selectOption()
  if (target.tag === 'SELECT') {
    return { statements: [`${selector}.selectOption('${escapeString(value)}');`] };
  }

  // Custom dropdown: click trigger, then click option by text
  // The Execution JSON target is the dropdown trigger.
  // The action.value is the option label to click.
  return {
    statements: [
      `${selector}.click();`,                              // open dropdown
      `page.getByText('${escapeString(value)}').click();`, // select option
    ]
  };
}
```

> **Product Stability Note:** The exact Playwright strategy for custom dropdowns (getByText vs getByRole, single vs multi-step) is an execution-engine implementation detail. The product requirement is that the generated Playwright code successfully selects the intended option. The strategy may vary by component library and may be refined in future milestones without changing any frozen product rule. The Playwright generator is the sole owner of this logic — the Canonical Step and Execution JSON are unaffected by execution strategy changes.

### 6.6 CanonicalStep Field Extension

A new optional field `selectedValue: string | null` is added to `CanonicalStep` (mirroring the `checked` field pattern from C4.3):

```typescript
/**
 * Selected option label for dropdown interactions. Null for non-select actions.
 * Carries the user-visible label of the selected option from the recording
 * layer through to the Execution JSON Generator.
 */
selectedValue: string | null;
```

This field is null for all non-select interaction types, backward-compatible.

### 6.7 Pipeline Integration Confirmation

| Pipeline Stage | Change Required | Description |
|----------------|-----------------|-------------|
| Content Script | **NEW** (`select-content-script.ts`) | Detects meaningful value changes on dropdown controls |
| Service Worker | **NEW message handlers** | `SELECT_CAPTURED` handler |
| Shared Types | **NEW** (`SelectEvent`) | Extended `SessionEvent` union |
| Interaction Registry | **NEW** (`select` type) | Registration with cyan badge |
| Canonical Step Generator | **EXTEND** | Populate `selectedValue` field |
| Readability Optimizer | **NO CHANGE** | OR-5 deferred |
| Execution JSON Generator | **EXTEND** | `mapActionType('select') → "select"`; action.value = selectedValue |
| Playwright Generator | **EXTEND** | Custom dropdown branch in `case 'select'` |
| Generation Engine | **NO CHANGE** | Existing pipeline chain |
| Validation Framework | **NO CHANGE** | B8 contract is implementation-agnostic |

---

## 7. Interaction Boundaries

### 7.1 Coexistence with Other Interaction Types

| Interaction | Relationship with Select |
|-------------|------------------------|
| **Click** | Select takes precedence when the target is a dropdown control and a value change occurs. The click-content-script must exclude dropdown controls from generic click recording (same pattern as C4.2 checkbox/radio exclusion). Opening the dropdown (click without value change) remains a generic Click — it's a no-value-change click. |
| **Text Entry** | Search text typed into a searchable dropdown's `<input>` is captured by the text-entry recorder. However, only the **final selected value** is recorded as a Select interaction. The intermediate search text MAY be recorded as text entry (this is existing behavior — the text recorder captures all typed text). The Select interaction captures the committed value, not the search text. |
| **Hover** | No interaction. Hovering over a dropdown or its options is a Hover interaction, unrelated to Select. |
| **Checkbox** | No overlap. Checkbox uses `input[type="checkbox"]`; Select uses `<select>`, `[role="combobox"]`, `[role="listbox"]`. |
| **Radio** | No overlap. Radio uses `input[type="radio"]`; Select uses `<select>`, `[role="combobox"]`, `[role="listbox"]`. Both produce execution verb `"select"` — disambiguated by target metadata. |
| **Navigation** | Independent. A Select interaction may trigger navigation (e.g., selecting a language redirects), but both interactions are recorded separately. |

### 7.2 Ownership Model

When a Dropdown value change is recorded, the select-content-script claims ownership via `data-cmdrunner-handled='select'` on the control element. This prevents the click-content-script from recording a duplicate Click event for the same interaction.

However, **the initial click to open the dropdown is NOT claimed** — it's a legitimate click that doesn't change the value. Only the value-change event triggers ownership.

> **Product Stability Note:** The exact ownership claiming mechanism — whether ownership is claimed on the `<select>`, on the `<option>`, or on the custom dropdown trigger — is an implementation detail. The product requirement is that no duplicate events are recorded for a single value selection.

### 7.3 Select Followed by Application Behavior

| Scenario | Recording |
|----------|-----------|
| Select → Navigation (e.g., language switch) | Two independent interactions: Select + Navigation |
| Select → Dynamic form update (new fields appear) | Select recorded; form update is observable but not an interaction |
| Select → Validation message | Select recorded; validation is application response, not interaction |
| Select → Enable controls | Select recorded; enabling is application response |
| Select → Open additional fields | Select recorded; field appearance is application response |

All of these are **independent interactions**. Select is recorded once, and any application behavior triggered by it is the application's response, not a recorded interaction.

### 7.4 Specialization Rule

> **Product Rule:** Dropdown controls are owned by the Select recorder when a value change occurs. Generic Click applies to all other elements. This is the same precedence pattern established by C4 (Checkbox/Radio over Click).

---

## 8. Validation Strategy

### 8.1 Validation Scenarios

| # | Scenario | Category | Expected Pass Criteria |
|---|----------|----------|----------------------|
| 1 | Native `<select>` — select different option | Native | `Select "X"` recorded; action.type `"select"`; Playwright `.selectOption()` |
| 2 | Native `<select>` — re-select current option | Native | NOT recorded (no value change) |
| 3 | Native `<select>` — open and close without selecting | Native | NOT recorded (no value change) |
| 4 | Native `<select>` — disabled | Native | NOT recorded (Gate 5) |
| 5 | Native `<select>` — read-only | Native | NOT recorded (Gate 5) |
| 6 | Searchable dropdown — type + select | Custom | `Select "X"` recorded with final value; search text may appear as separate Text Entry |
| 7 | Autocomplete — type + select from suggestions | Custom | `Select "X"` recorded with selected suggestion |
| 8 | Large option list (100+ options) | Native | `Select "X"` recorded correctly; no performance issues |
| 9 | Dynamic option loading (async fetch) | Custom | `Select "X"` recorded after options load and user selects |
| 10 | Virtualized list (react-window) | Custom | `Select "X"` recorded; option resolved despite virtualization |
| 11 | ARIA listbox (`role="listbox"`) | Custom | `Select "X"` recorded; action.type `"select"` |
| 12 | React Select component | Custom | `Select "X"` recorded; Playwright uses click-based strategy |
| 13 | Material UI Select | Custom | `Select "X"` recorded; Playwright uses click-based strategy |
| 14 | Ant Design Select | Custom | `Select "X"` recorded; Playwright uses click-based strategy |
| 15 | Headless UI Listbox | Custom | `Select "X"` recorded; Playwright uses click-based strategy |
| 16 | Radix UI Select | Custom | `Select "X"` recorded; Playwright uses click-based strategy |
| 17 | Programmatic value change | Both | NOT recorded (Gate 1 — not genuine user event) |
| 18 | Select → Navigation | Integration | Both Select and Navigation recorded independently |

### 8.2 Pass Criteria

A Select interaction passes validation when:
1. The Canonical Step shows `Select "<selected value>"`
2. The Execution JSON has `action.type: "select"` and `action.value: "<selected value>"`
3. The Playwright code selects the correct option (`.selectOption()` for native, click-based for custom)
4. No duplicate Click event is recorded for the same interaction

### 8.3 Common Failure Cases

| Failure | Cause | Mitigation |
|---------|-------|------------|
| Dropdown click recorded instead of Select | Click-content-script not excluding dropdown controls | Add dropdown selectors to CHECKBOX_RADIO_SELECTOR equivalent |
| Selected value missing from Execution JSON | `selectedValue` not propagated through pipeline | Verify canonical-step-generator populates the field |
| Wrong Playwright strategy (selectOption on custom dropdown) | target.tag not checked | Verify target metadata disambiguation |
| Search text recorded as the value | Intermediate search captured instead of final selection | Verify committed-selection detection |
| Virtualized option not found | Option not in DOM when recorded | Verify option text is captured before virtualization removes it |

### 8.4 Regression Validation

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Click generation unchanged | Existing click tests pass |
| 2 | Hover generation unchanged | Existing hover tests pass |
| 3 | Text Entry generation unchanged | Existing text tests pass |
| 4 | Checkbox generation unchanged | Existing checkbox tests pass |
| 5 | Radio generation unchanged | Existing radio tests pass |
| 6 | Navigation generation unchanged | Existing navigation tests pass |
| 7 | Readability Optimizer unchanged | OR-1 through OR-4 behavior preserved |
| 8 | Execution JSON contract structure unchanged | 6-section contract intact |

---

## 9. Product Principles

| ID | Principle | Application to Select |
|----|-----------|----------------------|
| DP1 | **Record user intent, not UI mechanics** | The recorded interaction is "the user selected value X" — not "the user clicked element Y then clicked element Z" |
| DP2 | **Record only meaningful value changes** | Opening/closing the dropdown, re-selecting the current value, and browsing without selection are not recorded |
| DP3 | **Record the final selected value** | For searchable/autocomplete dropdowns, the intermediate search text is not the value — the committed selection is |
| DP4 | **Preserve deterministic execution** | The same Select interaction always produces the same Execution JSON and Playwright code |
| DP5 | **Preserve semantic execution** | Playwright code reads as "select this option" — not "click these coordinates" |
| DP6 | **Remain framework-agnostic** | The product model does not distinguish React Select from MUI Select from native `<select>` |
| DP7 | **Integrate cleanly with existing architecture** | Uses the same registration, pipeline, and generation patterns as Click/Text/Hover/Checkbox/Radio |
| DP8 | **Avoid regressions** | No existing interaction type's behavior is modified |

---

## 10. Known Assumptions

| ID | Assumption | Risk | Mitigation |
|----|-----------|------|------------|
| A1 | The selected option's label is accessible at recording time | Medium — virtualized lists may remove options from DOM | Capture the label text before the option is virtualized away |
| A2 | Native `<select>` `change` event fires reliably on all browsers | Low — standard browser behavior | Test across Chromium, Firefox, WebKit |
| A3 | Custom dropdowns expose their selected value via ARIA or DOM state | Medium — not all custom dropdowns are ARIA-compliant | Fall back to text comparison or option click detection |
| A4 | The click-content-script can be extended to exclude dropdown controls (same pattern as C4.2) | Low — proven pattern | Reuse the CHECKBOX_RADIO_SELECTOR exclusion approach |
| A5 | The existing `case 'select'` in the Playwright generator can be extended without breaking radio | Low — C4.3 already disambiguates by target.role | Add target.tag check for native select |
| A6 | `<select multiple>` is not needed for initial release | Low — multi-select is rare in tested workflows | Document as deferred; can be added later |
| A7 | Searchable dropdown search text is captured by the existing text-entry recorder | Low — text recorder matches `input[type="search"]` and `input[type="text"]` | Verify no duplicate recording for the same logical interaction |

---

## 11. Potential Risks

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| R1 | Custom dropdown detection unreliable across component libraries | **High** — React Select, MUI, Ant Design have different DOM structures | Phase the implementation: native `<select>` first (C5.2), then custom (C5.3+). Use ARIA role detection as primary, structural heuristics as fallback. |
| R2 | Playwright click-based strategy fails for specific component libraries | **High** — each library renders options differently | Use ARIA `getByRole('option', { name: value })` as the primary strategy — it works across libraries that are ARIA-compliant |
| R3 | Click-content-script exclusion too broad — excludes legitimate clicks on custom dropdown triggers | **Medium** | Only exclude when a value change is detected; the initial open-click remains a generic Click |
| R4 | Search text + Select produces duplicate/confusing steps | **Medium** | This is existing behavior (text recorder captures all typed text). Document as known behavior; potential future readability rule (OR-6: collapse search-text + select) |
| R5 | Radio `"select"` and Dropdown `"select"` execution verb collision | **Low** — C4.3 already disambiguates by target.role | Document the disambiguation chain: radio → .check(), native select → .selectOption(), custom → click-based |
| R6 | `<select multiple>` users expect multi-select support | **Low** — rare use case | Document as deferred; the product model supports it conceptually (each toggle is a separate interaction) |

---

## 12. Consistency Review Against Frozen Milestones

### 12.1 Product Foundation (B1-B8)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| InteractionRegistry pattern | ✅ No conflict | Select registers via the same `registerInteractionType()` mechanism |
| CanonicalStep source-of-truth | ✅ No conflict | Select produces CanonicalSteps like all other types |
| Generator dependency chain | ✅ No conflict | Same chain: Canonical → Execution JSON → Playwright |
| Pure function generators | ✅ No conflict | All generators remain pure functions |
| Execution JSON 6-section contract | ✅ No conflict | Uses existing contract structure; only new action.type enum value |
| Readability Optimizer extensibility | ✅ No conflict | No new rules; OR-5 deferred |
| Playwright Generator extensibility | ✅ No conflict | Extends existing `case 'select'`; no rewrite |

### 12.2 C3 (Hover)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| Hover interaction type | ✅ No conflict | Completely independent interaction; no DOM overlap |
| DWELL_THRESHOLD | ✅ Not modified | Unaffected |
| Gate 5 visibility detection | ✅ Not modified | Unaffected |
| MutationObserver | ✅ Not modified | Unaffected |

### 12.3 C4 (Checkbox & Radio)

| Decision | Conflict? | Detail |
|----------|-----------|--------|
| Checkbox state-based model | ✅ No conflict | Independent; different DOM elements |
| Radio execution verb `"select"` | ⚠️ **Shared verb** | Both Radio and Dropdown produce `"select"`. Disambiguation: Radio target.role === 'radio' → .check(); Dropdown target.tag === 'SELECT' → .selectOption(); else → click-based. This is an extension of the C4.3 disambiguation pattern, not a modification. |
| Checkbox/Radio content script | ✅ No conflict | Different selectors; no overlap |
| OR-4 deferral | ✅ No conflict | OR-5 (Select) also deferred, same rationale |
| Click exclusion pattern (CHECKBOX_RADIO_SELECTOR) | ✅ No conflict | Dropdown exclusion follows the same pattern but with different selectors |

### 12.4 Naming Collision Analysis

The execution verb `"select"` is shared between Radio (C4.1) and Dropdown (C5.1). This is analyzed here in full:

| Source | actionType | mapActionType output | target.role | Playwright output |
|--------|-----------|---------------------|-------------|-------------------|
| Radio (C4.1) | `radio` | `"select"` | `"radio"` | `.check()` |
| Dropdown native (C5.1) | `select` | `"select"` | `"listbox"` | `.selectOption()` |
| Dropdown custom (C5.1) | `select` | `"select"` | `"combobox"` | click-based |

**Verdict: No conflict.** The three cases are fully disambiguated by `target.role` and `target.tag`. The C4.3 Playwright code already disambiguates Radio from non-Radio. C5.1 extends the non-Radio branch into two sub-strategies (native vs custom). No frozen decision is modified.

### 12.5 Existing Pipeline Integrity

| Stage | Impact |
|-------|--------|
| Interaction Timeline | ✅ No change — Select events are appended to the same timeline |
| Canonical Step Generator | ✅ Additive — new `selectedValue` field, null for non-select |
| Readability Optimizer | ✅ No change — no new rules |
| Execution JSON Generator | ✅ Additive — new `mapActionType` entry |
| Playwright Generator | ✅ Additive — new branches in existing `case 'select'` |
| Generation Engine | ✅ No change — existing pipeline chain |

---

## 13. Next Milestone Directive

### C5.2 — Dropdown Recording Foundation (Implementation)

**Scope:** Implement the recording layer for Dropdown interactions.

**Must do:**
- Create `select-content-script.ts` implementing the 5-gate decision tree
- Register `select` interaction type in `interaction-types.ts`
- Add `SELECT_CAPTURED` message handler in `service-worker.ts`
- Add `SelectEvent` type to `shared/types.ts`
- Update `manifest.json` with content script entry
- Exclude dropdown controls from generic Click recording (extend click-content-script exclusion)
- Populate `selectedValue` on CanonicalStep

**Must NOT do:**
- Modify Canonical Test Step generation (beyond populating `selectedValue`)
- Modify Readability Optimizer
- Modify Execution JSON Generator (beyond adding `mapActionType('select')` mapping)
- Modify Playwright Generator (beyond extending `case 'select'`)
- Modify any frozen milestone

### C5.3 — Dropdown Artifact Generation (Implementation)

**Scope:** Integrate Dropdown into Execution JSON and Playwright generation.

**Must do:**
- Extend `mapActionType` for `select` → `"select"`
- Extend Playwright `case 'select'` with native and custom dropdown strategies
- Write comprehensive pipeline tests

---

## 14. Freeze Declaration

C5.1 is PERMANENTLY FROZEN. The following product decisions are frozen and must not be modified by implementation milestones:

### Frozen Product Rules

1. **One interaction type:** All dropdown categories (native `<select>`, searchable, autocomplete, component libraries, ARIA listboxes) share a single `select` interaction type.

2. **State-based model:** A Select interaction is recorded only when the user changes the dropdown's value to a different option. Opening, closing, browsing, and re-selecting the current value are not recorded.

3. **Value-based representation:** The recorded value is the user-visible option label (e.g., "India"), not the internal value code (e.g., "IN").

4. **Unified Canonical Step:** All dropdown selections produce `Select "<value>"` — regardless of native or custom implementation.

5. **Shared execution verb:** Dropdown produces execution verb `"select"`, same as Radio (C4.1). Disambiguation is by target metadata, not by execution verb.

6. **Execution engine owns the native/custom distinction:** Native `<select>` uses `.selectOption()`; custom dropdowns use click-based strategy. This distinction exists **only within the Playwright generator** (the execution engine). The product model, Canonical Step, and Execution JSON are identical for both categories. Future execution improvements for additional frameworks (React Select, MUI, Ant Design, Radix, Headless UI, future libraries) can be implemented entirely within the execution engine without changing any frozen product rule, Canonical Step format, or Execution JSON contract.

7. **No new readability rules:** OR-5 (collapse consecutive Select on same control) is deferred.

8. **Evidence Mechanism Independence:** The product rules are stated in terms of outcomes (value changed, control enabled, genuine user action), not detection mechanisms.

9. **Execution Layer Independence:** The Playwright generator (execution engine) owns all framework-specific execution logic. The frozen product model does not constrain execution strategy choice. New execution strategies for additional dropdown frameworks can be added without modifying any product rule, Canonical Step convention, Execution JSON contract, or recording rule defined in this document. The product boundary is: the Execution JSON describes **what** to select; the execution engine decides **how** to select it.

### Modification Policy

These product rules may only be modified if:
- Real-world validation reveals a fundamental flaw in the product model
- A future milestone requires a change that is incompatible with these rules

Implementation milestones (C5.2, C5.3) must conform to these rules. They may choose detection mechanisms, locator strategies, and execution details freely, but must not alter the product model, Canonical Step format, recording rules, or interaction boundaries defined here. In particular, execution engine improvements (Playwright strategy changes, new framework support, improved locator resolution) are always permitted and never require a change to the frozen product rules.

---

## 15. Permanent Regression Coverage

| # | Scenario | Category | Expected Behavior |
|---|----------|----------|-------------------|
| 1 | Select different option from native `<select>` | Native | `Select "X"` recorded; action.type `"select"`; Playwright `.selectOption()` |
| 2 | Re-select current option (no change) | Native | NOT recorded |
| 3 | Open and close dropdown without selecting | Native | NOT recorded |
| 4 | Disabled dropdown | Both | NOT recorded |
| 5 | Read-only dropdown | Both | NOT recorded |
| 6 | Programmatic value change | Both | NOT recorded |
| 7 | Select from searchable dropdown | Custom | `Select "X"` recorded with final value |
| 8 | Select from autocomplete | Custom | `Select "X"` recorded with selected suggestion |
| 9 | Change selection (select different option in same dropdown) | Both | Second `Select "Y"` recorded |
| 10 | Multiple dropdowns in sequence | Both | Each produces independent `Select` step |
| 11 | Select followed by Navigation | Integration | Both Select and Navigation recorded |
| 12 | Existing Click/Hover/Text/Checkbox/Radio unaffected | Regression | All existing tests pass |

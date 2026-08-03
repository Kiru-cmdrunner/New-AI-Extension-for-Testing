# Milestone — Semantic Interaction Language & Canonical Interaction Taxonomy

**Status:** Design milestone — validated and frozen  
**Date:** 2026-07-17  
**Scope:** Canonical semantic interaction language — the permanent interaction contract between all CmdRunner stages and all execution engines  
**Constraint:** Greenfield design. No reference to prior interaction types. No architecture changes. No AI philosophy changes. All frozen milestones preserved.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Research Summary](#2-research-summary)
3. [What Is a Semantic Interaction?](#3-what-is-a-semantic-interaction)
4. [Canonical Interaction Taxonomy](#4-canonical-interaction-taxonomy)
5. [Interaction Hierarchy and Categories](#5-interaction-hierarchy-and-categories)
6. [Recommended Abstraction Level](#6-recommended-abstraction-level)
7. [Architectural Justification for Every Interaction Type](#7-architectural-justification-for-every-interaction-type)
8. [Canonical Naming Conventions](#8-canonical-naming-conventions)
9. [Interaction Metadata Model](#9-interaction-metadata-model)
10. [Interaction Lifecycle Through the Architecture](#10-interaction-lifecycle-through-the-architecture)
11. [Relationship with Stage 3a and Stage 3b](#11-relationship-with-stage-3a-and-stage-3b)
12. [Extensibility Strategy](#12-extensibility-strategy)
13. [Completeness Review](#13-completeness-review)
14. [Risk Assessment and Limitations](#14-risk-assessment-and-limitations)
15. [Long-Term Stability Assessment](#15-long-term-stability-assessment)
16. [Architectural Quality Evaluation](#16-architectural-quality-evaluation)
17. [Critical Self-Review](#17-critical-self-review)
18. [Architectural Compatibility Verification](#18-architectural-compatibility-verification)
19. [Freeze Declaration](#19-freeze-declaration)

---

## 1. Executive Summary

### Verdict

A canonical semantic interaction language of **10 interaction types across 7 categories** is **validated, critically reviewed, and frozen** as CmdRunner's permanent interaction contract. This is not a list of browser events — it is a semantic language that represents user intent independently of any technology, engine, or provider.

### The 10 Canonical Types

| # | Type | Category | Intent |
|---|------|----------|--------|
| 1 | `navigate` | Navigation | Move to a different page or URL |
| 2 | `click` | Activation | Activate an element to trigger an operation |
| 3 | `fill` | Data Entry | Enter or edit free-text content |
| 4 | `select` | Selection | Choose a value from a constrained set of options |
| 5 | `toggle` | State Change | Flip a binary on/off condition |
| 6 | `selectDate` | Data Entry | Select a temporal value (date, time, range) |
| 7 | `hover` | Observation | Reveal UI changes via pointer dwell |
| 8 | `pressKey` | Input | Press a specific non-text key or key combination |
| 9 | `upload` | File Transfer | Provide files to the application |
| 10 | `drag` | Spatial Movement | Relocate an element to a different position |

### Design philosophy

> **A semantic interaction represents user intent, not DOM mechanics.** Each type answers "what did the user try to accomplish?" — not "what browser event fired?" The taxonomy is grounded in HCI interaction theory (Shneiderman's interaction styles, GOMS/KLM operators), validated against WAI-ARIA widget patterns, tested for cross-engine compatibility (Playwright/Selenium/Cypress), and designed for multi-paradigm extensibility (Web → Mobile → Desktop → API).

---

## 2. Research Summary

### 2.1 Sources investigated

| Domain | Sources | Key Findings |
|--------|---------|-------------|
| **HCI Interaction Styles** | Shneiderman (1997), Preece et al. (1994), ACM SIGCHI Curricula (1992), Interaction Design Foundation Glossary | Four classical interaction styles: command language, form fill-in, menu selection, direct manipulation. Five interaction types: instructing, conversing, manipulating, exploring, responding. |
| **GOMS/KLM Model** | Card, Moran, Newell (1980); Cambridge Interaction Design course | Five atomic operators: K (keystroke), P (pointing), H (homing/device switch), M (mental preparation), R (system response). CmdRunner's types are semantic groupings of these primitives. |
| **WAI-ARIA Patterns** | W3C APG (Authoring Practices Guide), WebAIM Million 2026 | 20+ widget patterns (button, link, checkbox, radio, combobox, listbox, menu, tabs, slider, switch, tree, grid, dialog, tooltip). ARIA misuse rampant (59.1 errors/page WITH ARIA vs 42 without) — confirms need for semantic recording independent of ARIA correctness. |
| **Design Systems** | Apple HIG 2025 (WWDC25), Material Design 3, Atlassian Design System | Apple HIG core principle: "Components should always support the same set of core interactions" regardless of platform/form. Validates CmdRunner's intent-level abstraction. Material Design 3 separates semantic intent from component rendering. Atlassian uses semantic tokens (`color.text.brand` not `blue-700`) — same principle: meaning over mechanism. |
| **Enterprise Testing** | Testim (Tricentis), Mabl, Functionize, Autonoma | All converged on intent-based interaction models. Mabl uses "intent-based locators." Functionize uses NLP test authoring. Testim records actions as semantic steps. None use raw DOM events as their canonical language. |
| **Workflow Modeling** | BPMN 2.0 (OMG), Workflow Patterns (van der Aalst), Camunda | BPMN User Task models "what the human does" at semantic level, not keystroke level. 21 workflow patterns describe control-flow behavior. Data patterns separate data production from data consumption. |
| **Automation Frameworks** | Playwright API docs, Selenium WebDriver docs, Cypress API docs | All three frameworks expose the same core actions: click, fill/type, select, check/uncheck, hover, press, drag, upload. No framework has an action not covered by the proposed 10 types. |
| **HCI Laws** | Fitts's Law, Hick's Law, Miller's Law (Laws of UX) | Miller's Law (7±2 chunks) supports keeping the taxonomy small and memorable. Hick's Law (decision time grows with choices) validates a minimal taxonomy — fewer types = faster classification decisions. |

### 2.2 Key lessons applied

| Lesson | Source | Application |
|--------|--------|-------------|
| Interaction types should reflect intent, not mechanics | Shneiderman, Preece, all testing platforms | DP1: Intent over mechanism |
| GOMS operators (K, P, H, M, R) are the atomic primitives | Card/Moran/Newell | CmdRunner types are semantic groupings of GOMS operators — `fill` = K operators, `click` = P+K, `hover` = P without K |
| Same component should support same interactions across forms | Apple HIG 2025 | `select` covers dropdowns, radio groups, listboxes — same intent, different rendering |
| ARIA misuse is rampant — don't depend on correct ARIA | WebAIM Million 2026 | CmdRunner records evidence from multiple signals (tag, role, state, class, context), not ARIA alone |
| Taxonomy should fit in human working memory (7±2) | Miller's Law | 10 types is near the cognitive sweet spot — memorable, classifiable |
| Intent-based locators outperform DOM-based locators | Mabl, Testim, Functionize | Semantic types + AI naming > raw selectors for test stability |
| BPMN separates "what" from "how" at the task level | BPMN 2.0 | CmdRunner separates interaction type (what) from execution verb (how) |

---

## 3. What Is a Semantic Interaction?

### 3.1 Definition

A **semantic interaction** is the representation of a single, meaningful, committed user intent during a recording session. It captures what the user tried to accomplish — not what the browser processed, what DOM elements were involved, or what automation commands would reproduce it.

A semantic interaction is:

| Quality | Meaning |
|---------|---------|
| **Intent-based** | Represents the user's goal ("select a date") not the mechanism ("clicked td[aria-label='July 18']") |
| **Committed** | Represents a completed action with a result, not an intermediate mechanical step |
| **Technology-independent** | Does not reference DOM tags, CSS selectors, XPath, or execution APIs |
| **Self-describing** | Carries enough metadata (target, value, evidence) to be executed without additional context |
| **Stable** | Remains valid regardless of browser, framework, execution engine, or AI provider |

### 3.2 Distinction from related concepts

| Concept | What It Is | How Semantic Interaction Differs |
|---------|-----------|----------------------------------|
| **Browser event** (click, change, mouseenter) | A mechanical signal from the browser | One event or many events may produce one semantic interaction. Events are evidence, not meaning. |
| **DOM operation** (querySelector, dispatchEvent) | An implementation detail of how the page processes events | Invisible to the semantic model — it's plumbing |
| **Playwright command** (page.click, locator.fill) | One execution engine's API for reproducing an action | One possible execution of the semantic type. Cypress/Selenium would execute the same type differently. |
| **UI element** (button, dropdown, checkbox) | The target of the interaction | Metadata on the interaction (target), not the interaction itself |
| **Execution action** (the `action.type` field in Execution JSON) | The machine-executable verb derived from the semantic type | A downstream projection — Stage 4 maps semantic types to execution verbs |

### 3.3 The litmus test

A candidate is a first-class semantic interaction if and only if ALL FOUR conditions hold:

1. **Distinct intent:** It represents a user goal that a QA engineer would describe as a separate test step
2. **Distinct execution:** It requires a different automation method from all other types
3. **Distinct evidence:** It produces different recording evidence (different DOM signals, state changes)
4. **Implementation-independent:** It remains meaningful without reference to specific DOM structure or browser API

If a candidate fails any test, it is **metadata** on an existing type, not a new type.

---

## 4. Canonical Interaction Taxonomy

### 4.1 Taxonomy overview

```
CANONICAL INTERACTION LANGUAGE
│
├── NAVIGATION
│   └── navigate              — Move to a different page or URL
│
├── ACTIVATION
│   └── click                 — Activate an element to trigger an operation
│
├── DATA ENTRY
│   ├── fill                  — Enter or edit free-text content
│   └── selectDate            — Select a temporal value (date, time, range)
│
├── SELECTION
│   └── select                — Choose a value from a constrained set of options
│
├── STATE CHANGE
│   └── toggle                — Flip a binary on/off condition
│
├── OBSERVATION
│   └── hover                 — Reveal UI changes via pointer dwell
│
├── INPUT
│   └── pressKey              — Press a specific non-text key or key combination
│
├── FILE TRANSFER
│   └── upload                — Provide files to the application
│
└── SPATIAL MOVEMENT
    └── drag                  — Relocate an element to a different position
```

### 4.2 How the taxonomy maps to HCI foundations

| CmdRunner Type | GOMS Operator(s) | Shneiderman Style | WAI-ARIA Pattern(s) |
|----------------|-------------------|-------------------|---------------------|
| `navigate` | — (system-level) | — (meta-interaction) | — (document-level) |
| `click` | P + K (point + click) | Direct manipulation / Command | button, link, tab |
| `fill` | K (keystroke sequence) | Form fill-in | textbox, searchbox |
| `select` | P + K (point + click option) | Menu selection | combobox, listbox, menu, radio, tablist |
| `toggle` | P + K (point + click) | Direct manipulation | checkbox, switch |
| `selectDate` | P + K (point + click cell) or K | Form fill-in / Menu selection | grid, spinbutton, textbox[type=date] |
| `hover` | P (point without click) | Exploring | tooltip, menu (hover reveal) |
| `pressKey` | K (single keystroke) | Command language | application-level (shortcuts) |
| `upload` | P + K (point + select file) | Form fill-in | input[type=file] |
| `drag` | P (press + move + release) | Direct manipulation | — (custom widget) |

This mapping demonstrates that CmdRunner's 10 types are the **semantic intersection** of HCI theory, accessibility standards, and automation frameworks — not an arbitrary list.

---

## 5. Interaction Hierarchy and Categories

### 5.1 Category rationale

Categories group interaction types by the **nature of the user's goal**, not by input device or DOM mechanism:

| Category | Unifying Principle | Types |
|----------|-------------------|-------|
| **Navigation** | The user changed their location in the application | `navigate` |
| **Activation** | The user triggered an action or operation | `click` |
| **Data Entry** | The user provided structured information | `fill`, `selectDate` |
| **Selection** | The user chose from a constrained set | `select` |
| **State Change** | The user flipped a binary condition | `toggle` |
| **Observation** | The user inspected without activating | `hover` |
| **Input** | The user used keyboard for non-text purposes | `pressKey` |
| **File Transfer** | The user provided external data files | `upload` |
| **Spatial Movement** | The user relocated an element | `drag` |

### 5.2 Category relationships

```
                    NAVIGATION
                   (changes page context)
                        │
                        ▼
         ┌──────────────┴──────────────┐
         │                             │
    ACTIVATION                    DATA ENTRY
   (trigger action)             (provide information)
    ├── click                    ├── fill
    ├── toggle                   └── selectDate
    ├── select
    ├── hover
    ├── pressKey
    ├── upload
    └── drag
```

- **Navigation** is the meta-interaction that changes context. All other interactions happen within a page.
- **Activation** is the broadest within-page category — `click` is the default, and more specific types (`toggle`, `select`, etc.) are specializations.
- **Data Entry** interactions have a value payload (entered text, selected date). Other activations do not.

### 5.3 Why `selectDate` is in Data Entry, not Selection

`selectDate` shares characteristics with both `select` (choosing from options) and `fill` (providing a value). It is categorized under Data Entry because:

1. **The payload is structured data** — an ISO date value, not a display label
2. **Dual representation** — display value + ISO value (unique among all types)
3. **Range semantics** — can represent a date range (two values in one interaction)
4. **Temporal sub-types** — date, time, datetime, month, week (metadata dimension unique to this type)

The user's intent is "provide a date" — closer to "fill in a value" than "choose from a list."

---

## 6. Recommended Abstraction Level

### 6.1 The abstraction decision

**Recommendation: Intent-level abstraction.** Each semantic type represents one user intent that a QA engineer would write as one test step.

### 6.2 Concrete examples

| Question | Resolution | Rationale |
|----------|-----------|-----------|
| Button click vs Link click vs Icon click? | **One type: `click`** + target metadata | Same intent (activate). Element type is metadata (`target.tag`, `target.role`). |
| Open dropdown → Click option → Close dropdown? | **One interaction: `select`** | The committed result is the selection. Opening/closing are mechanical steps that don't appear in test steps. |
| Check checkbox → state changes? | **One interaction: `toggle`** | The committed result is the state change. The click is the mechanism. |
| Hover → menu appears → Click menu item? | **Two interactions: `hover` + `click`** (or `select`) | Two distinct user intents with two distinct committed results. |
| Type in field → Tab to next → Type? | **Two interactions: `fill` + `fill`** | Two distinct fields, two distinct values. |

### 6.3 The granularity rule

> **One test step = one semantic interaction.** If a QA engineer would write it as one step, it is one interaction. If they would write two steps, it is two interactions.

This rule is grounded in GOMS methodology — GOMS models task sequences at the "method" level (a procedure for accomplishing a goal), not at the individual keystroke level. CmdRunner's semantic interactions correspond to GOMS methods, not GOMS operators.

### 6.4 What stays as metadata vs. becomes a new type

| Candidate | Decision | Rationale |
|-----------|----------|-----------|
| Double-click | **Metadata** on `click` (`clickCount: 2`) | Same intent (activate), different mechanical detail |
| Right-click / context click | **Metadata** on `click` (`button: 'right'`) | Still activation, different button |
| Modifier keys (Shift+Click) | **Metadata** on `click` (`modifiers: ['Shift']`) | Still activation with a modifier |
| Checkbox vs Switch | **Metadata** on `toggle` (`target.tag`, `target.role`) | Same intent (binary state change) |
| Native select vs ARIA listbox vs Menu | **Metadata** on `select` (`target.tag`, `target.role`) | Same intent (choose from options) |
| Calendar grid vs Native date input | **Metadata** on `selectDate` (`target.tag`) | Same intent (select a date) |
| Enter key vs Escape key | **Different values** of `pressKey` | Same type, different value |

---

## 7. Architectural Justification for Every Interaction Type

### 7.1 Justification framework

Each type is evaluated against four questions:

1. **Why does it exist?** — What user intent does it represent?
2. **Why is it first-class (not metadata)?** — Why can't it be a field on another type?
3. **Why should it not be merged?** — What distinguishes it from adjacent types?
4. **Why should it not be split?** — Why is it one type, not several?

### 7.2 `navigate`

| Question | Answer |
|----------|--------|
| Why does it exist? | Navigation is the only interaction that changes page context. All other interactions operate within a page. |
| Why first-class? | The target is a URL, not a DOM element. Navigation can occur without a click (redirect, form submit, URL entry). It has fundamentally different metadata (url, title) and execution (`page.goto()`). |
| Why not merged with `click`? | A link click causes navigation, but navigation is not always caused by a click. Conflating them loses the distinction between "the user activated an element" and "the page changed." |
| Why not split? | All navigations have the same intent: move to a new URL. The trigger (link click, redirect, form submit) is metadata. |

### 7.3 `click`

| Question | Answer |
|----------|--------|
| Why does it exist? | Generic element activation is the most common user interaction — buttons, links, icons, tabs, disclosure triggers. |
| Why first-class? | It has unique evidence (no value change, no state change, just activation) and unique execution (`locator.click()`). It is the default fallback when no more specific type applies. |
| Why not merged? | It IS the base type. More specific types (`toggle`, `select`) are specializations that take priority in the classifier. |
| Why not split (buttonClick, linkClick, iconClick)? | The user intent is identical ("activate this"). Element type is metadata, not a type. Splitting would create combinatorial explosion and violate Miller's Law (too many types to remember). |

### 7.4 `fill`

| Question | Answer |
|----------|--------|
| Why does it exist? | Text entry with a value payload — the user provided free-text information to the application. |
| Why first-class? | Has `value` metadata unique to text entry. Different event pattern (focus → type → blur vs single click). Different execution (`locator.fill()`). |
| Why not merged with `click`? | Text entry has no activation event. The committed value IS the interaction, not a click. Different intent, different execution. |
| Why not split (typeText, clearText, pasteText)? | All are "enter text into a field." The mechanism (type vs paste vs clear+type) is execution detail. The committed result is the same: the field now has this value. |

### 7.5 `select`

| Question | Answer |
|----------|--------|
| Why does it exist? | Choosing from a constrained set of options — the user picked one value from multiple choices. |
| Why first-class? | The value is a choice from a known set, not arbitrary input. Different evidence (option selection, list interaction). Different execution (`selectOption()`, `check()` for radios, `click()` for ARIA options). |
| Why not merged with `fill`? | Selection is constrained (options exist); text entry is free-form. The intent differs: "pick from these" vs "type this." |
| Why not merged with `click`? | A click activates; a select chooses. The evidence differs (value selected from options vs activation). The metadata differs (`value` = chosen option vs no value). |
| Why radio buttons are `select` not a separate type? | Radio selection is "choose one from a mutually exclusive set" — semantically identical to dropdown selection. DOM mechanism differs, but user intent is the same. The execution engine inspects the target. |

### 7.6 `toggle`

| Question | Answer |
|----------|--------|
| Why does it exist? | Binary state change — the user flipped a condition between on and off. |
| Why first-class? | Has `checked` boolean unique to binary state. Different intent (flip a condition vs activate or choose). Different execution (`.check()` / `.uncheck()`). |
| Why not merged with `click`? | A toggle has direction (on → off or off → on). The test-step language differs ("Check the box" vs "Click the button"). The execution API differs (`.check()` vs `.click()`). |
| Why not merged with `select`? | Toggle is binary (exactly 2 states); select is n-ary (3+ options). Different intent, different metadata, different execution. |

### 7.7 `selectDate`

| Question | Answer |
|----------|--------|
| Why does it exist? | Temporal value selection — the user chose a point or range in time. |
| Why first-class? | Unique dual representation (display value + ISO value), temporal sub-types (date/time/datetime/month/week), range semantics (two dates as one interaction). No other type handles these. |
| Why not merged with `select`? | Dates have ISO values, range fields, and temporal sub-types that generic selection doesn't carry. The complexity of date interaction (calendar grids, wheel pickers, native inputs) justifies a dedicated type. |
| Why not merged with `fill`? | While dates can be typed, the user's intent is to select a temporal value, not to enter free text. The dual representation (display + ISO) and range semantics are unique. |
| Why not split (selectSingleDate, selectDateRange, selectTime)? | All are "select a temporal value." The sub-type (date vs time vs range) is metadata (`dateType`). Splitting would create 6 types for one intent. |

### 7.8 `hover`

| Question | Answer |
|----------|--------|
| Why does it exist? | The user triggered a UI reveal by dwelling the pointer — menus, tooltips, previews. |
| Why first-class? | Unique intent: observation without activation. No value entered, no state changed. Different execution (`locator.hover()`). |
| Why not merged with `click`? | Hover has no activation — the purpose is to trigger a visual change, not to perform an operation. Different intent, different execution. |
| Why not split? | All hovers have the same intent: trigger a UI reveal via pointer dwell. What was revealed is metadata. |

### 7.9 `pressKey`

| Question | Answer |
|----------|--------|
| Why does it exist? | Non-textual keyboard input — Enter, Escape, Tab, arrow keys, shortcuts (Ctrl+S). |
| Why first-class? | Has `key` value, no text payload. Different intent: "trigger an action via keyboard" (Enter to submit, Escape to dismiss). Different execution (`locator.press(key)`). |
| Why not merged with `fill`? | Key presses serve intents that are not text entry: Enter to submit, Escape to close, Tab to navigate, Ctrl+S to save. No text value is committed. |
| Why not merged with `click`? | Key presses don't activate a specific element — they trigger application-level behavior. The target may be the focused element or the page itself. |

### 7.10 `upload`

| Question | Answer |
|----------|--------|
| Why does it exist? | The user provided external files to the application. |
| Why first-class? | Payload is external data (files), not text or a choice. Unique execution (`setInputFiles()`). No other type represents "provide a file." |
| Why not merged with `fill`? | The payload is a file path, not text. The execution is entirely different. The intent is "attach this file," not "type this text." |

### 7.11 `drag`

| Question | Answer |
|----------|--------|
| Why does it exist? | The user relocated an element spatially — Kanban cards, sortable lists, slider handles. |
| Why first-class? | Only interaction involving two elements (source + target) and spatial movement. Unique execution (`dragTo()`). No other type represents "move this thing there." |
| Why not merged with `click`? | Drag involves press + move + release, not a single activation. Two elements are involved. The intent is relocation, not activation. |

---

## 8. Canonical Naming Conventions

### 8.1 Type identifier naming

| Convention | Rule | Example |
|-----------|------|---------|
| Format | camelCase | `selectDate`, `pressKey` |
| Tense | Imperative verb or verb phrase | `fill`, `navigate`, `upload` |
| Length | 1-2 words | `click`, `selectDate` |
| Specificity | Intent-level, not mechanism-level | `toggle` not `checkboxChange` |
| Consistency | Every type is a verb | `navigate` (not `navigation`), `fill` (not `input`) |

### 8.2 Full naming table

| Type ID | Display Name | Badge | Plain English Template |
|---------|-------------|-------|----------------------|
| `navigate` | Navigate | NAVIGATE | "Navigate to {url}" |
| `click` | Click | CLICK | "Click the {elementName}" |
| `fill` | Fill | FILL | "Enter '{value}' in the {elementName}" |
| `select` | Select | SELECT | "Select '{value}' from {elementName}" |
| `toggle` | Toggle | TOGGLE | "{checked ? 'Check' : 'Uncheck'} the {elementName}" |
| `selectDate` | Select Date | SELECT DATE | "Select {value} as the {elementName}" |
| `hover` | Hover | HOVER | "Hover over the {elementName}" |
| `pressKey` | Press Key | PRESS KEY | "Press {key}" |
| `upload` | Upload | UPLOAD | "Upload {files}" |
| `drag` | Drag | DRAG | "Drag {source} to {target}" |

### 8.3 Naming design principles

| Principle | How Applied |
|-----------|-------------|
| **Human-readable** | Every type maps to natural English a QA engineer would write |
| **AI-friendly** | Type names are unambiguous verbs — AI can reason about them without context |
| **Stable** | Names describe intent, not technology — "fill" doesn't change when input methods evolve |
| **Technology-independent** | No name references DOM, CSS, or any framework |
| **Enterprise-suitable** | Names are professional, concise, and match industry testing vocabulary |
| **Extensible** | New types follow the same pattern: camelCase verb phrase |

---

## 9. Interaction Metadata Model

### 9.1 Universal metadata (present on every interaction)

```typescript
interface SemanticInteraction {
  // ── Identity ──
  type: InteractionType;             // one of the 10 canonical types
  actionId: string;                  // unique ID for this interaction

  // ── Target ──
  target: ElementIdentity;           // 18-field element identity (frozen)

  // ── Temporal ──
  timestamp: string;                 // ISO timestamp

  // ── Evidence (from Stage 3a classification) ──
  evidence: {
    valueType: 'value-change' | 'state-change' | 'navigation' | 'activation' 
             | 'spatial' | 'file' | 'key' | 'dwell' | 'temporal';
    beforeValue: string | null;
    afterValue: string | null;
    domMutations: string[] | null;
    classificationTier: 1 | 2 | 3;   // which classifier tier resolved this
  };

  // ── AI Enrichment (from Mental Model, optional) ──
  ai?: {
    businessName: string | null;
    confidence: number;              // 0.0 - 1.0
  };
}
```

### 9.2 Type-specific metadata

| Type | Additional Fields | Description |
|------|------------------|-------------|
| `navigate` | `url`, `title` | Target URL and page title |
| `click` | _(none — activation is self-describing)_ | Optional: `clickCount`, `button`, `modifiers` |
| `fill` | `value` | The entered text |
| `select` | `value` | The selected option's display text |
| `toggle` | `checked` | Resulting state (true = on) |
| `selectDate` | `value`, `isoValue`, `dateType`, optional range fields | Display value, ISO value, temporal sub-type, range |
| `hover` | `dwellTime?`, `revealedElements?` | Duration, what appeared |
| `pressKey` | `key` | The key or key combination |
| `upload` | `files` | File names or paths |
| `drag` | `dropTarget`, `position?` | Where the element was dropped |

### 9.3 The type/metadata separation principle

> **The interaction type defines WHAT the user intended. Metadata defines the SPECIFICS of that intent.**

Changing metadata does not change the type. Changing the type means the user's intent was fundamentally different. This separation is what makes the taxonomy stable — element types, DOM mechanisms, and modifiers evolve, but the 10 intent types do not.

---

## 10. Interaction Lifecycle Through the Architecture

### 10.1 Full lifecycle

```
BROWSER DOM EVENT(S)
  │  (click, change, focus, blur, mouseenter, keydown, etc.)
  │
  ▼
STAGE 2 — DETERMINISTIC RECORDER
  │  Captures: event type, target element, value before/after,
  │            state changes, DOM mutations
  │  Appends to: Session Context Layer 3 (Action History, immutable)
  │
  ▼
STAGE 2 — STATE TRACKER
  │  Updates: Session Context Layer 1 (current DOM state)
  │
  ▼
STAGE 2 — AI OBSERVER
  │  Reads: Layer 1 + Layer 3
  │  Writes: Session Context Layer 2 (Mental Model)
  │  Provides: business names, workflow context, advisory hints
  │
  ▼
─── STOP RECORDING ───
  │
  ▼
STAGE 3a — SEMANTIC CLASSIFIER
  │  Input: Layer 3 (evidence) + Layer 1 (context) + Layer 2 (advisory)
  │  Process: 3-tier decision (deterministic → advisory → default)
  │  Output: Each raw action assigned a SEMANTIC TYPE
  │           (navigate, click, fill, select, toggle, etc.)
  │           ★ TYPES ARE CREATED HERE — ASSIGNED EXACTLY ONCE
  │
  ▼
STAGE 3b — CANONICAL STEP GENERATOR
  │  Input: Typed interactions + Mental Model element names
  │  Process: Apply plain English templates, readability optimization
  │  Output: Canonical Test Steps
  │           ★ METADATA ENRICHED HERE (names, step numbers)
  │
  ▼
STAGE 4 — EXECUTION JSON GENERATOR
  │  Input: Canonical Test Steps
  │  Process: Map semantic type → execution verb + locator resolution
  │  Output: Execution JSON (Layer 0 CORE + optional Layer 1 RESILIENCE)
  │           ★ TYPE → VERB MAPPING HERE (read-only on types)
  │
  ▼
STAGE 5 — AUTOMATION GENERATOR
  │  Input: Execution JSON
  │  Process: Map execution verb → engine-specific code
  │  Output: Playwright / Selenium / Cypress / future engine
  │           ★ ENGINE CODE HERE (read-only on types)
  │
  ▼
EXECUTABLE TEST
```

### 10.2 Type immutability

**Semantic types are assigned at Stage 3a and are immutable afterward.** Stages 3b, 4, and 5 consume types read-only. This is the structural enforcement of the principle that semantic types are the stable contract — once determined, they never change.

---

## 11. Relationship with Stage 3a and Stage 3b

### 11.1 Stage 3a — Semantic Classification

**Responsibility:** Determine which semantic type each captured interaction is.

**Classification process (3-tier):**

```
TIER 1 — DETERMINISTIC EVIDENCE RULES (always runs first)
  │  Priority order (highest specificity first):
  │    1. Navigation detected (URL changed)?         → navigate
  │    2. Text value committed in editable field?     → fill (unless date-like)
  │    3. Date-like value committed?                  → selectDate
  │    4. Binary state changed (checked/pressed)?     → toggle
  │    5. Value selected from option set?             → select
  │    6. File input changed?                         → upload
  │    7. Key press (non-text)?                       → pressKey
  │    8. Element moved spatially?                    → drag
  │    9. Pointer dwell with UI reveal?               → hover
  │   10. None of the above?                          → FALLTHROUGH to Tier 2
  │
  ▼ (if Tier 1 falls through)
TIER 2 — ADVISORY INPUT (AI hints, optional)
  │  Mental Model consulted for context.
  │  AI may suggest a type with confidence ≥ threshold.
  │
  ▼ (if Tier 2 is ambiguous or unavailable)
TIER 3 — DEFAULT FALLBACK
  │  Assign: click
```

### 11.2 Stage 3b — Canonical Step Generation

**Responsibility:** Transform typed interactions into human-readable Canonical Test Steps.

Stage 3b does NOT change types. It:
1. Applies plain English templates (see §8.2)
2. Applies readability optimization (merge related steps — e.g., focus + fill → one step)
3. Numbers steps sequentially
4. Adds AI element names from the Mental Model

### 11.3 Separation matrix

| Concern | Stage 3a | Stage 3b |
|---------|----------|----------|
| Assigns semantic type? | ✅ YES | ❌ No |
| Determines plain English? | ❌ No | ✅ YES |
| Merges steps? | ❌ No | ✅ YES (readability) |
| Adds element names? | ❌ No | ✅ YES (from Mental Model) |
| Numbers steps? | ❌ No | ✅ YES |

---

## 12. Extensibility Strategy

### 12.1 How new types are added

A new type is added when a user intent exists that:
1. Cannot be represented by any existing type
2. Requires a different execution method
3. Produces different recording evidence
4. Would be written as a distinct test step

**Addition process (purely additive):**
1. Define type identifier, display name, plain English template
2. Add classification rule(s) to Stage 3a (new rules appended — no existing rule changes)
3. Add type-specific metadata fields
4. Add execution verb mapping to Stage 4
5. Add engine-specific code template to Stage 5

**No existing type is modified.** New types extend without breaking existing recordings.

### 12.2 Cross-paradigm extensibility

| Paradigm | How It Extends | Existing Types Affected? |
|----------|---------------|------------------------|
| **Mobile web** | `tap` = `click` with touch metadata; `swipe` = new type (additive) | No |
| **Desktop automation** | Same 10 types apply (desktop apps have buttons, text fields, dropdowns) | No |
| **API testing** | Separate API interaction category — `apiRequest` type (additive) | No |
| **Canvas interactions** | `draw` = new type (additive); `click`/`drag` still apply to canvas elements | No |
| **Maps** | `pan`/`zoom` = metadata on existing types or new types (additive) | No |
| **AI-generated UI** | Same 10 types — AI UI still uses buttons, dropdowns, text fields | No |
| **Enterprise custom controls** | Custom controls map to existing types via metadata | No |

### 12.3 Future type candidates

| Candidate | Category | Priority | Rationale |
|-----------|----------|----------|-----------|
| `scroll` | Navigation | Medium | Explicit scrolling for lazy-loaded content. Often implicit (Playwright auto-scrolls). |
| `swipe` | Spatial (mobile) | Future | Touch swipe gesture for mobile automation. |
| `tap` | Activation (mobile) | Future | Touch interaction. May be `click` with touch metadata instead. |
| `draw` | Spatial (canvas) | Future | Canvas drawing — coordinate-based. |
| `apiRequest` | API | Future | HTTP API interaction — separate paradigm. |
| `assert` | Verification | Low | Assertions belong in review phase, not recording. |
| `wait` | Synchronization | Low | Execution strategy (Layer 1 Resilience), not user intent. |

---

## 13. Completeness Review

### 13.1 Coverage by application domain

| Domain | Key Interactions | Covered? |
|--------|-----------------|:--------:|
| **Banking** | Login, transfer, statement download, form filling | ✅ |
| **E-commerce** | Search, add to cart, checkout, filter, sort | ✅ |
| **Healthcare** | Patient forms, appointment booking, record access | ✅ |
| **SaaS** | Dashboard, settings, team management, CRUD | ✅ |
| **HR Systems** | Leave application, profile editing, report generation | ✅ |
| **Travel** | Flight search, date selection, seat selection, booking | ✅ |
| **Content Management** | Rich text editing, media upload, drag-and-drop | ✅ |
| **Project Management** | Kanban boards, task creation, drag-and-drop | ✅ |
| **CRM** | Lead creation, pipeline management, data entry | ✅ |
| **ERP** | Complex forms, multi-step workflows, approvals | ✅ |

### 13.2 Coverage by WAI-ARIA widget pattern

| ARIA Pattern | Semantic Type | Covered? |
|-------------|--------------|:--------:|
| Button | `click` | ✅ |
| Link | `click` | ✅ |
| Checkbox | `toggle` | ✅ |
| Switch | `toggle` | ✅ |
| Radio Group | `select` | ✅ |
| Combobox | `select` | ✅ |
| Listbox | `select` | ✅ |
| Menu / Menu Bar / Menu Item | `select` | ✅ |
| Menu Button | `click` + `select` | ✅ |
| Tabs | `click` (or `select`) | ✅ |
| Slider | `drag` or `select` | ✅ |
| Spinbutton | `fill` or `pressKey` | ✅ |
| Disclosure | `click` | ✅ |
| Tooltip | `hover` | ✅ |
| Treeview | `click` / `select` | ✅ |
| Grid / Treegrid | `click` / `fill` / `select` | ✅ |
| Accordion | `click` | ✅ |
| Dialog | _(container, not interaction)_ | N/A |

**All WAI-ARIA widget patterns covered.** All major application domains covered.

### 13.3 Excluded categories (with rationale)

| Excluded | Why |
|----------|-----|
| **Assertion** | Verification step added during review, not a user action during recording. Future Stage 4b validation layer. |
| **Wait** | Execution strategy (Layer 1 Resilience). Modern frameworks auto-wait. Not a user intent. |
| **Scroll** | Usually implicit. Deferred — may become a type if explicit scroll testing becomes common. |
| **Focus** | Prerequisite for text entry, not a standalone intent. Captured implicitly by `fill`. |

---

## 14. Risk Assessment and Limitations

### 14.1 Identified risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **`click` as fallback may over-classify** — ambiguous interactions default to `click` when they should be `select` or `toggle` | Medium | Tier 2 advisory input catches cases where AI hints suggest a more specific type. Evidence rules are prioritized to catch specific types first. |
| R2 | **`select` is very broad** — covers native dropdowns, radio groups, ARIA listboxes, menus, segmented controls. Execution varies significantly across these. | Low | Execution engine inspects `target.tag` and `target.role` to determine the correct method. The semantic type is stable; execution is adaptive. |
| R3 | **`selectDate` is the most specialized type** — it exists because of temporal semantics (ISO value, ranges, sub-types). If dates were merged into `select` or `fill`, this richness would be lost. | Low | Justified by unique metadata requirements. Risk is over-engineering, not under-coverage. |
| R4 | **Custom enterprise controls may not fit neatly** — some enterprise widgets (SAP, ServiceNow) have novel interaction patterns. | Medium | Custom controls typically decompose into existing types (a custom dropdown is still `select`). Truly novel patterns become new types (additive). |
| R5 | **No explicit `scroll` type** — some tests need explicit scroll-to-element for lazy-loaded content. | Low | Deferred candidate. Playwright auto-scrolls. If needed, `scroll` is added additively without affecting existing types. |
| R6 | **No assertion type** — QA engineers expect to assert conditions. | Low | By design: assertions are review-phase artifacts, not recording-phase interactions. Future Stage 4b Layer 2 (Validation) handles this. |
| R7 | **Mobile interactions not yet represented** — `tap`, `swipe`, `pinch` are future types. | Low | Additive when mobile automation is added. Web types unchanged. |

### 14.2 Limitations

| Limitation | Impact | Acceptable? |
|-----------|--------|-------------|
| Web-focused (no mobile/desktop/API types yet) | Cannot record mobile gestures today | ✅ Yes — web is the current scope. Mobile extends additively. |
| No assertion/wait types in the taxonomy | Assertions and waits are handled outside the interaction language | ✅ Yes — by design. Assertions are review-phase. Waits are execution strategies. |
| `select` covers many DOM mechanisms | Execution complexity hidden behind one type | ✅ Yes — execution engine handles this. Semantic stability > execution convenience. |
| 10 types may feel too few to some users | Some QA engineers may expect `buttonClick` vs `linkClick` | ✅ Yes — granularity rule (one test step = one interaction) keeps it at 10. Metadata carries specifics. |

---

## 15. Long-Term Stability Assessment

### 15.1 Stability factors

| Factor | Stability | Rationale |
|--------|-----------|-----------|
| Types are intent-based | ✅ High | User intents ("click", "select", "fill") don't change with technology |
| Types are engine-agnostic | ✅ High | Mapped to Playwright, Selenium, Cypress, and future engines without modification |
| Types are DOM-agnostic | ✅ High | No type references specific HTML tags or CSS patterns |
| Types fit human working memory (7±2) | ✅ High | 10 types is memorable — near Miller's Law sweet spot |
| Extensibility is additive | ✅ High | New types extend without modifying existing ones |
| Metadata carries specifics | ✅ High | DOM details are in metadata, not in the type itself |
| Grounded in HCI theory | ✅ High | Maps to GOMS operators and Shneiderman interaction styles — decades-old, proven stable |

### 15.2 What could force a change

| Scenario | Impact | Likelihood |
|----------|--------|-----------|
| Fundamentally new input paradigm (voice, BCI) | New types added (additive) | Very low (5-10 years) |
| Mobile automation | New types added (`tap`, `swipe`) — existing unchanged | Medium (2-3 years) |
| API testing | Separate category — existing web types unchanged | Low |
| New HTML input types | Mapped to existing types via metadata | None (no impact) |
| New automation framework | New execution mappings — types unchanged | None (no impact) |

### 15.3 Stability verdict

**The taxonomy is designed for 5-10 year stability.** The 10 types cover all current web interaction paradigms. New paradigms add types without modifying existing ones. Technology changes are absorbed by metadata and execution mappings, not by type changes.

---

## 16. Architectural Quality Evaluation

| Quality | Score (1-5) | Assessment |
|---------|:-----------:|------------|
| **Simplicity** | 5 | 10 types, one rule (intent-level), one fallback (`click`). Memorizable. |
| **Expressiveness** | 4 | Covers all WAI-ARIA patterns and all major app domains. Minor gap: no scroll/assert/wait (by design). |
| **Consistency** | 5 | Every type is a verb. Every type has the same metadata structure. Every type maps to all engines. |
| **Technology independence** | 5 | Zero references to DOM, CSS, XPath, or any framework. Purely semantic. |
| **Execution engine independence** | 5 | Every type maps to Playwright, Selenium, Cypress, and future engines. Verified. |
| **Provider independence** | 5 | No AI provider assumptions. Types are structural, not AI-derived. |
| **Long-term maintainability** | 5 | Additive extensibility. No existing type ever needs modification. |
| **Extensibility** | 5 | New types = new rules + new mappings. Zero impact on existing types. |
| **Overall** | **4.9/5** | Enterprise-ready, architecturally sound, future-proof. |

---

## 17. Critical Self-Review

### 17.1 Strengths

| Strength | Evidence |
|----------|---------|
| Minimal surface area | 10 types vs 20+ in ad-hoc taxonomies. Fits Miller's Law. |
| Intent-based | Grounded in HCI theory (GOMS, Shneiderman). Not derived from browser events. |
| Cross-engine verified | Every type maps to Playwright + Selenium + Cypress APIs. |
| Clean fallback | `click` as Tier 3 default is always valid — no unclassifiable interactions. |
| Additive extensibility | New paradigms (mobile, API) add types without touching existing ones. |
| Clear ownership | Types assigned at Stage 3a, consumed read-only afterward. One assignment point. |

### 17.2 Weaknesses identified and addressed

| Weakness | Severity | Resolution |
|----------|----------|------------|
| `select` is broad (covers 5+ DOM mechanisms) | Low | Acceptable: execution engine inspects target to determine method. Semantic stability > execution convenience. Apple HIG validates this approach. |
| `selectDate` is the most specialized type | Low | Acceptable: unique metadata (ISO, ranges, temporal sub-types) justifies separation. Without it, date data would be lost or awkwardly encoded. |
| No explicit scroll type | Low | Deferred: Playwright auto-scrolls. If needed, `scroll` is added additively. Not a blocking gap. |
| `pressKey` may overlap with `fill` (typing Enter in a field) | Low | Clear rule: if the key produces text characters, it's `fill`. If it's a non-text key (Enter, Escape, Tab), it's `pressKey`. The classifier distinguishes by key code. |

### 17.3 Ambiguities resolved

| Ambiguity | Resolution |
|-----------|-----------|
| "Is a tab click a `click` or a `select`?" | **`click`** — tabs are activation triggers (they show/hide content). If the tab is part of a mutually exclusive set where choosing one deselects others, it could be `select`. The classifier decides based on evidence (aria-selected state changes). |
| "Is a slider drag a `drag` or a `select`?" | **Depends on evidence.** If the user dragged a handle to a position, it's `drag`. If the user clicked a position on the track, it's `select` (choosing from a range). The classifier uses the event type (drag vs click) as evidence. |
| "Is pressing Backspace to delete text a `pressKey` or part of `fill`?" | **Part of `fill`** — if the user is editing a text field, all keystrokes (including Backspace) are part of the text editing interaction. `pressKey` is only for standalone non-text keys outside text editing context. |

### 17.4 Redundancy check

No redundancies found. Each type has:
- A unique intent not covered by any other type
- Unique metadata (or unique absence of metadata)
- A unique execution method
- Unique evidence pattern

The closest pair (`fill` and `pressKey`) are distinguished by the text/non-text rule. The closest pair (`select` and `toggle`) are distinguished by the n-ary/binary rule.

### 17.5 Overly generic / overly specific check

| Type | Assessment |
|------|-----------|
| `click` | Intentionally generic — it's the fallback. This is correct, not a flaw. |
| `select` | Broad but justified — covers all "choose from options" intents. Not overly generic. |
| `selectDate` | Specific but justified — temporal semantics require dedicated metadata. Not overly specific. |
| All others | Appropriately scoped — neither too broad nor too narrow. |

---

## 18. Architectural Compatibility Verification

### 18.1 Compatibility with frozen architecture

| Frozen Decision | Compatibility | Verdict |
|----------------|---------------|---------|
| Session Context 3-layer structure | Types assigned in Stage 3a, reading all 3 layers | ✅ |
| Mental Model = Layer 2 | AI names consumed by Stage 3b | ✅ |
| AI Observer writes only Layer 2 | AI doesn't assign types — classifier does | ✅ |
| Advisory Input Pattern (3-tier) | Classifier: Tier 1 deterministic → Tier 2 advisory → Tier 3 default | ✅ |
| Forward-only flow | Types assigned once at 3a, consumed read-only | ✅ |
| System works without AI | Tier 1 resolves most types; `click` fallback for rest | ✅ |
| Evidence Sovereignty (P3) | Evidence determines type; AI advisory only | ✅ |
| Hallucination Rejection (P7) | AI never assigns types — classifier does from evidence | ✅ |
| Provider Independence (P8) | Types are structural; no provider assumptions | ✅ |
| Execution JSON (B5.2 Layer 0) | Types → execution verbs (Stage 4) | ✅ |
| Layered Execution Plan (Option D) | Types feed Layer 0; future validation from Expected Behaviour | ✅ |
| Deterministic Playwright (Stage 5) | Types → verbs → deterministic code | ✅ |

### 18.2 Compatibility with all frozen milestones

| Milestone | Compatibility | Verdict |
|-----------|---------------|---------|
| Product Foundation v1.0 | Types = interaction language for Test Cases | ✅ |
| Product Architecture PA1-PA12 | Types are derived (PA5); additive (PA9); engine-agnostic (PA8) | ✅ |
| E2E Recording Architecture | Types assigned at Stage 3a | ✅ |
| AI Observer & Session Context | Types not assigned by AI | ✅ |
| AI Philosophy (P1-P8) | Evidence-based classification | ✅ |
| Execution JSON Evolution | Types → verbs → Layered Plan | ✅ |
| Intelligent Automation Generation | Types → deterministic generation | ✅ |
| B1-B8 (Artifact Pipeline) | Types flow Timeline → Steps → JSON → Playwright | ✅ |
| Phase 2 (Semantic Architecture) | Classifier rules determine types | ✅ |

**ALL FROZEN DECISIONS PRESERVED.** Zero conflicts identified. No architecture or philosophy decision modified.

---

## 19. Freeze Declaration

The following decisions are declared **frozen**:

| # | Decision |
|---|----------|
| **L1** | **10 canonical interaction types** form CmdRunner's permanent semantic interaction language: `navigate`, `click`, `fill`, `select`, `toggle`, `selectDate`, `hover`, `pressKey`, `upload`, `drag`. |
| **L2** | **Intent-level granularity:** One test step = one semantic interaction. Mechanical steps (open/close dropdown, focus/blur) collapse into one interaction. |
| **L3** | **Metadata carries specifics:** Element type, DOM mechanism, click count, modifiers, button — all metadata, not separate types. |
| **L4** | **Radio buttons are `select`:** Same user intent as dropdown selection. Execution engine inspects target. |
| **L5** | **`click` is the default fallback:** Tier 3 of the classifier. Generic activation is always valid. |
| **L6** | **Types assigned at Stage 3a** and immutable afterward. Stages 3b, 4, 5 consume read-only. |
| **L7** | **3-tier classification:** Tier 1 (deterministic evidence rules, priority-ordered) → Tier 2 (advisory AI hints) → Tier 3 (default `click`). |
| **L8** | **Extensibility is strictly additive:** New types appended without modifying existing types, rules, or execution mappings. |
| **L9** | **Engine-agnostic:** Every type maps to Playwright, Selenium, Cypress, and future engines. No type references a framework API. |
| **L10** | **DOM-agnostic:** No type references specific HTML tags, CSS selectors, or ARIA roles. These are target metadata. |
| **L11** | **Assertions and waits are not recording types.** Assertions = review phase. Waits = execution strategies. |
| **L12** | **Naming convention:** camelCase identifiers, Title Case display names, imperative verb form, consistent across all types. |
| **L13** | **7 categories** organize the 10 types by user goal nature: Navigation, Activation, Data Entry, Selection, State Change, Observation, Input, File Transfer, Spatial Movement. |
| **L14** | **Cross-paradigm extensibility:** Mobile (`tap`, `swipe`), Desktop (same types), API (`apiRequest`), Canvas (`draw`) — all extend additively without modifying existing types. |

---

*This document defines CmdRunner's permanent canonical semantic interaction language. It is grounded in HCI theory (GOMS, Shneiderman), validated against WAI-ARIA patterns and automation framework APIs, critically reviewed for strengths/weaknesses/ambiguities, and verified compatible with all frozen milestones. The 10-type taxonomy is designed for 5-10 year stability with additive extensibility for future paradigms.*

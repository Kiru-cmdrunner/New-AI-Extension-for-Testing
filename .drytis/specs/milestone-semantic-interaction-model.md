# Milestone — Semantic Interaction Model & Canonical Interaction Taxonomy

**Status:** Design milestone — validated and frozen  
**Date:** 2026-07-17  
**Scope:** Canonical semantic interaction model — the permanent interaction language of CmdRunner  
**Constraint:** Greenfield design. No reference to prior interaction types. No architecture changes. No AI philosophy changes. All frozen milestones preserved.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [What Is a Semantic Interaction?](#2-what-is-a-semantic-interaction)
3. [Design Principles](#3-design-principles)
4. [Canonical Interaction Taxonomy](#4-canonical-interaction-taxonomy)
5. [Interaction Granularity](#5-interaction-granularity)
6. [Architectural Justification for Each Type](#6-architectural-justification-for-each-type)
7. [Canonical Naming Conventions](#7-canonical-naming-conventions)
8. [Interaction Metadata Model](#8-interaction-metadata-model)
9. [Interaction Lifecycle Through the Architecture](#9-interaction-lifecycle-through-the-architecture)
10. [Relationship with Stage 3a and Stage 3b](#10-relationship-with-stage-3a-and-stage-3b)
11. [Extensibility Strategy](#11-extensibility-strategy)
12. [Completeness Review](#12-completeness-review)
13. [Long-Term Stability Assessment](#13-long-term-stability-assessment)
14. [Architectural Compatibility Verification](#14-architectural-compatibility-verification)
15. [Freeze Declaration](#15-freeze-declaration)

---

## 1. Executive Summary

### Verdict

A canonical semantic interaction model of **10 interaction types across 7 categories** is **validated and frozen** as CmdRunner's permanent interaction language. This model is technology-independent, execution-engine-independent, provider-independent, and designed to remain stable for years.

### The 10 Canonical Types

| # | Type | Category | One-Line Description |
|---|------|----------|---------------------|
| 1 | `navigate` | Navigation | User navigated to a URL or page |
| 2 | `click` | Activation | User activated an element |
| 3 | `fill` | Data Entry | User entered or edited text |
| 4 | `select` | Selection | User chose a value from a set of options |
| 5 | `toggle` | State Change | User changed a binary on/off state |
| 6 | `selectDate` | Data Entry | User selected a date, time, or date-time value |
| 7 | `hover` | Observation | User moved pointer over an element to trigger UI changes |
| 8 | `pressKey` | Input | User pressed a specific key or key combination |
| 9 | `upload` | File Transfer | User provided files to the application |
| 10 | `drag` | Spatial Movement | User moved an element from one location to another |

### Design philosophy

> **A semantic interaction represents user intent, not DOM mechanics.** Each type answers "what did the user try to accomplish?" — not "what browser event fired?" The taxonomy is small enough to be memorable, expressive enough to cover modern web applications, and stable enough to outlast every execution framework.

---

## 2. What Is a Semantic Interaction?

### 2.1 Definition

A **semantic interaction** is the representation of a single, meaningful user intent during a recording session. It is:

- **Intent-based:** Captures what the user tried to accomplish, not how the browser processed it
- **Committed:** Represents a completed action, not an intermediate mechanical step
- **Technology-independent:** Does not reference DOM tags, CSS selectors, XPath, or execution APIs
- **Stable:** Remains valid regardless of the underlying browser, framework, or automation engine
- **Self-describing:** Carries enough metadata to be executed without additional context

### 2.2 What a semantic interaction is NOT

| Not This | Why | What It Is Instead |
|----------|-----|-------------------|
| A browser event (click, change, mouseenter) | Events are mechanical; many events may produce one interaction | A semantic type derived from event evidence |
| A DOM operation (querySelector, dispatchEvent) | DOM operations are implementation details | Invisible to the semantic model |
| A Playwright command (page.click, locator.fill) | Playwright is one execution engine | One possible execution of the semantic type |
| A UI element (button, dropdown, checkbox) | Elements are targets, not actions | Metadata on the interaction (target) |
| An execution action (action verb in JSON) | Execution actions are derived from semantic types | Stage 4 maps semantic types to execution verbs |

### 2.3 The litmus test

A candidate is a semantic interaction if and only if:

1. **It represents a distinct user intent** that a QA engineer would describe in one test step
2. **It requires different execution** from all other types (different Playwright/Selenium method)
3. **It produces different evidence** during recording (different DOM signals, different state changes)
4. **It remains meaningful** without reference to a specific DOM structure or browser API

If a candidate fails any of these tests, it is metadata on an existing type, not a new type.

---

## 3. Design Principles

### 3.1 The six design principles

| # | Principle | Description |
|---|-----------|-------------|
| DP1 | **Intent over mechanism** | Types represent what the user meant to do, not how the browser processed it |
| DP2 | **Committed result** | A type captures the final outcome, not intermediate steps (e.g., "Select Economy" not "Open dropdown → Click Economy → Close dropdown") |
| DP3 | **Minimal surface** | The smallest set of types that covers all meaningful interactions. If two candidates have the same intent, they are one type |
| DP4 | **Execution-agnostic** | A type does not assume Playwright, Selenium, or any specific engine. The execution engine inspects the target to determine mechanics |
| DP5 | **Additive extensibility** | New types are added without modifying existing types or the taxonomy structure |
| DP6 | **Test-step language** | Every type maps to natural language a QA engineer would write ("Click the Login button", "Select Economy from Cabin Class") |

### 3.2 Why these principles matter

These principles ensure the taxonomy remains stable as technology evolves:

- **DP1 (Intent)** means types survive DOM changes, framework migrations, and browser updates
- **DP2 (Committed)** means multi-step mechanical sequences collapse into one semantic unit
- **DP3 (Minimal)** means engineers can memorize the full taxonomy — it's 10 types, not 50
- **DP4 (Execution-agnostic)** means Playwright, Selenium, Cypress, and future engines all consume the same types
- **DP5 (Additive)** means new capabilities extend without breaking existing recordings
- **DP6 (Test-step)** means the types are intuitive to QA professionals, not just engineers

---

## 4. Canonical Interaction Taxonomy

### 4.1 Taxonomy overview

```
CANONICAL INTERACTION TAXONOMY
│
├── NAVIGATION
│   └── navigate
│
├── ACTIVATION
│   └── click
│
├── DATA ENTRY
│   ├── fill
│   └── selectDate
│
├── SELECTION
│   └── select
│
├── STATE CHANGE
│   └── toggle
│
├── OBSERVATION
│   └── hover
│
├── INPUT
│   └── pressKey
│
├── FILE TRANSFER
│   └── upload
│
└── SPATIAL MOVEMENT
    └── drag
```

### 4.2 Category definitions

| Category | Purpose | Types |
|----------|---------|-------|
| **Navigation** | Moving between pages or URLs | `navigate` |
| **Activation** | Triggering an operation or action | `click` |
| **Data Entry** | Providing structured data to the application | `fill`, `selectDate` |
| **Selection** | Choosing a value from a set of options | `select` |
| **State Change** | Changing a binary condition | `toggle` |
| **Observation** | Inspecting UI without activating | `hover` |
| **Input** | Non-textual keyboard input | `pressKey` |
| **File Transfer** | Providing files to the application | `upload` |
| **Spatial Movement** | Relocating an element on the screen | `drag` |

### 4.3 The 10 types in detail

---

#### 1. `navigate`

**Category:** Navigation

**Description:** The user navigated to a different page or URL.

**What it captures:** A page-level transition — the URL changed, either through clicking a link, submitting a form that redirects, or direct URL entry.

**What it does NOT capture:** In-page scrolling, tab switching within a SPA (unless the URL changes), modal opening (that's a `click`).

**Metadata:** `url` (target URL), `title` (page title)

**Test-step language:** "Navigate to the dashboard" / "Go to the login page"

**Execution mapping:** Playwright `page.goto(url)`, Selenium `driver.get(url)`

**Why first-class:** Navigation is the only interaction that changes the page context. Every other interaction operates within a page. Without a dedicated type, navigations would be lost or misclassified as clicks.

**Why not metadata on `click`:** Navigations can occur without a click (redirect, URL bar entry, form submission). And the target of a navigation is a URL, not a DOM element.

---

#### 2. `click`

**Category:** Activation

**Description:** The user activated an element to trigger an operation.

**What it captures:** A single, committed activation of an interactive element — buttons, links, icons, tabs, disclosure triggers, non-select widgets that respond to pointer activation.

**What it does NOT capture:** Selecting an option from a dropdown (that's `select`), checking a checkbox (that's `toggle`), entering text (that's `fill`).

**Metadata:** Standard target identity. No type-specific value — the intent is activation itself.

**Test-step language:** "Click the Submit button" / "Click the Profile icon"

**Execution mapping:** Playwright `locator.click()`, Selenium `element.click()`

**Why first-class:** Activation is the most common user interaction. It is the default intent when no more specific type applies.

**Why the catch-all is correct:** The `click` type is the fallback in the classifier's priority chain. When evidence rules for select, toggle, fill, selectDate, hover, etc. do not match, the interaction is classified as `click`. This is architecturally correct — generic activation is always a valid interpretation of a pointer event.

---

#### 3. `fill`

**Category:** Data Entry

**Description:** The user entered or edited text in an input field.

**What it captures:** Text committed to a text-editable element — `<input type="text">`, `<textarea>`, `[contenteditable]`, search inputs, password fields, number inputs (when typed, not spun).

**What it does NOT capture:** Date input via text (that's `selectDate`), selecting from a dropdown (that's `select`), pressing a non-text key (that's `pressKey`).

**Metadata:** `value` (the entered text)

**Test-step language:** "Enter 'admin@example.com' in the Email field" / "Type 'Hello World' in the comment box"

**Execution mapping:** Playwright `locator.fill(value)`, Selenium `element.sendKeys(value)`

**Why first-class:** Text entry is the second most common interaction after click. It has a clear value payload that no other type carries the same way. It requires a fundamentally different execution method (input simulation, not click simulation).

**Why not metadata on `click`:** Text entry has no activation event — the user focuses, types, and blurs. The committed value is the interaction, not a click.

---

#### 4. `select`

**Category:** Selection

**Description:** The user chose a value from a set of options.

**What it captures:** A committed selection from a list of choices — native `<select>` dropdowns, ARIA listboxes, ARIA comboboxes, ARIA menus, menu items, radio groups, segmented controls, and any control where the user picks one value from multiple visible or expandable options.

**What it does NOT capture:** Binary on/off choices (that's `toggle`), date selection (that's `selectDate`), free-text entry (that's `fill`).

**Metadata:** `value` (the selected option's display text or value)

**Test-step language:** "Select 'Economy' from the Cabin Class dropdown" / "Choose 'Credit Card' as the payment method" / "Select the 'Male' option"

**Execution mapping:** Depends on target — Playwright `locator.selectOption()` for native `<select>`, `locator.check()` for radio buttons, `locator.click()` for ARIA listbox/menu items. The execution engine inspects the target to determine the method.

**Why first-class:** Selection from a set is a fundamentally different intent from activation or text entry. The user is choosing from constrained options, not entering free text or activating a trigger. The value payload is a choice from a known set, not arbitrary input.

**Why radio buttons are `select` not a separate type:** Radio button selection is semantically "choose one from a mutually exclusive set" — identical to dropdown selection. The DOM mechanism differs (radio input vs select element), but the user intent is the same. The execution engine inspects the target to determine whether to use `.check()` or `.selectOption()`. Having a separate `choose` type would split identical user intents across two types, violating DP3 (Minimal Surface).

---

#### 5. `toggle`

**Category:** State Change

**Description:** The user changed a binary on/off state.

**What it captures:** A committed state flip — checkboxes (`<input type="checkbox">`), toggle switches (`role="switch"`), ARIA toggle buttons (`aria-pressed`), and any control that transitions between exactly two states.

**What it does NOT capture:** Selecting from 3+ options (that's `select`), activating a button that performs an action (that's `click`).

**Metadata:** `checked` (boolean — the resulting state: true = on, false = off)

**Test-step language:** "Check the 'Accept Terms' checkbox" / "Turn off email notifications" / "Toggle the dark mode switch"

**Execution mapping:** Playwright `locator.check()` / `locator.uncheck()`, Selenium `element.click()` (toggles state)

**Why first-class:** Binary state change has a fundamentally different intent from activation or selection. The user is flipping a condition, not choosing from options or triggering an operation. The `checked` boolean is unique metadata that no other type carries.

**Why not merged with `click`:** A toggle has a direction (on → off or off → on) that a generic click does not. The test step language differs ("Check" vs "Click"). The execution API differs (`.check()` / `.uncheck()` vs `.click()`). And the evidence pattern differs (state change evidence vs activation evidence).

---

#### 6. `selectDate`

**Category:** Data Entry

**Description:** The user selected a date, time, or date-time value.

**What it captures:** A committed temporal value selection — native date/time/datetime-local/month/week inputs, calendar grid pickers, time pickers, and any control where the user chooses a point or range in time.

**What it does NOT capture:** Typing a date as free text into a generic input without date semantics (that's `fill`), selecting a non-temporal value (that's `select`).

**Metadata:** `value` (display value, e.g., "July 18, 2026"), `isoValue` (ISO 8601, e.g., "2026-07-18"), `dateType` (sub-type: date, dateRange, time, dateTime, month, week), optional range fields (`rangeStart`, `rangeEnd`).

**Test-step language:** "Select departure date 'July 18, 2026'" / "Choose check-in and check-out dates" / "Set the time to 2:30 PM"

**Execution mapping:** Playwright `locator.fill(isoValue)` for native inputs, `locator.click()` for calendar cells. The execution engine inspects the target to determine the method.

**Why first-class:** Dates have unique semantic properties that no other type handles:
- Dual representation (display value + ISO value)
- Range selection (two dates as one interaction)
- Temporal sub-types (date, time, datetime, month, week)
- Complex mechanical patterns (calendar grids, wheel pickers)

Merging dates into `select` or `fill` would lose the ISO value, range semantics, and temporal sub-typing. The complexity of date interaction justifies a dedicated type.

---

#### 7. `hover`

**Category:** Observation

**Description:** The user moved the pointer over an element, triggering a UI change.

**What it captures:** A pointer dwell that produced an observable effect — menu reveals, tooltip displays, card previews, drag handle appearance, image zoom.

**What it does NOT capture:** Hovering with no observable effect (not recorded — the user did not accomplish anything), clicking after hovering (that's a separate `click`).

**Metadata:** Standard target identity. Optional `dwellTime` (how long the pointer remained), `revealedElements` (what UI changes the hover produced).

**Test-step language:** "Hover over the 'Account' menu" / "Hover over the product image to see the quick view"

**Execution mapping:** Playwright `locator.hover()`, Selenium `actions.moveToElement(element).perform()`

**Why first-class:** Hover is the only interaction where the intent is to observe, not to activate. No value is entered, no state is changed, no option is selected. The purpose is to trigger a visual change. This unique intent and its unique execution method (hover, not click) justify a separate type.

---

#### 8. `pressKey`

**Category:** Input

**Description:** The user pressed a specific key or key combination.

**What it captures:** Non-textual keyboard input — Enter, Escape, Tab, Arrow keys, Backspace, Delete, and modifier combinations (Ctrl+S, Cmd+K, Shift+Tab).

**What it does NOT capture:** Typing characters into a text field (that's `fill`).

**Metadata:** `key` (the key or key combination, e.g., "Enter", "Escape", "Control+Shift+S")

**Test-step language:** "Press Enter to submit" / "Press Escape to close the dialog" / "Press Ctrl+S to save"

**Execution mapping:** Playwright `locator.press(key)` or `page.keyboard.press(key)`, Selenium `element.sendKeys(Keys.ENTER)`

**Why first-class:** Key presses serve intents that are neither text entry nor activation:
- Enter to submit (intent: submit, not click)
- Escape to close (intent: dismiss, not click)
- Tab to navigate (intent: move focus, not click)
- Ctrl+S to save (intent: shortcut, not click)

These are distinct user actions with distinct test-step language and distinct execution. They cannot be represented as `fill` (no text value) or `click` (no element activation).

---

#### 9. `upload`

**Category:** File Transfer

**Description:** The user provided one or more files to the application.

**What it captures:** A committed file provision — `<input type="file">` with files selected, drag-and-drop file upload, or any file picker interaction.

**What it does NOT capture:** Dragging a non-file element (that's `drag`).

**Metadata:** `files` (array of file names or paths)

**Test-step language:** "Upload the file 'report.pdf'" / "Attach photos 'photo1.jpg' and 'photo2.jpg'"

**Execution mapping:** Playwright `locator.setInputFiles(paths)`, Selenium `element.sendKeys(filePath)`

**Why first-class:** File upload is the only interaction where the payload is external data (a file), not text or a choice. The execution method is entirely unique (`setInputFiles`). No other type represents "provide a file to the application."

---

#### 10. `drag`

**Category:** Spatial Movement

**Description:** The user moved an element from one location to another.

**What it captures:** A committed spatial relocation — Kanban card moves, sortable list reordering, slider handle drags (when the intent is spatial, not value selection), element repositioning.

**What it does NOT capture:** Dragging a file to upload (that's `upload`), clicking an element (that's `click`).

**Metadata:** `source` (the dragged element), `target` (the drop target), optional `position` (coordinates or relative position)

**Test-step language:** "Drag the 'Task A' card to the 'Done' column" / "Move the slider to 75%"

**Execution mapping:** Playwright `sourceLocator.dragTo(targetLocator)` or manual mouse events, Selenium `actions.dragAndDrop(source, target).perform()`

**Why first-class:** Drag is the only interaction involving two elements (source and target) and spatial movement. The intent is to relocate, not to activate or select. The execution method is entirely unique (drag sequence). No other type represents "move this thing there."

---

## 5. Interaction Granularity

### 5.1 The abstraction level question

The milestone asks whether CmdRunner should expose:
- `click` (one type)
- vs `buttonClick`, `linkClick`, `iconClick` (multiple types)

And whether dropdown should be:
- `select` (one interaction)
- vs `openDropdown` → `selectOption` → `closeDropdown` (three interactions)

### 5.2 Recommendation: Intent-level granularity

**The correct abstraction level is user intent — what a QA engineer writes in one test step.**

| Question | Answer | Rationale |
|----------|--------|-----------|
| Button click vs Link click vs Icon click? | **One type: `click`** | The intent is identical ("activate this"). The element type is metadata (target.tag, target.role), not a separate type. DP3 (Minimal Surface). |
| Open dropdown → Select option → Close dropdown? | **One interaction: `select`** | The committed result is the selection. Opening/closing are mechanical steps. DP2 (Committed Result). |
| Check checkbox → (state changes)? | **One interaction: `toggle`** | The committed result is the state change. The click is the mechanism. |
| Fill field → (text entered)? | **One interaction: `fill`** | The committed result is the text value. Focus/blur are mechanical. |
| Hover → (menu appears) → Click menu item? | **Two interactions: `hover` + `select`** | These are two distinct user intents with two distinct committed results. |

### 5.3 The granularity rule

> **One test step = one semantic interaction.** If a QA engineer would write it as one step in a test case, it is one interaction. If they would write it as two steps, it is two interactions.

| What the QA engineer writes | Interactions |
|---------------------------|-------------|
| "Click the Login button" | 1 × `click` |
| "Select 'Economy' from Cabin Class" | 1 × `select` |
| "Enter 'admin' in the Username field" | 1 × `fill` |
| "Hover over the Account menu, then click Sign Out" | 1 × `hover` + 1 × `click` |
| "Upload 'report.pdf'" | 1 × `upload` |
| "Drag the card to the Done column" | 1 × `drag` |

### 5.4 What goes into metadata vs. what becomes a new type

| Candidate | Decision | Rationale |
|-----------|----------|-----------|
| "Was it a double-click?" | **Metadata** on `click` (`clickCount: 2`) | Same intent (activate), different mechanical detail |
| "Was it a right-click?" | **Metadata** on `click` (`button: 'right'`) | Still activation, different button |
| "Was it a Shift+Click?" | **Metadata** on `click` (`modifiers: ['Shift']`) | Still activation with a modifier |
| "Was it a checkbox or a switch?" | **Metadata** on `toggle` (`target.tag`, `target.role`) | Same intent (binary state change), different element type |
| "Was it a native select or an ARIA listbox?" | **Metadata** on `select` (`target.tag`, `target.role`) | Same intent (choose from options), different DOM mechanism |
| "Was it a calendar picker or a native date input?" | **Metadata** on `selectDate` (`target.tag`, `target.role`) | Same intent (select a date), different DOM mechanism |
| "Was it pressing Enter or pressing Escape?" | **Different values** of `pressKey` (`key: 'Enter'` vs `key: 'Escape'`) | Same type, different value |

---

## 6. Architectural Justification for Each Type

### 6.1 Justification matrix

For each type, four questions are answered:

| Type | Why does it exist? | Why first-class (not metadata)? | Why not merged? | Why not split? |
|------|-------------------|-------------------------------|-----------------|----------------|
| `navigate` | Only interaction that changes page context | Target is a URL, not a DOM element | Can occur without click (redirect) | — |
| `click` | Generic activation — the default user intent | Unique evidence (no value change, no state change) | — (it IS the fallback) | Element type is metadata, not type |
| `fill` | Text entry with a value payload | Has `value` metadata unique to text entry | Text entry ≠ activation (different event, different execution) | Field type is metadata |
| `select` | Choosing from constrained options | Value is a choice from a known set, not arbitrary input | Selection ≠ text entry (constrained vs free-form) | DOM mechanism is metadata |
| `toggle` | Binary state change | Has `checked` boolean, unique to binary state | State flip ≠ value selection (binary vs n-ary) | — |
| `selectDate` | Temporal value selection | Has ISO value, date sub-types, range semantics | Dates ≠ generic selection (ISO, ranges, temporal types) | Date sub-type is metadata |
| `hover` | Observation without activation | No value, no state change — just UI reveal | Hover ≠ click (no activation, different execution) | — |
| `pressKey` | Non-text keyboard input | Has `key` value, no text payload | Key press ≠ text entry (no text value, different intent) | Key name is the value |
| `upload` | File provision | Payload is external files, not text or choice | File ≠ text (external data vs typed input) | — |
| `drag` | Spatial element relocation | Has source + target (two elements) | Drag ≠ click (two elements, spatial movement) | — |

### 6.2 Technology independence verification

| Type | Playwright | Selenium | Cypress | Future Engine |
|------|-----------|----------|---------|---------------|
| `navigate` | `page.goto()` | `driver.get()` | `cy.visit()` | `engine.navigate(url)` |
| `click` | `locator.click()` | `element.click()` | `cy.click()` | `engine.activate(target)` |
| `fill` | `locator.fill()` | `element.sendKeys()` | `cy.type()` | `engine.enterText(target, value)` |
| `select` | `selectOption()` / `check()` / `click()` | `select()` / `click()` | `cy.select()` / `cy.click()` | `engine.chooseValue(target, value)` |
| `toggle` | `locator.check()` / `uncheck()` | `element.click()` | `cy.check()` / `cy.uncheck()` | `engine.setBinaryState(target, on)` |
| `selectDate` | `locator.fill()` / `click()` | `element.sendKeys()` / `click()` | `cy.type()` / `cy.click()` | `engine.selectTemporal(target, isoValue)` |
| `hover` | `locator.hover()` | `actions.moveToElement()` | `cy.trigger('mouseover')` | `engine.dwell(target)` |
| `pressKey` | `locator.press()` | `element.sendKeys(Keys.X)` | `cy.type('{enter}')` | `engine.pressKey(key)` |
| `upload` | `setInputFiles()` | `element.sendKeys(path)` | `cy.attachFile()` | `engine.provideFiles(target, files)` |
| `drag` | `dragTo()` | `actions.dragAndDrop()` | `cy.drag()` | `engine.moveElement(source, target)` |

**Every type maps cleanly to all four engines.** No type is Playwright-specific or Selenium-specific.

---

## 7. Canonical Naming Conventions

### 7.1 Type identifier naming

| Convention | Rule | Example |
|-----------|------|---------|
| Format | camelCase | `selectDate`, `pressKey` |
| Tense | Imperative verb or verb phrase | `fill`, `navigate`, `upload` |
| Length | 1-2 words | `click`, `selectDate` |
| Specificity | Intent-level, not mechanism-level | `toggle` not `checkboxChange` |

### 7.2 Display name naming

| Convention | Rule | Example |
|-----------|------|---------|
| Format | Title Case verb phrase | "Select Date", "Press Key" |
| Badge format | Short label for UI | "SELECT DATE", "PRESS KEY" |

### 7.3 Full naming table

| Type ID | Display Name | Badge Label | Plain English Template |
|---------|-------------|-------------|----------------------|
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

---

## 8. Interaction Metadata Model

### 8.1 Universal metadata (all types)

```typescript
interface InteractionMetadata {
  // ── Identity ──
  type: InteractionType;             // one of the 10 types
  actionId: string;                  // unique ID for this interaction

  // ── Target ──
  target: ElementIdentity;           // 18-field element identity (frozen)

  // ── Temporal ──
  timestamp: string;                 // ISO timestamp

  // ── Evidence (from Stage 3a classification) ──
  evidence: {
    valueType: 'value-change' | 'state-change' | 'navigation' | 'activation' | 'spatial' | 'file' | 'key' | 'dwell';
    beforeValue: string | null;
    afterValue: string | null;
    domMutations: string[] | null;   // summarized mutations observed
    classificationTier: 1 | 2 | 3;   // which classifier tier resolved this
  };

  // ── AI Enrichment (from Mental Model, optional) ──
  ai?: {
    businessName: string | null;     // AI-provided semantic name
    confidence: number;              // 0.0 - 1.0
  };
}
```

### 8.2 Type-specific metadata

| Type | Additional Fields | Description |
|------|------------------|-------------|
| `navigate` | `url: string`, `title: string` | Target URL and page title |
| `click` | _(none — activation is self-describing)_ | |
| `fill` | `value: string` | The entered text |
| `select` | `value: string` | The selected option's display text |
| `toggle` | `checked: boolean` | Resulting state (true = on) |
| `selectDate` | `value: string`, `isoValue: string`, `dateType: DateSubType`, optional `rangeStart/value/iso`, `rangeEnd/value/iso` | Display value, ISO value, temporal sub-type, range fields |
| `hover` | `dwellTime?: number`, `revealedElements?: string[]` | How long hovered, what appeared |
| `pressKey` | `key: string` | The key or key combination |
| `upload` | `files: string[]` | File names or paths |
| `drag` | `dropTarget: ElementIdentity`, optional `position?: { x: number, y: number }` | Where the element was dropped |

### 8.3 The type/metadata separation principle

> **The interaction type defines WHAT the user intended. Metadata defines the SPECIFICS of that intent.**

- Type = "select" (user chose from options)
- Metadata = target (which dropdown), value (which option), evidence (how we know)

Changing metadata does not change the type. Changing the type means the user's intent was fundamentally different.

---

## 9. Interaction Lifecycle Through the Architecture

### 9.1 Full lifecycle

```
BROWSER DOM EVENT(S)
  │  (click, change, focus, blur, mouseenter, keydown, etc.)
  │
  ▼
DETERMINISTIC RECORDER (Stage 2)
  │  Captures: event type, target element, value before/after,
  │            state changes, DOM mutations
  │  Appends to: Session Context Layer 3 (Action History, immutable)
  │
  ▼
STATE TRACKER (Stage 2)
  │  Updates: Session Context Layer 1 (current DOM state)
  │
  ▼
AI OBSERVER (Stage 2)
  │  Reads: Layer 1 (state) + Layer 3 (actions)
  │  Writes: Session Context Layer 2 (Mental Model)
  │  Provides: business names, workflow context, confidence
  │
  ▼
─── STOP RECORDING ───
  │
  ▼
SEMANTIC CLASSIFIER (Stage 3a)
  │  Input: Layer 3 (evidence) + Layer 1 (context) + Layer 2 (advisory)
  │  Process: 3-tier decision (deterministic → advisory → default)
  │  Output: Each raw action is assigned a SEMANTIC TYPE
  │           (navigate, click, fill, select, toggle, etc.)
  │
  ▼
CANONICAL STEP GENERATOR (Stage 3b)
  │  Input: Typed interactions + Layer 2 element names
  │  Process: Apply plain English templates, readability optimization
  │  Output: Canonical Test Steps (each step has a type + metadata)
  │
  ▼
EXECUTION JSON GENERATOR (Stage 4)
  │  Input: Canonical Test Steps
  │  Process: Map semantic type → execution verb + locator resolution
  │  Output: Execution JSON (each step has action, target, locators)
  │
  ▼
AUTOMATION GENERATOR (Stage 5)
  │  Input: Execution JSON
  │  Process: Map execution verb → engine-specific code
  │  Output: Playwright / Selenium / Cypress test code
  │
  ▼
EXECUTABLE TEST
```

### 9.2 Where types are created vs. where metadata is added

| Stage | What Happens | Type Assignment? | Metadata? |
|-------|-------------|-----------------|-----------|
| Stage 2 (Recording) | Raw events captured with DOM evidence | ❌ Not yet | Raw evidence only |
| Stage 3a (Classification) | Evidence rules assign semantic type | ✅ **YES — types created here** | Evidence from recording |
| Stage 3b (Step Generation) | Plain English + readability optimization | ❌ Already assigned | AI names added, steps numbered |
| Stage 4 (Execution JSON) | Type → execution verb mapping | ❌ Read-only | Locators, execution strategy |
| Stage 5 (Automation) | Execution verb → code | ❌ Read-only | Engine-specific code |

**Key:** Semantic types are assigned exactly once — at Stage 3a. They never change after assignment. All downstream stages consume the type read-only.

---

## 10. Relationship with Stage 3a and Stage 3b

### 10.1 Stage 3a — Semantic Classification

**Responsibility:** Determine which semantic type each captured interaction is.

**Input:**
- Action History (Layer 3): raw events with evidence
- Deterministic State (Layer 1): ancestor context, open UI elements
- Mental Model (Layer 2): advisory hints (Tier 2 only)

**Output:** Each action in the Timeline is annotated with a semantic type.

**Classification process (3-tier):**

```
TIER 1 — DETERMINISTIC EVIDENCE RULES (always runs first)
  │
  │  Rules in priority order (highest specificity first):
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
  │
  │  Mental Model (Layer 2) consulted for context.
  │  AI may suggest a type with confidence ≥ threshold.
  │  If AI and evidence agree → type confirmed.
  │  If AI suggests something evidence missed → consider.
  │
  ▼ (if Tier 2 is ambiguous or unavailable)
TIER 3 — DEFAULT FALLBACK
  │
  │  Assign: click
  │  (Generic activation is always a valid interpretation)
```

**Rule:** The classifier never invents types outside the canonical taxonomy. The 10 types are the complete set.

### 10.2 Stage 3b — Canonical Step Generation

**Responsibility:** Transform typed interactions into human-readable Canonical Test Steps.

**Input:** Typed Interaction Timeline + Mental Model element names

**Process:**
1. Apply plain English template for each interaction type (see §7.3)
2. Apply readability optimization (merge related steps — e.g., focus + fill → one step)
3. Number steps sequentially
4. Link each step to its source interaction

**Output:** Canonical Test Steps

**Stage 3b does NOT change types.** It renders them in human-readable form.

### 10.3 Separation of concerns

| Concern | Stage 3a | Stage 3b |
|---------|----------|----------|
| Assigns semantic type? | ✅ YES | ❌ No |
| Determines plain English? | ❌ No | ✅ YES |
| Merges steps? | ❌ No | ✅ YES (readability) |
| Adds element names? | ❌ No | ✅ YES (from Mental Model) |
| Numbers steps? | ❌ No | ✅ YES |

---

## 11. Extensibility Strategy

### 11.1 How new types are added

A new semantic type is added when a user intent exists that:
1. Cannot be represented by any existing type
2. Requires a different execution method
3. Produces different evidence during recording
4. Would be written as a distinct test step by a QA engineer

**Addition process:**
1. Define the new type identifier, display name, and plain English template
2. Add classification rule(s) to Stage 3a (additive — new rule, no existing rule changes)
3. Add type-specific metadata fields
4. Add execution verb mapping to Stage 4
5. Add engine-specific code template to Stage 5

**No existing type is modified.** New types are purely additive.

### 11.2 Future type candidates

| Candidate | Category | Why It Might Be Needed | Priority |
|-----------|----------|----------------------|----------|
| `scroll` | Navigation | Explicit scrolling for lazy-loaded content | Medium — often implicit |
| `assert` | Verification | Inline assertions during recording | Low — assertions belong in review |
| `wait` | Synchronization | Explicit wait for async operations | Low — handled by Execution JSON Layer 1 |
| `tap` | Activation (mobile) | Touch interaction on mobile web | Future — mobile automation |
| `swipe` | Spatial (mobile) | Touch swipe gesture | Future — mobile automation |
| `pinch` | Spatial (mobile) | Touch pinch-to-zoom | Future — mobile automation |
| `draw` | Spatial (canvas) | Canvas drawing interaction | Future — canvas automation |
| `authenticate` | Browser | Login/authentication flow | Low — usually multi-step fill+click |

### 11.3 Extensibility guarantees

| Guarantee | How It's Enforced |
|-----------|-------------------|
| New types don't break existing recordings | Existing types are never renumbered, renamed, or removed |
| New types don't change the classifier | New rules are appended; existing rule priorities don't change |
| New types don't change execution of existing types | New execution mappings are added; existing mappings are untouched |
| New types don't change the metadata model | New type-specific fields are additive; universal metadata is unchanged |

---

## 12. Completeness Review

### 12.1 Coverage by application domain

| Domain | Key Interactions | All Covered? |
|--------|-----------------|:------------:|
| **Banking** | Login, transfer, statement download, form filling | ✅ (fill, click, navigate, select) |
| **E-commerce** | Search, add to cart, checkout, filter, sort | ✅ (fill, click, select, toggle) |
| **Healthcare** | Patient forms, appointment booking, record access | ✅ (fill, select, selectDate, click) |
| **SaaS** | Dashboard, settings, team management, CRUD | ✅ (click, fill, select, toggle, navigate) |
| **HR Systems** | Leave application, profile editing, report generation | ✅ (fill, select, selectDate, toggle, click) |
| **Travel** | Flight search, date selection, seat selection, booking | ✅ (fill, select, selectDate, click) |
| **Content Management** | Rich text editing, media upload, drag-and-drop | ✅ (fill, upload, drag, click) |
| **Project Management** | Kanban boards, task creation, drag-and-drop | ✅ (fill, drag, click, select) |

### 12.2 Coverage by WAI-ARIA widget pattern

| ARIA Pattern | Semantic Type | Covered? |
|-------------|--------------|:--------:|
| Button | `click` | ✅ |
| Link | `click` | ✅ |
| Checkbox | `toggle` | ✅ |
| Switch | `toggle` | ✅ |
| Radio Group | `select` | ✅ |
| Combobox | `select` | ✅ |
| Listbox | `select` | ✅ |
| Menu / Menu Bar | `select` | ✅ |
| Menu Button | `click` + `select` | ✅ |
| Tabs | `click` (or `select`) | ✅ |
| Slider | `select` or `drag` | ✅ |
| Spinbutton | `fill` or `pressKey` | ✅ |
| Disclosure | `click` | ✅ |
| Dialog | _(container, not interaction)_ | N/A |
| Tooltip | `hover` | ✅ |
| Treeview | `click` / `select` | ✅ |
| Grid / Treegrid | `click` / `fill` / `select` | ✅ |
| Accordion | `click` | ✅ |

**All WAI-ARIA widget patterns are covered.**

### 13.3 Missing interaction categories assessment

| Candidate | Decision | Rationale |
|-----------|----------|-----------|
| **Assertion** | **Not a recording type** | Assertions are verification steps added during review, not user actions during recording. Future Stage 4b validation layer handles this. |
| **Wait** | **Not a recording type** | Modern automation frameworks auto-wait. Explicit waits are execution strategies (Layer 1 Resilience), not user intents. |
| **Scroll** | **Deferred** | Usually implicit (Playwright auto-scrolls). May become a type if lazy-loading testing becomes common. |
| **Focus** | **Not a type** | Focus is a prerequisite for text entry, not a standalone intent. Captured implicitly by `fill`. |

---

## 13. Long-Term Stability Assessment

### 13.1 Stability factors

| Factor | Stability | Rationale |
|--------|-----------|-----------|
| Types are intent-based | ✅ High | User intents ("click", "select", "fill") don't change with technology |
| Types are engine-agnostic | ✅ High | Mapped to Playwright, Selenium, Cypress, and future engines without modification |
| Types are DOM-agnostic | ✅ High | No type references specific HTML tags or CSS patterns |
| Types are minimal | ✅ High | 10 types is small enough to be stable; no churn from too many types |
| Extensibility is additive | ✅ High | New types extend without modifying existing ones |
| Metadata carries specifics | ✅ High | DOM details are in metadata, not in the type itself |

### 13.2 What could force a change

| Scenario | Impact | Likelihood |
|----------|--------|-----------|
| A fundamentally new input paradigm (brain-computer, voice) | New types added (e.g., `speak`, `think`) — existing types unchanged | Very low (5-10 years) |
| Mobile automation | New types added (e.g., `tap`, `swipe`, `pinch`) — existing types unchanged | Medium (2-3 years) |
| API testing | Separate API interaction category — existing web types unchanged | Low |
| AI-generated UI | Same interaction types — AI UI still uses buttons, dropdowns, etc. | — (no impact) |
| New HTML input types | Mapped to existing types via metadata — no new types needed | — (no impact) |

### 13.3 Stability verdict

**The taxonomy is designed for 5-10 year stability.** The 10 types cover all current web interaction paradigms. New paradigms (mobile, API) add types without modifying existing ones. Technology changes (new frameworks, new browsers, new HTML elements) are absorbed by metadata, not by type changes.

---

## 14. Architectural Compatibility Verification

### 14.1 Compatibility with frozen architecture

| Frozen Decision | Compatibility | Verdict |
|----------------|---------------|---------|
| Session Context 3-layer structure | Semantic types are assigned in Stage 3a, which reads all 3 layers | ✅ |
| Mental Model = Layer 2 | AI element names consumed by Stage 3b for plain English | ✅ |
| AI Observer writes only Layer 2 | AI doesn't assign types — classifier does (Stage 3a) | ✅ |
| Advisory Input Pattern (3-tier) | Classifier uses 3-tier: deterministic → advisory → default(click) | ✅ |
| Forward-only information flow | Types assigned at 3a, consumed read-only by 3b→4→5 | ✅ |
| System works without AI | Tier 1 (deterministic) resolves most types; `click` fallback for rest | ✅ |
| Evidence Sovereignty (P3) | Evidence determines type; AI is advisory only | ✅ |
| Hallucination Rejection (P7) | AI never assigns types — classifier does from evidence | ✅ |
| Provider Independence (P8) | Types are structural; no provider assumptions | ✅ |
| Execution JSON (B5.2 Layer 0) | Types map to execution verbs (Stage 4) | ✅ |
| Layered Execution Plan (Option D) | Types feed Layer 0; future validation from Expected Behaviour | ✅ |
| Deterministic Playwright (Stage 5) | Types → execution verbs → deterministic code | ✅ |

### 14.2 Compatibility with frozen milestones

| Milestone | Compatibility | Verdict |
|-----------|---------------|---------|
| Product Foundation v1.0 | Semantic types become the interaction language for Test Cases | ✅ |
| Product Architecture PA1-PA12 | Types are derived artifacts (PA5); additive (PA9); engine-agnostic (PA8) | ✅ |
| E2E Recording Architecture | Types assigned at Stage 3a, consumed by 3b→4→5 | ✅ |
| AI Observer & Session Context | Types not assigned by AI — assigned by deterministic classifier | ✅ |
| AI Philosophy (P1-P8) | Evidence-based classification (P1, P3); AI advisory only (P3, P5) | ✅ |
| Execution JSON Evolution | Types → execution verbs → Layered Plan | ✅ |
| Intelligent Automation Generation | Types → deterministic generation; AI enriches, doesn't generate | ✅ |
| B1-B8 (Artifact Pipeline) | Types flow through Timeline → Steps → JSON → Playwright | ✅ |
| Phase 2 (Semantic Architecture) | Classifier rules determine types from evidence | ✅ |

**ALL FROZEN DECISIONS PRESERVED.** The semantic interaction model operates entirely within the existing architecture. No component, ownership, boundary, lifecycle, or information flow is modified.

---

## 15. Freeze Declaration

The following decisions are declared **frozen**:

| # | Decision |
|---|----------|
| **T1** | **10 canonical interaction types** form CmdRunner's permanent semantic interaction language: `navigate`, `click`, `fill`, `select`, `toggle`, `selectDate`, `hover`, `pressKey`, `upload`, `drag`. |
| **T2** | **Intent-level granularity:** Each type represents one user intent that a QA engineer would write as one test step. Mechanical steps (open dropdown, click option, close dropdown) collapse into one interaction. |
| **T3** | **Metadata carries specifics:** Element type (button/link/icon), DOM mechanism (native select/ARIA listbox), and modifiers (double-click, right-click, Shift+click) are metadata, not separate types. |
| **T4** | **Radio buttons are `select`:** Radio selection is semantically identical to dropdown selection — "choose one from a set." The execution engine inspects the target to determine the method. |
| **T5** | **`click` is the default fallback:** When no specific evidence rule matches, the interaction is classified as `click`. Generic activation is always valid. |
| **T6** | **Types are assigned at Stage 3a** and are immutable afterward. Stages 3b, 4, and 5 consume types read-only. |
| **T7** | **The classifier uses a 3-tier decision process:** Tier 1 (deterministic evidence rules, priority-ordered), Tier 2 (advisory AI hints when Tier 1 is ambiguous), Tier 3 (default fallback to `click`). |
| **T8** | **Extensibility is strictly additive:** New types are appended without modifying existing types, rules, or execution mappings. Existing recordings remain valid. |
| **T9** | **The taxonomy is engine-agnostic:** Every type maps to Playwright, Selenium, Cypress, and future engines. No type references a specific framework's API. |
| **T10** | **The taxonomy is DOM-agnostic:** No type references specific HTML tags, CSS selectors, or ARIA roles. These are in the target metadata. |
| **T11** | **Assertions and waits are not recording types.** Assertions are added during review. Waits are execution strategies (Layer 1 Resilience). |
| **T12** | **Naming convention:** camelCase identifiers (`selectDate`), Title Case display names ("Select Date"), imperative verb form. |

---

*This document defines CmdRunner's permanent canonical semantic interaction model. It is consistent with all frozen milestones (E2E Architecture, AI Observer, Session Context, Mental Model, AI Philosophy, Product Architecture PA1-PA12, B1-B8). No architecture or philosophy decision is modified. The 10-type taxonomy is designed for 5-10 year stability with additive extensibility for future paradigms.*

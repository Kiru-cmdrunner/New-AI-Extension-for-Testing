# Post-B8 Planning — Capability Prioritization

**Type:** Engineering Roadmap (planning only — no implementation)
**Status:** FROZEN
**Date:** 2026-07-15
**Scope:** Assesses all Partially Supported and Not Yet Implemented capabilities and recommends implementation priority and milestone grouping.

---

## Table of Contents

1. [Capability Assessment Matrix](#1-capability-assessment-matrix)
2. [Prioritized Implementation Backlog](#2-prioritized-implementation-backlog)
3. [Dependency Analysis](#3-dependency-analysis)
4. [Recommended Implementation Milestones](#4-recommended-implementation-milestones)
5. [Architectural Review](#5-architectural-review)
6. [Validation Impact](#6-validation-impact)
7. [Risks and Assumptions](#7-risks-and-assumptions)

---

## 1. Capability Assessment Matrix

### Assessment Scale

Each capability is scored on six dimensions, each rated 1 (low) to 5 (high):

| Dimension | 1 | 3 | 5 |
|---|---|---|---|
| **User Value** | Nice to have | Useful | Blocks common workflows |
| **App Frequency** | Rare | Common | Near-universal |
| **Enterprise Importance** | Edge case | Standard testing | Critical for enterprise |
| **Technical Complexity** | Trivial (existing infra) | Moderate (new logic) | Hard (new infra/patterns) |
| **Architectural Fit** | No changes needed | Minor extension | Potential conflict |
| **Regression Risk** | None | Low-Medium | High (affects core path) |

**Priority Score** = User Value + App Frequency + Enterprise Importance (max 15).
**Cost Score** = Technical Complexity + Regression Risk (max 10).
**Value/Cost Ratio** = Priority / Cost. Higher = better ROI.

### Matrix

| # | Capability | Status | User Value | App Frequency | Enterprise Importance | Priority (max 15) | Tech Complexity | Regression Risk | Cost (max 10) | Ratio |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Checkbox/Radio Toggle** | NYI | 5 | 5 | 5 | **15** | 2 | 1 | 3 | **5.0** |
| 2 | **Dropdown/Select (native)** | Partial | 4 | 5 | 5 | **14** | 2 | 1 | 3 | **4.7** |
| 3 | **Hover Recording** | NYI | 3 | 4 | 3 | **10** | 3 | 2 | 5 | **2.0** |
| 4 | **File Upload** | NYI | 3 | 3 | 4 | **10** | 4 | 1 | 5 | **2.0** |
| 5 | **iframe Context (deep nesting)** | Partial | 3 | 3 | 3 | **9** | 3 | 2 | 5 | **1.8** |
| 6 | **Shadow DOM Locators** | Partial | 2 | 3 | 3 | **8** | 3 | 2 | 5 | **1.6** |
| 7 | **Right-click/Double-click** | NYI | 2 | 3 | 2 | **7** | 2 | 1 | 3 | **2.3** |
| 8 | **Date Picker** | NYI | 2 | 3 | 3 | **8** | 4 | 1 | 5 | **1.6** |
| 9 | **Keyboard Shortcuts** | NYI | 2 | 2 | 2 | **6** | 3 | 2 | 5 | **1.2** |
| 10 | **Drag-and-Drop** | NYI | 2 | 2 | 3 | **7** | 5 | 3 | 8 | **0.9** |
| 11 | **Scroll Recording** | NYI | 1 | 2 | 1 | **4** | 2 | 1 | 3 | **1.3** |
| 12 | **Rich Text Editor** | NYI | 1 | 2 | 2 | **5** | 5 | 2 | 7 | **0.7** |
| 13 | **OR-3 Duplicate Click** | NYI | 1 | 2 | 1 | **4** | 2 | 1 | 3 | **1.3** |

---

## 2. Prioritized Implementation Backlog

Sorted by Value/Cost Ratio (highest ROI first):

| Rank | Capability | Priority | Effort | Risk | Rationale |
|---|---|---|---|---|---|
| **1** | **Checkbox/Radio Toggle** | **Critical** | Small | Low | Near-universal in web forms. Currently captured as generic clicks — the toggle state is lost. Highest user value (15/15). Minimal new code: new interaction type config + `change` event listener. No architectural change. |
| **2** | **Dropdown/Select (native)** | **Critical** | Small | Low | Universal in enterprise apps. Currently Partially Supported — SELECT text captured via blur, but option selection isn't modeled. Extending the existing text-entry pattern to capture `change` events on SELECT elements is straightforward. |
| **3** | **Right-click/Double-click** | **High** | Small | Low | Double-click has semantic meaning in file managers, tables, and desktop-like UIs. Implementation is a small extension to click-content-script (`dblclick` and `contextmenu` event listeners). No new interaction type needed — augment click config with variant detection. |
| **4** | **Hover Recording** | **High** | Medium | Medium | Required for tooltip verification, menu hover states, and drag-and-drop initiation. Removed in v2.2.0 reset — must be rebuilt with the new architecture (data-cmdrunner-handled ownership, identity extraction). Moderate complexity: new content script + interaction type. |
| **5** | **File Upload** | **Medium** | Medium | Low | Important for enterprise testing (document management, CMS). Chrome extension API provides `chrome.debugger` for file input, but this is architecturally heavy. Alternative: capture the file input click + use Playwright's `setInputFiles()` in generation. Medium effort. |
| **6** | **iframe Context (deep nesting)** | **Medium** | Medium | Medium | Current implementation handles single-level iframes. Deeply nested iframes (iframe within iframe) need recursive `frameLocator()` chains. Moderate risk: changes to iframe path construction in click/text content scripts. |
| **7** | **Shadow DOM Locators** | **Medium** | Medium | Medium | Click capture works via `composedPath()`. Gap is in locator resolution — Shadow elements produce CSS selectors relative to shadow root, not document root. Playwright's `>>` pierce notation is needed. Medium effort. |
| **8** | **Date Picker** | **Medium** | Large | Low | Calendar widgets are highly variable (jQuery UI, React-DatePicker, MUI DatePicker, custom). Each renders dates as different DOM structures. Playwright generation must produce `.click()` sequences for the calendar grid. Large effort per widget library; risk of fragmentation. |
| **9** | **Keyboard Shortcuts** | **Low** | Medium | Medium | Enterprise apps increasingly use keyboard shortcuts (Cmd+K, etc.). Requires `keydown` listener with modifier key detection. Medium risk: must not interfere with normal text entry recording. |
| **10** | **Scroll Recording** | **Low** | Small | Low | Scroll events are noisy. Would require debouncing and relevance filtering (scroll to element vs. scroll past content). Low enterprise value — Playwright tests rarely need explicit scroll steps. |
| **11** | **OR-3 Duplicate Click Removal** | **Low** | Small | Low | Provisional readability rule. Cannot safely distinguish accidental duplicates from intentional double-clicks. Marginal readability benefit. Defer until double-click detection (#3) is implemented — then OR-3 can use double-click awareness to make safe decisions. |
| **12** | **Drag-and-Drop** | **Low** | Large | High | Complex gesture (mousedown → mousemove → mouseup). Requires tracking mouse movement between down and up. Playwright uses `.dragTo()` or manual mouse events. High regression risk — mousemove listeners can interfere with click detection. |
| **13** | **Rich Text Editor** | **Low** | Large | Medium | Rich text editors (Quill, TinyMCE, CKEditor) use complex internal DOM trees. `contenteditable` text capture works (blur-based), but formatting commands (bold, italic, insert image) are not modeled. Each editor has a different API. Very large effort for narrow use case. |

---

## 3. Dependency Analysis

### Dependency Graph

```
Checkbox/Radio Toggle (independent)
    │
    ├── no dependencies

Dropdown/Select native (independent)
    │
    ├── no dependencies

Right-click/Double-click (independent)
    │
    ├── no dependencies

Hover Recording (independent)
    │
    ├── no dependencies (rebuilt from scratch)

File Upload
    │
    ├── depends on: File input click detection (already works via click recording)
    └── optional: Playwright setInputFiles() support

iframe Deep Nesting
    │
    ├── depends on: Existing single-level iframe capture (works)
    └── extends: iframeContext field to support nested paths

Shadow DOM Locators
    │
    ├── depends on: Existing composedPath() capture (works)
    └── extends: Locator Resolution Engine + Playwright Generator for >> syntax

Date Picker
    │
    ├── depends on: Click recording (works)
    ├── depends on: Hover recording (#4) — some date pickers open on hover
    └── depends on: Text entry (works) — some date pickers accept typed dates

Keyboard Shortcuts
    │
    ├── depends on: Text entry recording (must not conflict)
    └── extends: interaction-types.ts with keydown handler

OR-3 Duplicate Click Removal
    │
    ├── depends on: Double-click detection (#3)
    └── extends: readability-optimizer.ts

Drag-and-Drop
    │
    ├── depends on: Hover/Mouse tracking (#4 partially)
    └── extends: New interaction type + Playwright dragTo() mapping

Rich Text Editor
    │
    ├── depends on: contenteditable capture (partially works)
    ├── depends on: Keyboard shortcut recording (#9) for formatting commands
    └── extends: interaction-types.ts for editor-specific commands
```

### Key Dependency Chains

1. **OR-3 depends on Double-click** (#3): OR-3 cannot safely remove duplicate clicks until it can distinguish them from intentional double-clicks. Implement double-click first.

2. **Date Picker partially depends on Hover** (#4): Some date pickers (e.g., jQuery UI datepicker) reveal calendar days on hover. However, most modern date pickers (React, Angular) use click-based navigation, so this dependency is partial.

3. **Rich Text Editor depends on Keyboard Shortcuts** (#9): Rich text formatting (Ctrl+B, Ctrl+I) requires keyboard event capture. Without it, only plain text entry into `contenteditable` is possible.

---

## 4. Recommended Implementation Milestones

### Milestone C1 — Toggle & Select Interactions

| Field | Value |
|---|---|
| **Capabilities** | Checkbox/Radio Toggle (#1), Dropdown/Select native (#2) |
| **Priority** | Critical |
| **Why grouped** | Both are form-input state changes captured via `change` events. They share the same recording pattern (event listener on `change`), the same interaction type structure (value + checked state), and the same Playwright mapping (`.check()`, `.uncheck()`, `.selectOption()`). Implementing them together creates a complete form-control recording story. |
| **Effort** | Small-Medium |
| **Risk** | Low |
| **Dependencies** | None — fully independent of other capabilities |
| **Validation Scope** | W1 (Auth — remember me checkbox), W3 (CRUD — create form with dropdowns), W4 (Form Entry — checkboxes, radios, selects), W10 (Dropdowns) |

**Deliverables:**
- New interaction type: `toggle` (checkbox/radio)
- New interaction type: `select` (dropdown option)
- Content script: `change` event listener for checkboxes, radios, SELECT elements
- Interaction type configs with `toPlainEnglish()`: `Check "Remember Me"`, `Select "USA" from "Country"`
- Execution JSON: `action.type` extended with `check`, `uncheck`, `selectOption`
- Playwright mapping: `.check()`, `.uncheck()`, `.selectOption()`
- Readability optimizer: OR-1 extended to handle select clicks (click on SELECT + select option → merge)
- Full test suite + regression

### Milestone C2 — Advanced Click Variants

| Field | Value |
|---||
| **Capabilities** | Right-click/Double-click (#3) |
| **Priority** | High |
| **Why standalone** | Double-click and right-click are click variants, not new interaction types. They augment the existing click recording with event variant detection. Best implemented as a focused extension to click-content-script.ts. |
| **Effort** | Small |
| **Risk** | Low |
| **Dependencies** | None |
| **Validation Scope** | W5 (Tables — double-click to edit cell), W3 (CRUD — right-click context menu), extended scenarios |

**Deliverables:**
- Click variant detection: `dblclick` and `contextmenu` event listeners in click-content-script
- Interaction type extension: click config with `variant: 'double' \| 'right' \| 'single'`
- Plain English: `Double-click "File"`, `Right-click "Row"`
- Execution JSON: `action.type` remains `click`, `action.variant` field added
- Playwright mapping: `.dblclick()`, `.click({ button: 'right' })`
- Full test suite + regression

### Milestone C3 — Hover Interaction

| Field | Value |
|---|
| **Capabilities** | Hover Recording (#4) |
| **Priority** | High |
| **Why standalone** | Hover requires a new content script (like click and text entry) with mouseenter/mouseleave detection. It was removed in v2.2.0 and must be rebuilt with the new architecture (data-cmdrunner-handled ownership, isRecording async check, identity extraction). |
| **Effort** | Medium |
| **Risk** | Medium (mouse event handling can interfere with click detection) |
| **Dependencies** | None |
| **Validation Scope** | W2 (Search — hover suggestions), W12 (Navigation — hover menus), extended scenarios |

**Deliverables:**
- New content script: hover-content-script.ts
- New interaction type: `hover`
- Hover detection with debounce (avoid noise from rapid mouse movement)
- Identity extraction (same pattern as click)
- Plain English: `Hover over "Menu Item"`
- Execution JSON: `action.type: "hover"`
- Playwright mapping: `.hover()`
- Full test suite + regression

### Milestone C4 — Frame & Shadow DOM Enhancements

| Field | Value |
|---|
| **Capabilities** | iframe Deep Nesting (#6), Shadow DOM Locators (#7) |
| **Priority** | Medium |
| **Why grouped** | Both are locator/context enhancements to existing capture mechanisms. Click and text recording already work inside iframes and Shadow DOM — the gap is in locator resolution and Playwright generation. Grouping them addresses the full "embedded content" problem. |
| **Effort** | Medium |
| **Risk** | Medium (changes to locator resolution and Playwright generation) |
| **Dependencies** | None (builds on existing composedPath and iframe detection) |
| **Validation Scope** | W14 (Shadow DOM), W15 (iFrames), extended scenarios |

**Deliverables:**
- iframe: Recursive frame path construction for nested iframes
- iframe: Playwright `frameLocator().frameLocator()` chain generation
- Shadow DOM: CSS selector with Shadow pierce notation
- Shadow DOM: Playwright `locator('host >> inner')` generation
- Locator Resolution Engine: Extended to produce Shadow-aware locators
- Full test suite + regression

### Milestone C5 — File Upload

| Field | Value |
|---|
| **Capabilities** | File Upload (#5) |
| **Priority** | Medium |
| **Why standalone** | File upload has a unique challenge: the browser's native file dialog cannot be recorded by a content script. The implementation must capture the file input click and generate Playwright's `setInputFiles()` without knowing the actual file path (the user selects it manually). |
| **Effort** | Medium |
| **Risk** | Low (isolated from core recording path) |
| **Dependencies** | Click recording (works — file input clicks captured) |
| **Validation Scope** | W7 (File Upload), extended CRUD scenarios |

**Deliverables:**
- File input detection: `input[type="file"]` click captured with special handling
- Interaction type: `fileUpload`
- Execution JSON: `action.type: "uploadFile"`, placeholder for file path
- Playwright mapping: `setInputFiles()` with placeholder path
- UI: Prompt user to specify file path during review (not during recording)
- Full test suite + regression

### Deferred Milestones (Not Recommended for Near-Term)

| Milestone | Capabilities | Why Deferred |
|---|---|---|
| **C6 — Date Picker** | Date Picker (#8) | High variability across widget libraries. Each calendar component has a different DOM structure. Would require per-library adapters. Defer until there is a concrete enterprise need. |
| **C7 — Keyboard Shortcuts** | Keyboard Shortcuts (#9) | Niche use case. Risk of interfering with text entry recording. Defer until there is a concrete enterprise need. |
| **C8 — Drag-and-Drop** | Drag-and-Drop (#10) | High complexity, high regression risk. Complex gesture tracking. Defer until there is a concrete enterprise need. |
| **C9 — Rich Text Editor** | Rich Text Editor (#12) | Very high complexity. Each editor (Quill, TinyMCE, CKEditor) has a different internal API. Defer indefinitely unless a specific enterprise customer requires it. |
| **C10 — Scroll** | Scroll (#11) | Low enterprise value. Scroll events are noisy. Defer indefinitely. |

---

## 5. Architectural Review

### Capabilities That Fit Within the Existing Architecture (No Changes Needed)

| Capability | Why It Fits |
|---|---|
| Checkbox/Radio Toggle | Same pattern as text entry: `change` event listener → ElementIdentity → TEXT_CAPTURED-like message → interaction type config. New action type `check`/`uncheck` in Execution JSON. Playwright `.check()`/`.uncheck()`. |
| Dropdown/Select | Same pattern: `change` event on SELECT → selected option text. New action type `selectOption`. Playwright `.selectOption()`. |
| Right-click/Double-click | Augment existing click recording with `dblclick`/`contextmenu` listeners. Same interaction type (`click`), new `variant` field. Playwright `.dblclick()`, `.click({ button: 'right' })`. |
| Hover | New content script following the click-content-script pattern. New interaction type. No change to pipeline — follows Milestone 2 architecture exactly. |
| File Upload | Click on `input[type="file"]` already captured. Extend interaction type to detect file inputs. Playwright `setInputFiles()`. |
| Scroll | `scroll` event listener + debounce. New interaction type. Low architectural impact. |

### Capabilities That Require Minor Extension (No Conflict)

| Capability | What Extends | Impact |
|---|---|---|
| iframe Deep Nesting | `iframeContext` field in ElementIdentity → extend to array of frame paths. Playwright Generator → nested `frameLocator()` chain. | Minor: existing field gets richer data. No new field or pipeline stage. |
| Shadow DOM Locators | Locator Resolution Engine → extend CSS selector builder to include Shadow pierce notation. Playwright Generator → extend translateLocator for Shadow syntax. | Minor: existing functions get additional logic. No new pipeline stage. |
| Keyboard Shortcuts | New content script + interaction type. Text entry content script must exclude modifier-key combinations. | Minor: existing text-entry script gets an exclusion filter. |
| OR-3 Duplicate Click | readability-optimizer.ts → implement applyRuleOR3(). Depends on double-click detection from C2. | Minor: existing hook gets code. No structural change. |

### Capabilities That May Require Architectural Discussion

| Capability | Concern | Mandatory or Avoidable? |
|---|---|---|
| **Date Picker** | Calendar widgets are not a single interaction — they are a sequence of clicks on a grid of date cells. The question is whether to model this as N click events (existing) or as a single `selectDate` interaction (new type). If new type: requires a way to detect "this click was inside a date picker" — which requires framework-specific knowledge. | **Avoidable.** Model date picker interactions as individual clicks (existing capability). The Playwright test will contain the correct click sequence. A `selectDate` interaction type would be a convenience, not a necessity. |
| **Drag-and-Drop** | Drag-and-drop is a compound gesture (mousedown → mousemove → mouseup). It does not fit the single-event recording model (click, text, hover). Options: (a) model as three separate events, (b) detect drag gesture and create a single `drag` interaction. Option (b) requires a new gesture-detection layer in the content script. | **Avoidable for now.** Defer until there is a concrete enterprise need. If implemented, option (b) would require a new gesture-detection pattern not present in the current architecture. |
| **Rich Text Editor** | Rich text editors expose formatting commands via internal APIs (Quill: `editor.format()`, CKEditor: `editor.execute()`). These are not DOM events — they are JavaScript function calls. Capturing them would require editor-specific instrumentation. | **Avoidable.** Defer indefinitely. Plain text capture into `contenteditable` works (text entry on blur). Rich text formatting is not modeled. |

### Architectural Consistency Confirmation

| Frozen Decision | Impact from Recommended Milestones |
|---|---|
| Product Foundation: Canonical Test Steps as editable source of truth | New interaction types add new step types. Source of truth model unchanged. |
| Product Architecture: Pipeline Timeline → Steps → JSON → Playwright | No new pipeline stages. New interaction types flow through the existing pipeline. |
| B2 AP3: Pure function generators | New action types are pure mappings (e.g., `check` → `.check()`). No side effects. |
| B4.4: Locator Priority Strategy | New interaction types use existing locator resolution. No change to priority hierarchy. |
| B5.2: Execution JSON Contract | New `action.type` values added (`check`, `selectOption`, `hover`). Contract structure (action/target/locators/context/trace/meta) unchanged. |
| B7.1: Readability Strategy | OR-1 may extend to SELECT clicks (click on dropdown + select option → merge). The optimization rule structure is unchanged — same eligibility conditions apply. |

**No mandatory architectural changes are required for any recommended milestone (C1–C5).** All five milestones fit within the existing frozen architecture. Extensions are additive (new interaction types, new action mappings, new event listeners) — they do not modify existing contracts or pipeline stages.

---

## 6. Validation Impact

### B8 Framework Updates After Each Milestone

| Milestone | Capability Status Changes | New Validation Categories |
|---|---|---|
| C1 (Toggle & Select) | Checkbox/Radio: NYI → **Supported**. Dropdown/Select: Partial → **Supported** | W4 expanded (checkbox/radio validation), W10 expanded (full select option recording) |
| C2 (Click Variants) | Right-click/Double-click: NYI → **Supported** | New: Double-click scenarios in W5, W6 |
| C3 (Hover) | Hover: NYI → **Supported** | New: Hover menu/navigation scenarios |
| C4 (Frame & Shadow) | iframe: Partial → **Supported**. Shadow DOM: Partial → **Supported** | W14, W15 promoted from Extended to Critical |
| C5 (File Upload) | File Upload: NYI → **Supported** | W7 promoted from Extended to Critical |

### Regression Suite Expansion

After each milestone, the regression suite (REG-1 through REG-5) should be reviewed:

| Milestone | Regression Suite Changes |
|---|---|
| C1 | REG-1 (Login) may add a "Remember Me" checkbox. REG-3 (CRUD create) adds dropdown selections. |
| C2 | REG-4 (Table filter) may add a double-click to edit scenario. |
| C3 | No regression suite change — hover is additive. |
| C4 | REG-5 (Modal) may add an iframe scenario if the modal loads content in an iframe. |
| C5 | No regression suite change — file upload is additive. |

---

## 7. Risks and Assumptions

### Implementation Risks

| # | Risk | Milestone | Mitigation |
|---|---|---|---|
| R1 | Checkbox/radio `change` events may not fire on custom toggle components (React Switch, MUI Toggle) | C1 | Validate against React, Vue, and Angular toggle components. If custom components don't fire native `change`, fall back to click event detection with state inference. |
| R2 | Hover recording may capture excessive noise (every element the mouse passes over) | C3 | Implement hover target filtering (only capture hover on elements with `[role="tooltip"]`, `[data-toggle]`, or known hover-responsive patterns). Alternatively, capture all hovers and let the user delete irrelevant ones during review. |
| R3 | Shadow DOM CSS selectors may be fragile (React Shadow components frequently re-render) | C4 | Use `data-cmdrunner-handled` ownership pattern already in click recording. For locator stability, prefer `role` + accessible name locators when available. |
| R4 | File upload placeholder path may confuse users | C5 | Clear UI guidance: "File path placeholder — replace with actual path before running test." |
| R5 | Double-click detection may interfere with single-click recording | C2 | Use a short debounce: wait 300ms after click before committing. If a second click arrives within 300ms, reclassify as double-click. |

### Assumptions

| # | Assumption | Impact if Wrong |
|---|---|---|
| A1 | Checkbox/radio `change` events fire consistently across frameworks | If wrong: custom toggle components won't be captured. Fallback: click event + state inference. |
| A2 | Native SELECT `change` event fires reliably | Very high confidence — this is standard browser behavior. |
| A3 | Hover recording will be used sparingly (not for every mouse movement) | If wrong: timeline becomes noisy. Mitigation: filtering + user deletion during review. |
| A4 | Most enterprise testing needs are covered by click + text + toggle + select + navigation | If wrong: additional capabilities (drag-drop, rich text) may need to be prioritized sooner. |
| A5 | Playwright supports all required action mappings (`.check()`, `.selectOption()`, `.hover()`, `.dblclick()`) | High confidence — these are all standard Playwright APIs. |

---

## Summary

### Recommended Implementation Order

| Order | Milestone | Capabilities | Priority | Effort | Risk |
|---|---|---|---|---|---|
| **1** | **C1 — Toggle & Select** | Checkbox/Radio, Dropdown/Select | Critical | Small-Medium | Low |
| **2** | **C2 — Click Variants** | Double-click, Right-click | High | Small | Low |
| **3** | **C3 — Hover** | Hover Recording | High | Medium | Medium |
| **4** | **C4 — Frame & Shadow** | iframe Deep Nesting, Shadow DOM Locators | Medium | Medium | Medium |
| **5** | **C5 — File Upload** | File Upload | Medium | Medium | Low |
| **Deferred** | C6–C10 | Date Picker, Keyboard, Drag-Drop, Scroll, Rich Text | Low | Large | Varies |

### Why This Order

1. **C1 first** because checkboxes, radios, and dropdowns are universal in forms. Every enterprise app has them. The implementation is low-risk because it follows the existing text-entry pattern (event listener → identity → interaction type → generator). Highest ROI (ratio 5.0 and 4.7).

2. **C2 second** because double-click and right-click are small extensions to the existing click recording. No new content script needed — just additional event listeners. Quick win.

3. **C3 third** because hover is required for tooltip and menu testing. It's a medium-effort rebuild (removed in v2.2.0), but the pattern is well-established (same as click recording with different events).

4. **C4 fourth** because iframe and Shadow DOM enhancements improve locator quality for existing capture mechanisms. They don't add new interaction types — they improve the quality of existing ones.

5. **C5 fifth** because file upload is a specific enterprise need that can be addressed with a focused implementation. Playwright's `setInputFiles()` makes the generation side straightforward.

6. **C6–C10 deferred** because they are either low-value (scroll), high-risk (drag-and-drop), or high-effort with narrow use cases (rich text editor, date picker). They should be revisited when there is a concrete enterprise customer requirement.

---

## Freeze Declaration

This document is **FROZEN** as of 2026-07-15. It defines the capability prioritization and engineering roadmap for CmdRunner's remaining interaction capabilities.

This is a planning document. No implementation changes are made. No product or architecture decisions are modified. The recommended milestones (C1–C5) are engineering recommendations — each milestone will have its own product spec, architecture spec, and implementation before work begins.

---

*End of Post-B8 Planning — Capability Prioritization*

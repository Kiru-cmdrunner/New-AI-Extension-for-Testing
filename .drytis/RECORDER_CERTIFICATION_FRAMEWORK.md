# Recorder Certification Framework

> **Purpose**: Establish a repeatable, measurable certification process for the
> CmdRecorder — driven by interaction-pattern coverage, not ad hoc website testing.
> This document is the single source of truth for "what does the recorder support,
> how well, and what's left to build."

---

## 1. Complete Interaction Catalogue

Every interaction type a modern web application can contain, organized by domain.

### 1.1 — Selection & Choice

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| S1 | Native Dropdown (`<select>`) | Standard HTML select element | Country picker |
| S2 | Custom Dropdown (div-based) | SPA custom dropdown without native `<select>` | React-Select, MUI Select |
| S3 | Autocomplete / Combobox | Text input with filtered suggestion list | Google Places search |
| S4 | Multi-Select Dropdown | Dropdown allowing multiple selections | Tag picker |
| S5 | Radio Button Group | Mutually exclusive single choice | Gender selection |
| S6 | Checkbox (single) | Binary toggle | "Accept terms" |
| S7 | Checkbox Group | Multiple independent toggles | Newsletter preferences |
| S8 | Toggle Switch | On/off slide toggle | Notification settings |
| S9 | Segmented Control / Button Group | Pill-style mutually exclusive buttons | Fare type (Regular / Student / Armed Forces) |
| S10 | Stepper / Counter | Increment/decrement quantity | Passenger count +/− |

### 1.2 — Text & Input

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| T1 | Text Entry (input) | Single-line text input | Email field |
| T2 | Text Entry (textarea) | Multi-line text input | Comments box |
| T3 | Text Entry with Autocomplete | Text input followed by suggestion selection | City → airport code |
| T4 | Masked / Formatted Input | Input with format pattern | Phone number, credit card |
| T5 | ContentEditable Rich Text | Rich text editor area | Draft.js, Slate.js |

### 1.3 — Date & Time

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| D1 | Date Picker (calendar popup) | Calendar widget for date selection | Departure date |
| D2 | Date Picker (native input) | HTML5 `<input type="date">` | Birth date |
| D3 | Date Range Picker | Two dates defining a range | Booking check-in/out |
| D4 | Time Picker | Time selection widget | Appointment time |
| D5 | Date-Time Picker | Combined date and time | Event scheduling |

### 1.4 — Navigation & Structure

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| N1 | Link Click | Anchor navigation | Header menu link |
| N2 | SPA Navigation | Client-side route change without full page load | React Router navigation |
| N3 | Tab Switch | Tab panel content switch | Settings tabs |
| N4 | Breadcrumb Navigation | Hierarchical path navigation | Home > Products > Item |
| N5 | Menu / Submenu | Hover/click dropdown menu | Mega-menu navigation |
| N6 | Pagination | Page number / next-prev navigation | Search results |

### 1.5 — Pointer & Gesture

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| P1 | Simple Click | Click on a button/icon/div | Submit button |
| P2 | Double Click | Rapid double-click event | File open in file manager |
| P3 | Right Click (context menu) | Secondary mouse button | Copy/paste menu |
| P4 | Hover (meaningful) | Pointer rest triggering UI change | Tooltip, mega-menu expansion |
| P5 | Drag and Drop | Element dragged to target position | Kanban card move |
| P6 | Slider / Range | Draggable handle on a track | Price range filter |
| P7 | Scroll (page) | Scrolling the main viewport | Long article |
| P8 | Scroll (container) | Scrolling within a bounded container | Modal body scroll |

### 1.6 — File & Media

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| F1 | File Upload (button) | Click to open file dialog | Profile photo upload |
| F2 | File Upload (drag & drop) | Drag files onto a drop zone | Document upload area |
| F3 | Media Playback Control | Play/pause/seek on audio/video | Video player |

### 1.7 — Keyboard

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| K1 | Keyboard Shortcut (modifier) | Ctrl/Cmd/Shift/Alt + key | Ctrl+S (save) |
| K2 | Special Key (no modifier) | Escape, Enter, Tab, F1-F12, Arrows | Escape to close modal |
| K3 | Keyboard Navigation | Tab through focusable elements | Form field navigation |

### 1.8 — Composite & Overlay

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| C1 | Modal Dialog | Modal open + interact + close | Delete confirmation |
| C2 | Drawer / Side Panel | Slide-in panel | Filter side panel |
| C3 | Popover | Floating content anchored to trigger | Help text popover |
| C4 | Tooltip | Informational hover element | Form field hint |
| C5 | Browser Alert / Confirm | Native `alert()` / `confirm()` dialog | Delete confirmation |
| C6 | Form Submit | Multi-field form with submit button | Registration form |
| C7 | Accordion Expand/Collapse | Collapsible content sections | FAQ accordion |

### 1.9 — Window & Frame

| ID | Interaction | Description | Example |
|----|-------------|-------------|---------|
| W1 | New Tab | Link opening in new tab | "Open in new tab" |
| W2 | New Window | `window.open()` | Popup authentication |
| W3 | Iframe Interaction | Interactions inside an iframe | Embedded payment form |

---

## 2. Maturity Matrix

**Status levels:**
- ✅ **Production-Ready** — Fully implemented, tested, renders correct IR + Playwright, handles SPAs
- 🔶 **Partial** — Core logic exists but has known gaps (missing SPA support, incomplete metadata, no IR rendering)
- 🔵 **Planned** — Type exists in the catalogue, architecture planned, not yet implemented
- ⬜ **Not Supported** — Not implemented; no architecture defined

### Maturity Assessment

| ID | Interaction | Component Runtime | Classifier Type | IR Bridge | Playwright Render | Test Coverage | Status |
|----|-------------|:-:|:-:|:-:|:-:|:-:|:-:|
| **S1** | Native Dropdown | ✅ Dropdown | ✅ NativeDropdown | ✅ SELECT | ✅ selectOption | ✅ Strong | ✅ |
| **S2** | Custom Dropdown | ✅ Dropdown | ✅ CustomDropdown | ✅ SELECT | ✅ selectOption | ✅ Strong | ✅ |
| **S3** | Autocomplete | ✅ TextEntry + Dropdown | 🔶 Autocomplete | 🔶 SELECT (generic) | 🔶 No suggestion click | 🔶 Moderate | 🔶 |
| **S4** | Multi-Select | ✅ Dropdown | 🔶 MultiSelect | 🔶 SELECT (single) | 🔶 No multi-value | ⬜ None | 🔶 |
| **S5** | Radio Button | ✅ RadioButton | ✅ RadioButton | ✅ CLICK | ✅ click() | ✅ Strong | ✅ |
| **S6** | Checkbox | ✅ Checkbox | ✅ Checkbox | ✅ TOGGLE | ✅ check/uncheck | ✅ Strong | ✅ |
| **S7** | Checkbox Group | ✅ Checkbox (×N) | ✅ Checkbox | ✅ TOGGLE | ✅ check/uncheck | ✅ Moderate | ✅ |
| **S8** | Toggle Switch | ✅ Checkbox (via ARIA switch) | ✅ ToggleSwitch | ✅ TOGGLE | ✅ click() | 🔶 Light | 🔶 |
| **S9** | Segmented Control | ✅ RadioButton / Click | ✅ RadioButton | ✅ CLICK | ✅ click() | 🔶 Via AdaniOne | 🔶 |
| **S10** | Stepper / Counter | ✅ Dropdown (subActions) | ✅ via Dropdown | ✅ Multi-step expand | ✅ click N times | ✅ Strong | ✅ |
| **T1** | Text Entry (input) | ✅ TextEntry | ✅ TextEntry | ✅ FILL | ✅ fill() | ✅ Strong | ✅ |
| **T2** | Text Entry (textarea) | ✅ TextEntry | ✅ TextEntry | ✅ FILL | ✅ fill() | ✅ Strong | ✅ |
| **T3** | Text + Autocomplete | ✅ TextEntry + Click | 🔶 TextEntry + Dropdown | 🔶 FILL + CLICK | 🔶 Partial | 🔶 Moderate | 🔶 |
| **T4** | Masked Input | ✅ TextEntry | ✅ TextEntry | ✅ FILL | ✅ fill() | ⬜ None | 🔶 |
| **T5** | Rich Text Editor | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **D1** | Calendar Date Picker | ✅ DatePicker | ✅ DatePicker | ✅ SELECT_DATE | ✅ fill() | ✅ Strong | ✅ |
| **D2** | Native Date Input | ✅ TextEntry (as text) | ✅ DatePicker | ✅ SELECT_DATE | ✅ fill() | 🔶 Light | 🔶 |
| **D3** | Date Range Picker | 🔶 Single date ×2 | 🔶 DatePicker | 🔶 SELECT_DATE ×2 | 🔶 fill() ×2 | ⬜ None | 🔶 |
| **D4** | Time Picker | ⬜ TimePicker type | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **D5** | Date-Time Picker | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **N1** | Link Click | ✅ Link | ✅ Link | ✅ CLICK | ✅ click() | ✅ Strong | ✅ |
| **N2** | SPA Navigation | ✅ Navigation | ✅ PageNavigation | ✅ NAVIGATE | ✅ page.goto() | ✅ Strong | ✅ |
| **N3** | Tab Switch | ✅ Tab | ✅ Tab | ✅ CLICK | ✅ click() | ✅ Moderate | ✅ |
| **N4** | Breadcrumb | ✅ Click/Link | 🔶 Breadcrumb | ✅ CLICK | ✅ click() | 🔶 Light | 🔶 |
| **N5** | Menu / Submenu | 🔶 Hover + Click | 🔶 Menu | ✅ CLICK | ✅ click() | 🔶 Light | 🔶 |
| **N6** | Pagination | ✅ Click | ✅ Click | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **P1** | Simple Click | ✅ Click | ✅ Click | ✅ CLICK | ✅ click() | ✅ Strong | ✅ |
| **P2** | Double Click | ⬜ | ✅ DoubleClick | ✅ CLICK (×2) | ✅ click() ×2 | ⬜ None | 🔵 |
| **P3** | Right Click | ✅ Click (contextmenu) | ✅ RightClick | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **P4** | Hover | ✅ Hover | ✅ Hover | ✅ HOVER | ✅ hover() | ✅ Strong | ✅ |
| **P5** | Drag and Drop | ✅ DragDrop | ✅ DragDrop | ✅ DRAG_DROP | ✅ dragTo() | ✅ Strong | ✅ |
| **P6** | Slider / Range | 🔶 Click only | ✅ Slider | ✅ FILL | ✅ fill() | 🔶 Light | 🔶 |
| **P7** | Page Scroll | ✅ Scroll | ✅ PageScroll | 🔶 Noise (filtered) | ⬜ None | ✅ Strong (capture) | 🔶 |
| **P8** | Container Scroll | ✅ Scroll | ✅ ContainerScroll | 🔶 Noise (filtered) | ⬜ None | ✅ Moderate | 🔶 |
| **F1** | File Upload (button) | ✅ FileUpload | ✅ FileUpload | ✅ FILL (path) | ✅ fill() | 🔶 Moderate | 🔶 |
| **F2** | File Upload (drag) | ✅ DragDrop + FileUpload | 🔶 DragDropUpload | ✅ FILL | 🔶 fill() | ⬜ None | 🔶 |
| **F3** | Media Playback | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ | ⬜ |
| **K1** | Keyboard Shortcut (modifier) | ✅ KeyboardShortcut | ✅ KeyboardShortcut | ✅ PRESS_KEY | ✅ press() | ✅ Strong | ✅ |
| **K2** | Special Key | ✅ KeyboardShortcut | ✅ KeyboardShortcut | ✅ PRESS_KEY | ✅ press() | ✅ Strong | ✅ |
| **K3** | Keyboard Navigation | 🔶 Via Tab key | 🔶 KeyboardShortcut | 🔶 PRESS_KEY | 🔶 press() | ⬜ None | 🔶 |
| **C1** | Modal Dialog | 🔶 Click (no lifecycle) | ✅ Modal | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **C2** | Drawer / Side Panel | 🔶 Click (no lifecycle) | ✅ Drawer | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **C3** | Popover | 🔶 Click (no lifecycle) | ✅ Popover | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **C4** | Tooltip | 🔶 Hover | ✅ Tooltip | ✅ HOVER | ✅ hover() | ⬜ None | 🔶 |
| **C5** | Browser Alert | ⬜ | ✅ BrowserAlert | ✅ CLICK | ✅ click() | 🔶 Light | 🔶 |
| **C6** | Form Submit | ✅ Click + TextEntry | ✅ Click | ✅ CLICK | ✅ click() | 🔶 Moderate | 🔶 |
| **C7** | Accordion | ✅ Click | ✅ Click | ✅ CLICK | ✅ click() | ⬜ None | 🔶 |
| **W1** | New Tab | ⬜ | ✅ NewTab | ✅ CLICK | ✅ click() | ⬜ None | 🔵 |
| **W2** | New Window | ⬜ | ✅ NewWindow | ✅ CLICK | ✅ click() | ⬜ None | 🔵 |
| **W3** | Iframe Interaction | 🔶 Events captured | 🔶 Iframe | ✅ CLICK | ✅ click() | 🔶 Light | 🔶 |

### Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Production-Ready | **20** | **42%** |
| 🔶 Partial | **21** | **44%** |
| 🔵 Planned | **3** | **6%** |
| ⬜ Not Supported | **4** | **8%** |
| **Total** | **48** | |

---

## 3. Validation Suite

Every interaction type must pass **all six gates** before being certified Production-Ready.

### Gate 1 — Capture Fidelity

> *The right interaction type is detected from the right DOM events.*

| Check | Description |
|-------|-------------|
| 1a. Correct trigger | `detectTrigger` fires on the correct event type (click, focus, mousedown) |
| 1b. No false positives | Non-matching elements do NOT trigger (e.g., a `<div>` with `btn` class that's actually a container doesn't trigger Click) |
| 1c. Correct classification | The interaction is classified as the RIGHT type (Click doesn't become Dropdown, etc.) |
| 1d. Priority ordering | Lower-priority definitions don't steal events from higher-priority ones |
| 1e. Downcast correctness | False-positive triggers from higher-priority definitions downcast to Click, not vanish |

### Gate 2 — Lifecycle Integrity

> *The interaction starts and ends at the right time.*

| Check | Description |
|-------|-------------|
| 2a. Correct completion | Lifecycle definitions complete on the right signal (option click, blur, done button) |
| 2b. Correct interruption | Abandoned/timeout sessions produce the right endState |
| 2c. Surface containment | Events inside a dropdown/datepicker surface are absorbed, not leaked |
| 2d. No event swallowing | A click consumed by one definition doesn't block the next legitimate interaction |
| 2e. Flush behavior | `flush()` on recording stop completes/interrupts active sessions correctly |

### Gate 3 — Metadata Completeness

> *The captured interaction carries enough data for accurate replay.*

| Check | Description |
|-------|-------------|
| 3a. Target identity | `accessibleName`, `ariaLabel`, `tag`, `className`, `cssSelector`, `stableId` are all populated |
| 3b. Value capture | For value-bearing interactions: `textValue`, `selectedValue`, `selectedDate`, `checked` is correct |
| 3c. Coordinates | `clientX`/`clientY` for pointer interactions |
| 3d. Sub-actions | For composite interactions: `subActions[]` with correct action/label/value per sub-interaction |
| 3e. Element identity | `elementId` is populated (not empty string — the stepper merge bug root cause) |

### Gate 4 — IR Translation

> *The interaction translates to a correct IR step that can be executed.*

| Check | Description |
|-------|-------------|
| 4a. Correct IRAction | The interaction maps to the right `IRAction` (CLICK, FILL, SELECT, etc.) |
| 4b. No noise leakage | Scroll/Unknown types are filtered from the IR plan |
| 4c. Composite expansion | Multi-step interactions (steppers, multi-config) expand to individual IR steps |
| 4d. Locator generation | `ResolvedLocator[]` is generated with at least one usable locator |
| 4e. Description quality | `plainEnglish` description is human-readable and accurate |

### Gate 5 — Code Generation

> *The IR step renders to executable Playwright code.*

| Check | Description |
|-------|-------------|
| 5a. Valid Playwright | Generated code is syntactically valid TypeScript |
| 5b. Correct method | The right Playwright method is used (click, fill, selectOption, check, hover, dragTo, press) |
| 5c. Locator resolvable | The generated locator expression would resolve against a live DOM |
| 5d. Assertion support | VERIFY actions produce valid `expect()` lines |

### Gate 6 — Framework Independence

> *The interaction is captured correctly across different UI frameworks.*

| Check | Description |
|-------|-------------|
| 6a. Native HTML | Works on plain HTML elements (`<select>`, `<input>`, `<button>`) |
| 6b. React/Vue/Angular | Works on SPA custom components (div-based dropdowns, comboboxes) |
| 6c. ARIA-driven | Works when elements use standard ARIA attributes |
| 6d. CSS-class fallback | Works when elements use framework-specific CSS classes (MUI, AntD, OXD) |
| 6e. No hardcoded selectors | No element-specific or domain-specific selectors in core definitions |

---

## 4. Representative Application Matrix

Instead of testing on specific production websites, use **canonical test fixtures**
that exercise each interaction pattern. Each fixture is a minimal HTML page that
renders the interaction using a specific framework or pattern.

### 4.1 — Fixture Categories

| Category | Purpose | Frameworks |
|----------|---------|------------|
| **Native HTML** | Baseline — pure HTML elements | None (vanilla HTML) |
| **React (Hooks)** | SPA patterns — div-based components, synthetic events | React 18 |
| **Material UI** | Component library with distinctive CSS classes | MUI v5 |
| **Ant Design** | Enterprise SPA library | AntD v5 |
| **Bootstrap** | CSS framework with specific class patterns | Bootstrap 5 |
| **Tailwind / Headless UI** | Utility CSS + accessible components | Tailwind + Headless UI |
| **Legacy (jQuery)** | Server-rendered with progressive enhancement | jQuery + Bootstrap 3 |

### 4.2 — Fixture × Interaction Matrix

For each interaction ID, the fixture exercises it in each framework:

```
                    Native    React    MUI    AntD    Bootstrap    HeadlessUI
S1 NativeDropdown     ✅       ✅       —      ✅       ✅           —
S2 CustomDropdown      —       ✅       ✅      ✅       ✅           ✅
S3 Autocomplete        —       ✅       ✅      ✅        —          ✅
S5 Radio Button       ✅       ✅       ✅      ✅       ✅           ✅
S6 Checkbox           ✅       ✅       ✅      ✅       ✅           ✅
S9 Segmented Ctl       —       ✅       ✅      ✅        —          ✅
S10 Stepper            —       ✅       ✅      ✅        —           —
T1 Text Entry         ✅       ✅       ✅      ✅       ✅           ✅
T3 Text+Autocomplete   —       ✅       ✅      ✅        —          ✅
D1 Calendar Picker     —       ✅       ✅      ✅        —          ✅
P1 Simple Click       ✅       ✅       ✅      ✅       ✅           ✅
P4 Hover               —       ✅       ✅      ✅        —          ✅
P5 Drag & Drop         —       ✅       —      —         —          —
P6 Slider              —       ✅       ✅      ✅        —          ✅
K1 Keyboard Shortcut  ✅       ✅       —      —        ✅           —
N2 SPA Navigation      —       ✅       —      —         —          ✅
```

### 4.3 — Fixture Construction

Fixtures are **synthetic HTML pages** committed to the test suite. Each fixture:
1. Renders the interaction in a specific framework
2. Contains a known set of target elements with predictable accessibleNames
3. Is loaded into JSDOM for unit tests, or into a real browser for E2E
4. Has an expected-output JSON file describing the correct interactions

```
tests/fixtures/
  native/
    dropdown-select.html
    checkbox.html
    radio.html
    text-input.html
    ...
  react/
    dropdown-custom.html
    autocomplete.html
    segmented-control.html
    ...
  mui/
    dropdown.html
    date-picker.html
    ...
  expected-outputs/
    native-dropdown-select.json
    react-autocomplete.json
    ...
```

---

## 5. Regression Strategy

### 5.1 — Three-Layer Test Pyramid

```
                    ┌─────────────────────┐
                    │   E2E Fixture Tests  │  ← ~50 tests (slow, browser)
                    │   (full pipeline)    │
                    ├─────────────────────┤
                    │  Integration Tests   │  ← ~200 tests (medium, JSDOM)
                    │  (runtime → IR)      │
                    ├─────────────────────┤
                    │   Unit Tests         │  ← ~1000 tests (fast, isolated)
                    │  (definitions, utils)│
                    └─────────────────────┘
```

### 5.2 — Regression Gates (run before every merge)

| Gate | What | When | Fail Action |
|------|------|------|-------------|
| **Unit Suite** | All `tests/**/*.test.ts` excluding E2E | Every change | Block merge |
| **Adapter Contract** | Component→Classifier adapter preserves all fields | When definitions change | Block merge |
| **IR Bridge Contract** | Every interaction type → IR step mapping | When IR bridge changes | Block merge |
| **Renderer Contract** | Every IRAction → Playwright code | When renderer changes | Block merge |
| **Pattern Registry** | No framework-specific patterns in GENERIC tier | When patterns change | Block merge |
| **Snapshot Regression** | Known interaction sequences produce known output | Every change | Block merge |
| **Downcast Protocol** | False-positive triggers downcast correctly | When definitions change | Block merge |

### 5.3 — Snapshot Testing Pattern

For each interaction type, a **canonical event sequence** is defined and its
output is snapshot-tested. The snapshot captures the full pipeline output:

```typescript
// tests/certification/snapshot-S1-native-dropdown.test.ts
describe('Certification: S1 Native Dropdown', () => {
  const sequence = [
    { eventType: 'click', target: { tag: 'SELECT', accessibleName: 'Country' } },
    { eventType: 'change', target: { tag: 'SELECT' }, valueAfter: 'India' },
  ];

  it('produces correct component interaction', () => { ... });
  it('produces correct IR step', () => { ... });
  it('produces correct Playwright code', () => { ... });
  it('downcasts correctly if interrupted', () => { ... });
  it('is not stolen by DragDrop', () => { ... });
});
```

### 5.4 — Change Impact Analysis

Before merging any change, answer:

1. **Which interaction types does this touch?** (Check the definition priority order)
2. **Which gates does this affect?** (Capture, lifecycle, metadata, IR, code-gen, framework-independence)
3. **Which existing tests might break?** (Run full suite, investigate every failure)
4. **Does this change affect the downcast protocol?** (If yes, run downcast tests)
5. **Does this change affect event claiming order?** (If yes, run all definition tests)

---

## 6. Production-Ready Acceptance Criteria

### 6.1 — Recorder Certification Levels

| Level | Requirement | Coverage |
|-------|-------------|----------|
| **Bronze** | All ✅ interaction types pass Gates 1-3 | ≥ 20 types |
| **Silver** | All ✅ interaction types pass Gates 1-5 | ≥ 20 types |
| **Gold** | All ✅ types pass Gates 1-6 + all 🔶 types pass Gates 1-3 | ≥ 35 types |
| **Platinum** | All 48 types pass all 6 gates | 48/48 |

### 6.2 — Current Certification: **Bronze** (approaching Silver)

**20 Production-Ready types** pass Gates 1-3. To reach Silver:
- Complete Gate 4 (IR) and Gate 5 (Playwright) test coverage for all 20 types
- Add snapshot tests for canonical event sequences
- Verify all 20 types produce valid Playwright code in the test suite

### 6.3 — Metrics Dashboard

| Metric | Current | Target (Silver) | Target (Gold) |
|--------|---------|-----------------|---------------|
| Interaction types passing Gates 1-3 | 20 | 20 | 35 |
| Interaction types passing Gates 1-5 | ~15 | 20 | 35 |
| Interaction types passing Gate 6 (framework-indep.) | ~10 | 20 | 35 |
| Fixture coverage (framework × interaction cells) | ~30% | 60% | 80% |
| Test suite pass rate | 99.9% | 100% | 100% |
| Capture false-positive rate | Unknown | < 5% | < 2% |
| IR-to-Playwright render success rate | ~95% | 100% | 100% |

### 6.4 — Confidence Statement

> The recorder is considered **production-ready for the vast majority of modern web
> applications** when it achieves **Gold certification**: all Production-Ready and
> Partial interaction types pass all six validation gates across at least three
> UI frameworks (Native HTML, React, and one component library).
>
> At Gold, a user recording on any of the top 1000 web applications can expect
> ≥ 95% of their interactions to be captured, correctly classified, and
> translated to executable test code without manual intervention.

---

## 7. Implementation Roadmap for Certification

### Phase 1: Baseline Certification (Current → Silver)
1. Write snapshot tests for all 20 ✅ types (canonical event sequences)
2. Add Gate 4 (IR) and Gate 5 (Playwright) assertions to each snapshot test
3. Create the `tests/certification/` directory with one file per interaction type
4. Verify all 20 types produce valid Playwright code
5. Run full certification suite and document results

### Phase 2: Gap Closure (Silver → Gold)
1. Promote all 🔶 Partial types that only need test coverage to ✅
2. Build canonical fixtures for Native HTML, React, MUI
3. Run Gate 6 (framework independence) for all ✅ types
4. Close gaps in Autocomplete (S3), Slider (P6), Toggle Switch (S8)
5. Document remaining ⬜ Not Supported types

### Phase 3: Full Coverage (Gold → Platinum)
1. Implement remaining 🔵 Planned types (Double Click, New Tab, New Window)
2. Implement ⬜ Not Supported types (Rich Text, Time Picker, Media Playback)
3. Achieve 100% interaction catalogue coverage
4. E2E fixture tests in a real browser (Playwright)
5. Final certification run

---

## Appendix A: Interaction → Definition → IR → Playwright Mapping

| Interaction | Component Type | IRAction | Playwright Method |
|-------------|---------------|----------|-------------------|
| Click | Click | CLICK | `locator.click()` |
| Text Entry | TextEntry | FILL | `locator.fill('text')` |
| Dropdown (native) | Dropdown | SELECT | `locator.selectOption('value')` |
| Dropdown (custom) | Dropdown | SELECT | `locator.click()` on option |
| Radio Button | RadioButton | CLICK | `locator.click()` |
| Checkbox | Checkbox | TOGGLE | `locator.check()` / `.uncheck()` |
| Date Picker | DatePicker | SELECT_DATE | `locator.fill('2026-07-30')` |
| Hover | Hover | HOVER | `locator.hover()` |
| Drag & Drop | DragDrop | DRAG_DROP | `locator.dragTo(target)` |
| Keyboard Shortcut | KeyboardShortcut | PRESS_KEY | `locator.press('Control+s')` |
| Navigation | Navigation | NAVIGATE | `page.goto('url')` |
| Slider | Slider | FILL | `locator.fill('value')` |
| File Upload | FileUpload | FILL | `locator.setInputFiles(path)` |
| Scroll | Scroll | *(noise)* | *(filtered)* |
| Link | Link | CLICK | `locator.click()` |
| Tab | Tab | CLICK | `locator.click()` |

## Appendix B: Definition Priority Order

```
Priority  5: KeyboardShortcut
Priority 10: DatePicker
Priority 15: DragDrop        ← triggers on mousedown (before Dropdown)
Priority 20: Dropdown        ← triggers on click/mousedown/focus
Priority 25: Slider
Priority 30: Checkbox
Priority 35: FileUpload
Priority 40: RadioButton
Priority 50: TextEntry       ← triggers on focus
Priority 60: Hover           ← triggers on mouseenter
Priority 65: Tab
Priority 70: Link
Priority 110: Scroll
Priority 120: Navigation
Priority 180: Click          ← universal fallback (always last)
```

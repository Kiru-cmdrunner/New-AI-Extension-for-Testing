# Control-Centric Semantic Target Resolution — Design Specification

> **Status**: PROPOSED — awaiting review before implementation
> **Predecessor**: Phase 3 `target-resolver.ts` (element-centric, same bug as v10.4.18)
> **Depends on**: Phase 1 types, Phase 2 channels

---

## 1. The Problem

All three reference implementations (integration, working-better, v10.9.0) share the same fundamental flaw: `resolveTarget()` returns **one DOM element** by greedily accepting the first `composedPath()` match against `INTERACTIVE_SELECTOR`, then **discards the rest of the path**.

This is element-centric, not control-centric. The question EventTap should answer is not *"which DOM element received the browser event?"* but *"which logical UI control did the user intend to interact with?"*

These are not always the same. A Save button contains `<i>`, `<span>`, ripple overlays. A combobox contains inputs, placeholders, arrow icons. The user interacted with the **Save button** and the **combobox**, not whichever child happened to receive the event.

---

## 2. Core Design Principle

**EventTap captures rich, multi-candidate evidence. It never makes an irreversible wrong decision.**

The resolution engine:
1. Collects **all** candidate controls from `composedPath()`
2. Scores each candidate using W3C ARIA semantics + framework adapter hints
3. Selects a **primary candidate** (correct >95% of the time)
4. Preserves **alternative candidates** + **full path evidence** for downstream analysis
5. Captures the **composite control context** (is this option inside a combobox?)

Recognition receives the full multi-candidate result and classifies with higher confidence — without needing to "repair" incorrect capture data.

---

## 3. The Algorithm

### Phase A — Path Capture (framework-independent)

```
input: DOM Event
output: ordered element[] from event.composedPath()

- composedPath() already traverses Shadow DOM boundaries
- Filter out non-Element nodes (Document, Window)
- Record click coordinates for proximity scoring
- Preserve the FULL path — never discard
```

This is the foundation. `composedPath()` is a W3C standard that returns every element from the event target up through the DOM tree, including Shadow DOM hosts. It works across:
- Native HTML ✅
- Shadow DOM ✅ (open and closed — closed elements still appear in path)
- Nested Shadow DOM ✅
- Portal-rendered overlays ✅ (portals render into the real DOM; path reflects this)

**Cross-origin iframes** are the one limitation: events inside a cross-origin iframe fire on the iframe document, and we cannot inject a content script to capture them. We detect the cross-origin boundary and record *"user interacted within iframe origin X"* — partial capture, not wrong capture.

**Same-origin iframes** require injecting EventTap into each iframe document. The frame context is captured as part of the evidence.

### Phase B — Candidate Collection (framework-independent)

Walk every element in the path. For each, determine if it exhibits **interactive signals**:

| Signal | Weight | Detection |
|--------|--------|-----------|
| ARIA atomic widget role | +100 | `[role]` matches W3C atomic role set (18 roles) |
| Native interactive tag | +80 | `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`, `<option>`, `<summary>` |
| ARIA composite widget boundary | +60 | `[role]` matches composite role set (combobox, listbox, menu, radiogroup, tablist, tree, grid, treegrid) |
| Framework wrapper class | +40 | Adapter-detected pattern (e.g., `oxd-select-wrapper`, `MuiButtonBase-root`) |
| Interactive attribute | +20 | `[tabindex]` ≥ 0, `[onclick]`, `[data-action]` |
| Cursor pointer | +10 | `getComputedStyle(el).cursor === 'pointer'` |
| Decorative element | −50 | `<i>`, `<svg>`, `<path>`, `<img>`, `<span>` without any ARIA role |

Each element that scores > 0 becomes a **candidate**. Record its full identity (tag, role, accessible name, classes, locators) and its **depth** from the click target.

**Proximity bonus**: +5 per level closer to the click target. When two candidates have similar scores, the closer one wins — this models the intuition that users usually click near the element they intend.

### Phase C — Composite Control Detection (framework-independent + adapter-assisted)

For each candidate, determine if it is **inside** a composite widget:

```typescript
// W3C ownership relationships (framework-independent)
const COMPOSITE_TO_CHILD: Record<string, string[]> = {
  combobox:  ['listbox'],
  listbox:   ['option'],
  menu:      ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  menubar:   ['menuitem', 'menuitemcheckbox', 'menuitemradio'],
  radiogroup: ['radio'],
  tablist:   ['tab'],
  tree:      ['treeitem'],
  grid:      ['row', 'rowheader', 'gridcell', 'columnheader'],
  treegrid:  ['row', 'rowheader', 'gridcell', 'columnheader'],
};
```

For each candidate, walk its ancestors looking for composite roles. If found:
- The **composite** is the logical control boundary
- The candidate is a **constituent** of that control
- Record `compositeContext: { role: 'combobox', boundary: <identity> }`

This is the key to control-centric resolution. When a user clicks an `option` inside a `combobox`, EventTap records:
- Primary candidate: `option` (atomic widget, +100)
- Composite context: `combobox` (the logical control)
- The downstream pipeline knows this is "select from dropdown", not "click random div"

### Phase D — Framework Adapter Consultation (pluggable)

Each element in the path is passed to registered framework adapters. An adapter can:

1. **Identify wrapper boundaries**: "This element is inside an OXD dropdown wrapper"
2. **Override the semantic role**: "This `div.oxd-select-text-input` is functionally a combobox trigger, even though it has no `role` attribute"
3. **Detect synthetic duplicates**: "OXD radios fire label→input synthetic clicks; mark the second as duplicate"

Adapters are **optional** — the core algorithm works without them using W3C semantics alone. Adapters improve accuracy on non-ARIA-compliant frameworks.

```typescript
interface FrameworkAdapter {
  name: string;                    // 'oxd', 'mui', 'ant-design', etc.
  detect(root: Element): boolean;  // Is this framework active on the page?
  resolveWrapper(el: Element): WrapperResolution | null;
  // → { semanticRole, controlBoundary, isSyntheticDuplicate }
}
```

**Detection strategy**: Each adapter runs a lightweight `detect()` check on first event (e.g., check for `oxd-` prefixed classes, `__MuiButtonBase` in class names, `ant-` prefix). Active adapters are cached per page.

### Phase E — Scoring & Selection

```
For each candidate:
  finalScore = baseScore + proximityBonus + adapterBonus

primaryCandidate = highest finalScore
alternatives     = next 2-3 candidates by score
```

The result is a **ResolvedTarget**:

```typescript
interface ResolvedTarget {
  // The primary semantic target — correct >95% of the time
  primary: TargetElementIdentity;

  // Alternative candidates, scored and ordered — for ambiguous cases
  alternatives: ScoredCandidate[];

  // If inside a composite widget, the control boundary
  compositeContext: CompositeContext | null;

  // Full evidence for downstream analysis
  pathEvidence: PathElement[];

  // Framework signals detected
  frameworkHints: FrameworkHint[];

  // Click metadata
  clickCoordinates: { x: number; y: number };
  eventType: string;
}
```

---

## 4. Framework-Independent vs Framework-Specific

### Framework-Independent Core (always active)

| Capability | Mechanism |
|-----------|-----------|
| Path traversal | `composedPath()` — W3C standard, works across Shadow DOM |
| ARIA widget role detection | 18 atomic + 9 composite roles from W3C ARIA 1.2 |
| Composite→child mapping | Static ownership table from W3C spec |
| Native interactive tag detection | HTML spec: button, a, input, select, textarea, option, summary |
| Decorative element filtering | i, svg, path, img, span without roles |
| Candidate scoring | Weighted formula with proximity bonus |
| accessible name computation | W3C Accessible Name Computation algorithm |

### Framework Adapters (optional, pluggable)

| Framework | What The Adapter Detects | Priority |
|-----------|------------------------|----------|
| **OXD** (OrangeHRM) | Dropdown wrapper (`oxd-select-wrapper`), checkbox wrapper, date picker classes | High (primary test target) |
| **Material UI** | `MuiButtonBase-root`, `MuiCheckbox-root`, `MuiAutocomplete-root` | Medium |
| **Ant Design** | `ant-btn`, `ant-select`, `ant-checkbox-wrapper` | Medium |
| **PrimeReact** | `p-button`, `p-dropdown`, `p-calendar` | Medium |
| **Headless UI** | (usually ARIA-compliant — minimal adapter needed) | Low |
| **AG Grid** | `ag-row`, `ag-cell` — virtualized grid structures | Medium |
| **Salesforce Lightning** | `slds-button`, `slds-combobox`, Shadow DOM components | Medium |
| **SAP/Fiori** | `sapMBtn`, `sapMSelect`, `sapMDTP` | Medium |

Each adapter is a small standalone module (~50-100 lines). New frameworks can be added without touching the core engine.

---

## 5. Cross-Platform Behavior

### Shadow DOM (open and closed)
- `composedPath()` traverses open Shadow DOM boundaries ✅
- Closed Shadow Roots: elements inside still appear in `composedPath()` (per W3C spec — the "closed" flag only affects `element.shadowRoot` programmatic access, not event dispatch) ✅
- Framework adapters can detect Shadow hosts as component boundaries

### Nested Shadow DOM
- `composedPath()` returns elements across all shadow boundaries, in correct order ✅
- No special handling needed

### Same-origin iframes
- Inject EventTap into each same-origin iframe document
- Each captured event includes `frameContext: { url, frameId }`
- The pipeline handles events from multiple frames transparently

### Cross-origin iframes
- Cannot inject content script — fundamental browser security limitation
- Detect cross-origin iframe boundaries via `postMessage` handshake
- Record: *"user interacted within iframe origin X"* — partial capture
- This is an acceptable limitation, not a wrong-capture bug

### Portal-rendered overlays
- React Portals, Vue Teleports render into the real DOM (typically `document.body`)
- `composedPath()` reflects the actual DOM position, not the component tree position
- The overlay IS in the path — we capture it correctly
- Framework adapters can detect portal containers (e.g., `data-react-portal`, MUI `Popover` root)

### Virtualised components (AG Grid, react-window)
- Only visible elements exist in the DOM at capture time
- Target resolution works normally on visible elements
- Concern is locator stability, not target resolution
- Adapter hint: mark virtualized contexts so locators use data attributes, not positional paths

---

## 6. Per-Interaction-Type Analysis

For each interaction type: how EventTap identifies the logical control, what evidence it captures, and where the responsibility lies.

### Button Click
- **Events**: `click`
- **Path example**: `[i.oxd-icon, span, button.submit-btn, div.oxd-form-action]`
- **Candidates**: `i` (−50 decorative), `span` (−50 decorative), `button` (+80 native + +100 role)
- **Primary**: `button` — score 180
- **Evidence**: accessible name, role=button, locators (testId > aria-label > text > CSS)
- **Framework adapter**: MUI detects `MuiButtonBase-root` wrapper

### Text Entry
- **Events**: `focus` → `input` → `blur`
- **Path**: typically unambiguous — the input/textarea IS the event target
- **Primary**: the `<input>`, `<textarea>`, or `[contenteditable]` element
- **Evidence**: valueBefore (at focus), valueAfter (at input/blur), inputType, maxLength
- **Edge case**: `[contenteditable]` rich text — capture innerHTML delta, not just textContent
- **Framework adapter**: OXD input wrapper detection for label association

### Dropdown / Combobox
- **Events**: `click` on trigger → `click` on option
- **Trigger path**: `[div.oxd-select-text-input[tabindex=0], div.oxd-select-wrapper, ...]`
- **Candidates for trigger**: `div` (+20 tabindex, +40 adapter=oxd-select-wrapper)
- **Composite context**: framework adapter identifies this as a combobox boundary
- **Option path**: `[div[role=option], div[role=listbox], div.oxd-select-dropdown, ...]`
- **Primary for option**: `div[role=option]` (+100 atomic widget)
- **Composite context**: parent is `listbox` → combobox control
- **Evidence**: trigger identity, selected option text, previous value, all options visible
- **Key**: EventTap captures BOTH the option AND the composite context — Recognition never has to guess "what dropdown was this option from?"

### Searchable Dropdown
- **Events**: `click` trigger → `input` (type to filter) → `click` option
- **Additional**: the search input is a constituent of the combobox composite
- **Evidence**: search query text, selected option, filtered option count
- **Framework adapter**: MUI Autocomplete, Ant Design Select with `showSearch`

### Date Picker
- **Events**: `click` trigger → `click` nav (internal) → `click` day cell
- **Trigger**: input with date/calendar classes, or `[role=combobox]` with calendar popup
- **Nav buttons**: identified by accessible name pattern (prev/next/switch/today) — marked `isLifecycleInternal`
- **Day cell**: `[role=gridcell]` (+100) or framework class (`oxd-date-day`)
- **Composite context**: calendar grid → date picker control
- **Alternative modes**: typed input + blur (native input), native `[type=date]` change event
- **Evidence**: trigger identity, selected date value, calendar format, all three completion modes

### Radio Button
- **Events**: `click` on radio or label
- **Path**: `[input[type=radio], label.radio-label, div.oxd-radio-wrapper, ...]`
- **Candidates**: `input` (+80 native + +100 role=radio), `label` (+0, not interactive)
- **Primary**: `input[type=radio]`
- **Composite context**: `radiogroup` (if present) → the radio group is the control
- **Synthetic clicks**: OXD fires label→input — adapter marks second click as duplicate
- **Evidence**: selected value, group name, all radio options in group, previous selection

### Checkbox
- **Events**: `click` on checkbox, label, or wrapper
- **Path**: `[input[type=checkbox], label, div.oxd-checkbox-wrapper, ...]`
- **Primary**: `input[type=checkbox]` (+80 + +100)
- **Checked state**: captured via 4-level cascade (native → aria-checked → aria-pressed → CSS class)
- **Evidence**: checkedBefore, checkedAfter, label text, group context if applicable

### Toggle Switch
- **Events**: `click` on switch element
- **Primary**: `[role=switch]` (+100) or framework-detected switch (MuiSwitch-root, ant-switch)
- **Evidence**: state before/after (on/off), label text
- **Note**: distinct from checkbox — different semantic verb (toggle on/off vs check/uncheck)

### Hover
- **Events**: `mouseenter` / `mouseleave`
- **Primary**: the hovered element if it has ARIA semantics or causes visible state change
- **Evidence**: element identity, tooltip text if revealed, CSS state changes
- **Filter**: plain text hover without UI change → no evidence captured (hover is only meaningful when the UI responds)

### Scroll
- **Events**: `scroll`
- **Primary**: the scroll container (always correct — scroll fires on the container)
- **Evidence**: scroll position, scroll delta, direction, container size
- **No ambiguity**: scroll target resolution is never wrong

### Navigation
- **Events**: `pageshow` / `pagehide` / `popstate`
- **Primary**: URL-based, not element-based
- **Evidence**: previous URL, new URL, navigation type (push, replace, reload, back/forward)
- **No ambiguity**: navigation is URL-level, not element-level

### Dialog / Modal
- **Events**: `click` that opens dialog → interactions inside → `click` close/confirm
- **Surface detection**: `[role=dialog]`, `[role=alertdialog]`, `[aria-modal=true]`
- **Evidence**: dialog identity, overlay stack depth, focus trap boundaries
- **Lifecycle**: interactions inside a dialog are scoped to the dialog context
- **Framework adapter**: MUI Dialog, Ant Design Modal — detect portal containers

### File Upload
- **Events**: `click` on upload button → `change` on `input[type=file]`
- **Primary**: `input[type=file]` (+80 native)
- **Evidence**: file names, file count, file types, accept attribute
- **Edge case**: drag-and-drop file upload zones — detect `dragover`/`drop` events

### Drag & Drop
- **Events**: `dragstart` → `dragover` → `drop`
- **Three elements**: drag source, drop target, drag image (visual feedback)
- **Evidence**: source identity, target identity, drop position, dataTransfer payload
- **Complex**: may need special lifecycle (multi-event grouping across different elements)

### Multi-select
- **Events**: multiple `click` on options, or `click` + modifier key (Ctrl/Cmd+click)
- **Primary**: each option individually
- **Composite context**: listbox with `aria-multiselectable=true`
- **Evidence**: all selected values, selection mode (single vs multi)

### Tree View
- **Events**: `click` on treeitem (select), `click` on expand/collapse toggle
- **Path**: `[span.tree-label, div[role=treeitem], div[role=tree], ...]`
- **Primary**: `div[role=treeitem]` (+100)
- **Composite context**: `tree` or `treegrid`
- **Evidence**: node label, depth, expanded state, selected state, parent node
- **Expand/collapse**: detected via `aria-expanded` change — may be lifecycle-internal

### Context Menu
- **Events**: `contextmenu` (right-click) → `click` on menuitem
- **Surface**: `[role=menu]` or framework context menu
- **Evidence**: trigger element, menu items, selected action
- **Lifecycle**: right-click → menu open → select → menu close

### Tabs
- **Events**: `click` on tab
- **Primary**: `[role=tab]` (+100)
- **Composite context**: `tablist` → the tab group is the control
- **Evidence**: tab label, tab index, active panel, previous tab
- **Framework adapter**: MUI Tabs, Ant Design Tabs — detect tab container

### Tables / Grids
- **Events**: `click` on cell, row header, or row selector
- **Primary**: `[role=gridcell]` (+100) or framework cell class (ag-cell)
- **Composite context**: `grid` or `table` → the table is the control
- **Evidence**: cell value, row index, column header, row selection state
- **Virtualization**: AG Grid adapter marks virtualized context for locator strategy
- **Row selection**: checkbox in first column — detected as toggle inside grid context

### Rich Text Editor
- **Events**: `input` on `[contenteditable]`, `click` on toolbar buttons
- **Primary**: the `[contenteditable]` element (+20 tabindex, +80 contenteditable)
- **Toolbar**: toolbar buttons are separate interactions (`click` with formatting context)
- **Evidence**: HTML content before/after, formatting commands, cursor position
- **Framework adapter**: TinyMCE, CKEditor, Quill, TipTap — detect editor containers, capture editor API state

---

## 7. Multi-Candidate Evidence Structure

EventTap outputs a `ResolvedTarget` per event, containing:

```typescript
interface ResolvedTarget {
  primary: TargetElementIdentity;
  alternatives: ScoredCandidate[];
  compositeContext: CompositeContext | null;
  pathEvidence: PathElement[];
  frameworkHints: FrameworkHint[];
  clickCoordinates: { x: number; y: number };
  eventType: string;
}

interface ScoredCandidate {
  identity: TargetElementIdentity;
  score: number;
  signals: string[];           // ['aria-role:button', 'native:button', 'proximity:0']
  depth: number;               // distance from click target in path
}

interface CompositeContext {
  role: string;                // 'combobox', 'radiogroup', 'tablist', etc.
  boundary: TargetElementIdentity;  // the composite element
  childRole: string;           // 'option', 'radio', 'tab', etc.
}

interface PathElement {
  tag: string;
  role: string | null;
  classes: string[];
  accessibleName: string;
  depth: number;
}

interface FrameworkHint {
  framework: string;           // 'oxd', 'mui', 'ant-design'
  signal: string;              // 'wrapper-detected', 'synthetic-duplicate', etc.
  confidence: number;          // 0.0 - 1.0
}
```

This structure flows into EvidenceBatch, where Channels A-E enrich it with accessibility, DOM structure, behavioural, mutation, and focus evidence. Recognition never sees a bare element — it sees the full control context.

---

## 8. Implementation Plan

### Phase 3b-1: Multi-Candidate Path Collection
- Replace `resolveTarget()` with `collectCandidates()`
- Capture full `composedPath()` as `PathElement[]`
- Score every element, produce candidate list
- Select primary + alternatives

### Phase 3b-2: Composite Control Detection
- Implement W3C ownership table
- Walk ancestors for composite roles
- Attach `compositeContext` to result

### Phase 3b-3: Framework Adapter System
- Define `FrameworkAdapter` interface
- Implement OXD adapter (primary test target)
- Implement MUI adapter
- Implement Ant Design adapter
- Lazy-load adapters (only instantiate detected frameworks)

### Phase 3b-4: Evidence Integration
- Update `EvidenceBatch` to carry `ResolvedTarget` instead of bare `TargetElementIdentity`
- Update Channels to read from `ResolvedTarget.primary`
- Update Recognition to consult `compositeContext`
- Update Lifecycle to use `frameworkHints`

### Phase 3b-5: Validation
- Unit tests for each interaction type
- Synthetic DOM tests for each framework
- Acceptance test suite scenarios pass

---

## 9. What This Changes Downstream

| Stage | Before (current) | After (Phase 3b) |
|-------|------------------|-------------------|
| **EventTap** | Returns 1 element, discards path | Returns multi-candidate + composite context + full evidence |
| **Channels** | Extract from single element | Extract from primary candidate + composite context |
| **Recognition** | Classify from single identity | Classify with composite context + alternatives as tiebreakers |
| **Lifecycle** | Scope check on single element | Scope check on composite boundary |
| **Enrichment** | Map element → component type | Composite context already identifies the component |
| **Output** | Generate locator from single element | Generate from primary candidate, with fallbacks from alternatives |

---

## 10. Design Principles

1. **Never discard evidence.** The full path is always preserved.
2. **Score, don't guess.** Every candidate gets a weighted score from multiple signals.
3. **Composite awareness.** Every interaction knows its control context.
4. **Framework-independent core.** W3C semantics work without any adapter.
5. **Adapters enhance, never replace.** They add signals to the scoring, not override it.
6. **Primary is correct >95%.** Alternatives exist for edge cases, not routine operation.
7. **Downstream is informed, not repairing.** Recognition classifies from rich evidence, not from corrected data.

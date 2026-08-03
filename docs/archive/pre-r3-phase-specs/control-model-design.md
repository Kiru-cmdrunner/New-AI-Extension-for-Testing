# CmdRunner Control Model — Foundational Design

> **Status**: DESIGN — awaiting approval before implementation
> **Purpose**: The semantic foundation that all interaction recognition, 
> enrichment, and output will build upon.
> **Design horizon**: Years. This must outlive framework fads, DOM API 
> changes, and implementation refactors.

---

## 0. Executive Summary

The Control Model is a **live, semantic representation of every logical UI 
control on the page**, computed from the DOM using W3C standards and 
maintained continuously via DOM mutation observation.

It is not an enhancement of EventTap. It is a **parallel subsystem** that 
maintains knowledge of what controls exist, what state they are in, and how 
they relate to each other. When a user interacts with the page, the Control 
Model is consulted — not the raw DOM — to determine which control was 
interacted with.

```
┌─────────────────────────────────────────────────────────┐
│                    CONTROL MODEL                         │
│                                                          │
│  Built from: DOM (via W3C ARIA computation)             │
│  Maintained by: MutationObserver (continuous)           │
│  Enriched by: Behavioural observation (state changes)   │
│  Supplemented by: Framework adapters (non-ARIA fallback)│
│                                                          │
│  ┌─────┐   ┌──────────┐   ┌────────┐   ┌─────────────┐ │
│  │Page │──►│ Region:  │──►│ Form:  │──►│ Combobox:   │ │
│  │     │   │ Main     │   │ PIM    │   │ Nationality │ │
│  │     │   │          │   │ Edit   │   │  ├─ Listbox │ │
│  │     │   │          │   │        │   │  │  ├─ Opt  │ │
│  │     │   │          │   │        │   │  │  └─ Opt  │ │
│  │     │   │          │   │        │   │  └─ Trigger │ │
│  │     │   │          │   │        │──►│ Text: Name  │ │
│  │     │   │          │   │        │──►│ Button:Save │ │
│  └─────┘   └──────────┘   └────────┘   └─────────────┘ │
└─────────────────────────────────────────────────────────┘
         ▲                           ▲
         │ query(event)              │ subscribe(changes)
         │                           │
┌────────┴───────────┐    ┌──────────┴──────────────┐
│   EVENT MATCHER     │    │   DOM OBSERVER          │
│                     │    │                         │
│  Given a DOM event  │    │  MutationObserver on    │
│  + composedPath()   │    │  document + shadow roots│
│  → find the Control │    │  → create/update/remove │
│    in the Model     │    │    Control nodes        │
└─────────────────────┘    └─────────────────────────┘
```

---

## 1. What Exactly Is a Control?

A **Control** is a logical interaction unit — the thing a user perceives as 
a single interactable element, regardless of how many DOM elements comprise it.

A Control is NOT:
- A DOM element (one control may span 15 DOM nodes)
- A framework component (one control may be half a React component)
- A CSS selector target (controls have semantic, not structural, identity)

A Control IS:
- The **Save button** (whether rendered as `<button>`, `<div role="button">`, 
  or `<div class="oxd-button" tabindex="0">`)
- The **Nationality dropdown** (whether it's a `<select>` or a 20-element 
  OXD div structure with trigger + popup + options)
- The **Gender radio group** (the entire group is one control with 
  constituent radio buttons)

### Control Classification

Controls come in two kinds:

**Atomic Controls** — self-contained interaction units:
- Button, Link, Text Input, Checkbox, Radio, Switch, Slider, Tab, 
  TreeItem, MenuItem, Option, GridCell

**Composite Controls** — controls that own and manage constituent controls:
- Combobox (owns a Listbox which owns Options)
- RadioGroup (owns Radio buttons)
- TabList (owns Tabs, associated with TabPanels)
- Grid (owns Rows which own GridCells)
- Tree (owns TreeItems which may own nested TreeItems)
- Menu (owns MenuItems)
- Dialog (owns all controls rendered within it)

The distinction is W3C-defined and framework-independent.

---

## 2. What Information Does a Control Node Contain?

```typescript
interface ControlNode {
  // ─── Identity ──────────────────────────────────────────
  /** Stable semantic ID. Survives DOM re-renders. */
  readonly controlId: string;

  /** W3C-computed role (button, combobox, textbox, etc.) */
  readonly role: string;

  /** W3C-computed accessible name ("Save", "Nationality", "First Name") */
  readonly accessibleName: string;

  /** Optional accessible description (aria-describedby, title) */
  readonly accessibleDescription: string | null;

  // ─── Classification ────────────────────────────────────
  /** Is this an atomic or composite control? */
  readonly kind: 'atomic' | 'composite';

  /** For composite controls: what roles are expected as children */
  readonly expectedChildRoles: readonly string[];

  // ─── Capabilities ──────────────────────────────────────
  /** What user actions this control accepts */
  readonly capabilities: ReadonlySet<ControlCapability>;

  // ─── State ─────────────────────────────────────────────
  /** Current semantic state (mutable, updated by observer) */
  state: ControlState;

  // ─── DOM Binding ───────────────────────────────────────
  /** The DOM element(s) currently bound to this control */
  domBinding: DomBinding;

  // ─── Relationships ─────────────────────────────────────
  /** Parent composite control (null for top-level) */
  parentId: string | null;

  /** Child control IDs (for composite controls) */
  childIds: readonly string[];

  /** Associated control IDs (label↔input, tab↔panel, error↔input) */
  associations: readonly ControlAssociation[];

  // ─── Provenance ────────────────────────────────────────
  /** How was this control discovered? */
  readonly discoverySource: DiscoverySource;

  /** Framework that provided non-ARIA hints, if any */
  readonly frameworkHint: string | null;

  /** When this control was first discovered */
  readonly discoveredAt: string;
}
```

### ControlCapability
```typescript
type ControlCapability =
  | 'click'        // Can be activated (button, link, menuitem)
  | 'acceptText'   // Can receive text input (textbox, searchbox, spinbutton)
  | 'selectOption' // Can be selected (option, tab, treeitem)
  | 'toggle'       // Can be toggled (checkbox, switch)
  | 'adjust'       // Can be adjusted (slider, spinbutton)
  | 'expand'       // Can be expanded/collapsed (combobox, accordion)
  | 'focus'        // Can receive focus
  | 'hover'        // Can be hovered (with semantic response)
  | 'scroll'       // Can be scrolled
  | 'dismiss'      // Can be dismissed (dialog, menu)
  | 'upload'       // Can accept file input
  ;
```

### ControlState
```typescript
interface ControlState {
  /** Is the control visible in the viewport? */
  visible: boolean;

  /** Is the control enabled (not aria-disabled, not disabled)? */
  enabled: boolean;

  /** Is the control currently focused? */
  focused: boolean;

  /** For expandable controls: is it expanded? */
  expanded: boolean | null;

  /** For toggleable controls: is it checked/pressed? */
  checked: boolean | null;

  /** For selectable controls: is it selected? */
  selected: boolean | null;

  /** For text inputs: current value */
  value: string | null;

  /** For composites with selection: which child is active */
  activeChildId: string | null;

  /** Surface state: is this control inside a dialog/menu/overlay? */
  surfaceContext: SurfaceContext | null;
}
```

### DomBinding
```typescript
interface DomBinding {
  /**
   * The primary DOM element bound to this control.
   * May become stale after re-render — use controlId for stability.
   */
  element: WeakRef<Element>;

  /** CSS classes at binding time (for re-binding after re-render) */
  classFingerprint: string[];

  /** Stable locators derived from the element */
  locators: ResolvedLocator[];

  /** Frame context (which document/iframe this control lives in) */
  frame: FrameRef;

  /** Shadow DOM depth (0 = light DOM, 1+ = shadow) */
  shadowDepth: number;

  /** When this binding was established */
  boundAt: string;
}
```

---

## 3. How Are Controls Discovered When a Page Loads?

Discovery is a **tree walk** that computes the accessibility tree from the 
DOM. This is exactly what the browser does to build its own Accessibility 
Tree — we're computing a parallel one.

### Algorithm

```
discoverControls(rootElement):
  1. Walk rootElement descendants (and shadow roots) in document order
  2. For each element, compute:
     a. role = getAriaRole(element)       ← W3C algorithm (already in Channel A)
     b. name = computeAccessibleName(element)  ← W3C algorithm (already in Channel A)
     c. capabilities = deriveCapabilities(role, tag, inputType)
  3. If role is a known widget role → create ControlNode
  4. If no role but framework adapter detects a control → create ControlNode
  5. If no role and no adapter match → skip (structural element, not a control)
  6. Build parent-child relationships based on DOM hierarchy and ARIA ownership
```

### What Gets Discovered

| DOM Structure | Control Created |
|--------------|----------------|
| `<button>Save</button>` | Atomic: `{ role: 'button', name: 'Save', capabilities: {click, focus} }` |
| `<input type="text" aria-label="First Name">` | Atomic: `{ role: 'textbox', name: 'First Name', capabilities: {acceptText, focus} }` |
| `<select aria-label="Nationality">...` | Composite: `{ role: 'listbox', name: 'Nationality' }` + child Options |
| `<div role="combobox" aria-label="Search">` + popup `<div role="listbox">` | Composite: `{ role: 'combobox', name: 'Search' }` + child `{ role: 'listbox' }` + grandchildren Options |
| `<div role="radiogroup" aria-label="Gender">` + 2× `<div role="radio">` | Composite: `{ role: 'radiogroup', name: 'Gender' }` + children `{ role: 'radio', name: 'Male' }`, `{ role: 'radio', name: 'Female' }` |
| `<div class="oxd-select-wrapper">` (no role) | Framework adapter detects OXD dropdown → creates combobox composite |

### What Does NOT Get Discovered

| DOM Structure | Why Skipped |
|--------------|-------------|
| `<div class="container">` | No role, no adapter match, structural only |
| `<i class="icon">` | No role — decorative |
| `<span class="label-text">` | No role — text content only |
| `<label>` | Structural — associates with a control, not itself a control |
| `<form>` | Structural container — child controls are discovered individually |

---

## 4. How Are Controls Updated As the DOM Changes?

A **continuous MutationObserver** watches the entire document (and all 
shadow roots) for:
- `childList` — elements added or removed
- `attributes` — attribute changes (role, aria-*, class, value, checked)
- `subtree: true` — observe all descendants

### Update Flow

```
MutationObserver fires:
  For each mutation:
    ┌─ childList (element added):
    │   → discoverControls(addedElement)
    │   → if new controls found, add to Model
    │   → update parent composite's childIds
    │
    ├─ childList (element removed):
    │   → find ControlNode whose DomBinding.element was removed
    │   → attempt re-bind (see §6: Identity Stability)
    │   → if re-bind fails: mark control as destroyed
    │
    ├─ attributes (role changed):
    │   → control may have changed type — re-evaluate
    │   → update ControlNode.role and capabilities
    │
    ├─ attributes (aria-expanded changed):
    │   → update ControlNode.state.expanded
    │   → if expanded: child controls (listbox options) may now be in DOM → discover
    │   → if collapsed: child controls removed → destroy (or mark hidden)
    │
    ├─ attributes (aria-checked/aria-selected changed):
    │   → update ControlNode.state
    │
    ├─ attributes (class changed):
    │   → framework adapter re-evaluation (class change may indicate state change)
    │   → e.g., OXD adds 'oxd-checkbox-checked' class
    │
    └─ attributes (value changed on input):
        → update ControlNode.state.value
```

### Performance Considerations

- **Debouncing**: Mutations are batched by the browser (microtask). We 
  process the batch, not individual mutations.
- **Scope**: Only observe `role`, `aria-*`, `class`, `value`, `checked`, 
  `disabled`, `hidden`, `style[display]` attribute changes — not all 
  attributes.
- **Lazy shadow roots**: Observe `document.body` + all open shadow roots. 
  Closed shadow roots' contents appear in mutations if they're descendants 
  of observed roots.
- **Reconnection**: If a re-render replaces a large subtree, we walk only 
  the new subtree, not the entire document.

---

## 5. How Are Controls Removed?

```
Control removal triggers:
  1. DOM element removed (MutationObserver childList)
  2. ARIA role removed (mutation → re-evaluate → no longer a control)
  3. Parent composite collapsed (e.g., dropdown closed → options removed)
  4. Page navigation (all controls destroyed, new page discovered)
```

### Removal Protocol

```
onControlRemoval(controlId):
  1. Attempt re-bind: search nearby DOM for a semantically equivalent element
     (same role + same accessible name + same locator fingerprint)
  2. If re-bind succeeds: update DomBinding, mark control as 'rebound'
  3. If re-bind fails:
     a. Mark control as 'destroyed'
     b. Remove from parent's childIds
     c. Destroy child controls (cascade)
     d. Remove from all indexes
  4. If the destroyed control was inside an active lifecycle
     (e.g., user was mid-dropdown-selection): notify lifecycle engine
```

---

## 6. How Are Stable Identities Maintained Across Re-renders?

This is the hardest problem. React, Vue, Angular, and Svelte all routinely 
destroy and recreate DOM elements during re-renders. The `<input>` element 
the user typed into at timestamp T1 may be a different DOM node at T2, even 
though it's "the same input field."

### Identity Strategy: Semantic Fingerprint, Not DOM Reference

Each Control has a **controlId** that is derived from its semantic 
properties, not its DOM node:

```
controlId = hash(
  role + ':' + accessibleName + ':' + treePath + ':' + frameUrl
)
```

Where `treePath` is the sequence of ancestor control roles+names from root:

```
For the "First Name" text input in the PIM form:
  treePath = "region:Main > form:Personal Details > textbox:First Name"
  controlId = hash("textbox:First Name:region:Main > form:Personal Details > textbox:First Name:<page-url>")
```

### Re-binding After Re-render

When a DOM element is removed (MutationObserver fires), we don't 
immediately destroy the Control. Instead:

```
onElementRemoved(removedElement):
  1. Find ControlNode bound to this element
  2. Start a re-bind grace period (200ms)
  3. Within the grace period, if a MutationObserver fires adding a new 
     element to a similar location:
     a. Compute semantic fingerprint of the new element
     b. If it matches the removed control's fingerprint → re-bind
     c. Update DomBinding.element to the new element
     d. Control identity preserved — controlId unchanged
  4. If grace period expires without re-bind → destroy control
```

### What Makes a Fingerprint Match

A re-bind succeeds when the new element has:
- **Same role** (both are `textbox`)
- **Same accessible name** (both are labeled "First Name")
- **Same or adjacent tree position** (parent composite is the same form)

This handles:
- **React reconciliation**: same component re-renders, new DOM node, same 
  semantic properties → re-bind succeeds
- **Conditional rendering**: element disappears and reappears → grace 
  period handles brief absence
- **List reordering**: elements move but maintain role+name → identity 
  preserved, position updated

### What Breaks Identity (Acceptable Limitations)

- **Dynamic accessible names**: A button labeled "Edit" that becomes "Save" 
  after clicking. The role+name fingerprint changes. This is correct — the 
  control's identity DID change from the user's perspective.
- **Positional identity**: If two identical inputs ("Phone Number") exist 
  in a list and items are reordered, fingerprint alone can't distinguish 
  them. `data-testid` or `name` attributes are the fallback for 
  disambiguation.

### Virtualisation (AG Grid, react-window)

Virtualised lists create/destroy DOM nodes as the user scrolls. Each row 
is a real DOM element when visible. The Control Model handles this 
naturally:
- When a virtualised row scrolls into view → DOM node added → Control 
  discovered
- When it scrolls out → DOM node removed → grace period → destroyed (correct)
- When it scrolls back → new DOM node → same fingerprint → new Control 
  with same semantic identity (correct — it IS the same logical row)

Locators for virtualised controls must use data attributes, not positional 
DOM paths. The framework adapter for AG Grid marks these controls as 
`virtualised: true` so the output stage knows to use row data attributes.

---

## 7. How Are Composite Controls Represented?

Composite controls are the most important architectural concept. They 
represent the **logical control boundary** — the thing the user perceives 
as a single interaction unit.

### Representation

A composite control is a ControlNode with:
- `kind: 'composite'`
- `expectedChildRoles: string[]` (from W3C ownership table)
- `childIds: string[]` (actual child control IDs)
- `state.expanded` (for expandable composites)

### W3C Ownership Table

```
COMPOSITE_OWNERSHIP = {
  combobox:    { owns: ['listbox'], popup: true },
  listbox:     { owns: ['option'], popup: false },
  menu:        { owns: ['menuitem', 'menuitemcheckbox', 'menuitemradio'], popup: true },
  menubar:     { owns: ['menuitem', 'menuitemcheckbox', 'menuitemradio'], popup: false },
  radiogroup:  { owns: ['radio'], popup: false },
  tablist:     { owns: ['tab'], popup: false },
  tree:        { owns: ['treeitem'], popup: false },
  treegrid:    { owns: ['row'], popup: false },
  grid:        { owns: ['row'], popup: false },
  row:         { owns: ['gridcell', 'rowheader', 'columnheader'], popup: false },
  dialog:      { owns: ['*'], popup: false },  // owns everything inside it
  group:       { owns: ['*'], popup: false },  // general grouping
};
```

### Popup Composites

Comboboxes and menus are **popup composites** — their children exist in the 
DOM only when expanded. This is critical:

```
Combobox "Nationality" (collapsed):
  ControlNode { role: 'combobox', state.expanded: false, childIds: [] }

User clicks combobox → aria-expanded="true" → MutationObserver fires:

Combobox "Nationality" (expanded):
  ControlNode { 
    role: 'combobox', 
    state.expanded: true,
    childIds: ['listbox-1']
  }
  ControlNode { role: 'listbox', parentId: 'combobox-1', childIds: ['opt-1', 'opt-2', ...] }
  ControlNode { role: 'option', name: 'American', parentId: 'listbox-1' }
  ControlNode { role: 'option', name: 'British', parentId: 'listbox-1' }
  ...
```

The lifecycle engine subscribes to composite expansion — when a combobox 
expands, it knows to expect an option selection. When the option is 
selected, the lifecycle commits. When the combobox collapses, the options 
are destroyed (correct — they're no longer in the DOM).

### Dialog as Composite

Dialogs are special composites — they **own all controls rendered inside 
them** and establish a **surface context**:

```
Dialog "Add Employee":
  ControlNode { role: 'dialog', kind: 'composite', childIds: [...] }
  All child controls have:
    state.surfaceContext = { type: 'dialog', controlId: 'dialog-1' }
```

This means every interaction inside a dialog is automatically scoped. The 
lifecycle engine knows that a click inside a dialog is part of the dialog 
interaction, not a random page click.

### Portal-Rendered Overlays

React Portals render overlay content into `document.body`, not into the 
component's DOM hierarchy. The Control Model handles this by:

1. Detecting `aria-modal="true"` or `role="dialog"` elements in the DOM 
   (regardless of where they're rendered)
2. Using `aria-owns` or `aria-controls` attributes to link the trigger 
   control to the portal-rendered overlay
3. If no ARIA link exists, behavioral association: "the overlay appeared 
   50ms after the trigger was clicked → associate them"

---

## 8. How Are Relationships Between Controls Represented?

### Relationship Types

| Relationship | Description | Detection |
|-------------|-------------|-----------|
| **Parent-Child** | Composite ownership | W3C ownership table + DOM hierarchy |
| **Label Association** | `<label for>` ↔ input, `aria-labelledby` | HTML/ARIA attributes |
| **Description Association** | `aria-describedby` | ARIA attribute |
| **Control Association** | `aria-controls` (trigger ↔ expanded content) | ARIA attribute |
| **Tab-Panel** | Tab ↔ associated tabpanel | `aria-labelledby` bidirectional |
| **Error Association** | `aria-errormessage` / `aria-invalid` | ARIA attribute |
| **Form Group** | Controls within the same `<form>` or `[role=form]` | DOM hierarchy |
| **Overlay-Trigger** | Dialog/popover ↔ the element that opened it | Behavioral (temporal + mutation) |

### Representation

```typescript
interface ControlAssociation {
  type: 'parent' | 'label' | 'description' | 'controls' | 'tabPanel' 
      | 'error' | 'formGroup' | 'overlayTrigger';
  targetControlId: string;
  /** How was this association detected? */
  source: 'aria' | 'html' | 'dom' | 'behavioral';
  confidence: number;
}
```

### Why Relationships Matter

When the user clicks "Female" in a radio group, the pipeline needs to know:
- This radio is inside the "Gender" radio group → the interaction is 
  "Select Female from Gender"
- Not "Click a div with role=radio and name=Female"

The Control Model encodes this: `radio-Female.parentId = radiogroup-Gender`.

---

## 9. How Does Behavioural Evidence Contribute?

Behavioural evidence enriches the Control Model in three ways:

### 9a. State Observation (continuous)

The MutationObserver tracks attribute changes that represent state:
- `aria-expanded` changes → control expanded/collapsed
- `aria-checked` / `aria-pressed` changes → toggle state
- `aria-selected` changes → selection state
- `value` attribute changes on inputs → text value
- `class` changes → framework-specific state (e.g., OXD adds 
  `oxd-checkbox-checked`)

This is **passive observation** — the Control Model updates its state 
without any user event being processed.

### 9b. Behavioural Discovery (inferential)

When accessibility semantics are incomplete, behavioural patterns reveal 
control types:

| Observed Behaviour | Inferred Control Type | Confidence |
|-------------------|----------------------|------------|
| Click on element → child list appears with selectable items → click selects one | Combobox/Dropdown | 0.8 |
| Click on element → `aria-expanded` or class toggles → click again toggles back | Checkbox/Switch | 0.7 |
| Type text in element → `value` changes → blur commits | Text Input | 0.9 |
| Hover → tooltip element appears → mouseleave → tooltip disappears | Hover Target | 0.6 |
| Scroll → element's `scrollTop` changes | Scroll Container | 1.0 |

Behavioural discovery creates controls with 
`discoverySource: 'behavioral'` and lower confidence. These can be 
upgraded to `'structural'` if ARIA roles are later added (e.g., framework 
adds role after hydration).

### 9c. Overlay Tracking

When a mutation adds a dialog/popover/dropdown to the DOM:
1. Channel D's surface detection identifies the surface type
2. The Control Model creates a composite control for the overlay
3. All controls discovered inside the overlay get 
   `state.surfaceContext = { type: 'dialog', controlId: ... }`
4. When the overlay is removed, child controls are destroyed

This means the Control Model always knows the current overlay stack — 
which dialog is on top, what controls are inside it.

---

## 10. How Are Controls Recognised When Accessibility Semantics Are Missing?

### The Three-Tier Discovery Strategy

**Tier 1: W3C ARIA Semantics (structural, confidence: 1.0)**

Direct role + name computation. Works for all ARIA-compliant components. 
This is the primary discovery mechanism.

```
<button>Save</button>
  → role: button (implicit), name: "Save"
  → Control: { role: 'button', name: 'Save', discoverySource: 'structural' }
```

**Tier 2: Framework Adapters (structural, confidence: 0.85)**

When no ARIA role is present, framework adapters inspect CSS classes and 
DOM structure to infer the role. Each adapter is a small, targeted module:

```
OXD Adapter:
  div.oxd-select-text-input[tabindex=0] → role: 'combobox'
  div.oxd-select-wrapper → composite boundary
  div.oxd-select-option → role: 'option'
  div.oxd-checkbox-wrapper → composite boundary
  input.oxd-checkbox-input → role: 'checkbox'
  div.oxd-date-input → role: 'combobox' (date picker)
  div.oxd-date-day → role: 'gridcell'

MUI Adapter:
  .MuiButtonBase-root → role: 'button' (if no explicit role)
  .MuiCheckbox-root → composite boundary
  .MuiAutocomplete-root → role: 'combobox'
  .MuiAccordion-root → expandable group

Ant Design Adapter:
  .ant-btn → role: 'button'
  .ant-select → role: 'combobox'
  .ant-checkbox-wrapper → composite boundary
  .ant-calendar → date picker composite
```

Adapters are **registered at startup** and consulted during discovery. 
They provide role inference only — they don't create a parallel model.

**Tier 3: Behavioural Inference (behavioural, confidence: 0.6)**

When neither ARIA nor adapters identify a control, behavioural patterns 
are observed over time:

```
Element receives clicks but has no role:
  → After observing click→popup→select pattern: infer combobox (0.8)
  → After observing click→toggle pattern: infer checkbox (0.7)

Element receives text input but has no role:
  → After observing focus→input→blur with value change: infer textbox (0.9)
```

Behavioural controls start with `discoverySource: 'behavioral'` and can 
be promoted to `'structural'` if Tier 1 or Tier 2 later identifies them.

### Adapter Architecture

```typescript
interface ControlModelAdapter {
  name: string;
  
  /** Quick check: is this framework present on the page? */
  detect(document: Document): boolean;
  
  /** Given a DOM element, infer its semantic role (if the adapter recognizes it) */
  inferRole(element: Element): RoleInference | null;
  
  /** Given a DOM element, detect if it's a composite boundary */
  detectComposite(element: Element): CompositeInference | null;
  
  /** Given a class change, infer a state change */
  inferStateChange(element: Element, addedClasses: string[], removedClasses: string[]): StateInference | null;
}

interface RoleInference {
  role: string;
  confidence: number;
}
```

---

## 11. How Are Iframes Represented?

### Same-Origin Iframes

- Inject the Control Model observer into each same-origin iframe document
- Each iframe has its own Control Model subtree
- Controls are tagged with `frame: { url, frameId, depth }`
- When matching events, the Event Matcher knows which frame the event 
  originated from and queries the correct subtree

```
Page Control Model:
  ├── Top-level controls (frame depth 0)
  ├── Iframe "content-frame" (frame depth 1)
  │   ├── Controls inside the iframe
  │   └── Nested iframe "widget-frame" (frame depth 2)
  │       └── Controls inside the nested iframe
```

### Cross-Origin Iframes

- Cannot inject content script (browser security policy)
- Detect cross-origin iframe boundaries via attempt + catch
- Record a placeholder ControlNode:
  ```
  ControlNode { 
    role: 'iframe', 
    name: <iframe title or src>, 
    state: { visible: true },
    discoverySource: 'structural',
    frameworkHint: 'cross-origin'
  }
  ```
- When user interacts inside the cross-origin iframe: the event is not 
  visible to our content script. The only signal is a `blur` on the 
  iframe element (focus leaves main document).
- Record: `"User interacted within iframe <name>"` — partial capture

This is a fundamental browser limitation. No recorder can capture 
interactions inside cross-origin iframes without debugger-level 
permissions. The Control Model handles it gracefully by marking the 
boundary.

---

## 12. What Is the Lifecycle of a Control?

```
                    ┌──────────────┐
                    │  DISCOVERED  │
                    │              │
   Page load or  ──►│ controlId    │
   DOM mutation     │ assigned     │
                    │ DOM bound    │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   TRACKING   │◄──────────────────┐
                    │              │                    │
                    │ State updated│   DOM mutations    │
                    │ by observer  │   update state     │
                    │              │                    │
                    └──────┬───────┘──────────────────►│
                           │                           │
              ┌────────────┼────────────┐              │
              │            │            │              │
              ▼            ▼            ▼              │
     ┌────────────┐ ┌──────────┐ ┌───────────┐        │
     │ INTERACTED │ │ REBOUND  │ │ HIDDEN    │        │
     │            │ │          │ │           │        │
     │ User event │ │ DOM node │ │ display:  │        │
     │ matched to │ │ replaced │ │ none or   │        │
     │ this       │ │ → new    │ │ aria-     │        │
     │ control    │ │ node     │ │ hidden    │        │
     └─────┬──────┘ └────┬─────┘ │           │        │
           │             │       └─────┬─────┘        │
           │             │             │              │
           │             └─────────────┤              │
           │                           │              │
           ▼                           ▼              │
     ┌──────────────────────────────────────┐        │
     │          DESTROYED                    │        │
     │                                      │        │
     │ DOM element removed, re-bind failed  │        │
     │ OR: role removed, no longer a control│        │
     │ OR: page navigation                  │        │
     │                                      │        │
     │ controlId retired                    │        │
     │ Removed from parent's childIds       │        │
     │ Children cascade-destroyed           │        │
     └──────────────────────────────────────┘        │
```

### Lifecycle States

| State | Meaning | Transition Trigger |
|-------|---------|-------------------|
| **discovered** | Just created, DOM bound | Initial discovery (page load or mutation) |
| **tracking** | Active in the model, state observed | Discovery → tracking immediately |
| **interacted** | A user event was matched to this control | Event matcher finds intersection |
| **rebound** | DOM node replaced, identity preserved | Re-render detected, re-bind succeeded |
| **hidden** | Not visible (display:none, aria-hidden, scrolled out of virtual viewport) | Mutation or scroll |
| **destroyed** | Removed from the model permanently | DOM removal without re-bind, or page navigation |

Hidden controls remain in the model (they may reappear). Destroyed 
controls are removed. The distinction matters: a collapsed dropdown's 
options are **hidden** (they'll return when expanded), not destroyed.

---

## 13. Internal Processing Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  PAGE LOAD                                                      │
│  │                                                              │
│  ├─► DOM Observer starts (MutationObserver on document +       │
│  │   all shadow roots, observing childList + attributes)        │
│  │                                                              │
│  ├─► Discovery Walk: traverse DOM, compute roles + names,      │
│  │   create ControlNodes, build parent-child relationships      │
│  │                                                              │
│  ├─► Framework adapters consulted for non-ARIA elements         │
│  │                                                              │
│  └─► Control Model is populated and ready                      │
│                                                                 │
│  CONTINUOUS (background)                                        │
│  │                                                              │
│  ├─► DOM Observer fires on mutations                           │
│  │   ├─► New elements → discover controls                      │
│  │   ├─► Removed elements → attempt re-bind or destroy         │
│  │   ├─► Attribute changes → update control state              │
│  │   └─► Overlay appearance → create dialog/menu composites    │
│  │                                                              │
│  └─► Control Model is always current                           │
│                                                                 │
│  USER EVENT (on demand)                                         │
│  │                                                              │
│  ├─► Browser fires DOM event (click, input, focus, etc.)      │
│  │                                                              │
│  ├─► Event Matcher:                                            │
│  │   ├─► Get event.composedPath()                             │
│  │   ├─► For each element in path, check if it's bound to     │
│  │   │   a ControlNode (via WeakRef → element lookup)          │
│  │   ├─► If exact match: that's the control                    │
│  │   ├─► If no exact match: walk path looking for parent       │
│  │   │   composite (the click was on a decorative child)       │
│  │   ├─► If still no match: behavioral fallback (create a     │
│  │   │   tentative control with discoverySource: 'behavioral') │
│  │   └─► Result: ControlInteraction {                          │
│  │         control: ControlNode,                               │
│  │         eventType: 'click',                                 │
│  │         event: DOMEvent,                                    │
│  │         timestamp: string,                                  │
│  │         valueBefore: string | null,                         │
│  │         stateBefore: ControlState,                          │
│  │       }                                                     │
│  │                                                              │
│  ├─► State Observer:                                           │
│  │   ├─► Wait for post-event mutations (50ms window)          │
│  │   ├─► Capture state changes (value, checked, expanded)     │
│  │   └─► Result: stateAfter: ControlState                      │
│  │                                                              │
│  ├─► Lifecycle Engine:                                         │
│  │   ├─► Receives ControlInteraction                           │
│  │   ├─► Checks active lifecycles (is a dropdown open?)        │
│  │   ├─► Determines if this completes/sustains/cancels        │
│  │   └─► Result: SemanticAction (or nothing if internal)      │
│  │                                                              │
│  ├─► Enrichment:                                               │
│  │   ├─► Maps ControlNode → component type                     │
│  │   ├─∘ Maps control name + parent → business meaning          │
│  │   └─∘ Result: EnrichedAction                                │
│  │                                                              │
│  └─► Output:                                                   │
│      ├─► Generates Playwright locator from ControlNode         │
│      └─∘ Result: PlaywrightStep                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Distinction from Current Architecture

| Aspect | Current (per-event pipeline) | Control Model |
|--------|---------------------------|---------------|
| **When is identity computed?** | At event time, per event | At discovery time, maintained continuously |
| **What is the unit of work?** | EvidenceBatch (one DOM event) | ControlInteraction (event + matched control) |
| **How is target resolved?** | Score composedPath elements | Lookup in pre-existing model |
| **How is state tracked?** | Captured per-event (valueBefore/After) | Maintained in ControlNode.state |
| **How are composites known?** | Inferred from ancestor walk | Explicit parent-child relationships in model |
| **How are overlays tracked?** | Surface detection per-event | Composite control created on mutation |
| **What survives re-renders?** | Nothing — each event is independent | ControlNode identity persists via re-binding |

---

## Summary: Why This Architecture Is Durable

| Concern | How the Control Model Addresses It |
|---------|-----------------------------------|
| **Framework changes** | The Control Model is built on W3C ARIA, not framework APIs. React→SolidJS migration doesn't change roles or accessible names. |
| **New frameworks** | Add a framework adapter (~50-100 lines). Core model is unchanged. |
| **Re-renders** | Semantic fingerprint re-binding preserves identity. |
| **Shadow DOM** | `composedPath()` traverses shadow boundaries; observer covers shadow roots. |
| **Portals** | ARIA roles + behavioral association link triggers to portal content. |
| **Virtualisation** | Controls are created/destroyed as DOM nodes appear/vanish. Identity is semantic, not positional. |
| **Non-ARIA frameworks** | Three-tier discovery: ARIA → adapter → behavioral inference. |
| **Cross-origin iframes** | Graceful degradation — boundary detected, partial capture. |
| **Performance** | Observer is debounced; discovery walks only mutated subtrees; events are lightweight model lookups. |
| **Extensibility** | New control types, relationships, and capabilities are additive. The model is data, not code. |

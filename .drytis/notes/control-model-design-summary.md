# Control Model Design — Summary

## What Is It
A live, semantic representation of every logical UI control on the page.
Built from the DOM using W3C ARIA computation algorithms.
Maintained continuously via MutationObserver.
Consulted (not the raw DOM) when a user event arrives.

## Core Principle
The Control Model is the source of truth for "what controls exist."
Events are matched against it — not resolved from raw DOM paths.

## Key Design Decisions

### Control Definition
A logical interaction unit — not a DOM element, not a framework component.
Atomic (button, textbox, checkbox) or Composite (combobox, radiogroup, grid).

### Stable Identity
controlId = hash(role + accessibleName + treePath + frameUrl)
Re-bind after re-render: 200ms grace period, match by semantic fingerprint.
Virtualised rows: created/destroyed as DOM nodes appear/vanish (correct behavior).

### Three-Tier Discovery
1. W3C ARIA semantics (confidence 1.0) — primary, works on any ARIA-compliant page
2. Framework adapters (confidence 0.85) — OXD, MUI, Ant Design, PrimeReact, etc.
3. Behavioural inference (confidence 0.6) — infer from click→popup→select patterns

### Composite Ownership (W3C)
combobox → listbox → option
radiogroup → radio
tablist → tab (with tabpanel association)
grid/treegrid → row → gridcell
menu/menubar → menuitem
tree → treeitem
dialog → owns all controls inside it

### Popup Composites
Comboboxes/menus: children exist in DOM only when expanded.
MutationObserver detects aria-expanded change → discover/destroy child controls.
Lifecycle engine subscribes to expansion events.

### Continuous Maintenance
MutationObserver: childList + attributes(subtree) on document + all shadow roots.
Only relevant attributes: role, aria-*, class, value, checked, disabled, hidden.
Debounced (processes batch, not individual mutations).

### Event Matching
composedPath() elements checked against ControlNode DomBinding WeakRefs.
Exact match → that control.
No match → walk path for parent composite (decorative child click).
Fallback → behavioral tentative control.

### What Survives from Existing Code (~70%)
- Accessible name computation (Channel A) → Model builder
- ARIA role detection (Channel A) → Model builder  
- Value/state capture cascades → State observers
- Pattern evaluation framework → Stays, patterns rewritten
- Lifecycle engine → Stays, simplified by model context
- Framework adapters → Stay, feed the model
- Dedup, semantic action builder → Stays unchanged

### What Gets Replaced (~30%)
- resolveTarget() → Control Model Matcher (lookup, not scoring)
- EvidenceBatch → ControlInteraction (references pre-existing control)
- Per-event channel invocation → Split into Model Builders + State Observers
- Pattern signal vocabulary → Rewritten to match Control Model properties

## 20 Interaction Types Covered
Button, Text Entry, Dropdown, Searchable Dropdown, Date Picker, Radio, Checkbox,
Toggle Switch, Hover, Scroll, Navigation, Dialog/Modal, File Upload, Drag & Drop,
Multi-select, Tree View, Context Menu, Tabs, Tables/Grids, Rich Text Editor.

## Cross-Platform
Shadow DOM (open+closed) ✅, Nested Shadow ✅, Same-origin iframes ✅,
Cross-origin iframes ⚠️ (partial), Portal overlays ✅, Virtualisation ✅.

## Durability
Built on W3C standards, not framework APIs. React→SolidJS migration doesn't
change roles or accessible names. New frameworks need only a ~50-100 line adapter.

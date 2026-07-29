# Component-Aware Semantic Reasoning — InteractionSessions

## Goal

Evolve the semantic reasoner from event-level merging to **component-scoped reasoning**. The recorder should describe **what the user accomplished**, not which browser events occurred.

The current reasoner (`src/classifier/semantic/reasoner.ts`) handles 3 component types (dropdown, datePicker, autocomplete) + navigation lookback. It emits `DetectedInteraction[]` with the same 38-type union.

This spec adds two new component session types that reason about complete component workflows:

1. **MultiConfig** — multi-field panels where the user adjusts several controls inside one component, then clicks "Done"/"Apply". Emits one interaction carrying a `fields` dictionary.

2. **FormSubmit** — a sequence of form-field interactions followed by a submit action that causes navigation. Emits field-level interactions enriched with the fact that they were part of a submitted form, plus a navigation interaction that carries the submit context.

## Architecture Decision: Extend Existing Reasoner

**NOT** creating a new parallel implementation. Extending the existing `src/classifier/semantic/` reasoner with:
- Two new `ComponentType` values: `'multiConfig'`, `'formSubmit'`
- Panel-boundary detection for MultiConfig activation
- Form-field accumulation for FormSubmit tracking
- Richer output metadata (fields dictionary, submit context)
- Updated `actionDescription()` in `timeline-renderer.ts` for new output shapes

The reasoner still emits `DetectedInteraction[]` (same interface). The new component types enrich `metadata` with semantic data rather than changing the type system.

## Insertion Point

```
mergeV1V2() → DetectedInteraction[]
    ↓
SemanticReasoner (EXISTING — extended)
  Input:  DetectedInteraction[] + SessionEvent[]
  Output: DetectedInteraction[] (with richer metadata for config/form workflows)
    ↓
buildIRPlan({ interactions: semanticallyRefined })
```

No changes to the IR bridge or side panel needed — they read `DetectedInteraction` which hasn't changed shape.

## New Component Types

### MultiConfig

**Activate Signal:** Click that opens a panel containing multiple interactive controls (dropdowns, steppers, radio groups, toggles). Detected via:
- Surface type = `popover` or `drawer` after a click
- The opened surface contains ≥2 interactive child elements (inputs, selects, buttons with +/- labels, radio groups)
- OR: framework-specific patterns (e.g., AdaniOne's class `flight-options-dropdown`, `cabin-class-selector`)

**Sustain Phase:** While the panel is open, all interactions on elements INSIDE the panel boundary are accumulated into a `fields` dictionary:
```
{ "Cabin Class": "Premium Economy", "Adults": 2, "Children": 0 }
```

**Completion Signal:**
- Click on a button with accessibleName matching: `Done`, `Apply`, `Confirm`, `OK`, `Search`, `Update`
- Click outside the panel (outside-click)
- Escape key
- Panel closes (mutation observer detects panel removed from DOM)

**Absorb:** All interactions on elements within the panel boundary. The "Done" click is absorbed as the completion signal (not emitted separately).

**Output:** One `DetectedInteraction` with:
- `type: 'Click'` (re-used — no new InteractionType added)
- `metadata.semanticAction: 'configure'`
- `metadata.configuredFields: { field: value, ... }`
- `metadata.panelLabel: "Flight Options"` (derived from the trigger's accessibleName or the panel's title)
- `target`: the trigger element (for locator purposes)

### FormSubmit

**Activate Signal:** A `TextEntry` interaction on an element with a password-like field name or type (`type=password`, name contains `password`/`passwd`/`pwd`), OR a `TextEntry` on a field inside a `<form>` that also contains a submit button.

**Sustain Phase:** Accumulate all `TextEntry` interactions that occur before a submit click within the same form scope.

**Completion Signal:** Click on an element with `type=submit` or accessibleName matching submit keywords (`Login`, `Sign In`, `Submit`, `Save`, `Register`, `Continue`), followed by a `PageNavigation` within 3s.

**Absorb:** Nothing is absorbed — form field entries are emitted as normal `TextEntry` interactions. The reasoner ENRICHES them with `metadata.formContext: { formId, submitAction }` rather than suppressing them.

**Output:**
- Form field entries: enriched with `metadata.formContext`
- Submit click + navigation: merged into a single `PageNavigation` with `metadata.submitContext: { action: 'Login', triggeredBy: <submit element> }`

This is lighter-weight than MultiConfig — it enriches rather than collapses.

## Panel Boundary Detection

### DOM-level (from DomContext on raw events)

The reasoner accesses `DomContext` via the event lookup. When a click opens a surface (popover/drawer), the event's `domContext.surfaceType` is set. The reasoner tracks:

1. **surfaceOpening:** Click event with `surfaceType='popover'|'drawer'` in the click's own domContext
2. **panelScope:** The CSS selector or ancestor chain of the surface element
3. **isInsidePanel(element):** Check if a subsequent interaction's target shares the same panel ancestor

### Heuristic fallback (when DOM context is insufficient)

If the surface type isn't detected by the recorder, use proximity heuristics:
- Consecutive interactions on elements whose `ancestorRoles` overlap at a non-body level
- A burst of interactions (≥3) on different elements within 500ms of each other, followed by a "Done"/"Apply" click

### CSS class patterns for panel detection

```
PANEL_OPEN_CLASSES = [
  'flight-options', 'cabin-selector', 'passenger-selector',
  'preferences-panel', 'filter-panel', 'config-panel',
  'dropdown-panel', 'popover-content', 'drawer-content',
]
```

## Detailed Processing Flow (Extended)

```
For each interaction in the stream:
  0. Navigation → tryNavigationMerge (existing)
  1. cleanupStale (existing)
  2. checkCancellation (existing)
  3. checkCompletion:
     - dropdown/datePicker/autocomplete (existing)
     - multiConfig: is Done/Apply/outside-click within panel?
     - formSubmit: is submit click + navigation?
  4. checkAbsorption:
     - existing types (existing)
     - multiConfig: is interaction inside panel boundary?
  5. checkActivation:
     - autocomplete > datePicker > dropdown (existing)
     - multiConfig: click that opens panel with ≥2 controls
     - formSubmit: password-type text entry
  6. checkEnrichment (NEW):
     - formSubmit active: enrich TextEntry with formContext
  7. pass through (existing)
```

## Real-World Workflows to Validate

### OrangeHRM "My Info" — Full Workflow

| Step | User Action | Expected Semantic Interaction |
|------|------------|-------------------------------|
| 1 | Navigate to OrangeHRM login | `Navigate to opensource-demo.orangehrmlive.com` |
| 2 | Enter username "Admin" | `Enter Username "Admin"` |
| 3 | Enter password "admin123" | `Enter Password "admin123"` |
| 4 | Click Login | `Navigate to .../dashboard` (merged click+nav, submitContext: Login) |
| 5 | Click My Info | `Click "My Info"` |
| 6 | Navigate to personal details | `Navigate to .../viewPersonalDetails/empNumber/7` |
| 7 | Edit First Name | `Enter First Name "Kirubakaran"` |
| 8 | Edit Last Name | `Enter Last Name "Loganathan"` |
| 9 | Select Nationality dropdown | `Select "Belgian" from "Nationality"` |
| 10 | Select Marital Status dropdown | `Select "Single" from "Marital Status"` |
| 11 | Select Gender = Female radio | `Select "Female"` (RadioButton) |
| 12 | Select Date of Birth | `Select date "2023-10-21" (Date of Birth)` |
| 13 | Click Save | `Click "Save"` |

### AdaniOne Flight Options — MultiConfig

| Step | User Action | Expected Semantic Interaction |
|------|------------|-------------------------------|
| 1 | Click flight options dropdown trigger | (absorbed — session starts) |
| 2 | Click Economy radio | (absorbed — field recorded) |
| 3 | Click + to increase Adults | (absorbed — field recorded) |
| 4 | Click Premium Economy radio | (absorbed — field updated) |
| 5 | Click Done | `Configure Flight Options: Cabin Class=Premium Economy, Adults=2` |

### OrangeHRM Nationality — Dropdown Session

| Step | User Action | Expected Semantic Interaction |
|------|------------|-------------------------------|
| 1 | Click Nationality dropdown | (absorbed — session starts) |
| 2 | Scroll through options | (absorbed — noise) |
| 3 | Click "Belgian" option | `Select "Belgian" from "Nationality"` |

### OrangeHRM Date Picker — DatePicker Session

| Step | User Action | Expected Semantic Interaction |
|------|------------|-------------------------------|
| 1 | Click Date of Birth input | (absorbed — session starts) |
| 2 | Click next month navigation | (absorbed — internal nav) |
| 3 | Click day "21" cell | `Select date "2023-10-21" (Date of Birth)` |

## Files to Create/Modify

### New
- `src/classifier/semantic/panel-detectors.ts` — Panel boundary detection, MultiConfig activation/completion
- `src/classifier/semantic/form-detectors.ts` — FormSubmit activation/completion/enrichment
- `tests/component-aware-reasoning.test.ts` — Comprehensive integration tests

### Modified
- `src/classifier/semantic/types.ts` — Add `'multiConfig' | 'formSubmit'` to ComponentType, add session fields
- `src/classifier/semantic/detectors.ts` — Export shared helpers (hasClassPattern, etc.)
- `src/classifier/semantic/reasoner.ts` — Add MultiConfig + FormSubmit handling, add checkEnrichment step
- `src/sidepanel/timeline-renderer.ts` — Render `configure` and enriched navigation descriptions

## Acceptance Criteria

### MultiConfig (AdaniOne Flight Options)
- [ ] Click opening panel with ≥2 controls activates a multiConfig session
- [ ] All interactions inside the panel are absorbed (not emitted separately)
- [ ] "Done"/"Apply" click completes the session and is absorbed
- [ ] Output is one interaction with `semanticAction: 'configure'` and `configuredFields` dictionary
- [ ] Panel label derived from trigger accessibleName
- [ ] Outside-click cancels the session (emits absorbed interactions as-is)
- [ ] Escape cancels the session
- [ ] Timeout (15s) commits with accumulated fields

### FormSubmit (OrangeHRM Login)
- [ ] Password-type text entry activates a formSubmit session
- [ ] Preceding TextEntry interactions (username) enriched with `formContext`
- [ ] Submit click + navigation within 3s merged into one PageNavigation
- [ ] PageNavigation carries `submitContext.action` (e.g., "Login")
- [ ] Non-navigating submit (AJAX) → submit click passes through normally

### Dropdown (existing — verify still works)
- [ ] Click trigger + scroll + click option → one Select interaction
- [ ] No standalone click for the trigger
- [ ] No scroll emitted for internal dropdown scrolling
- [ ] Dismiss without selecting → trigger passes through

### DatePicker (existing — verify still works)
- [ ] Click trigger + month nav + cell click → one DatePicker interaction
- [ ] Field label resolved from form-group sibling label (not placeholder)
- [ ] No internal calendar clicks emitted separately

### General
- [ ] All existing tests pass (3788+)
- [ ] Reasoner output still emits `DetectedInteraction[]` (no type system change)
- [ ] IR bridge processes new metadata fields without breaking
- [ ] Side panel renders `configure` and enriched descriptions
- [ ] Performance: reasoning over 100-interaction stream completes in <50ms

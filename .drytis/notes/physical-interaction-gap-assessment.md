# Physical Interaction Recognition Gap Assessment

**Date**: 2026-08-05
**Purpose**: Determine if ComponentInteraction is architecturally complete for physical interaction recognition before Capability Model design begins.
**Method**: Exhaustive audit of all 13 definitions, patterns.ts, identity-extractor.ts, dom-context-extractor.ts, event-tap.ts against all WAI-ARIA roles, HTML input types, and real-world control patterns.

## Current Coverage Summary

**13 definitions** in priority order: DatePicker(10) → Dropdown(20) → Slider(25) → Checkbox(30) → FileUpload(35) → RadioButton(40) → TextEntry(50) → Hover(60) → Tab(65) → Link(70) → Scroll(110) → Navigation(120) → Click(180)

**14 event types captured**: click, mousedown, contextmenu, focus, blur, input, change, mouseenter, mouseleave, mousemove, keydown, scroll, navigation

## Gap Classification

### Tier 1 — Critical gaps (must solve before Capability Model)

#### G1: Drag-and-drop is completely invisible
- **What**: No drag/drop/pointer event listeners. HTML5 DnD and custom pointer-based dragging produce zero interactions.
- **Evidence**: event-tap.ts:296-303 registers 14 event types; dragstart/drag/dragend/drop/pointerdown/pointermove/pointerup are absent.
- **Why critical**: DnD is a fundamental physical interaction type. Card reordering, list sorting, file uploads via drop zones, Kanban boards, Trello-style apps — none can be recorded.
- **Impact on Capability Model**: The Capability Model can't infer "user reordered tasks" or "user moved card to done column" if the physical interaction is invisible.

#### G2: tabIndex not captured in DomContext — dead-code interactivity detection
- **What**: `dom-context-extractor.ts` does NOT extract `tabIndex`. Both `click.ts:31` and `hover.ts:134` hardcode `tabIndex=null` when calling `isInteractiveElement()`. The `tabIndex >= 0` detection branch in `patterns.ts:82` is dead code.
- **Evidence**: dom-context-extractor.ts:26-37 has no tabIndex field. click.ts:31 passes null. patterns.ts:82 checks tabIndex >= 0 but never receives a real value.
- **Why critical**: Custom controls that rely on `tabindex="0"` for keyboard accessibility — without ARIA roles, CSS class hints, or standard tags — are not recognized as interactive. They'll still be resolved by resolveTarget (which has its own INTERACTIVE_SELECTOR check that includes [tabindex]), but the Click definition's detectTrigger may not fire.
- **Impact**: Click definition's `isInteractiveElement` returns false for `<div tabindex="0" onclick="...">` because tabIndex is null → may miss classification.

#### G3: keydown events captured but never consumed by any definition
- **What**: `keydown` is registered in EventTap and captured into ObservedEvent.key/code, but zero definitions have `keydown` in their triggerEventTypes. All keyboard navigation (arrow keys on sliders/comboboxes, Escape to close, Tab between fields, Enter on non-button elements) is lost.
- **Evidence**: Every definition's triggerEventTypes checked — none include 'keydown'.
- **Why critical**: Keyboard accessibility testing is a major use case. Slider keyboard adjustment fires input/change but Slider only triggers on click/focus → missed. Escape closing modals → lost. Arrow key navigation in tree views → lost.
- **Impact**: Incomplete test coverage for keyboard-only user flows. Also means arrow-key-stepper adjustments on numeric inputs are invisible.

### Tier 2 — Medium gaps (should solve, won't block Capability Model design)

#### G4: menuitem, menuitemcheckbox, menuitemradio, treeitem have no definitions
- **What**: These ARIA roles are in INTERACTIVE_SELECTOR and INTERACTIVE_ROLES (so events are captured), but no definition classifies them. They all degrade to generic Click.
- **Evidence**: isCheckbox (patterns.ts:280-282) checks role='checkbox' and role='switch' but NOT 'menuitemcheckbox'. isRadio (patterns.ts:290-294) checks role='radio' but NOT 'menuitemradio'. No Menuitem or TreeItem definition exists.
- **Why medium**: These are specialized widget roles. Most web apps use standard buttons/links/divs, not ARIA menu widgets. However, enterprise apps with rich menu systems (context menus, application menus, tree navigations) will lose the control semantics.
- **Impact**: Capability Model sees "Click" instead of "Toggle menu item checkbox" → loses the toggle semantic.

#### G5: spinbutton role not caught by TextEntry
- **What**: `isTextEntry` checks `ariaRole === 'textbox'` but NOT `ariaRole === 'spinbutton'`. A `<div role="spinbutton">` with stepper buttons falls to Click.
- **Evidence**: patterns.ts:326 checks `ariaRole === 'textbox'`. spinbutton is in INPUT_TYPE_ROLE_MAP for `<input type="number">` (native → spinbutton → caught via inputType), but a custom ARIA spinbutton div is not caught.
- **Impact**: Custom number steppers (common in Angular Material, MUI, etc.) lose text-entry semantics.

#### G6: No details/summary ExpandCollapse definition
- **What**: `<summary>` maps to role=button and is in INTERACTIVE_TAGS. Clicking it produces a generic Click. The expand/collapse semantics (native disclosure widget) are not captured.
- **Impact**: Accordion/disclosure sections that use native HTML5 details are classified as plain clicks. The expand-collapse semantic effect (from M1) would still fire, but the interaction type is wrong.

#### G7: Slider keyboard adjustment missed
- **What**: Slider definition triggers only on click/focus. Keyboard arrow-key adjustment fires input/change events, which Slider doesn't listen for.
- **Evidence**: slider.ts:23 triggerEventTypes = new Set(['click', 'focus']).
- **Impact**: Slider value change via keyboard is invisible. Mouse drag works (fires click), keyboard doesn't.

#### G8: input type="color" has no classification
- **What**: `color` is not in INPUT_TYPE_ROLE_MAP → ariaRole=null. No definition recognizes it. Falls to generic Click. The selected color value is never captured.
- **Impact**: Color picker interactions lose the picker semantic and the selected color.

### Tier 3 — Low priority (nice to have, won't block)

- G9: `<datalist>` not in TAG_ROLE_MAP — works incidentally via TextEntry on host input
- G10: `<menu>` tag not in TAG_ROLE_MAP → role=null
- G11: Touch events not directly captured (relies on synthetic mouse events from browser)
- G12: `aria-haspopup="menu"/"tree"/"grid"/"dialog"` not checked by Dropdown (only "listbox")
- G13: Tab definition checks only role="tab" — no CSS class fallback
- G14: Native month/week picker UI (dropdown, not grid) — isCalendarCell won't match
- G15: href hardcoded null in Link definition — actual URL never recorded

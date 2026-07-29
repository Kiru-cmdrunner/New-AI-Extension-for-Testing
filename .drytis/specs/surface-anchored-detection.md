# Surface-Anchored Detection — Adani One Composite Components

## Context
The Adani One passenger/travel class selector (composite widget with steppers, toggles,
Done button) is captured as individual clicks instead of a single semantic interaction.
Root cause: the SemanticReasoner's multiConfig session detection relies on CSS class
matching and accessibleName keyword checks that don't match real-world widgets, and the
surface/overlay evidence collected by Evidence Channels D/E is never wired to the
DetectedInteraction metadata.

## Five Incremental Changes

### Change 1: Click Target Ancestor Resolution
**Files:** `src/recorder/deterministic-recorder.ts` (content script inline `resolveTarget`)
**What:** When a click lands on a non-interactive element (SVG icon, span, div) that has
an interactive ancestor, resolve to the ancestor instead. The current Strategy 3 returns
the raw target even when it's a bare div — this means the trigger element identity loses
the parent button's role, aria-label, and classes.

**Change:** Add a Strategy 1c that, after composedPath + parent-walk for INTERACTIVE_SELECTOR,
walks from the raw target upward looking for the nearest ancestor with a click handler
(cursor:pointer, onclick, role=button, etc.) before falling through to Strategy 2.
This ensures clicks on SVG icons inside buttons resolve to the button.

**Acceptance Criteria:**
- [ ] Click on SVG icon inside `<button>` resolves to the button
- [ ] Click on SVG icon inside `[role=button]` resolves to the role=button element
- [ ] Click on span inside `<div style="cursor:pointer">` resolves to the cursor:pointer div
- [ ] All existing resolveTarget tests pass unchanged

### Change 2: Surface Evidence Propagation
**Files:** `src/classifier/interaction-detector.ts`, `src/classifier/interaction-types.ts`
**What:** Propagate DomContext.surfaceType/surfaceLabel/surfaceRole into DetectedInteraction
metadata so the SemanticReasoner can use surface info for activation/absorption decisions.

**Change:** When building InteractionMetadata from a group of events, copy surface fields
from any event's DomContext into the metadata. Add a `surfaceContext` optional field to
InteractionMetadata.

**Acceptance Criteria:**
- [ ] InteractionMetadata has `surfaceContext?: { type, label, role, openedByThisInteraction } | null`
- [ ] When an event carries DomContext.surfaceType, the resulting DetectedInteraction has surfaceContext populated
- [ ] When no surface info is present, surfaceContext is null (backward compatible)
- [ ] All existing interaction-detector tests pass

### Change 3: Surface-Anchored Activation
**Files:** `src/classifier/semantic/panel-form-detectors.ts`
**What:** When a Click interaction's surfaceContext indicates it opened a surface (popover,
menu, drawer), activate a multiConfig session — regardless of CSS class names.

**Change:** Add surface-based activation check to `isMultiConfigActivation()`: if
`interaction.metadata.surfaceContext?.openedByThisInteraction` is true, activate.
Keep existing CSS class + role heuristics as fallback.

**Acceptance Criteria:**
- [ ] Click that opens a popover activates multiConfig (even without trigger CSS classes)
- [ ] Click that opens a drawer activates multiConfig
- [ ] Existing CSS-class-based activation still works for OXD-style components
- [ ] No false activations on normal link/button clicks that don't open surfaces

### Change 4: Surface-Anchored Absorption
**Files:** `src/classifier/semantic/panel-form-detectors.ts`
**What:** When a multiConfig session is active and an interaction has surfaceContext
(indicating it's inside the open surface), absorb it — regardless of target CSS classes
or accessibleName.

**Change:** Add surface-based absorption check to `shouldAbsorbMultiConfig()`: if
`interaction.metadata.surfaceContext` is populated AND `openedByThisInteraction` is false
(i.e., it's inside an already-open surface), absorb it. Keep existing absorption rules.

**Acceptance Criteria:**
- [ ] Clicks inside an open popover are absorbed when session is active
- [ ] Stepper +/- clicks inside the panel are absorbed
- [ ] Toggle button clicks inside the panel are absorbed
- [ ] Done/Apply button completes the session (existing logic)
- [ ] Click outside the panel cancels the session (existing logic)

### Change 5: Stepper Detection Enhancement
**Files:** `src/classifier/semantic/panel-form-detectors.ts`
**What:** Detect icon-only +/- stepper buttons that have no text label. Use CSS class
patterns, aria-label patterns, and parent-label context (nearest labeled ancestor).

**Change:** Enhance `shouldAbsorbMultiConfig()` to check for stepper buttons via:
1. CSS class: `plus|minus|add|remove|increment|decrement|stepper|counter|qty`
2. aria-label: `^(add|remove|increase|decrease)\\b`
3. SVG-icon-only button inside a group with a label (e.g., "Adults")
Also enhance `extractConfigField()` to correctly extract stepper +1/-1 values and
associate them with the field label from the parent container.

**Acceptance Criteria:**
- [ ] Icon-only +/- buttons with `class="plus-icon"` are absorbed as steppers
- [ ] Buttons with `aria-label="Increase Adults"` are absorbed as steppers
- [ ] Stepper value extraction produces `configuredFields: { Adults: '2', Children: '1' }`
- [ ] Non-stepper icon buttons (close X, hamburger menu) are NOT absorbed as steppers

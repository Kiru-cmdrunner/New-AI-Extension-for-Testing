# Composite Component Boundary Problem — Root Cause & Solution

**Trigger:** Adani One recording showed passenger/class selector,
steppers, and date picker not being understood semantically.

**Root cause:** NOT a missing model — a broken detection pipeline.
The `multiConfig` session type already exists and is designed for exactly
this case. The activation/absorption detectors fail to fire on Adani One
because they rely on CSS class matching and accessibleName keyword matching
that doesn't match the actual DOM. Additionally, the surface tracking
that should anchor absorption is not wired through to the reasoner.

---

## 1. The Four Specific Failures Explained

### Failure 1: Passenger/Class control recognized as click on down-arrow icon

**What happens:** User clicks the "2 • Premium Economy" header. The header
contains a chevron icon. The click target resolves to the icon `<svg>` or
`<path>` element, not the header container.

**Why multiConfig doesn't activate:** `isMultiConfigActivation()` checks:
1. CSS class patterns: `PANEL_TRIGGER_CLASSES` includes 'passenger-selector',
   'cabin-selector', 'flight-options' — but Adani One's actual class names
   don't match any of these patterns (they use hashed/generated class names
   or different naming conventions).
2. Role + class heuristic: Checks for `role=combobox|button|menuitem` +
   class containing 'options|selector|config' — but the click target is
   the icon element inside the button, not the button itself, and the
   icon doesn't carry these classes.

**Root cause:** Two problems compound:
1. **Click target resolution picks the inner element** (SVG icon) instead
   of the interactive ancestor (the button/div with the trigger role).
2. **CSS class matching is too specific** — hardcoded to known library
   patterns (OXD, Ant, MUI) that don't match Adani One's custom CSS.

### Failure 2: +/- buttons captured as generic Click instead of Increase/Decrease

**What happens:** User clicks the + button for Adults. The recorder captures
a Click on a button/icon element.

**Why absorption fails:** Even IF a multiConfig session were active,
`shouldAbsorbMultiConfig()` checks for:
```javascript
/^[+\-]$|add|remove|increase|decrease/i.test(name)
```
This checks the `accessibleName` of the click target. Adani One's +/- buttons
likely have `aria-label="Increase Adults"` or `aria-label="+"` or no label
at all (just an SVG icon). If the label is absent, the check fails.

**Root cause:** Stepper detection relies on accessibleName keyword matching,
which fails for icon-only buttons. Also, the multiConfig session is never
activated (Failure 1), so absorption is never attempted.

### Failure 3: Premium Economy selection not treated as part of Passenger/Class

**What happens:** User clicks "Premium Economy" toggle button inside the
panel. Captured as a separate RadioButton/Click interaction.

**Why absorption fails:** If the multiConfig session WERE active,
`shouldAbsorbMultiConfig()` would absorb RadioButton interactions:
```javascript
const fieldTypes = new Set(['RadioButton', 'Checkbox', 'ToggleSwitch', 'Slider']);
if (fieldTypes.has(interaction.type)) return true;
```
BUT — if the toggle is classified as a plain Click (not RadioButton) because
it's a `<div>` without `role=radio`, the absorption check misses it.

**Root cause:** Same compounding problem — session never activated (Failure 1),
AND the toggle button may not be classified as RadioButton due to missing ARIA role.

### Failure 4: Departure date captured twice (open + select)

**What happens:** User clicks the date input → calendar opens → user clicks
a date cell. Recorder captures two interactions: a Click (on the input)
and a DatePicker (on the cell).

**Why two interactions:** The DatePicker session activation
(`isDatePickerActivation()`) depends on detecting that the click target is
a date input. If the click target resolves to a wrapper div (not the `<input>`),
the DatePicker session doesn't activate. The calendar cell click then creates
a new DatePicker session from scratch, producing a second interaction.

**Root cause:** Click target resolution picks the wrapper element, and the
date input type check only fires on `<input>` elements.

---

## 2. The Common Root Cause: Surface-Blind Absorption

ALL four failures share one architectural problem:

**The SemanticReasoner makes absorption decisions using only the interaction's
target element identity and CSS classes. It does NOT use the surface/overlay
evidence that Channel D and Channel E already collect.**

Evidence Channel D (`channel-d-mutations.ts`) detects surfaces appearing
and disappearing — `SurfaceInfo` with type, role, accessibleName, direction.
Channel E detects overlay open/close events. Both produce evidence records:
`surfaceAppearance`, `surfaceDisappearance`, `overlayOpen`, `overlayClose`.

**But this evidence is not carried through to the `DetectedInteraction`.**

The `DetectedInteraction` type has:
```typescript
interface DetectedInteraction {
  interactionId: string;
  type: InteractionType;
  eventIds: string[];
  target?: ElementIdentity;      // ← only the click target
  metadata: InteractionMetadata;  // ← has surfaceLabel/surfaceRole but never populated
  confidence: number;
}
```

The `metadata.surfaceLabel` and `metadata.surfaceRole` fields exist but are
never populated from the evidence channels. The reasoner has no way to know
that "this click happened inside a popover that opened 200ms ago."

**This is the missing link.** The surface evidence exists. The absorption
logic exists. But they're not connected.

---

## 3. Do We Need a New "Composite Component" Model?

**No.** The `multiConfig` session type IS the composite component model.
It already:
- Activates on trigger click (opens a panel)
- Absorbs all interactions inside the panel
- Extracts field-value pairs from absorbed interactions
- Completes on Done/Apply button click
- Emits a single interaction with `semanticAction: 'configure'` and
  `configuredFields: { Adults: '2', Class: 'Premium Economy' }`

The problem is not the model — it's the **activation and absorption
detection** that fails to fire because:
1. It relies on CSS class matching (fragile, framework-specific)
2. It doesn't use surface evidence (the architectural blind spot)
3. Click target resolution picks inner elements instead of interactive ancestors

---

## 4. The Solution: Surface-Anchored Absorption

The fix is to connect the surface evidence that Channels D/E already collect
to the SemanticReasoner's absorption decisions. This is a pipeline wiring
fix, not a new model.

### Change 1: Propagate Surface Evidence to DetectedInteraction

Add an optional `surfaceContext` to DetectedInteraction metadata:

```typescript
interface InteractionMetadata {
  // ... existing fields ...

  /** Surface context: populated when this interaction occurred inside
   *  a surface (modal, popover, drawer) that is currently open. */
  surfaceContext?: {
    /** Type of surface the interaction occurred inside. */
    type: 'modal' | 'popover' | 'drawer' | 'menu' | 'dropdown' | 'tooltip';
    /** Locator for the surface container element (for execution context). */
    surfaceId?: string;
    /** accessibleName of the surface container. */
    surfaceLabel?: string;
    /** True if this interaction is the one that opened the surface. */
    openedByThisInteraction?: boolean;
  } | null;
}
```

This is populated by the pipeline (RecognitionPipeline or a new enrichment
step) when processing evidence batches. If Channel D detected a surface
appearance in the current or recent batch, subsequent interactions are
enriched with `surfaceContext`.

### Change 2: Surface-Anchored multiConfig Activation

Replace the fragile CSS class matching in `isMultiConfigActivation()` with
a surface-aware check:

```typescript
export function isMultiConfigActivation(interaction: DetectedInteraction): boolean {
  if (interaction.type !== 'Click') return false;

  // NEW: Surface-triggered activation — if this click caused a surface
  // (popover, drawer, menu) to appear, AND the surface contains multiple
  // interactive controls, activate a multiConfig session.
  if (interaction.metadata.surfaceContext?.openedByThisInteraction) {
    return true;
  }

  // KEEP: Existing CSS class matching as fallback
  if (hasClassPattern(interaction, PANEL_TRIGGER_CLASSES)) return true;

  // KEEP: Existing role + class heuristic
  const target = interaction.target;
  if (target) {
    const role = target.ariaRole ?? '';
    const cls = (target.className ?? '').toLowerCase();
    if ((role === 'combobox' || role === 'button' || role === 'menuitem') &&
        (cls.includes('options') || cls.includes('selector') || cls.includes('config'))) {
      return true;
    }
  }

  return false;
}
```

### Change 3: Surface-Anchored Absorption

Replace the fragile class-token-overlap check in `shouldAbsorbMultiConfig()`
with surface membership:

```typescript
export function shouldAbsorbMultiConfig(
  interaction: DetectedInteraction,
  session: ComponentSession,
): boolean {
  if (session.componentType !== 'multiConfig') return false;

  // NEW: If this interaction occurred inside a surface that is currently
  // open (tracked by the active multiConfig session), absorb it.
  if (interaction.metadata.surfaceContext &&
      !interaction.metadata.surfaceContext.openedByThisInteraction) {
    return true;  // Inside the panel — absorb
  }

  // KEEP: Noise type absorption
  const noiseTypes = new Set(['PageScroll', 'ContainerScroll', 'Hover', 'Tooltip']);
  if (noiseTypes.has(interaction.type)) return true;

  // KEEP: Field type absorption (fallback when surfaceContext absent)
  const fieldTypes = new Set(['RadioButton', 'Checkbox', 'ToggleSwitch', 'Slider']);
  if (fieldTypes.has(interaction.type)) return true;
  if (interaction.type === 'TextEntry') return true;

  // IMPROVED: Stepper detection — check target role + icon, not just name
  if (interaction.type === 'Click') {
    if (isStepperButton(interaction)) return true;
    const name = getTargetName(interaction);
    if (/^[+\-]$|add|remove|increase|decrease/i.test(name)) return true;
  }

  return false;
}
```

### Change 4: Stepper Detection Heuristic

Add icon-based and pattern-based stepper detection for icon-only buttons:

```typescript
function isStepperButton(interaction: DetectedInteraction): boolean {
  const target = interaction.target;
  if (!target) return false;

  // Check for SVG/Icon with +/- characteristics
  const cls = (target.className ?? '').toLowerCase();
  if (/plus|minus|add|remove|increment|decrement|stepper|counter/i.test(cls)) {
    return true;
  }

  // Check for aria-label patterns common in steppers
  const label = (target.ariaLabel ?? '').toLowerCase();
  if (/^(add|remove|increase|decrease)\b/i.test(label)) {
    return true;
  }

  // Check adjacent text content (button contains "+" or "-" text/icon)
  const name = (target.accessibleName ?? '').toLowerCase();
  if (/^[+\-×]$|^plus$|^minus$/i.test(name)) {
    return true;
  }

  return false;
}
```

### Change 5: Click Target Resolution Improvement

The click target often resolves to an inner element (SVG icon, span) instead
of the interactive ancestor (button, role=button div). Add a "resolve to
interactive ancestor" step in the event tap or identity extractor:

```typescript
function resolveToInteractiveAncestor(element: Element): Element {
  let current: Element | null = element;
  while (current && current !== document.body) {
    if (isInteractiveElement(current)) {
      return current;
    }
    current = current.parentElement;
  }
  return element;  // Fallback to original
}
```

This ensures that clicking an SVG icon inside a button resolves to the
button itself, carrying the correct role, aria-label, and classes.

---

## 5. Impact on Phase 0 SemanticInteraction Freeze

These changes are **entirely within the detection pipeline** (SemanticReasoner,
detectors, event tap). They do NOT change:

- The SemanticInteraction contract (22+ fields)
- The InteractionType enum (40 types)
- The IRAction enum (10 actions)
- The IR Bridge
- The IR Executor
- The Capability model
- The Repository interfaces

The only type-level change is adding `surfaceContext` as an optional field
on `InteractionMetadata` — which is already a rich, extensible interface
with 30+ optional fields.

**This validates that Phase 0 can proceed as designed.** The composite
component problem is a detection pipeline fix, not a model redesign.

---

## 6. Why multiConfig Is Already the Right Model

The `multiConfig` session type is architecturally equivalent to what a
"Composite Component" model would be:

| Requirement | multiConfig Implementation |
|-------------|---------------------------|
| Trigger opens a panel | `isMultiConfigActivation` — click that opens a surface |
| Internal events absorbed | `shouldAbsorbMultiConfig` — all events inside panel |
| Field-value extraction | `extractConfigField` — maps interaction type to field+value |
| Done/Apply completes | `isMultiConfigCompletion` — keyword matching on Done/Apply |
| Result: single interaction | `buildMultiConfigInteraction` — collapses to one interaction |
| Configured fields carried | `metadata.configuredFields: Record<string, string>` |
| Semantic action | `metadata.semanticAction: 'configure'` |
| Outside-click cancellation | `cancelMultiConfigOnOutsideClick` |

Adding a separate "Composite Component" model would duplicate this
architecture. Instead, the fix is to make multiConfig activation and
absorption **reliable** by connecting the surface evidence that already
exists.

---

## 7. Implementation Plan (Phase 0 Pre-Work)

These fixes should be done BEFORE Phase 0 because they validate that the
session model works for real-world composite components:

### Step 1: Surface Evidence Propagation (1-2 days)
Wire Channel D/E surface evidence through to `InteractionMetadata.surfaceContext`.
This is a pipeline wiring change — the evidence already exists, it just needs
to be carried to the interaction.

### Step 2: Surface-Anchored Activation + Absorption (1-2 days)
Replace CSS-class-based activation with surface-triggered activation.
Replace class-token-overlap absorption with surface-membership absorption.

### Step 3: Stepper Detection Enhancement (0.5 day)
Add icon-based and aria-label-based stepper detection for icon-only buttons.

### Step 4: Click Target Ancestor Resolution (0.5 day)
Add interactive-ancestor resolution in the event tap/identity extractor.

### Step 5: Adani One Validation Test (1 day)
Record the full Adani One flight search flow. Verify:
- Passenger/Class control → single multiConfig interaction
- Steppers absorbed as field adjustments
- Premium Economy absorbed as field selection
- Date picker → single DatePicker interaction

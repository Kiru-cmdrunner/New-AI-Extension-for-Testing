# Capture Guarantee v2 — Capture-First, Classify-Second

## Problem

Gen-2 ComponentRuntime silently drops discrete events when no definition's
`detectTrigger()` recognizes them. The `isInteractiveElement()` heuristic
gate fails on custom divs, SVG icons, and elements lacking standard
role/tag/tabIndex/class markers — causing real user clicks to vanish.

## Root Cause

`component-runtime.ts` `tryDiscovery()` returns `null` when all definitions
fail. The event is never emitted. There is no fallback.

## Architecture

### Invariant

> Every deliberate user action must be represented in the final interaction
> stream exactly once — either as part of a successfully recognized
> ComponentInteraction lifecycle, or as an Unclassified interaction if no
> lifecycle/definition can account for it. It must never be silently lost.

### Changes

1. **InteractionType union** — add `'Unclassified'`
2. **ComponentDefinition interface** — add optional `semanticChildRoles?: readonly string[]` and `semanticChildTags?: readonly string[]`
3. **ComponentRuntime** — add:
   - `DISCRETE_ACTION_TYPES` constant: `['click', 'contextmenu', 'mousedown', 'keydown']`
   - Generic `lifecycleOwnsTarget()` function: positive ownership test using W3C roles + DOM-traversed ancestorRoles
   - Unclassified fallback when `tryDiscovery()` fails on discrete events
4. **Dropdown / DatePicker** — declare semanticChildRoles/Tags, capture surfaceRole from aria-haspopup
5. **output-adapter.ts** — Unclassified in production filter (always true), Unclassified in toIRAction (handle by physicalEventType, null for unsupported)
6. **Side panel** — Unclassified display

### Absorption Rule (lifecycleOwnsTarget)

Active lifecycle may absorb a different-target discrete event ONLY when BOTH:

- **Part 1 — Semantic child**: target has a declared `semanticChildRoles` role or `semanticChildTags` tag
- **Part 2 — Surface containment**: target's `domContext.ancestorRoles` includes the lifecycle's `surfaceRole`

Both proven via W3C-standard signals. No framework heuristics. No `isInteractiveElement()`.
When uncertain, fall through.

### Surface Role Capture

Lifecycle stores `ctx.data.surfaceRole` at trigger time from
`event.domContext.ariaHasPopup` (e.g., `'listbox'` for Dropdown, `'grid'` for DatePicker).
If absent, surfaceRole is null → all surface clicks fall through → safe.

## Files Changed

- `src/shared/component-types.ts` — Unclassified type, semanticChildRoles/Tags
- `src/runtime/component-runtime.ts` — DISCRETE_ACTION_TYPES, lifecycleOwnsTarget, fallback
- `src/definitions/dropdown.ts` — semanticChildRoles/Tags, surfaceRole capture
- `src/definitions/date-picker.ts` — semanticChildRoles/Tags, surfaceRole capture
- `src/presentation/output-adapter.ts` — Unclassified cases
- `src/sidepanel/interaction-renderer.ts` — Unclassified display

## Acceptance Criteria

- [ ] Unrecognized click on bare div produces Unclassified interaction
- [ ] Unrecognized contextmenu produces Unclassified with physicalEventType='contextmenu'
- [ ] Recognized click on button still produces Click (not Unclassified)
- [ ] Active lifecycle absorbs same-element click (legitimate)
- [ ] Active lifecycle absorbs option click with positive evidence (role=option + surface=listbox)
- [ ] Active lifecycle does NOT absorb color swatch / stepper button inside dropdown
- [ ] Active lifecycle does NOT absorb when surfaceRole is null (no aria-haspopup)
- [ ] No interaction duplication — discrete event produces exactly one interaction
- [ ] Unclassified passes production filter
- [ ] Unclassified click maps to IR CLICK; Unclassified keydown returns null IR
- [ ] All existing tests pass

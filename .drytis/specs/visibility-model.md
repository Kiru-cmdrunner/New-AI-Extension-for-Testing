# Interaction Visibility Model

## Goal
Introduce a consistent visibility model so the side panel shows meaningful user
workflows, not raw DOM events. Internal interaction details stay available for
debugging without cluttering the primary timeline.

## Architecture

### Four visibility tiers

| Tier | Types | Rendering |
|------|-------|-----------|
| **Primary** | TextEntry, DatePicker, Dropdown, ModalDialog, Slider, Checkbox, RadioButton, Click, KeyboardShortcut, HotkeySequence, DragDrop, FileUpload, TagInput, OtpInput, Navigation | Full-weight card |
| **Compound** | Dropdown, ModalDialog (subtypes of primary) | Full card + expandable subActions |
| **Contextual** | Scroll, Hover | Compact / dimmed card |
| **Internal** | Stepper | Never rendered as standalone card |

### Stepper removal from standalone visibility

Stepper clicks that escape their parent Dropdown/ModalDialog surface are now
captured as Click interactions with metadata `{ isStepper: true, delta: N }`.

The `isStepperPlus()` / `isStepperMinus()` helper functions stay in
`dropdown.ts` for `classifySubAction()` to use.

The standalone `stepperDefinition` is removed from `ALL_DEFINITIONS`.

### Scroll demotion to contextual

Scroll cards render with reduced visual weight: dimmed background, smaller
text, no icon emphasis. Still visible for developer awareness and viewport
tracking, but visually distinct from primary actions.

## Files to change

1. `src/definitions/stepper.ts` — remove export from `ALL_DEFINITIONS` path
2. `src/definitions/index.ts` — remove `stepperDefinition` from array
3. `src/sidepanel/interaction-renderer.ts` — add VISIBILITY_TIER map + contextual rendering
4. `src/enrichment/meaning-resolver.ts` — handle Stepper metadata in Click case
5. `src/classifier/interaction-types.ts` — keep Stepper in type union (IR/subAction still uses it)

## Acceptance criteria

- [ ] Stepper clicks inside Dropdown/ModalDialog are absorbed as subActions (no change)
- [ ] Stepper clicks outside any surface produce a Click with isStepper metadata
- [ ] No standalone Stepper cards appear in the side panel
- [ ] Scroll cards render with contextual (dimmed) styling
- [ ] All primary interactions render as full-weight cards
- [ ] Dropdown/ModalDialog cards show expandable subActions
- [ ] Full test suite passes with no regressions
- [ ] Browser testing confirms timeline matches user mental model across 5+ app types

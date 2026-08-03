# Stage 1: Production Control Model Module

## Goal
Extract the validated discovery + matching algorithms from milestone tests
into production source files under `src/recorder/v2/`. No wiring to the
extension runtime — tests only.

## Files to Create

### src/recorder/v2/types.ts
Production types for the Control Model:
- `ControlNode` — the control record (controlId, role, name, tag, classes, parentId, state, elementRef)
- `ControlState` — expanded, checked, selected, value
- `WidgetRole` / `CompositeRole` — role constant sets

### src/recorder/v2/identity-extractor.ts
W3C-based role inference + accessible name computation:
- `getRole(el)` — explicit ARIA > OXD class inference > input type > implicit tag
- `getAccessibleName(el)` — aria-label > aria-labelledby > label[for] > ancestor label walk > textContent > title > placeholder > OXD label resolution > name attr
- `isPlaceholderText(text)` — detects "-- Select --" etc.
- Export role constant maps: `IMPLICIT_ROLES`, `INPUT_TYPE_ROLES`

### src/recorder/v2/framework-adapters.ts
Framework-specific role inference:
- `oxdInferRole(el)` — OXD class → role mapping
- `isOxdWrapper(el)` — checks for OXD wrapper classes
- Export: `OXD_CLASS_ROLE_MAP`, `OXD_WRAPPER_CLASSES`, `OXD_CHECKED_CLASS`

### src/recorder/v2/control-model.ts
The production Control Model:
- `class ControlModel` with:
  - `discover(root)` — tree walk, creates ControlNodes for widget + composite roles
  - `observe(root)` — MutationObserver for dynamic elements
  - `disconnect()` — stops observer
  - `findByElement(el)` — WeakMap O(1) lookup
  - `matchEvent(targetEl)` — 3-strategy matching (ancestor walk skipping composites, lazy discovery, label-wrapper fallback)

### src/recorder/v2/index.ts
Barrel export for all public symbols.

## Tests to Port
- `tests/milestone2-validation.test.ts` → `tests/stage1-event-matching.test.ts` (import from production source)
- `tests/milestone5-acceptance-tests.test.ts` control model portion → `tests/stage1-control-model.test.ts`

## Acceptance Criteria
- [ ] AC1: All 34 event-matching tests pass importing from production source
- [ ] AC2: Control Model discovers controls across semantic HTML, OXD, MUI, Ant Design, Shadow DOM
- [ ] AC3: matchEvent correctly resolves targets (no Blood Type bug)
- [ ] AC4: Full regression suite (3,400+) passes unchanged
- [ ] AC5: TypeScript compilation clean
- [ ] AC6: Build succeeds
- [ ] AC7: Zero existing files modified (additive only)

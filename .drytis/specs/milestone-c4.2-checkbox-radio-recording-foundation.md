# Milestone C4.2 — Checkbox & Radio Button Recording Foundation

**Status:** PERMANENTLY FROZEN  
**Frozen At:** 2026-07-16T04:55:00Z  
**Depends On:** C4.1 (Checkbox & Radio Button Product Strategy — PERMANENTLY FROZEN)  
**Implements:** Recording layer only. Does NOT modify Canonical Step Generator, Readability Optimizer, Execution JSON Generator, Playwright Generator, Generation Engine, or Validation Framework.

---

## 1. Purpose

Implement the recording layer for Checkbox and Radio Button interactions per the frozen C4.1 product strategy. The recorder captures meaningful state transitions (Check, Uncheck, Select) and ignores incidental clicks that don't change state. Disabled and read-only controls are excluded. Checkbox and Radio interactions take precedence over generic Click when a meaningful state transition occurs.

## 2. Scope

### 2.1 In Scope
- New content script: `checkbox-radio-content-script.ts`
- New interaction type registrations: `checkbox` and `radio` in `interaction-types.ts`
- New message types: `CHECKBOX_CAPTURED` and `RADIO_CAPTURED`
- New SessionEvent types: `CheckboxEvent` and `RadioEvent`
- Service worker handlers for new message types
- Manifest entry for the new content script
- Canonical step generator: pass `checked` field through to `toPlainEnglish()` extras
- Unit tests covering all validation scenarios

### 2.2 Out of Scope (Explicitly Excluded)
- Canonical Test Step generation changes (beyond passing `checked` through extras)
- Readability Optimizer changes
- Execution JSON generation changes
- Playwright generation changes
- Generation Engine changes
- Validation Framework changes

## 3. Implementation

### 3.1 New Types (`src/shared/types.ts`)
- `CheckboxEvent`: `actionId`, `type: 'checkbox'`, `elementIdentity`, `checked: boolean`, `timestamp`
- `RadioEvent`: `actionId`, `type: 'radio'`, `elementIdentity`, `timestamp`
- Extended `SessionEvent` union to include both new types
- Extended `AppMessage` union with `CHECKBOX_CAPTURED` and `RADIO_CAPTURED`
- Extended `isAppMessage` type guard with new message types

### 3.2 Content Script (`src/recorder/checkbox-radio-content-script.ts`)
Implements C4.1's 5-gate decision tree:
1. **Gate 1 — Genuine Event:** `event.isTrusted === true`
2. **Gate 2 — Ownership Check:** element not already owned by `data-cmdrunner-handled`
3. **Gate 3 — Control Type:** `input[type="checkbox"]` or `input[type="radio"]`
4. **Gate 4 — State Change:** pre-state (captured at `mousedown`) vs post-state (read at `click` event) differ
5. **Gate 5 — Enabled:** `!disabled && !readOnly`

On qualifying: claims ownership via `data-cmdrunner-handled` attribute to prevent duplicate Click recording, then sends `CHECKBOX_CAPTURED` or `RADIO_CAPTURED` message.

### 3.3 Interaction Type Registration (`src/recorder/interaction-types.ts`)
- **Checkbox:** actionType=`'checkbox'`, idPrefix=`'check'`, badgeColor=`'#8b5cf6'`, badgeLabel=`'Check'`
  - toPlainEnglish: `Check "[name]"` when checked=true, `Uncheck "[name]"` when checked=false
- **Radio:** actionType=`'radio'`, idPrefix=`'radio'`, badgeColor=`'#ec4899'`, badgeLabel=`'Select'`
  - toPlainEnglish: `Select "[name]"`

### 3.4 Service Worker (`src/background/service-worker.ts`)
- `processAction` 4th parameter generalized from `textValue?: string` to `extrasData?: Record<string, unknown>`
- `TEXT_CAPTURED` handler updated to pass `{value: message.payload.value}`
- `CHECKBOX_CAPTURED` and `RADIO_CAPTURED` case handlers added following existing handler pattern

### 3.5 Manifest (`src/manifest.json`)
- Added content_scripts entry for `checkbox-radio-content-script.ts` (matches `<all_urls>`, `all_frames: true`, `run_at: document_start`)

### 3.6 Canonical Step Generator (`src/generation/generators/canonical-step-generator.ts`)
- `transformActionEvent` now extracts `checked` from the event into the extras object passed to `toPlainEnglish()`, following the same pattern as the existing `value` extraction for text events

### 3.7 Click-Content-Script Exclusion (`src/recorder/click-content-script.ts`)
- Added `CHECKBOX_RADIO_SELECTOR` constant matching the exact 7 selectors owned by the checkbox-radio recorder
- Added Decision 2b in `handleClick`: after target resolution, before ownership check, returns early if target matches checkbox/radio selector
- This structurally prevents the click-vs-change race condition where the first state change could produce both a Click AND a Check/Radio event
- The click handler never reaches `commitClick()` for any checkbox/radio target, regardless of DOM event timing

## 4. Acceptance Criteria

- [x] Checkbox state transitions recorded per C4.1 (Check when unchecked→checked, Uncheck when checked→unchecked)
- [x] Radio selections recorded per C4.1 (Select when a different radio is chosen)
- [x] Incidental clicks (no state change) not recorded
- [x] Disabled controls not recorded
- [x] Read-only controls not recorded
- [x] Programmatic state changes not recorded (isTrusted gate)
- [x] Checkbox/Radio precedence over Click (data-cmdrunner-handled ownership)
- [x] No duplicate recording (ownership claimed before message send)
- [x] Recording deterministic (existing recording session unchanged)
- [x] Existing interaction types unaffected (Click, Text, Hover, Navigation)
- [x] Full pipeline integration (Timeline → Canonical Steps → Execution JSON)
- [x] 658 tests pass, zero regressions

## 5. Permanent Regression Scenarios

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Check unchecked checkbox | `Check "[name]"` recorded |
| 2 | Uncheck checked checkbox | `Uncheck "[name]"` recorded |
| 3 | Click already checked checkbox (no change) | Not recorded |
| 4 | Disabled checkbox | Not recorded |
| 5 | Read-only checkbox | Not recorded |
| 6 | Programmatic state change | Not recorded (isTrusted=false) |
| 7 | Select radio option | `Select "[name]"` recorded |
| 8 | Select another option in same group | `Select "[name]"` recorded |
| 9 | Click already selected radio (no change) | Not recorded |
| 10 | Disabled radio | Not recorded |
| 11 | Dynamic radio groups | Recorded normally |
| 12 | Existing Click/Hover/Text/Navigation unaffected | All still work as before |

## 6. Known Limitations

1. **Checkbox/radio via custom components:** Only native `<input type="checkbox">` and `<input type="radio">` elements are detected. ARIA-role-based checkbox/radio (e.g., `role="checkbox"` on a `<div>`) are not captured — they would fall through to Click. This is an implementation detail, not a product rule limitation, and may be extended in future milestones.

**Update after review:** The content script DOES detect ARIA controls (`[role="checkbox"]`, `[role="radio"]`, `[role="menuitemcheckbox"]`, `[role="menuitemradio"]`, `[role="switch"]`). The click-content-script exclusion ensures these controls are also excluded from generic click. Only completely custom toggle components without any semantic role would fall through.

2. **Shadow DOM crossing:** Content script runs in each frame but does not cross Shadow DOM boundaries. Elements inside closed Shadow DOM are not detected.

3. **State change detection window:** Pre-state is captured at `mousedown` and compared at `change`. If a control's state is changed between these two events by a script, the comparison may produce a false negative. This is an extremely rare edge case.

4. **Label with explicit interactivity:** A `<label>` wrapping a checkbox that also has its own `[onclick]` or `[tabindex]` attribute could resolve as the click target instead of the checkbox itself. The synthetic click on the actual checkbox is still caught and excluded, but the label click would be recorded. This is a pre-existing edge case for non-standard HTML and does not affect standard `<label for>` or wrapping `<label>` usage.

## 7. Frozen Decisions Confirmed

- C4.1 state-based model (Check/Uncheck/Select) implemented as specified — no deviation
- C3.1 Hover strategy unchanged
- C3.3 Hover visibility detection unchanged
- Product Foundation (B1-B8) architecture unchanged
- Registration mechanism unchanged (same InteractionTypeConfig pattern as Click/Text/Hover)
- Recording session integration unchanged (no separate pipeline)
- Interaction ID format unchanged (ActionIdGenerator produces `check-NNNN` and `radio-NNNN`)
- Session boundaries preserved (RecordingSession.addAction used as-is)

## 8. Freeze Declaration

C4.2 is PERMANENTLY FROZEN. The recording layer for Checkbox and Radio Button interactions is complete and validated. All acceptance criteria are satisfied. The full test suite (658 tests across 26 files) passes with zero regressions. Existing frozen milestones (Product Foundation, Architecture, B1-B8, C3.1, C3.3, C4.1) remain unmodified.

**Review evidence:**
- Infrastructure verification: PASS (all 7 checks)
- Code review: PASS (all acceptance criteria, security, spec compliance)
- Post-fix re-review: PASS (race condition structurally eliminated, iframeContext parity achieved)
- Click-content-script exclusion: structurally prevents duplicate Click+Check/Radio recording

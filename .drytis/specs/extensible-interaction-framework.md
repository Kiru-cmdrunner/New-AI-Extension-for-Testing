# Extensible Interaction Framework + Batch 1 (Form Controls)

## Goal
Refactor the recording pipeline into an extensible interaction-type registry, then implement Checkbox, Radio Button, and Toggle Switch.

## Architecture Changes (Refactoring)

### 1. Interaction Type Registry (`src/recorder/interaction-types.ts`)
Central registry: each interaction type registers once with:
- `idPrefix` — for Action ID generation
- `buildPrompt(info)` — AI understanding prompt
- `toPlainEnglish(event, understanding)` — plain English description
- `executionExtras(event)` — type-specific ExecutionJson fields
- `extractAIData(event)` — type-specific ActionElementInfo fields

### 2. Pipeline Simplification
- `ai-understanding.ts`: `buildUnderstandingPrompt` → delegate to registry
- `step-builder.ts`: `generatePlainEnglish(event, understanding?)` → delegate to registry; `buildExecutionJson` → registry for extras; `ActionEvent = Exclude<SessionEvent, NavigationEvent>`
- `recording-session.ts`: Generic `addAction(rawIdentity, type, extras)`; ID generators in a Map; `updateEventWithAI` uses `event.type !== 'navigation'`
- `service-worker.ts`: `processAction` uses generic `addAction`; element info built via registry `extractAIData`

### 3. Shared Content Script Module (`src/recorder/shared/recorder-base.ts`)
Extract identity engine + recording-state sync into a shared importable module. Content scripts import it (CRXJS bundles per entry).

### 4. Base Timeline Renderer (`src/sidepanel/timeline-renderer.ts`)
`createActionElementBase(event, config)` — shared badges, identity chips, AI card. Each type provides title + badge class.

## New Interaction Types (Batch 1)

### Checkbox
- Event: `CheckboxEvent` with `isChecked: boolean`
- Capture: `change` on `input[type="checkbox"]`
- Plain English: `Check "Remember me"` / `Uncheck "Remember me"`
- Action ID prefix: `checkbox`

### Radio Button
- Event: `RadioEvent` with `isSelected: boolean`, `radioValue?: string`
- Capture: `change` on `input[type="radio"]`
- Plain English: `Select "Option A" from "Group Name"`
- Action ID prefix: `radio`

### Toggle Switch
- Event: `ToggleEvent` with `isToggled: boolean`
- Capture: `click` on elements with role="switch", aria-pressed, or common toggle classes
- Plain English: `Turn on "Dark Mode"` / `Turn off "Dark Mode"`
- Action ID prefix: `toggle`

## Acceptance Criteria

### Refactoring (no regression)
- [ ] All 316 existing tests pass unchanged in behavior
- [ ] `generatePlainEnglish` signature changed to `(event, understanding?)` — tests updated
- [ ] `ActionEvent = Exclude<SessionEvent, NavigationEvent>` — no separate union
- [ ] `updateEventWithAI` / `markEventAIFailed` use `event.type !== 'navigation'` instead of explicit type list
- [ ] Content scripts import from shared module (no inline duplication)
- [ ] Side panel uses `createActionElementBase` (no duplicated AI card code)
- [ ] Adding a new type requires only: register in registry + types + content script + manifest

### New Types
- [ ] Checkbox: change event captured, has Action ID, Element ID, AI understanding, plain English, execution JSON, saved to repository
- [ ] Radio: same
- [ ] Toggle: same
- [ ] Each new type has unique badge color in timeline
- [ ] Existing click/text/dropdown functionality works without regression
- [ ] Tests cover all 3 new types

# Refactor Click Pipeline into Shared Action Pipeline + Text Entry Recording

## Goal

1. Refactor click-specific logic into a generic, reusable action processing pipeline.
2. Implement Text Entry recording using the same pipeline.
3. Future action types (Dropdown, Checkbox, Hover, Scroll) should need only action-specific logic.

## Architecture

```
Browser Action → Content Script → Message → Service Worker
  → RecordingSession.addAction() → AIService.understand()
  → StepBuilder.buildStep() → Repository
```

## Refactor — Shared Pipeline

### R1 — Types: Generalize action types
- `SessionEvent` union: add `TextEntryEvent`
- `TextEntryEvent`: `{ actionId, type: 'text_entry', timestamp, elementIdentity, enteredText, aiUnderstanding?, aiError? }`
- `ExecutionJson.action`: widen from `'click'` to `'click' | 'text_entry'`
- Add `enteredText?: string` to `ExecutionJson`
- `AppMessage`: add `TEXT_ENTERED` variant with payload `{ identity: RawElementIdentity, enteredText: string }`
- Update `isAppMessage()` validator

### R2 — RecordingSession: Generic action methods
- Extract `updateClickWithAI` / `markClickAIFailed` into generic `updateEventWithAI(actionId, understanding)` and `markEventAIFailed(actionId, error)` that work on any event by `actionId`
- Add `addTextEntry(rawIdentity, enteredText)` → `TextEntryEvent`
- Add `textEntryIdGenerator` with prefix `'text'`

### R3 — Service Worker: Generic `processAction` pipeline
- Extract the monolithic `CLICK_CAPTURED` block into a reusable `processAction(rawIdentity, actionType, enteredText?)` function:
  1. Add event to session
  2. Build AI element info
  3. Call AIService.understand()
  4. On success: update event with AI, build step, persist
  5. On failure: mark AI failed, build degraded step, persist
- `CLICK_CAPTURED` handler calls `processAction(payload, 'click')`
- `TEXT_ENTERED` handler calls `processAction(payload, 'text_entry', enteredText)`

### R4 — AIService: Generalize element info
- Rename `ClickElementInfo` → `ActionElementInfo` (add `actionType: ActionType`, `enteredText?: string`)
- `understand()` passes actionType + enteredText to prompt builder

### R5 — AI Understanding: Action-aware prompts
- `buildUnderstandingPrompt(info)` builds different prompt text based on `info.actionType`
- Click: "Analyze the following clicked UI element..."
- Text Entry: "Analyze the following text input field..." with the entered text as context

### R6 — Step Builder: Action-aware plain English + execution JSON
- `generatePlainEnglish()` switches on action type:
  - Click: `Click the "Login Button" to submit the login form`
  - Text Entry: `Enter "admin" into the "Username" field`
- `buildExecutionJson()` widens to accept `(ClickEvent | TextEntryEvent)`, sets `action` accordingly, includes `enteredText` for text entry
- `buildStep()` widens to accept `(ClickEvent | TextEntryEvent)`

## Text Entry — New Feature

### R7 — Content Script: Text Entry Capture
- New content script: `src/recorder/text-entry-content-script.ts`
- Listens for `focusout` events on `<input>` and `<textarea>` elements
- Only captures text inputs: `input[type=text/email/password/search/url/tel/number]` and `<textarea>`
- Ignores: `input[type=button/submit/reset/checkbox/radio/range/color/file/date/hidden/image]`
- On focusout: extracts element identity (reuses same inline engine) + current `.value` as `enteredText`
- Sends `{ type: 'TEXT_ENTERED', payload: { identity, enteredText } }` message

### R8 — Manifest: Register text entry content script
- Add `text-entry-content-script.ts` to `content_scripts` array

### R9 — Side Panel: Render text entry events
- `renderTimeline()`: handle `event.type === 'text_entry'` → render with text-entry badge + entered text
- Steps render through the same pipeline — no changes needed

## Files to Change

- `src/shared/types.ts` — TextEntryEvent, widen ExecutionJson.action, TEXT_ENTERED message
- `src/recorder/recording-session.ts` — generic update/mark methods, addTextEntry
- `src/recorder/step-builder.ts` — action-aware plain English + execution JSON
- `src/ai/ai-service.ts` — ActionElementInfo (rename from ClickElementInfo)
- `src/ai/ai-understanding.ts` — action-aware prompt builder
- `src/background/service-worker.ts` — extract processAction, add TEXT_ENTERED handler
- `src/recorder/text-entry-content-script.ts` — NEW: text entry content script
- `src/manifest.json` — add text entry content script
- `src/sidepanel/sidepanel.ts` — render text_entry events in timeline

## Acceptance Criteria

- [ ] Click recording still works identically (no regression)
- [ ] Text entry is captured on input/textarea focusout
- [ ] Non-text inputs (checkbox, radio, button, submit) are ignored
- [ ] Every text entry gets a unique Action ID (text-0001, text-0002, ...)
- [ ] Every text entry gets an Element ID
- [ ] AI receives action-aware prompt (text field analysis, not click analysis)
- [ ] AI returns same schema: {businessName, controlType, userIntent, confidenceScore}
- [ ] Plain English step: `Enter "admin" into the "Username" field`
- [ ] Execution JSON has `action: 'text_entry'` + `enteredText` field
- [ ] Steps render in the side panel timeline with text-entry styling
- [ ] RecordingSession generic methods work for both click + text entry
- [ ] processAction pipeline is reused (no duplicated logic)
- [ ] All existing tests pass (257 tests)
- [ ] New tests for text entry pass
- [ ] Build succeeds

# Interaction Taxonomy Completion — P1-P2 Spec

## Overview
Implement the remaining interaction types from the taxonomy: 3 new definitions
(TagInput, OtpInput, HotkeySequence) and 5 lifecycle extensions (DateRange,
DoubleClick, TreeDropdown, RangeSlider, FreeTextAutocomplete).

## P1: New ComponentDefinitions (genuinely new lifecycles)

### P1-1: TagInput (priority 45)
**Why new lifecycle:** A TagInput creates discrete tokens from text input.
Unlike TextEntry (one string → blur), each Enter/comma/comma-separator creates
a separate token. The lifecycle spans multiple focus→type→Enter cycles on the
same input. The result is an array of tag values, not a single string.

**Trigger:** Focus on an input whose ancestor structure matches tag-input
patterns (chip/token/tag classes, role=listbox on container, aria-autocomplete).

**Active:**
- input events: accumulate text
- keydown Enter or comma: create a token from accumulated text, clear text buffer
- Multiple tokens can be created without blur

**Completion:**
- blur: complete, capturing any pending un-tokenized text as a final tag
- shouldCompleteOnOutside: true on focus elsewhere (same pattern as TextEntry)
- shouldCompleteOnFlush: true

**buildResult:** `{ tags: string[], pendingText: string, targetName }`

**Downcast:** If no tokens created and no text typed → Click.

**Subtype:** `interactionSubtype = 'TagInput'`

**isInScope:** Same element identity (same as TextEntry).

### P1-2: OtpInput (priority 46)
**Why new lifecycle:** N adjacent single-char inputs (<input maxlength=1>) must
be captured as ONE interaction, not N separate TextEntry interactions. The
grouping is by DOM proximity (adjacent inputs in same container), not by surface.

**Trigger:** Focus on an input with maxlength=1 (or similar single-char pattern).

**Active:**
- input event: record the character, auto-advance to next input (most OTP widgets do this)
- focus on adjacent input in same container: in scope (extends the session)
- Detect container via ancestorKey pattern (same as Stepper's DOM-proximity grouping)

**Completion:**
- blur to an element outside the OTP container: complete
- All N inputs filled: complete immediately
- shouldCompleteOnOutside: true on non-OTP focus

**buildResult:** `{ otpValue: string (all chars concatenated), inputCount: N, targetName }`

**Downcast:** Single OTP input with no value → Click.

### P1-3: HotkeySequence (priority 6)
**Why new lifecycle:** Some hotkeys are two-key sequences (e.g., Gmail's "g then i"
for inbox). The first keypress enters a listening state with a ~500ms timeout.
If a second key arrives, the sequence completes. If timeout, the first key
emits as a standalone KeyboardShortcut.

**Trigger:** keydown where the key matches a known prefix key (g, etc.) AND
no modifier keys are pressed. Run AFTER KeyboardShortcut (priority 5) — only
if KeyboardShortcut didn't claim it.

Actually, this needs rethinking. HotkeySequence should trigger when a plain
keydown (no modifiers, no Shift) occurs, and the key is a letter. We don't
know yet if it's a sequence prefix — the timeout will determine that.

**Better approach:** HotkeySequence detects potential prefix keys. On first
keypress: enter listening state for 500ms. If second keypress arrives:
complete as HotkeySequence. If timeout: downcast to KeyboardShortcut.

**Trigger:** keydown (non-modifier, non-Enter/Tab/Escape — those are single-use)

**Active:** waiting for second key (500ms timeout)

**Completion:**
- Second keydown within 500ms: complete as sequence
- Timeout: downcast to KeyboardShortcut with the single key

**buildResult:** `{ sequence: [key1, key2], sequenceLabel }`

## P2: Lifecycle Extensions (modify existing definitions)

### P2-1: Date Range Picker (extend date-picker.ts)
Add two-selection tracking. After first date selection, stay active. After
second date selection, complete. metadata: `{ startDate, endDate }`.

### P2-2: Double Click (wire dblclick into component runtime)
The dblclick event is already captured. Add 'dblclick' to BrowserEventType.
Click definition already exists — add a dblclick trigger that produces a Click
with interactionSubtype='DoubleClick' and metadata `{ doubleClick: true }`.

### P2-3: Tree Dropdown (extend dropdown.ts)
Add 'expandNode' and 'collapseNode' to SubActionType. Detect tree-like
expansion patterns (aria-expanded toggling on treeitem elements inside the surface).

### P2-4: Range Slider (extend slider.ts)
Track two values (min handle + max handle). When mousedown on second handle
after first handle was dragged, treat as range slider. metadata: `{ startValue, endValue }`.

### P2-5: Free-text Autocomplete (extend dropdown.ts)
When dropdown detects a fillInput subAction followed by an option selection,
set interactionSubtype='Autocomplete'. The typed text is the search query.

## Acceptance Criteria

### TagInput
- [ ] Trigger: focus on input inside tag-input container
- [ ] Token creation on Enter key
- [ ] Token creation on comma/separator key
- [ ] Multiple tokens accumulated
- [ ] blur completes with pending text as final tag
- [ ] Downcast to Click when no tokens and no text
- [ ] interactionSubtype = 'TagInput'
- [ ] metadata.tags is string array
- [ ] isInScope: same element only
- [ ] Registered in ALL_DEFINITIONS at priority 45
- [ ] InteractionType includes 'TagInput'
- [ ] Tests: trigger, token creation, multi-token, blur complete, downcast

### OtpInput
- [ ] Trigger: focus on maxlength=1 input
- [ ] Grouping by DOM proximity (ancestor container)
- [ ] Adjacent inputs in scope (extends session)
- [ ] All inputs filled → complete
- [ ] Non-OTP focus → complete
- [ ] metadata.otpValue is concatenated string
- [ ] metadata.inputCount is number of inputs
- [ ] Downcast single empty input → Click
- [ ] Registered at priority 46
- [ ] Tests: trigger, multi-input grouping, completion, downcast

### HotkeySequence
- [ ] Trigger: plain keydown on letter key
- [ ] 500ms listening window
- [ ] Second key within window → sequence complete
- [ ] Timeout → downcast to KeyboardShortcut
- [ ] metadata.sequence is [key1, key2]
- [ ] Registered at priority 6
- [ ] Tests: sequence, timeout/timeout-downcast

### Date Range Picker
- [ ] First date selection: stay active
- [ ] Second date selection: complete
- [ ] metadata: startDate + endDate
- [ ] interactionSubtype = 'DateRangePicker'
- [ ] Tests: dual selection lifecycle

### Double Click
- [ ] dblclick produces Click with doubleClick=true
- [ ] interactionSubtype = 'DoubleClick'
- [ ] Tests: dblclick detection

### Tree Dropdown
- [ ] expandNode/collapseNode subActions
- [ ] aria-expanded toggle detection
- [ ] Tests: expand/collapse lifecycle

### Range Slider
- [ ] Dual-handle tracking
- [ ] metadata: startValue + endValue
- [ ] Tests: range drag lifecycle

### Free-text Autocomplete
- [ ] fillInput + option selection = autocomplete
- [ ] interactionSubtype = 'Autocomplete'
- [ ] Tests: type-then-select lifecycle

## Wiring
Each new type must be wired through:
1. InteractionType union (component-types.ts)
2. ALL_DEFINITIONS (index.ts)
3. INTERACTION_CATEGORIES (interaction-types.ts)
4. Component-to-classifier adapter (if needed)
5. IR Bridge (ir-bridge.ts) — action mapping + description
6. Playwright adapter (action-renderer.ts) — codegen
7. Side panel renderer (interaction-renderer.ts) — display

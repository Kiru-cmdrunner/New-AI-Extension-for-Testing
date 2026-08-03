# Stage 4e: Composite Control Lifecycle — Pending Buffer Architecture

## Context

The user correctly identified a fundamental architectural issue: the V2 evidence engine
emits interactions too early for composite controls. When a standalone event (scroll,
mouseenter) arrives between a trigger click and a completion event (option click, date
cell click), the engine flushes the trigger buffer prematurely, splitting what should
be one semantic interaction into multiple fragments.

## Root Cause

The V2 engine's `processEvent()` method commits the current buffer (`flush()`) whenever
an unrelated event arrives. For composite controls like dropdowns:

```
click(dropdownTrigger) → scroll → click(option)
```

The scroll forces a flush, emitting the trigger click as a standalone interaction.
The option click starts a new buffer. The result: two separate interactions instead
of one CustomDropdown.

Same pattern affects:
- Date picker: click(trigger) → [popover mutation/scroll] → click(cell) → dateSelect
- Autocomplete: focus(input) → type → [scroll] → click(suggestion)

## Fix: Pending Buffer Architecture

Add lifecycle-aware buffering to the V2 evidence engine:

1. **`pendingBuffers: InteractionBuffer[]`** — holds composite control buffers that
   are waiting for completion events.

2. **`isPendingComposite(buffer): boolean`** — checks if the buffer contains evidence
   of a composite control trigger (dropdown, date picker, autocomplete) that hasn't
   received its completion event yet.

3. **Modified `processEvent()` flow:**
   - When a standalone/unrelated event would flush a pending composite buffer, move
     it to `pendingBuffers` instead of committing immediately.
   - Each new event checks `isRelatedToBuffer()` against BOTH the current buffer AND
     all pending buffers.
   - If related to a pending buffer, merge them back together.

4. **Stale timeout:** Buffers older than 10 seconds without completion are committed
   as-is (prevents infinite holding).

5. **Final flush:** At end of event stream, all pending buffers are committed.

## Per-Control Lifecycle

### Dropdown (combobox/listbox)
- **Activate:** click on dropdown trigger (combobox, aria-haspopup, oxd-select-text)
- **Sustain:** clicks on options, aria-expanded transitions
- **Commit:** click on option element (role=option, class*=option)
- **Cancel:** outside click, Escape, navigation, 10s stale

### Date Picker
- **Activate:** click on date trigger input/button
- **Sustain:** calendar navigation (prev/next month), calendar cell clicks
- **Commit:** dateSelect event, or change on date input, or blur with value
- **Cancel:** outside click, Escape, navigation, 10s stale

### Autocomplete / Typeahead
- **Activate:** focus on autocomplete input
- **Sustain:** typing, suggestion list interactions
- **Commit:** click on suggestion/option
- **Cancel:** blur without selection, Escape, navigation

### Checkbox / Radio (no change needed)
- These are single-element interactions — the click captures the full state
  transition via deferred checkedAfter read. No lifecycle needed.

## Acceptance Criteria

- [ ] Dropdown trigger click + scroll + option click → ONE CustomDropdown (not split)
- [ ] Date trigger click + popover + cell click → ONE DatePicker (not split)
- [ ] Pending buffers are checked for staleness (10s max)
- [ ] Non-composite buffers flush immediately as before (no regression)
- [ ] Existing tests still pass
- [ ] New tests verify the pending buffer lifecycle

# P0-7: Searchable Dropdown (Autocomplete / Typeahead)

## Problem

Searchable dropdowns (autocomplete, typeahead, combobox with search) are common
across all web frameworks — airport/city selectors, product search, user
mentions, etc. The lifecycle is:

1. User clicks combobox/search input → Dropdown triggers ✓ (already works)
2. User types a search query → **input events fire inside surface** → NOT captured
3. Filtered options appear → user clicks one → captured as selectOption ✓
4. Dropdown closes → session completes ✓

**Root cause**: `classifySubAction()` in dropdown.ts filters event types at
line 216: `if (event.eventType !== 'click' && event.eventType !== 'change')
return null;`. The `input` event type is excluded. Text inputs fire `input` on
every keystroke and `change` only on blur — so by the time the Dropdown session
completes, the search query was never captured as a subAction.

## Architecture (no new definition)

This is NOT a new ComponentDefinition. It enhances the existing Dropdown's
`classifySubAction` and `addSubAction` to:

1. **Allow `input` events** through the event type filter
2. **Replace-on-update for fillInput**: when consecutive `input` events fire on
   the same element (same cssSelector or stableId), REPLACE the previous
   fillInput subAction's value instead of appending. This gives us the final
   typed query, not one subAction per keystroke.
3. **Set `interactionSubtype = 'SearchableDropdown'`** in buildResult when
   the Dropdown has at least one `fillInput` subAction (the user typed in a
   search field inside the panel).

## Files to Change

1. `src/definitions/dropdown.ts`:
   - `classifySubAction()` line 216: add `'input'` to allowed event types
   - `addSubAction()`: add replace-on-update logic for fillInput on same element
   - `buildResult()`: set `interactionSubtype = 'SearchableDropdown'` when fillInput exists

## Acceptance Criteria

- [ ] Typing in a search field inside a Dropdown surface captures the typed
      query as a fillInput subAction with the FINAL value (not per-keystroke)
- [ ] Clicking a filtered option after typing captures as selectOption subAction
- [ ] Dropdown interactionSubtype is set to 'SearchableDropdown' when it has
      both fillInput and selectOption subActions
- [ ] Regular dropdowns (no search input) continue to work unchanged
- [ ] Multi-config dropdowns (steppers + search) capture both correctly
- [ ] Existing 4,537 tests pass (zero regressions)
- [ ] New unit tests cover: autocomplete lifecycle, per-keystroke dedup,
      subtype assignment, no interference with existing dropdowns

## Implementation Order

1. Allow `input` events in classifySubAction
2. Add replace-on-update for fillInput in addSubAction
3. Set SearchableDropdown subtype in buildResult
4. Write unit tests
5. Run full suite
6. Build + verify

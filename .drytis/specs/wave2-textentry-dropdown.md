# Wave 2 — TextEntry + NativeDropdown Migration Spec

## Goal

Validate that the Evidence Engine V2 correctly produces single interactions for:
1. Text entry (focus → blur on text input/textarea/contenteditable)
2. Native dropdown selection (click → change on `<select>` element)

Validate against real-world recording patterns, not just synthetic unit tests.

## Scope

### TextEntry
- **Input pattern**: focus(valueBefore="") → blur(valueAfter="typed text") on same element
- **With intermediate input events**: focus → input → input → blur (if suppression misses some)
- **Multiple text fields**: focus→blur on field A, then focus→blur on field B → 2 interactions
- **Text field with no change**: focus → blur where valueBefore === valueAfter → still TextEntry (user focused but didn't type)
- **Value extraction**: read valueAfter from blur event; if no blur value, fall back to last input event value
- **Element types**: `<input type="text">`, `<input type="email">`, `<textarea>`, `contenteditable`, `[role=textbox]`

### NativeDropdown
- **Input pattern**: click → change on same `<select>` element
- **Full sequence**: focus → click → change → blur on `<select>`
- **Multiple dropdowns**: select in dropdown A, then dropdown B → 2 interactions
- **Value extraction**: read valueAfter from change event
- **No change event**: click on select without selection change → Click (not NativeDropdown)

## Acceptance Criteria

- [ ] Single TextEntry interaction from focus→blur on text input
- [ ] Single TextEntry even if intermediate input events leak through
- [ ] Multiple sequential text fields produce N separate TextEntry interactions
- [ ] TextEntry metadata.textValue matches the final typed value
- [ ] Single NativeDropdown from click→change on `<select>`
- [ ] Multiple sequential dropdowns produce N separate NativeDropdown interactions
- [ ] NativeDropdown metadata.selectedValue matches the selected option
- [ ] V2 output matches V1 type-for-type on equivalent scenarios
- [ ] V2 produces equal or fewer interactions than V1 (no event splitting)
- [ ] Real-world form scenario: 2 text fields + 3 dropdowns = 5 interactions (Avis Ford pattern)

## Testing Strategy

1. Unit tests: individual provider contributions for each pattern
2. Integration tests: full engine pipeline on realistic event sequences
3. Real-world scenario tests: simulate the Avis Ford form from the screenshot
4. A/B comparison: verify V2 output types match V1 on the same event streams

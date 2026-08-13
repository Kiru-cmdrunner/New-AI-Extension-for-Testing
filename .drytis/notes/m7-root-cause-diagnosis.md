# M7 Three-Path Root Cause Diagnosis (Final)
# Generated: 2026-08-12

## Executive Summary

All three M7 failures share a common root cause class: **the evidence pipeline's
isTrusted filter (event-tap.ts:192) blocks synthetic events from Puppeteer's
automation methods (dispatchEvent, page.select, el.value=...)**, which prevents
the evidence pipeline from seeing the value-change events.

When tested with REAL trusted user interactions (keyboard navigation, real clicks),
the native select works correctly. The date picker and custom dropdown have
secondary issues beyond the test harness limitation.

---

## FAILURE 1: Date Picker — No Evidence

### Observed Browser Result
- `behavioralEvidence: null`
- `metadata.dateValue: "2024-06-15"` (from original run)

### Root Cause: TWO PROBLEMS

**Problem A — Test harness (isTrusted filter, PRIMARY):**
The test used `dispatchEvent(new Event('input/change'))` which produces
`isTrusted: false`. EventTap line 192 filters these. No ObservedEvents created,
no evidence windows opened, no evidence delivered.

With trusted keyboard events, the date input doesn't accept keyboard typing in
headless Chrome (known limitation — date inputs require the native picker UI).

**Problem B — Evidence window timing (SECONDARY, affects real users):**
Even with a trusted `change` event:
1. DatePicker lifecycle triggered by `focus` (CAPTURE_ONLY → no evidence window)
2. `change` event opens evidence window (in WINDOW_OPEN_EVENTS)
3. DatePicker.handleEvent completes the lifecycle on the SAME change event
4. At completion, drainPendingEvidence checks for pending evidence
5. The change evidence window just opened — hasn't closed yet (300ms timer)
6. drainPendingEvidence finds nothing → behavioralEvidence = null
7. 300ms later, change window closes → evidence delivered via Tier 2 attach

Step 7 DOES work — evidence arrives via attachEvidenceToInteraction Tier 2
(change eventId IS in memberEvents). So the evidence eventually attaches.

HOWEVER: if the evidence window produces null before/after snapshots (because
the focus listener didn't pre-cache the date input), the evidence has no value
diff. This is the same before-snapshot gap as the native select.

### Minimal Fix Direction
- For the before snapshot: add 'change' to the fallback capture path at line
  313-319 (currently only 'input' gets a fresh capture). This ensures change
  events on date inputs get a before snapshot even without focus-listener cache.
- For testing: use CDP Input.dispatchKeyEvent or test with a text-input style
  date field (OXD pattern) instead of native `<input type="date">`.

---

## FAILURE 2: Custom Dropdown — Selected Value Not in Evidence

### Observed Browser Result
- `before: { ariaExpanded: false, value: "Select Role" }`
- `after: { ariaExpanded: true, value: "Select Role", controlledValue: null }`
- `metadata.selectedValue: "Admin"`

### Root Cause: THREE COMPOUNDING DEFECTS

This failure occurs with TRUSTED events (real clicks). It is a genuine production
defect, not a test harness issue.

**Defect A — Two separate evidence windows (Window A vs Window B):**

Window A: opens on trigger button click (#role-btn)
- Target: #role-btn (the trigger button)
- Closes after dropdown opens (300ms quiescence after DOM mutation)
- after.value = captureValue(#role-btn) = textContent = "Select Role"
- isOptionLike = false (button, not option) → no enrichment
- Evidence: ariaExpanded false→true (correct), value unchanged

Window B: opens on option click (.dd-item)
- Target: .dd-item (the option div)
- isOptionLike = true (role="option")
- findRelatedControlValue RUNS but fails (see Defect B)
- after.value = captureValue(.dd-item) = textContent = "Admin\n    User\n    Guest"

Window B has higher richness score → REPLACES Window A.
Result: evidence shows option textContent, not the trigger button's updated value.

**Defect B — findRelatedControlValue fails for this HTML structure:**

Strategy 1 (aria-controls): option has no aria-controls → skip
Strategy 2 (closest listbox/combobox): matches #role-menu (role="listbox")
  → captureValueSafe(#role-menu) → div, no value → null
  → querySelector('input, [role="textbox"]') inside listbox → none → null
  → FAILS: trigger button is a SIBLING of the listbox, not inside it
Strategy 3 (framework-specific classes): .oxd-select-text-input etc → none match

**Defect C — Trigger button's textContent isn't captured after update:**

The trigger button's textContent changes to "Admin" when the option is clicked.
But Window A (targeting the button) already closed before the option click.
Window B targets the option, not the button. No window captures the button's
updated textContent.

### Minimal Fix Direction
In findRelatedControlValue, after finding the listbox parent (Strategy 2),
search for the trigger element among the listbox's SIBLINGS (not just children):
- Look for `[aria-haspopup]`, `[aria-expanded]`, or `button` siblings of the listbox
- OR walk up to the listbox's parent container and search for the trigger there

---

## FAILURE 3: Native Select — No Evidence with Puppeteer

### Observed Browser Result (original test)
- `before: null, after: null`
- `metadata.selectedValue: "Admin"` (wrong value)

### Root Cause: PRIMARILY A TEST HARNESS ISSUE

**Problem A — page.select() fires untrusted events:**
`page.select('#c', 'uk')` internally sets `el.value` and calls
`el.dispatchEvent(new Event('change'))`. The change event has `isTrusted: false`.
EventTap line 192 filters it. No ObservedEvent created → Dropdown lifecycle
triggered by focus never completes → abandoned → no interaction emitted.

**Verified: With trusted keyboard interaction, native select WORKS:**
```
Test: click select → ArrowDown → ArrowDown → Enter → click elsewhere
Result: int-3: Dropdown "Select \"United Kingdom\"" (completed)
  before: { value: "" } → after: { value: "uk" }
  selectedValue: "United Kingdom"
  memberEvents: ['mousedown', 'focus', 'click', 'input', 'change']
  endReason: stabilized
```

The `change` event is trusted (keyboard Enter), reaches EventTap, opens an
evidence window, and produces correct before/after value snapshots.

**Problem B — The "Admin" value leakage (explained):**
The original test's "int-6 with selectedValue=Admin" was a FALSE attribution.
The native select produced NO interaction (change event filtered). The
"Admin" value came from the custom dropdown interaction (int-3/int-5) that
ran immediately before. The original validation script's matching logic
(record function) likely matched the wrong interaction when searching for
"Country" — it found the custom Dropdown interaction instead.

### Minimal Fix Direction
No production code fix needed for the native select itself — it works correctly
with trusted events. The evidence pipeline handles `<select>` value changes
properly when real `change` events fire.

For testing: use keyboard navigation (Arrow keys + Enter/Space) instead of
`page.select()` to generate trusted change events on native selects.

---

## Summary Table

| Failure | Real Defect? | Test Harness Issue? | Blocks M7? |
|---------|-------------|---------------------|------------|
| Date Picker | Partially (before snapshot gap for change events) | Yes (isTrusted filter + headless date input limitation) | YES — needs before-snapshot fix for change events |
| Custom Dropdown | YES (findRelatedControlValue fails for sibling triggers) | No (occurs with trusted clicks) | YES — needs enrichment fix |
| Native Select | NO (works with trusted events) | Yes (page.select fires untrusted events) | NO — works in production |

## Required Fixes to Complete M7

1. **findRelatedControlValue** (evidence-collector.ts:641-683): Add sibling
   trigger search when listbox is found. Search for `[aria-haspopup]` or
   `[aria-expanded]` among listbox siblings.

2. **Before snapshot for change events** (evidence-collector.ts:313-319):
   Extend the fallback capture path from `eventType === 'input'` to also
   include `eventType === 'change'`, so date inputs and selects get a fresh
   before snapshot when the cache has no entry.

3. **Test harness**: Rewrite browser tests to use keyboard navigation for
   native selects and date inputs (trusted events only).

# M1 Behavioral Observer — Real-World Testing Findings
Date: 2026-08-03

## Test Method
Created 13 real-world UI pattern test pages with capture-phase observer injection
(simulating how the real EventTap fires onAfterEvent BEFORE page handlers).
Also tested against example.com and Amazon-style patterns.

## Results Summary

### ✅ CAPTURED (6/13 patterns)

| Pattern | Effects | Snapshot Diff | Notes |
|---------|---------|---------------|-------|
| 1. Bootstrap Dropdown | 2 (text add/remove) | — | Button text change in target subtree |
| 2. Accordion | 3 (aria-expanded + text) | aria-expanded: null→true | Attribute + text on target |
| 3. Amazon Checkbox | 2 (class + aria-checked) | class changed | **THE Amazon failure case — now captured!** |
| 6. Tab Switch | 3 (class on children) | — | Class shuffle within target subtree |
| 8. Loading Spinner | 3 (class + text) | — | Immediate changes captured |
| 11. Form Validation | 1 (class) | class changed | Self-targeted class toggle |

### ⚪ EMPTY — By Design (3/13)

| Pattern | Why Empty | Verdict |
|---------|-----------|---------|
| 5. Modal (sibling backdrop) | Class change on SIBLING element, not target subtree | **Expected — known limitation** |
| 9. Toast (sibling container) | Child added to SIBLING container | **Expected — known limitation** |
| 12. Tooltip (CSS-only) | Pure CSS :hover, zero DOM mutation | **Expected — honest null** |

### ⚠️ EMPTY — Real Limitations Found (4/13)

| Pattern | Why Missed | Root Cause | Impact |
|---------|-----------|------------|--------|
| **4. React Async Toggle (300ms)** | Mutation happens at 300ms, observer stabilizes at 200ms | **Stability window too short for async frameworks** | HIGH — React/Vue/Angular frequently batch updates with 300ms+ delays |
| **7. Dynamic List (button target)** | Mutation is on sibling list, not on clicked button | **Observer scope limited to target subtree** | MEDIUM — known limitation, but very common pattern (add-to-cart, submit-form) |
| **10. Native Select** | value is an IDL property. Change fires AFTER value already set. Pre-snapshot already has new value. | **change event timing: value set before event fires** | MEDIUM — select.value, input.value for programmatic changes |
| **8b. Loading delayed (800ms)** | Delayed content update at 800ms missed (stability at 200ms) | **Same stability window issue as #4** | HIGH — same root cause |
| **13. Element Removal** | Correctly detected endReason='element-removed' | **Works!** But no effects captured (expected) | ✅ Actually a PASS |

## Critical Findings

### Finding 1: Stability Window Too Short for Modern Frameworks (HIGH PRIORITY)
React's useState batching, Vue's nextTick, and Angular's zone.js frequently produce
DOM mutations 200-500ms after the click event. The current 200ms stability window
declares the DOM "stable" before these frameworks finish updating.

**Test case**: React toggle with 300ms setTimeout → observer finalized at 202ms with
0 effects. The class mutation at 300ms was completely missed.

**Impact**: Any interaction where the framework batches/delays state updates will have
empty behavioral observations. This is extremely common in modern SPAs.

**Recommendation for M2/M3**: Adaptive stability that extends when mutations are detected,
or a longer initial window (500ms), or activity-based detection (detect React/Vue and
extend accordingly).

### Finding 2: Sibling/Subtree Boundary Limitation (MEDIUM)
The observer watches targetEl's subtree only. Many real interactions cause mutations
on SIBLING elements (modal backdrop, toast container, result panel).

**Test case**: Modal open button → class change on #modal-backdrop (sibling).
Toast button → child added to #toast-area (sibling).

**Impact**: Common UI patterns like modals, toasts, notifications, and "load results"
panels will have empty observations.

**Note**: This is a KNOWN limitation per the spec ("Changes outside the target subtree
(siblings, ancestors, page)"). But it's so common that M2 should consider widening scope.

### Finding 3: Select/Input Value Timing (MEDIUM)
For <select> and <input>, the `change` event fires AFTER the value has already been
updated. So the pre-snapshot captures the NEW value, and the final snapshot also has
the NEW value → no diff detected.

**Test case**: Select changed to 'blue' → pre.value='blue', final.value='blue' → no diff.

**Note**: For checkboxes, this does NOT happen because click fires in capture phase
before checked toggles. But for select/input, change fires after value is set.

**Recommendation**: For change events on form elements, capture a pre-value from the
EventTap's ObservedEvent (which may carry the old value) rather than from the element
at observation time.

### Finding 4: Amazon Checkbox — RESOLVED
The original Amazon failure was: <a> tag with <i class="a-icon-checkbox">, where
captureCheckedState() inspected the <a> element only and missed the <i> child's state.

**Test result**: The M1 observer correctly captures this! It sees:
- class: "checkbox-toggle" → "checkbox-toggle checked" (on target)
- aria-checked: "null" → "true" (on child <i>, via subtree:true)

This is a direct validation that the subtree observer + attribute tracking solves
the original Amazon problem.

### Finding 5: Element Removal Works Correctly
When an element removes itself from the DOM (this.remove()), the observer correctly:
- Detects removal via parent MutationObserver
- Sets endReason='element-removed'
- Sets finalSnapshot=null (element gone)
- Reports 0 effects (no mutations before removal)

## What the Observer CAN See (Validated)
✅ Attribute changes on target (class, aria-*, style, data-*)
✅ Attribute changes on descendants (subtree:true)
✅ Child additions/removals within target subtree
✅ Character data changes within target
✅ Element removal (parent observer + isConnected fallback)
✅ Property gaps via pre/final snapshots (checked, className, childCount)
✅ Amazon-style nested checkbox state (child <i> aria-checked)

## What the Observer CANNOT See (Validated)
❌ Mutations delayed beyond 200ms stability window (React async, setTimeout)
❌ Mutations on sibling elements (modal backdrop, toast container, result panel)
❌ Computed style changes from CSS (tooltip display:none → block)
❌ select.value / input.value changes via change event (timing issue)
❌ Canvas/WebGL rendering
❌ Network activity (only sees DOM effects)

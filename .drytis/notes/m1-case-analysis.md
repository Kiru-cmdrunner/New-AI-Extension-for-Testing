# M1 Case-by-Case Analysis (13 Cases from user document)

Analysis of each case against the proposed M1 design (fixed 3s window, document-wide observer).

## Cases HANDLED by current design:

- Case 1 (checkbox self-change): Document observer catches attribute/property changes.
- Case 2 (Amazon nested <i>): Document-wide subtree observer catches descendant mutations.
- Case 3 (dropdown local): Document observer catches aria-expanded, childList, class.
- Case 5 (text field): Focus-populated cache captures "", change event opens window, final snapshot captures "Chennai". Value transition also in ObservedEvent.valueBefore/valueAfter.
- Case 6 (filter → distant results): Document-wide observer catches sidebar checkbox AND main content mutations.
- Case 8 (2800ms response): Fixed 3s window captures it.
- Case 9 (nothing happens): 3s window, 0 mutations, honest empty state.
- Case 11 (rapid interactions): Singleton observer, independent 3s windows, shared records.
- Case 12 (filter+apply sequence): Each interaction gets own window.
- Case 13 (form selections): Each interaction gets own window.

## Cases that CORRECT the design:

- Case 4: Element state cache must populate on FOCUS (before value changes), not just on window open.
- Case 7: REJECTS stability-based early closure. DOM silence doesn't prove response finished.
- Case 8: REJECTS stability-based early closure. Response near 3s boundary must be captured.
- Case 10: REJECTS shared window closure. Each window must have independent lifetime.

## KEY CORRECTION: Fixed 3-second window, no stability-based closure.

Case 7 timeline: 0ms interaction → 10ms local changes → 20ms-1499ms SILENCE → 1500ms server response → 1520ms results → 1540ms count change.

With stability design (500ms quiet + 1000ms min): last mutation at 20ms → quiet at 520ms → 1000ms elapsed → CLOSES AT 1000ms → MISSES 1500ms response.

With fixed 3s window: captures everything through 3000ms including the 1500ms response. ✓

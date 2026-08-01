# R3 Design Review — Timing Flaw and Required Design Adjustment

## Date: 2026-08-01
## Status: Critical finding — design must be adjusted before implementation

## The Flaw Discovered

R3.4 proposes post-click attribute transition capture (polling at 50/150/400ms) 
to detect class/aria changes caused by the page's click handler. The intent is 
to feed these transitions to the evidence engine for behavioral classification.

**This cannot work as designed.** The Click definition completes synchronously 
in the capture phase:

1. EventTap listener registered with `capture: true` → fires BEFORE page handlers
2. DOM snapshot taken (classes, ARIA attributes, values — all pre-handler state)
3. ObservedEvent sent to service worker
4. Click definition: `detectTrigger` → `handleEvent` returns `{ completed }` → `buildResult` → `onEmit`
5. `onEmit`: `annotateWithEvidence` runs → evidence engine classifies → persisted to storage
6. **THEN** page's click handler fires (bubble phase) — modifies classes, aria-expanded, etc.
7. Post-click poll fires at 50/150/400ms — detects changes — but Click is already frozen

No re-annotation path exists. The Click interaction is emitted, classified, and 
persisted before any post-handler behavioral data is available.

## What Actually Works Today

The existing behavioral signals that DO reach the evidence engine work because 
they're available at capture-phase snapshot time:

- `checkedBefore`/`checkedAfter`: For **native** checkboxes, the browser toggles 
  `.checked` BEFORE dispatching the click event. So at capture time, the new state 
  is already visible. This is a browser implementation detail, not a general mechanism.
- `valueBefore`: Captured at focus/mousedown time (stored in `lastFocusedValue`)
- `ariaExpanded`, `ariaHasPopup`, etc.: Present in the DomContext if they were set 
  BEFORE the click (static attributes, not handler-modified)

## What Does NOT Work

For **custom** elements (div-checkboxes, novel comboboxes) where the behavioral 
signal is created BY the page's click handler:
- Class changes (`opt` → `opt selected`) — invisible at capture time
- aria-expanded transitions (absent → `true`) — invisible at capture time
- aria-checked changes on non-native elements — invisible at capture time

These are exactly the "novel implementation" scenarios R3 targets.

## The Real Question: Is Post-Click Behavioral Capture Architecturally Required?

### Assessment Against the R3 Objective

The R3 objective: "classify interactions based on behavioral effects, not just 
structural attributes, so novel implementations are handled."

There are TWO categories of behavioral signal:

**Category A: Pre-handler behavioral signals** — available at capture time
- `valueBefore` (from focus/mousedown tracking)
- `ariaExpanded` (if set before click — e.g., a combobox that shows expanded state)
- `ariaHasPopup` (static attribute)
- `ariaValueNow` (static attribute)
- `inputType` (static attribute)
- `isContentEditable` (static property)
- `ancestorClasses`, `ancestorRoles` (structural context)

**Category B: Post-handler behavioral signals** — created by the click handler
- Class transitions (`opt` → `opt selected`)
- aria-expanded transitions (absent → `true`)
- aria-pressed transitions (absent → `true`)
- Value changes on the clicked element itself (not a focused input)
- DOM structure changes (new child elements appearing)

**R3.1-R3.3 (propagate Category A signals + add generators + implement derivation) 
CAN work without any timing changes.** The data is already available at capture time. 
These steps are architecturally sound.

**R3.4 (capture Category B signals) requires a timing change.** The post-click 
poll arrives after the Click is frozen. This is the architectural gap.

### Does R3 Need Category B to Achieve Its Objective?

**Partially.** Consider the scenarios:

1. **Novel combobox** (div, no ARIA, panel appears on click): 
   - Category A signal: none (no aria-expanded, no aria-haspopup)
   - Category B signal: aria-expanded or class change after handler
   - **Needs Category B**

2. **ContentEditable editor** (div contenteditable):
   - Category A signal: `isContentEditable = true` ← AVAILABLE AT CAPTURE
   - **Does NOT need Category B**

3. **Custom slider with aria-valuenow** (div with role):
   - Category A signal: `ariaValueNow` ← AVAILABLE AT CAPTURE (if role=slider exists)
   - **Does NOT need Category B** (but lifecycle definitions should already catch this)

4. **Div-checkbox** (div with class toggle only):
   - Category A signal: none (no ARIA, no input type)
   - Category B signal: class change `opt` → `opt selected`
   - **Needs Category B**

5. **Value-change input** (div whose text content changes on click):
   - Category A signal: `valueBefore` from mousedown + `valueAfter` from click
   - **Partially available** — but `valueAfter` is captured at click time in capture 
     phase, which is before the handler runs. Only works if value was already set.

### Conclusion

Category A propagation (R3.1-R3.3) achieves meaningful behavioral classification 
for scenarios where static ARIA attributes or contentEditable flags exist but 
lifecycle definitions don't match. This is a genuine improvement.

Category B capture (R3.4) is needed for the **pure behavioral** scenarios 
(div-checkbox with no structural signal at all). But the current architecture 
makes it architecturally non-trivial — it requires deferring Click emission 
until after the handler runs.

## The Architectural Fix for R3.4

The fix is to **defer the Click definition's completion** by a short window 
so that post-handler behavioral data can be captured and included in the 
evidence evaluation.

### Option 1: Defer Click buildResult/onEmit (Bubble-Phase Re-Snapshot)

Instead of completing Click immediately, add a brief lifecycle window:

1. Click `detectTrigger` matches → Click enters `triggering` state
2. Click `handleEvent` returns `null` (not completed) → stays active
3. A `setTimeout(0)` or microtask schedules a re-snapshot of the target element
4. The re-snapshot captures post-handler attribute state
5. Click completes with both pre-handler and post-handler data available
6. `buildResult` includes attribute transitions
7. `annotateWithEvidence` runs with full behavioral data

**Pros:** Minimal architectural change. Only Click definition changes. The Click 
becomes a brief-lifecycle definition (like Hover or Scroll) instead of immediate.
**Cons:** Adds ~0-4ms latency (one macrotask). The Click no longer emits 
synchronously. Tests that assume immediate emission need adjustment.

### Option 2: Deferred Annotation (Post-Emit Re-Evaluation)

1. Click emits immediately (unchanged)
2. A post-emit hook schedules attribute capture
3. When transitions detected, re-runs `annotateWithEvidence` on the interaction
4. Updates the interaction in `liveInteractions` and re-persists

**Pros:** Click emission is unchanged.
**Cons:** Requires a re-annotation mechanism that doesn't exist. The interaction 
may have already been sent to the side panel. Race conditions if user acts quickly.

### Recommendation: Option 1

Option 1 is cleaner. It keeps the single-pass pipeline. The Click definition 
becomes a minimal-lifecycle definition. The attribute capture happens in the 
EventTap content script (which has DOM access), and the re-snapshot data is 
included in the ObservedEvent or a supplementary event that the Click absorbs 
into its lifecycle.

The key change: Click's `isInScope` returns `true` for a brief window, and 
Click's `shouldCompleteOnOutside` or a timeout triggers completion.

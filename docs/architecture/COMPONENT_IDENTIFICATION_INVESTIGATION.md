# Component Identification & Lifecycle Investigation

**Date:** 2026-07-29
**Trigger:** User observed inconsistent dropdown/cabin-class capture on Adani One
**Method:** Static code trace of Component Runtime, EventTap, Dropdown definition, resolveTarget, and DOM context extractor
**Status:** Investigation only — NO fixes implemented

---

## Executive Summary

All three hypotheses are **contributing factors**, but the **root cause is deeper than any individual hypothesis**. The fundamental issue is an **architectural mismatch between the component model and SPA reality**: the Component Runtime identifies components primarily from DOM structure (CSS classes and element identity), but Adani One's React SPA renders logically different controls with nearly identical DOM structure and CSS class names. The runtime's lifecycle model then compounds this by allowing multiple active Dropdown sessions to coexist with no disambiguation between them.

The inconsistency (sometimes captured, sometimes not) is caused by **timing-dependent race conditions** between the post-click value poll, React state flushes, and the 15-second lifecycle timeout. Whether a given interaction is captured depends on whether React's re-render completes before or after the post-click poll fires.

---

## Evidence from Screenshots

### Screenshot 1 (image_07bc6ddc.png)
- `int-11`: Dropdown "Select 'Premium Economy' from '1Economy'"
- `int-12`: Dropdown "Select 'Premium Economy' from 'One Way'"
- **Cross-wiring**: The same cabin-class selection is attributed to TWO different dropdown triggers — "1Economy" (a cabin-class container) and "One Way" (a trip-type container). These are completely different logical controls.

### Screenshot 2 (image_8ce91f37.png)
- `int-13`: Dropdown "Select 'Premium Economy' from 'Economy'"
- `int-14`: Dropdown "Select 'Premium Economy' from 'One Way'"
- Same cross-wiring pattern: cabin class selection attributed to trip-type trigger.

### Screenshot 3 (image_3b7101fc.png)
- `int-18`: Text Entry "Enter 'Chennai' in 'From - DEL'"
- `int-20`: Text Entry "Enter 'Bangalore' in 'To - BOM'"
- **Stale labels**: The field labels show "DEL" (Delhi) and "BOM" (Mumbai) — these are the PREVIOUS values from before the user typed. The accessibleName was captured at focus time (before typing) and was never updated.

### Screenshot 4 (image_02f902d4.png)
- `int-13`: Dropdown "Select 'Premium Economy' from 'Economy'"
- `int-14`: Dropdown "Select 'Premium Economy' from 'One Way'"
- `int-18`: Dropdown "Select 'Business' from '2Premium Economy'"
- `int-20`: Click "Done" dialog
- **Cross-wiring again**: "Business" selection attributed to "2Premium Economy" (a stale label from the previous state).

---

## Hypothesis 1: Incorrect Component Identification

### Verdict: CONTRIBUTING FACTOR (not the root cause)

**The claim:** When the interacted element is generic (dropdown arrow, SVG, icon), the recorder walks up to a parent container and treats that as the component. This causes logically different controls (Trip Type, Cabin Class) to be associated with the same parent component.

**What actually happens:**

The `resolveTarget()` function in `identity-extractor.ts` (L559-633) resolves the event target through a multi-strategy cascade:
1. Find first interactive element in `composedPath` (matches `INTERACTIVE_SELECTOR`)
2. Walk parents looking for interactive elements
3. Clickable heuristic (cursor:pointer, onclick) — walks up 3 parents for a meaningful name
4. SPA option heuristic (CSS class patterns like `option`, `menu-item`, `selectable`, `class-option`, `fare-option`, `travel-class`)

This is **partially correct**: `resolveTarget` does walk up to parents, but it doesn't conflate different controls into one parent — it stops at the FIRST interactive ancestor with a meaningful name. The issue is that Adani One's dropdown triggers are structurally similar DIVs with CSS classes that match `DROPDOWN_TRIGGER_CLASS_RE`.

**The real identification problem is in `isDropdownTrigger()`** (`patterns.ts` L122-131):

```typescript
const DROPDOWN_TRIGGER_CLASS_RE =
  /(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect|selector|traveler|traveller|passenger|pax|cabin|class-selector|trip-type|economy|journey-type|fare-type|travel-class)/i;
```

This regex is **overly broad**. The tokens `select`, `economy`, `cabin`, and `travel-class` match CSS classes on Adani One's form containers. Multiple logically different dropdowns (Trip Type, Cabin Class, Passenger count) all have CSS classes that match this regex. When the user clicks inside one dropdown, the `detectTrigger` function checks the clicked element's CSS class — but if the clicked element is a generic container DIV inside the dropdown (which is how React renders them), the class of that container might match the trigger pattern for a DIFFERENT dropdown.

Specifically:
- The Trip Type dropdown container might have class `journey-type-selector`
- The Cabin Class dropdown container might have class `travel-class-selector`
- Both match `selector` in the regex → both are detected as Dropdown triggers

When the user clicks "Premium Economy" (a cabin class option), the event might be resolved to a parent container whose class happens to match the Trip Type dropdown's trigger pattern, producing the wrong `trigger` identity.

**Evidence from screenshots:** The trigger names "1Economy", "2Premium Economy", "One Way" are all accessibleNames of dropdown trigger containers. The numbers ("1", "2") suggest the runtime is picking up adjacent or parent containers with stale display values.

### Why it's not the full root cause

Even with perfect trigger identification, the lifecycle model would still produce duplicates and missed captures (see Hypothesis 2). The identification problem explains the **cross-wiring** (wrong trigger name) but not the **inconsistency** (sometimes captured, sometimes not).

---

## Hypothesis 2: Incorrect Component Lifecycle / Completion Logic

### Verdict: ROOT CAUSE — this is the primary architectural problem

**The claim:** The recorder's completion logic causes later interactions to be ignored, finalised too early, or associated with the wrong interaction context.

**What actually happens — three distinct lifecycle failures:**

### Failure A: Multiple active Dropdown sessions with no disambiguation

The Component Runtime maintains an `activeStack` of ComponentContext objects. When a user opens the Cabin Class dropdown (Dropdown lifecycle A activates), then opens the Trip Type dropdown WITHOUT completing the first one, the runtime has **two active Dropdown sessions** simultaneously.

The `process()` method (component-runtime.ts L165-239) offers each incoming event to the active stack **top → bottom**. The first session where `isInScope()` returns true claims the event. But `isInScope()` for Dropdown (dropdown.ts L85-117) checks:

1. Same element as trigger (`elementKey` match)
2. Is a dropdown option
3. Is inside a dropdown surface (but NOT if it's a button/link/input with its own definition)

**The problem**: `isInsideDropdownSurface()` checks CSS class patterns like `popover`, `dropdown`, `overlay`, `popup`, `sheet-content`, `modal-body`. When the user clicks a cabin class option inside the Cabin Class popover, the click event target is inside the Cabin Class popover surface. But if the Trip Type dropdown session is HIGHER on the stack (opened later or hasn't completed yet), and the Trip Type dropdown's popover surface is ALSO open (or its CSS classes overlap), the event might be claimed by the WRONG session.

Even more critically: the `isInScope()` check for "inside dropdown surface" uses the event target's OWN className and ancestor classes — but it doesn't check WHICH dropdown surface the element belongs to. Two open dropdowns both produce elements whose ancestors have `popover` in their class name. The first matching session (top of stack) claims the event.

**This explains the cross-wiring**: "Premium Economy" (cabin class) is attributed to "One Way" (trip type) because the Trip Type dropdown session is higher on the stack and its `isInScope()` returns true for the cabin class option click (both are inside "popover" surfaces).

### Failure B: The 15-second timeout produces timing-dependent inconsistency

`MAX_LIFECYCLE_DURATION_MS = 15_000`. When a Dropdown is opened and the user spends time interacting with other controls before selecting an option, the 15-second timer expires and the session is abandoned. If the user then clicks an option, it goes through discovery and creates a NEW Dropdown session with the option's parent as the trigger — producing the wrong trigger name.

This explains why **"Sometimes it correctly captures changing the cabin class, sometimes it doesn't"**: if the user selects quickly (<15s), the original session completes correctly. If they take too long (browsing options, changing other fields first), the session times out and the capture fails or cross-wires.

### Failure C: Post-click value poll creates phantom completion events

The EventTap's `schedulePostClickValueCheck()` (event-tap.ts L331-393) polls the last-focused input's value at 50ms, 150ms, 400ms. If the value changes (React state flush), it emits a synthetic `change` event on the focused input.

For Dropdown sessions, the `handleEvent` method (dropdown.ts L142-155) has a path:
```typescript
if (event.eventType === 'change') {
  const eventKey = elementKey(event.target);
  const triggerKey = elementKey(ctx.trigger);
  if (eventKey === triggerKey && event.valueAfter) {
    ctx.data.selectedValue = event.valueAfter;
    return { endState: 'completed' };
  }
}
```

If the synthetic `change` event fires on the trigger input (same elementKey), the Dropdown completes with `selectedValue = event.valueAfter`. But `valueAfter` is the **raw input value** (e.g., "1Premium Economy" — a display string with a prefix number), not the semantic selected option name. This produces the "1Economy" and "2Premium Economy" trigger names seen in the screenshots.

### Failure D: The stale label problem

The `accessibleName` is captured at event time (in the content script) via `computeAccessibleName()`. For React controlled inputs, the `accessibleName` at focus time is the PREVIOUS value (before the user types or selects). When the post-click poll fires the synthetic `change` event, it re-extracts the identity of the input — but `computeAccessibleName` on a React controlled input may still return the stale value if React hasn't re-rendered the label yet.

This explains the "From - DEL" and "To - BOM" stale labels: the accessibleName was captured when the user focused the field (showing the previous airport), not after they typed the new airport.

---

## Hypothesis 3: Component Identification is the Wrong Abstraction

### Verdict: PARTIALLY CORRECT — but the proposed alternative is not the right solution

**The claim:** Rather than identifying components from DOM structure, the recorder should first determine the logical interaction and then find the component.

**Analysis:**

The current architecture already does this to some degree — the Component Definition stack IS a "logical interaction first" model. Each definition (Dropdown, DatePicker, Checkbox, etc.) represents a logical interaction type. The `detectTrigger` function asks "does this element match the pattern for this interaction type?" — which is "logical interaction first, component second."

The real problem is NOT that the abstraction is wrong — it's that:

1. **The trigger identification is too broad** — CSS class patterns match multiple different logical controls. The `DROPDOWN_TRIGGER_CLASS_RE` regex matches `select`, `economy`, `cabin`, etc. as trigger classes. Multiple different dropdowns match the same pattern.

2. **The scope model doesn't distinguish between concurrent sessions of the same type** — when two Dropdown sessions are active, `isInScope` can't tell which session an event belongs to because both surfaces look the same to the class-based surface detection.

3. **The completion logic is timing-dependent** — the post-click value poll races with React's state flush, producing different results on different runs.

**The right architectural evolution is NOT "logical interaction first" (that's already the model) — it's:**

### Proposed: Session-boundary disambiguation

The runtime needs to track **which surface a session belongs to** — not just "is this element inside a dropdown surface" but "is this element inside MY dropdown surface". This requires:

1. **Surface identity capture**: When a Dropdown session activates, capture the surface container's identity (not just the trigger's identity). The surface is the popover/overlay that appears when the dropdown opens — it has a distinct DOM identity that can be checked.

2. **Surface-bound isInScope**: Instead of checking `isInsideDropdownSurface(className)` (which matches ANY dropdown surface), check whether the event target is inside THIS session's specific surface container.

3. **One active session per surface**: If a new Dropdown triggers while another is active on the same surface, replace the old session (the user switched context).

This is aligned with the Unified Master Roadmap's Phase 0b (type unification) and Phase 0c (V1/V2 classifier consolidation). The surface identity concept is already partially present in `domContext.surfaceType` and `domContext.surfaceLabel` — it just isn't used for session boundary disambiguation.

### Why not "logical interaction first"?

The alternative — determining the logical interaction before identifying the component — would require a fundamentally different event model. The recorder would need to:
1. Buffer all events
2. After some delay (or on STOP), analyze the event stream to identify logical interactions
3. Map each logical interaction back to the component responsible

This is essentially what the V1/V2/semantic pipeline ALREADY does (post-STOP classification). The problem is that the user sees the Component Runtime's LIVE output, which is real-time and structural. Making the live pipeline "logical interaction first" would introduce latency and complexity that conflicts with the live streaming design.

**The better approach is to fix the structural identification to be more precise** — surface-bound sessions, stricter trigger patterns, and surface-aware completion — rather than replacing the abstraction entirely.

---

## The Duplication Path (int-11 + int-12, int-13 + int-14)

The duplicate dropdown entries follow this exact sequence:

1. User opens Cabin Class dropdown → Dropdown session A activates (trigger = Cabin Class container, elementKey = `name:Economy|sel:div.travel-class`)
2. User clicks "Premium Economy" option → event resolves to option element
3. `isInScope` for session A: the option is inside a `popover` surface → true → `handleEvent` → completes with `selectedValue = "Premium Economy"` → interaction emitted
4. Session A is removed from the active stack
5. **But session A's trigger identity is still in `dedupByType` for Dropdown** — the dedup record has `elementKey = name:Economy|sel:div.travel-class`
6. The post-click value poll fires → detects value change on the Trip Type input → emits synthetic `change` event on the Trip Type input
7. The Trip Type input matches `isDropdownTrigger` (class contains `select` or `trip-type`) → discovery creates Dropdown session B (trigger = Trip Type container, elementKey = `name:One Way|sel:div.journey-type`)
8. `handleEvent` for session B: synthetic `change` on trigger → `eventKey === triggerKey` → completes with `selectedValue = event.valueAfter` (the display value, which might be "Premium Economy" if the state update propagated)
9. **Dedup check**: session B has elementKey = `name:One Way|...`, which is DIFFERENT from session A's `name:Economy|...` → NOT a duplicate → emitted
10. **Result: two Dropdown interactions for one user action**, with the second one having the wrong trigger name ("One Way")

This is the same class of bug as the DatePicker dedup failure (Issue 6): **cross-element dedup doesn't work because the two interactions have different triggers** (different elementKeys).

---

## The "Inconsistency" — Why the Same Action Is Sometimes Captured, Sometimes Not

Five variables interact to produce non-deterministic behavior:

| Variable | Value | Effect |
|----------|-------|--------|
| React state flush timing | 50-400ms | If flush happens before first poll (50ms), the synthetic change fires early and may complete the correct session. If flush takes 300ms+, the original session may have already timed out. |
| Active stack depth | 1-3 sessions | If the user has multiple dropdowns open (unlikely but possible in Adani's SPA), the stack order determines which session claims the event. |
| 15s timeout | Expires or not | If the user takes >15s between opening a dropdown and selecting an option, the session is abandoned. The option click then creates a new session with the option's parent as trigger — wrong trigger name. |
| Post-click poll race | Poll before/after React flush | If the poll fires before React updates the trigger input's value, no synthetic change is emitted → the Dropdown session never completes via the change path. If it fires after, the change completes the session but with the display value, not the option name. |
| Focus tracking state | `lastFocusedEl` is stale | The post-click poll checks `lastFocusedEl` — the element that had focus before the click. If the user clicked the dropdown trigger (not an input), `lastFocusedEl` might be a completely different input from a previous interaction. The synthetic change fires on the wrong element. |

---

## Summary of Findings

| Hypothesis | Verdict | Explanation |
|-----------|---------|-------------|
| H1: Incorrect component identification | Contributing factor | CSS class patterns are too broad — multiple dropdowns match the same trigger regex. `resolveTarget` walks to parents but doesn't conflate controls. |
| H2: Incorrect lifecycle/completion | **Root cause** | Multiple active Dropdown sessions with no surface-bound disambiguation, 15s timeout producing timing-dependent abandonment, post-click value poll racing with React state flush. |
| H3: Wrong abstraction | Partially correct | The abstraction is right (definition stack = logical interaction first), but the implementation lacks surface-bound session identity. The fix is to add surface disambiguation, not replace the model. |

---

## Architectural Recommendation

**Do NOT replace the component identification abstraction.** Instead, evolve it with three targeted changes:

### 1. Surface-bound session identity (Phase 0b-aligned)
When a Dropdown/DatePicker/MultiConfig session activates, capture the surface container identity. Use it in `isInScope` to verify the event belongs to THIS session's surface, not any surface of the same type.

### 2. Concurrent session management
When a new Dropdown session activates while another is already on the stack:
- If the new session's trigger is OUTSIDE the old session's surface → the user switched contexts → complete the old session as "interrupted" (not "abandoned")
- If the new session's trigger is INSIDE the old session's surface → nested dropdown (unusual but possible) → keep both, use surface identity to disambiguate

### 3. Post-click poll specificity
The `schedulePostClickValueCheck` should only fire for the element that was actually focused — not just `lastFocusedEl`. Track which focus event corresponds to which dropdown session, and only complete that specific session with the synthetic change.

### Why not just tighten the CSS regex?

Tightening `DROPDOWN_TRIGGER_CLASS_RE` would reduce false positives but wouldn't solve:
- The concurrent session problem (two real dropdowns still conflict)
- The 15s timeout inconsistency
- The post-click poll race condition
- The stale label problem

These are lifecycle issues, not identification issues. The CSS regex should be tightened, but that's a secondary fix, not the primary one.

### Alignment with Unified Master Roadmap

This investigation confirms that Phase 0b (type unification) and Phase 0c (V1/V2 classifier consolidation) are the correct next steps. The surface-bound session identity concept is a prerequisite for both — it's the foundation that makes the classifier merge possible (the V1/V2 pipeline has the same surface disambiguation problem).

No new phase is needed. The existing roadmap phases address this if expanded to include:
- Surface identity capture in `DomContext` (already partially present)
- Surface-bound `isInScope` in Dropdown/DatePicker/MultiConfig definitions
- Concurrent session resolution in the Component Runtime
- Post-click poll session binding in EventTap

---

## Conclusion

The user's observations are accurate and point to a real architectural gap. The gap is NOT in the abstraction (component-first vs interaction-first) but in the **session boundary model**: the runtime doesn't track which specific surface a session belongs to, so concurrent sessions of the same type can't be disambiguated.

The fix should precede Phase 0b/0c implementation because those phases depend on correct session boundary behavior. Recommend adding a **Phase 0a.5: Surface-bound session identity** to the roadmap, positioned after dead code removal (0a) and before type unification (0b).

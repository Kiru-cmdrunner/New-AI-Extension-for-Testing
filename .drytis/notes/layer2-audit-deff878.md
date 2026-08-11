# Layer 2 — ComponentRuntime / Interaction Classification Audit (deff878)

Audit performed exclusively against `/workspace/tmp/deff878-audit` at commit deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8.

## Intended Behavior

The ComponentRuntime is the classification engine. It receives ObservedEvent objects from the content script (Layer 0/1) and classifies them into typed ComponentInteraction objects using priority-ordered ComponentDefinitions. The EvidenceLedger provides an append-only audit trail with dispositions for every discrete event.

**Core invariants:**
- INV-LE-1: Every discrete event (click, contextmenu, mousedown, keydown) appended to the ledger receives a 'pending' disposition.
- INV-LE-2: Disposition lifecycle: pending → absorbed → (claimed | unclaimed). 'claimed' and 'unclaimed' are terminal.
- INV-LE-3: restore() always resets 'absorbed' → 'unclaimed' (SW restart rule).
- The runtime does NOT emit Unclassified — Projection Engine (Layer 4) surfaces unclaimed/pending ledger entries.
- Every discrete event that doesn't match a specialized definition surfaces as Unclassified via the Projection Engine.

## Actual Behavior — Process Pipeline

`process(event)` pipeline (4 stages):

1. **Dedup by eventId**: `seenEventIds.has(event.eventId)` → skip if seen. Set capped at 500 entries, halved on overflow (drops oldest half by insertion order).
2. **Navigation flush**: If event is navigation, `flush()` all active as interrupted, then fall through to discovery.
3. **Stale cleanup**: `cleanupStaleComponents()` — any active component exceeding `MAX_LIFECYCLE_DURATION_MS` (15s) is completed (gesture defs: Scroll) or abandoned (all others).
4. **Offer to active stack** (top→bottom): `isInScope(event, ctx)` → if true, `handleEvent(event, ctx)` → if completion, `completeComponent()`.
5. **Discovery**: If no active component claimed the event, `tryDiscovery()` iterates non-Click definitions by priority ascending, then Click (180) as fallback.

### EvidenceLedger Mechanics

- **DISCRETE_ACTION_TYPES**: `{ click, contextmenu, mousedown, keydown }`. Only these get ledger entries.
- **Accumulating events** (scroll, input, change, mousemove) do NOT get ledger entries.
- **append()**: Filters to discrete types only, deduplicates by eventId, stores diagnostic identity (targetTag, targetName, targetRole — ~100 bytes each).
- **setDisposition()**: Terminal states (claimed/unclaimed) are immutable. No-op if entry not in ledger.
- **releaseClaims(lifecycleId)**: Scans ALL entries O(n) to find entries with `claimedBy === lifecycleId`.
- **restore()**: Clears entries, re-populates from snapshot, calls `resetAbsorbedToUnclaimed()`.
- **No eviction cap** on the ledger — grows unbounded for the duration of a recording session.

### ComponentRuntime State

- `activeStack`: ComponentContext[] — active components.
- `seenEventIds`: Set<string> — cap 500, halved on overflow.
- `dedupByType`: Map<InteractionType, DedupRecord> — per-type temporal dedup.
- `errorLog`: string[] — unbounded, accumulates definition method errors.
- `interactionCounter`: monotonic counter for `int-{N}` IDs.
- `lifecycleCounter`: monotonic counter for `lc-{N}` IDs.

### Dedup

- **Temporal dedup**: Same type + same elementKey + gap ≤ 2000ms (endTime→startTime) = duplicate, suppressed.
- **Per-type**: Each InteractionType has its own dedup window. Interleaved types don't reset each other.
- **Checkbox/RadioButton special case**: Different elementKeys but same accessibleName within window = duplicate (OXD label→input synthetic click).
- **DatePicker special case**: Also compares selectedDate — different date = NOT a duplicate even within window.
- **Scroll exempt**: Always distinct (gesture coalescing handles duplicates).
- **Suppressed interactions**: `releaseClaims(lifecycleId)` sets all absorbed events to unclaimed. Returns null from completeComponent.

### Lifecycle Ownership Test

`lifecycleOwnsTarget(event, ctx, def)` — two-part W3C-standard test:
1. **Part 1**: Target has a declared semantic child role/tag (from `def.semanticChildRoles` / `def.semanticChildTags`).
2. **Part 2**: Target's ancestorRoles includes the lifecycle's surfaceRole (stored in `ctx.data.surfaceRole`).
- Returns false if either part fails. Event falls through to discovery.
- Only used for discrete events on DIFFERENT elements than the trigger.

### MV3 Recovery

- `snapshot()`: Returns interactionCounter, seenEventIds (array), dedupRecords (array).
- `restore(snap)`: Restores counter, seenEventIds (new Set), dedupByType (new Map).
- **Active stack NOT restored** — lost on SW restart. All absorbed events reset to unclaimed.
- EvidenceLedger.restore() resets all 'absorbed' → 'unclaimed'.

## 14 Definition Summary

| Type | Priority | Trigger Events | Completion | Key Behavior |
|------|----------|---------------|------------|--------------|
| DatePicker | 10 | focus, click | Calendar cell click, change, blur | Highest priority. OXD ancestor-class detection. Nav buttons are lifecycle-internal. blur→completed if value typed. |
| ColorInput | 15 | focus | blur | Mirrors Slider. userAdjusted requires value change. |
| Dropdown | 20 | click, mousedown, focus | Option click/mousedown, SELECT change | OXD readonly text input + ancestor class detection. Interactive children (BUTTON/A/INPUT) fall through. |
| Slider | 25 | focus | blur | Mirrors TextEntry. userAdjusted via input/change or blur fallback value comparison. |
| Checkbox | 30 | click | Immediate | Framework wrapper CSS detection. checkedBefore = NEW state (pre-click activation). |
| FileUpload | 35 | click, change | Immediate | Captures fileName from valueAfter. |
| RadioButton | 40 | click, change | Immediate | noOpSelection always false (radio can't be unchecked). |
| TextEntry | 50 | focus | blur | userTyped flag. Blur fallback infers typing from valueAfter. shouldCancelOnOutside only on click (not mousedown — event order). |
| Hover | 60 | mouseenter | mouseleave (discarded or completed) | Confidence model: 5 signals, threshold ≥50. Discards non-meaningful transit. |
| Tab | 65 | click | Immediate | role="tab" only. |
| Link | 70 | click | Immediate | `<a>` tag or role="link". |
| Scroll | 110 | scroll | Non-scroll event (shouldCompleteOnOutside) | Coalesces bursts via SCROLL_BURST_GAP_MS (500ms). Accumulates delta. |
| Navigation | 120 | navigation | Immediate | Runtime flushes active stack first. |
| Click | 180 | click, contextmenu | Immediate | Universal fallback. isInteractiveElement gate. |

## Correctness Analysis

### Classification Accuracy

- **Priority ordering**: Correctly resolves most overlaps. DatePicker(10) wins over Dropdown(20). Slider(25) wins over TextEntry(50). Checkbox(30) wins over Click(180).
- **Click fallback**: Only triggers on `isInteractiveElement()`. Non-interactive clicks get no runtime emission but DO get a ledger entry (discrete type) → Unclassified at projection time.
- **Dropdown vs Click**: Dropdown(20) correctly wins over Click(180) for SELECT, combobox, and CSS-class-matched triggers.
- **Tab vs Link**: Tab(65) wins over Link(70). Both can be `<a>` tags — Tab checks role="tab" first, Link checks `<a>`/role="link". A `<a role="tab">` is classified as Tab. ✓
- **Hover exclusion**: Hover's isInScope ONLY accepts mouseenter/mouseleave/mousemove. Click/mousedown/focus/blur fall through to their own definitions. ✓

### Lifecycle Completion Correctness

- **Immediate-completion defs** (Click, Checkbox, RadioButton, FileUpload, Tab, Link, Navigation): Trigger and complete in the same process() call. Correct.
- **Lifecycle defs** (Dropdown, DatePicker, TextEntry, Slider, ColorInput, Hover): Start on trigger, complete on later event. All have 15s timeout safety net.
- **Scroll**: Special gesture lifecycle. `shouldCompleteOnOutside` returns true → any non-scroll event completes it. Flush() completes it as 'completed' (not interrupted).
- **Navigation**: Triggers flush of all active before itself being discovered. Correct for SPA page changes.

### Absorption & Disposition Flow

- Trigger events are absorbed when a new lifecycle is created (disposition: 'absorbed').
- Same-element discrete events inside an active lifecycle are absorbed.
- Different-target discrete events inside scope → `lifecycleOwnsTarget()` check. If proven, absorbed. If not, released to fall through.
- On completion (completed): all discrete member events → 'claimed'.
- On abandonment/interruption: `releaseClaims(lifecycleId)` → all absorbed → 'unclaimed'.
- On dedup suppression: `releaseClaims(lifecycleId)` → all absorbed → 'unclaimed'.
- On stale timeout: completed (gesture) or abandoned (others), with corresponding disposition updates.

## Technical Debt / Issues

### 🔴 CRITICAL

**2-C-1: Active stack lost on SW restart — incomplete interactions lost**
- `snapshot()` does NOT serialize `activeStack`. `restore()` does NOT restore it.
- If the SW restarts mid-lifecycle (e.g., user opened a Dropdown, SW restarted), the lifecycle vanishes. All its absorbed events are reset to 'unclaimed' by `resetAbsorbedToUnclaimed()`.
- These surface as Unclassified interactions at projection time — correct from a disposition standpoint, but the user's actual interaction (e.g., Dropdown selection) is lost.
- **Severity**: The design choice is intentional (per comments: "component context is too complex to serialize"). The impact depends on SW restart frequency under MV3.

**2-C-2: seenEventIds halving can cause duplicate processing after SW restart**
- `seenEventIds` is capped at 500, halved on overflow (drops oldest half by insertion order — not by time).
- `snapshot()` serializes the current set (including post-halving state). `restore()` restores it.
- If SW restarts and re-delivers buffered events whose IDs were in the DROPPED half, they are processed again as new events.
- Result: duplicate interactions, duplicate ledger entries (append() deduplicates by eventId, so the ledger itself is safe, but the runtime emits duplicates).
- **Impact**: After long sessions (>500 unique events) with SW restart, some interactions may be duplicated.

**2-C-3: Combobox text input loses typed search text**
- A combobox `<input type="text" role="combobox">` is claimed by Dropdown (priority 20) before TextEntry (priority 50).
- Dropdown triggers on `mousedown`/`focus`/`click`. TextEntry triggers on `focus`.
- When the user types into the combobox to filter options, the `input` events are absorbed by Dropdown (same element, isInScope=true).
- Dropdown only completes on option click or SELECT change — typed search text is not captured in metadata.
- No Autocomplete/Combobox definition exists at deff878 to handle this pattern.
- **Impact**: Autocomplete search text is invisible in the generated test.

### 🟠 HIGH

**2-H-1: Non-discrete events (focus/blur/input/change) that match no definition silently vanish**
- Only DISCRETE_ACTION_TYPES (click, contextmenu, mousedown, keydown) get ledger entries.
- If a `focus` event doesn't trigger any definition (e.g., focus on a generic `<div>`), it has no ledger entry and no interaction.
- This is CORRECT for genuinely non-interactive elements, but means the Evidence Ledger's "no discrete event is silently rejected" guarantee only covers 4 event types.
- The remaining 10 event types have no audit trail if they don't trigger a definition.

**2-H-2: errorLog is unbounded**
- `errorLog: string[]` accumulates definition errors indefinitely.
- In a long recording session with a buggy definition (e.g., a definition throwing on every event), this grows without limit.
- **Impact**: Memory pressure in long sessions. Already identified as one contributing factor in post-baseline crash investigations.

**2-H-3: EvidenceLedger has no eviction cap**
- `entries: Map<string, LedgerEntry>` grows unbounded for the recording session.
- At ~100 bytes per entry and 1000+ discrete events in a long session, this is ~100KB in memory — manageable, but has no safety bound.
- `getEntries()` creates a sorted array copy on every call — O(n log n) per call.

**2-H-4: releaseClaims() is O(n) full-scan**
- Called on every abandonment/interruption/dedup-suppression. Scans all entries to find those with `claimedBy === lifecycleId`.
- In long sessions with many lifecycles, this is O(n × m) total.

**2-H-5: TextEntry shouldCancelOnOutside has a timing edge case with mousedown**
- TextEntry only cancels on 'click', not 'mousedown' (intentional — mousedown fires before blur).
- But if a mousedown occurs on a different element and NO click follows (e.g., user drags away), the TextEntry stays active until the 15s timeout.
- The comment acknowledges this: "mousedown fires BEFORE blur... which would abandon the TextEntry before it can complete."

**2-H-6: Dropdown isInScope swallows non-option clicks inside surfaces**
- `isInsideDropdownSurface()` uses broad CSS class regex (`/(oxd-select-dropdown|select-dropdown|listbox|dropdown-menu|popover|overlay)/i`).
- Elements inside a "popover" or "overlay" that are NOT dropdown options but also not in the interactive-element exclusion list are absorbed by the Dropdown lifecycle.
- E.g., a text label inside a popover: `isInScope` returns true, handleEvent returns null (no completion), event is absorbed and lost.
- The exclusion list (BUTTON, A, INPUT, button/link/checkbox/radio/spinbutton/slider roles) is incomplete — misses generic interactive elements like role="menuitem", role="tab", contenteditable divs.

**2-H-7: Checkbox checkedBefore semantics are fragile across frameworks**
- Checkbox.buildResult uses `checkedBefore` as the NEW state directly (no negation), relying on browser pre-click activation.
- Comment: "Browsers perform pre-click activation: the checkbox's checked state is toggled BEFORE the click event fires."
- This is correct for native `<input type="checkbox">` but may not hold for ARIA checkboxes (role="checkbox") where state is managed by JavaScript frameworks.
- For ARIA checkboxes without native checked state: `checked = true` hardcoded fallback — always reports checked=true.

**2-H-8: Hover depends on mouseenter/mouseleave at child level — may not fire**
- Hover triggers on `mouseenter`. `isInScope` accepts `mouseenter`, `mouseleave`, `mousemove`.
- Per Layer 0 audit (C-1): mouseenter/mouseleave are non-bubbling events captured at document level. They may only fire when the pointer enters/exits the document boundary, not child elements.
- If this is confirmed in real Chrome, the entire Hover definition is non-functional.
- **Status**: Requires real Chrome validation (same as Layer 0 C-1).

### 🟡 MEDIUM

**2-M-1: Dedup halving drops oldest by insertion order, not by time**
- `seenEventIds` halves by slicing the Set's iteration order: `entries.slice(Math.floor(entries.length / 2))`.
- Set iteration order is insertion order in JS. So the oldest 50% of event IDs are dropped.
- If events arrive from multiple tabs/frames interleaved, this can drop IDs from one tab while keeping another's, creating dedup blind spots for the dropped tab.

**2-M-2: DatePicker ancestor-class detection triggers on focus of ANY element inside a date wrapper**
- `detectTrigger` checks `isDatePickerTrigger(tag, inputType, ancestorClasses, null, name)`.
- If a non-date element (e.g., a help icon) is inside a `div.oxd-date-input`, focusing it could trigger DatePicker.
- The subsequent handleEvent would need a calendar cell or date value to complete — it would sit active until timeout.

**2-M-3: Scroll delta is absolute position difference, not scroll distance**
- `buildResult`: `deltaY = lastScrollY - firstScrollY` where scrollDeltaY is the absolute scroll position (from Layer 0: "Scroll delta is absolute position, not relative").
- A scroll down 100px then up 50px reports deltaY=50 (net), not 150 (total distance).
- For test generation, the net delta may be correct (test wants final position), but the variable name "delta" is misleading.

**2-M-4: Tab definition only checks role="tab" — misses tab patterns without ARIA**
- `isTab(ariaRole)` returns true only for `role="tab"`.
- Many UI frameworks render tabs as `<a>` or `<button>` without role="tab" (using CSS classes like "tab-item", "nav-tab").
- These fall through to Link or Click — classified but not as Tab interactions.
- **Impact**: Tab metadata is lost; these clicks appear as Link/Click.

**2-M-5: RadioButton noOpSelection always false — re-clicking already-selected radio generates noise**
- Comment says: "Radio buttons can only be turned ON by clicking — you can't uncheck a radio by clicking it again."
- But re-clicking an already-selected radio IS a no-op from a user perspective.
- Each re-click generates a RadioButton interaction with noOpSelection=false.
- **Impact**: Noise in recordings where users click the same radio repeatedly.

**2-M-6: Dropdown native SELECT change handling may double-capture**
- Dropdown triggers on click/mousedown/focus. For a native `<select>`, clicking opens the OS dropdown, then selecting fires a `change` event.
- The click on the SELECT triggers Dropdown (detected as trigger). Then the change event completes it.
- But FileUpload also triggers on `change` and `click`. If the SELECT also has `inputType === 'file'` (impossible in practice), there'd be a conflict.
- Actual risk: the mousedown on the SELECT opens the native dropdown; the user selects an option; a `change` event fires. The Dropdown lifecycle is already active from the mousedown. The change event's isInScope is checked: it's on the same element → true. handleEvent: `event.eventType === 'change' && ctx.trigger.tag === 'SELECT'` → completed. Correct flow.
- But: the click event also fires on the SELECT (after change, on some browsers). This click arrives while the lifecycle is already completed and removed. It triggers a NEW Dropdown lifecycle. Per-type dedup suppresses it (same element, same type, within window). ✓

**2-M-7: elementKey() fallback to tag name creates false dedup matches**
- If two elements both lack testId, dataCy, dataQa, stableId, accessibleName, and cssSelector, elementKey returns `tag:BUTTON` for both.
- Per-type dedup then suppresses the second click as a duplicate.
- **Impact**: Two different buttons with no identifying attributes are treated as the same element. Their clicks are deduped.

**2-M-8: DatePicker blur completion may fire before calendar click in some frameworks**
- DatePicker completes on blur if a date value was typed. But if the framework keeps focus on the input while the calendar is open (no blur), the lifecycle waits for a calendar cell click.
- If the user clicks a calendar cell rendered in a portal (outside the input's DOM subtree), the click may trigger blur on the input FIRST (completing DatePicker with the typed value), then the cell click creates a NEW DatePicker lifecycle.
- Dedup catches this if selectedDate matches, but if the typed value differs from the cell's date, two interactions are emitted.

### 🟢 LOW

**2-L-1: findDefForType() is O(n) linear scan**
- Called for each active component on each event. `this.definitions.find(d => d.type === type)`.
- With 14 definitions and a small active stack, this is negligible, but a Map<InteractionType, ComponentDefinition> would be O(1).

**2-L-2: Scroll shouldCompleteOnOutside returns true unconditionally**
- Any non-scroll event completes the Scroll gesture — even mousemove (if it were offered to the active stack first).
- In practice, mousemove is claimed by Hover or falls through, so it reaches Scroll's shouldCompleteOnOutside. But the ordering depends on stack position.
- Actually: mousemove is not a discrete event and Hover.isInScope only accepts it if a Hover lifecycle is active. If no Hover is active, mousemove reaches Scroll's isInScope (returns false, not scroll), then shouldCompleteOnOutside (returns true) → Scroll completes. This is correct.

**2-L-3: Navigation flush() emits Scroll as 'completed', others as 'interrupted'**
- `flush()`: `endState = def?.shouldCompleteOnOutside ? 'completed' : 'interrupted'`.
- This uses shouldCompleteOnOutside as a proxy for "is this a gesture component". Only Scroll has it.
- If a future gesture component doesn't implement shouldCompleteOnOutside, it would be emitted as 'interrupted' on navigation flush.

**2-L-4: Hover lifecycle can be abandoned by stale timeout before mouseleave fires**
- If user hovers for >15s without mouseleave, cleanupStaleComponents abandons the Hover.
- The Hover's accumulated confidence data is lost — buildResult is called with endState='abandoned', which produces metadata but `meaningful` may not be set.
- Presentation layer filters abandoned Hovers anyway (not completed).

**2-L-5: completeComponent calls onEmit inside a try-catch**
- `onEmit` errors are caught and logged but do not prevent the interaction from being returned.
- If onEmit throws, the interaction IS still emitted to the caller of process() (it's in the emitted array).
- Correct behavior, but the SW's onEmit handler may have partially executed.

**2-L-6: DatePicker isCalendarCell allows role="option" with date class**
- `isCalendarCell` checks `ariaRole === 'gridcell' || ariaRole === 'option'` AND a date-like class.
- This means a listbox option with a date-like class (e.g., "calendar-day") would match as a calendar cell.
- Could cause DatePicker to complete on a Dropdown option if both are present in a combined widget.

**2-L-7: Dropdown isInScope interactive-element exclusion is hardcoded**
- The exclusion list (BUTTON, A, INPUT, button/link/checkbox/radio/spinbutton/slider roles) is a hardcoded set.
- New ARIA roles (e.g., "menuitem", "switch") are not in the list.
- Elements with these roles inside a dropdown surface are absorbed instead of falling through.

**2-L-8: bestName() returns 'element' as fallback**
- When no accessible name, aria-label, or placeholder is available, bestName returns the literal string 'element'.
- Multiple unnamed interactions in a recording all show targetName='element'.
- Test generation would produce `page.click('element')` or similar — not useful.

**2-L-9: Navigation definition uses string cast for event type**
- `event.eventType === ('navigation' as string)` — the `as string` cast is needed because 'navigation' is not in BrowserEventType... wait, it IS in BrowserEventType (line 41 of component-types.ts). The cast is redundant.
- Not a bug, but indicates the code was written when 'navigation' wasn't in the type union.

## Summary

Layer 2 is architecturally sound. The priority-ordered discovery, lifecycle management, disposition tracking, and dedup system form a coherent classification engine. The Evidence Ledger provides a strong audit trail for the 4 discrete event types.

The most significant gaps are:
1. **SW restart resilience** (2-C-1, 2-C-2): Active stack and halved seenEventIds create recovery gaps.
2. **Classification blindspots** (2-C-3, 2-H-6, 2-M-4): Combobox search, dropdown surface over-absorption, non-ARIA tabs.
3. **Unbounded state** (2-H-2, 2-H-3): errorLog and ledger have no eviction.
4. **Dedup fragility** (2-M-7): elementKey tag fallback creates false matches.

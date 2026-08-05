# Milestone 1: Post-Interaction Behavioral Observation

## Goal

After EventTap captures a user interaction, observe the target element's DOM subtree for mutations (the "behavioral effects" of the interaction) and correlate them back to the originating interaction by eventId. This is Category A evidence — irrecoverable if not captured at observation time.

## Core Design

### BehavioralObserver Engine (`src/tap/behavioral-observer.ts`)

After EventTap captures an event, a `BehavioralObserver` attaches two MutationObservers:
1. **Subtree observer** on `targetEl` with `{ childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true }`
2. **Parent observer** on `targetEl.parentElement` with `{ childList: true }` — detects target removal

The observer records `RawEffect[]`:
- `attribute-change`: `{ type, attributeName, oldValue, newValue, offsetMs }`
- `child-added`: `{ type, newValue, offsetMs }`
- `child-removed`: `{ type, oldValue, offsetMs }`
- `character-data`: `{ type, oldValue, newValue, offsetMs }`

Each effect carries `offsetMs` — milliseconds from observation start.

### Adaptive Stability Window
- 200ms quiet period timer. Resets on each mutation.
- Max timeout cap: 3000ms. If mutations continue beyond this, observation ends with `endReason: 'timeout'`.
- When 200ms quiet period elapses with no new mutations → `endReason: 'stabilized'`.
- If target element removed from DOM → `endReason: 'element-removed'`.
- If page navigation detected → `endReason: 'navigation'`.

### Pre/Final Element State Snapshots
Captures `ElementStateSnapshot` before observation starts and when it ends:
- `checked: boolean` (property gap — not visible to MutationObserver)
- `value: string` (property gap)
- `className: string | null`
- `childCount: number`
- `isConnected: boolean`

This mitigates the property-gap problem: `.checked`, `.value`, and computed state changes are invisible to MutationObserver but visible via direct property reads.

### OBSERVABLE_EVENT_TYPES
Only `click` and `change` events trigger behavioral observation. NOT mousedown, NOT keyboard, NOT scroll, NOT navigation. These two event types cover the vast majority of interactive behaviors (button clicks, link clicks, checkbox toggles, dropdown selections, text input completion).

### Types (`src/shared/behavioral-types.ts`)
- `RawEffect` — discriminated union for mutation effects
- `ElementStateSnapshot` — property-level element state
- `BehavioralObservation` — complete observation record: `{ sourceEventId, targetElementId, effects: RawEffect[], preSnapshot, finalSnapshot, observationDurationMs, observationEndOffset, endReason }`

## Wiring

### EventTap Hook (`src/tap/event-tap.ts`)
- Added optional `onAfterEvent?: (targetEl, eventId, eventTimestamp, eventType) => void` to `EventTapConfig`
- Called immediately after `config.onEvent(observed)` in the main capture path (line ~323 in handleRawEvent)
- Does NOT fire for navigation events, deferred blur, synthetic changes, or synthetic events — only the main capture path
- The hook is opt-in; existing callers that don't set `onAfterEvent` are unaffected

### Recorder Entry (`src/recorder/phase5/recorder-entry.ts`)
- Wires `onAfterEvent` with `OBSERVABLE_EVENT_TYPES` filter (click + change only)
- Calls `observeBehavior(targetEl, eventId, timestamp, { onComplete, stabilityMs: 200, maxTimeoutMs: 3000 })`
- `onComplete` callback sends `BehavioralObservation` via `sendBehavioralObservation()` — a separate buffered message with retry (exponential backoff: 100/200/400/800/1600ms)
- Uses sessionStorage buffer key `'cmdrunner_behavioral_buffer'` (distinct from the existing `'cmdrunner_observed_events_buffer'`)
- Max buffer size: 200 entries
- `flushPendingBehavioral()` called on `pagehide` and `stopRecording`
- `disconnectAll('navigation')` and `clearBehavioralBuffer()` on `stopRecording`

### Delivery Pipeline (separate message, not fire-and-forget)
The timing paradox: BehavioralObservation completes 200ms-3s AFTER the ObservedEvent was already sent to the service worker. It cannot travel with the ObservedEvent. Solution: separate buffered message with the same delivery pattern as ObservedEvent, but a different buffer key.

### Service Worker (`src/background/service-worker.ts`)
- Handles `BEHAVIORAL_EFFECTS` message type
- `handleBehavioralEffects()` correlates `sourceEventId` against `liveInteractions[*].memberEvents`
- If matched: attaches `behavioralObservations` to the `ComponentInteraction`, persists via `persistLiveInteractions`, broadcasts `INTERACTION_EFFECTS_UPDATE` to side panel
- If not matched: stores in `pendingBehavioralEffects` Map for later attachment

### SW Integration (`src/runtime/sw-integration.ts`)
- Exports `pendingBehavioralEffects` Map
- `attachPendingBehavioralObservations()` iterates `interaction.memberEvents` checking the pending map
- Called at all 3 entry points where interactions enter `liveInteractions`: `finalizeAnnotation`, `initRecording onEmit`, `restoreFromStorage onEmit`
- `pendingBehavioralEffects.clear()` in `resetState`

### Component Types (`src/shared/component-types.ts`)
- Added `behavioralObservations?: BehavioralObservation[]` to `ComponentInteraction` (optional, typed)
- NOT `as any` — proper type safety

### Side Panel Display (`src/sidepanel/interaction-renderer.ts`, `src/sidepanel/sidepanel.ts`)
- `createBehavioralEffectsSection()` renders a collapsible `<details>` section per interaction
- Shows effect count, per-effect details (attribute/child/characterData changes with timing offsets), pre→final snapshot diffs (checked, value, className, childCount), timing info, endReason
- Honest empty state: "No DOM mutations detected" when effects array is empty
- `INTERACTION_EFFECTS_UPDATE` handler reloads interactions from storage and re-renders

## Constraints

1. **Zero modification to existing behavior** — all new fields are optional, all hooks are opt-in
2. **No ElementIdentity extension** — childCount/isConnected are observation context, not element identity
3. **No fire-and-forget** — behavioral observations use buffered delivery with retry
4. **Type safety** — no `as any`, proper typed fields
5. **click + change only** — not mousedown, not keyboard, not scroll

## Acceptance Criteria

- [ ] BehavioralObserver correctly detects attribute changes, childList additions/removals, characterData changes
- [ ] Adaptive stability window: 200ms quiet period resets on mutation, max 3000ms timeout
- [ ] Element removal detected via parent MutationObserver + isConnected fallback
- [ ] Property-gap mitigation: checked/value captured via pre/final snapshots
- [ ] Honest empty: no mutations → effects: [], not omitted
- [ ] Double-finalize prevention: observer cannot complete twice
- [ ] disconnectAll cleanup: all observers and timers released
- [ ] EventTap onAfterEvent fires only on main capture path (click+change), not navigation/blur/synthetic
- [ ] BehavioralObservation delivered via separate buffered message with retry
- [ ] eventId correlation matches against memberEvents in liveInteractions
- [ ] Pending effects attach when interaction is later emitted
- [ ] Side panel shows collapsible behavioral effects section
- [ ] Side panel refreshes on INTERACTION_EFFECTS_UPDATE
- [ ] No existing tests broken (excluding pre-existing milestone4 timing artifacts)
- [ ] Extension builds successfully with all M1 code bundled

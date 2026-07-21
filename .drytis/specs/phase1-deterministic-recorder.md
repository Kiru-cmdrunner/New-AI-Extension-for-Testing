# Phase 1 — Deterministic Recorder

## Goal
Replace the 3 overlapping pipelines (legacy 6-script, Architecture C, Pipeline V2) with a single deterministic content script that captures exactly what the user did. No classification, no interaction types, no AI, no intent inference.

## Architecture

```
Content Script (1 file, replaces 9):
  deterministic-recorder.ts
    ├── Capture-phase listeners: mousedown, focus, blur, change, input, click
    ├── resolveTarget() from observer-helpers → correct element
    ├── extractIdentity() from observer-helpers → stable 18-field identity
    ├── Value tracker (Map<key, {value, checked}>) → before/after transitions
    └── Send RECORDED_EVENT message to service worker

Service Worker:
    ├── Receive RECORDED_EVENT → assign eventId → store in session → persist
    ├── webNavigation.onCommitted → navigation event → store in session
    ├── START_RECORDING / STOP_RECORDING lifecycle
    └── On Stop → produce ReplayJson → persist + notify side panel

Session:
    ├── events: RecordedEvent[]  (flat ordered list)
    ├── start/stop lifecycle (existing, reused)
    ├── addEvent() → assign eventId, append, persist
    ├── addNavigation() → dedupe consecutive same-URL
    └── toReplayJson() → ReplayJson

Side Panel:
    ├── Recording view → Stop + timeline of raw events
    └── Stopped view → timeline + collapsible Replay JSON
```

## Data Model

### RecordedEvent
Two variants (not 8) — navigation vs element events:

```typescript
interface NavigationEvent {
  eventId: string;        // "evt-0001"
  eventType: 'navigation';
  timestamp: string;      // ISO 8601
  url: string;
  title: string;
}

interface ElementEvent {
  eventId: string;
  eventType: 'click' | 'focus' | 'blur' | 'change' | 'input';
  timestamp: string;
  target: ElementIdentity;
  valueBefore: string | null;
  valueAfter: string | null;
  checkedBefore: boolean | null;
  checkedAfter: boolean | null;
}

type RecordedEvent = NavigationEvent | ElementEvent;
```

### ReplayJson
```typescript
interface ReplayJson {
  schemaVersion: 1;
  recordingContext: RecordingContext;
  events: RecordedEvent[];
}
```

## Value Before/After Strategy

The value tracker is a `Map<elementKey, {value, checked}>` that snapshots element state:

- **mousedown** → snapshot value/checked into tracker (before-state for click)
- **focus** → snapshot value into tracker (before-state for input/change)
- **click** → read checkedBefore from tracker; for checkboxes/radios, defer checkedAfter read with setTimeout(0) (activation behavior runs after event dispatch)
- **change** → before from tracker, after from element; update tracker
- **input** → before from tracker, after from element; update tracker
- **blur** → before from tracker, after from element; delete from tracker

## Acceptance Criteria

- [ ] Single content script `deterministic-recorder.ts` loaded on all pages
- [ ] Content script uses proven helpers (resolveTarget, extractIdentity, captureValue, captureCheckedState) from observer-helpers.ts
- [ ] Manifest loads only the new script (old scripts removed from manifest)
- [ ] Service worker handles RECORDED_EVENT messages and assigns event IDs
- [ ] RecordingSession stores RecordedEvent[] and produces ReplayJson
- [ ] Navigation events captured via webNavigation API
- [ ] Side panel shows raw event timeline during recording (event type + target name + value transitions)
- [ ] Stopped view shows timeline + collapsible Replay JSON
- [ ] No interaction type classification, no AI, no generation engine in active code path
- [ ] Unit tests for: resolveTarget correctness, extractIdentity completeness, value tracker before/after logic
- [ ] Integration tests for: click on button, type in text field (focus→input→blur), checkbox toggle, select change
- [ ] Replay JSON structure is valid and complete
- [ ] Extension builds with `npm run build` without errors
- [ ] All tests pass with `npm run test`

## What Gets Removed from Active Path

- 6 legacy content scripts (removed from manifest)
- universal-observer-init.ts, state-tracker-init.ts, v2-observer-init.ts (removed from manifest)
- Architecture C pipeline (removed from service worker imports)
- Pipeline V2 (removed from service worker imports)
- Interaction type registry (removed from service worker + side panel imports)
- Generation engine (removed from service worker)
- AI service (removed from service worker)
- Screenshot service (removed from service worker)

## What Stays

- observer-helpers.ts (proven functions, imported by new recorder)
- action-id.ts, element-id-generator.ts (ID generation)
- storage-service.ts, messaging.ts (infrastructure)
- Settings page (unchanged)
- Repository manager (unchanged, orthogonal to recorder)
- Old files remain on disk for reference (not loaded, not imported)

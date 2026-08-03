# Milestone 2 — Navigation Recording Foundation

## Objective
Implement the first recording capability: capture only page navigation events. Validate the recording pipeline before introducing clicks, AI, or element identification.

## Files to Change

### New files
- `src/recorder/action-id.ts` — unique Action ID generator
- `src/recorder/recording-session.ts` — session management (start/stop, dedup, event store)
- `tests/action-id.test.ts` — Action ID uniqueness tests
- `tests/recording-session.test.ts` — session lifecycle + dedup tests

### Modified files
- `src/shared/types.ts` — add `NavigationEvent` interface, `SESSION_EVENTS` storage key, new message types
- `src/storage/storage-service.ts` — add session event get/append/clear methods
- `src/background/service-worker.ts` — wire `chrome.webNavigation` listener + session lifecycle
- `src/manifest.json` — add `webNavigation` permission
- `src/sidepanel/index.html` — add live navigation timeline section
- `src/sidepanel/sidepanel.ts` — live timeline rendering via `chrome.storage.onChanged`, send messages to background
- `src/sidepanel/sidepanel.css` — timeline styles

## Architecture — Data Flow

```
User clicks Start → side panel sends START_RECORDING message to background →
  background creates RecordingSession (isRecording=true, events=[]) →
  background writes RecordingState to storage
User navigates → chrome.webNavigation.onCommitted fires →
  background calls RecordingSession.addNavigation(url, title) →
    generates Action ID, dedups (skip if same URL as last event), appends to events →
    StorageService persists events to chrome.storage.local →
  chrome.storage.onChanged fires → side panel re-renders timeline live
User clicks Stop → side panel sends STOP_RECORDING message to background →
  background stops RecordingSession, writes Stopped to storage
```

## Event Shape

```typescript
interface NavigationEvent {
  actionId: string;      // unique ID, e.g. "nav-0001", "nav-0002"
  type: 'navigation';
  url: string;           // destination URL
  title: string;         // page title
  timestamp: string;     // ISO timestamp
}
```

## Acceptance Criteria

- [ ] Start Recording creates a new recording session and clears old events
- [ ] Stop Recording ends the session (no new events captured)
- [ ] Only navigation events (URL + title + timestamp) are recorded — no clicks, text, scroll, hover
- [ ] Each navigation event has a unique Action ID
- [ ] Events appear immediately in the side panel (live timeline)
- [ ] No duplicate navigation events (same consecutive URL is skipped)
- [ ] Events are stored temporarily in chrome.storage.local and cleared on next Start
- [ ] Side panel sends START/STOP messages to background service worker (not just writes to storage)
- [ ] Unit tests pass for: action-id uniqueness, session lifecycle, dedup logic, storage operations
- [ ] Extension builds with `npm run build`
- [ ] No console errors

## Edge Cases
- Rapid navigation to the same URL → only first occurrence captured (dedup)
- Navigation while not recording → ignored
- Many navigations → Action ID increments sequentially (nav-0001, nav-0002, ...)

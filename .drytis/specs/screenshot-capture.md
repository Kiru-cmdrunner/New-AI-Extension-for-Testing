# Milestone: AI Vision Infrastructure — Screenshot Capture Service

## Objective

Prepare the extension to support AI Vision in future milestones by building a
screenshot capture service. Screenshots are captured at meaningful action points,
linked to Action IDs and Element IDs, and stored — but **not analyzed**. This is
purely infrastructure preparation.

## Constraints

- **Do NOT modify** existing pipeline (Recorder, Element Identity, Execution JSON, Repository)
- **Do NOT** analyze screenshots with AI
- **Do NOT** change Execution JSON structure
- **Do NOT** capture continuously — only on meaningful actions
- Existing recording **must work exactly as before** with zero regression

## Files to Change

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `ScreenshotMetadata` interface, `SCREENSHOTS` storage key |
| `src/screenshots/screenshot-service.ts` | **NEW** — capture, store, retrieve, clear |
| `src/background/service-worker.ts` | Hook screenshot capture after action events |
| `src/sidepanel/index.html` | Add screenshots verification panel |
| `src/sidepanel/sidepanel.ts` | Render screenshot count + metadata |
| `src/sidepanel/sidepanel.css` | Styles for screenshot panel |
| `src/manifest.json` | Bump version, add `tabs` permission for `captureVisibleTab` |
| `tests/screenshot-service.test.ts` | **NEW** — unit tests |

## Types

### ScreenshotMetadata

```typescript
interface ScreenshotMetadata {
  screenshotId: string;    // e.g. "shot-0001"
  timestamp: string;       // ISO timestamp
  actionId: string;        // linked action (e.g. "click-0001")
  elementId: string | null; // linked element (null for navigation)
  actionType: string;      // "navigation" | "click" | "text_entry" | "dropdown"
  dataUrl: string;         // base64 PNG screenshot image
}
```

## Architecture

```
Browser Event → Content Script → Service Worker
                                      │
                                      ├─→ RecordingSession (existing, unchanged)
                                      │
                                      └─→ ScreenshotService.capture(tabId, actionId, elementId)
                                              │
                                              ├─ chrome.tabs.captureVisibleTab()
                                              │
                                              └─ Store metadata to chrome.storage.local
```

The screenshot service runs **after** the event is added to the session. It is
fire-and-forget (async, non-blocking) so it never delays the recording pipeline.

## Trigger Points

Screenshots are captured for:
- Navigation events (elementId = null)
- Click events
- Text entry events
- Dropdown events

Each screenshot is linked to the event's actionId and elementId.

## Storage

Screenshots are stored in `chrome.storage.local` under key `session_screenshots`.
Stored as an array of ScreenshotMetadata objects. The `dataUrl` is a base64 PNG.

Note: chrome.storage.local has a ~10MB limit per key. If screenshot storage grows
large, we will offload to IndexedDB in a future iteration. For now, the service
limits captures to the current session and clears on new recording start.

## Acceptance Criteria

- [ ] Screenshots are captured successfully using `chrome.tabs.captureVisibleTab`
- [ ] Each screenshot has: screenshotId, timestamp, actionId, elementId, actionType, dataUrl
- [ ] Screenshots are triggered only on meaningful actions (nav, click, text, dropdown)
- [ ] Screenshot capture does not block or delay the recording pipeline
- [ ] Screenshots are cleared when a new recording session starts
- [ ] Side panel shows screenshot count + metadata for verification
- [ ] Existing recording works exactly as before (no regression)
- [ ] All existing tests pass
- [ ] New unit tests cover ScreenshotService methods

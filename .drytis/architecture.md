# Architecture

## Directory Structure
```
src/
  manifest.json              — Manifest V3 config (side_panel, action, options_page, service_worker)
  background/
    service-worker.ts        — extension lifecycle, side panel open, message routing
  sidepanel/
    index.html               — Side Panel entry HTML
    sidepanel.ts             — Side Panel logic (state management, button handlers)
    sidepanel.css            — Side Panel styles
  settings/
    index.html               — Settings/options page entry HTML
    settings.ts              — Settings page logic
    settings.css             — Settings page styles
  storage/
    storage-service.ts       — chrome.storage.local wrapper, UI state persistence
  shared/
    types.ts                 — RecordingState enum, AppMessage types, StorageKeys
    messaging.ts             — typed message helpers between background/sidepanel
  assets/
    icon-16.png
    icon-48.png
    icon-128.png
  recorder/                  — (empty, placeholder for M2)
  ai/                        — (empty, placeholder for M3)
tests/
  storage-service.test.ts
  messaging.test.ts
  state-management.test.ts
```

## Data Flow
```
User clicks extension icon
  → background service-worker opens Side Panel
  → Side Panel loads, reads last state from Storage Service
  → User clicks "Start Recording" → state = Recording → persisted to storage
  → User clicks "Stop Recording" → state = Stopped → persisted to storage
  → On reopen: Side Panel reads last state from Storage Service
```

## State Machine
```
Ready → (Start Recording) → Recording
Recording → (Stop Recording) → Stopped
Stopped → (Start Recording) → Recording
```

## Messaging Protocol
```
START_RECORDING  → background updates state
STOP_RECORDING   → background updates state
OPEN_SETTINGS    → background opens settings tab
GET_STATE        → side panel queries current state
```

## UI States & Visual Design
- **Ready:** Blue/green accent, "Ready to record" message, Start button visible
- **Recording:** Red pulsing indicator, "Recording..." message, Stop button visible
- **Stopped:** Gray accent, "Recording stopped" message, Start button visible, step count placeholder

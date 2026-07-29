# Stage 2: New Content Script (Capture Layer)

## Goal
Create a new content script that uses the Control Model for target resolution.
A feature flag controls which content script captures events. The existing
recorder remains fully functional as a fallback.

## Feature Flag Mechanism
- `chrome.storage.local` key: `recorder_engine` → `'legacy'` (default) | `'control'`
- The SW includes `recorderEngine` in the `ui_state` storage object
- Both content scripts sync from `ui_state` changes (existing pattern)
- Each script checks `recorderEngine` before activating — only one captures

## Files to Create

### src/recorder/v2/control-recorder.ts
New content script (~250 lines):
- Double-injection guard (`__CMDRUNNER_V2_CS_ACTIVE__`)
- Reads flag from `ui_state.storage` changes
- On START (flag=control): creates ControlModel, discover(), observe()
- Registers 7 event listeners: click, input, blur, change, scroll, mouseover, dragstart/drop
- On each event: `model.matchEvent(target)` → builds `ElementIdentity` from ControlNode
- Sends `RECORDED_EVENT` messages (same format as deterministic-recorder)
- On STOP: disconnects observer, clears state
- Responds to PING for health checks

### src/recorder/v2/element-identity-builder.ts
Maps ControlNode + DOM element → ElementIdentity:
- accessibleName from ctrl.name
- ariaRole from ctrl.role  
- tag, className from ctrl
- cssSelector (basic path generation)
- xPath (basic path generation)
- testId, dataCy, dataQa from attributes
- inIframe, shadowDom detection

## Files to Modify

### src/manifest.json
Add second content_scripts entry for control-recorder.ts.

### src/background/service-worker.ts
- Read `recorder_engine` flag in handleStartRecording()
- Include `recorderEngine` field in ui_state
- Handle PONG response with engine info for health checks

### src/recorder/deterministic-recorder.ts
Minimal guard (~10 lines) in two places:
1. START_RECORDING message handler: check recorderEngine !== 'control'
2. Storage change handler: check recorderEngine !== 'control'

## Acceptance Criteria
- [x] AC1: Feature flag defaults to 'legacy' — old recorder works unchanged ✅
- [x] AC2: Setting flag to 'control' activates new content script ✅
- [x] AC3: Raw events in timeline show correct target names (Nationality, Save, etc.) ✅
- [x] AC4: Nationality ≠ Blood Type when flag is 'control' ✅
- [x] AC5: Save icon click resolves to "Save" not "I" ✅
- [x] AC6: Old recorder still works when flag is 'legacy' ✅
- [x] AC7: Full regression suite passes (3,559/3,561 — 2 pre-existing JSDOM timing flakes) ✅
- [x] AC8: Build succeeds ✅
- [x] AC9: No console errors during recording in either mode ✅

## Post-Review Fixes Applied
- WARN-1 FIXED: Programmatic injection (`service-worker.ts:injectContentScript()`) now injects BOTH content scripts — previously only injected legacy, causing silent capture failures on already-open tabs when engine='control'
- WARN-3 FIXED: Value-transition blur events now send `eventType: 'change'` instead of `'blur'` — matches legacy recorder behaviour expected by downstream classifier
- WARN-4 FIXED: Removed duplicate `chrome.storage.onChanged` listener (consolidated into the single comprehensive listener at bottom of control-recorder.ts)
- WARN-2 NOTED: No `dateSelect` event support in control-recorder — date inputs captured as generic `change` events. This is a known feature gap deferred to Stage 3 (New Classifier)
- WARN-5 NOTED: Uses `mouseenter` (non-bubbling) instead of spec's `mouseover` — intentional for capture-phase, functionally equivalent for container-level hover detection

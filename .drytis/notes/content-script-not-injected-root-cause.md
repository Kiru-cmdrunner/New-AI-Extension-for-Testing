# Content Script Not Injected — The Silent Capture Killer

## Symptom
Extension v10.3.3 loaded, recording active, but ONLY the initial NAV event appears in the timeline.
No clicks, no inputs, no dropdown selections — nothing. Screenshot showed adanione.com flight booking
with multiple user interactions (dropdown, date picker, search results) but timeline had just 1 event.

## Root Cause
Chrome does NOT inject content scripts into already-open tabs when an extension is reloaded/updated.
When the user loads v10.3.3 in chrome://extensions, the adanione.com tab was already open from a
previous session. The old content script (from the previous extension version) becomes **orphaned**:
- Its `chrome.runtime.sendMessage()` throws "Extension context invalidated"
- The catch{} block silently swallows the error
- No events reach the service worker
- The new content script is NEVER injected

The initial NAV event works because it comes from the service worker directly (webNavigation API),
not from the content script.

## Fix (v10.4.0)
1. **Programmatic injection** via `chrome.scripting.executeScript` API
   - Added "scripting" permission to manifest.json
   - Service worker pings the active tab on recording start: `{ type: 'PING' }`
   - If no PONG response, injects the content script programmatically
   - Double-injection guard (`window.__CMDRUNNER_CS_ACTIVE__`) prevents duplicate listeners

2. **Periodic health check** via `chrome.alarms` (every ~5s while recording)
   - Pings active tab, re-injects if missing
   - Catches SPA navigations, tab crashes, content script failures

3. **Side panel status indicator** — green/orange/red dot showing connection state
   - Green: "✓ Connected — events will be captured"
   - Red: "⚠ Tab not responding — try refreshing the page"

## Key Files Changed
- `src/manifest.json` — added "scripting" and "alarms" permissions
- `src/recorder/deterministic-recorder.ts` — injection guard, PING handler
- `src/background/service-worker.ts` — pingTabContentScript, injectContentScript,
  ensureContentScriptInjected, checkActiveTabHealth, alarms-based health check
- `src/sidepanel/sidepanel.ts` — updateCsStatus, CONTENT_SCRIPT_STATUS listener
- `src/sidepanel/index.html` — cs-status indicator element
- `src/sidepanel/sidepanel.css` — cs-status styles
- `src/shared/types.ts` — PING and CONTENT_SCRIPT_STATUS message types

## Lesson
Always test with already-open tabs after reloading an extension. The declarative content_scripts
in manifest.json only fire on NEW page loads. For existing tabs, you MUST programmatically inject
via chrome.scripting.executeScript.

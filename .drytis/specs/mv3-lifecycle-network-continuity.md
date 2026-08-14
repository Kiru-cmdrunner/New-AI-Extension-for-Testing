# MV3 Lifecycle Network Continuity

## Problem

Real-world Amazon validation showed the add-to-cart form-POST evidence missing
across three attempts on the fixed build. Root cause (code-proven, not timing):

**Defect A — webRequest listeners die with the service worker.**
`chrome.webRequest.*` listeners were registered ONLY inside
`registerWebRequestListeners()` (network-observation.ts), called ONLY from
`startNetworkObservation()`, called ONLY from `handleStartRecording()`.
When the MV3 service worker is terminated (idle timeout — the health alarm at
0.08 min is clamped by Chrome to ≥30 s), the freshly-run SW top-level code
registers `webNavigation.onCommitted`, `onMessage`, `onInstalled`, `onAlarm`
but NOT webRequest. Requests firing during a dead window wake the SW — the
add-to-cart POST is observed by nothing. `onCommitted`-derived evidence
(fromUrl) keeps working, which matches the observed recordings exactly.

**Defect B — MAIN-world interceptor injected once per recording.**
`injectNetworkInterceptor()` ran only at recording start on the start
document. The first full-page reload destroys that document's JS context —
the fetch/XHR patch and the PerformanceObserver are gone from every later
page. `checkActiveTabHealth()` re-injects only the content script, never the
MAIN-world script.

## Fix design (structural, no timing-based correctness)

### Fix A — top-level idempotent registration gated by persisted state

- `network-observation.ts` registers webRequest listeners at module top level
  (runs at every SW start), unconditionally, idempotently.
- Callbacks no longer depend on registration timing:
  - If `activeTabId` is set → capture and forward as today.
  - If `activeTabId` is null but the tab is currently recording per a
    per-tab persisted gate → buffer the request into the ring WITHOUT
    forwarding to the content script (the page's bridge is not running; the
    stop-time drain recovers it).
- Per-tab persisted recording gate: `chrome.storage.local` key
  `cmdrunner_net_observing_tabs` (array of tabIds recording is active on).
  Written at start, cleared at stop; cleared for a tab on webNavigation
  commit away... — no: cleared at stop only. Tab close cleanup via
  `chrome.tabs.onRemoved` best-effort.

### Fix B — persist/restore activeTabId

- `startNetworkObservation(tabId)` persists the tab set;
  `stopNetworkObservation()` clears it.
- On SW wake, module init reads the persisted tab set (async) and seeds
  `activeTabId` — callbacks that fire during the read window use the
  unknown-state buffering path (Fix A) so nothing is lost.

### Fix C — MAIN-world interceptor on every document

- `network-inject.js` becomes a manifest `content_scripts` entry with
  `"world": "MAIN"`, `run_at: document_start`, matching `<all_urls>` —
  auto-injected on every document load without SW involvement.
- The interceptor is recording-gated: it captures only while recording is
  active. Gate signal: the isolated-world content script, which has the
  authoritative per-document recording state (`sessionStorage` RECORDING_KEY
  + START/STOP broadcasts), sets `document.documentElement` dataset flag
  `cmdrunner-net-active` — readable from MAIN world — on start/stop, and the
  manifest content script syncs `sessionStorage` on load.
- Dynamic `chrome.scripting.executeScript` injection remains as a no-op-safe
  fallback (idempotent guard `window.__cmdrunnerNetPatched` already exists).
- MAIN-world events flow to the bridge as today (`cmdrunner-net` CustomEvent).

## Files

- `src/manifest.json` — add MAIN-world content_scripts entry.
- `src/background/network-observation.ts` — top-level registration, persisted
  tab gate, unknown-state buffering, start/stop manage the persisted set.
- `public/assets/network-inject.js` — recording gate via dataset flag.
- `src/recorder/phase5/recorder-entry.ts` — set/clear dataset flag on
  start/stop.
- `tests/background/mv3-lifecycle-continuity.test.ts` — new regression suite.

## Acceptance criteria

- [ ] Importing `network-observation` with no prior recording registers all
      four webRequest listeners at module load (SW restart simulation).
- [ ] Simulated SW restart mid-recording (fresh import, persisted tabs set):
      a main-frame POST is still captured into the ring with sourceEventId
      and recovered by `getCompletedBySourceEventId` at stop.
- [ ] Requests on tabs NOT in the persisted set are ignored.
- [ ] Unknown-state buffering: request for a recording tab arriving before
      module state is seeded is buffered (ring), not forwarded, and drainable.
- [ ] Manifest declares network-inject.js as MAIN-world content script.
- [ ] network-inject.js gates capture on the dataset flag; dispatches
      nothing when flag absent.
- [ ] recorder-entry sets/clears the dataset flag on start/stop.
- [ ] Existing requestId/sourceEventId correlation tests still pass.
- [ ] Full suite green; TSC 0 errors; clean build; ZIP from committed HEAD.

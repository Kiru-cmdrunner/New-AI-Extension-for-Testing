# D8 — NetworkBridge ready-handshake: truthful MAIN-world status

## Root cause (read-only investigation, 2026-08-18)

The MAIN-world interceptor `public/assets/network-inject.js` (manifest content
script, `world: MAIN`, `run_at: document_start`) dispatches
`cmdrunner-net-ready` **once, at document load** (and once per re-injection,
when `window.__cmdrunnerNetPatched` is already set). The ISOLATED-world
`NetworkBridge` (src/tap/network-bridge.ts) attaches its `cmdrunner-net-ready`
listener only inside `start()`, which the recorder calls at
**START_RECORDING** — long after document load. The event has already fired
and been dropped.

A secondary compensating path exists: `startNetworkObservation()` re-injects
the script at recording start (`injectNetworkInterceptor`, `injectImmediately:
true`). Because `network-inject.js` begins with a double-injection guard that
re-dispatches `cmdrunner-net-ready` **synchronously**, the re-injection SHOULD
satisfy the handshake. Two timing realities defeat it:

1. `chrome.scripting.executeScript` is async and unawaited relative to the
   content-script `START_RECORDING` handler that constructs and `start()`s the
   NetworkBridge — the re-dispatched ready event can fire before the bridge's
   listener is attached (lost again), and the bridge's own 500 ms timeout
   measures from its `start()`, not from the injection.
2. If re-injection fails (CSP `world: MAIN` restrictions on some pages), no
   ready event ever arrives post-load, and the bridge can't distinguish
   "MAIN world present but loaded earlier" from "MAIN world absent".

**Net defect (D8):** `mainWorldActive` is wrongly `false` and the SW console
permanently shows `[NetworkBridge] MAIN-world interceptor NOT active after
500ms — webRequest-only mode`, even on pages where the MAIN-world interceptor
is demonstrably installed and delivering `cmdrunner-net` events. Capture
itself works (per-request dispatches are gated on the DOM attribute, not the
flag). The flag and diagnostic are wrong, not the capture.

## Smallest correct fix (additive, no behavior change to capture)

The interceptor is load-ordered ahead of the bridge by manifest and by
re-injection. The truthful signal for "the MAIN world is ready" is therefore
**presence of the patch marker** (`window.__cmdrunnerNetPatched === true`,
readable from the ISOLATED world — same renderer, shared window object for
property reads is NOT available cross-world... verified: worlds do not share
window properties).

Therefore the fix uses the bridge's own evidence channels:

1. **`network-inject.js`** (MAIN world): on `cmdrunner-net-ready` dispatch,
   additionally record readiness durably on the **shared DOM** (the same
   channel already used for the recording gate):
   `document.documentElement.setAttribute('data-cmdrunner-net-ready', 'true')`.
   DOM attributes ARE shared between MAIN and ISOLATED worlds.
2. **`network-bridge.ts`** (ISOLATED world): in `start()`, before starting the
   500 ms ready-wait, check the DOM marker
   `data-cmdrunner-net-ready === 'true'`; if set, set `mainWorldActive = true`
   immediately (the interceptor signalled ready on this document at load or
   re-injection). Keep the CustomEvent listener as-is for the in-window race
   (bridge started before the re-injection's synchronous re-dispatch).
3. Diagnostic string stays, but now fires only when BOTH channels are absent
   (marker unset AND no event within 500 ms) — the true "webRequest-only"
   condition (CSP-blocked page or injection failure).

Files touched (exactly three + tests):
- `public/assets/network-inject.js` — add the DOM ready-marker (2 lines).
- `src/tap/network-bridge.ts` — `start()` reads the marker (≈6 lines).
- `tests/tap/network-bridge.test.ts` — regression tests (red → green).
- (doc-comment only) `src/recorder/phase5/recorder-entry.ts` — NOT touched;
  the recorder wiring is already correct.

Out of scope (unchanged): capture gating (DOM attribute `data-cmdrunner-net-
active`), dedup, buffer, stop signal, `network-observation.ts`, `manifest.json`.

## Acceptance criteria

- [ ] `NetworkBridge.start()` sets `mainWorldActive = true` when
      `document.documentElement` carries `data-cmdrunner-net-ready="true"`
      (marker path) — no 500 ms wait, no false diagnostic.
- [ ] Event path still works: `cmdrunner-net-ready` dispatched after `start()`
      still sets the flag (existing test stays green).
- [ ] Marker path does NOT survive `stop()` → new `start()` correctly
      re-evaluates (marker still present on the same document = still ready;
      this is by design — the interceptor persists for the document).
- [ ] No event + no marker → flag stays `false` and the diagnostic fires
      (existing honest fallback preserved).
- [ ] `network-inject.js` sets the marker at BOTH dispatch sites (first
      install + double-injection guard) and clears it in the stop handler
      (`cmdrunner-net-stop` restores originals and removes the marker).
- [ ] Unit tests: marker path, event path, neither path, marker-set-but-event-
      also-arrives (idempotent), stop clears nothing incorrectly.
- [ ] Real-Chrome: recording on the replica shows `mainWorldActive = true`
      evidence — i.e. the SW debug line "[NetworkBridge] MAIN-world
      interceptor active" appears (marker path), and the false
      "webRequest-only mode" line does NOT appear on a normal page; zero
      unexpected console errors.

## Tests

Red-phase additions to `tests/tap/network-bridge.test.ts` (jsdom-style
harness already dispatches CustomEvents on `window`):

1. `start() with data-cmdrunner-net-ready marker → isMainWorldActive() true`
   (set attribute on document.documentElement before start).
2. `marker absent, event within 500 ms → true` (existing behavior, keep).
3. `marker absent, no event → false after timeout` (existing, keep).
4. `stop() then start() again with marker still present → true` (document
   persistence semantics).
5. `network-inject.js` source-level assertions (string checks on the built
   asset): sets the marker at both ready-dispatch sites; clears it in the
   stop handler. (The MAIN-world script itself isn't unit-loadable in jsdom
   because it patches fetch/XHR at import time — source assertions are the
   honest level for this artifact.)

## Real-Chrome validation plan

Same proven CDP recipe (pinned Chrome 148, replica :8098, two-tab dance,
panel-websocket routing):
1. Record the shop flow.
2. Assert `document.documentElement.getAttribute('data-cmdrunner-net-ready')`
   === 'true' on the app tab (marker set by the manifest content script).
3. Assert the SW log (chrome://serviceworker-internals not reachable headless
   — instead capture via the bridge evidence): dispatch a fetch on the app
   tab DURING recording, then dump behavioral evidence / network entries and
   confirm main-world entries present (`source: 'main-world'` shape via
   dedup preference) — the observable consequence of a truthful handshake is
   unchanged capture; the regression target is the diagnostic.
   Where the SW debug line can't be captured directly, assert via the marker
   + unit tests (the diagnostic's truthfulness follows from mainWorldActive
   being correct).
4. Zero unexpected console errors in the app tab.

## Invariants honored

- INV-G6 (evidence ownership): no capture-behavior change; only the readiness
  diagnostic becomes truthful.
- Smallest-change rule: 3 files (+tests). No schema, env, service, proxy,
  dependency, or migration changes.

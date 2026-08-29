# Real-Chrome CDP Validation Technique (learned during D9, 2026-08-18)

Working recipe for validating the extension in real Chrome via CDP. Reuse for
E1 / D2 / D3 / D8 / D10 and any future real-Chrome gate.

## Launch (persistent terminal, NOT run_bash)
- Chrome launched from `run_bash` DIES when the tool call times out and its
  shell is killed. Use `open_terminal` + write_terminal to keep it alive.
- Only the pinned binary works:
  `/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome`
  — `/usr/bin/google-chrome` (151) does NOT load --load-extension in --headless=new.
- Flags: `--remote-debugging-port=9533 --user-data-dir=/tmp/<dir>/profile
  --load-extension=/workspace/dist --disable-extensions-except=/workspace/dist
  --headless=new --no-sandbox --disable-gpu --no-first-run --no-default-browser-check`
- Port squatters: `pkill -f remote-debugging-port` does NOT always match. Use
  `ss -tlnp | grep <port>` to find the pid and `kill -9 <pid>` by number.
- Cleanup at end: kill main Chrome pid by number (children die with it), then
  close_terminal. procmgr must stay 8/8 RUNNING.

## Driving the extension (the four traps)
1. **Flat-session attach to the MV3 SW target gives a DORMANT preview
   context** — `chrome.runtime` is `undefined` there. `Target.setDiscoverTargets`
   does not fix it. The LIVE contexts are reachable via each target's OWN
   `webSocketDebuggerUrl` from `/json/list` (direct ws connect).
2. **Route runtime messages through a PANEL PAGE's dedicated ws**
   (`chrome-extension://<id>/src/sidepanel/index.html`). Extension-origin pages
   keep live `chrome.runtime` bindings and `chrome.runtime.sendMessage` works
   from them while the app tab stays active/focused.
3. **Direct-ws `Runtime.evaluate` response shape is
   `{ result: { result: { value } } }`** (one deeper than flat-session) —
   reading `r.result.value` yields undefined.
4. **`Target.activateTarget` does NOT move tab focus in headless.** The
   extension's `getActiveTab()` (tabs.query active+currentWindow) follows
   `chrome.tabs.update(<id>, {active:true})` — call that from the panel page
   before every START_RECORDING/STOP_RECORDING. Also navigate the app tab to
   the start URL BEFORE sending START (startUrl = active tab url at START).

## Storage keys
chrome.storage.local uses BOTH shapes: internal state keys are prefixed
(`cmdrunner_recording_active`, …) but app-data keys are UNPREFIXED:
`execution_ir_plan`, `generated_files`, `session_context`, `ui_state`,
`understanding_result`. Read from the panel page context.

## Reference harness
`/workspace/.drytis/notes/evidence/d9-harness.mjs` — complete working harness
(two-tab dance, resize via Browser.setWindowBounds before START, record flow
on replica :8098, dump storage, run 13 assertions, second identical session
for in-vivo determinism). Replica server: `/tmp/d9-val/server.mjs` (port 8098).

# Post-navigation evidence capture (NAV pull model) — implementation & two E2E-discovered races

Spec: `.drytis/specs/post-nav-evidence-capture.md`. Milestone: destination-page
DOM/surface/visibility evidence lands on the **Navigation interaction** after a
full-page reload (form submit, link, reload, typed), via a CS-initiated pull.

## Architecture (as built)
- `src/shared/post-nav-types.ts` — PostNavCaptureRecord, MAX_NAV_CAPTURE_ENTRIES=16, TTL=30s.
- `src/background/post-nav-capture.ts` — SW-side in-memory bounded store (latest-wins per tab, consume-on-pull, TTL, no persistence by design).
- `service-worker.ts` onCommitted — writes the record **synchronously BEFORE any await**, keyed by `navPullEventId`; the same id is reused as the canonical `navEvent.eventId` so synthetic placeholder and rich CS evidence share one correlation key. Hoisted `FULL_RELOAD_TRANSITION_TYPES`.
- Router case `NAV_PENDING_REQUEST` → consume-on-pull → `{type:'NAV_PENDING_RESPONSE', payload}`.
- `recorder-entry.ts` auto-resume (both injection and pageshow/bfcache paths) → `pullPendingNavCapture()` → `evidenceCollector.openPostNavWindow(record)`.
- `evidence-collector.ts` `openPostNavWindow` — waits for document.body, opens a 'navigation'-typed window attributed to navEventId (isNavigationWindow, hard-cap maxDurationMs=3s default, holdOpen cleared), rebuilds navigation entry from fromUrl/toUrl/navType, delivers via standard BEHAVIORAL_EVIDENCE → Tier-1 sourceEventId attach → richness-replace swaps the placeholder.

## Race #1 (SW side) — record written after awaits
Destination CS pulls at document_start in the same tick as the commit. Original
placement of `recordPendingNavCapture` was after `await ensureSessionRestored()`
+ `await chrome.tabs.get()` → pull read null and never retried.
**Fix: write the record in the first synchronous statement of the onCommitted listener.**

## Race #2 (CS side) — pull before startRecording assigns the collector
`startRecording()` is async; `evidenceCollector` is only assigned after
`await flushPendingEvents()`. The auto-resume block called
`startRecording(); pullPendingNavCapture();` in the same tick → the pull
no-oped on `evidenceCollector === null`.
**Fix: `void startRecording().then(() => pullPendingNavCapture())` in BOTH the
injection-time block and the pageshow (bfcache) handler.**

## Real-Chrome verification harness (reusable)
- `/workspace/.drytis/post-nav-verify.mjs` original; working copy with fixes:
  `/workspace/.drytis/zz-run1.mjs` (full reload) and `zz-spa.mjs` (SPA).
- **System Chrome 151 silently ignores `--load-extension`** — MUST use
  Chrome-for-Testing: `/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome`.
- START/STOP must go through an extension page (`chrome.runtime.sendMessage`
  from sidepanel/index.html via Target.createTarget), NOT tabs.sendMessage from
  the SW (SW→CS delivery is unreliable for control messages in this setup).
- PASS shape: Navigation interaction with `windowId=ev-nav-*`,
  `endReason=stabilized`, domChanges≥1, newSurfaces≥1, real navEntry
  (type=form_submit, batchIndex 0, relativeTime>0). Placeholder fallback shape
  (pre-fix): `windowId=synthetic-nav-*`, `endReason=page-reload-synthetic`, all-zero.
- SPA (pushState) run: 0 Navigation interactions in BOTH baseline and WIP —
  pre-existing behavior of the synthetic-nav path in this harness, NOT a
  regression. Do not burn cycles re-checking it here.
- Harness quirk: `addScriptToEvaluateOnNewDocument` probe never surfaced
  (probe:null) — page session was attached after renderer swap; harmless.

## Invariants held
- Click (Go) keeps its own evidence; network=1 row on the click (INV-5 stamped
  routing intact — nav GET stays unstamped/synthetic-visible only).
- 160 files / 3200 tests green; tsc 0; SW inline 516,287 B, 0 import(, 0
  __vitePreload; zip 226,628 B md5 9c184f7c1c2790c7aa400658d87fcba1 (26
  entries, CRC OK).

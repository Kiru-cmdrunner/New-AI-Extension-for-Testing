# SW dynamic import failure — TRUE root cause (unmasked in real Chrome)

## TL;DR
`import()` (dynamic import) is **disallowed on ServiceWorkerGlobalScope by the HTML
spec** (w3c/ServiceWorker#1356). Chrome throws `TypeError: import() is disallowed...`
for EVERY dynamic import in the MV3 service worker — M9 pipeline, NetworkDrain,
IR Bridge, Repository V2, staleness, IR executor. This is NOT a `window` bug.

The `window is not defined` message is a **mask**: Vite's `__vitePreload` helper wraps
every dynamic import as `e().catch(s)`, and `s()` does `new Event(...); window.dispatchEvent(a)`
before rethrowing. With no `window` in the SW, `s()` throws FIRST and Chrome reports
`window is not defined` at `s (1:1242)` — hiding the real TypeError.

Timeline of the two bugs:
- OLD build (`modulePreload` default): helper ran `document.getElementsByTagName` during
  preload setup with NON-EMPTY deps → died at `document is not defined` (2:353) BEFORE
  even calling `import()`. So we never saw the deeper import() ban.
- `modulePreload:false` fix: deps=[] → guard skips preload → `e()` (the real import())
  finally runs → Chrome's import()-ban TypeError → `.catch(s)` → `window is not defined` (1:1242).
The modulePreload fix was correct and necessary — it peeled layer 1. Layer 2 is the
actual architectural defect.

## Proof (real Chrome, headless, --load-extension=/workspace/dist)
1. Reproduced the exact user-visible errors via panel START/STOP drive (CDP console capture).
2. Built a DIAGNOSTIC dist copy with `s()` patched to print the real error:
   `[DIAG] REAL IMPORT REJECTION: TypeError: import() is disallowed on
    ServiceWorkerGlobalScope by the HTML specification` — for all 5 stages.
3. Direct CDP eval `import('./assets/...')` in the SW context: same TypeError.
4. Node ESM import of every chunk: all OK — proving chunk code itself is SW-safe
   (Dexie included; it guards BroadcastChannel/window). The failure is purely the
   import() *call form*, not the module content.
5. Spec: https://github.com/w3c/ServiceWorker/issues/1356 — dynamic import() inside
   a service worker is spec-banned (static imports are fine; that's why the SW boots).

## Why G4/G5 capture worked
network-observation/sw-integration are statically imported by the SW entry → fine.
Only the `await import(...)` call sites fail. G4/G5 added zero new failure modes.

## Pre-existing vs regression
Pre-existing since M9.12 (588bd8a), Phase 8.3 (13feae6), Phase 10.3 (1945e1e) —
all ancestors of origin tip. First observed now because nothing loaded the built
bundle in a real SW before. Not introduced by G4/G5 or the modulePreload fix.

## Correct architectural fix (proposed, NOT implemented)
The SW must not use dynamic import() at all. Options evaluated:
A) (RECOMMENDED, smallest, zero source edits) Force-bundle all dynamic imports into the
   SW entry via Rollup `manualChunks`/`inlineDynamicImports` for the SW build — Vite
   emits static imports; import() becomes in-bundle Promise.resolve().then(() => module).
   No preload helper, no dynamic import() call form, no window/document anywhere.
   Config-only change in vite.config.ts (crx SW entry).
B) Convert every `await import('X')` in service-worker.ts to static imports — touches
   ~20 sites, heavier, changes module-load timing (all stages load at SW boot).
C) Keep dynamic imports but via `importScripts` — not possible for ESM/SW module type.
A is smallest and preserves lazy-load semantics within the single bundle.

## Verification protocol after fix
- Rebuild → assert SW chunk has ZERO `import(` dynamic calls & no __vitePreload helper.
- Puppeteer drive START/STOP in real Chrome → NO M9/NetworkDrain/IR/Repository warnings;
  then chrome.storage.local probe shows understanding_result with outcomes/transitions.
- Regression: /cart/add-to-cart exactly-once on the click (capture path unchanged).

## 4 cart rows note (user probe)
Probe `cartRows: 4` with bodyKeys [0, 42, 0, 0] — the filter was `url.includes('/cart/add-to-cart')`
on int-22's rows: matches 1 POST + patc-template GET + get-cart-items GET + possibly a
preflight/nav — NOT a duplication bug. The 42-key body on the POST row is the real Amazon
add-to-cart form body (ASIN.1, quantity.1 etc. expected). Panel showed exactly one POST
row → capture is fine; the probe filter was just broad.
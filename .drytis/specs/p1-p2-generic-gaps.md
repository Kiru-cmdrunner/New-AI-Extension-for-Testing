# P1 + P2 — Generic Gaps Fix: data-sku-only Entity Assertions (G2) + JS Dialog Capture (G1)

Status: IMPLEMENTED (this slice) — validated by unit tests + the full real-Chrome matrix.
RCA source: `.drytis/notes/rca-full-audit-gaps-2026-08-20.md`
Baseline evidence: `.drytis/notes/evidence/full-audit-350af71/r3-run8-final.log` (31 PASS / 2 FAIL — the 2 FAILs are exactly these gaps).

Both fixes are **generic and convention-based**. No AdaniOne-, Amazon-, or R3-specific logic, no timing-rule changes.

## P1 / G2 — single-attribute entity identity

### Root cause
`src/understanding/page-content/page-content-config.ts` had ONE generic entity entry
`[data-product-id], [data-item-id], [data-sku]` with `idAttribute: 'data-product-id'`.
Elements carrying only `data-sku` or `data-item-id` matched the selector but captured
`entityId: null` → the entity assertion branch (Defect 2c's safe skip) derived nothing.

### Fix (capture-level, config only)
Split into per-identity-attribute entries with `:not()` guards so each element is captured
by EXACTLY ONE entry, with identity always set:

1. Co-occurrence entries (unchanged intent, now each demanding its own identity attr):
   - `[data-auto-id][data-sku]:not([data-product-id]):not([data-item-id])` (+ data-test-id variant) → idAttribute data-sku
   - `[data-auto-id][data-item-id]:not([data-product-id]):not([data-sku])` (+ variant) → idAttribute data-item-id
   - `[data-auto-id][data-product-id]:not([data-item-id]):not([data-sku])` (+ variant) → idAttribute data-product-id
2. Generic single-attribute entries (NEW — the fix):
   - `[data-product-id]` → idAttribute data-product-id (attrs: product/item/sku)
   - `[data-item-id]:not([data-product-id])` → idAttribute data-item-id (attrs: item/sku)
   - `[data-sku]:not([data-product-id]):not([data-item-id])` → idAttribute data-sku (attrs: sku)

Identity precedence: `data-product-id` > `data-item-id` > `data-sku`. The `data-auto-id`
co-occurrence entries keep their richer attribute capture and run FIRST (selector order),
so prior output for that convention is byte-identical.

### Acceptance criteria
- [x] `data-sku`-only element → entity item with `entityId` set + `[data-sku="X"]` presence derived (unit: page-content-alt-testid G2 block; derivation: assertion-derivation-alt-testid G2 block)
- [x] `data-item-id`-only element → same for `[data-item-id="X"]`
- [x] multi-attribute element → exactly ONE entity item, identity = highest-precedence attribute, exactly ONE entity assertion
- [x] `[data-auto-id][data-sku]` co-occurrence → identical richer capture + identical `[data-sku="F1"]` locator as before (AdaniOne-clone Gate 1 byte-compat)
- [x] `data-asin` (Amazon) path unchanged
- [x] no vacuous ancestor-#id entity assertions (2c policy preserved)
- [x] null-identity "legacy twin" no longer exists at capture (seenPaths first-match-wins); derivation-side dedupeEntities retained as defense-in-depth
- [x] AdaniOne clone gate stays 30/30; a-slice gate stays 35/35 (no regressions)

### Deliberately NOT changed
- The anti-noise allowlist stance: other conventions (data-qa, data-cy, data-pid, itemid) remain uncovered until a config entry is added per convention.
- Assertions stay presence-only; entities with no machine-readable identity are never asserted (no fabricated locators).

## P2 / G1 — JS dialog capture port

### Root cause
Commit b4222a6 (M7 wiring) replaced the manifest content script with phase5/recorder-entry.ts
but never ported the page-world interception block (alert/confirm/prompt/window.open) from
`deterministic-recorder.ts`. At HEAD the installer had zero importers, `RECORDED_EVENT` is
unhandled in the SW, and the Component-Runtime DomContext never had dialog fields — dead at
both ends.

### Fix (additive port, same design as network-inject.js)
1. `public/assets/dialog-inject.js` — NEW manifest MAIN-world content script
   (all_frames, document_start, `<all_urls>`): wraps window.alert/confirm/prompt/open,
   stamps JSON on `<html data-cmdrunner-dialog>` / `data-cmdrunner-window-open`.
   Gated on the shared `data-cmdrunner-net-active` recording attribute (same gate as
   network-inject.js). alert stamps BEFORE the native blocking call, so the stamp is
   present even though the handler does not return until dismissal. CSP failure → silent
   degrade. Double-injection guard `window.__cmdrunnerDialogPatched`.
2. `src/manifest.json` — second MAIN-world content_scripts entry.
3. `src/tap/page-world-signals.ts` — NEW destructive reader (parse + clear), ported from
   legacy readPageWorldSignals(); malformed JSON degrades silently.
4. `src/tap/evidence-collector.ts` — reads at window OPEN (owns synchronous in-handler
   dialogs) and at BOTH delivery paths (closeWindow regular + buildAndDeliverEvidence
   settle branch, plus finalizeWithoutWindow drain). Destructive read ⇒ a signal is never
   attributed to two windows (same ownership discipline as INV-CS1).
5. `src/shared/behavioral-evidence-types.ts` — `ApplicationEvidence.triggeredDialog?`
   (DialogSignal: type/message/result) + `openedWindow?` (WindowOpenSignal: url/target/
   isWindow). Optional fields — dialog-free wire shape byte-identical.
6. `src/sidepanel/evidence-renderer.ts` — evidence card "🔔 JS Dialog" after Resulting
   State; absent → nothing rendered.

### Scope decision (from RCA)
Evidence capture ONLY. Dialog-derived IR assertions are deferred (G1 was classified
"capture the evidence now; derivation later"). DOM modals were already captured by the
DOMObserver — this fix covers ONLY the JS dialog APIs.

### Acceptance criteria
- [x] alert/confirm/prompt stamps parse + clear (unit: dialog-signals.test.ts)
- [x] confirm carries OK/Cancel result; prompt carries text or Cancelled
- [x] window.open carries url/target/isWindow
- [x] open-time drain: synchronous in-handler dialog lands on that window's evidence
- [x] close-time re-read: dialog fired later (setTimeout) still lands on the same window
- [x] dialog-free evidence carries NO triggeredDialog/openedWindow keys
- [x] second dialog in a window replaces the first (last-write-wins)
- [x] no double-attribution across windows (destructive read)
- [x] real-Chrome: R3 alert() and confirm() buttons produce triggeredDialog on the
      recorded interactions (R3 matrix)
- [x] gates unchanged (AdaniOne 30/30, a-slice 35/35)

### Known limitations (documented, accepted)
- Async dialogs appearing only after a fetch round-trip can exceed the evidence window
  (~same family as the late-DOM-dialog RCA).
- Strict-CSP sites that block the installer degrade silently (no dialog evidence).
- window.open popup-tab recording-scope binding: the signal is attributed to the
  triggering window; popup tab's OWN page is a separate recording target (flagged as a
  validation item, not a claim).

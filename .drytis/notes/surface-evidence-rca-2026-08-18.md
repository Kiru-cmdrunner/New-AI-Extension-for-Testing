# RCA — Manual validation evidence-quality issues (settle ZIP 5982534)

Date: 2026-08-18. Read-only investigation. Shipped ZIP `download/cmdrunner-extension-5982534-settle.zip`
loaded unpacked in real Chrome 148 via CDP harness `.drytis/notes/evidence/surface-rca-harness.mjs`
(log: `surface-rca-run.log`, replica on :8099). 7/10 checks PASS — the 3 failures are the defect repro.

## Observation A — iPhone ATC: Surface Changes absent (Category 1: NEVER DETECTED)

Evidence chain (all verified):
- Side Panel `renderSurfaces` (src/sidepanel/evidence-renderer.ts:376-405) renders "New Surfaces (N)"
  whenever the array is non-empty → empty section means empty array at delivery. Storage key
  `cmdrunner_live_interactions` passes surfaces through (background/evidence-attribution.ts, runtime/sw-integration.ts).
- Caps cannot zero surfaces: `newSurfaces`/`removedSurfaces` are separate arrays, `slice(0,50)` (evidence-collector.ts:698-699);
  DOM 200-cap / 4709-overflow applies only to `domChanges`. High-churn (`coarseMode`) is a flag, not a filter.
- Settle/finalize preserves surfaces: real-Chrome S4 (direct role=dialog insert) on the shipped ZIP →
  `newSurfaces:[{tag:div, role:dialog, name:"Added to cart"}]` delivered through settle → storage → panel-read intact.
- Detector = `detectSurfaceChanges` (dom-observer.ts:648-693) accepts ONLY the DIRECTLY added/removed node when
  `isSignificantSurface` (dom-observer.ts:699-707) matches its OWN role ∈ SURFACE_ROLES (945-950:
  dialog, alertdialog, menu, menubar, tooltip, tabpanel, tablist, listbox, tree, treegrid, navigation,
  complementary, banner, contentinfo, alert, status, log) or tag ∈ SURFACE_TAGS (953-955: dialog, details, summary).
  No descendant scan. No pre-existing-element reveal path (a reveal produces NO childList record at all).

Amazon's real ATC shapes (confirmed by manual screenshot visibility rows `display: → block` on
`#attach-cart-*`, `#attachSid*` + focus movement into the pre-rendered popover DIV):
1. popover pre-rendered, hidden by class/CSS, revealed by inline style/class change → no childList → no surface (S1/S2 repro: visibility captured, newSurfaces [])
2. dialog inserted nested inside plain wrapper div(s) → role on descendant, wrapper is the added node → missed (S3 repro: newSurfaces [], visChanges [])
3. direct role=dialog insert → captured (S4 control: PASS) — matches why the earlier synthetic harness "passed"

→ Root cause option (1): the surface was never detected. Not churn/caps (2), not settle loss (3),
not SW/storage (4), not rendering (5).

## Observation B — Vivo ATC: small Click evidence, `page-reload` 765ms — EXPECTED, no loss

- Vivo ATC performs a real form-submit navigation. `onPageHide` (evidence-collector.ts:1791-1837) →
  `finalizeAtPagehide` (evidence-collector.ts:122-138, INV-4 rule) finalizes ALL action windows with
  endReason 'page-reload' at pagehide (765ms = unload arrival). Zero settle delay on the unload path
  (unchanged by settle commit — the 5982534 diff on this path is comment-only, count 1).
- Rule landed in a1cc802 ("Form-submit evidence recovery: durable attribution ledger") — present in
  baseline 15df67d (3 refs), i.e. NOT introduced by consequence-settling.
- Destination-page consequences belong to the separate Navigation interaction (301ms · stabilized;
  carries form_submit nav evidence + destination BODY state change + image GETs). Click vs Navigation
  partition is the product requirement; the evidence split is correct: Click = source-page pre-unload
  evidence (2 DOM + 23 net = everything observable before unload), Navigation = destination evidence.
- Anything after pagehide is unobservable in-page by ANY observer (document torn down; pending
  MutationObserver callbacks are not delivered). No defect; do not merge windows to "enrich" Click.

## Smallest generic fixes (NOT implemented — design decisions)

A. Wrapper/descendant gap (S3): in `detectSurfaceChanges`, when an added node isn't itself significant,
   run ONE bounded `el.querySelector(SURFACE_SELECTOR)` (selector built from SURFACE_ROLES/SURFACE_TAGS)
   and record the descendant as the surface; dedup by path. Cheap, no deep walk.
B. Pre-rendered reveal gap (S1/S2, Amazon real shape): surface-on-reveal — when a visibility REVEAL
   (display/visibility/opacity/aria-hidden) hits an element whose role ∈ SURFACE_ROLES (or tag ∈
   SURFACE_TAGS), emit a surface 'added' record. CAVEAT: Amazon's attach popover role is `region`,
   which is NOT in SURFACE_ROLES — catching it requires either adding 'region' (noisy) or a
   name/subtree-size heuristic (more heuristic). Needs product decision.
No timing changes anywhere — both are event-driven.

## Regression risks if fixed
- Descendant scan cost on large inserted subtrees (bound: single querySelector per added node).
- Duplicate surface records when wrapper AND descendant both match (need path dedup).
- Reveal-based surfaces can double-count across repeated toggles (dedup by path+kind or first-reveal-wins).
- Downstream consumers (causal-graph, notification-signals, understanding pipeline) currently assume
  surfaces == insertions; 'became visible' semantics may alter their signals.
- Panel "New Surfaces" count inflation on churny pages (cap 50 still applies).

## Tests required (when approved)
- Unit: dom-observer descendant-scan (wrapper shapes), reveal-shape surfaces, dedup, caps.
- Integration: collector drain preserves surfaces under coarseMode; settle-mode windows deliver surfaces.
- Real-Chrome: re-run surface-rca-harness S1-S4 (expect 10/10 after fix), Amazon-style delayed popover,
  Vivo-style navigation case asserting Click('page-reload')/Navigation('stabilized') partition unchanged.

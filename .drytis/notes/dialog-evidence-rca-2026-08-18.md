# RCA: Amazon "Added to cart" dialog evidence missing — Category A (never captured)

**Read-only investigation. No source files modified.** Harness:
`.drytis/notes/evidence/dialog-evidence-rca-harness.mjs` (+ build of uncommitted fix in dist).

## Verdict
Handover question A/B/C/D → **A: never captured.** The dialog's DOM mutations occur
AFTER the evidence pipeline has stopped observing the DOM.

## Mechanism (primary)
1. Click on `#add-to-cart-button` → click window opens, DOMObserver refcount 1.
2. Semantic lifecycle completes (~5–10ms) → SW sends FINALIZE_EVIDENCE
   (sw-integration.ts:602 sendFinalizeEvidence on interaction emit).
3. Collector matches window, waits 150ms settle (evidence-collector.ts:1279),
   then `executeFinalization` → `buildAndDeliverEvidence` drains
   getAccumulatedSummaries()/getSurfaceChanges()/getVisibilityChanges()
   (evidence-collector.ts:1434–1436). Window: lifecycle-complete @ ~155–196ms.
4. `cleanupWindow` → refcount 0 → **DOMObserver.disconnect()**
   (evidence-collector.ts:1672–1675, dom-observer.ts:348–359).
5. Amazon's dialog appears +400–900ms → **nobody is observing** → mutations never
   enter any accumulation → cannot appear in domChanges/newSurfaces/visibilityChanges.
6. G3 late re-collect at +1000ms (scheduleLateNetworkReCollect,
   evidence-collector.ts:1339–1383) re-collects **network only** — that's why the
   panel shows Network rows merged (visible in manual test) but no surfaces.

Real-Chrome proof (scenarios A/B/C):
- A (dialog @ +500ms, Amazon shape): newSurfaces=[], visibilityChanges=[] everywhere.
- B (control, dialog @ +100ms INSIDE window): newSurfaces=[div role=dialog
  "Added to cart"], visibilityChanges=[#attach-popover aria-hidden true→false],
  stored + intact end-to-end. **Pipeline (collector→sw-integration→storage→panel
  projection) is lossless for what IS captured.**
- C (roleless div dialog @ +100ms): newSurfaces=[] — `isSignificantSurface`
  (dom-observer.ts:699–707) checks ONLY the directly-added node's role/tag;
  no descendant scan. Secondary capture gap for class-styled overlays.

## Uncommitted shape-guard fix status
Working as designed (13/13 vitest; real Chrome: target preserved, window not
replaced, burst rows merged; tsc clean) — but it only fixes REPLACE-loss, it
cannot recover evidence that was never captured. Necessary, NOT sufficient.

## Lossless-downstream audit (researcher map)
- Storage: chrome.storage.local live key + Dexie BehavioralEvidenceRow spread —
  all four application arrays stored verbatim.
- Panel: reads live key directly, renders all sections; caps are display-only
  (dom 10, surfaces 5, vis 10, network 10) with "… N more".
- D2/D3 harvest/healing never touch behavioralEvidence.
- Only remaining downstream loss: richness-replace (sw-integration.ts:431) drops
  loser's non-network app evidence — fenced by uncommitted shape guard for the
  targetless-supplement case.

## Fix direction (NOT implemented — awaiting approval)
G3-style late-application re-collect: keep DOMObserver alive for a bounded tail
(~1s, mirroring G3) after lifecycle finalize; deliver a targetless
dom/surface/visibility-only supplement; merge application arrays additively in
sw-integration (today's supplement merge only merges networkActivity). The
uncommitted shape guard already prevents such a supplement from replacing real
evidence. Secondary: descendant scan in isSignificantSurface for added nodes.

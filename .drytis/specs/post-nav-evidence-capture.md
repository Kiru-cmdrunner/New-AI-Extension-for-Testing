# Post-Commit Full-Page Navigation Evidence Capture (NAV Pull Model)

## Problem

Full-page reloads (form submits, link clicks, address-bar navigations) destroy
the DOM-observing content script before evidence delivery, and the freshly
injected content script on the destination page never opens an evidence window —
no user event occurs there. The synthetic navigation interaction therefore keeps
its commit-time placeholder (empty domChanges/newSurfaces/removedSurfaces/
visibilityChanges, zeroed performanceCondition) even though the destination page
renders substantial DOM churn (search results grid, cart drawer, etc.).

The SPA navigation path (event-tap `emitSpaNavigation` → `handleNavigationEvent`)
already models the correct capture: a navigation-owned window in the destination
context. Full reloads simply never reach it.

## Root cause

No orchestration message exists between the SW's commit-time knowledge
(`webNavigation.onCommitted` → navEventId + synthetic nav interaction) and the
destination page's content-script capability (auto-resumes at document_start,
`recorder-entry.ts` auto-resume). The correlation key (`navEventId`) exists
end-to-end: the nav interaction's `triggerEvent.eventId` IS the navEventId, and
`attachEvidenceToInteraction` matches Tier-1 on it.

## Design — NAV pull model

```
[SW onCommitted fullReload]  navEventId N + synthetic nav int created
                             → placeholder attached (unchanged)
                             → NEW: pendingNavCapture[tabId] = {navEventId N,
                                fromUrl, toUrl, navType, committedAt}
                                (bounded MAX_NAV_CAPTURE_ENTRIES, shift-evict)
[new page CS auto-resume]    → NEW: send NAV_PENDING_REQUEST (pull, race-free)
                             → SW replies NAV_PENDING_RESPONSE {payload | null}
                             → CS calls evidenceCollector.openPostNavWindow(payload)
[collector]                  openPostNavWindow: waits for document.body (start
                             can only observe body), opens a navigation window
                             with the SW-provided metadata, settle-capped
                             (POST_NAV_MAX_DURATION_MS hard cap via existing
                             AdaptiveWindow maxDuration), delivers via the
                             existing BEHAVIORAL_EVIDENCE pipeline with
                             sourceEventId = navEventId and the rebuilt
                             navigation entry.
[SW attach]                  handleBehavioralEvidence → attachEvidenceToInteraction
                             (Tier-1 on triggerEvent.eventId) → richness-based
                             replacement — rich destination evidence replaces
                             the placeholder; placeholder network rows preserved
                             via mergeNetworkActivity (requestId-first dedup).
```

**Ownership rule:** destination DOM/surface/visibility evidence belongs to the
**Navigation interaction** (int-6/int-15 class), never to the preceding
Search/Go/Click interaction. Causal network evidence continues to route to the
owning click via the durable ledger (INV-5) — unchanged.

**Fallback:** if the destination CS never pulls (chrome://, extension reload, no
CS injected), the pending record simply expires (POST_NAV_CAPTURE_TTL_MS or
next commit for that tab). The placeholder remains — today's honest degradation.

**SPA invariants:** `emitSpaNavigation` never fires for full reloads; SPA nav
events continue to open windows via `handleNavigationEvent` exactly as before.
No NAV pull record is created for SPA navigations (no onCommitted full-reload
branch taken — SPA navigations don't commit new documents).

**Exactly-once:** one pending record per tab, consumed per document. The
collector guards against duplicate opens for the same navEventId
(`postNavOpenedFor` per-document guard). If evidence arrives late (after the
session stopped), the existing pendingEvidence path drops it — placeholder
already delivered the essentials.

## Invariants preserved

- SPA navigation path unchanged (no NAV pull records for SPA navigations).
- Add-to-cart attribution: int-14's window finalizes at pagehide as today; the
  INV-5 stamped-POST routing to the causal click is untouched; destination
  (cart-page) DOM lands on the cart nav interaction, not on int-14.
- M9 status enrichment operates on network rows at STOP drain — untouched.
- ASIN/entity hints read network requestBody — untouched.
- G4/G5, M1–M8 untouched.
- ENTITY_HINT_PATTERNS untouched.
- Placeholder preserved as fallback for every path where the CS cannot capture
  (chrome://, fast next navigation, extension reload, STOP before delivery).

## Files

- `src/background/service-worker.ts` — pendingNavCapture map + record write in
  the existing fullReloadTypes branch + NAV_PENDING_REQUEST router case.
- `src/recorder/phase5/recorder-entry.ts` — after auto-resume startRecording(),
  pull + openPostNavWindow call (guarded per document).
- `src/tap/evidence-collector.ts` — new
  `openPostNavWindow` public method (+ body-ready wait + per-navEventId guard).
- `src/shared/types.ts` — AppMessage union additions: NAV_PENDING_REQUEST /
  NAV_PENDING_RESPONSE + isAppMessage type-guard list.
- Tests: tests/tap/post-nav-window.test.ts, tests/unit/background/
  nav-pending-capture.test.ts, tests/integration/post-nav-attribution.test.ts.

## Acceptance criteria

- [ ] AC1: openPostNavWindow waits for body-ready and opens a navigation window
      attributed to navEventId; delivered evidence carries
      sourceEventId === navEventId, the rebuilt navigation entry
      (fromUrl/toUrl/navType from the SW record), and drained DOM/surfaces/
      visibility from the observer.
- [ ] AC2: settle window bounded — window closes by POST_NAV_MAX_DURATION_MS
      hard cap even under continuous mutation churn (holdOpen-free), and early
      on pagehide of the destination document (next reload) via onPageHide.
- [ ] AC3: second openPostNavWindow for the same navEventId in the same
      document is a no-op (exactly-once per document).
- [ ] AC4: NAV_PENDING_REQUEST handler returns the pending record for the
      sender's tab only; marks it consumed (a second pull in the same document
      gets null); record is replaced on the next full-reload commit for that
      tab (latest-wins) and evicted when the map exceeds
      MAX_NAV_CAPTURE_ENTRIES.
- [ ] AC5: Rich destination evidence replaces the placeholder via the existing
      richness-replacement path; placeholder networkActivity rows are preserved
      (requestId-first dedup, G5-E); navigation entries are not duplicated
      (delivered evidence carries the SW-provided entry; union fallback in the
      replace path keeps the placeholder entry if CS echo is missing).
- [ ] AC6: SPA navigations never create NAV pull records and never call
      openPostNavWindow; handleNavigationEvent path unchanged.
- [ ] AC7: Late delivery after session stop does not attach anywhere —
      pendingEvidence retains it; placeholder remains on the nav interaction.
- [ ] AC8: Add-to-cart/INV-5 regression — stamped form-submit POST still routes
      to the causal click interaction; the nav interaction's networkActivity
      never receives stamped rows; cart-page DOM evidence attaches to the cart
      nav interaction only.
- [ ] AC8b: postNav evidence delivered while recording is inactive
      (STOP already processed) is not attached; a recording-active recheck
      guards the pull in the CS (no pull when RECORDING_KEY is false).
- [ ] AC9: Full existing test suite green; tsc --noEmit 0 errors; clean build
      with SW inline invariants (0 dynamic imports, 0 preload helpers, size
      within historical envelope); ZIP CRC verified.

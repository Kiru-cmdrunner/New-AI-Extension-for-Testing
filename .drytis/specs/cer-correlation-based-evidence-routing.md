# Milestone: Correlation-Based Evidence Routing (CER)

**Base:** ac7ebbb (DDC-1..8). Supersedes the timing-tuning path (200ms/10s/±50ms NOT tuned).

**Problem:** Timing-audit Bucket 3 items. The Amazon main-frame form POST cannot
be recovered by the current design regardless of timing values: ring writes happen
at onCompleted (after onCommitted+200ms), the ring entry URL is post-redirect
(corrupting classification), and the window↔network join is a ±50ms timestamp
window. All replaced with ID/lifecycle correlation.

## Design

### CER-1 — SW network observation: tag at start, ring at completion, snapshot at commit
`src/background/network-observation.ts`:
- onBeforeRequest: extend InFlightWebRequest with `frameId`, `resourceKind`
  ('main_frame'|'sub_frame'|'xhr'|'other'), `originalUrl` (details.url — the
  URL at request time), `navEventId?`, `sourceEventId?`.
- When `type === 'main_frame'`: immediately register a **pending main-frame
  request** for the tab: `pendingMainFrame[tabId] = {requestId, originalUrl,
  method, requestBody, sourceEventId}` — captured BEFORE redirect can change
  anything and BEFORE completion timing.
- **Last trusted action registry:** `lastTrustedAction[tabId] = {eventId,
  interactionId, wallClock}` set from service-worker (CER-2). onBeforeRequest
  stamps every new inFlight request with the current `sourceEventId` for the
  tab (ordering: SW received the click event before the network request began).
- onCompleted/onErrorOccurred: push ring entry with `originalUrl` (NOT the
  final URL), original method/body, `status`, plus `navEventId`/`sourceEventId`
  tags and `documentRequest: true` when requestId matches
  `pendingMainFrame[tabId].requestId`.
- New export: `getMainFrameCorrelation(tabId)` returns
  `{requestId, originalUrl, method, requestBody, sourceEventId}` or null.
  New export: `snapshotInFlightForTab(tabId)` returns in-flight entries for the
  tab at commit time ("requests issued from the destroyed document").
- New export: `getNetworkEvidenceForNavigation(navEventId)` — exact-ID lookup
  of ring entries + in-flight entries tagged with that navEventId. No time math.
- **onBeforeRedirect listener added**: records redirect chain
  `requestId → [originalUrl, hop1, hop2…]` keyed map; ring entry carries the
  chain. Chain preserved so classification runs on the ORIGINAL URL; final URL
  kept too.
- onCommitted coordination (from service-worker CER-2) tags in-flight entries
  with navEventId.

### CER-2 — Service worker: link click → main-frame POST → navigation by ID
`src/background/service-worker.ts`:
- `lastTrustedAction` per tab updated on every trusted OBSERVED_EVENT routed
  through processObservedEvent (click/keydown trusted). Lightweight: Map
  tabId→{eventId, interactionId, wallClock}.
- `webNavigation.onCommitted` handler: before creating synthetic evidence,
  call `getMainFrameCorrelation(tabId)`; if a pending main-frame POST exists
  with requestBody (form-submit), create the synthetic nav and tag its
  behavioral evidence with `correlationId: requestId` on every recovered
  NetworkActivity entry; attach evidence immediately (no 200ms setTimeout).
  The navigation interaction itself is emitted by the existing runtime path
  (navEvent eventId = sourceEventId).
- `attachSyntheticNavEvidence` signature gains `correlation` param; recovery
  now prefers exact-ID: ring entries whose navEventId matches OR in-flight
  snapshot tagged at commit; time-range fallback kept ONLY as a last resort
  for pre-CER sessions (no behavior change for old data).
- `recoverNetworkForNavigation` → `recoverNetworkForNavigationById(navEventId,
  details)`; the `req.url === navUrl` exclusion is REPLACED by
  `documentRequest` flag logic: skip document request UNLESS it has
  requestBody (form POST-is-navigation case) — keep the POST, skip plain GETs
  of the document.
- Analytics filter extended: `fls-` and `/1/batch/` and `uedata` added to SW
  recovery filter (aligning with classifyUrl's existing analytics list).

### CER-3 — Bridge: requestId join + dedup by ID
`src/tap/network-bridge.ts`:
- `TimestampedNetworkActivity` gains `requestId?: string`. webRequest start/complete
  events already carry requestId → thread through buffer entries.
- Window join: `collectForRange` gains optional `windowRequestIds?: Set<string>`
  param. When provided, entries are included if `entry.requestId ∈ windowRequestIds`
  OR (no requestId and time in range) — ID join primary, time secondary for
  main-world entries lacking IDs. Documented as fallback only.
- Dedup: webrequest duplicate detection uses requestId equality against
  main-world twin when available; falls back to url+method+time. PO-vs-fetch
  dedup unchanged (URL-only, method-ignorant).
- EvidenceCollector integration point: when a window opens, record the set of
  requestIds seen so far in the bridge buffer (`getBufferRequestIds()`); at
  close, `collectForRange` receives the window's requestIds (those that
  STARTED during the window) — start-membership join. (Implementation detail:
  evidence-collector calls collectForRange at finalize; we snapshot
  requestIds at window open via new `snapshotRequestIds()` API.)

### CER-4 — Pipeline: sourceEventId exact join replaces 10s window
`src/understanding/pipeline/understanding-pipeline.ts`:
- NetworkActivity type gains `sourceEventId?: string` (from ring entry tag).
  Correlates recovered NetworkActivity → the click interaction whose
  behavioralEvidence.sourceEventId matches — exact join, no time window.
  Falls back to current adjacency+10s only when tags absent.
- `attributeReloadOutcomes` break-bug fixed: continue scanning backward past
  candidates that fail the window check instead of breaking on first.

### CER-5 — D11 numeric interaction ordering
`src/understanding/state-builder/state-builder.ts`:
- Lexical compare on "int-9" vs "int-10" fixed via numeric suffix parse.
  Used in most-recently-updated heuristics (2 sites).

### CER-6 — Unknown-classified ops stop voting
`src/understanding/outcome/outcome-determiner.ts`:
- api operations classified 'unknown' (confidence 0.2) no longer produce
  outcome votes (they classify, they don't testify). Known ops keep voting.
  This prevents beacons/unclassified traffic from fabricating success for
  clicks via attribution.

## Files touched
network-observation.ts, service-worker.ts, network-bridge.ts,
evidence-collector.ts (snapshotRequestIds call), behavioral-evidence-types.ts
(NetworkActivity.sourceEventId + correlationId), understanding-pipeline.ts,
state-builder.ts, outcome-determiner.ts, network-signals.ts (sourceEventId
pass-through), tests.

## Tests
`tests/understanding/cer-correlation.test.ts`:
1. Form-submit flow (Amazon-style): click → main_frame POST (requestId R1,
   originalUrl /cart/add-to-cart, body {ASIN, quantity}) → 302 → onCommitted
   → synthetic nav carries POST via exact-ID recovery; classification runs on
   ORIGINAL URL (operation add-to-cart); outcome success attributed to click.
2. Same flow, onCompleted arrives AFTER commit+attach (late completion): ring
   entry still lands with navEventId tag; pipeline picks it up (no TTL race).
3. Plain link navigation (no form POST): document GET is NOT recovered as API
   op (documentRequest exclusion), no false attribution.
4. SPA: fetch in window W1 (requestId r-f1 from webrequest); window W2 opened
   later; r-f1 not included in W2 via ID join; time-only fallback never pulls
   it in across windows.
5. requestId dedup: same request via webrequest + main-world patch → single
   ApiOperationSignal.
6. int-9 < int-10 ordering: entity most-recently-updated picks int-10.
7. Unknown ops (fls-eu /1/batch/) produce NO outcome votes.
8. Redirect chain: POST → 302 → final URL differs; ring entry keeps
   originalUrl; classification on originalUrl matches /cart/add pattern.

## Acceptance criteria
- [ ] Amazon-style form-submit regression test green.
- [ ] SPA/API window correlation by requestId green.
- [ ] Full suite green, TSC 0, clean build, ZIP rebuilt.
- [ ] Timing constants removed: 200ms attach timer (replaced by event-driven
      attach + pendingEvidence drain), 10s recovery lookback (exact-ID),
      DDC-3 10s pipeline window (sourceEventId join; adjacency fallback kept
      but bounded by ID-first logic).
- [ ] No M1–M8 frozen files modified.
- [ ] Timing that remains is Bucket 2 only (perceptual/UX), plus TTL/caps as
      memory bounds (documented, not correctness).

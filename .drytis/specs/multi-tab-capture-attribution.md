# G4 — Multi-Tab Capture & Triple-Key Attribution (design; NOT implemented)

Status: DESIGN ONLY. Builds on `form-submit-evidence-recovery.md` (INV-1..12) and
`native-form-submit-attribution.md` (INV-N1..N7), all still binding.
Trigger: real Amazon run — int-20 (click) showed only the 🔵 main-world unagi
beacon, int-21 (synthetic nav) had no Network section. Root cause (verified in
code at 696f0d9): `onBeforeRequestCallback` returns early unless the request's
tab is in `observingTabIds` — a set holding exactly ONE id, the tab active at
`handleStartRecording` (service-worker.ts:317). Content-script recording
(`broadcastToTabs START_RECORDING`) reaches every tab; webRequest capture does
not. Any interaction in a tab other than the start-time tab produces
interactions with 🔵 evidence and zero 🟣 evidence — the POST never enters
`pendingMainFrameByTab`, the ring, or `cmdrunner_unattached_requests`.

## 1. Changes

### G4-A — Capture gate becomes recording-scoped (INV-G1)

`shouldProcessRequest(tabId)` (network-observation.ts:289) is redefined:

```
recordingActive === true            → capture (ANY tab)
recordingActive === false           → drop
boot-unknown (flag not yet seeded)  → capture conservatively, ring-only, no forward
```

- `recordingActive` is an in-memory mirror of `StorageKeys.RECORDING_ACTIVE`
  (`cmdrunner_recording_active`, set by `initRecording()`/`stopRecording()` in
  sw-integration.ts:566/638).
  - Set `true` synchronously at the top of `startNetworkObservation()`
    (before injection), set `false` synchronously in `stopNetworkObservation()`.
  - Seeded from storage at module boot alongside the observing set.
- `observingTabIds` is DEMOTED to a forwarding/injection hint (INV-G4):
  - `shouldForwardToTab(tabId)` unchanged (bridge membership).
  - Membership grows deterministically: a tab enters the set when the SW
    receives any recording-scope message from it (OBSERVED_EVENT /
    BEHAVIORAL_EVIDENCE) or when it is the start tab. No probing, no timers.
- **Mandatory consequence** (implementation note): `inFlightRequests` now holds
  entries from multiple tabs. Every consumer that previously relied on the
  single-tab gate MUST become tab-scoped:
  - `snapshotInFlightForTab(_tabId, …)` — currently ignores `_tabId`
    (network-observation.ts:564); must filter `entry.tabId === tabId`
    (add `tabId` to the in-flight record).
  - `getCompletedBySourceEventId` / drain join — add tab/frame filters
    (triple key, G4-B).
  - `pendingMainFrameByTab` is already per-tab. Ring caps unchanged
    (display-only volume bound).

### G4-B — Attribution key = `sourceEventId + tabId + frameId` (INV-G2)

**Stamp side** (service-worker.ts:1337 dispatcher):
- `lastTrustedActionByTab: Map<number, …>` → `lastTrustedActionByFrame:
  Map<string, …>` keyed `` `${tabId}:${frameId}` ``.
- `frameId` comes from `sender.frameId` (chrome.runtime.MessageSender —
  available for content-script messages; no payload change needed at capture).
- `setLastTrustedAction(tabId, frameId, action)` — synchronous in-memory write
  first (unchanged G1-A guarantee), persisted copy now the per-frame map.
- Persisted shape under `LAST_ACTION_KEY` becomes
  `{ [`${tabId}:${frameId}`]: { tabId, frameId, action, wallClock } }`;
  restore accepts the legacy single-record shape (R22).
- **Lookup at `onBeforeRequest`**: exact key
  `` `${details.tabId}:${details.frameId}` ``. No cross-frame fallback for
  sub-frame requests — an unstamped sub-frame request stays unstamped (honest,
  INV-G10). A main_frame request (frameId 0) matches the top document's stamp —
  the Amazon case.

**Interaction side** (so the join is a triple, not a bare eventId):
- Dispatcher attaches `captureOrigin: { tabId, frameId }` to the ObservedEvent
  payload (additive optional field; `pageId`-unique eventIds remain primary).
- sw-integration copies it onto the emitted `ComponentInteraction.metadata`
  at `onEmit` (both the init and restore configs), and onto synthesized
  `BehavioralEvidence` (frameId mapping: `0 ↔ 'main'`).
- Ledger + drain joins compare `(sourceEventId, tabId, frameId)`; eventId
  remains primary, tab/frame disambiguate (defense against pageId collisions).

**G1-C back-fill resolution rule** (deterministic, no clocks):
At `onCommitted` with `transitionType === 'form_submit'` and an unstamped
pendingDoc, resolve from the tab's stamp map:
1. frame 0's stamp if present;
2. else if the tab has exactly one stamp, that stamp;
3. else leave unstamped (entry renders on the synthetic nav — INV-G10).
The iframe-click → top-level-submit case hits rule 3 by design (R17).

### G4-C — Stamp eligibility (INV-G3) — AMENDED by G5

> **G5 amendment (native-form-submit-ownership.md):** `submit` is no
> longer an overwriting stamp. A trusted `submit` DOM event is a
> *consequence* of the initiating action (click on submit button, Enter
> keydown), never a new trusted action. It stamps **create-only**
> (`setLastTrustedActionIfAbsent`) — it may create a stamp only when the
> exact `(tabId, frameId)` has none, and can never overwrite a click's
> stamp. See INV-F1/F2 and regression R24–R26.

Dispatcher stamps only interaction-creating types:

```
STAMP_ELIGIBLE = click | contextmenu | change | keydown(key==='Enter') | submit | drop
```

- Matches `ACTION_WINDOW_EVENT_TYPES` (evidence-collector.ts:98) + `drop`
  (M9.10 drag&drop emits interactions).
- EXCLUDED (today they overwrite the click stamp — latent defect 2):
  `mousemove`, `mouseenter`, `mouseleave`, `focus`, `blur`, `input`,
  `scroll`, `mousedown`, `dragstart`, non-Enter `keydown`.
- Effect: a pointer twitch / focus change between the click and a JS-delayed
  `form.submit()` can no longer steal the stamp (R14).

### G4-D — G1-B boot-restore ordering (INV-G5) — latent defect 1

- Module boot builds `bootRestorePromise = Promise.all([seedObservingTabs,
  restoreLastTrustedAction, restorePendingNavDocs])`. Listeners still register
  top-level immediately (never miss events).
- `ensureSessionRestored()` awaits `bootRestorePromise` before doing anything
  else → every consumer path (onCommitted, messages, START/STOP) is ordered
  after restore.
- Writers during restore are safe: they write in-memory first; restore merge
  keeps in-memory state (`!pendingMainFrameByTab.has(tabId)` guard, and the
  same rule for the stamp map). No timers; ordering is an await graph.

### G4-E — Wholesale stop cleanup (INV-G6) — latent defect 3

`stopNetworkObservation()` (called AFTER the drains inside
`handleStopRecording` → `stopRecording()`):
- `recordingActive = false` (memory, synchronous) + persisted false.
- `observingTabIds.clear()` + persist empty set (no per-tab residue — the old
  code deleted only the stop-time active tab and could persist stale ids).
- `pendingMainFrameByTab.clear()` + persist empty `PENDING_NAV_DOCS`.
- `lastTrustedActionByFrame.clear()` + persist empty.
- Session boundary semantics: a navigation still in flight at STOP is
  intentionally not recovered (entries never outlive their session — matches
  ledger `clearAll()` at START).

## 2. End-to-end flow (updated)

1. START → `initRecording()` persists RECORDING_ACTIVE →
   `startNetworkObservation(startTab)`: `recordingActive=true` sync,
   observing set = {startTab} (forwarding only), stamps/pendingDocs/ledger
   cleared.
2. Trusted eligible event in ANY tab/frame → dispatcher stamps
   `(tabId, frameId)` synchronously before any await; payload carries
   `captureOrigin`.
3. `onBeforeRequest` in ANY tab → gate = recordingActive → body parse →
   exact-frame stamp lookup → inFlight (now tab-tagged) → pendingDoc per tab
   (awaited durable) → stamped ledger write (awaited durable) → forward to
   bridge only if tab ∈ observing set.
4. `onCommitted` (any tab) → awaits bootRestorePromise (via
   ensureSessionRestored) → navEvent → consume pendingDoc → form_submit
   back-fill per the fixed 3-rule resolution → stamped entries routed to the
   causal click via ledger triple join; unstamped/unresolved render on the
   synthetic nav.
5. pagehide in any recording tab → finalize action windows → BEHAVIORAL_EVIDENCE
   → attach + ledger retry (existing T11–T16 machinery).
6. STOP → ring drain (triple join) → ledger drain (triple join) →
   LIVE_INTERACTIONS persist → ack → wholesale cleanup (G4-E).

## 3. Invariants (additive; all prior INV/INV-N still binding)

- **INV-G1 capture symmetry**: while recording, every http(s) request in every
  tab passes the capture gate. Tab identity never gates capture.
- **INV-G2 triple key**: a request is attributed iff its exact
  `(tabId, frameId)` holds an eligible stamp and the request started after the
  stamp (browser dispatch ordering, not clocks). Join key is
  `(sourceEventId, tabId, frameId)` everywhere.
- **INV-G3 stamp eligibility**: only STAMP_ELIGIBLE events stamp; no other
  event type can create or overwrite a stamp.
- **INV-G4 forwarding ≠ correctness**: `observingTabIds` influences only
  bridge forwarding / interceptor injection. Removing or clearing it can never
  change what is durably captured or attributed.
- **INV-G5 boot ordering**: all consumers of stamps/pendingDocs await
  `bootRestorePromise`; capture writers never block on it and in-memory state
  wins over restored state.
- **INV-G6 stop atomicity**: session drains complete before wholesale
  clearing; cleared state is persisted empty so no restart resurrects it.
- **INV-G7 no timing correctness**: attribution uses key equality and dispatch
  ordering only. The 30s stamp-restore TTL bounds garbage resurrection and can
  only degrade (unstamped → honest), never misattribute.
- **INV-G8 cross-domain**: the triple key is origin-independent; cross-origin
  main_frame navigation preserves `(tabId, 0)`, so a POST/GET submit to origin
  B attributes to the click on origin A in the same tab.
- **INV-G9 exactly-once preserved**: RequestOwnershipLedger semantics
  unchanged; the triple only disambiguates the join.
- **INV-G10 honest degradation**: unattributable requests are never guessed
  onto an interaction; they render on the synthetic nav or not at all.

## 4. Regression tests

Existing suites (incl. R1–R11, T1–T19b) must stay green unchanged.

- **R12 multi-tab capture (THE int-20/int-21 repro)**: start recording in tab
  A; click + form submit in tab B → `/cart/add-to-cart` captured, stamped, and
  attached to tab B's click interaction; 🟣 row present.
- **R13 forwarding split**: tab B ∉ observing set → no NETWORK_REQUEST
  forwarding to tab B's bridge, yet SW-side recovery still attaches (INV-G4).
- **R14 stamp steal**: click → mousemove/mouseenter/focus/blur/input → delayed
  `form.submit()` → POST still attributes to the click (old failure mode).
- **R15 Enter-only keydown**: Enter keydown stamps; other keys do not.
- **R16 frame scoping**: click in frame 3 + fetch from frame 3 → attributed;
  fetch from frame 0 with no frame-0 stamp → unstamped (no cross-frame bleed).
- **R17 ambiguity rule**: click in frame 3, top-level submit, no frame-0 stamp
  → deterministic outcome: unstamped → synthetic nav (rule 3, INV-G10).
- **R18 boot-restore ordering**: durable pendingDoc + stamp; restart; fire
  onCommitted immediately → consumer awaits restore, consumes the record.
- **R19 stamp restore TTL**: >30s persisted stamp not resurrected → request
  unstamped → degradation only (INV-G7).
- **R20 stop cleanup**: record across tabs A+B → STOP → observing set, stamps,
  pendingDocs all empty AND persisted empty; RECORDING_ACTIVE false; fresh
  START sees no residue.
- **R21 cross-domain**: click origin A → submit to origin B (same tab) → POST
  on the click; nav carries causedByInteractionId (INV-G8).
- **R22 legacy storage migration**: old single-record LAST_ACTION restores
  into the per-frame map without throwing.
- **R23 gate matrix**: recordingActive true / false / boot-unknown → capture,
  drop, ring-only-no-forward respectively.

## 5. Why this stays deterministic

- Every join is equality on browser-assigned identifiers (eventId, requestId,
  tabId, frameId). No lookback windows, no clock comparisons, no "most recent
  wins" except the fixed 3-rule back-fill, which is a static precedence order,
  not a time comparison.
- Ordering guarantees remain browser-dispatch properties: the tap sends
  OBSERVED_EVENT during the click's dispatch (before the default action's
  request), and the dispatcher's stamp is a synchronous write in that dispatch.
  Boot ordering is an await graph (INV-G5), not elapsed time.
- Multi-tab capture only REMOVES a negative condition (tab mismatch); it
  cannot introduce nondeterminism. Added volume is bounded by structures that
  never carry correctness (ring TTL/caps, display filters); the durable ledger
  still only receives stamped (user-caused) requests.

## 6. Why cross-domain is preserved

`(tabId, frameId)` is origin-independent and stable across same-tab
navigations (main_frame stays frame 0). A form on origin A submitting to
origin B therefore keeps its triple and attributes to A's click. Sub-frame
cross-origin iframes keep distinct frameIds → exact-frame stamping prevents
cross-origin frame bleed (R16). The behavioral-replay origin limitation is
unchanged and out of scope.

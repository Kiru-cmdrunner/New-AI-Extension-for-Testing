# Spec: Durable Attribution — Deterministic Form-Submit Evidence Recovery

**Commit target:** HEAD `b61a96e` (feature branch off `capability-surgical-removal`)
**Audit basis:** end-to-end audit of the network-evidence path (this session); loss points 1–5.
**Priority case:** Amazon-style fast form-submit: click → `main_frame` POST → page unload → synthetic navigation.

---

## Problem

1. A click <500 ms before `pagehide` has its evidence window silently abandoned (`onPageHide` TD-4 rule), so the click interaction may end with **no behavioralEvidence at all** — while the SW ring holds requests stamped with that exact click's `sourceEventId` (CER-2).
2. The stop-time drain joins ring→interaction via `behavioralEvidence.sourceEventId`, which **requires evidence to already exist**; `if (!appEv) continue` drops the entry.
3. Ring TTL (10 s) / capacity (100) evict stamped entries before STOP can recover them.
4. MV3 SW termination loses the in-memory ring/ledger entirely — stamped, not-yet-attached requests are gone.
5. Commit-time recovery attaches the recovered main-frame POST to the **synthetic navigation** interaction, not to the click that caused it.

## Solution (identity-based, event-driven, no timing)

New module `src/background/evidence-attribution.ts`:

1. **`DurableAttributionLedger`** — write-through ledger in `chrome.storage.local` under a new `StorageKeys.UNATTACHED_REQUESTS` key. Stamped entries (pushed at capture in `network-observation.ts`) are durably persisted **inside the same listener dispatch** (awaited `storage.set`), before the handler is considered complete. `rehydrate()` rebuilds from storage on SW boot; `acknowledge(requestIds)` deletes entries after their `LIVE_INTERACTIONS` persistence lands. No TTL; eviction is state-based (attached-and-persisted) or session-end cleanup.
2. **`RequestOwnershipLedger`** — `Map<requestId, interactionId>`, the single exactly-once authority across all attach paths, rebuilt on boot from `LIVE_INTERACTIONS` networkActivity.
3. **`resolveInteractionForEventId`** + **`synthesizeMinimalEvidence`** — the two-tier identity join (triggerEvent.eventId → memberEvents[].eventId) plus thin-evidence synthesis when the click has no evidence.

Wiring changes (all identity-based):
- `network-observation.ts`: ledger write-through on stamped capture; ring unchanged.
- `service-worker.ts`: boot reconciliation step 0; commit-time routing (stamped entries with a resolvable owner attach to the click, synthetic nav gets `causedByInteractionId`); drain consults ledger ∪ ring, identity join, synthesize-on-missing, telemetry exemption for stamped main-frame POSTs.
- `evidence-collector.ts`: pagehide finalizes **all** open action windows (age check removed; content-based drop only for zero-signal non-action windows); window-open journal to sessionStorage (survives teardown mid-finalize).
- `network-drain.ts`: identity join via triggerEvent/memberEvents + behavioralEvidence.sourceEventId; synthesize-on-missing; stamped main-frame POST telemetry exemption.

## Invariants

- **INV-1 Deterministic attribution** — stamp join is exact-string eventId ↔ interaction identity (triggerEvent → memberEvents). No timestamps, windows, or ordering assumptions.
- **INV-2 Global exactly-once** — one requestId → at most one interaction, across live supplement, commit-time, boot reconcile, and stop drain, via the ownership ledger.
- **INV-3 Durable until acknowledged** — a stamped request survives SW termination from the listener invocation that captured it (awaited storage write) until acknowledged (deleted after persist). Eviction state-based only. Ring TTL/caps unchanged and never a correctness mechanism for stamped data.
- **INV-4 Click survives unload** — an action window open at pagehide always yields delivered-or-buffered evidence carrying `sourceEventId` + identity, regardless of age.
- **INV-5 Causal ownership** — a stamped main-frame POST attaches to the stamped action's interaction; the synthetic nav records `causedByInteractionId` and no network.
- **INV-6 No timeout scaling** — ring TTL, caps, window timers unchanged.
- **INV-7 Richness monotonicity** — SW-thin evidence never blocks later richer evidence; replacement preserves network (Fix Round 5 merge).
- **INV-8 Replay confluence** — commit-attach, flush replay, stop drain, and boot reconcile converge to the same final `LIVE_INTERACTIONS` in any subset/order.
- **LANDED-INV Durability gate** — the storage write for a stamped request is awaited inside the webRequest listener; on rejection, degrade to memory-only and log. The listener never throws.
- **LANDED-INV Durability load** — for either crash point (before/after LIVE_INTERACTIONS persist), boot reconciliation + ownership rebuild yield exactly one final state.
- **LANDED-INV Session scoping** — `UNATTACHED_REQUESTS` cleared on STOP and on new-session start; never outlives its session.
- **LANDED-INV Event-driven recovery** — triggers are SW boot, `BEHAVIORAL_EVIDENCE`, `onCommitted`, STOP. No timers/polling.
- **LANDED-INV Pre-capture durability** — stamped `main_frame` POST written at `onBeforeRequest` (pre-redirect URL, `status: null`), enriched at completion; restart mid-redirect keeps the authoritative record.

## Data flow (priority case)

```
click #add-to-cart-button
  └→ EventTap → OBSERVED_EVENT → SW: setLastTrustedAction(tab, {eventId: E_click})
  └→ component runtime emits click interaction (triggerEvent.eventId = E_click)
  └→ content script opens window ev-E_click + sessionStorage open-journal
main_frame POST (form submit)
  └→ onBeforeRequest: stamp sourceEventId=E_click → ring push + AWAITED durable write
pagehide (<500 ms)
  └→ all open action windows finalized (endReason 'page-reload') → BEHAVIORAL_EVIDENCE
     (best-effort) + sessionStorage flush buffer (survives teardown)
onCommitted (reload)
  └→ recoverNetworkForNavigationById → entries stamped E_click resolve to the CLICK
     interaction → POST attached (synthesize thin evidence if step 3 lost);
     synthetic nav gets causedByInteractionId, no network
next page boots (same origin)
  └→ flushBufferedEvidence replays evidence → richer-evidence replace preserves the POST
SW restart (any time)
  └→ boot reconciliation: rehydrate ledger ← storage, index ← LIVE_INTERACTIONS,
     attach resolvable, ack (delete) after persist, retry unresolved on next event
STOP
  └→ drain over ledger ∪ ring as backstop → re-persist LIVE_INTERACTIONS → panel
```

## Acceptance criteria (checkboxes)

- [ ] T1 fast-form-submit: interaction `{triggerEvent.eventId:E}`, `behavioralEvidence:null` + ledger entry `{requestId:R, sourceEventId:E, main_frame POST}` → attach succeeds with synthesized evidence, `networkActivity[0].requestId===R`, entry acked/deleted.
- [ ] T2 tier-2 join via memberEvents only.
- [ ] T3 exactly-once across ledger/ring/duplicate paths.
- [ ] T4 no-TTL: stamped entry at t+60 s (memory mode) still drains; unstamped t+11 s gone (ring TTL untouched).
- [ ] T5 telemetry exemption: stamped main-frame POST to `/unagi/...` attaches; unstamped `fls-...` filtered (unchanged).
- [ ] T6 commit-time routing: POST → click interaction; synthetic nav gets `causedByInteractionId`, no network; unresolved stamp → synthetic nav (unchanged fallback).
- [ ] T7 pagehide: 120 ms non-lifecycle action window → evidence emitted `endReason:'page-reload'` + sourceEventId; zero-signal scroll window dropped.
- [ ] T8 richness replacement: thin evidence with POST → later richer evidence → replaced, POST preserved once.
- [ ] T9 replay confluence: all subsets/orderings of {commit-attach, flush, drain, boot-reconcile} → identical final state.
- T11 SW-restart recovery: stored entry + interactions in LIVE_INTERACTIONS → rehydrate attaches, store emptied.
- T12 crash-point A (attached, not acked): rehydrate drops via ownership, no duplicate.
- T13 crash-point B (stored, not attached): rehydrate attaches; identical to no-crash.
- T14 pre-capture durability: stamped main_frame POST at onBeforeRequest, no onCompleted → store entry `status:null`, commit-time attach uses original URL.
- T15 session-end cleanup: STOP + new-session start clear the store.
- T16 empty-boot no-op.
- [ ] Existing suites green: `tests/background/*` (network-observation, race-fix-ordering, mv3-lifecycle-continuity, health-check-resync), `tests/understanding/cer-correlation.test.ts`, `race-fix-scenario1.test.ts`, evidence-quality fix5/fix6, `evidence-persistence`, full `vitest run`.
- [ ] Integration page `public/m9-form-submit-validation.html` + e2e test verifying click interaction shows Network section with the POST; synthetic nav shows none.
- [ ] `npm run build` (vite build + pack-zip) exits 0.
- TDD acceptance: all new tests written BEFORE implementation, red → green.

## Files

- NEW `src/background/evidence-attribution.ts` — DurableAttributionLedger, RequestOwnershipLedger, resolveInteractionForEventId, synthesizeMinimalEvidence, rehydrate.
- NEW `tests/unit/background/evidence-attribution.test.ts` — T1–T5, T11–T16.
- NEW `tests/understanding/form-submit-e2e.test.ts` — T6, T8, T9, drain/routing integration shapes.
- NEW `tests/understanding/form-submit-pagehide.test.ts` — T7 (jsdom EvidenceCollector pagehide).
- NEW `public/m9-form-submit-validation.html` + `tests/integration/form-submit-e2e.test.ts` — browser E2E.
- MOD `src/background/network-observation.ts` — ledger write-through hook.
- MOD `src/background/network-drain.ts` — identity join, synthesize-on-missing, telemetry exemption.
- MOD `src/background/service-worker.ts` — boot reconcile, commit-time routing, drain consultation.
- MOD `src/tap/evidence-collector.ts` — pagehide content rule, open-journal.
- MOD `src/shared/types.ts` — StorageKeys.UNATTACHED_REQUESTS.

## Out of scope

Side panel rendering (already faithful); unstamped ring entry recovery (unchanged); network-inject.js; cross-session persistence.

# Stop-time requestId status-enrichment

## Context

Real-Chrome probe (Amazon Add-to-cart, requestId 4353): the interaction's
`/cart/add-to-cart` row shows `status: null` permanently, even though the request
completed 2xx. Root cause (audited): the row is the **start-phase** webRequest
delivery (`phase:'start', status:null`); every later source of the real status is
either page-destroyed, ring-TTL-evicted (10s), or suppressed by a correct
duplicate guard that conflates "row exists" with "row complete":

1. `pushStamped` dedup no-op (`evidence-attribution.ts:289`) — `onCompleted`'s
   durable "enrichment" write (`network-observation.ts:1066`) silently does nothing.
2. Drain Guard A (`network-drain.ts:158`) — ring completion skipped when the
   requestId is already owned.
3. `mergeNetworkActivity` (G5-E, sw-integration.ts:322) — first-delivered row wins
   regardless of status richness (unchanged by design).

Consequence: `succeeded: null` (network-signals.ts:306) → CER-6 null-never-votes →
outcome `incomplete`, no API evidence.

## Fix (approved design — status-enrichment only)

Exactly-once ROW semantics preserved: no row is ever added/removed; only the
`status` field of an existing null-status row is upgraded, keyed by requestId.
G4/G5, M1–M8, capture/attribution, hint patterns: untouched.

### Part 1 — ledger honors its enrichment contract
`src/background/evidence-attribution.ts` → `DurableAttributionLedger.pushStamped`
- Duplicate branch: merge-in-place instead of `return`.
- Status rule (upgrade-only): `incoming.status > 0 && stored.status <= 0` → adopt.
  Stored real status NEVER overwritten (L2: {r1,200} then {r1,0} stays 200).
- Fill-absent only: requestBody / sourceEventId / captureOrigin / documentRequest /
  mainFrame — never clobber.
- In-place mutation (no splice/re-push) → FIFO order + ownership state unchanged.
- New read-only accessor `snapshotStamped(): StampedRequest[]`.

### Part 2 — ring lookup by requestId
`src/background/network-observation.ts` → new export
`getCompletedByRequestIds(ids: Set<string>): CompletedWebRequest[]` — pure filter.
Covers SW-restart edge (ring entry with requestId+status but lost eventId mapping).

### Part 3 — pure enrichment pass
`src/background/network-drain.ts` → new export
`enrichNetworkRowStatuses(interactions, { ledger?, ring? })` →
`{ updatedInteractions, enriched: [{interactionId, requestId, from, to}] }`
1. Collect (interaction,row) where `row.status === null && row.requestId`.
2. Status map from sources: real statuses only (`> 0`); **ledger wins over ring**.
3. In-place `row.status = status` upgrade ONLY. No add/remove/reorder; existing
   statuses never touched (E3a); rows without requestId never touched; fake
   `method:url:stamped` ids match nothing → no-op.

### Part 4 — wiring (stop sequence)
`src/background/service-worker.ts` — inserted between ledger drain attach
(:414–422) and `ledger.clearAll()` (:425):
```
nullIds → enrichNetworkRowStatuses(productionInteractions, {
  ledger: ledger.snapshotStamped(),
  ring: getCompletedByRequestIds(nullIds),
}) → console.info + StorageService.setRaw(LIVE_INTERACTIONS) when enriched
```
After pass 3 (ledger-attached rows are themselves enrichable; status 0 → null via
toNetworkActivity), before clearAll (ledger is a source), before M9 (:441+).

## Acceptance criteria

- [ ] AC1 (E1): null-status row with requestId + ledger real status → upgraded;
      count/order unchanged; audit `from null to 200`.
- [ ] AC2 (E2): already-owned null row + ring completion → upgraded in place,
      NO second row (exactly-once preserved).
- [ ] AC3 (E3a/b/c): no downgrade/overwrite of real statuses; ledger>ring
      precedence; status 0 never enriches.
- [ ] AC4 (E4a/b/c): page-destruction shape enriched via ledger; SW-restart
      shape via ring-by-requestId; synthetic-nav/no-requestId/fake-id untouched.
- [ ] AC5 (L1/L2/L3): ledger merge single-entry, FIFO preserved, upgrade-only,
      fill-absent never clobbers, persist() fires.
- [ ] AC6: tsc 0 errors; full suite green (3,145 + new).
- [ ] AC7: rebuilt ZIP: enrichment code present in SW bundle; 0 dynamic import(;
      0 preload helper; download URL byte-identical.

## Out of scope

ENTITY_HINT_PATTERNS (ASIN.1 miss), capture/attribution/stamping, G4/G5 code,
M9 stage logic, timing fields (endRelativeToEvent/durationMs stay null), fake-id
interpretation.

## Expected observable result (user's Amazon re-test)

Add-to-cart POST probe: `status: 200` (not null); M9 emits success API-voted
outcome with `apiOperations[].succeeded: true`; side panel row renders the number.

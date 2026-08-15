# Ledger completion-preservation (status-enrichment follow-up)

## Context

Real-Chrome probe (session 3): int-14 owns exactly one `/cart/add-to-cart`
POST row with `status: null`, `requestBody: undefined`; M9 saw no API vote →
`incomplete`, `apiEvidence: []`, entity `cart-item:int-14` (fallback id —
no body → no product-id hint).

Root cause (read-only trace, two independent ledger loss points):

1. **Ownership gate kills the completion push.** Timeline: onBeforeRequest
   writes `{6053, status 0}` durably; the content-script start row (status
   null, NO body — forwardToTab sends no requestBody) attaches to the click
   at window close → ownership marks 6053 attached; commit-time causal
   routing (`attachStampedActivity`) hits `attachToInteractions`, whose loop
   `continue`s on `ownership.isAttached` and then **pruneKey removes 6053
   from the in-memory entries map**; later `onCompleted(200)` calls
   `pushStamped({status:200})` → early `return` at the ownership gate
   (evidence-attribution.ts:286) — BEFORE the Part-1 dedup-merge branch.
   The completion is discarded.
2. **Snapshot reads the pruned map.** `snapshotStamped()` (enrichment
   source) reads the in-memory `entries`, not the durable store — after the
   prune, the completion record is invisible even if it had survived.

Ring source: TTL 10s — the session continued minutes past completion
(Proceed to Buy → sign-in), so the ring copy was evicted. The durable
ledger is the only long-lived completion record.

## Fix (approved 2026-08-15 15:01)

Invariant: **an attached stamped entry leaves the ledger (prune / pendingAck /
acknowledge / rehydrate-drop) only when the owning interaction's row for that
requestId already has a REAL status (> 0).** Status-only upgrade; no
attribution change; capture/G4/G5/M1–M8/M9 untouched.

### Fix 1 — pushStamped: completion pushes pass the ownership gate
`status > 0` pushes are ENRICHMENT, not attach attempts. When
`ownership.isAttached(requestId)`:
- look up the stored entry under the SAME sourceEventId;
- if present → mergeIntoStored (upgrade status if stored <= 0; fill-absent
  metadata; fire the durability write-through) — identical to the dedup
  branch;
- if NOT present (pruned or different key) → RE-INSERT as a held entry so
  the completion survives for the Stop-time enrichment snapshot. Re-inserted
  entries are marked `pendingComplete: true`:
  - excluded from `attachToInteractions` (already owned — no double attach);
  - NOT added to pendingAck by the attach loop (they must not be acked
    away); the Stop-time enrichment is their only consumer;
  - `clearAll()` still wipes them at session end.
- `status <= 0` pushes for attached requestIds keep the old early-return
  (nothing to enrich; no re-insert).

### Fix 2 — pruneKey: preserve un-completed entries
`pruneKey` keeps an entry whose requestId is attached BUT the owning
interaction's row for it still has `status == null/undefined`. New helper
`owningRowHasRealStatus(interactions?, requestId)`:
- with interactions supplied → scan `behavioralEvidence.applicationEvidence.
  networkActivity` for the requestId; real (>0) iff found with status > 0;
- without interactions (or no row) → false (preserve).

### Same invariant at the other leave-points
- `attachToInteractions` pendingAck admission: an entry attached onto an
  interaction whose existing row for that requestId is null-status is NOT
  admitted to pendingAck (durable copy stays for enrichment).
- `acknowledge(requestIds)`: skips ids whose owning row is still null-status
  (only observable when interactions are known — Stop wiring passes
  productionInteractions).
- `rehydrate` crash-point-A filter: same predicate — drop a stored entry
  only when the rebuilt-ownership owning row has a real status.
- `acknowledgePersisted()` gains an optional interactions argument
  (acknowledge(ids, interactions)); default behavior unchanged.

### Stop wiring (service-worker.ts) — unchanged shape
`ledger.snapshotStamped()` now sees held/merged completions; enrichment
already consumes it. acknowledgePersisted() call after the ledger drain
attach passes productionInteractions (optional arg) so acks respect the
invariant.

## Acceptance criteria

- [ ] AC1 (P1): after ownership attaches a null-status row, a
      `pushStamped({status:200})` for that requestId merges/re-inserts; the
      ledger snapshot exposes 200.
- [ ] AC2 (P2): pruneKey KEEPS an attached entry whose owning row is
      null-status (completion survives the prune); drops it when the row
      has a real status (exactly-once leave unchanged).
- [ ] AC3 (P3): a completion-reinserted (pendingComplete) entry is not
      re-attached by attachToInteractions and is not acked by
      acknowledgePersisted; clearAll removes it.
- [ ] AC4 (P4): end-to-end stop shape — null-status bridge row + later
      completion push → snapshotStamped provides 200 →
      enrichNetworkRowStatuses upgrades the row (existing E-tests keep
      passing).
- [ ] AC5 (P5): rehydrate's crash-point-A drop respects the invariant
      (row null-status → entry kept for enrichment).
- [ ] AC6 (P6): pendingAck admission respects the invariant.
- [ ] AC7 (P7): L1–L3 + E1–E4c + full suite still green (no regression);
      statuses never downgraded (upgrade-only preserved).
- [ ] AC8 (P8): ownership semantics unchanged — attachToInteractions still
      skips attached requestIds (no duplicate rows, G5-E compatible).

## Out of scope
requestBody propagation to the bridge row (entity stays cart-item:int-14),
ring TTL, ENTITY_HINT_PATTERNS, capture/attribution, M9 stages.

## Expected observable result
Next Amazon run: `[NetworkDrain] status-enriched <id>→200` at Stop; int-N
row status 200; outcome success w/ api-operation evidence; entity still
`cart-item:<interactionId>` (no body — accepted limitation).

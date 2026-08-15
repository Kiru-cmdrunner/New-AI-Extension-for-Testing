# Ledger completion-enrichment — two ledger-internal fixes

Spec target: the int-14/postStatus:null audit (session of Aug 15). Root cause was
traced read-only and reported: the Stop-time status-enrichment pass has EMPTY
sources for an owned requestId whose completion landed after the commit-time
attach, because of two ledger-internal behaviors.

## Timeline being fixed (requestId R, status 200, Amazon shape)

T+0     onBeforeRequest → pushStamped {R, status 0} (durable); forwards
        phase:'start' (no requestBody) → bridge buffers row {status:null}.
T+157ms click window closes → interaction OWNS row {R, status:null,
        requestBody:undefined}; LIVE_INTERACTIONS persisted; ownership marks R.
T+commit onCommitted precedes onCompleted → attachSyntheticNavEvidence routes
        stamped doc request to the click → attachToInteractions:
        - R skipped (owned), then PRUNED from the in-memory entries map.
T+2s    onCompleted(200):
        - ring entry {R,200} pushed (TTL 10s — long sessions evict it);
        - recordStampedRequest {R, 200} → pushStamped → OWNERSHIP EARLY-RETURN.
T+Stop  enrichment sources: snapshotStamped() = pruned in-memory map (R gone);
        ring = TTL-evicted. Row stays null → M9: succeeded null → no vote →
        incomplete + apiEvidence [] + body-less entity fallback id.

Both losses are in the ledger. Exactly-once ROW semantics, attribution, G4/G5,
M1–M8, capture: untouched. Status-only upgrade, same contract as the approved
status-enrichment design.

## Fix A — pushStamped: completion pushes are enrichments, not attaches

`evidence-attribution.ts` `pushStamped`:

Current: `if (this.ownership.isAttached(entry.requestId)) return;` — fires
before the dedup/merge branch and silently discards a completion (status>0)
push for an owned requestId.

New behavior: an incoming entry with `status > 0` whose requestId is OWNED is
routed into the SAME merge path as the dedup branch (mergeIntoStored:
upgrade-only status, fill-absent metadata). No attach is attempted (ownership
never changes; the entry is never re-rendered anywhere). The merge targets the
STORED ledger entry, which must therefore still exist in the map — the object
identity contract is: the stored entry object is mutated in place.

Fallback for the sub-case where the stored entry was already pruned from the
map (Fix B preserves it, but belt-and-braces): if a completion push arrives
for an owned requestId with NO stored entry, record it into a small
`completionOverrides: Map<requestId, status>` consulted by snapshotStamped().
(Kept minimal: status only. Never re-created as an attachable entry.)

## Fix B — attachToInteractions: prune preserves un-completed entries

Current: pruneKey drops every entry whose requestId is owned, unconditionally —
including entries whose owning interaction's row still has `status == null`
(the exact "row exists ≠ row complete" conflation fixed in the drain guard and
the merge, but missed here).

New behavior: pruneKey keeps an entry when BOTH:
  - the requestId is owned, AND
  - the owning interaction's row for that requestId still has status null
    (or the row cannot be found — conservative keep).
Such kept entries are NOT attachable (ownership still blocks attach; nothing
re-renders) — they exist ONLY as an enrichment source for snapshotStamped()
and the Stop pass, and are still removed by acknowledge()/clearAll() as usual.

Implementation detail: attachToInteractions needs the owning interaction's
rows to decide. It already iterates interactions; pass ownership row-status
into pruneKey via a lookup (owner interactionId → row status per requestId)
built from the same interactions array.

## Acceptance criteria

- [ ] AC-A1: pushStamped {R, 0} → attach makes R owned → pushStamped {R, 200}
      → snapshotStamped() reports status 200 for R (via kept entry or
      completionOverrides). No duplicate entry, no attach side effects.
- [ ] AC-A2: pushStamped {R, 200} for an owned R whose row ALREADY has a real
      status: no change (upgrade-only; stored real status never overwritten).
- [ ] AC-A3: pushStamped {R, 0} (non-completion push) for owned R: still a
      no-op — legacy behavior preserved for status-0 re-captures.
- [ ] AC-B1: attachToInteractions prunes entries whose owning row has a REAL
      status (unchanged legacy cleanup), KEEPS entries whose owning row is
      still null — snapshotStamped() still exposes them.
- [ ] AC-B2: kept entries are never re-attached: attachToInteractions called
      twice attaches nothing new; ownership unchanged.
- [ ] AC-B3: acknowledge()/clearAll() still remove kept entries (no leak).
- [ ] AC-END: end-to-end Stop shape — interaction owns null-status row {R}
      with no body; ledger later receives completion {R, 200}; run the Stop
      wiring (enrichNetworkRowStatuses with snapshotStamped()) → row upgraded
      to 200.
- [ ] AC6: tsc 0 errors; full suite green (3,157 + new).
- [ ] AC7: rebuilt ZIP: both fixes present in SW bundle; 0 dynamic import(;
      0 preload helper; download URL byte-identical.

## Out of scope

requestBody enrichment for bridge start rows (separate design if wanted);
ring TTL; ENTITY_HINT_PATTERNS; G4/G5; M9 logic; attribution changes.

## Tests

New file `tests/unit/background/ledger-completion-enrichment.test.ts`
(L-suite: ledger unit; E-suite: end-to-end Stop shape via the real modules,
reusing the network-status-enrichment fixtures).

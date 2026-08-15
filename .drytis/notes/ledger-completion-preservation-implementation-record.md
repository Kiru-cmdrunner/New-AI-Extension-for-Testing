# Ledger completion-preservation — implementation record (2026-08-15)

Approved fix for the two loss points found in the post-enrichment audit
(requestId 6053 stayed status:null on int-14 → no API vote → outcome
incomplete, apiEvidence []). Spec: .drytis/specs/ledger-completion-preservation.md
(supersedes the enrichment-only sketch; invariant: an attached stamped entry
leaves the ledger ONLY when its owning interaction's row already has a REAL
status > 0).

## Changes — ALL in src/background/evidence-attribution.ts
1. pushStamped ownership branch (Fix A + Fix 1): completion pushes (status>0)
   for owned requestIds now merge into the kept stored copy (findStoredByRequestId,
   upgrade-only via mergeIntoStored) — or RE-INSERT as a held `pendingComplete:true`
   entry when no copy survived (pruned+acked). Status-0 pushes stay legacy no-op.
   Held entries: never re-attached (attachToInteractions skips), never in
   pendingAck, wiped by clearAll.
2. nullOwnedRequestIds Set (Fix B): attach pass records requestIds whose owning
   row is null-status — both the fresh-attach branch (row synthesized from
   status 0 → null) and the already-owned skip branch (checks the OWNER's row
   via findNetworkRow + lastSeenInteractions).
3. pruneKey keeps entries in nullOwnedRequestIds (enrichment source).
4. pendingAck admission: acknowledgePersisted filters out isEnrichmentHeld
   entries (ack window: commit-time attach acks after LIVE_INTERACTIONS persist,
   before onCompleted lands).
5. acknowledge() skips null-owned requestIds (never deletes a completion source).
6. rehydrate crash-point-A filter keeps null-row-owned entries (rebuilds
   nullOwnedRequestIds after SW restart).
7. clearAll wipes nullOwnedRequestIds + lastSeenInteractions.

## Files
- src/background/evidence-attribution.ts (all changes)
- tests/unit/background/ledger-completion-enrichment.test.ts (7 tests, fixed
  fixture eventIds to match interaction triggerEvent)
- tests/unit/background/ledger-completion-preservation.test.ts (8 tests; fixed
  chrome.storage mock get() to accept string keys — it iterated the string's
  chars and silently returned nothing; fixed evt-14→evt-c fixture; casts via
  `as unknown as Row`)

## GOTCHA (cost hours): chrome.storage.local.get mock must accept BOTH
`string` and `string[]`. The ledger calls get(UNATTACHED_REQUESTS_KEY) with a
plain string; `for (const k of string)` iterates CHARACTERS → mock returns {}
→ rehydrate sees empty storage. Symptom: entries vanish after rehydrate in
tests only.

## Verification
- 15/15 new ledger tests green; full suite 156 files / 3,172 tests; tsc 0.
- ZIP v10.9.0: 26 files, 220.7 KB, md5 21ad9e90fcafca2ff13ca8a6008cb4f9;
  download URL byte-identical (HTTP 200). SW-inline 515,178 bytes, 0 import(,
  0 preload helper, pendingComplete present.
- Real Chrome (Playwright chromium-1234, CDP 9346): START/STOP, SW console
  0 lines, understanding_result written, warnings null. NOTE: system Chrome
  and a bare run_bash nohup both die with the browser — launch Chrome inside a
  persistent open_terminal session or it gets zombified when the tool's shell
  exits.

## Expected on next Amazon run
'[NetworkDrain] status-enriched <requestId>→200' at Stop; int-14 POST row
status 200; API vote fired → outcome success (conf 0.4) with api-operation
evidence; entity stays cart-item:<interactionId> (requestBody NOT propagated
to bridge rows — accepted limitation per spec).

## Not committed / not pushed. Working tree: 8 modified + untracked
specs/tests/scripts/notes.
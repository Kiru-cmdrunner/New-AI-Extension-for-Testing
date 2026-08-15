# Status-enrichment implementation record (uncommitted)

Approved design (.drytis/specs/network-status-enrichment.md) implemented exactly;
no G4/G5, M1–M8, capture/attribution, or hint-pattern changes.

## Parts

1. evidence-attribution.ts — pushStamped duplicate branch now MERGES in place
   (was: silent return at the old :289 dedup). mergeIntoStored: status
   upgrade-only (incoming >0 AND stored <=0 → adopt; real status never
   overwritten/downgraded); requestBody/sourceEventId/captureOrigin/
   documentRequest/mainFrame fill-absent only; no splice/re-push (FIFO +
   ownership preserved); write-through persist() fires on merge too.
   New snapshotStamped(): read-only flat copies.
2. network-observation.ts — new getCompletedByRequestIds(ids): pure ring filter
   by requestId (SW-restart edge: ring entry with lost eventId mapping).
3. network-drain.ts — new pure enrichNetworkRowStatuses(interactions,
   {ledger, ring}): status map from real statuses only (>0), LEDGER WINS over
   ring; upgrades ONLY existing null-status rows with requestId, in place; no
   add/remove/reorder; no downgrade; no URL guessing; fake stamped ids match
   nothing. Returns audit records {interactionId, requestId, from:null, to}.
4. service-worker.ts — stop sequence: inserted between ledger drain attach and
   ledger.clearAll(): collect null-status requestIds → enrich from
   ledger.snapshotStamped() + getCompletedByRequestIds → console.info
   '[NetworkDrain] status-enriched …' → persist LIVE_INTERACTIONS. Wrapped in
   try/catch (non-fatal).

## Tests

tests/unit/background/network-status-enrichment.test.ts — 12 tests
(E1–E4c incl. E4c-2 defensive synthetic-nav row upgrade; L1–L3 ledger merge).
TDD: 12/12 RED pre-implementation (enrichNetworkRowStatuses not a function),
12/12 GREEN after. Existing suites untouched-pass: background 5 files/94.

## Verification

- tsc --noEmit: 0 errors
- Full suite: 154 files / 3,157 tests (3,145 + 12)
- Build clean; ZIP v10.9.0 26 files 219.6 KB md5 0753463b9acd3917f58374d47082cfd4
  at both paths; download URL byte-identical (HTTP 200). ZIP-internal SW:
  enrichNetworkRowStatuses/getCompletedByRequestIds/snapshotStamped/
  'status-enriched' present; 0 dynamic import(; 0 preload helper.
- Real-Chrome harness (Playwright Chromium 151.0.7922.34, /tmp/pe15, CDP 9344):
  SW console 0 lines; understanding_result written; warnings null. (Harness
  flow records no network rows → enrichment no-op there by design; effect is
  observable only on real flows like Amazon.)
- Harness filter fix (test script only): excluded additional component-SW ids
  and pinned to service-worker-loader.js URL match.

## Expected Amazon re-test result

Add-to-cart POST row: status 200 (was null); M9: add-to-cart ApiOperationSignal
succeeded:true → API success vote → outcome success w/ API evidence; side panel
row shows the number. Ledger console line '[NetworkDrain] status-enriched'
should appear at Stop when enrichment occurred.

## Tree (still uncommitted; b4a58f3 base)

Modified: vite.config.ts, package.json (SW build fix), evidence-attribution.ts,
network-drain.ts, network-observation.ts, service-worker.ts (this task),
understanding-pipeline.ts, target-state-signals.ts (M9 null guards).
Untracked: scripts/build.mjs, scripts/sw-inline-finalize.mjs, specs + notes +
harness scripts + 2 test files.

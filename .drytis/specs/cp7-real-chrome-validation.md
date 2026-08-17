# CP7 — Real-Chrome Validation of the Knowledge Repository (CP6)

**Status:** implementation in progress
**Approval:** design approved 2026-08-16T22:58Z with guardrails:
- Primary goal: prove CP6 works in the real extension across sessions.
- CP1–CP6 architecture FROZEN except the approved P1–P3 hygiene patch.
- No new knowledge concepts, no connectors, no selectors/schemas/packs/agents.

## Scope

**In:** P1–P3 hygiene patch (3 sites, bounded), unit regression tests,
real-Chrome validation harness (legs L1–L5), spec + audit report.

**Out:** any Dexie v4, any merge-arithmetic change, any loader change,
any pipeline/service-worker change, any new store or field.

---

## Part A — P1–P3 (source changes)

### P1 — `searchSignatures` status filter (repository)
- Stored `status`/`sessionsSinceSeen` mean "as of last observation"; the
  effective status is read-time. Filter must follow the loader formula:
  `currentSeq − lastSeenSeq > STALE_AFTER_SESSIONS → 'stale'`.
- `currentSeq` = max seq over the app's retained manifests (`≤ 50`).
  Zero manifests → return `[]`.
- Doc: eviction is FIFO (oldest first) → max-seq manifest is never
  evicted while newer ones exist → in-tx `max+1` can never reuse a seq.

### P2 — `apiIdentity` unparsed fallback (mapper)
- Non-`METHOD url` detail → `` `api:unparsed:${stableHash(tail)}` `` where
  `tail` = detail with the trailing ` initiated during <episode-id>`
  suffix stripped. Distinct unparsed details stay distinct; the same
  endpoint seen via different episodes yields the SAME identity.
- No change to any identity produced by the current producer.

### P3 — grammar guards + docs (mapper)
- Entity: colon-less `entityId` → type `'unknown'` (no mis-parse).
- State `→`/`:` ambiguity: doc comment only (slugs are safe today).
- `stableHash` volume doc: FNV-1a 32-bit, ≈65k birthday bound, expected
  ≤ ~1k signatures/app → P(collision) ≈ 1e-4, inspectable on collision.

### Tests (unit, regression-pinned)
- P1 ×3: stale-only / active-only / loader-agreement (+ zero-manifest case).
- P2 ×3: unparsed → hashed identity; episode-suffix-stripped stability;
  distinct details → distinct identities.
- P3 ×1: colon-less entity → `unknown:<op>`; existing identities unchanged.

---

## Part B — Real-Chrome validation legs

Harness: `.drytis/zz-cp7-knowledge-validate.mjs` (untracked `.drytis/`
script convention). Reuses the CP5 pattern: Chrome-for-Testing 148
headless, CDP, local replica server, SW-context IndexedDB reader
(read-only), START/STOP via sidepanel `chrome.runtime.sendMessage`.

- **L1 cross-session merge:** fresh profile + origin; same flow twice.
  ONE Add-to-Cart signature; key byte-identical; occurrenceCount=2;
  cart-api consequence hitCount=2, missedObservations=0; evidenceSamples
  [s1,s2]; manifests seq 1,2; behaviorVersion=1; no duplicate keys.
- **L2 version bump + counters:** session 3 = search-only (new signature
  set) → behaviorVersion=2; Search signature occurrenceCount=3;
  Add-to-Cart stays 2 with no missedObservations accrued (session 3
  never observes that signature → no boundary fold for it).
- **L3 real-profile migration:** CP5 worktree build (v2) runs Session A
  in a fresh profile → genuine v2 DB with rows; swap extension dir to
  CP6/CP7 build → restart → Session B same origin → verno=3, v1/v2 rows
  preserved, same-origin signature merges across the build boundary
  (occurrenceCount=2). Fallback if worktree build fails: report honestly;
  fresh-profile v3 + fake-indexeddb migration test remain the evidence.
- **L4 runtime health:** SW console — zero `behavior-knowledge-persist:`
  warnings, zero uncaught exceptions across all STOPs.
- **L5 evidence resolvability:** every consequence sample's edgeKey
  exists in that session's `knowledgeEdges`; loader marks all resolvable.

**Defect policy:** a genuine CP6 defect found by a leg is fixed in CP6
files with a regression test; re-run affected legs + full suite. No
scope creep.

---

## Acceptance criteria (final audit)

- [ ] P1–P3 implemented exactly as scoped; zero source changes outside
      mapper + repository
- [ ] 7 new unit tests pass (P1 ×3, P2 ×3, P3 ×1)
- [ ] `tsc --noEmit` → 0 errors
- [ ] Full suite green (expected 173 files / 3,437 tests)
- [ ] dist built from the patched tree
- [ ] L1 all assertions pass
- [ ] L2 behaviorVersion=2 + counters as designed
- [ ] L3 verno=3, preserved rows, cross-build merge (or documented
      fallback)
- [ ] L4 zero persistence warnings / exceptions
- [ ] L5 all evidence samples resolvable
- [ ] Tracked diffs: only the 3 P-sites + 2 test files
- [ ] No commit, no push until explicit approval

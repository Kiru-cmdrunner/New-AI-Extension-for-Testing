# CP1–CP8 Final Real-Chrome E2E Validation — 2026-08-17

**Run:** clean profile, Chrome-for-Testing 148 headless, extension built from
pristine `d67588e` (git archive worktree at /tmp/e2e — the /workspace tree has
uncommitted E1-prep + 2 stat-fooled corrupted files and was NOT used).
**App:** local replica "Replica Bazaar" (127.0.0.1:8098) — realistic e-commerce
search → product → native form-POST add-to-cart → 302 → cart confirmation.
**Sessions:** s1 full flow, s2 identical full flow, s3 search-only variant.
**Evidence:** `.drytis/notes/e2e-cp1-cp8-final/evidence/` (25 files, raw).

## Proven facts (from THIS run)

- Recording: START via sidepanel `chrome.runtime.sendMessage` (production path),
  3 sessions recorded, each STOP ran the production pipeline and persisted.
- s1 model: 7 episodes, 21 edges, 2 gaps, coverage totalInteractions=11,
  attributedNetworkRows=11/11, attributedObservations=5/7, 0 malformed.
- Parameters: `headphones` captured as parameterInput on Click "Go" episode
  (int-3 focus label "Search products", link=form-overlap) in all 3 sessions.
- T1: 32 request refs across edges; 9 suggest fetches per session stamped to
  the Go episode; product GET stamped; POST /cart/add stamped in s2.
- T2: navigation edges with committed latencyMs (39/27/30ms product, 77/51ms cart).
- T3: state `search-results→cart` (2 sessions), entity `cart-item:create` (2),
  `search-query:create` (1).
- T4: anchor-window edges conf 0.6; post-anchor edges conf 0.5 (cap applied);
  destroyed-document evidence survives via synthetic post-nav windows
  (`synthetic-nav-*`, degradation `synthesized-evidence`), latencyMs 27–77.
- Gaps: exactly 2 per session, both `ui`/`no-live-horizon`, retained as gaps
  (never guessed into edges). GapReport total=6 all no-live-horizon.
- CP6: fresh profile → Dexie `cmdrunner_knowledge` verno=30 (v3 schema direct);
  3 manifests seq 1,2,3; 7 signatures after s1→s2 (ZERO new keys on identical
  s2 — same signatures), 8 after s3 (one new: product Unclassified/search-results).
  occurrenceCount 1→2 on all shared sigs; search sigs reach 3 after s3.
  signatureSetHash d8435ab5 (s1,s2) → 20af379d (s3) ⇒ behaviorVersion 1→2.
- F2: no duplicate consequence identities in any profile (audit file 11);
  cart-item:create hits=2 across sessions, 1 sample each session.
- CP8: all 12 query ops returned contractVersion=1 envelopes; deterministic
  (8 double-call ops byte-identical); bounded (≤5 samples, ≤48 consequences).
- Evidence deep-links: 31/31 resolved; DTO resolvable=true on 23/23 (raw DB
  rows don't store the read-time flag — it's computed in DTOs).
- Read-only: full-store snapshot (15 stores, count+digest+sorted rows)
  byte-identical before vs after ALL contract reads; re-verified after a
  later re-query session (snapshot identical again).
- Typed absence: selector null/capture-ceiling (+wouldBe) on all 8 actions;
  payloadSchema 'unrecorded' on all 12 api entries; workflowPatternIds []
  + linkage-pending; dbGroundTruth 'unavailable'.
- SW console across 3 STOPs: only 3 benign `stop drain attached 1 request(s)`
  info lines; zero exceptions, zero behavior-knowledge-persist warnings.

## Known limitations CONFIRMED live (not fixed, by instruction)

- **F1 (T1 capture-timing race)**: the same physical click flow captured
  `POST /cart/add` as a T1 edge in s2, but in s1 the same click yielded the
  destination-document `GET /cart.html?added=P100` instead (the POST raced
  the document unload; ledger stop-drain recovered exactly 1 request each
  session). Asymmetric profiles (GET /cart.html hits=1 missed=1;
  POST /cart/add hits=1) are the honest fingerprint of F1.
- **No durable selectors**: selector.value null on all 8 actions.
- **No API payload schemas**: payloadSchema 'unrecorded' (12/12).
- **No DB ground truth**: capabilities.dbGroundTruth 'unavailable'.
- **No workflow→signature linkage**: 3 recordedWorkflow rows exist (CP6
  legacy stratum) but workflowPatternIds=[] + linkage-pending on actions.
- **No intent/semantic labels**: anchor actionTypes are Click/Unclassified;
  targets are accessible-text only.

## Harness artifacts (instrument, not product)

- 02b-raw-interactions read the wrong storage key (session_events; correct
  key is cmdrunner_live_interactions) → re-read post-run as 17-*.json (valid).
- Run-2-of-harness wrote workflow traces after file write → re-queried from
  persisted profile as 19-*.json (valid, deterministic reads).

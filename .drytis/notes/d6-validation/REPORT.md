# D6 Validation Results — 2026-08-17 (final, v3 harness)

Real-Chrome validation (Chrome for Testing 148, headless=new, fresh profile,
replica 8098 with favicon served, production dist build with D6). Harness:
`harness.mjs` + `contract-probe.ts` in this directory. Raw evidence:
`db-after-s2.json`, `db-final.json`, `raw-pair-after-s2.json`,
`cp8-contract-probe.json`, `console-capture.json`, `verdict.json`.

## Verdict: ALL GREEN — 26/26 checks (0 console errors)

Sessions: s1+s2 identical full flows (retry-until-identical-canonical, 1
attempt needed); s3 idle heartbeat-only; s4 dragzone-only press. Then a
CP8 contract probe executing the REAL production contract code
(KnowledgeDatabase + KnowledgeRepository + KnowledgeLoader +
KnowledgeContract bundled from /workspace/src via esbuild, evaluated in the
sidepanel context) over the real IndexedDB.

### Core linkage

1. **Full workflow** `wf-pattern-d3392945`, occurrenceCount=2 (s1+s2),
   linkageState='linked', signatureIds = exactly the anchor set of its two
   sessions (60f2dfdb 'Link aurora wireless headphones' view=search-results,
   e0e59cec 'Click add to cart', e1182f21 'Click aurora wireless
   headphones') — cross-checked against the knowledgeEpisodes dump.
   Both instances link the identical 3-key set; instance sets == pattern
   set. Raw stepIntents: **7 tokens verbatim** incl. both absolute URLs.
2. **Honest absence (idle session)**: heartbeat-only session created NO
   workflow row and NO behavior session (zero episodes) — nothing
   fabricated. (The literal 'linkage-pending row in Chrome' variant is
   covered by unit + contract tests; in real Chrome every recording with a
   persisted workflow also had deliberate actions, so no pending row can
   arise from this scenario by construction.)
3. **Span isolation (drag control)**: `wf-pattern-21ca2851` links ONLY
   `sig:73e1db48` (drag area); bidirectional isolation from the full flow.

### CP8 contract probe (production code, real DB, real Chrome)

- `contractVersion=1`; **deterministic=true** across repeated listActions;
  **readOnly=true** (4 stores byte-identical before/after).
- All 4 descriptors `workflowPatternAbsence='linked'`:
  Link/Click 'aurora wireless headphones' → [wf-pattern-d3392945],
  Click 'add to cart' → [wf-pattern-d3392945],
  Unclassified 'drag area…' → [wf-pattern-21ca2851] (only the drag pattern).

### Console

Zero errors across SW + sidepanel + page for the entire run (favicon 404
eliminated by serving one from the replica — test infra, not product).

## Deviations & known limits (documented, not hidden)

- Signature IDs vs handover §6: `e0e59cec` and `73e1db48` match;
  `0a2e9eec`/`55640bc8` were pre-D1/D1b twins — current HEAD produces
  60f2dfdb/e1182f21 instead (D1/D1b merged the twins; expected).
- Upstream intent-label variance (known limitation): one earlier attempt
  labeled the suggestion-click differently between sessions and split the
  pattern; the harness retries the pair until canonical sequences match so
  D6 is validated on identical inputs. Pre-existing, out of D6 scope.
- Enrichment read-model (chrome.storage.understanding_result) intentionally
  omits linkage fields because knowledge-loader.ts is frozen E1-prep; the
  repository rows (source of truth for CP8) carry full linkage.

## CI-equivalent verification

tsc --noEmit clean; vitest 185 files / 3514 tests green.

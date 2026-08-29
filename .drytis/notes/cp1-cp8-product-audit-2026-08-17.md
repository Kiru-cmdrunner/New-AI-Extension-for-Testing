# CP1–CP8 product audit (pre-fix) — 2026-08-17

Read-only audit of committed d67588e (CP1–CP8) + current product surfaces, with two real-Chrome
production runs against the audited dist/ build (replica app 127.0.0.1:8098). No code modified.

## Evidence
- /tmp/audit/evidence/ (run 1): 10-interactions, 11-ir-plan, 12-generated-files (Playwright spec), 13-understanding, 14-repo-session, 15-knowledge-db, 16/17 console+panel-dom
- /tmp/audit/evidence2/ (run 2, same profile → 2-session consolidation): 20-kdb-before, 21-interaction-mechanism (trigger event types), 22-staleness-keys, 23-kdb-after, 24-signatures-after, 25-workflows-after, 26-understanding-2, 27-console
- Prior full E2E: .drytis/notes/e2e-cp1-cp8-final/ (CP1–CP8 23-criteria validation, all-PASS/known-limits)

## Confirmed defects (headline)
- D1 mousedown Unclassified twins: every click → extra ledger 'mousedown' entry (DISCRETE_ACTION_TYPES) never claimed by Click def (triggers on 'click' only) → projected Unclassified at stop → normalizeWorkflow subsumption FAILS (elementKey: projected identity cssSelector='' → `tag:BUTTON` vs `name:X|sel:#id`) → duplicate anchor episodes (7 eps for 4 actions), duplicate CP6 signatures (6 sigs = 3 actions × 2), duplicated workflow steps. Files: evidence-ledger.ts:27, click.ts triggers, projection-engine.ts (bare identity), workflow-normalizer elementKey, episode-builder.ts:289.
- D1b parameter loss: TextEntry int-2 ('headphones') member of NO episode for suggestion-div flows — isSubmitCapable needs BUTTON/INPUT[submit|button|image]; DIV suggestion + programmatic form.submit() → no parameter link. (Prior E2E linked it only when a real Go button was clicked.)
- D2 IR staleness inert/misleading: execution_ir_plan_generated_at companion written only AFTER first RUN_TEST (service-worker.ts:872-874); first run compares vs epoch; and because elementId='' (D3) + elements table empty, referencedElements=[] → staleness never fires at all.
- D3 elementId never assigned: identity-extractor.ts:370 sets ''; types.ts:162 claims "assigned by background" (stale doc); no production caller of healFromRecording → Repository Element table never populated → IR↔Element join, staleness, healing-override keys all built on ''.
- D6 knowledge invisible: understanding_result written (SW:563) but read nowhere in sidepanel (only removed :967); CP8 KnowledgeContract zero UI importers. ALL user-visible surfaces session-local.
- D7 workflow instability: identical sessions → 2 different patternIds (2c72a133 vs ab96a6b3; canonical steps differ at head by heartbeat 'Fetch data') → occurrenceCount never ≥2; label 'Fetch data' for purchase flow (intent-labeler 'get'→'Fetch data' dominant); literal URL steps in canonicalSteps.
- D4 assertions always [] (INV-GEN-7) — UI shows steps with no verification marker; assertion-renderer has literal "// TODO: Custom assertion".
- D5 dead sections in index.html: Raw Event Timeline (never populated; timeline-renderer zero callers), Capability Analysis residue, Element Healing (element_heal_result has NO writer), Replay JSON (replay_json no writer).
- D8 NetworkBridge ready-flag never set (MAIN script dispatches cmdrunner-net-ready at document load; bridge starts listening only at START_RECORDING) → permanent "webRequest-only mode" debug lines; capture still works via per-request dispatches; flag/diagnostic wrong.
- D9 IR env: browser/viewport hardcoded, baseUrl = full startUrl path, tc-/tcv-Date.now() IDs violate INV-GEN-1 determinism.
- D11 cosmetic: synthetic nav labels double-quoted ("Navigate to ""Title""").

## Verified-correct (this run)
- CP6 consolidation live: 2 manifests, 6 sigs occ→2 lastSeq→2 active, signatureSetHash stable a8e6775a (behaviorVersion stays 1 by loader derivation — correct), no dup consequence identities (F2 holds).
- CP1–CP5 pipeline ran in production STOP path; coverage 11/11 interactions, 7 attributed obs, T1/T2/T3/T4 edges present; outcomes derived (success/incomplete @ conf 0.4/0, honestly 'inconclusive').
- Repository V2: session + IR artifact + behavioral evidence persisted; repo_session_id surfaced.
- IR bridge + Playwright generator produce working spec (fill→click suggestion→click product→add-to-cart, correct CSS locators) though with D1-independent duplicates of nav steps.

## F-series classification (asked)
- F1 T1 capture-timing race: KNOWN LIMITATION (live-confirmed again: POST /cart/add absent from T1 consequences this run).
- F2: FIXED (b927b67), live-verified.
- F3: NOT DEFINED anywhere in repo/specs — needs user definition before classification.
- No durable selectors / payload schemas / DB ground truth / workflow→signature linkage / intent labels: KNOWN LIMITATIONS (CP8 types them honestly; linkage-pending).

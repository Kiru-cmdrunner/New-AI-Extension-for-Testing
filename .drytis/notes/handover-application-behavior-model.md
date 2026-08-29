# HANDOVER — Application Behavior Model (CP1–CP8)

**For:** AI-to-AI continuity. **Written:** 2026-08-16 09:46 UTC, from actual workspace state (verified, not assumed).
**Repo state at handover:** branch `capability-surgical-removal`, HEAD `db1aabd` = origin (clean, synchronized). All behavior-model work is **untracked** (never committed). Last verified production ZIP: built from `db1aabd` — 226,699 bytes, MD5 `f20c5c6baf6813cd3d589ff79df82184` (does NOT contain behavior-model code).

---

## 1. Why we are building this

The Chrome extension records user interactions with rich per-interaction evidence (DOM changes, surfaces, visibility, network, API bodies, entities, state transitions), but the recorded model is a **flat list of independent interaction records**. There is no representation of *user-level actions and their consequences across interaction boundaries*. Concretely (the motivating Amazon case): clicking "Add to Cart" produces THREE records — Click (int-19), native Submit (int-S), Navigation (int-20) — and the cart confirmation UI evidence lands on the Navigation record because the old document is destroyed before the click's window can see it. Nothing ties "one user action → one API POST → one cart entity → one page transition → confirmation UI" together.

The **Application Behavior Model** fixes this as a *derivation layer*: it consumes already-captured artifacts read-only and produces a causal graph of **ActionEpisodes** (user-level actions), **CausalEdges** (proven consequences, T1–T4 evidence tiers), **EvidenceRefs** (stable typed pointers), and split **horizons**. Downstream goals: Playwright test generation with edge-derived assertions, API/database post-condition testing, and queryable behavior knowledge for AI agents.

**Governing law (memorize):** *Causality is proven at initiation; ownership is proven at observation.* T1/T2 consequences carry initiation-time proof (request-start stamp, commit lineage) — arrival time never changes their owner. T3/T4 consequences are observation-time facts owned by whichever episode's UI-ownership horizon owns the document at observation.

## 2. Architecture & end goal

- **Pure derivation "Stage 3.5"** after understanding-pipeline Stage 3: `buildEpisodes (CP2) → deriveCausalGraph (CP3) → deriveEpisodeOutcome (CP4) → deriveBehaviorModel (CP4 orchestrator)` → later pipeline wiring (CP5), persistence (CP6), E2E (CP7), review (CP8).
- **Zero capture/attribution changes.** The model only reads recorded artifacts. One optional additive capture field (`causedByEventId` on PostNavCaptureRecord) was *pre-approved if derivation proves insufficient* — so far NOT needed.
- Key concepts: episode anchor = exactly the ledger's `DISCRETE_ACTION_TYPES` (click, contextmenu, mousedown, keydown, dragstart, drop — submit deliberately NOT an anchor, it is a browser-generated companion). Members derive by rule: navigation (commit inside live same-tab horizon), parameter (same-lifecycle or form-overlap approximation), companion (same lifecycleId OR submit-follows-click ≤5s of submit-capable anchor), unclassified (malformed, retained by interval containment — R4). Two horizons per episode: `uiOwnership` (closes at next-anchor/stabilized/recording-stop; claims new T3/T4 observations; latest-anchor-wins, capped 0.5 unless corroborated) and `attribution` (closes only on all-stamped-settled / 30s tail-cap / recording-stop; **a new anchor NEVER closes it**).

## 3. CP1–CP3 — implemented and VERIFIED ✅

| CP | Files (untracked) | Tests | Status |
|----|----|----|----|
| CP1 | `src/understanding/behavior-model/model-types.ts` (472), `evidence-refs.ts` (232) | 46 | ✅ approved |
| CP2 | `episode-builder.ts` (707) | 37 | ✅ approved |
| CP3 | `causal-graph.ts` (464) | 30 + 2 integration | ✅ verified, approval pending in chat |

Verified state at CP3 completion: `tsc --noEmit` 0 errors; behavior-model suite 115/115; **full suite 166 files / 3,323 tests green**; same-input-twice determinism passing; zero tracked files modified.

Key implementation facts:
- **EvidenceRef** = discriminated union (request/event/transition/entity/dom/nav). Canonical key via `evidenceRefKey()` excludes degradation flags. `createRefRegistry()` enforces **ref uniqueness** (one artifact → one owning edge) mechanically, first-claim-wins in deterministic order.
- **T1** floors 0.9; stamped rows (`sourceEventId` ∈ episode-owned events) own forever regardless of completion time. Entity→T1 upgrade only when StateBuilder's change string says "from API" AND a same-carrier T1 api edge exists (suffix-aware match vs `cart-item entity (from API, productId=B0…)`).
- **T2** floor 0.85, `latencyMs = committedAt − T₀`, `missing-window` degradation when URL unresolvable.
- **T3** floor 0.7 — view/entity/notification/counter edges from StateBuilder transitions; entities NEVER re-derived (StateBuilder owns derivation).
- **T4** floor 0.6 — evidence windows claimed by horizon containment + same tab, latest-anchor-wins, **0.5 cap** when cross-anchor unless a T1/T3 edge corroborates the same carrier; `capped-window` / `synthesized-evidence` degradations; no candidate → `UnattributedConsequence`, never a guess.
- **Provenance links: deliberately emit NONE** (case 7 needs surface semantics capture lacks; recorded in-code).

## 4. CP4 — REPAIRED & VERIFIED ✅ + CP5 — IMPLEMENTED, AUDITED ✅ (2026-08-16 12:50 UTC; awaiting user approval)

CP4: original state broken as described below; later session audited, found the two listed breakages PLUS four deeper contract conflicts (A1–A8 in `.drytis/specs/cp4-episode-outcome-orchestrator.md`), repaired source + tests. Verified: tsc 0, behavior-model 149/149, full 168/3,357, reviewer PASS, canonical outcome 0.475/inconclusive (DDC-5 degraded halving — correct, not regression).

**CP5 (pipeline wiring/activation) implemented per approved design** (spec `.drytis/specs/cp5-pipeline-wiring.md`; R1–R6 revisions incorporated):
- NEW `capture-inputs.ts` (172L): pure adapter — StampedRequest→GraphNetworkRow (status 0→null, drops documentRequest/mainFrame/captureOrigin), behavioral-evidence epochization (R3: exact event resolution or window DROPPED — never guessed), post-nav subset, outcome keyed pairs. No clock/IO/mutation.
- `understanding-pipeline.ts`: Stage 3.5 between Stage 3 and 4 — isolated try/catch ('behavior-model:' warning, null model on failure, never-partial — warnings flattened before model assignment), guard interactions>0, `PipelineInput.generatedAtMs/captureArtifacts`, `PipelineOutcome.behaviorModel/behaviorModelWarnings`, fallback generatedAtMs=max(endTime).
- `understanding-result.ts`: optional `behaviorModel?: AppBehaviorModel` (type-only). **schemaVersion stays 2** (writer stamp; optional-on-read; zero readers branch — D12 precedent).
- `service-worker.ts` (additive only): `sessionNavRecords` retention at consume site (R1: cap 200 FIFO, cleared in handleStartRecording beside ledger clearAll, in-memory, passed as copy), `captureArtifacts`{snapshotStamped + retained navs} + `generatedAtMs: Date.now()`, result stamped `behaviorModel`.
- `index.ts` re-exports.
- Tests: `capture-inputs.test.ts` (15), `behavior-model-wiring.test.ts` (12, incl. R1 contract mirrors — SW not importable in unit tests, R1 SW-side verified by reviewer inspection).
- **Second interruption recovery (16:05–16:15 UTC, third session):** a post-report session (14:41–15:22) had improved `capture-inputs.ts` (172→258L): dual-source T1 assembly `assembleNetworkRows` — ATTACHED rows from `interaction.behavioralEvidence.applicationEvidence.networkActivity` (the live attach path; ledger delete-after-persist means attached rows are gone from the ledger by STOP — INV-5) UNION ledger `snapshotStamped()` leftovers (crash survivors), deduped by unique requestId, snapshot-wins status ties / attached-row status upgrades null-snapshot duplicates (upgrade-only, mirrors ledger merge). This supersedes the 13:40 ordering fix's implication that the snapshot alone was the T1 source — it is now the recovery complement. Tests 15→20 (dual-source, dedup, upgrade-only, page-reload-synthesized flag, navType drop, immutability, determinism). That session left an explicitly-TEMP `[CP5DBG]` console block in the pipeline ("remove after validation") — removed at 16:14 after validation passed. Nothing else touched. Final verified state (16:15): tsc 0; behavior-model+wiring 181/181 (196 with race-fix pins); **full suite 170 files / 3,391 tests**; 5 modified tracked files, all additive.
- Verified (final, 13:41 UTC): tsc 0; behavior-model+pipeline+race-fix 187/187; full suite 170 files / 3,386 tests at that point; git scope = 5 modified tracked files (service-worker, understanding-result, index, understanding-pipeline, race-fix-ordering.test — all purely additive, 0 deletions) + untracked dirs; reviewer audit of the interrupted state RESULT: PASS (2 non-blocking WARNs; WARN-1 fixed by reordering, re-verified green). Included: the 13:40 ordering fix (ledger snapshot moved into the stop-recording drain block BEFORE session-end `clearAll()`, since the pipeline call site ran after the cleanup — production stampedRequests would always have been []) + 2 source-order regression pins in `tests/background/race-fix-ordering.test.ts` (SW not unit-importable — top-level chrome listeners; see sw-import-ban-true-root-cause.md).
- **Incident (resolved):** mid-CP5, `episode-outcome.ts` was zeroed by filesystem corruption (7,158 NUL bytes; never committed, no git object existed). Reconstructed from verified CP4 state; reviewer verified fidelity item-by-item (weights value-for-value, categorize/confidence mirrors, null-vs-incomplete, CER-5, rounding, no clock); 149 behavior-model tests unchanged and green. No other file affected (reviewer grepped for NUL bytes: zero files).

Nothing committed/pushed. CP4+CP5 await approval; CP6 not started.

## 5. CP5–CP8 — NOT STARTED (planned)

- **CP5 — pipeline wiring:** call `deriveBehaviorModel` after understanding Stage 3 in `understanding-pipeline.ts`; add optional `behaviorModel` field to `UnderstandingResult` (precedent: M9.12/D12 optional fields); orchestrator's caller injects sessionId/generatedAtMs (boundary C). Failure isolation: derivation wrapped so pipeline continues on error.
- **CP6 — persistence:** Dexie additive `version(3)` — new stores `knowledgeEpisodes`, `knowledgeEdges`, `knowledgeUnattributed` (flat rows + refJson); written as the LAST pass inside `persist()`, **one transaction('rw') over only the three new stores** — existing stores unaffected if this fails; new repository queries. Precedent: DDC-4 additive migration.
- **CP7 — interruption fixtures + real-Chrome E2E:** the eight cases as fixtures + live verification harness. Known E2E environment facts: use Chrome-for-Testing at `/home/coder/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome` (system Chrome ignores `--load-extension`); harness scripts must live under `/workspace`; START/STOP_RECORDING must be sent from an extension page via `chrome.runtime.sendMessage`.
- **CP8 — final review/report** (reviewer + tester + infra gates per the project's full-verification default).

## 6. What is pending RIGHT NOW

1. **CP4 + CP5 approval** — both implemented, verified, audited (RESULT: PASS). Awaiting user approval (checkpoint gate). Do NOT start CP6 without it.
2. On approval → CP6 (Dexie v3 knowledge stores) → CP7 (E2E) → CP8 (gates) in order, each with approval gate. CP6+ should write specs under `.drytis/specs/` before code.
3. Nothing is committed/pushed/built — keep it that way until the user says otherwise.

## 7. Verification requirements (every checkpoint)

`tsc --noEmit` 0 errors · targeted behavior-model tests green · **full suite green** (baseline before CP4 breakage: 166 files / 3,323) · same-input-twice determinism test passing · `git status` shows zero tracked modifications (behavior-model dirs stay untracked until the user approves committing) · no build/commit/push unless instructed.

## 8. Invariants that must NOT be broken

- **Do not modify:** capture (event-tap, evidence-collector), network attribution/ledger (CER/G4/G5, INV-5, requestId-first merge), `DISCRETE_ACTION_TYPES` (consume, never redefine), StateBuilder and OutcomeDeterminer **internals** (OutcomeDeterminer class never instantiated by the model — only its weight table mirrored, with tests pinning the sums), M1–M9, ASIN/entity hints, Phase-1 NAV capture, Fix 2/Fix 4 (`evidence-collector.ts` boundary guards).
- **Model rules:** owning episode (`from.episodeId`) vs carrier interaction (`from.interactionId`) never collapse; ref uniqueness = no dual ownership; never guess causality (unattributed instead); provenance links never become edges; confidence floors T1 0.9 / T2 0.85 / T3 0.7 / T4 0.6, post-anchor cap 0.5; `ATTRIBUTION_TAIL_MS=30_000`, `CORROBORATION_WINDOW_MS=2_000`, `PARAMETER_LINK_WINDOW_MS=30_000`, `NAV_MEMBER_SETTLING_MS=3_000`, `SUBMIT_FOLLOWS_WINDOW_MS=5_000`.
- **Determinism:** no `Date.now`/`Math.random`/`performance.now` inside derivation (generatedAtMs/sessionId injected); single ordering domain = recorded epoch ms (captureSeq is document-local, tie-break only); output arrays always sorted; inputs never mutated.
- **R4:** malformed interactions retained (degraded unclassified members or warned-unowned) — never silently dropped; id-less records → warning only.

## 9. File map

Created (untracked): `src/understanding/behavior-model/{model-types,evidence-refs,episode-builder,causal-graph,behavior-model,episode-outcome}.ts`; `tests/understanding/behavior-model/{model-types,evidence-refs,episode-builder,causal-graph,unowned-interactions,behavior-model,episode-outcome}.test.ts` (4,551 lines total).
Expected future: `behavior-model-persistence.ts` (+ repository additions), pipeline wiring inside `understanding-pipeline.ts` + `UnderstandingResult`, `knowledge-database` version(3), spec files under `.drytis/specs/` for each CP (note: **no spec file exists yet for the behavior model** — the design lives in the conversation and this note; CP5+ should write specs before code).
Known excluded untracked session artifacts (do NOT stage): `.drytis/{harness-out.txt, sw-cdp-verify.mjs, sw-runtime-verify.mjs, zz-*.mjs, post-nav-verify.mjs}`, `.drytis/notes/{push-blocked-object-store-corruption.md, missing-objects-search-result.md, .repair-mapping-executed, addcart-thin-evidence-root-cause.md}`.

## 10. Known limitations / deliberately deferred

- **Form-overlap is a heuristic** — form membership is NOT captured (no form id in ElementIdentity/DomContext); current rule = submit-capable anchor + same pageId + ≤30s + no intervening anchor. Tightening needs a capture change.
- **Provenance links emit none** (surface semantics gap — autocomplete/surface classification insufficient). Case 7 tests assert emptiness on purpose.
- Unattributed windows classify `no-live-horizon` only — a distinct `outside-horizon` reason needs arrival timestamps windows don't carry.
- Capture ceilings (from plan §13): response bodies never captured; bridge-delivered rows lack `requestBody`; T2 lineage unprovable for bfcache/back-forward (the pre-approved optional `causedByEventId` additive field would fix); ASIN.1-type hints now supported in extraction but body-less rows still yield no entity.
- Persistence, pipeline wiring, E2E: not built. Add-to-cart *presentation* (rolling Navigation evidence into the Click card) explicitly OUT of scope — the behavior model is the general fix.

## 11. What the next AI should do FIRST

1. **Do not trust CP4 as done.** Reproduce: `npx tsc --noEmit` (expect 2 errors) and `npx vitest run tests/understanding/behavior-model/` (expect 19 failures) — then fix the two test files per §4. Read `behavior-model.ts`/`episode-outcome.ts` first; they look design-conformant but were never reviewed.
2. Re-run full verification (§7). Report honestly — this project has checkpoint approval gates with the user; do not start CP5 without explicit approval.
3. Read `src/runtime/evidence-ledger.ts` (DISCRETE_ACTION_TYPES), `src/understanding/state-builder/{types,interaction-ordering}.ts`, `src/shared/{component-types,behavioral-evidence-types,post-nav-types}.ts` — the model consumes exactly these shapes.
4. Keep answers/checkpoint reports in the established format (implementation report + read-only audit + explicit "awaiting approval").### CP6 status (2026-08-16 19:15 UTC) — IMPLEMENTED & SELF-VERIFIED, awaiting reviewer re-audit + user approval
- Files: NEW behavior-knowledge-mapper.ts / behavior-knowledge-merge.ts / consolidation/behavior-knowledge.ts + 3 test files; MOD knowledge-types (+219), knowledge-database (v3 5 stores, sessionId idx), knowledge-repository (+296), knowledge-persistence-service (step 11, zero-episode skip, tagged isolation), knowledge-loader (loadBehaviorKnowledge), understanding-pipeline (Stage 5 pass-through only), knowledge-persistence.test.ts (verno 2→3, sanctioned).
- Reviewer round 1: PASS overall, 1 minor FAIL (missing inner try/catch + promised throw-isolation test) + 6 WARNs. Fixed: inner try/catch with `behavior-knowledge-persist:` tag + real throw-isolation test; genuine v2→v3 migration test; behaviorVersion-increment test; R7 resolvable:false test; stale test header. Remaining accepted WARNs: recomputeStatusFlags distributed (by design), generatedAtMs = service clock at persist time (documented), boundConsequences eviction branch untested (needs 48+ consequences).
- Gates: tsc 0; full suite 173/3,424; CP6 suites 33/33; scope clean (7 tracked files, frozen paths untouched, schemaVersion still 2).
- INTERRUPTION NOTE: CP6 was started by an interrupted 17:27–17:33 session (spec + types + db v3 + half-written mapper/merge). Resumed and completed this session; merge module rewritten (the interrupted copy was corrupted mid-write), mapper verified as complete and kept with one contract change (mapper now seq-free; repository assigns seq+generatedAtMs inside the transaction).



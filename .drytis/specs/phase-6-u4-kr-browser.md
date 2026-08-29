# Phase 6 — MS-U4: Knowledge Repository Browser (Surface 3B)

**Status:** DRAFT (owner review before implementation)
**Base:** HEAD `beb237f` (U1 ✓ f3452d5 · U2 ✓ 9315008 · U3 ✓ beb237f)
**Governing designs:** `.drytis/notes/app-understanding-panel-design-2026-08-22.md` (Surface 3B),
`.drytis/notes/u1-u5-availability-mapping-2026-08-22.md` (U4 rows all ✅/🟡).
**Doctrine:** deterministic-first, AI-last. No timing rules. No site tokens.
Honesty over fabrication ("no data" placeholders, gaps listed not hidden).

## 0. Owner constraints (binding, same as U1–U3)

- **Renderer-only.** New UI on the repository page + read-only Dexie reads.
  ZERO changes to: capture, EventTap, Evidence Ledger, Projection Engine,
  Component Runtime, understanding pipeline, KnowledgeRepository writers,
  schema/versions, IR, NOISE_TYPES, background service worker.
- **The panel NEVER writes the KR.** No `.put/.add/.bulkPut/.update/.delete/.clear`
  anywhere under `src/repository/repository-page.ts`, `src/repository/kr-browser/`,
  or their tests' subjects.
- **Reads go through the existing repository/repository service layer** where a
  method exists (`KnowledgeRepository.getSignatures`, `getEntities`, …).
  Direct `db.table` reads allowed ONLY where no service method exists
  (documented per use). No new schema, no index changes.
- No new dependencies. No env keys. No services. No proxies.
- Uses the same read-only `createKnowledgeDatabase()` dynamic-import pattern
  as MS-U3 `lookupSessionGaps`.
- KR browser is a **cross-session** view: NO session-scoping via
  `REPOSITORY_SESSION_ID` (the repository-v2 UUID — wrong key domain for
  knowledge rows; see MS-U3 join-key RCA). Scoping is by `appId` only.

## 1. Goal

Surface what CmdRunner has LEARNED about recorded applications — the 15
`cmdrunner_knowledge` tables (all written, zero UI today) — as the missing
"what did it learn" cross-session view. Answers the design note's question
*What did it learn about this application?* without touching any writer.

Replaces the **dead Capabilities tab** (design decision from the audit:
`capabilities-view` has no data writer; the KR browser takes its slot).

## 2. UX / information hierarchy

### 2.1 Entry & app selection
- Repository page tabs: `Knowledge | Elements | Classic Tree` — Knowledge
  first (it is the understanding view; audit note: current default tab
  `capabilities` is dead DOM). Knowledge is the default active tab.
- App selector (dropdown): `applications` table via `listApplications()`
  (deterministic sort already in repository). Label = origin; sub = appId,
  sessionCount, lastSessionId date. Honest empty state: "No applications
  recorded yet. Record a session to start building knowledge."
- All sections render per selected appId. Cross-app aggregation is OUT of
  scope (honesty: no fabricated merges).

### 2.2 Sections (accordion, collapsed by default, deterministic order)
1. **Action signatures** (crown jewel) — `knowledgeSignatures`
   (`getSignatures(appId)`). Sort: status active-first, then
   `occurrenceCount` desc, then key asc (stable, deterministic).
   Row: actionType badge · normalizedTarget (mono, truncated) · anchorViewId ·
   ×occurrenceCount · first→last seen (session seq) · status
   (active/stale) · divergenceFlags count badge if > 0.
   Expand: consequenceProfile list — per consequence: tier/kind/targetIdentity,
   occurrenceCount, hitCount/…, missedObservations, confidence %, status
   chip (active/stale/diverged), observedVia; divergenceFlags detail rows.
   Cap: 50 rendered rows, overflow marker "… N more" (honest, clickable
   to expand-all is NOT needed; count is honest disclosure).
2. **Recorded workflows** — `knowledgeRecordedWorkflows`
   (`getRecordedWorkflows(appId)`). Sort: lastSeenAt desc. Row: label ·
   canonicalSteps count · viewSequence · ×occurrenceCount · linkageState
   chip (linked / linkage-pending). Expand: steps (numbered, intent names),
   viewSequence, sessionIds count, signatureIds count, instances count.
   Cap 30 + overflow.
3. **Views & transitions (application map)** — `knowledgeViews`
   (`getViews(appId)`) + `knowledgeViewTransitions`
   (`getViewTransitions(appId)`). Views sorted by visitCount desc; map
   rendered as a deterministic textual graph: `from → to ×count` list
   (edges sorted by count desc, then key asc), plus per-view row:
   label, visitCount, first/last seen. Cap: 30 views, 60 edges + overflow.
4. **Episodes & edges** — per behavior session (`knowledgeBehaviorSessions`,
   `[appId+seq]` newest-first, capped 10 sessions). Row per session:
   seq, sessionId, generatedAt, episodeCount/edgeCount/gapCount, coverage
   summary (anchored/total, attributed observations/total). Expand:
   episodes (anchor actionType + target, member count, outcome +
   confidence, signatureKey tail) and T1–T4 edge rows (tier, kind, detail,
   confidence, latencyMs, carrier interactionId, episodeId, refJson
   parsed → EvidenceRef list, capped 20 edges/session + overflow marker).
5. **Gaps backlog** — `knowledgeGaps` (`getGaps(appId)` newest-first,
   cap 50 + overflow). Row: observedKind · reason · detail · sessionId ·
   windowRefJson tail. Grouped-by-reason summary line above the list
   (deterministic count).
6. **API seeds (Knowledge Contract, Phase 5a)** — via `listApiSeeds(repo,
   appId, evidence)` with a read-only `SeedEvidenceAccess` adapter built
   from `DexieBehavioralEvidenceRepository.getBySession` + episode rows
   (the interactionEventIds join is derived from episodes/members rows —
   read-only derivation, no evidence-row mutation). Section renders the
   seed count + per-seed: method+path identity, confidence, evidence
   summary, sessionId. Honest empty state when no attributed requests.
   Cap 25 + overflow. (This is the ONLY section that computes anything —
   reusing the existing frozen contract query, zero new derivation.)
7. **Outcomes** — `knowledgeOutcomes` (`getOutcomesByApp(appId)`), cap 50.
   Rollup line (success/failure/ambiguous/incomplete counts) + rows:
   actionType · target · outcome chip · confidence % · confidenceLevel.
8. **Entities** — `knowledgeEntities` (`getEntities(appId)`), cap 100 +
   overflow. Row: type · entityId · currentState · revision · lastSeen
   date · viewIds count. Expand: attributes (stringified pairs, cap 12),
   stateHistory (from→to + evidence, cap 10).
9. **Collections & counters** — `knowledgeCollections` (currentCount/
   maxCount, entityType) and `knowledgeCounters` (label, currentValue,
   history length, last delta). Caps 30/30 + overflow.
10. **Notifications** — `knowledgeNotifications`, cap 50 + overflow:
    severity chip · text (truncated) · elementPath · appearedAt date.

Every section has an honest empty state ("No … yet") and renders caps with
"… N more" markers. All timestamps render via the existing `fmtDate`
conventions (see U2 patterns; fall back to toLocaleString when absent).

### 2.3 Non-goals (explicit)
- No KR writes, no eviction controls, no delete buttons, no editing.
- No cross-app merge/aggregation. No inference beyond what rows carry.
- No AI narration, no "recognition hints" (that is U5/U6 boundary).
- No behavioral-evidence drill-through (episodes cite `refJson` EvidenceRefs;
  deep-linking to original interaction evidence is U5 work, joined via
  existing windows only — listed in section 4 rows as counts).

## 3. Data flow (join-only, read-only)

```
repository page load / tab click
  → createKnowledgeDatabase() (dynamic import, read-only usage)
  → KnowledgeRepository(db)  [existing class, existing methods]
  → sections render from repository method results
  → API seeds: listApiSeeds(repo, appId, seedEvidenceAccessAdapter)
      adapter = { getBySession: DexieBehavioralEvidenceRepository.getBySession,
                  getInteractionEventIds: derived read-only from episodes }
```

- DB open failure or empty app list → honest empty states, no console spam.
- The repo page is an extension page (same origin as the SW) — Dexie open
  works in-page; this is the same pattern the Elements view already uses
  (`DexieUnitOfWorkFactory` reads in-page).

## 4. Files

**New (renderer module + tests):**
- `src/repository/kr-browser/kr-browser.ts` — section renderers
  (pure functions: `renderKrBrowser(container, app)` orchestrator +
  per-section renderers, all returning HTMLElement, textContent-only).
- `src/repository/kr-browser/kr-data.ts` — read-only data assembly:
  `loadApplications()`, `loadAppKnowledge(appId)` (one bounded read per
  table via KnowledgeRepository methods), `buildSeedEvidenceAccess(db)`
  (read-only adapter for listApiSeeds).
- `src/repository/kr-browser/kr-sort.ts` — pure deterministic sort/rank
  helpers (signatures, workflows, views/edges, gaps) + caps constants.
- `tests/repository/kr-sort.test.ts` — pins for every sort ordering +
  cap/overflow behavior (pure, no DB).
- `tests/repository/kr-browser.test.ts` — pins for section renderers with
  fixture rows: honest empty states, caps + overflow markers, XSS
  (textContent), status/divergence chips, join-key provenance
  (appId-scoped, NO REPOSITORY_SESSION_ID anywhere in kr-data.ts).
- `tests/repository/kr-wiring.test.ts` — source-scan wiring pins
  (established d5 pattern): tab exists with data-view="knowledge",
  knowledge-view main exists, default-active class on knowledge tab,
  refresh() dispatches to renderKrBrowser, zero KR-write method calls in
  the new modules.

**Modified (wiring only):**
- `src/repository/index.html` — replace capabilities tab button + main with
  `knowledge` tab + `knowledge-view` main (single container div +
  app-selector row); keep Elements/Classic untouched.
- `src/repository/repository-page.ts` — DOM refs for the new tab/view,
  activeView union + switch, refresh() branch calling
  `renderKrBrowser(knowledgeRoot, selectedApp)` (async, honest failure),
  app-selector change handler. Legacy capabilities refs removed (they were
  dead: zero writers).
- `src/repository/repository.css` — styles for app selector, sections,
  accordions, chips, mono targets, overflow markers. Reuse existing
  detail-panel/cap-list patterns where visual continuity helps.

**Untouched (guaranteed):** everything else — engine, capture, pipeline,
knowledge-repository.ts (no new methods), knowledge-database.ts, contract
queries (no changes), service worker, sidepanel (except none), IR.

## 5. Acceptance criteria (A1–A14)

- [ ] A1 Spec reviewed & approved by owner before implementation (owner gate).
- [ ] A2 Tab: repository page shows `Knowledge | Elements | Classic Tree`;
      Knowledge default-active; capabilities DOM fully removed.
- [ ] A3 App selector lists recorded applications (origin label, appId sub,
      sessionCount); honest empty state with zero apps.
- [ ] A4 All 10 sections render with deterministic ordering and honest
      empty states per section (fixture-driven pins).
- [ ] A5 Action signatures section: sort active→stale, occurrenceCount desc,
      key asc; consequenceProfile expand with all fields incl. divergence
      chip; cap 50 + "… N more".
- [ ] A6 Recorded workflows: linkageState chip; canonicalSteps numbered.
- [ ] A7 Views/edges: textual graph `from → to ×count`, sorted deterministically.
- [ ] A8 Episodes: session manifest header (seq/counts/coverage), episodes
      with anchor + outcome, edges T1–T4 with parsed EvidenceRefs, cap 20
      edges + overflow.
- [ ] A9 Gaps: newest-first, reason-grouped summary line, cap 50 + overflow.
- [ ] A10 API seeds: count + per-seed identity/confidence/session via the
      FROZEN contract query (no new derivation); honest empty when none.
- [ ] A11 Outcomes rollup + rows; Entities with state history; Collections
      & counters; Notifications — each capped with overflow.
- [ ] A12 XSS: all user-derived strings via textContent; zero innerHTML
      with interpolated data (pin + reviewer check).
- [ ] A13 Renderer-only diff: only the files in §4; zero engine/writer/
      schema changes (git diff audit + reviewer).
- [ ] A14 Real-Chrome E2E: after a real recorded session on the multipattern
      app, the Knowledge tab renders the just-recorded app with non-empty
      signatures/episodes/gaps sections; Elements + Classic Tree views
      still work (regression); zero page console errors.

## 6. Pins (test-first, RED before implementation)

P1 signature ordering (active-first, occurrenceCount desc, key asc).
P2 workflow ordering (lastSeenAt desc) + linkageState chip.
P3 views/edges deterministic graph ordering (count desc, key asc).
P4 gaps newest-first + reason-group summary counts.
P5 caps + "… N more" overflow markers for every capped section.
P6 honest empty states for every section (no undefined/NaN text).
P7 XSS: textContent-only rendering of hostile entity text/notification text.
P8 appId-scoped reads: kr-data.ts contains NO REPOSITORY_SESSION_ID /
   repo_session_id reference (join-domain regression pin, MS-U3 lesson).
P9 knowledge tab is default-active; capabilities refs fully removed
   (source-scan of index.html + repository-page.ts).
P10 API-seed adapter is read-only (no evidence-row mutation methods;
    source-scan + adapter unit pin with in-memory Dexie stub).
P11 zero KR-write calls in kr modules (`.put(` etc. absent — source-scan).
P12 deterministic date rendering (no locale drift in pins — fixed
    formatter injected, `fmtDate` util reused from U2 evidence-drilldown
    if exported, else local copy + pin).

## 7. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| R1 | Large tables slow the page (signatures/notifications unbounded) | caps everywhere (50/30/…) + single bounded read per table; sections lazy-render on expand (accordion open triggers data load for sections 4+ only — header counts load eagerly via `count()` where needed) |
| R2 | Wrong join key repeated (MS-U3 lesson) | P8 pin + appId-only scoping; reviewer re-checks key derivation |
| R3 | Contract seed adapter complexity | reuse the in-memory test pattern from tests/understanding/contract/api-seed-queries.test.ts:83; adapter thin + P10 pin |
| R4 | Dexie open failure / private-mode | try/catch → honest empty state + single console.info, no retry loop |
| R5 | Element detail-panel CSS collisions | new class namespace `.kr-*` for everything new |
| R6 | Removing capabilities tab breaks unknown references | grep first (audit already showed zero references); wiring pin P9 |

## 8. Verification plan

1. Pins RED → implement → slice green (`tests/repository/`).
2. Full suite (expected ~4,28x tests) + tsc (baseline 8 pre-existing).
3. Reviewer: spec §0/A-criteria/security/join-key audit.
4. Infra verifier: renderer-only diff, no engine drift.
5. Real-Chrome E2E: record a real multipattern session → open repository
   page → assert Knowledge tab sections render with live data; Elements +
   Classic regression; console clean. Persist artifacts under
   `.drytis/notes/evidence/sidepanel-e2e-2026-08-22/` (msu4-*).
6. Owner gate → commit (message: `feat(repository): MS-U4 — Knowledge
   Repository browser (cross-session read-only surface)`).

## 9. Open questions for owner (answer at A1)

Q1 Tab naming: "Knowledge" vs "Application Knowledge" vs "Understanding"?  *(default: Knowledge)*
Q2 Should the Knowledge tab be the default-active tab on page open?        *(default: yes)*
Q3 Signatures cap 50 — acceptable, or higher/lower?                        *(default: 50)*
Q4 API-seeds section in U4 or defer to U5?                                 *(default: include — data + frozen query exist; render cost is one bounded pass)*

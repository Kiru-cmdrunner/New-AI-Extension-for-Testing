# MS-U3 — Session Understanding Card (Side Panel)

Status: DRAFT — proceeding under owner "MS-U3, spec first, same discipline" (2026-08-22 10:17 UTC).
Base: capability-surgical-removal @ 9315008. Third of the U-series
(U1 cards ✓ · U2 drill-downs ✓ · **U3 session card** · U4 KR browser · U5 forward links).

Owner goal (from U-series design doc, notes/app-understanding-panel-design-2026-08-22.md):
answer "What did it learn about this application?" in the stopped view — the
first Knowledge Repository READ path in the panel.

## §0 Binding constraints

- **Renderer-only**: changes under `src/sidepanel/` + `tests/sidepanel/` ONLY.
  No capture / ledger / projection / runtime / IR / schema / storage-writer /
  engine / env / services / proxies / deps changes.
- **Read-only**: the panel NEVER writes to `cmdrunner_knowledge` or any
  understanding artifact. Reads `understanding_result` (chrome.storage.local)
  and `cmdrunner_knowledge` (Dexie, gaps only) — both already written today.
- **Honesty**: absent optional fields → absent rows/sections, never
  "undefined"/"null" text. No result → section stays hidden. Gaps lookup
  failure → gaps row absent, rest of card renders (partial-failure tolerance).
- **Security**: every app-sourced string (labels, matched signals, warning
  messages, gap details) via `createElement`/`textContent`. No innerHTML.
- **No timing behavior**: displaying recorded counts/confidences is fine; no
  thresholds, timers, or decisions on time.
- **Caps**: entities ≤8, views ≤6, gaps ≤10, warnings ≤8, transitions ≤8 —
  with honest overflow markers ("… N more").
- Deterministic rendering from data; no wall-clock decisions (generatedAt
  displayed as recorded).

## §1 Data sources (verified @ 9315008)

| Source | Written by | Read today? |
|---|---|---|
| `understanding_result` (chrome.storage.local) | SW at STOP — service-worker.ts:580 | **NOBODY** (only removed at sidepanel.ts:1060) |
| `cmdrunner_knowledge` Dexie (knowledgeGaps + knowledgeBehaviorSessions) | understanding persistence | MS-U1 kr-chip lookup only |
| `REPOSITORY_SESSION_ID` | repository persistence | MS-U1 kr-chip lookup |

UnderstandingResult fields available (src/domain/entities/understanding-result.ts):
`sessionId, generatedAt, schemaVersion, semanticKnowledge?, applicationKnowledge?,
knowledgeWarnings?, outcomes?, transitions?, appId?, behaviorModel?`

- semanticKnowledge: domain classification (domain, confidence, alternative,
  margin, evidence.matchedSignals), coverage %s (intent/component/contract)
  via metadata.coverage, workflows[], contracts, components, intents.
- applicationKnowledge: appId, origin, label, sessionCount, entities[]
  (entityId, type, currentState?, revision, observedInSessions[], stateHistory?),
  views[] (viewId, label, visitCount), viewGraph (nodes+edges with counts),
  collections[], counters[], notifications[], outcomePattern (totals,
  topActionTypes).
- outcomes[]: per-interaction (interactionId, actionType, actionTarget,
  outcome ∈ success|failure|ambiguous|incomplete, confidence 0-1).
- behaviorModel: episodes[], edges[], unattributed[], provenanceLinks[],
  coverage (CoverageStats: anchored/total interactions, attributed network
  rows/total, attributed observations/total, unattributedConsequences,
  provenanceLinks), warnings[] (code, message).
- knowledgeGaps row: observedKind, reason, detail (+ windowRefJson).

All optional. Real sessions on fresh apps: entities/views may be empty;
outcomePattern is cross-session (sessionCount may be 1).

## §2 Design decisions

- **D1 — Placement & lifecycle**: new `<section id="understanding-section"
  hidden>` in index.html, between Observed Workflow and IR Plan (understanding
  precedes generation). Unhidden only when a result exists. "Record another"
  already removes the key — the panel also hides the section on that path.
- **D2 — Card content** (single card, grouped rows, no drill-downs in U3):
  1. Header: "🧠 Session Understanding" + short sessionId + generatedAt.
  2. App identity: label (or appId host), appId, sessionCount ("session N
     with this app"), origin.
  3. Domain: domain + confidence% (+ alternative, margin) + matched signals
     (≤4).
  4. Views & navigation: N views (top labels + visitCount, ≤6), M edges
     (transitions "A → B ×n", ≤8).
  5. Entities: total + NEW vs reinforced split (new = revision 1 OR single
     observedInSessions); per-entity `type:id` + currentState + "reinforced
     ×N" (≤8).
  6. State & feedback: counters count, collections count (entityType+count),
     notifications count.
  7. Outcomes: session rollup from outcomes[] (success/failure/ambiguous/
     incomplete counts); cross-session outcomePattern totals when present.
  8. Coverage: behaviorModel.coverage (anchored/total, network attributed/
     total, observations attributed/total, unattributedConsequences,
     provenanceLinks) + enrichment coverage %s.
  9. Honesty block: knowledgeWarnings + behaviorModel.warnings (≤8) and the
     Dexie gaps list (observedKind · reason — detail on its own line, ≤10).
- **D3 — Async gaps attach**: like MS-U1 KR chips — card renders
  synchronously from understanding_result; gaps row attaches async
  (best-effort, session-scoped via REPOSITORY_SESSION_ID →
  knowledgeBehaviorSessions → appId, then `[appId+sessionId]` on
  knowledgeGaps). Failure → honest absence.
- **D4 — Module layout**: new pure module `src/sidepanel/understanding-card.ts`
  — `renderUnderstandingCard(result): HTMLElement | null` plus DOM-free
  rollup helpers (outcomeRollup, entitySplit, coverageRows, gapsRows) for
  unit-testability. Wiring in sidepanel.ts (load + 500ms retry +
  `StorageService.onKeyChanged(UNDERSTANDING_RESULT)` listener — mirrors the
  IR-plan pattern at :1150).
- **D5 — Ordering**: render after `showDetectedInteractions` in
  handleStopRecording; listener re-renders on late writes (SW writes
  understanding_result BEFORE the IR plan in the same handler).
- **D6 — Unknown future fields**: render only known fields; schemaVersion
  displayed in header tooltip; never fail on extra fields.

## §3 Pins (tests/sidepanel/understanding-card.test.ts + wiring)

- P1 app identity rows (label/appId/sessionCount/origin).
- P2 domain row incl. confidence, alternative, matched signals.
- P3 views + transition edges with counts.
- P4 entity split new-vs-reinforced + currentState + revision.
- P5 outcomes rollup (session + cross-session pattern).
- P6 coverage rows (behavior model + enrichment percentages).
- P7 warnings render with code + message.
- P8 gaps attach (observedKind/reason/detail) + honest absence on lookup
  failure (stub rejects) + rest of card still present.
- P9 honest absence: null result → null element / section stays hidden;
  minimal result (sessionId/generatedAt/schemaVersion only) → minimal card,
  zero "undefined"/"null" text anywhere.
- P10 XSS: hostile strings in label/matchedSignals/warning message/gap
  detail render as text.
- P11 caps + overflow markers (8 entities / 6 views / 8 transitions /
  10 gaps / 8 warnings).
- P12 wiring: onKeyChanged listener registered; stopped-view load + retry;
  section hidden when result absent; "Record another" path hides it.

## §4 Acceptance criteria

- [ ] A1 Section appears in stopped view iff understanding_result exists.
- [ ] A2 All nine D2 groups render from a realistic fixture with real shapes.
- [ ] A3 Honest absence everywhere (P9) — no undefined/null text.
- [ ] A4 Gaps attach async; failure tolerated (P8).
- [ ] A5 No writes to knowledge DB from panel (grep-verifiable: no `.put(`
      /`.add(`/`.bulkPut(` / `.delete(` on knowledge tables in src/sidepanel).
- [ ] A6 All strings via textContent (P10).
- [ ] A7 Caps with overflow markers (P11).
- [ ] A8 Renderer-only diff (git diff --name-only ⊂ sidepanel).
- [ ] A9 Full suite green; no new tsc errors (baseline 8 pre-existing).
- [ ] A10 Real-Chrome E2E: stop a real recording → card renders with live
      data (identity/domain/views/outcomes/coverage), gaps row present when
      gaps exist, zero panel console errors; "Record another" clears it.

## §5 Implementation order

Pins red → pure helpers → renderUnderstandingCard → index.html section →
sidepanel wiring (load/retry/onKeyChanged/Record-another hide) → styles →
suite → reviewer + infra → real-Chrome E2E (extend the established harness
family) → owner commit gate.

## §6 Out of scope (explicit)

Entity drill-down links into the KR browser (MS-U4), KR browser itself
(MS-U4), forward links/reinforcement chips beyond entity revision (MS-U5),
any engine/pipeline change, provenance/curation decisions (Phase 7.1),
transitions[] visualization (data present; display deferred — needs its own
design; count-only surfacing via coverage is enough for U3).

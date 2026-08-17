# CP8 — Knowledge Consumer Contract v1

Status: implemented + verified (unit/invariant tests green, full suite 176
files / 3,456 tests, tsc clean, build OK). Awaiting commit approval ·
Design approved 2026-08-17T03:56Z

## Goal

Turn the Application Knowledge Repository (CP1–CP7, FROZEN) into a stable,
versioned, READ-ONLY consumer contract for the future Intelligence/Execution
Layer (Playwright generation+execution, API testing, DB validation,
Agents/Assistants, LLM layers).

## Three-layer boundary

- L1 Behavioral Knowledge (CP1–CP7): capture → AppBehaviorModel →
  cmdrunner_knowledge v3. SOURCE OF TRUTH. Frozen.
- L2 Knowledge Consumer Contract (CP8): DTOs + facade, contractVersion=1,
  typed absence, deterministic, bounded. READ-ONLY.
- L3 Intelligence/Execution (future): consumes L2 only; feeds back via a
  future ExecutionIngestionPort into NEW additive stores; never mutates
  behavioral signatures; external systems (Jira/DB/API) are future additive
  ExternalKnowledgeWriter implementations — coexistence by provenance, not
  mutation.

## Files

- NEW src/understanding/contract/contract-types.ts — DTOs, CONTRACT_VERSION=1,
  absence reasons, ExternalKnowledgeWriter + ExecutionRecord +
  ExecutionIngestionPort interface DECLARATIONS (no implementations).
- NEW src/understanding/contract/contract-queries.ts — pure query functions.
- NEW src/understanding/contract/knowledge-contract.ts — facade.
- MODIFY knowledge-repository.ts — additive listApplications() only.
- MODIFY src/understanding/index.ts — additive barrel exports (DTOs, facade,
  port types; NOT repository/row types).
- NEW tests/understanding/contract/contract-queries.test.ts
- NEW tests/understanding/contract/knowledge-contract.test.ts

## Contract surface (12 queries)

describeApplication, listApplications, listActions, getAction,
getConsequenceEvidence, reconstructWorkflow, getNavigationGraph,
getStateGraph, getApiSurface, getEntitySummary, getGapReport,
describeActionAsContext.

## Typed absence (never null-without-reason)

- selector: null + absenceReason 'capture-ceiling'
- payloadSchema: 'unrecorded' (bodies never captured)
- workflowPatternIds: [] + 'linkage-pending'
- dbGroundTruth: 'unavailable' (no DB oracle in core)

## Invariants (pinned by tests)

1. contractVersion === 1 on every envelope.
2. Determinism: same DB state → byte-identical JSON across instantiations.
3. Read-only facade: no upsert/put/add/delete/append/ingest methods.
4. Effective status == CP7 formula; refJson verbatim; no reinterpretation.
5. Bounded: ≤50 sessions, ≤48 consequences, ≤5 samples surfaced.
6. Typed absence only.
7. External/execution ports: types exported, zero implementations in core.
8. Scope freeze: git diff touches only the files above; Dexie stays v3;
   schemaVersion stays 2; all L1 layers byte-identical.

## Acceptance

tsc --noEmit 0 · both new suites green · full suite green (174 baseline
files + 2 new) · scope-freeze diff audit · no execution layer, no
connectors, no LLM, no Dexie v4, no writes.

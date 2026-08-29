# M-EXEC — Execution & Feedback Loop (approved design record)

Status: E1 in progress (E2–E4 pending approval gates).

## Boundaries (frozen)

- L1 Behavioral Knowledge (CP1–CP8 stores) — read-only source of truth. M-EXEC never writes.
- L2 CP8 `KnowledgeContract` — the ONLY knowledge interface consumed.
- L3' M-EXEC — TestSpec IR, generation, execution, comparison, RCA (Node side).
- Execution Knowledge — new additive Dexie v4 stores, `source:'execution'`, joined read-time.

## Data flow (approved)

Knowledge Repository v3 → CP8 Contract → KnowledgeSnapshot (deterministic, sha256)
→ TestSpec IR v1 (generator; joins WorkflowTrace steps with getAction consequences)
→ Executors (Playwright/HTTP) → Actual Evidence → Comparator/RCA (tier-aware, evidence-chain)
→ ExecutionRecord → ExecutionIngestionPort → Execution Knowledge stores → contract v1.1 joined view.

## E1 scope (this milestone)

- `src/understanding/contract/contract-snapshot.ts` — deterministic snapshot export + sha256.
- `src/execution/ir/test-spec-types.ts` — IR v1: steps with `title`, expectations with
  `rationale`, `StepTrace`/`ExpectationTrace` (signatureKey, consequence identity, confidence,
  lifecycle, evidence), AssertionPolicy, limitation codes, typed unassertables.
- `src/execution/generate/selector-strategy.ts` — candidates from recorded artifacts only;
  `selectorStrategy:'best-effort'`, `absenceReason:'capture-ceiling'`; never fabricates.
- `src/execution/generate/spec-generator.ts` — snapshot → TestSpec; deterministic;
  hard iff confidence ≥ 0.6 AND lifecycle active AND hitCount ≥ 2, else soft;
  soft never fails a run.
- `src/execution/render/spec-renderer.ts` — `renderSpecMarkdown(spec)` pure projection;
  QA-readable tables; limitations prominent; provenance appendix.
- Tests: snapshot determinism/hash; generator determinism + policy + traceability
  (100% steps/expectations traced); selector-strategy no-fabrication; renderer
  determinism + trace coverage + evidence-ref parity.

## Acceptance (E1)

- [ ] tsc clean; full suite green; contract suites still green.
- [ ] Deterministic spec + markdown (byte-identical from identical snapshots).
- [ ] 100% traceability structural test.
- [ ] Limitations surface every §9 gap (selector/payload/DB/env/F1-cap).
- [ ] Scope-freeze diff: only E1 files; no v3/l1 writes anywhere in new code.

## Guardrails (user-approved)

- One IR; markdown is projection only.
- Every expectation backed by CP8 evidence; no invented selectors/payloads/facts/intent.
- Missing info → typed limitation, never silent scope expansion.
- E2–E4 only after explicit approval.

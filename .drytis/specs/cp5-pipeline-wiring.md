# CP5 — Pipeline Wiring / Activation (spec)

Status: approved design (user, 2026-08-16 12:02 UTC) — canonical design in
conversation; R1–R6 revisions incorporated. This file is the implementation
contract. Governing: `.drytis/notes/handover-application-behavior-model.md` §5–§8.

## Scope guardrail (user-mandated)

CP5 is a **wiring/activation milestone only**:

```
Stages 1–3 → CP1–CP4 Behavior Model → CP5: UnderstandingResult.behaviorModel
```

NOT in scope: Knowledge Repository persistence, Jira/DB connectors,
Agent/Assistant functionality, RAG, LLM prompting, Playwright generation,
API/DB testing, any future consumer. CP1–CP4 causal logic unchanged; all
existing invariants preserved; no commits/pushes.

## Files

| File | Action |
|---|---|
| `src/understanding/behavior-model/capture-inputs.ts` | create — pure adapter |
| `src/understanding/pipeline/understanding-pipeline.ts` | modify — Stage 3.5 + fields |
| `src/domain/entities/understanding-result.ts` | modify — optional field |
| `src/background/service-worker.ts` | modify — retention + wiring |
| `src/understanding/index.ts` | modify — re-exports |
| `tests/understanding/behavior-model/capture-inputs.test.ts` | create |
| `tests/understanding/pipeline/behavior-model-wiring.test.ts` | create |

## Contracts

### capture-inputs.ts

```ts
export interface CaptureArtifacts {
  stampedRequests: StampedRequest[];        // from DurableAttributionLedger.snapshotStamped()
  postNavRecords: PostNavCaptureRecord[];   // session-retained (see R1)
}
export interface BehaviorModelInputs {
  interactions: EpisodeBuilderInteraction[];
  networkRows: GraphNetworkRow[];
  evidenceWindows: GraphInteractionEvidence[];
  postNavRecords: Array<{ navEventId: string; committedAt: number; fromUrl: string; toUrl: string }>;
  actionOutcomes: Array<{ interactionId: string; outcome: ActionOutcome }>;
  stateTransitions: StateTransition[];
}
export function extractBehaviorModelInputs(
  interactions: ComponentInteraction[],
  transitions: StateTransition[],
  outcomes: Map<string, ActionOutcome>,
  artifacts: CaptureArtifacts | null,
): BehaviorModelInputs
```

Rules:
- **Network rows:** map `requestId/url/method/status/sourceEventId/requestBody`;
  drop `documentRequest`/`mainFrame` (graph only consumes consequence rows);
  never synthesize rows.
- **Epochization (R3):** `sourceEventEpoch` = timestamp of the event with
  `eventId === evidence.sourceEventId` among the carrier's `triggerEvent` +
  `memberEvents`. Missing event or invalid timestamp (`typeof !== 'number'` or
  `!isFinite`) → **window dropped** (no guessed timestamps; T4 edge absent;
  CP3 absent-window rules apply downstream). `windowOpenedEpochMs =
  sourceEventEpoch`, `windowClosedEpochMs = sourceEventEpoch +
  evidence.window.durationMs`.
- **Post-nav:** pass-through of `{navEventId, committedAt, fromUrl, toUrl}` subset.
- **Outcomes:** `Map<id, ActionOutcome>` → keyed pairs.
- **Purity:** no clock, no I/O, no mutation of inputs; deterministic ordering
  (arrays preserved in input order; no re-sorting — CP2/CP3 own ordering).

### Pipeline (Stage 3.5)

- `PipelineInput`: add optional `generatedAtMs?: number`,
  `captureArtifacts?: CaptureArtifacts`.
- `PipelineOutcome`: add `behaviorModel: AppBehaviorModel | null`,
  `behaviorModelWarnings: string[]`.
- Insertion: inside `run()`, after Stage 3 catch, before Stage 4. Guarded by
  `input.interactions.length > 0`. `generatedAtMs` fallback =
  `max(interactions.endTime)` (data-derived; SW injects real clock).
- Isolation: own try/catch; failure → `warnings.push('behavior-model: …')`,
  `behaviorModel: null`, pipeline continues. Never partial.
- `deriveBehaviorModel` returns `{model, unownedInteractionIds, warnings}`;
  pipeline uses `result.model` + flattens typed warnings to
  `behaviorModelWarnings` strings (`code: refs`).

### UnderstandingResult

- Optional `readonly behaviorModel?: AppBehaviorModel;` (type-only import).
- **schemaVersion stays 2** (R2): version is a writer stamp, optional on read,
  zero readers branch on it; D12 precedent added fields at 2. Availability
  documented by JSDoc.

### Service worker (R1)

- Module-level `sessionNavRecords: PostNavCaptureRecord[]` (max
  `SESSION_NAV_RECORDS_CAP = 200`, FIFO shift).
- Retention at the existing `consumePendingNavCapture` call site (line ~1549):
  capture record into retention before returning (store semantics unchanged).
- Cleared in `handleStartRecording()` next to ledger `clearAll()` — INV
  session scoping: "the ledger never outlives its recording session".
- In-memory only; SW restart wipes it (same as the pending store).
- Pass `captureArtifacts = { stampedRequests: ledger.snapshotStamped(),
  postNavRecords: [...sessionNavRecords] }` and `generatedAtMs: Date.now()` to
  `runUnderstandingPipeline`; stamp `behaviorModel` on the result when non-null.

## R1 retention proofs (design §R1)

Session isolation (start-clear + once-per-session pipeline), tab isolation
(T2 exact-navEventId matching, CER-2), navEventId uniqueness
(`nav-${Date.now()}-${rand6}`, same id in early + re-confirm writes),
exactly-once (one consume per navigation per document → one retention),
bounded (200 FIFO ≈ 40KB), stop/restart (in-memory; start-clear),
stale-proof (start-clear + exact-ID matching can't cross sessions).

## Invariants preserved (R4)

CP5 touches only the 4 files above, additively. CP1–CP4 modules imported
read-only; capture/event-tap/evidence-collector untouched; ledger read via
`snapshotStamped()` only (G4/G5/INV-5/CER intact); ASIN/entity hints in
StateBuilder untouched; StateBuilder/OutcomeDeterminer internals untouched
(determiner never instantiated by the model); Phase-1 NAV module untouched
(retention copies at consume); Fix 2+4 files untouched; M1–M9 stage bodies
unchanged; DISCRETE_ACTION_TYPES consumed not redefined; R4 malformed
retention passes through; determinism (clock at composition root; fallback
data-derived; adapter pure).

## Acceptance criteria

- [ ] `npx tsc --noEmit` exits 0.
- [ ] CP5 unit tests green: adapter mapping (status 0/null in-flight,
      body-less, missing sourceEventId → window dropped, invalid timestamp →
      dropped, epochization arithmetic, Map-aware immutability, outcome
      wrapping, post-nav subset).
- [ ] Pipeline integration tests green: happy path (model populated,
      warnings surfaced, JSON round-trip), isolation (mocked throw → null
      model + one warning + later stages intact), empty session → null,
      determinism (same input twice deep-equal), fallback generatedAtMs,
      session/nav-retention isolation (retention cleared on start; stale
      navEventId never matches; cap enforced).
- [ ] CP1–CP4 regressions: behavior-model suite green (149 pre-existing).
- [ ] Full suite green (baseline 168 files / 3,357 tests + new).
- [ ] Deterministic output: same input twice → deep-equal models.
- [ ] Zero tracked modifications; nothing committed/pushed/built.
- [ ] No changes to capture/attribution/M9/ASIN/Phase-1/Fix-2+4 paths
      (git diff scope check).

## Out of scope (unchanged)

Everything in the guardrail plus: response bodies, form membership,
provenance links, outside-horizon classification, cross-session
consolidation, episode↔intent join, consumer APIs.

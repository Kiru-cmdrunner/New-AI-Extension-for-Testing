# M8.2 — Evidence Persistence at stopRecording

## Overview

Persist finalized BehavioralEvidence to the dedicated `behavioral_evidence` Dexie table
at the `stopRecording` lifecycle point. This makes evidence durable and queryable
independently of the interaction record.

## Scope

- **In scope:** Extract evidence from production interactions, persist each to Dexie via
  the `BehavioralEvidenceRepository`, wire into `handleStopRecording`.
- **Not in scope (deferred to M8.3+):** SW restart recovery for pending evidence,
  evidence timeout reconstruction, lifecycle bridge restoration, side-panel retrieval hooks.

## Architecture

```
handleStopRecording()
  ├── stopRecording() → productionInteractions (with .behavioralEvidence)
  ├── persistSession(uowFactory, input) → persistenceResult { sessionId, ... }
  ├── NEW: persistBehavioralEvidence(uowFactory, sessionId, productionInteractions)
  │     For each interaction with behavioralEvidence:
  │       Build BehavioralEvidenceRow { ...evidence, interactionId, recordingSessionId, persistedAt }
  │       repos.behavioralEvidence.save(row)  ← put() — idempotent by windowId
  └── UI state update, broadcast, cleanup
```

Key design decisions:
1. **Separate function, separate transaction** — evidence persistence runs in its own
   UoW transaction after persistSession completes. This ensures session creation failure
   doesn't prevent evidence persistence and vice versa. Both are non-fatal.
2. **Idempotent via windowId** — BehavioralEvidenceRow uses windowId (format `bev-{eventId}`)
   as primary key. `save()` calls `put()`, so re-persisting is a safe overwrite.
3. **Non-fatal** — wrapped in try/catch, same pattern as persistSession. Evidence
   persistence failure logs a warning but does not break the recording stop flow.
4. **Separate from persistSession** — The RecordingSession.rawInteractions still carries
   embedded evidence (Tier 3 archival unchanged). The behavioral_evidence table is the
   first-class evidence store. No change to RecordingSession invariants.

## Files to Change

1. `src/repository/services/session-persistence-service.ts` — add `persistBehavioralEvidence()`
2. `src/background/service-worker.ts` — call `persistBehavioralEvidence` after `persistSession`
3. `tests/evidence-persistence.test.ts` — NEW: focused persistence + idempotency tests

## Acceptance Criteria

- [ ] After stopRecording, all interactions with `behavioralEvidence` have that evidence
      persisted to Dexie `behavioral_evidence` table
- [ ] Each evidence row links to both `interactionId` and `recordingSessionId`
- [ ] Each evidence row has a `persistedAt` timestamp
- [ ] Retrieval by session returns the correct evidence
- [ ] Retrieval by interaction returns the correct evidence
- [ ] Re-persisting same evidence does NOT create duplicates (idempotent via windowId put)
- [ ] Interactions without evidence are skipped (not stored as null)
- [ ] Failure to persist evidence does NOT break the recording stop flow (non-fatal)
- [ ] All existing tests pass unchanged
- [ ] TSC 0 errors

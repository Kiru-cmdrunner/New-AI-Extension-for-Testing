# M8.5 — Evidence Lifecycle / Deduplication / Incomplete-Window Handling

## Overview

Verify that behavioral evidence is persisted exactly once, incomplete windows
are handled deterministically, and persisted evidence can be retrieved reliably.
This increment closes the lifecycle gaps between M8.2 (persistence) and the
runtime evidence flow.

## Scope

A. **Exactly-once persistence** — stopRecording called twice does not duplicate
B. **Dedup during stop flow** — evidence arriving during the persistence window
   does not create a second row for the same interaction
C. **Incomplete windows** — evidence with endReason 'displaced' or 'evidence-timeout'
   is still persisted (represents real observation)
D. **Retrieval reliability** — evidence survives across sessions and is retrievable
   by both interactionId and recordingSessionId after persistence

## Design

### A. Exactly-once (idempotent re-persist)
- `persistBehavioralEvidence` already uses `put()` by `windowId` primary key (DB-level)
- M8.5 adds an explicit SW-level dedup guard: a `persistedEvidenceWindowIds` Set in
  sw-integration.ts that tracks which windowIds have already been persisted in this
  recording cycle. The guard is exported via `markEvidencePersisted` /
  `filterUnpersistedEvidence` / `clearPersistedEvidenceGuard`.
- The service worker calls these before persistBehavioralEvidence to skip redundant DB writes.
- Calling stopRecording twice (or calling persistBehavioralEvidence twice) with the
  same interactions produces exactly one row per evidence (guaranteed by both the
  guard and put())

### B. Dedup during stop flow
- The SW clears the persistedWindowIds Set on each initRecording
- The guard is checked before persisting each evidence row

### C. Incomplete windows
- Evidence with endReason 'displaced', 'evidence-timeout', 'max-duration', etc.
  is still valid behavioral observation and MUST be persisted
- No filtering by endReason in the persistence path

### D. Retrieval reliability
- After persistSession + persistBehavioralEvidence, getBySession returns all evidence
- Multiple sessions are isolated
- Evidence count matches interactions-with-evidence count

## Files to Change

1. `src/runtime/sw-integration.ts` — add dedup guard (Set + filter/mark/clear exports)
2. `src/background/service-worker.ts` — wire guard around persistBehavioralEvidence call
3. `tests/evidence-lifecycle.test.ts` — NEW: focused tests

`persistBehavioralEvidence` in `session-persistence-service.ts` is NOT modified —
it already uses put() by windowId (DB-level idempotency). The dedup guard is an
SW-layer defense-in-depth that prevents redundant DB writes within a recording cycle.

## Acceptance Criteria

- [ ] Calling persistBehavioralEvidence twice with same data → exactly one row per evidence
- [ ] Evidence arriving during stop flow is persisted (not lost to race)
- [ ] 'displaced' evidence is persisted
- [ ] 'evidence-timeout' evidence is persisted
- [ ] 'max-duration' evidence is persisted
- [ ] Persisted evidence survives and is retrievable by session and interaction
- [ ] Multiple sessions are isolated
- [ ] resetState/initRecording clears the dedup guard
- [ ] All existing tests pass unchanged
- [ ] TSC 0 errors

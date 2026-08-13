# M8.6 — Production Hardening and V3→V4 Migration/Regression Validation

## Overview

Final hardening pass for M8. Validates migration safety, persistence consistency,
failure handling, repository integrity, and a full M8 cross-module regression.
No production code changes expected — this is a test-only hardening increment.

## Scope

**In scope:**
- A. V3→V4 migration safety — version chain correctness, additive-only, index integrity
- B. Persistence consistency — multi-session evidence isolation, cross-session count integrity, re-record cycle cleanup
- C. Failure handling — persistBehavioralEvidence error is non-fatal to session, partial evidence persistence, malformed evidence row
- D. Repository integrity — UoW rollback isolation (session vs evidence are separate transactions), cross-table atomicity within a single UoW
- E. Full M8 regression — end-to-end: persistSession + persistBehavioralEvidence + dedup guard + retrieval + cleanup in one flow

**Out of scope:**
- Any production code changes
- Browser runtime validation (documented as pending manual check)
- M8.7 or later milestones

## Files to Change

| File | Action |
|------|--------|
| `tests/m8-production-hardening.test.ts` | **NEW** — focused hardening tests |

## Acceptance Criteria

- [ ] V3→V4 version chain: all 4 versions declared, V4 has all 9 tables
- [ ] V3→V4 migration is additive-only (V1-V3 tables unchanged in V4)
- [ ] V4 indexes are correct (windowId PK, interactionId, recordingSessionId)
- [ ] Multi-session evidence is isolated (no cross-contamination)
- [ ] Re-record cycle: new session + new evidence does not see prior guard state
- [ ] persistBehavioralEvidence failure does not affect already-persisted session
- [ ] Partial evidence persistence: if 1 of N interactions has malformed evidence, others persist
- [ ] UoW rollback: evidence transaction failure does not roll back session transaction
- [ ] Cross-table atomicity: session + evidence in same UoW commit atomically
- [ ] Full M8 regression: persistSession → persistBehavioralEvidence → dedup guard → retrieval → deleteBySession
- [ ] All existing tests pass (2,494+ tests)
- [ ] TSC 0 errors
- [ ] Build succeeds, ZIP generated

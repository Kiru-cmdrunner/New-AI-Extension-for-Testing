# Task Spec: Evidence Correlation Fix (M7-fix-001)

## Problem
Evidence permanently stuck at `⏳ Collecting behavioral evidence…` because of ID mismatch: evidence uses `eventId` (evt-*), interaction cards display `interactionId` (int-*), no mapping bridges them.

## Root Causes
- RC-1: ID mismatch — side panel compares eventId vs interactionId, never matches
- RC-2: behavioralEvidence never attached to ComponentInteraction
- RC-3: __deferredEvidence Map never initialized

## Solution
SW performs the correlation using existing `triggerEvent.eventId` field on ComponentInteraction.

## Changes Required

### 1. `src/runtime/sw-integration.ts`
- Export `attachEvidenceToInteraction(sourceEventId, evidence): string | null` — finds interaction by triggerEvent.eventId (Tier 1) or memberEvents[].eventId (Tier 2), attaches evidence (first-write-only), re-persists. Returns interactionId if matched.
- Export `drainPendingEvidence(interaction): BehavioralEvidence | null` — called from onEmit, checks pendingEvidence for evidence matching the new interaction's events.

### 2. `src/background/service-worker.ts`
- Modify `handleBehavioralEvidence`: call `attachEvidenceToInteraction`. If matched, broadcast `INTERACTION_EVIDENCE_UPDATE { interactionId, evidence }`. If not matched, evidence stays in pendingEvidence.
- Move `pendingEvidence` Map to sw-integration.ts (session state).
- Update `onEmit` in initRecording and restoreFromStorage to drain pending evidence.

### 3. `src/sidepanel/sidepanel.ts`
- Change `handleEvidenceUpdate` parameter from `eventId` to `interactionId`
- Remove `__deferredEvidence` dead code
- Update message handler to use `interactionId` from payload

### 4. `src/shared/types.ts`
- Change INTERACTION_EVIDENCE_UPDATE payload from `{ eventId }` to `{ interactionId }`

## Acceptance Criteria
- [ ] Simple click: evidence attaches to interaction card, placeholder replaced
- [ ] Typing session: evidence for input event matches via memberEvents (Tier 2)
- [ ] Navigation: evidence attaches correctly
- [ ] Multi-member interaction: trigger evidence wins (first-write-only)
- [ ] Rapid consecutive interactions: each gets own evidence
- [ ] Late evidence (after card rendered): overlay works
- [ ] Re-render after attachment: evidence persists from storage
- [ ] Unmatched evidence: does not attach to wrong interaction
- [ ] __deferredEvidence removed completely
- [ ] All 2204+ existing tests pass
- [ ] tsc 0 errors
- [ ] ZIP clean (no stale bundles)
- [ ] Real-browser: placeholder → actual evidence on real apps

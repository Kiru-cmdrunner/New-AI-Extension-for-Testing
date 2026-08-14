# M9.9 — Entity State & Lifecycle Tracking

## Goal
Understand how application entities evolve over time — e.g. employee
pending→approved, issue open→closed, PR open→merged — not merely detect them.

## Architecture Changes (all strictly additive)

### 1. PageContentSignal — carry status badges
- Add `observedStatusBadges: ObservedItem[]` to PageContentSignal
- Update `extractFromSnapshot` to include `kind: 'status-badge'` items

### 2. StateBuilder — state detection from status badges + notifications
- Add `EntityStateTracker` field
- In `processPageContent`: extract state from status-badge items, associate
  with entities (entityId on badge → single-entity fallback → unassociated)
- In notification processing: extract state transition verbs from notification text
- In `getCurrentState()`: call `stateTracker.applyToEntities()` on snapshot
- In `reset()`: call `stateTracker.clear()`

### 3. EntityTracker — preserve state during upsert
- When merging existing entity, preserve `currentState` and `stateHistory`

### 4. KnowledgeEntityRow — add state fields
- `currentState?: string`
- `stateHistory?: EntityStateChange[]`

### 5. KnowledgePersistenceService — persist state
- Include `currentState` and `stateHistory` in entity upsert

### 6. ConsolidatedEntity — add state fields
- `currentState?: string`
- `stateHistory?: EntityStateChange[]`

### 7. KnowledgeLoader — load state
- Map `currentState` and `stateHistory` in consolidateEntities

### 8. EntityStateTracker (NEW)
- `normalizeStateText(text)` — maps raw badge/toast text to canonical state
- `extractStateFromNotification(text)` — maps notification text to state
- `observe(entityId, state, changedAt, evidence)` — records transitions
- `applyToEntities(Map<string, Entity>)` — applies tracked state to snapshots

## State Association Strategy
1. Status badge with `entityId` attribute → associate with that entity
2. Single entity in state → associate with it
3. Multiple entities → store on all entities of matching type if only one type exists, else skip

## Acceptance Criteria
- [ ] EntityStateTracker detects state from badge text ("Approved" → "approved")
- [ ] State transitions recorded only on actual change (not repeated observations)
- [ ] State history is append-only and ordered
- [ ] Status badges from page content flow through PageContentSignal
- [ ] Notification text can trigger state transitions
- [ ] Entity.currentState and Entity.stateHistory populated
- [ ] KnowledgeEntityRow round-trips state fields through persistence
- [ ] ConsolidatedEntity carries state from persistence
- [ ] No Amazon regression — existing 8 entity types unchanged
- [ ] No M1–M8 files modified
- [ ] No M9.1–M9.8 behavior changed (only additive state fields)
- [ ] TSC = 0 errors
- [ ] Full test suite passes
- [ ] Focused tests: tracker, badge extraction, notification extraction,
      state association, persistence round-trip, consolidation, backward compat

## Out of Scope
- M9.10+ (extended interaction types, multi-domain config, production wiring)
- AI/LLM
- Entity relationship tracking
- Causal attribution

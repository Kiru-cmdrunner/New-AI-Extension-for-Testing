# M8.1 — Dexie V4: `behavioral_evidence` Table + Migration

## Objective

Introduce a dedicated `behavioral_evidence` table in the Dexie database.
Link evidence rows to both the interaction and the recording session.
Implement a safe V3 → V4 schema migration.
Add a full repository (interface + Dexie implementation) following the existing V2 repository pattern.

## Scope

**In scope:**
- `BehavioralEvidenceRow` type extending `BehavioralEvidence` with linking fields
- Dexie V4 schema definition (additive — new table, no data migration needed)
- `BehavioralEvidenceRepository` interface
- `DexieBehavioralEvidenceRepository` implementation
- Wiring into `RepositorySet`, `TransactionalRepositorySet`, `DexieUnitOfWork`
- Export from `v2/index.ts`
- Unit tests: schema upgrade, repository CRUD, migration safety

**Out of scope:**
- Persisting evidence at `stopRecording` time (M8.2)
- SW restart recovery (M8.3)
- Memory protection tests (M8.4)
- Any changes to the frozen M7 lifecycle architecture
- Any changes to the BehavioralEvidence type itself (the domain model is unchanged)

## Design Decisions

### Primary key: `windowId`

Each `BehavioralEvidence` already has a unique `windowId` (format `bev-{eventId}`).
This is used as the Dexie primary key instead of generating a synthetic `id`.
This gives natural idempotency: `put()` with the same `windowId` overwrites instead of duplicating.

### BehavioralEvidenceRow

Extends `BehavioralEvidence` with three indexing fields:

| Field | Type | Purpose |
|-------|------|---------|
| `interactionId` | `string` | Links to the ComponentInteraction this evidence was attached to |
| `recordingSessionId` | `string` | Links to the RecordingSession this evidence belongs to |
| `persistedAt` | `number` | Epoch timestamp for lifecycle tracking |

### Indexes

```
behavioral_evidence: 'windowId, interactionId, recordingSessionId'
```

- `windowId` (PK) — primary key, idempotent puts
- `interactionId` — query evidence by interaction
- `recordingSessionId` — query evidence by session

### Repository interface

```typescript
interface BehavioralEvidenceRepository {
  save(evidence: BehavioralEvidenceRow): Promise<BehavioralEvidenceRow>;
  getByInteraction(interactionId: string): Promise<BehavioralEvidenceRow[]>;
  getBySession(recordingSessionId: string): Promise<BehavioralEvidenceRow[]>;
  deleteBySession(recordingSessionId: string): Promise<void>;
}
```

- `save` uses `put()` semantics (idempotent by windowId)
- No `getById` — windowId is the PK and is not used for individual lookups at this layer
- `deleteBySession` for cleanup

## Files to Change

| File | Action |
|------|--------|
| `src/repository/v2/dexie/dexie-database.ts` | Add `BehavioralEvidenceRow` type, table property, V4 schema |
| `src/repository/v2/interfaces/behavioral-evidence-repository.ts` | **NEW** — repository interface |
| `src/repository/v2/dexie/dexie-behavioral-evidence-repository.ts` | **NEW** — Dexie implementation |
| `src/repository/v2/interfaces/unit-of-work.ts` | Add `behavioralEvidence` to `RepositorySet` |
| `src/repository/v2/dexie/dexie-unit-of-work.ts` | Add repo to `TransactionalRepositorySet` + transaction table list |
| `src/repository/v2/index.ts` | Export interface + row type |
| `tests/repository-v2/behavioral-evidence-repository.test.ts` | **NEW** — unit tests |

## Acceptance Criteria

- [ ] V4 schema opens with `behavioral_evidence` table
- [ ] V3 database upgrades cleanly to V4 (new table is empty, no data migration needed)
- [ ] Repository CRUD works: save, getByInteraction, getBySession, deleteBySession
- [ ] `save()` is idempotent — same windowId does not create duplicates
- [ ] Existing V1-V3 tables unchanged (schema definitions repeated identically)
- [ ] Repository is accessible via UnitOfWork: `repos.behavioralEvidence`
- [ ] UnitOfWork transaction includes `behavioral_evidence` table
- [ ] All existing tests pass (2,394+ tests)
- [ ] TSC 0 errors
- [ ] Build succeeds, ZIP generated

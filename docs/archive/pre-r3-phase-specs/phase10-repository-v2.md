# Phase 10 — Repository V2 Migration

## Objective

Migrate the runtime from the legacy chrome.storage.local RepositoryService to the existing Repository V2 (Dexie/IndexedDB), and add two new domain entities: **Capability** (accumulated cross-session understanding) and **RecordingSession** (purpose-built provenance storage replacing the generic SourceArtifact).

## Milestones

### Milestone 10.1 — Schema and Domain Model (THIS MILESTONE)
- [ ] Define `Capability` domain entity with factory functions and invariant validation
- [ ] Define `RecordingSession` domain entity with factory functions and invariant validation
- [ ] Add `CapabilityRepository` and `RecordingSessionRepository` interfaces
- [ ] Add Dexie table definitions (schema version bump to v2)
- [ ] Add `DexieCapabilityRepository` implementation
- [ ] Add `DexieRecordingSessionRepository` implementation
- [ ] Extend `RepositorySet` and `UnitOfWork` with new repositories
- [ ] Add `capabilityId` optional field to `ApprovedTestCase`
- [ ] Tests for all new types and repositories
- [ ] All existing tests still pass

### Milestone 10.2 — Capability Matching Service
- Multi-factor scored matching (entry element 35%, input fields 30%, outcome 25%, name 10%)
- Auto-merge ≥ 0.75, human review 0.50–0.75, new capability < 0.50
- Capability enrichment (additive merge, stricter constraint wins, confidence progression)

### Milestone 10.3 — Runtime Wiring
- Replace RepositoryService calls with Repository V2
- Wire UnderstandingResult persistence into RecordingSession
- Wire CapabilityCandidate → Capability matching/creation on stop recording
- Wire ExecutionIRPlan persistence into ExecutionIRArtifact
- Data migration from V1 storage to V2 Dexie tables

### Milestone 10.4 — Repository UI
- [x] Capability-centric repository page (dual-view: Capabilities + Classic Tree)
- [x] Capability cards showing name, confidence badge, purpose, stats (inputs/validations/outcomes/sessions)
- [x] Capability detail panel with sections: meta row, purpose, inputs, validation rules, observed outcomes, business rules, failure modes, enrichment history
- [x] Search filtering by capability name/purpose/project name
- [x] View tab switching (Capabilities view default, Classic Tree preserved)
- [x] Side panel repository status section (session ID, capability decision badge)
- [x] Storage listener for live repository status updates
- [x] Tests for rendering logic and data mapping

## Milestone 10.1 — Acceptance Criteria

- [ ] `Capability` entity defined with: id, projectId, name, purpose, confidence, inputs[], validationRules[], observedOutcomes[], businessRules[], failureModes[], enrichmentHistory[], sessionIds[], timestamps
- [ ] `RecordingSession` entity defined with: id, projectId, understandingResult, rawEvents[], rawInteractions[], testCaseIds[], url, recordedAt
- [ ] `createCapability()` factory with invariant validation
- [ ] `createRecordingSession()` factory with invariant validation
- [ ] `enrichCapability()` pure function for additive merge with conflict handling
- [ ] `CapabilityRepository` interface (CRUD + getByProject + getByCapabilityId)
- [ ] `RecordingSessionRepository` interface (CRUD + getByProject + getByCapabilityId)
- [ ] `DexieCapabilityRepository` implementation
- [ ] `DexieRecordingSessionRepository` implementation
- [ ] Dexie schema v2 with capabilities and recordingSessions tables
- [ ] `RepositorySet` extended with capabilities and recordingSessions
- [ ] `ApprovedTestCase` has optional `capabilityId` field
- [ ] Unit tests for all new types, factories, and repositories
- [ ] All existing 2516 tests still pass
- [ ] Build succeeds

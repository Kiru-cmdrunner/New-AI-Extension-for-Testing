# Layer 6 — Persistence / Repository / Session Storage Audit
## Baseline: deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8 (frozen worktree)
## Date: 2026-08-10

---

## Scope

Layer 6 encompasses the complete data-storage flow:
- **chrome.storage.local** — ephemeral/session keys (30+ keys)
- **Repository V1** (`RepositoryService` + `StorageService`) — flat JSON in chrome.storage.local
- **Repository V2** (Dexie/IndexedDB) — 9-table structured database with UnitOfWork
- **Session recovery** — MV3 SW restart resilience
- **Generated artifacts** — IR plans, Playwright code, execution results
- **Capability persistence** — matching, creation, enrichment
- **Data consistency** — transactional integrity, referential integrity
- **Cleanup/eviction** — storage lifecycle management

---

## File Inventory (Layer 6)

### Repository V2 — Dexie/IndexedDB
| File | LOC | Role |
|------|-----|------|
| `dexie-database.ts` | 139 | 9-table schema, 3 versioned migrations |
| `dexie-unit-of-work.ts` | 78 | Transactional UnitOfWork (rw! mode) |
| `dexie-unit-of-work-factory.ts` | 28 | Factory — creates Dexie + UoW |
| `dexie-project-repository.ts` | 55 | Project CRUD |
| `dexie-element-repository.ts` | 104 | Element CRUD + INV-EL3 ref check |
| `dexie-test-case-repository.ts` | 227 | ATC + version chain + status transitions |
| `dexie-source-artifact-repository.ts` | 47 | SourceArtifact CRUD |
| `dexie-execution-ir-repository.ts` | 49 | IR artifact save (INV-IR7 replace) |
| `dexie-capability-repository.ts` | 39 | Capability CRUD + findBySessionId |
| `dexie-recording-session-repository.ts` | 46 | RecordingSession CRUD + getByCapabilityId |
| `dexie-execution-run-repository.ts` | 42 | ExecutionRun append-only |

### Repository V2 — Interfaces
| File | LOC | Role |
|------|-----|------|
| `interfaces/unit-of-work.ts` | 66 | UoW + RepositorySet contract |
| (other interfaces) | ~300 | Per-entity repository contracts |

### Service Layer
| File | LOC | Role |
|------|-----|------|
| `session-persistence-service.ts` | 167 | Recording → Repository V2 bridge |
| `capability-matching-service.ts` | 418 | 4-factor weighted capability matching |
| `healing-service.ts` | 274 | Element locator healing (never called) |
| `element-matching-service.ts` | 283 | Cross-session element identity matching |

### Storage
| File | LOC | Role |
|------|-----|------|
| `storage-service.ts` | 319 | Single entry point for chrome.storage.local |
| `repository-service.ts` | 375 | Repository V1 CRUD (flat JSON) |

### Integration Points
| File | Lines | Role |
|------|-------|------|
| `service-worker.ts` | 339-372 | persistSession call site |
| `service-worker.ts` | 496-661 | handleRunTest: ExecutionRun persistence |
| `sw-integration.ts` | 300-507 | MV3 recovery + durability helpers |

### Domain Entities
| File | LOC | Role |
|------|-----|------|
| `recording-session.ts` | 113 | 3-tier provenance entity |
| `understanding-result.ts` | 68 | Understanding Layer aggregate output |
| `capability.ts` | 434 | Mutable accumulated capability entity |
| `execution-run.ts` | 150 | Append-only execution history |
| `element.ts` | 354 | Element with heal history |
| `staleness.ts` | 190 | IR staleness detection |

---

## Architecture: Three Storage Tiers

### Tier A — chrome.storage.local (transient/session data)
~30 keys defined in `StorageKeys` enum + runtime keys. Used for:
- UI state, recording context, session events
- Live interactions (in-progress recording)
- Runtime snapshot (MV3 recovery)
- Evidence ledger (MV3 recovery)
- Per-observation durable keys (`cmdrunner_obs_*`)
- Generated IR plan + Playwright code
- Repository V1 flat JSON (`test_repository`)
- Capability records, execution results
- Audit trail (1000-entry ring buffer)

### Tier B — Repository V1 (chrome.storage.local, key: `test_repository`)
Flat JSON: `{ projects: [{ features: [{ scenarios: [{ testCases: [...] }] }] }] }`
Managed by `RepositoryService` class. **This is the active user-facing store** — the side panel reads/writes to it exclusively. Sequential ID generation (proj-0001, feat-0001). No transaction support.

### Tier C — Repository V2 (Dexie/IndexedDB, database: `cmdrunner_repository`)
9 tables with compound indexes, 3 schema versions (V1→V2→V3). UnitOfWork transaction pattern. Stores RecordingSessions, Capabilities, ExecutionIRArtifacts, ExecutionRuns, Elements, TestCases, Projects, SourceArtifacts. **No UI consumes this directly.** Session persistence writes to it on stopRecording, but the data is invisible to the user.

### Critical structural gap: V1 ↔ V2 are disconnected
No bridge, sync, or reference connects them. A recording persisted to V2 has no corresponding entry in V1 (where the user sees their test cases). The user sees Repository V1 in the side panel; Repository V2 is a shadow database.

---

## What Works Correctly ✅

1. **Dexie schema versioning** (V1→V2→V3) — additive migrations, each repeats prior schema + adds new table. Clean upgrade path.
2. **UnitOfWork transaction pattern** — `rw!` mode across all 9 tables. Atomic create/update/delete. Rollback on exception.
3. **Dexie repository implementations** — all 8 correctly implement their interfaces. Compound indexes used for efficient queries (`[projectId+pageOrComponent]`, `[testCaseId+versionNumber]`, `[projectId+type]`).
4. **INV-EL3 referential integrity** — element deletion checks testCaseVersions for step/validation references before allowing delete. Throws `ElementReferencedError` if referenced.
5. **INV-ATC1 atomic creation** — ATC identity + version 1 created in single transaction.
6. **INV-ATCV2 monotonic versions** — `createVersion` computes `maxVersion + 1` from existing versions.
7. **Capability matching algorithm** — 4-factor weighted scoring (entryElement 35%, input 30%, outcome 25%, name 10%). Auto-merge ≥0.75, ambiguous ≥0.50, new <0.50. Well-tested with 25 tests.
8. **Element matching service** — weighted identity signature (accessibleName 30%, role/tag 25%, ancestorChain 25%, businessIds 15%, pageScope 5%). Greedy 1:1 matching. Ignores fragile locators (CSS, XPath).
9. **Healing additive merge** — healElement preserves old strategies in HealEvent, appends new ones. Status transitions (STALE→ACTIVE, BROKEN→ACTIVE). Clean design.
10. **Staleness detection** — element.updatedAt vs artifact.generatedAt timestamp comparison. O(k) where k = referenced elements.
11. **Evidence Ledger durability** — persisted on every disposition change. MV3 recovery restores ledger and calls `resetAbsorbedToUnclaimed`.
12. **Safe Point system** — Safe Point 1 (post-emit), Safe Point 2 (recovery), Safe Point 3 (session-end sweep) for durable observation key lifecycle.
13. **Audit trail ring buffer** — 1000-entry cap, oldest evicted. Never throws.
14. **ExecutionRun append-only** — `save()` always adds, never updates. Execution history is immutable.
15. **createRecordingSession invariant validation** — throws MissingFieldError for missing projectId or understandingResult.

---

## Technical Debt

### CRITICAL

#### 6-C-1: persistSession receives capability:null — entire capability persistence path is dead code
- **File**: `service-worker.ts:356-357`
- **Code**: `understanding: { sessionId, generatedAt, schemaVersion: 1, fragment: null, capability: null }`
- **Impact**: The UnderstandingResult passed to persistSession always has `capability: null`. The entire capability matching/creation/enrichment block (session-persistence-service.ts lines 106-143) never executes. The 418-LOC capability-matching-service, the Capability entity, the DexieCapabilityRepository — all are tested infrastructure that never runs in production. `capabilityDecision` is always `'none'`, `capabilityId` is always `null`.
- **Root cause**: AI Understanding Layer was never implemented. No system produces a CapabilityCandidate from recording data.
- **Also**: `fragment: null` — the ApplicationKnowledgeFragment is also never produced. The entire UnderstandingResult is a shell.
- **Blocks**: Capability accumulation, cross-session learning, capability-driven test generation.

#### 6-C-2: persistSession receives events:[] — archival tier permanently empty
- **File**: `service-worker.ts:358`
- **Code**: `events: []`
- **Impact**: RecordingSession.rawEvents is always []. The 3-tier data lifecycle design (Canonical/Operational/Archival) has Tier 3 (Archival) permanently empty. rawInteractions IS passed (line 359: `productionInteractions`), but raw events from the recording session are lost forever on stopRecording.
- **Blocks**: Session replay, re-derivation of understanding, debugging from stored sessions.
- **Note**: The content script's sessionStorage buffers (events + behavioral) are cleared on STOP_RECORDING. This is the last chance to capture them, and it's missed.

#### 6-C-3: MV3 recovery does not restore recordingStartUrl / recordingStartTitle
- **File**: `service-worker.ts:50-51` (module-level vars), `service-worker.ts:55-59` (ensureSessionRestored)
- **Code**: `let recordingStartUrl = ''; let recordingStartTitle = '';`
- **Impact**: On SW restart, `restoreFromStorage()` recovers liveInteractions, evidenceLedger, and runtime snapshot — but NOT recordingStartUrl/Title. When `handleStopRecording` runs post-restart, it falls back to `tab?.url` (line 319), which may be a completely different page from where recording started. The IR plan's `environment.baseUrl` is then wrong.
- **Blocks**: Correct test generation after any SW restart during recording (which is common in MV3 — SW can restart every 30 seconds).
- **Fix needed**: Persist recordingStartUrl/Title to chrome.storage.local in handleStartRecording, restore in ensureSessionRestored.

#### 6-C-4: No eviction or data lifecycle management for Repository V2
- **File**: All Dexie repositories
- **Impact**: IndexedDB grows unbounded. No session count limit, no age-based eviction, no project-level cleanup. Each RecordingSession stores rawInteractions + understandingResult + linked ExecutionIRArtifact. Over time (dozens/hundreds of recording sessions), the database will approach IndexedDB quotas (typically 10-50% of disk space) with no recovery path.
- **Evidence**: No `evict`, `prune`, `retention`, `maxSessions`, `deleteOld` in any repository file. The only eviction in the entire codebase is the audit trail ring buffer (1000 entries).
- **Blocks**: Long-term use of the extension without manual database clearing.
- **Estimated growth**: 250KB-2.5MB per session (rawInteractions array + UnderstandingResult + IR plan + generated code).

#### 6-C-5: getByCapabilityId is broken — returns ALL sessions with any capability, ignores the parameter
- **File**: `dexie-recording-session-repository.ts:31-45`
- **Code**: The `_capabilityId` parameter is prefixed with underscore (unused). The method calls `this.sessions.toArray()` (full table scan) and filters `s.understandingResult?.capability !== null && !== undefined`. This returns ALL sessions that have ANY capability — not sessions matching the specific capabilityId.
- **Impact**: Any consumer calling getByCapabilityId(capId) gets wrong results. Currently moot because capability is always null (6-C-1), but the method is structurally broken regardless.
- **Also**: O(n) full-table scan with no index. For a project with 100 sessions, all 100 are loaded into memory.

#### 6-C-6: Two parallel repositories (V1 + V2) with no bridge
- **Files**: `repository-service.ts` (V1), `session-persistence-service.ts` (V2)
- **Impact**: Repository V1 (`test_repository` in chrome.storage.local) is what the side panel reads/writes — the user-facing store. Repository V2 (Dexie/IndexedDB) stores recording sessions, capabilities, IR artifacts — invisible to the user. No data flows between them. A test case created in V1 has no link to the recording session in V2. A recording session in V2 has no corresponding test case in V1.
- **Evidence**: `getRepository()`/`setRepository()` (V1) called only by `RepositoryService` and `sidepanel.ts`. `persistSession()` (V2) called only by `service-worker.ts`. Zero cross-references.
- **Blocks**: Unified data model. The user can't see or manage their recording sessions. The structured Repository V2 data model is a shadow system.

---

### HIGH

#### 6-H-1: DexieUnitOfWorkFactory creates a new Dexie database instance per factory construction
- **File**: `dexie-unit-of-work-factory.ts:17`
- **Code**: `this.db = createDatabase()` in constructor
- **Impact**: The service worker creates `new DexieUnitOfWorkFactory()` on every `handleStopRecording` (line 349) and every `handleRunTest` (lines 519, 622). Each creates a new `CmdRunnerDatabase` JS object wrapping the same IndexedDB. While Dexie/IndexedDB handles concurrent connections, multiple JS database objects waste memory and can cause transaction contention.
- **Severity**: HIGH — resource leak, potential transaction conflicts under rapid stop/run sequences.

#### 6-H-2: findReferencingVersions / findVersionsReferencingElement — O(all versions) full table scan
- **Files**: `dexie-element-repository.ts:83-103`, `dexie-test-case-repository.ts:198-216`
- **Code**: `this.testCaseVersions.toArray()` then `.some()` over every version's steps
- **Impact**: Element deletion reference checks and element-referencing version queries load ALL test case versions into memory and scan every step of every version. For a project with 50 test cases × 5 versions × 20 steps = 5000 steps scanned per delete check. No index on `steps.elementId`.
- **Comment acknowledges**: "This is an O(n) scan over versions, acceptable for V1 scale."
- **Severity**: HIGH — scales poorly; blocks responsive element management in real test suites.

#### 6-H-3: Orphaned cmdrunner_obs_* keys accumulate to crash
- **File**: `sw-integration.ts:456-467`
- **Impact**: `cleanupAllObsKeys()` is fire-and-forget with `.catch(() => {})`. If the cleanup promise is dropped (SW termination, storage error), observation keys persist indefinitely. Each key stores a full ObservationResult object. The prior audit (Layer 1, 1B-H-2) documented this causing a 143MB accumulation over 3 hours.
- **Severity**: HIGH — known crash vector, documented in prior crash reports.

#### 6-H-4: healing-service.ts is never called in production
- **File**: `healing-service.ts` (274 LOC), `heal-element-and-persist.test.ts` (11 tests), `healing-service.test.ts` (11 tests), `runtime-healing-integration.test.ts` (22 tests)
- **Impact**: `healFromRecording()` and `healElementAndPersist()` have no call site in service-worker.ts, sw-integration.ts, or any production code path. The entire healing infrastructure (44 tests, 274 LOC + supporting code) is infrastructure-ready for Phase 11/12 but not wired into the recording pipeline.
- **Evidence**: `grep -r 'healFromRecording\|healElementAndPersist' src/` returns zero hits outside test files.
- **Severity**: HIGH — 500+ LOC of dead infrastructure with passing tests that verify nothing about production behavior.

#### 6-H-5: No project cascade delete implementation
- **File**: `dexie-project-repository.ts:46-54`
- **Comment**: "The cascade is handled at the UnitOfWork level — we just delete the project here."
- **Impact**: No service-layer code implements cascade deletion. Deleting a project leaves orphaned elements, test cases, versions, capabilities, sessions, and IR artifacts. The comment defers responsibility to a caller that doesn't exist.
- **Severity**: HIGH — referential integrity violation on project deletion.

#### 6-H-6: ExecutionRun.action and description are always empty strings
- **File**: `execution-run.ts:112-115`
- **Code**: `action: '', description: ''` with comment "Populated by caller from the IR plan"
- **Impact**: No caller populates these fields. ExecutionRun records contain step results with no indication of what action was performed. Execution history is unqueryable by action type — you can see a step passed/failed but not whether it was a click, fill, or navigate.
- **Severity**: HIGH — severely limits the usefulness of persisted execution history.

#### 6-H-7: healedElementIds always empty in persisted ExecutionRun
- **File**: `service-worker.ts:619`
- **Code**: `healedElementIds: []`
- **Impact**: The executor's healing is internal; the counter `healedCount` (line 573) is never populated (the `onStepComplete` callback body at lines 576-580 is empty). Execution runs record no healing information despite the schema supporting it. You cannot determine from persisted data whether any elements were healed during a run.
- **Severity**: HIGH — healing telemetry lost.

#### 6-H-8: Repository V1 test_repository accumulates indefinitely in chrome.storage.local
- **File**: `repository-service.ts`, `storage-service.ts:298-299`
- **Impact**: RepositoryService operates on a single flat JSON blob. V1 repository accumulates all projects/features/scenarios/tests forever with no eviction, no session scoping, no cleanup. While `unlimitedStorage` permission is requested, chrome.storage.local still has practical limits. The side panel reads from V1, so it's the active store — this isn't legacy dead data.
- **Severity**: HIGH — unbounded growth in the user-facing data store.

---

### MEDIUM

#### 6-M-1: Evidence Ledger persisted on every single disposition change
- **File**: `sw-integration.ts:262-264`
- **Code**: `persistEvidenceLedger()` called in `processObservedEvent` after every event
- **Impact**: The entire ledger snapshot is serialized and written to chrome.storage.local on EVERY event. For a session with 500+ events, this is 500+ full-ledger writes. The ledger grows monotonically (append-only), so each write is larger than the last.
- **Severity**: MEDIUM — I/O amplification under active recording.

#### 6-M-2: Runtime snapshot persisted on every interaction emission
- **File**: `sw-integration.ts:267-269`
- **Impact**: `persistRuntimeSnapshot()` writes the full runtime state (seenEventIds, active stack, counters) on every emit. Similar amplification to 6-M-1.
- **Severity**: MEDIUM.

#### 6-M-3: No concurrent write protection for Repository V1
- **File**: `repository-service.ts` (all methods use read-modify-write pattern)
- **Impact**: Every V1 operation reads the entire `test_repository` blob, modifies it, and writes it back. If two async operations overlap (possible with rapid user actions in the side panel), last-write-wins silently drops data. No optimistic concurrency control.
- **Severity**: MEDIUM — data loss under concurrent side panel operations.

#### 6-M-4: No schema version on RecordingSession or ExecutionRun entities
- **File**: `recording-session.ts`, `execution-run.ts`
- **Impact**: Entities stored as-is in Dexie. If entity shape changes (add/remove fields), old rows deserialize with missing fields. Only the Dexie database index schema is versioned (V1/V2/V3), not the entity payloads themselves. No migration path for entity schema evolution.
- **Severity**: MEDIUM — forward compatibility risk.

#### 6-M-5: Staleness check is advisory-only — stale IR is still executed
- **File**: `service-worker.ts:514-566`
- **Impact**: Even when staleness IS detected (`irWasStale = true`), execution proceeds with the stale IR (line 560: "proceed with the stale IR"). The only action is a `console.warn`. No regeneration, no user notification, no blocking.
- **Severity**: MEDIUM — stale tests execute without warning.

#### 6-M-6: Generated Playwright files stored in chrome.storage.local
- **File**: `service-worker.ts:334` — `StorageService.setRaw(StorageKeys.GENERATED_FILES, result)`
- **Impact**: The full generated Playwright project (potentially multiple .spec.ts files + config files) is stored as a single blob in chrome.storage.local. For large test suites, this is significant string data.
- **Severity**: MEDIUM.

#### 6-M-7: Session ID uses Date.now() — not a UUID
- **File**: `service-worker.ts:353`
- **Code**: `sessionId: 'session-${Date.now()}'`
- **Impact**: Two sessions stopped in the same millisecond would produce the same session ID. Low probability but technically possible. All other IDs in the system use `crypto.randomUUID()`.
- **Severity**: MEDIUM — potential ID collision.

#### 6-M-8: DexieExecutionIRRepository.save() deletes-then-adds within same transaction
- **File**: `dexie-execution-ir-repository.ts:27-33`
- **Impact**: INV-IR7 pattern deletes existing artifacts for the same testCaseVersionId before adding the new one. Safe within a transaction, but means prior IR generations are fully removed — no history of IR evolution. The staleness module's `detectLocatorChanges()` function compares old vs new plans, but the old artifact is already deleted by the time it could be compared.
- **Severity**: MEDIUM — loss of IR generation history.

---

### LOW

#### 6-L-1: DB_NAME hardcoded as 'cmdrunner_repository'
- **File**: `dexie-database.ts:22`
- **Impact**: Not configurable, no environment prefix. Multiple extension instances share the same IndexedDB.
- **Severity**: LOW.

#### 6-L-2: IR artifact testCaseVersionId temporarily set to session.id
- **File**: `session-persistence-service.ts:152`
- **Code**: `testCaseVersionId: session.id` with comment "Temporary — linked to session for now"
- **Impact**: If a test case version is later created, the IR artifact's testCaseVersionId is never updated. The link between IR and test case version is permanently broken.
- **Severity**: LOW — moot until test case creation from sessions is implemented.

#### 6-L-3: Repository V1 ID generation uses in-memory counter that resets on SW restart
- **File**: `repository-service.ts:24-31`
- **Impact**: ID counter is a `Map<string, number>` in module scope. On SW restart, it resets to 0. Sequential IDs (proj-0001) may collide with existing entries created before the restart.
- **Severity**: LOW — potential duplicate IDs on restart.

#### 6-L-4: Audit trail ring buffer slice creates new array on every eviction
- **File**: `audit-manager.ts:87`
- **Code**: `trailCache = trailCache.slice(-MAX_ENTRIES)`
- **Impact**: Creates a new 1000-element array on every eviction. Minor GC pressure.
- **Severity**: LOW.

#### 6-L-5: RecordingSession.duration is always null
- **File**: `session-persistence-service.ts` (createRecordingSession called without duration)
- **Impact**: Duration is never recorded. The field exists in the entity schema but is always null in persisted data.
- **Severity**: LOW.

---

## Missing Capabilities

1. **No data export/import** — no way to export sessions, capabilities, or test cases
2. **No session deletion** — RecordingSessions accumulate forever
3. **No project cascade delete** — deleting a project orphans all child entities
4. **No cross-session element reconciliation** — healing-service exists but is never called
5. **No capability confidence decay** — confidence only increases, never ages
6. **No IR regeneration from stored sessions** — stale IR is detected but not regenerated
7. **No test case creation from recording sessions** — V2 sessions never become V1 test cases
8. **No Repository V2 → V1 sync** — the two stores are permanently disconnected
9. **No storage quota monitoring** — no `getBytesInUse` checks, no warnings before quota
10. **No entity schema migration** — entity shapes can't evolve without breaking old data

---

## Integration Gaps

| Gap | Impact |
|-----|--------|
| persistSession receives capability:null | Capability matching/creation/enrichment dead code |
| persistSession receives events:[] | Archival tier permanently empty |
| RecordingStartUrl/Title not restored on SW restart | Wrong baseUrl in generated tests |
| healing-service never called | Locator healing infrastructure unused |
| Repository V1 ↔ V2 disconnected | User can't see V2 data; V1 is stale |
| ExecutionRun action/description empty | Execution history unqueryable |
| healedElementIds always [] | Healing telemetry lost |
| Stale IR executed without warning | Tests may fail silently from stale locators |

---

## Test Coverage

### Existing Tests (220 tests across 14 files)

| File | Tests | Coverage |
|------|-------|----------|
| session-persistence-service.test.ts | 16 | Atomicity, capability matching, default project, null capability |
| capability-matching-service.test.ts | 25 | 4-factor scoring, thresholds, edge cases |
| healing-service.test.ts | 11 | healFromRecording, detectLocatorChanges |
| heal-element-and-persist.test.ts | 11 | Source-agnostic core |
| element-matching-service.test.ts | 18 | Identity signature, greedy matching |
| repository-service.test.ts | 42 | V1 CRUD, hierarchy, ID generation |
| runtime-healing-integration.test.ts | 22 | Integration healing scenarios |
| repository-ui/repository-ui.test.ts | 20 | UI interactions |
| repository-v2/e2e-workflow-validation.test.ts | 1 | Full workflow |
| repository-v2/element-repository.test.ts | 11 | CRUD + INV-EL3 |
| repository-v2/execution-ir-repository.test.ts | 8 | Save + INV-IR7 |
| repository-v2/project-repository.test.ts | 7 | CRUD |
| repository-v2/test-case-repository.test.ts | 23 | ATC + versioning + status |
| repository-v2/unit-of-work.test.ts | 5 | Transaction atomicity |

### Test Gaps

1. **No test for persistSession with the actual production input** (capability:null, events:[]) — all tests use synthetic UnderstandingResult with populated capability
2. **No test for MV3 recovery losing recordingStartUrl/Title**
3. **No test for DexieUnitOfWorkFactory database instance lifecycle** (multiple constructions)
4. **No test for getByCapabilityId correctness** (the _capabilityId parameter is ignored)
5. **No test for storage quota exhaustion** or graceful degradation
6. **No test for project cascade delete** (because it doesn't exist)
7. **No test for orphaned obs key accumulation** over multiple SW restarts
8. **No test for EvidenceLedger persistence performance** under high event volume
9. **No integration test**: recording → persistSession → retrieve from Dexie → verify data
10. **No test for Repository V1 + V2 data divergence** (they can hold contradictory data)
11. **No test for concurrent Repository V1 writes** (read-modify-write race)
12. **No test for ExecutionRun with populated action/description/healedElementIds** (because they're always empty)

---

## Real-Browser Validation Needs

1. **chrome.storage.local quota behavior** — what happens when `unlimitedStorage` is present but IndexedDB or chrome.storage.local hits disk limits? Does the write silently fail or throw?
2. **Dexie/IndexedDB transaction behavior during SW termination** — if the SW is killed mid-transaction, does IndexedDB roll back automatically? Dexie's `rw!` mode should handle this, but needs real Chrome validation.
3. **MV3 recovery completeness** — does `restoreFromStorage()` actually restore ALL state needed to continue recording after an SW restart? The recordingStartUrl/Title gap (6-C-3) suggests not.
4. **chrome.storage.local write performance** — persistLiveInteractions + persistEvidenceLedger + persistRuntimeSnapshot fire on every event. Real Chrome performance under rapid user interaction (e.g., typing in a form field) needs measurement.
5. **IndexedDB quota limits** — what is the practical limit for `cmdrunner_repository`? When does Chrome start refusing writes? How does this interact with `unlimitedStorage`?

---

## Data Flow Summary (Recording → Persistence)

```
Content Script                    Service Worker                    Repository V2 (Dexie)
┌─────────────┐                  ┌──────────────────┐              ┌────────────────────┐
│ EventTap    │──sessionStorage──>│ processObserved  │              │                    │
│             │  (events buffer)  │  Event           │              │ (no write here)    │
│             │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ EvidenceLedger   │              │                    │
│             │                  │ .append()        │              │                    │
│             │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ ComponentRuntime │              │                    │
│             │                  │ .process()       │              │                    │
│             │                  │     │            │              │                    │
│             │                  │     ▼ (on emit)  │              │                    │
│             │                  │ enrichInteraction│              │                    │
│             │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ persistLiveInteractions ──chrome.storage.local──>   │
│             │                  │ persistEvidenceLedger  ──chrome.storage.local──>   │
│             │                  │ persistRuntimeSnapshot──chrome.storage.local──>   │
│             │                  │                  │              │                    │
│  STOP       │<──STOP_RECORDING─│ handleStopRecording              │                    │
│  RECORDING  │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ normalizeWorkflow│              │                    │
│             │                  │ filterProduction │              │                    │
│             │                  │ capabilityInfer  │              │                    │
│             │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ buildIRPlan      │              │                    │
│             │                  │ generateCode     │              │                    │
│             │                  │     │            │              │                    │
│             │                  │     ▼            │              │                    │
│             │                  │ persistSession(  │              │                    │
│             │                  │   understanding: {│             │                    │
│             │                  │     capability: null, ← DEAD   │ │ RecordingSession  │
│             │                  │     fragment: null},← DEAD     │ │ +IRArtifact       │
│             │                  │   events: [],  ← EMPTY         │ │ (NO Capability)   │
│             │                  │   interactions: [...])──────────>│                    │
│             │                  │                  │              └────────────────────┘
│             │                  │     │            │
│             │                  │     ▼            │      Repository V1 (chrome.storage.local)
│             │                  │ (V1 NOT updated) │      ┌────────────────────┐
│             │                  │                  │      │ test_repository    │
└─────────────┘                  └──────────────────┘      │ (side panel reads) │
                                                           └────────────────────┘
```

**Key observation**: The entire capability matching, enrichment, and cross-session learning infrastructure is wired up and tested — but the input that drives it (`understanding.capability`) is hardcoded to `null`. This is the single largest gap in the persistence layer.

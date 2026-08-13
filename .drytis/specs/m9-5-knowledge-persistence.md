# M9.5 — Application Knowledge Persistence (Dexie V5)

## Objective
Persist the application understanding produced by M9.1–M9.4 so knowledge
accumulates across recording sessions instead of being discarded.

## Self-Review Summary (schema + migration strategy)

**Separate database, not V5 of the main DB.** Application Knowledge is a
different layer from Behavioral Evidence (frozen M1–M8). Adding 7 new tables
to the frozen `cmdrunner_repository` DB would violate the freeze and risk
breaking V1→V4 migration chains on upgrade. Instead: a NEW database
`cmdrunner_knowledge` with its own V1 schema (7 tables). The main DB is
untouched; M8 persistence keeps working unchanged. Cross-layer linking is
by ID reference only (projectId, recordingSessionId, interactionId) — no
foreign-key enforcement across DBs, no coupling to interaction internals.

**Accumulate vs replace.** Knowledge rows use natural business keys
(appOrigin+entityId, appOrigin+viewId, etc.) with merge-on-write:
- Entities: upsert, attribute merge (new overwrites old), revision++
- Counters: append value to history (bounded ring buffer, max 100 values)
- Notifications: append-only events (dedup by hash of text+path+appearedAt)
- Views/view-transitions: upsert + increment visitCount
- Outcomes: immutable per (session, interaction) — recompute overwrites
- State transitions: append per interaction, bounded per session (500)

**Linking without tight coupling.** Rows carry soft references:
projectId, recordingSessionId, interactionId — stored as indexed fields,
never resolved to embedded raw evidence. Evidence stays in the main DB.

## Tables (cmdrunner_knowledge, V1)

| Table | Primary key | Indexes | Growth |
|---|---|---|---|
| applications | appId | origin | one per site |
| knowledgeEntities | appId+entityId | appId, [appId+type], lastSeenAt | merge/upsert |
| knowledgeViews | appId+viewId | appId, [appId+lastSeenAt] | upsert + visitCount |
| knowledgeViewTransitions | appId+fromViewId+toViewId | appId, lastSeenAt | count++ |
| knowledgeCollections | appId+collectionId | appId, [appId+entityType] | merge counts |
| knowledgeCounters | appId+counterId | appId | append history (≤100) |
| knowledgeNotifications | appId+hash | appId, [appId+severity] | append (≤500/app) |
| knowledgeOutcomes | sessionId+interactionId | appId, [appId+outcome] | recompute |
| knowledgeStateTransitions | sessionId+interactionId | appId, sessionId | append (≤500/session) |

## Bounded growth + cleanup
- Counter history: keep last 100 values per counter
- Notifications: cap 500 per app (LRU by appearedAt)
- State transitions: cap 500 per session
- deleteBySession() removes outcomes/transitions; knowledge (entities/views/
  counters) SURVIVES session deletion — it's accumulated learning
- deleteByApp() full teardown for a site

## Idempotency + versioning
- Entity upsert: same key → merge attributes, revision++, lastSeenAt=now
- Outcome put by (sessionId+interactionId): recompute replaces
- Migration: only V1 (new DB), no upgrade path needed yet
- Stale knowledge: entities carry lastSeenAt (epoch ms); consumers may
  filter by recency; no automatic deletion (learning is durable)

## Files
- src/understanding/persistence/knowledge-types.ts
- src/understanding/persistence/knowledge-database.ts
- src/understanding/persistence/knowledge-repository.ts
- src/understanding/persistence/knowledge-persistence-service.ts
- tests/understanding/knowledge-persistence.test.ts

## Acceptance Criteria
- [ ] Separate DB `cmdrunner_knowledge` — main DB untouched, M8 intact
- [ ] V1 schema with 9 tables, correct indexes
- [ ] Entity upsert merges attributes + bumps revision
- [ ] Counter append bounded at 100 values
- [ ] Notification dedup by hash + 500/app cap
- [ ] Outcomes idempotent by (sessionId+interactionId)
- [ ] State transitions bounded at 500/session
- [ ] Cross-session accumulation verified (session 2 builds on session 1)
- [ ] deleteBySession preserves accumulated knowledge
- [ ] deleteByApp removes everything for a site
- [ ] No M1–M8 files modified

# CP6 — Application Knowledge Repository (Spec)

**Status:** Approved for implementation 2026-08-16 17:23 UTC. Implementation per
approved architecture A–D + design-review deltas R1–R9. This spec is the
implementation contract; reviewer and tester read it.

**Predecessors:** CP1–CP5 committed at `63cf4bc` (real-Chrome acceptance PASS).

---

## 1. Objective

Turn the per-session `AppBehaviorModel` (CP1–CP5) into the durable
**Application Knowledge Repository**: two strata in the `cmdrunner_knowledge`
Dexie database (additive `version(3)`):

- **Stratum 1 — session-scoped observation facts** (append-only, FIFO-bounded,
  evictable): session manifests, episodes, edges, gaps. What actually happened,
  with full causal provenance. Never mutated, only superseded.
- **Stratum 2 — cross-session generalized knowledge**: action signatures —
  "app X + actionType + normalizedTarget + anchorView → recurring consequence
  profile" — with occurrence counts, recurrence confidence, staleness, and
  divergence flags. This is the knowledge, not a dump.

Governing law (persistence twin): **"Knowledge is generalized at merge time;
evidence is never generalized, only referenced."**

## 2. Guardrails (from approval)

- Knowledge Repository, not a behavior-model dump. Two strata preserved.
- All 5 Dexie v3 stores.
- **R1**: `behaviorModel` passed ONLY on the Stage 5 `persist()` call; Stage 7
  unchanged. Manifest idempotency guard makes accidental double-pass a no-op.
- `seq` assigned INSIDE the write transaction (max+1 over `[appId+seq]`).
- NO new `Date.now()` in persistence/merge path; timestamps come from session
  `generatedAtMs`.
- Evidence provenance preserved: `refJson` verbatim; `from.episodeId` vs
  `from.interactionId` stored as distinct fields.
- Cascade cleanup + explicit evidence-sample degradation after eviction.
- Identity grammar frozen at v1.
- CP1–CP5 untouched. No connectors / Playwright / API-DB execution / agents /
  RAG / UI / capability-or-intent persistence.
- No commit/push until CP6 approved.

## 3. Files

**New (2):**
- `src/understanding/persistence/behavior-knowledge-mapper.ts` — pure model→rows
- `src/understanding/persistence/behavior-knowledge-merge.ts` — pure merge/status

**Modified (additive only):**
- `knowledge-types.ts` (+6 row types + constants)
- `knowledge-database.ts` (v3 stores)
- `knowledge-repository.ts` (+CRUD/query/cascade/evict/sweep)
- `knowledge-persistence-service.ts` (+`behaviorModel` input, step 11)
- `knowledge-loader.ts` (+`loadBehaviorKnowledge`)
- `understanding-pipeline.ts` (Stage 5 call +1 field)
- Tests: 2 new suites + 2 additive extensions

## 3b. Pure modules

### behavior-knowledge-mapper.ts

```
mapBehaviorModel({ appId, sessionId, model, transitions }): {
  session: KnowledgeBehaviorSessionRow,
  episodes: KnowledgeEpisodeRow[],
  edges: KnowledgeEdgeRow[],
  gaps: KnowledgeGapRow[],
  signatureInputs: SignatureMergeInput[]
}
```

- Pure: no clock, no randomness, no I/O, never mutates `model`.
- Signature identity: `hash(appId|actionType|normalizedTarget|anchorViewId)`;
  normalization = lowercase/trim/collapse-whitespace. FROZEN v1.
- Consequence identity: `tier|kind|targetIdentity` where `targetIdentity`:
  api → `METHOD path`; entity → `type:op`; nav → `to:<view-or-url>`; state →
  `from→to`; ui → role (anchor-window/post-anchor) — generalization grammar,
  never literal DOM. observedVia from edge detail/source.
- All arrays sorted deterministically (episode = CER-5 order from model;
  edges = emission order; signatures sorted by key).
- `anchorViewId` = the anchor's transition `before.currentView.id` (else null).
  Episodes with null tabId group under `null` scope (warning already in model).

### behavior-knowledge-merge.ts

```
mergeSignature(existing | null, input: SignatureMergeInput, ctx: {sessionSeq, prevSignatureSessionsSinceSeen?}): KnowledgeActionSignatureRow
recomputeStatusFlags(allSignatureRows, currentSessionSeq): KnowledgeActionSignatureRow[]  // stale/diverged transitions
```

- Pure, clock-free. Arithmetic: occurrenceCount++ / hitCount++ per session;
  firstSeen/lastSeen from manifest generatedAtMs; sessionsSinceSeen
  recompute = currentSessionSeq − lastSeenSeq (stored on row).
- Evidence ring: last 5 distinct sessions (dedup by sessionId).
- Bounds: MAX_CONSEQUENCES_PER_SIGNATURE=48 top-N by occurrenceCount then
  currently-observed first; evidence ring 5.
- Stale: sessionsSinceSeen > 10 while signature observed → `status: 'stale'`
  on consequences; signature row divergenceFlags recomputed.
- Divergence: recurring consequence absent for 3 consecutive observed sessions
  → 'diverged'. Flag-only, never auto-delete.

## 4. Stores (Dexie v3)

```
knowledgeBehaviorSessions: 'key, appId, [appId+seq]'
knowledgeEpisodes: 'key, appId, [appId+sessionId], [appId+signatureKey]'
knowledgeEdges: 'key, appId, [appId+sessionId], [appId+tier], [appId+signatureKey]'
knowledgeGaps: 'key, appId, [appId+sessionId], [appId+reason]'
knowledgeSignatures: 'key, appId, [appId+actionType], [appId+status], lastSeenAtSession'
```

Note: `[appId+reason]` on gaps supports the gap-summary query path.
`[appId+status]` on signatures supports status filtering by consumers.

## 4b. Full row types

See `knowledge-types.ts` additions. Key fields: session manifest carries
`viewSetHash`/`signatureSetHash` for behaviorVersion derivation; episode rows
carry `signatureKey` back-reference; edge rows carry `refJson` (EvidenceRef[]
verbatim, JSON), `from.episodeId`+`from.interactionId` distinct; gap rows carry
`windowRefJson`.

## 5. Write path (step 11, LAST in persist(), isolated)

```
db.transaction('rw', [5 stores], async () => {
  1. get(manifest key) → exists ⇒ RETURN           // session idempotency
  2. seq = ([appId+seq].last()?.seq ?? 0) + 1      // inside tx
  5. put(session manifest)
  6. bulkPut(episodes, edges, gaps)                 // stratum 1
  11. load touched signatures → mergeSignature → recomputeStatusFlags → put
  12. FIFO evict(appId, 50) with cascade
})
```

Failure isolation: own try/catch in service `persist()` step 11 → warning
`behavior-knowledge-persist: <msg>`; steps 1–10 unaffected.

## 5b. Read path

`KnowledgeLoader.loadBehaviorKnowledge(appId): BehaviorKnowledge | null` —
read-only join: recent sessions (behaviorVersion from signatureSetHash
changes), merged signatures with profiles/confidence/status/divergence, gap
summary, workflow links. Deterministic ordering. Evidence-sample existence
check → explicit 'session-evicted' degradation.

##  read path helper shapes

`BehaviorKnowledge`:

```
{
  appId, currentSeq, behaviorVersion,
  sessions: [{ sessionId, seq, generatedAtMs, episodeCount, edgeCount, gapCount, coverage, viewSetHash, signatureSetHash }],
  signatures: [{
    key, actionType, normalizedTarget, anchorViewId, occurrenceCount,
    lastSeenAtSession, confidence: KnowledgeConfidence, status,
    divergenceFlags: string[], consequences: [{
      identity, tier, kind, targetIdentity, occurrenceCount, hitCount,
      confidence, status, evidenceSamples: [{sessionId, edgeKey, evicted}]
    }]
  }],
  gapSummary: [{ reason, count, sampleWindowIds }]
}
```

## 6. Tests (acceptance criteria → tests)

Per approved D, the suite must prove: additive v3 migration over seeded v2;
mapper determinism/purity/normalization/identity stability; session
idempotency (re-persist = no-op); two-session merge (one signature,
occurrenceCount=2, merged profile, both evidence samples); identity
generalization; stale (>10) and divergence (3-absent) transitions; FIFO
eviction cascade with signature survival + explicit sample degradation;
deleteBySession/deleteByApp cascade; orphan sweep; Stage 5 pass-through +
isolation; read-model determinism + behaviorVersion.

## 7. Verification gates

- `tsc --noEmit` 0 errors
- CP6 suites green; behavior-model suites untouched-green; knowledge
  persistence/consolidation/wiring suites untouched-green
- Full suite green (baseline 170 files / 3,939? — recheck at run time; must be
  ≥ previous count and zero failures)
- `git status` exactly the designed file set; no CP1–CP5 file modified;
  schemaVersion remains 2

## 7b. Out of scope (restated)

Connectors (Jira/DB/API), Playwright generation, API/DB test execution,
agent/assistant runtime, RAG, UI, capability/intent persistence, pruning,
cross-app reasoning, export/import.

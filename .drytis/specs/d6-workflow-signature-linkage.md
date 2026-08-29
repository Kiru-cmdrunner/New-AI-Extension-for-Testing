# D6 — Workflow ↔ Signature Linkage (spec)

Source of truth: `.drytis/notes/HANDOVER-2026-08-17-D6-NEXT.md` §6. This spec
distills it into acceptance criteria for review. **D6 ONLY — no other pending
issue. No commit/push without user approval.**

## Goal

Link each recorded workflow instance to the behavior signatures that realized
it — pure observation (same app, same session, anchor interaction inside the
instance's step set), no invented semantics, no identity/migration change.

## Root cause

`RecordedWorkflow.instances` holds workflow ids; nothing connects an instance
to `knowledgeBehaviorSignatures` rows whose episode anchors occurred during
that instance's span. CP8 `workflowPatternIds` is `[]` with
`workflowPatternAbsence: 'linkage-pending'` (contract-queries.ts:203–204).

## Changes (minimal, additive)

1. `src/understanding/enrichment/semantic-types.ts` — `RecordedWorkflow` gains
   OPTIONAL `signatureIds?: string[]`, `linkageState?: 'linked' | 'linkage-pending'`,
   `instanceSignatureIds?: Record<string, string[]>` (raw per-instance map).
   Optional because `knowledge-loader.ts` is frozen (E1-prep) and builds
   literals without them.
2. `src/understanding/enrichment/recorded-workflow.ts` —
   `aggregateRecordedWorkflows(workflows, priorRecorded?, signatureByInteraction?)`:
   per-instance linkage = sorted unique signature keys of anchors whose
   interactionId ∈ `wf.stepIds` (span = the instance's interaction set; the
   discoverer partitions all interactions, groups are session-local → session
   boundary inherent). Pattern `signatureIds` = union; `linkageState` =
   'linked' iff non-empty; map pruned to retained instances; D7 prior-collapse
   merge unions linkage too.
3. `src/understanding/persistence/knowledge-repository.ts` —
   `upsertRecordedWorkflow` merge: union `signatureIds` (sorted), merge
   `instanceSignatureIds` per-key (union, sorted, pruned to bounded instances),
   `linkageState` monotone ('linked' once non-empty; never demoted); pre-D6
   rows (fields undefined) converge via `?? []` on both the same-key and
   legacy-key migration paths.
4. `src/understanding/persistence/knowledge-types.ts` — row gains the same
   three optional fields.
5. `src/understanding/persistence/knowledge-persistence-service.ts` —
   `persistRecordedWorkflows` passes the fields through.
6. `src/understanding/pipeline/understanding-pipeline.ts` — Stage 7 builds
   `signatureByInteraction` from `behaviorModel.episodes` + `transitions`
   using the mapper's exported `signatureKey`/`normalizeTarget` (identical
   derivation → byte-identical keys; guarded when behaviorModel is null).
7. `src/understanding/contract/contract-types.ts` —
   `workflowPatternAbsence: AbsenceReason | 'linked'`.
8. `src/understanding/contract/contract-queries.ts` — `toActionDescriptor`
   answers linkage from `knowledgeRecordedWorkflows` rows:
   rows=∅ → `'none-recorded'`; rows ∌ signature → `'linkage-pending'`;
   else `'linked'` + sorted `workflowPatternIds`. **E1 hunk
   (`listBehaviorSessions`) preserved untouched.**

## NOT in scope

workflow-discoverer; intent labels/semantic enrichment/identity hashing
(D7/D7.5 intact); no new stores (verno stays 30); no sidepanel UI; no
IR/Playwright; no consumer beyond CP8 queries; no E1/M-EXEC; no TestSpec;
no changes to the 3 E1-prep files beyond contract-queries.ts linkage edit.

## Acceptance criteria

- [ ] Unit: 2 identical sessions → both instances link the SAME signatureIds
      set; linkageState='linked'; occurrenceCount=2 unaffected.
- [ ] Unit: workflow with no co-occurring signatures (TextEntry-only) →
      signatureIds=[] , linkageState stays 'linkage-pending' (never fabricated).
- [ ] Unit: session boundary respected (session-A signature never links to
      session-B instance).
- [ ] Unit: dedup — same signature via multiple instances → one entry.
- [ ] Unit: identity stability — linkage fields do not change patternId.
- [ ] Unit: legacy row without new fields migrates on upsert; legacy
      patternId preserved; repeated upserts union-merge with no data loss;
      instance map pruned to bounded instances.
- [ ] Unit: workflow upsert with linkage does not mutate signature rows
      (linkage is observation, not new evidence).
- [ ] Contract: 'linked' + sorted patternIds when linked; 'linkage-pending'
      when rows exist sans signature; 'none-recorded' when no rows;
      deterministic across calls; stores byte-identical before/after reads.
- [ ] tsc clean; full suite green (183 files / 3,500 + new).
- [ ] Real Chrome (replica 8098, fresh profile, dist build): s1+s2 identical
      D7-harness sessions → exactly ONE full-workflow row, occ=2, patternId
      `wf-pattern-d3392945`, linkageState='linked', instanceSignatureIds equal
      sets for both instances, signatureIds == exact set of episode-anchor
      signature keys (cross-checked against knowledgeBehaviorEpisodes dump),
      CP8 listActions shows 'linked' + the pattern on those signatures;
      raw stepIntents still 7 tokens; signature occurrenceCount=2 / hitCounts
      non-zero; verno 30; zero console errors.
- [ ] Chrome honest absence: s3 TextEntry-only session (programmatic focus,
      no click anchors) → its workflow row has signatureIds=[] and
      linkageState='linkage-pending'; no new signature appears.
- [ ] Chrome positive control: s4 dragzone-only session → its single-step
      workflow links ONLY the drag signature (span isolation in real Chrome).
- [ ] No commit / no push; the 3 E1-prep files otherwise untouched;
      `.drytis` untracked artifacts untouched (this spec file is new).

# D2/D3 — Element Linkage, Healing Wiring, Truthful Staleness

## Root cause
- **D3 (upstream):** `identity-extractor.ts:370` sets `elementId: ''` on every
  captured identity; no production code ever assigns one. The intended
  mechanism (`ElementIdGenerator`, `elem-0001`…) is dead code with zero
  importers. `healFromRecording()` — the ONLY writer of the Dexie `elements`
  table — has zero production callers. Result: Elements view permanently
  empty; `attemptRuntimeHealing` (keys on `step.target.elementId`) can never
  succeed; OR-1 merge treats all elements as identical (`'' === ''`) so
  distinct consecutive clicks can merge into one step.
- **D2 (downstream):** the staleness check in `handleRunTest` reads
  `EXECUTION_IR_PLAN + '_generated_at'`, which is only ever written inside
  `if (irWasStale)` — circular dead logic; first run compares vs epoch; and
  because elementIds are `''`, `referencedElements` is always `[]`, so
  staleness can never fire. When it DOES fire it's only a `console.warn` —
  invisible to the user; the repository page claims stale IR is
  "automatically regenerated" (false).

## Fix (smallest additive change; healing-service.ts UNTOUCHED)
1. **New module `src/repository/services/session-element-harvest.ts`** (pure):
   `harvestSessionElements(interactions, startUrl)` →
   `{ freshElements: UiElement[], idByKey: Map<identityKey, elemId> }`.
   Dedupe by stable identity key (cssSelector|xPath|testId), assign
   `elem-NNNN` via `ElementIdGenerator` in first-seen order,
   build `UiElement` via `createUiElement` (id now non-empty → no throw).
2. **`src/generation/ir-bridge.ts`**: `build()` accepts optional
   `elementIdByKey?: Map<string, string>` (third optional field on
   GenerationInput, D6-precedent). `resolveElementTarget` consumes it keyed on
   `elementIdentityKey(identity)` (exported from harvest module) — real IDs
   flow to `step.target.elementId`, fixing OR-1 merging as a side effect.
   No-key path is byte-identical to today (backward compatible).
3. **`src/background/service-worker.ts` `handleStopRecording`**:
   - harvest before build; pass `elementIdByKey` into `buildIRPlan`;
   - after plan `setRaw`, immediately write
     `EXECUTION_IR_PLAN + '_generated_at' = now` (truthful generation time);
   - after `persistSession` (has projectId + sessionId), call
     `healFromRecording(projectId, freshElements, sessionId, uowFactory)` in a
     non-fatal try/catch; map repository IDs → IR steps via
     `repoElementIdByKey` (identity-key → stored Dexie id from the healing
     details) and persist the mapped plan + updated generated_at;
   - healing metrics (examined/healed/created) logged; failures never break STOP.
4. **`src/background/service-worker.ts` `handleRunTest`**:
   - staleness check now reads the truthful generated_at companion;
   - pass `irWasStale` through to `EXECUTION_RESULT` broadcast (new optional
     field `irStale?: boolean` on the message + execution summary).
5. **`src/sidepanel/sidepanel.ts`**: `renderExecutionResult` adds an honest
   row when `data.irStale === true`:
   "IR stale — element changed after plan generation; replayed with runtime
   healing." (muted `repo-status__unavailable` styling, D4 pattern).
6. **`src/repository/repository-page.ts`**: correct the stale doc text —
   staleness is DETECTED and the executor compensates via runtime healing;
   IR is NOT automatically regenerated.
7. **`src/shared/types.ts`**: fix the 3 stale doc comments
   (":116 background assigns", ":163 assigned by background", ":206 background
   assigns") to describe the new session-scoped assignment at harvest time;
   add `irStale?: boolean` to EXECUTION_RESULT message type.

## Acceptance criteria
- [ ] `harvestSessionElements` dedupes identical identities (same
      cssSelector/xPath) to one elem-NNNN; distinct elements get distinct IDs.
- [ ] `buildIRPlan` with `elementIdByKey` populates `step.target.elementId`
      with real IDs; without the map, output is identical to pre-D2/D3.
- [ ] OR-1: two consecutive CLICKs on DIFFERENT elements are NOT merged when
      IDs are real; two clicks on the SAME element still merge.
- [ ] `handleStopRecording` writes `_generated_at` at generation time (not
      only inside `if (irWasStale)`).
- [ ] Integration (fake-indexeddb): harvest → healFromRecording → repo
      `elements` table populated; second identical session heals to the SAME
      repository IDs (no duplicate rows); IR steps reference those IDs.
- [ ] Staleness: element `updatedAt > generatedAt` → `checkStaleness` reports
      `element_changed`; `EXECUTION_RESULT.irStale` true; side panel renders
      the honest row; `irStale` absent/false renders nothing.
- [ ] healing-service.ts byte-identical (D5 invariant).
- [ ] Repo page text no longer claims auto-regeneration.
- [ ] tsc clean; full suite green (3,589 + new).

## Real-Chrome validation (plan)
Replica :8098, pinned Chrome 148 via CDP (d9 recipe). Record purchase flow →
assert: IR element steps carry repository element IDs (non-empty, distinct per
element); Dexie elements table populated; `_generated_at` ≈ STOP time;
repository page Elements non-empty. Second identical session → same repo IDs
(healed not duplicated). Mutate replica markup (change CSS class) → re-record
→ heal fires → `updatedAt` bump; then RUN_TEST on older plan → panel shows
stale row; two distinct consecutive clicks → 2 steps (no OR-1 merge); zero
console errors.

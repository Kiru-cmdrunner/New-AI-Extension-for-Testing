# Migration Roadmap — New Pipeline to Production Replacement

Generated 2026-07-27. Based on analysis of integration, working-better (f546cef),
v10.9.0 (9976ff8), and the Architecture Evolution Blueprint.

## Current State

**Built and tested (not wired):**
- Phase 1: Foundation types (8 files, 57 tests)
- Phase 2: Evidence channels A-E (7 files, 58 tests)
- Phase 3: EventTap + delivery (7 files, 67 tests)
- Phase 4: Recognition pipeline (8 pattern files + engine, 81 tests)
- Phase 5: Lifecycle engine (5 files, 41 tests)
- Total: 304 tests across 42 source files. TypeCheck at 344 baseline. Build succeeds.

**Existing recorder (in production):**
- Content script: 2,739-line monolith, capture-phase listeners, 18-field ElementIdentity
- SW: 6-step STOP pipeline (session → classify V1+V2+merge → enrich → IR → persist → UI)
- Side panel: 1,301 lines, 4 views, storage-polling with live listeners
- Domain layer: 14 entity files, repository V2 (Dexie), healing service
- 3,360 total tests (including our 304 new ones)

**Key bridge: type-adapters.ts** converts existing RecordedEvent → EvidenceRecord[],
enabling gradual migration without rewriting the content script.

## Wiring Architecture (Critical Decision)

The new pipeline will be wired in PARALLEL alongside the existing recorder.
Both run simultaneously. The SW runs BOTH the old classification pipeline AND
the new evidence pipeline on STOP. Results are compared in the dev view.
Only when parity is proven does the old pipeline get removed.

Content script stays unchanged during wiring — it already sends structured
RECORDED_EVENT messages. The type-adapters convert these to EvidenceBatches
at the SW level. This avoids the highest-risk change (content script rewrite).

## Phase Plan

### Phase 5b — Lifecycle + Recognition Improvements (UPDATE)
Gaps from v10.9.0 reference analysis. No wiring changes.

1. Scroll burst coalescing: New SCROLL_LIFECYCLE definition (multi-event,
   500ms burst gap, commit on non-scroll event). Change scroll from
   immediate verb to lifecycle-managed.

2. Date picker multi-mode completion: Extend DATE_PICKER_LIFECYCLE to support
   3 commit paths (calendar cell click, blur with typed value, native change).
   Add navigation button rejection (prev/next/switch/today/chevron).

3. Dropdown no-op detection: Add normalizeDisplayValue() + comparison to
   SemanticActionBuilder. Already-selected option = not a test step.

4. Per-type temporal dedup: New dedup layer between recognition and lifecycle.
   2000ms per-type window, cross-element same-name collapse for checkbox/radio.

5. Interactive element filter: Add isInteractiveElement check to Click pattern.
   Reject bare divs/spans unless tabIndex≥0 or interactive class match.

6. Priority-based discovery: Add priority field to pattern definitions. Click
   gets lowest priority (fallback). Order patterns by priority in evaluator.

### Phase 6 — Enrichment Pipeline
Three-layer model from v10.9.0, adapted to declarative architecture.

1. Component type detection: Framework detection (13 frameworks via class regex).
   26 component types via cascading first-match-wins. Icon button detection.

2. Business meaning resolution: Component-type-specific strings (SortButton→"Sort
   by Name", IconButton→"Close dialog") with interaction-type fallback.

3. EnrichmentPipeline: Takes SemanticAction[] → EnrichedAction[] (adds
   componentType, componentFramework, businessMeaning).

### Phase 7 — Output Stage
1. RecordingArtifact assembler: metadata + actions + unrecognised + traces
2. Playwright code generator: adapted from existing generator, takes
   EnrichedAction[] instead of DetectedInteraction[]
3. ExecutionIR bridge: adapted from existing IR bridge

### Phase 8 — Parallel Wiring (CRITICAL)
Wire the new pipeline alongside the old recorder. Both run on STOP.

1. SW integration: On STOP_RECORDING, after existing pipeline runs, also run:
   type-adapters.recordedEventToEvidenceRecords(events) → batches
   → recogniseInteractions(batches) → recognitionResults
   → processWithLifecycle(results) → semanticActions
   → enrichActions(actions) → enrichedActions
   Store results in NEW_PIPELINE_RESULT storage key.

2. Dev view enhancement: Add a comparison panel showing old vs new results
   side-by-side. Count interactions, show types, highlight differences.

3. A/B telemetry: Log classification agreement/disagreement counts to console.

### Phase 9 — Cutover
Switch the SW to use the new pipeline as PRIMARY.

1. New pipeline produces: DETECTED_INTERACTIONS, EXECUTION_IR_PLAN,
   GENERATED_FILES (same storage keys the side panel already reads).
2. Old pipeline runs as shadow (results stored separately for comparison).
3. Side panel reads from new pipeline by default.

### Phase 10 — Cleanup
Remove old pipeline code now that the new one is proven.

1. Remove V1 classifier, V2 classifier, merge layer
2. Remove old pipeline-runner.ts
3. Remove old enrichment modules
4. Clean up unused StorageKeys
5. Content script: gradually modularize (but this is post-cutover, not blocking)

## Intentionally Rejected Behaviours

1. **Hover sustained-dwell (working-better/v10.9.0)**: Dwell time alone produces
   false positives. Correct behaviour requires observable UI state change.
   [REJECTED — reference incorrect]

2. **Dropdown/datePicker shouldCancelOnOutside=false (v10.9.0)**: Portal-rendered
   overlays break DOM-boundary heuristics. But our ARIA-role-based scope detection
   avoids this problem entirely. [REJECTED — we have a better solution]

3. **15s passive stale timeout (working-better/v10.9.0)**: Produces zombie
   lifecycles. Our active cleanupStale on every cycle is strictly better.
   [REJECTED — we improved this]

4. **V1/V2 dual-engine + merge layer (integration)**: Structural + behavioral
   classifiers running in parallel with a merge layer adds complexity without
   improving accuracy. Single declarative pipeline is cleaner.
   [REJECTED — architectural improvement]

5. **Content script monolith (all references)**: The 2,739-line deterministic-
   recorder.ts will eventually be replaced by our modular EventTap + channels.
   But this is the LAST step, not the first — we wire at the SW level using
   type-adapters first. [DEFERRED — not rejected, sequenced]

## Risks During Wiring and Migration

1. **Timing model mismatch**: The new pipeline processes EvidenceBatches (per
   interaction), not raw RecordedEvents (per DOM event). The type-adapter must
   correctly group events into batches. Risk: grouping errors produce wrong
   evidence → wrong classification.

2. **Content script sends raw events, not EvidenceBatches**: During parallel run,
   we convert at the SW level. This means the content script's capture-phase
   logic (suppression, value tracking) still applies. The new EventTap is NOT
   used during parallel run — only after full cutover.

3. **MV3 SW eviction**: The SW can be killed at any time. The existing session
   manager has proven debounced persistence. The new pipeline's EvidenceBatch
   buffer needs the same crash recovery. Risk: data loss on SW termination.

4. **Performance**: Running both pipelines on STOP doubles the processing load.
   For typical recordings (50-200 events), this is negligible. For large
   recordings (1000+ events), could cause SW timeout.

5. **Storage key conflicts**: The new pipeline writes to different keys during
   parallel run. On cutover, it writes to the SAME keys the side panel reads.
   Risk: if rollback is needed, old keys may be stale.

6. **Side panel expects DetectedInteraction[] format**: The new pipeline produces
   SemanticAction[]. The output stage must convert to a compatible format or
   the side panel must be updated.

7. **IR Bridge expects specific interaction shapes**: The existing IR bridge and
   Playwright generator consume DetectedInteraction objects with specific field
   names. The output stage must produce compatible shapes or adapters are needed.

## Readiness Criteria for Cutover

The new pipeline replaces the old recorder when ALL of these are true:

1. **Interaction coverage**: Every interaction type the old recorder captures
   (15+ types) is correctly recognized by the new pipeline on real recordings.

2. **Parity on real workflows**: For at least 20 diverse test recordings (login
   forms, data tables, dropdowns, date pickers, navigation, file uploads,
   multi-step wizards, drag-and-drop), the new pipeline produces equivalent
   or better SemanticActions than the old recorder's DetectedInteractions.

3. **No regressions**: The existing 3,360 tests pass with the new pipeline wired.
   New tests cover all new pipeline modules.

4. **Playwright code generation**: Generated test code from the new pipeline is
   functionally equivalent to or better than the old pipeline's output.

5. **Performance**: New pipeline completes in <2s for typical recordings (200
   events), <10s for large recordings (1000+ events).

6. **Crash recovery**: SW termination during recording does not lose data.
   EvidenceBatch buffer survives SW restart via storage persistence.

7. **Side panel renders correctly**: All 4 views work with new pipeline data.

## Architectural Assessment

The existing blueprint (Architecture Evolution Blueprint) remains the right
approach. No architectural changes recommended. Key validation:

- **Declarative patterns**: Proven correct in Phase 4. Better than procedural
  if/else cascades in references.
- **Lifecycle engine**: Proven correct in Phase 5. Better than reference's
  per-definition procedural code.
- **Evidence channels**: Richer than reference's flat domContext. No changes.
- **Pipeline stages**: The EvidenceBatch → Recognition → Lifecycle → Enrichment
  → Output flow is sound. No changes.

The only addition to the blueprint is the **parallel wiring strategy** (Phase 8)
which was always implied but now made explicit. The type-adapters bridge enables
gradual migration without content script changes — this is the key de-risking
decision.

# Engineering Stabilization Phase

## Objective

Address architectural cleanup and technical debt identified in the architecture
conformance review without changing externally visible behaviour.

## Scope

### 1. Remove Debug Artifacts (Phase 1)

**Files:** `generation-engine.ts`, `service-worker.ts`, `hover-content-script.ts`

Remove all diagnostic `console.log` statements tagged `[CMDRUNNER-HOVER-GEN]`
and `[CMDRUNNER-HOVER-SW]`. These were instrumentation for the C3.3 hover
detection investigation. Legitimate `console.error`/`console.warn` error-level
logging is preserved.

Also remove the hover diagnostics block in `hover-content-script.ts` gated by
`localStorage CMDRUNNER_HOVER_DEBUG`.

### 2. Remove Confirmed Dead Code (Phase 2)

**Modules to remove (verified zero production references):**
- `src/recorder/step-builder.ts` — superseded by canonical-step-generator
- `tests/click-interaction.test.ts` — only consumer of step-builder
- `src/recorder/shared/recorder-utils.ts` — zero imports; content scripts have inline copies
- `tests/recorder-utils.test.ts` — only consumer of recorder-utils

**NOT removed (planned for future phases):**
- `schema-version.ts`, `error-handler.ts`, `audit-manager.ts`, `logging-manager.ts`
- `confidence-engine.ts`, `workflow-analyzer.ts`

**Dead exports to remove:**
- `isAdjacent()` export in readability-optimizer.ts (internal function, remove `export`)
- `StepWithExecutionJson` type alias in execution-json-generator.ts
- `SemanticInteraction` unused import in execution-json-generator.ts
- Dead message types: `STEPS_UPDATED`, `GENERATION_STARTED`, `GENERATION_COMPLETE`, `GENERATION_FAILED` in types.ts
- No-op handlers: `GET_STATE`, `STATE_UPDATE`, `EVENTS_UPDATED` in service-worker.ts

### 3. Improve Type Safety (Phase 3)

**SessionEvent type gap:**

The individual event interfaces (`ClickEvent`, `TextEntryEvent`, etc.) don't
declare `aiUnderstanding`, `aiError`, or `className` — but these fields exist
on the runtime objects. The generation pipeline works around this with casts.

Fix:
1. Add optional `aiUnderstanding?: AIUnderstanding` and `aiError?: string`
   to each action event interface in `types.ts`.
2. Remove casts in `canonical-step-generator.ts` — access fields directly.
3. Remove casts in `semantic-classifier.ts` — access `elementIdentity` directly.
4. Remove `e: any` in `generation-engine.ts`.
5. Add proper typing to `getElementIdentity()` in classifier.

### 4. Build Hygiene (Phase 4)

Reduce TypeScript errors in pipeline modules. Target: zero `tsc` errors in
`src/generation/` and `src/background/service-worker.ts`.

## Acceptance Criteria

- [ ] Zero diagnostic console.log in production source code
- [ ] step-builder.ts and recorder-utils.ts removed
- [ ] Dead message types removed from AppMessage union
- [ ] No-op message handlers removed from service-worker
- [ ] SessionEvent action types carry AI enrichment fields
- [ ] No `as` casts for elementIdentity/aiUnderstanding in generation pipeline
- [ ] No `any` types in generation-engine.ts
- [ ] All 1191 existing tests pass
- [ ] Build succeeds

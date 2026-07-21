# Phase 6 — Wire Recognition → Enrichment → Generation into the Deterministic Recorder Pipeline

## Decision

Architecture C is retired. The deterministic recorder is the active capture layer. Recognition, Enrichment, and Generation are wired into the existing pipeline via a domain adapter.

## Architecture

```
Deterministic Recorder → V1/V2 Classifier → Domain Adapter → Recognition → Enrichment → Generation → Side Panel
```

## Milestones

### Milestone 6.1 — Extend DomContext with DOM Attributes + Ancestor Role Chain

**Objective:** Add validation attributes (`required`, `min`, `max`, `step`, `pattern`, `minlength`, `maxlength`, `type`, `aria-required`) and ancestor role chain to `DomContext` and `captureDomContext()`.

**Files to modify:**
- `src/recorder/recorded-event.ts` — add fields to `DomContext` interface
- `src/recorder/deterministic-recorder.ts` — update local `DomContext` interface, `captureDomContext()`, `extractIdentity()`

**Acceptance criteria:**
- [ ] `DomContext` has `domAttributes: Record<string, string>` field capturing validation attributes
- [ ] `DomContext` has `ancestorRoles: string[]` field capturing role chain (tag + role for up to 10 ancestors)
- [ ] `captureDomContext()` populates `domAttributes` with: `required`, `aria-required`, `min`, `max`, `step`, `pattern`, `minlength`, `maxlength`, `type`, `multiple`, `accept`, `autocomplete` (only present attributes — no undefined keys)
- [ ] `captureDomContext()` populates `ancestorRoles` by walking up to 10 ancestors and recording `tag` + `aria-role` for each
- [ ] All existing tests pass
- [ ] New tests cover the new fields

### Milestone 6.2 — Build Domain Adapter

**Objective:** Create a function that converts `RecordedEvent[]` + `DetectedInteraction[]` → `UiElement[]` + `ObservedTransition[]`.

**Files to create:**
- `src/recorder/pipeline/domain-adapter.ts`
- `tests/domain-adapter.test.ts`

**Acceptance criteria:**
- [ ] `adaptToDomainEntities()` takes `RecordedEvent[]` + `DetectedInteraction[]` → returns `{ elements: UiElement[], transitions: ObservedTransition[] }`
- [ ] `UiElement.domAttributes` populated from `DomContext.domAttributes`
- [ ] `UiElement.identity` populated from `RecordedEvent.elementIdentity`
- [ ] `UiElement.intrinsicCapabilities` derived via `deriveCapabilities()`
- [ `UiElement.domTreePath` populated from `cssSelector` (or a generated path)
- [ ] `UiElement.sourceUrl` populated from `RecordedEvent.url`
- [ ] `ObservedTransition.operation` mapped from event type (CLICK → CLICK, INPUT → FILL, etc.)
- [ ] `ObservedTransition.stateBefore`/`stateAfter` populated from value snapshots
- [ ] All existing tests pass
- [ ] New tests cover all mapping logic

### Milestone 6.3 — Wire Recognition into Service Worker

**Objective:** On `STOP_RECORDING`, run recognition orchestrator on the domain entities.

**Files to modify:**
- `src/background/service-worker.ts`

**Acceptance criteria:**
- [ ] `STOP_RECORDING` handler calls domain adapter then recognition orchestrator
- [ ] Recognition results stored in chrome.storage
- [ ] All existing tests pass
- [ ] New tests verify recognition integration

### Milestone 6.4 — Wire Enrichment into Service Worker

**Objective:** Run enrichment orchestrator after recognition.

**Files to modify:**
- `src/background/service-worker.ts`

**Acceptance criteria:**
- [ ] Enrichment orchestrator called with recognition results
- [ ] Application Knowledge Fragment stored
- [ ] All existing tests pass
- [ ] New tests verify enrichment integration

### Milestone 6.5 — Wire Generation into Service Worker + Side Panel

**Objective:** Generate test artifacts from the knowledge fragment and display in side panel.

**Files to modify:**
- `src/background/service-worker.ts`
- `src/sidepanel/sidepanel.ts`

**Acceptance criteria:**
- [x] Generation engine produces test steps + execution JSON + Playwright code
- [x] Side panel displays generated artifacts
- [x] All existing tests pass
- [x] New tests verify generation integration

### Phase 7 — Archive Architecture C

**Objective:** Move Architecture C code to `legacy/` and clean up dead code.

**Files to move to `legacy/architecture-c/`:**
- `src/recorder/pipeline/architecture-c-pipeline.ts`
- `src/recorder/pipeline/snapshot-coalescer.ts`
- `src/recorder/pipeline/interaction-assembler.ts`
- `src/recorder/observer/` (universal-observer-init.ts, universal-interaction-observer.ts, observer-helpers.ts)
- `src/recorder/context/` (state-tracker-init.ts, state-tracker.ts)

**Files to delete:**
- Feature flag `ARCHITECTURE_C_ENABLED` references

**Files to clean up:**
- `src/shared/types.ts` — remove 14 dead message types from AppMessage union

**Acceptance criteria:**
- [ ] Architecture C code moved to `legacy/architecture-c/`
- [ ] Feature flag removed
- [ ] Dead message types removed
- [ ] Build succeeds
- [ ] All tests pass

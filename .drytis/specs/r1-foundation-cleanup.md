# Phase R1 — Foundation Cleanup Design Document

> **Roadmap reference:** `.drytis/CANONICAL_ROADMAP.md` §3, Phase R1
>
> **Status:** Design — pending approval. No implementation changes made.

---

## §1. Objective

Eliminate all dead code and dormant subsystems so the codebase has a single, clear capture-to-generation execution path with zero ambiguity about what is active.

---

## §2. Problem Analysis

### 2.1 The Dormant V2 Subsystem

The manifest injects **two** content scripts on every page:

```json
{ "js": ["src/recorder/phase5/recorder-entry.ts"], "all_frames": true, ... }
{ "js": ["src/recorder/v2/control-recorder.ts"], "all_frames": true, ... }
```

The active path (`recorder-entry.ts` + `event-tap.ts`) is a pure event forwarder: captures every trusted DOM event, snapshots identity + context, sends `OBSERVED_EVENT` messages to the service worker. All classification happens downstream.

The dormant path (`control-recorder.ts` + `control-model.ts`) is a control-centric recorder that maintains a live semantic model of the page's interactive elements. It is gated behind a feature flag (`recorderEngine: 'control'`) that **defaults to `'legacy'`** and is **never set to `'control'`** anywhere in production code.

**The dormant path is double-dead:**
1. The feature flag is never activated — `recorderEngine` defaults to `'legacy'` in `DEFAULT_UI_STATE` and is preserved as-is (`prevUiState.recorderEngine || 'legacy'`) at recording start/stop.
2. Even if the flag were activated, the service worker's message router handles `OBSERVED_EVENT` (from the active path) but has **no handler** for `RECORDED_EVENT` (from the dormant path). All v2 events would be silently dropped.

### 2.2 Responsibility Comparison

| Responsibility | Active Path (recorder-entry + event-tap) | Dormant Path (control-recorder + control-model) |
|---|---|---|
| Event capture | 17 event types on `document` | 12 event types on `document` |
| Event forwarding | `OBSERVED_EVENT` via `sendMessage` + sessionStorage buffer + retry | `RECORDED_EVENT` via bare `sendMessage` (no retry, no buffer) |
| Value capture | `valueBefore`/`valueAfter` + deferred blur + post-click multi-poll (50/150/400ms) | `valueBefore`/`valueAfter` at focus/blur (no deferred, no multi-poll) |
| Checked capture | 5-strategy cascade (native → aria-checked → aria-pressed → CSS class → descendant walk) | 2-strategy (native → aria-checked) |
| Target resolution | `resolveTarget()` — composedPath + interactive-selector heuristic | `matchEvent()` — ARIA-role ancestor walk + label/wrapper fallback via ControlModel |
| DomContext | 35+ fields (surface detection, ancestor classes, validation, navigation) | ~20 fields (no surface detection, no ancestor classes, no navigation signals) |
| Identity extraction | 10-tier accessible name cascade + 3-tier role inference | Identity from ControlModel's resolved control (11-tier name + 4-tier role with OXD) |
| Hover handling | Raw forward (classification downstream) | 500ms dwell threshold + 2000ms post-click cooldown |
| dblclick | ❌ Not registered | ✅ Registered |
| Date picker | Generic post-click value poll (produces `change` events, no date metadata) | Calendar-aware: `dateSelect` events with `dateType`, `isoValue`, `displayValue`, `dateConfidence`, 800ms debounce |
| Scroll | Rate-limited (16ms minimum interval) | Debounced (200ms) |
| MutationObserver | Iframe lifecycle only (childList on documentElement) | Element discovery (childList + subtree + attributes on body) |
| MV3 resilience | sessionStorage buffer + 5-retry exponential backoff + pagehide flush | None |
| Iframe reporting | `IFRAME_SELECTORS` message + selector generation | None |
| Shadow DOM | `deepGetElementById` (pierces shadow roots) | `document.getElementById` (no shadow DOM piercing for labelledby) |

### 2.3 Capabilities Unique to Each Path

**Unique to dormant path (no equivalent in active path):**

| Capability | What It Does | Required by R2/R3/Later? |
|---|---|---|
| `dblclick` capture | Registers dblclick event listener | **Yes (R1.6)** — dblclick is in BrowserEventType union and Click's triggerEventTypes but EventTap never registers it |
| MutationObserver for element tracking | Watches body for childList + subtree + attribute changes (role, aria-expanded, aria-checked, aria-selected, class, value, checked, hidden, style) | **Yes (R3.4)** — attribute transition capture requires this pattern |
| Semantic control resolution (`matchEvent`) | ARIA-role ancestor walk resolves events to correct logical control | **No** — fundamentally different architecture (control-centric vs event-centric). Active path's `resolveTarget()` handles target resolution. Revisiting this is a future architecture decision, not R1 cleanup. |
| Hover dwell + cooldown | 500ms threshold + 2000ms post-click suppression | **No** — active path handles hover classification downstream. No gap identified. |
| Date picker metadata (`dateSelect`) | Calendar-aware date selection with `isoValue`, `displayValue`, `dateConfidence` | **No** — active path's generic post-click poll detects date value changes and the DatePicker definition handles classification. Richer date metadata is an optional enhancement, not a gap. |
| OXD framework adapter | Class→role mapping for OrangeHRM's design system | **No** — AdaniOne-specific patterns are handled by Pattern Registry. OXD was for a specific prior target application. |
| Element discovery + tracking | Live Map of interactive controls with WeakRef bindings | **No** — not used by the active pipeline. |

**Unique to active path (more sophisticated than dormant):**

| Capability | Why It's Better |
|---|---|
| SessionStorage buffering + retry | MV3 resilience — events survive service worker termination |
| 35+ DomContext fields | Surface detection, ancestor classes, validation, navigation signals — all consumed by lifecycle definitions and evidence engine |
| 5-strategy checked cascade | Handles aria-pressed, CSS-class fallbacks (MUI, Ant Design), descendant walk |
| Deferred blur value capture | setTimeout(0) ensures SPA batched state flush before reading value |
| Generic post-click value poll | Detects ANY value change after click (not just dates) at 50/150/400ms |
| Iframe selector reporting | Top-frame reports iframe locations for frameLocator codegen |
| Shadow DOM piercing label resolution | `deepGetElementById` finds aria-labelledby targets across shadow boundaries |

### 2.4 What Is Used from `src/recorder/v2/` in Production

| File | Production Consumer | Status |
|---|---|---|
| `domain-adapter-v2.ts` | `pipeline-runner.ts:19` — imported and called when `engine === 'control'` (always) | **ACTIVE** — must be preserved |
| `control-recorder.ts` | `manifest.json` content_scripts entry — injected but never activates | **DORMANT** |
| `control-model.ts` | Imported only by `control-recorder.ts` | **DORMANT** |
| `element-identity-builder.ts` | Imported only by `control-recorder.ts` | **DORMANT** |
| `types.ts` | Imported by `control-model.ts` and `control-recorder.ts` | **DORMANT** |
| `index.ts` | **Zero imports anywhere** | **DEAD** |

### 2.5 Test Files

| Test File | Lines | What It Tests | After R1 |
|---|---|---|---|
| `tests/stage1-event-matching.test.ts` | 805 | ControlModel, getRole, getAccessibleName, matchEvent, MutationObserver discovery | **DELETE** — tests removed code |
| `tests/stage2-control-recorder.test.ts` | 401 | buildElementIdentity, feature flag types, manifest dual-script config | **DELETE** — tests removed code + removed manifest config |
| `tests/stage4-domain-adapter-v2.test.ts` | 626 | adaptToDomainEntitiesV2 — transition mapping, state extraction, UiElement creation | **KEEP** — domain-adapter-v2 is preserved |

---

## §3. Scope — What R1 Does and Does Not Do

### 3.1 In Scope

| Item | Action |
|---|---|
| R1.1 | Remove dormant content script from manifest (second content_scripts entry) |
| R1.2 | Delete dormant files: `control-recorder.ts`, `control-model.ts`, `element-identity-builder.ts`, `types.ts`, `index.ts` |
| R1.3 | Preserve `domain-adapter-v2.ts` — relocate from `src/recorder/v2/` to `src/recorder/pipeline/` |
| R1.4 | Remove `engine` parameter from `runPipeline` — delete legacy branch and `adaptToDomainEntities` call |
| R1.5 | Migrate healing service from `adaptToDomainEntities` (legacy) to `adaptToDomainEntitiesV2` |
| R1.6 | Delete legacy `domain-adapter.ts` |
| R1.7 | Remove `recorderEngine` field from `UIState` type and all assignments in service-worker.ts |
| R1.8 | Add `'dblclick'` to EventTap's registered event types array |
| R1.9 | Delete `web_accessible_resources` reference to `control-recorder.ts` in manifest.json |
| R1.10 | Delete stage1 and stage2 test files; preserve stage4 |
| R1.11 | Update imports: `pipeline-runner.ts` imports `domain-adapter-v2` from new location |

### 3.2 Out of Scope (Explicitly Excluded)

| Excluded Item | Why |
|---|---|
| Migrating semantic control resolution (`matchEvent`) into active path | Fundamentally different architecture. Not cleanup. Future decision. |
| Migrating hover dwell/cooldown into active path | No gap identified. Active path handles hover classification downstream. |
| Migrating date picker metadata (`dateSelect`) into active path | Active path's generic post-click poll handles date value detection. Richer metadata is optional enhancement (O3-class). |
| Migrating MutationObserver element tracking | Required for R3.4 (attribute transition capture), not R1. The ControlModel's MutationObserver pattern is documented in this design for R3 reference. |
| Migrating OXD framework adapter | Domain-specific. Pattern Registry handles framework detection. |
| Changes to evidence engine, IR Bridge, enrichment, or Playwright generation | R1 is capture-layer cleanup only. |

---

## §4. Migration Steps

### Step 1: Relocate domain-adapter-v2.ts

**Action:** Move `src/recorder/v2/domain-adapter-v2.ts` → `src/recorder/pipeline/domain-adapter-v2.ts`.

**Import updates:**
- `src/recorder/pipeline/pipeline-runner.ts:19` — change import path from `'../v2/domain-adapter-v2'` to `'./domain-adapter-v2'`
- `tests/stage4-domain-adapter-v2.test.ts` — update import path

**Internal imports in domain-adapter-v2.ts:** Check if it imports from sibling v2 files. If so, update or inline those imports.

**Verification:** `domain-adapter-v2.ts` compiles independently, stage4 tests pass from new location.

### Step 2: Add dblclick to EventTap

**Action:** Add `'dblclick'` to the `eventTypes` array in `src/tap/event-tap.ts` (line 493).

**Current:**
```typescript
const eventTypes: string[] = [
  'click', 'mousedown', 'mouseup', 'contextmenu',
  'focus', 'blur',
  'input', 'change',
  'mouseenter', 'mouseleave', 'mousemove',
  'keydown',
  'scroll',
  'dragstart', 'dragover', 'drop', 'dragend',
];
```

**After:**
```typescript
const eventTypes: string[] = [
  'click', 'dblclick', 'mousedown', 'mouseup', 'contextmenu',
  'focus', 'blur',
  'input', 'change',
  'mouseenter', 'mouseleave', 'mousemove',
  'keydown',
  'scroll',
  'dragstart', 'dragover', 'drop', 'dragend',
];
```

**Verification:** Add a test that captures a dblclick event through EventTap and confirms it produces an ObservedEvent with `eventType: 'dblclick'`.

### Step 3: Remove engine parameter from runPipeline

**Action:** In `src/recorder/pipeline/pipeline-runner.ts`:
- Remove `engine?: 'legacy' | 'control'` from `runPipeline` signature
- Remove `import { adaptToDomainEntities } from './domain-adapter'` (line 18)
- Remove `import type { DomainEntities } from './domain-adapter'` (line 20) — if type is shared, keep the import but point to domain-adapter-v2
- Remove the ternary: replace `engine === 'control' ? adaptToDomainEntitiesV2(...) : adaptToDomainEntities(...)` with unconditional `adaptToDomainEntitiesV2(...)`

**Caller update:** `src/background/service-worker.ts:357` — remove `'control'` argument: `runPipeline(events, allInteractions, sessionId, sourceUrl)`.

### Step 4: Migrate healing service to V2 adapter

**Action:** In `src/background/service-worker.ts:466`:
- Change `adaptToDomainEntities(events, allInteractions, ...)` to `adaptToDomainEntitiesV2(events, allInteractions, ...)`
- Update import: remove `adaptToDomainEntities` from `'../recorder/pipeline/domain-adapter'`, add `adaptToDomainEntitiesV2` from `'../recorder/pipeline/domain-adapter-v2'`

**Verification:** Healing service produces equivalent `DomainEntities` output. The V2 adapter produces the same `DomainEntities` interface (elements + transitions) — the difference is how it maps interactions to transitions (1 per interaction vs 1 per event). For healing, the element set is what matters, and both adapters produce `UiElement[]`.

**Risk:** The V2 adapter maps `ComponentInteraction` → `TransitionOperation` using `INTERACTION_TO_OPERATION` (a `Record<string, TransitionOperation>` map). The legacy adapter maps raw events to operations. The healing service uses `domainEntities.elements` (not transitions) — so the transition mapping difference is unlikely to affect healing. But verify by comparing element output for a test recording.

### Step 5: Delete legacy domain-adapter.ts

**Action:** After Step 4 confirms healing works with V2, delete `src/recorder/pipeline/domain-adapter.ts`.

### Step 6: Remove recorderEngine from UI state

**Action:**
- `src/shared/types.ts:101` — remove `recorderEngine?: 'legacy' | 'control'` from `UIState`
- `src/shared/types.ts` — remove `recorderEngine` from `DEFAULT_UI_STATE`
- `src/background/service-worker.ts:268` — remove `recorderEngine: prevUiState.recorderEngine || 'legacy'` from UI state creation
- `src/background/service-worker.ts:495` — same
- `src/recorder/v2/control-recorder.ts` — will be deleted (Step 7), so its reads of `recorderEngine` don't need updating

### Step 7: Remove dormant content script and files

**Action:**
- `src/manifest.json` — remove second `content_scripts` entry (lines 37-44 referencing `control-recorder.ts`)
- `src/manifest.json:24` — remove `control-recorder.ts` from `web_accessible_resources`
- Delete `src/recorder/v2/control-recorder.ts`
- Delete `src/recorder/v2/control-model.ts`
- Delete `src/recorder/v2/element-identity-builder.ts`
- Delete `src/recorder/v2/types.ts`
- Delete `src/recorder/v2/index.ts`
- Delete `src/recorder/v2/` directory (domain-adapter-v2.ts already relocated in Step 1)

### Step 8: Clean up test files

**Action:**
- Delete `tests/stage1-event-matching.test.ts` (805 lines — tests ControlModel)
- Delete `tests/stage2-control-recorder.test.ts` (401 lines — tests control-recorder + manifest config)
- Keep `tests/stage4-domain-adapter-v2.test.ts` (626 lines — tests the preserved domain adapter). Update import path if needed.

### Step 9: Remove dormant v2 comment references

**Action:** Search for references to `control-recorder`, `ControlModel`, `recorder_engine`, `recorderEngine` in comments and documentation across `src/`. Update or remove stale references.

---

## §5. Regression Gates

### Gate 1: TypeScript Compilation
```
npx tsc --noEmit
```
**Pass criteria:** 0 errors in `src/`. Test errors should not increase (some test files deleted, so count may decrease).

### Gate 2: Golden Master
```
npx vitest run tests/golden-master/golden-master.test.ts
```
**Pass criteria:** 131/131 tests pass. Golden master snapshots unchanged (the pipeline output must be byte-identical — only the capture path for raw events changes, and dblclick events were never in the golden master corpus because dblclick was never captured).

### Gate 3: Domain Adapter V2 Tests
```
npx vitest run tests/stage4-domain-adapter-v2.test.ts
```
**Pass criteria:** All tests pass from new file location.

### Gate 4: Full Test Suite
```
npx vitest run
```
**Pass criteria:** ≥3059 tests pass (minus deleted stage1/stage2 tests = ~1854 tests removed, so expected total ~1205+). All previously-passing tests still pass. The 2 flaky perf timing tests are acceptable.

### Gate 5: E2E Pipeline Verification
```
npx vitest run tests/e2e-pipeline-verification.test.ts tests/e2e-detailed-trace.test.ts
```
**Pass criteria:** 17/17 tests pass. Every pipeline stage produces correct output.

### Gate 6: dblclick Capture Verification
New test: EventTap captures dblclick events and produces ObservedEvent with `eventType: 'dblclick'`.

**Pass criteria:** dblclick event produces a valid ObservedEvent.

### Gate 7: Healing Service Equivalence
Verify that `adaptToDomainEntitiesV2` produces equivalent element output to the legacy adapter for a representative test recording.

**Pass criteria:** Element count and key fields (elementId, accessibleName, role) match between V1 and V2 adapter for the same input.

---

## §6. Completion Criteria

R1 is complete when ALL of the following are true:

1. **Single content script** — manifest.json has one `content_scripts` entry (`recorder-entry.ts`). No reference to `control-recorder.ts` anywhere.
2. **No `src/recorder/v2/` directory** — all files deleted except `domain-adapter-v2.ts` which is relocated to `src/recorder/pipeline/`.
3. **No `engine` parameter** — `runPipeline` has no `engine` parameter. No legacy branch. No `adaptToDomainEntities` import.
4. **No legacy `domain-adapter.ts`** — deleted. Healing service uses V2 adapter.
5. **No `recorderEngine` in UI state** — field removed from type, defaults, and all assignments.
6. **`dblclick` registered** — EventTap captures double-click events.
7. **All regression gates pass** — Gates 1-7 green.
8. **Zero references to deleted code** — `grep -r 'control-recorder\|ControlModel\|adaptToDomainEntities[^V]\|recorderEngine' src/` returns nothing in production code.

---

## §7. What Is Preserved vs. Lost

### Preserved (explicitly)

| Item | How |
|---|---|
| `domain-adapter-v2.ts` (interaction-centric adapter) | Relocated to `src/recorder/pipeline/`. Still imported by `pipeline-runner.ts`. |
| `adaptToDomainEntitiesV2` (the function) | Same function, new location. |
| stage4 tests (domain adapter V2 validation) | Kept, import path updated. |
| dblclick capability | Added to EventTap (was in BrowserEventType union but never registered). |

### Lost (Acceptable — No Active Consumer)

| Item | Why Acceptable |
|---|---|
| Semantic control resolution (`matchEvent`) | Fundamentally different architecture (control-centric vs event-centric). The active path's `resolveTarget()` handles target resolution. If target misresolution becomes a problem, this approach can be revisited as a future architecture decision — the design is documented in this document and in `stage1-event-matching.test.ts` (preserved in git history). |
| Hover dwell + cooldown | No gap identified. Active path classifies hover downstream. |
| Date picker metadata (`dateSelect`) | Active path's generic post-click poll handles date value detection. Richer metadata is an optional future enhancement. |
| OXD framework adapter | Domain-specific to OrangeHRM. Pattern Registry handles general framework detection. |
| ControlModel element tracking | Not used by active pipeline. The MutationObserver pattern is documented here for R3.4 reference. |
| ~1,206 lines of dormant code | Dead code with no production consumer. |

### Not Lost — Documented for Future Reference

| Capability | Where Documented | When Needed |
|---|---|---|
| MutationObserver for attribute transitions | §2.1, §2.3 of this document + control-model.ts (git history) | R3.4 — attribute transition capture |
| Semantic control resolution approach | §2.2, §2.3 + stage1 test (git history) | If target misresolution becomes a problem |

---

## §8. Architectural Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Healing service breaks with V2 adapter | Low | Medium — healing produces wrong elements | Gate 7: verify element output equivalence before deleting legacy adapter |
| `domain-adapter-v2.ts` has internal imports to deleted v2 files | Medium | Compilation failure | Step 1: check and update internal imports during relocation |
| dblclick events affect golden master | Very Low | None — dblclick was never captured before, so golden master has no dblclick fixtures. New dblclick events won't appear unless test fixtures produce them. | Gate 2: golden master unchanged |
| Stale references to deleted code in comments | Medium | Confusion | Step 9: grep and clean |

---

## §9. File Change Manifest

### Files Modified

| File | Change |
|---|---|
| `src/manifest.json` | Remove second content_scripts entry + web_accessible_resources reference |
| `src/tap/event-tap.ts` | Add `'dblclick'` to eventTypes array |
| `src/recorder/pipeline/pipeline-runner.ts` | Remove engine parameter, legacy branch, legacy import |
| `src/background/service-worker.ts` | Remove `'control'` arg from runPipeline call; migrate healing to V2; remove recorderEngine from UI state assignments |
| `src/shared/types.ts` | Remove recorderEngine from UIState type + DEFAULT_UI_STATE |
| `tests/stage4-domain-adapter-v2.test.ts` | Update import path for relocated domain-adapter-v2.ts |

### Files Created

| File | Description |
|---|---|
| `src/recorder/pipeline/domain-adapter-v2.ts` | Relocated from `src/recorder/v2/domain-adapter-v2.ts` |
| `tests/r1-dblclick-capture.test.ts` | New test verifying dblclick capture through EventTap |

### Files Deleted

| File | Lines | Reason |
|---|---|---|
| `src/recorder/pipeline/domain-adapter.ts` | ~250 | Legacy V1 adapter, replaced by V2 |
| `src/recorder/v2/control-recorder.ts` | 844 | Dormant content script, double-dead |
| `src/recorder/v2/control-model.ts` | 273 | Dormant semantic model |
| `src/recorder/v2/element-identity-builder.ts` | 175 | Dormant identity builder |
| `src/recorder/v2/types.ts` | 75 | Dormant types |
| `src/recorder/v2/index.ts` | 35 | Dead exports, zero importers |
| `tests/stage1-event-matching.test.ts` | 805 | Tests deleted ControlModel |
| `tests/stage2-control-recorder.test.ts` | 401 | Tests deleted control-recorder |

**Total deletion:** ~2,858 lines of dead/dormant code and tests.

---

## §10. Proof That No Useful Capability Is Lost

### The Proof Method

For every capability in the dormant path, this design answers three questions:

1. **Does the active path have an equivalent?** If yes, the dormant version is redundant.
2. **If no equivalent, is the capability required by R2, R3, or later roadmap phases?** If yes, it is migrated. If no, it is documented as a future option.
3. **If no equivalent and not required, would deleting it break any validated behavior?** If yes, it is preserved. If no, it is safe to delete.

### Capability-by-Capability Proof

| Dormant Capability | Active Equivalent? | Required by Roadmap? | Validated Behavior Depends on It? | Verdict |
|---|---|---|---|---|
| Basic event capture | ✅ EventTap (17 types vs 12) | — | — | Redundant |
| Value capture | ✅ More sophisticated (deferred + multi-poll) | — | — | Redundant |
| Checked capture | ✅ More sophisticated (5-strategy vs 2-strategy) | — | — | Redundant |
| DomContext | ✅ Richer (35+ fields vs ~20) | — | — | Redundant |
| Identity extraction | ✅ Active path computes independently | — | — | Redundant |
| MV3 resilience | ✅ Active path has it, dormant doesn't | — | — | Active is better |
| dblclick | ❌ | **Yes (R1.6)** | — | **Migrate to EventTap** |
| MutationObserver (element) | ❌ | **Yes (R3.4)** | — | **Document pattern, implement in R3** |
| matchEvent (control resolution) | ❌ | No | No — active path uses resolveTarget() | Document for future |
| Hover dwell/cooldown | ❌ | No | No — classification is downstream | Document for future |
| Date picker metadata | ❌ | No | No — generic post-click poll handles dates | Optional enhancement |
| OXD adapter | ❌ | No | No — Pattern Registry handles frameworks | Domain-specific, not needed |
| ControlModel tracking | ❌ | No | No — not used by active pipeline | Document MutationObserver pattern for R3 |

### Conclusion

**No validated behavior depends on the dormant subsystem.** The dormant path's messages have no handler in the service worker — it has never processed a single event in production. Every capability that the active pipeline actually uses is in the active path. The two capabilities needed for future phases (dblclick, MutationObserver pattern) are migrated or documented.

---

*End of R1 Foundation Cleanup Design Document. Pending review and approval before implementation.*

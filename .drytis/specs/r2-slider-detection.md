# R2 — Slider Detection Expansion Design Document

> **Roadmap reference:** `.drytis/CANONICAL_ROADMAP.md` §3, Phase R2
>
> **Status:** Design — pending approval. No implementation changes made.
>
> **Dependencies:** None. Can proceed on top of R1 (already complete).

---

## §1. Objective

Expand slider detection to recognize custom div-based sliders that lack the two standard signals (`<input type="range">` or `role="slider"`), and extract their values via geometry-based position calculation rather than relying on ARIA value attributes.

**The problem:** `isSlider()` currently returns `true` for exactly two cases:

```typescript
if (tag === 'INPUT' && inputType === 'range') return true;
if (ariaRole === 'slider') return true;
return false;
```

A custom slider built as `<div class="slider-handle">` inside `<div class="slider-track">` — with no ARIA role and no native input — produces a generic Click interaction. The value the user set is lost entirely.

**Target population:** Bespoke/hand-built sliders and legacy frameworks (jQuery UI `ui-slider`, noUiSlider, custom implementations). Modern component libraries (MUI, Ant Design, PrimeReact, Radix) already set `role="slider"` + `aria-valuenow` and are fully supported.

---

## §2. Scope

### 2.1 In Scope

| Item | Description |
|------|-------------|
| **CSS class pattern detection** | Expand `isSlider()` to recognize common slider CSS class patterns on the target element or its ancestor chain |
| **Geometry-based value extraction** | When a slider is detected via CSS patterns (no ARIA values), compute the value as a percentage from handle position relative to track |
| **Slider definition integration** | Wire the new detection path into the existing Slider lifecycle definition so custom sliders produce the same `ComponentInteraction` with `type: 'Slider'` |
| **Value extraction strategy** | Determine value priority: ARIA > native value > geometry percentage |
| **B1 fix: Subtype → IRAction mapping** | Add `NativeSlider`/`AriaSlider`/`RangeSlider`/`CustomSlider` to `INTERACTION_TO_IR_ACTION`, or prevent subtypes from overriding the bridge type for action lookup |
| **B2 fix: Slider assertion rendering** | Handle slider `EQUALITY + EQUALS` in assertion renderer: `toHaveValue()` for native inputs, `toHaveAttribute('aria-valuenow', V)` for ARIA/custom |
| **B3 fix: Timeline metadata keys** | Align timeline renderer to read `min`/`max` (or update definition to emit `sliderMin`/`sliderMax`) |

### 2.2 Out of Scope (Explicitly Deferred)

| Item | Why Deferred | Phase |
|------|-------------|-------|
| **Behavioral slider classification** (detecting "this is a slider" from observable effects alone, with zero structural signals) | Requires R3's behavioral reasoning layer — propagating value-change signals to the evidence engine. R2 uses structural CSS patterns only. | R3 |
| **aria-orientation capture** (horizontal vs vertical) | Not needed for R2's geometry-based percentage extraction. Deferred. | Optional enhancement |
| **Dual-handle RangeSlider grouping** | Two-handle sliders already produce two Slider interactions with `RangeSlider` subtype. Grouping them into a single interaction is a separate concern. | Optional enhancement |
| **Slider step attribute usage** | Captured in DomContext but unused. Not relevant to detection expansion. | Optional enhancement |

### 2.2.1 End-to-End Completeness (added during design review)

The initial R2 design deferred the "ARIA slider replay fix" as a pre-existing P0. On review, this deferral was **architecturally incorrect**: it would leave R2 in a state where sliders are correctly detected but generate unusable replay code. R2 must deliver a complete, end-to-end usable Slider capability.

Investigation revealed that the gap is wider than initially understood — three pre-existing bugs in the downstream pipeline affect ALL slider subtypes (native, ARIA, and the new custom detection), not just custom sliders:

| Bug | Location | Impact | Discovered By |
|-----|----------|--------|---------------|
| **B1: Subtype → IRAction disconnect** | `ir-bridge.ts:180-186` | `toBridgeInteraction()` sets `bridge.type` to the `interactionSubtype` (e.g. `'NativeSlider'`) when set. `INTERACTION_TO_IR_ACTION` only has a key for `'Slider'`, not `'NativeSlider'`/`'AriaSlider'`/`'RangeSlider'`. Lookup returns undefined → `?? IRAction.CLICK` fires. **Every real-world slider recording produces CLICK instead of FILL.** Golden master passes only because fixtures omit `interactionSubtype`. | R2 design review |
| **B2: Assertion rendering for slider values** | `assertion-renderer.ts:291-321` | Slider assertions use `EQUALITY + EQUALS + property='value'`. `renderEquality()` only handles `IS_TRUE` comparison correctly; `EQUALS` with `property='value'` falls through to default → generates `not.toHaveAttribute('value', 'true')` — completely wrong assertion. Should produce `toHaveValue()` for native or `toHaveAttribute('aria-valuenow', '75')` for ARIA/custom. | R2 design review |
| **B3: Timeline metadata key mismatch** | `timeline-renderer.ts:485-490` | Reads `m.sliderMin`/`m.sliderMax` but slider definition produces `min`/`max`. Range info never displayed in side panel. | R2 design review |

These bugs are now **in scope for R2**. R2 cannot be considered complete while correctly-detected slider interactions generate wrong IR actions, wrong assertions, and missing side-panel display.

### 2.3 Architectural Principle

R2 is the **last structural detection expansion**. After R2, every slider implementation with recognizable CSS classes, ARIA roles, or native semantics is detected. The remaining population — sliders with zero recognizable structural or semantic signals — is handled by R3's behavioral reasoning (value changes observable in `aria-valuenow` updates or DOM mutations, even on unstructured elements).

R2 does NOT add a new detection paradigm. It extends the existing `isSlider()` function with additional CSS pattern checks, following the exact pattern already used by dropdowns (`isDropdownTriggerClass`), date pickers (`isDatePickerTriggerClass`), and rich text editors (adapter CSS class matching).

---

## §3. Current Implementation Analysis

### 3.1 What Already Works

| Slider Type | Detection | Value Extraction | IR Action | Replay | Assertions | Side Panel |
|-------------|-----------|-----------------|-----------|--------|------------|------------|
| **Native `<input type="range">`** | ✅ existing | ✅ `el.value` | ⚠️ B1: produces CLICK when subtype set (should be FILL) | ✅ `fill()` works on native inputs | ⚠️ B2: generates wrong assertion (`toHaveAttribute('value', 'true')` instead of `toHaveValue('75')`) | ⚠️ B3: range not displayed (key mismatch) |
| **ARIA slider (`role="slider"` + `aria-valuenow`)** | ✅ existing | ✅ `aria-valuenow` | ⚠️ B1: produces CLICK | ⚠️ `fill()` may fail on div elements | ⚠️ B2: same wrong assertion | ⚠️ B3: same |
| **Dual-handle range slider** | ✅ existing | ✅ each handle | ⚠️ B1: produces CLICK | ⚠️ Same as ARIA | ⚠️ B2: same | ⚠️ B3: same |
| **Custom CSS slider** (jQuery UI, noUiSlider, bespoke) | ❌ Not detected | ❌ No value | N/A | N/A | N/A | N/A |

**Key insight from end-to-end review:** The initial design rated native and ARIA sliders as "working" based on isolated tests. But when `interactionSubtype` is set (as it is in real recordings), bugs B1+B2 make ALL slider subtypes produce incorrect IR actions and assertions. The golden master corpus masked this by omitting `interactionSubtype` from fixtures.

### 3.2 What Does NOT Work

| Scenario | Current Result | Root Cause |
|----------|---------------|------------|
| **jQuery UI slider** (`<div class="ui-slider-handle">`) | Generic Click | `isSlider()` returns false — no `INPUT[type=range]`, no `role=slider` |
| **noUiSlider** (`<div class="noUi-handle">`) | Generic Click | Same |
| **Bespoke slider** (`<div class="slider-thumb">`) | Generic Click | Same |
| **Any div-based slider without ARIA** | Generic Click | Same |

### 3.3 The Full Pipeline Path for Sliders (Current)

```
1. EventTap captures mousedown/click/focus/change on slider element
   → ObservedEvent with valueBefore, valueAfter, domContext (ariaValueNow, nativeMin, etc.)

2. IdentityExtractor.extractIdentity() resolves the target element
   → For ARIA sliders: INTERACTIVE_SELECTOR includes [role="slider"] → correct target
   → For native: INPUT tag → correct target

3. ComponentRuntime checks definitions in priority order
   → Slider (priority 25) calls isSlider() → claims the event
   → Click (priority 180) never consulted

4. Slider definition lifecycle
   → detectTrigger: isSlider() → true
   → isInScope: mousedown → tracks mousemove/mouseup/click
   → handleDragEvent: tracks drag, stores endEvent
   → buildResult: extracts sliderValue, startValue, endValue, min, max

5. Evidence annotation (annotation-layer.ts)
   → Slider → intent: 'select', confidence: 1.0 (static mapping)

6. Domain Adapter V2
   → ComponentInteraction → domain entities

7. Interaction Enrichment Pass
   → Resolves locators, derives value assertion

8. IR Bridge
   → Slider → IRAction.FILL, input = sliderValue

9. Playwright Generation
   → locator.fill('75')

10. Assertion Deriver
    → EQUALITY/EQUALS on property 'value' (works for native, not ARIA)
```

### 3.4 Where R2 Intervenes

R2 touches exactly **two points** in this pipeline:

```
Step 3: isSlider() — ADD CSS class pattern matching
Step 4: buildResult() — ADD geometry-based value extraction fallback
```

Everything downstream (steps 5-10) is unchanged because the Slider definition already produces a `ComponentInteraction` with `type: 'Slider'` and all metadata fields. The new detection path just needs to fill those fields from different sources (CSS classes and geometry instead of ARIA attributes).

---

## §4. Architectural Approach

### 4.1 Detection: Structural CSS Pattern Matching

The approach mirrors existing pattern-matching functions in `patterns.ts`:

```typescript
// EXISTING — dropdown trigger detection via CSS classes
export function isDropdownTriggerClass(className: string): boolean {
  return DROPDOWN_TRIGGER_RE.test(className);
}

// R2 ADDITION — slider handle/track detection via CSS classes
export function isSliderClass(tag: string, className: string, ariaRole: string | null): boolean {
  if (tag === 'INPUT') return false; // native inputs handled by existing path
  if (ariaRole === 'slider') return false; // ARIA sliders handled by existing path
  return SLIDER_CLASS_RE.test(className);
}
```

**Pattern source:** Common CSS class names from widely-used slider implementations:

| Library/Framework | Handle Class | Track Class |
|-------------------|-------------|-------------|
| jQuery UI | `ui-slider-handle` | `ui-slider` |
| noUiSlider | `noUi-handle` | `noUi-slider` |
| ionRangeSlider | `irs-handle` | `irs` |
| Slick Slider | `slick-dots` | (dots, not handle — excluded) |
| Generic/Custom | `slider-handle`, `slider-handle`, `slider-thumb`, `range-handle`, `range-thumb` | `slider-track`, `range-track` |

The regex uses word-boundary matching (same technique as Pattern Registry's `buildRegex`) to avoid false positives:

```typescript
const SLIDER_CLASS_RE = /\b(?:ui-slider-handle|noUi-handle|irs-(?:handle|from|to)|slider-(?:handle|thumb)|range-(?:handle|thumb))\b/;
```

**Ancestor check:** Custom sliders often put the class on the handle element, while the mousedown fires on the handle. The ancestor chain is already available via `domContext.ancestorClasses`. The expanded `isSlider()` checks:
1. Direct: target element's own class
2. Ancestor: any ancestor's class matches track patterns (`slider-track`, `range-track`, `ui-slider`, `noUi-slider`)

### 4.2 Value Extraction: Geometry-Based Fallback

When a slider is detected via CSS patterns (not ARIA, not native), there are no `aria-valuenow` or `.value` to read. The value must be computed from geometry.

**Algorithm:**

```
1. Identify the track element: nearest ancestor with class matching TRACK_CLASS_RE
2. Identify the handle element: the target itself or nearest descendant with class matching HANDLE_CLASS_RE
3. Compute percentage:
   horizontal: percent = (handle.rect.left - track.rect.left) / track.rect.width * 100
   vertical:   percent = (track.rect.bottom - handle.rect.bottom) / track.rect.height * 100
4. If min/max are available (from track's data-min/data-max attributes or ancestor), map:
   value = min + percent * (max - min) / 100
5. Otherwise, value = percent (0-100)
```

**Implementation location:** `slider.ts → buildResult()`, as a fallback after the existing ARIA/native value extraction paths:

```
Value Priority Chain (in buildResult):
  1. aria-valuenow / aria-valuetext (existing) → "75"
  2. el.value (existing) → "75"
  3. endEvent.aria-valuenow (existing, drag path) → "75"
  4. NEW: geometry-based percentage → "75" (or "0.75" or "75%")
```

**DomContext additions needed:**

The geometry-based extraction requires `getBoundingClientRect` data, which is not currently in `DomContext`. Two options:

| Option | Description | Impact |
|--------|-------------|--------|
| **A: Add rect fields to DomContext** | Add `targetRect`, `trackRect` (or `targetOffsetLeft`, `targetOffsetWidth`, `trackOffsetLeft`, `trackOffsetWidth`) to DomContext | Changes the capture layer (dom-context-extractor.ts). More complete but broader change. |
| **B: Extract geometry in the slider definition** | The slider definition's `buildResult()` can access `ObservedEvent.domContext` which already has `ancestorClasses`. Use a heuristic: search ancestor chain for track element class, then use `offsetLeft`/`offsetWidth` if available via additional DomContext fields. | Narrower but may not have enough data. |

**Recommended: Option A with minimal fields.** Add four numeric fields to DomContext:

```typescript
// In DomContext interface (component-types.ts)
targetOffsetLeft?: number;   // el.offsetLeft
targetOffsetTop?: number;    // el.offsetTop
trackOffsetLeft?: number;    // nearest track ancestor's offsetLeft (0 if none)
trackOffsetWidth?: number;   // nearest track ancestor's offsetWidth (0 if none)
```

These are extracted in `dom-context-extractor.ts` alongside the existing `ancestorClasses` walk. When the ancestor walk finds a track-class element, it records its geometry.

### 4.3 Subtype: CustomSlider

A new subtype string `'CustomSlider'` is added alongside `'NativeSlider'`, `'AriaSlider'`, and `'RangeSlider'`. This subtype:
- Is set when the slider was detected via CSS class pattern (not ARIA, not native)
- Signals downstream that geometry-based extraction was used
- Enables the IR Bridge and assertion deriver to handle the custom case if needed
- Does NOT change the `InteractionType` (still `'Slider'`)

---

## §5. Implementation Boundaries

### 5.1 Files Changed (R2 scope)

| File | Change | Lines |
|------|--------|-------|
| `src/definitions/patterns.ts` | Add `SLIDER_CLASS_RE`, `TRACK_CLASS_RE`, expand `isSlider()` to include CSS pattern check | ~30 |
| `src/definitions/dom-context-extractor.ts` | Add 4 geometry fields (`targetOffsetLeft`, `targetOffsetTop`, `trackOffsetLeft`, `trackOffsetWidth`) during ancestor walk | ~20 |
| `src/definitions/slider.ts` | Add `CustomSlider` subtype, add geometry-based value extraction fallback in `buildResult()` | ~40 |
| `src/shared/component-types.ts` | Add 4 optional fields to `DomContext` interface | ~4 |
| `src/generation/ir-bridge.ts` | **B1 fix:** Add `NativeSlider`/`AriaSlider`/`RangeSlider`/`CustomSlider` entries to `INTERACTION_TO_IR_ACTION` map (all → `IRAction.FILL`), ensuring every subtype resolves to the correct action | ~4 |
| `src/adapters/playwright/assertion-renderer.ts` | **B2 fix:** Add slider value rendering in `renderEquality()` — `property='value'` with `EQUALS` → `toHaveValue(V)` for native inputs, `toHaveAttribute('aria-valuenow', V)` for ARIA/custom | ~15 |
| `src/generation/assertion-deriver.ts` | **B2 fix:** Differentiate assertion property by subtype — `value` for native, `aria-valuenow` for ARIA/custom | ~10 |
| `src/sidepanel/timeline-renderer.ts` | **B3 fix:** Change `m.sliderMin`/`m.sliderMax` → `m.min`/`m.max` to match definition output | ~4 |

### 5.2 Files NOT Changed

| File | Why unchanged |
|------|---------------|
| `src/tap/event-tap.ts` | Slider events (mousedown, mousemove, mouseup, click, change) already captured. No new event types needed. |
| `src/tap/identity-extractor.ts` | Value capture priority chain already handles `aria-valuenow` and `.value`. No changes needed — geometry extraction happens in the definition, not the capture layer. |
| `src/classifier/evidence/*` | Evidence engine only runs for Click. Slider bypasses it via lifecycle definition at priority 25. |
| `src/adapters/playwright/action-renderer.ts` | `fill()` rendering is unchanged for native inputs. For ARIA/custom sliders, the B1 fix ensures Slider subtypes reach FILL action correctly. The `fill()` → `dragTo()` enhancement for non-editable elements is a platform-level concern (P4/P5) — R2 ensures the correct action type is generated; the replay strategy is a separate optimization. |
| `src/definitions/click.ts` | Click (priority 180) never claims slider elements — Slider (priority 25) always fires first. |
| `src/definitions/drag-and-drop.ts` | Already excludes sliders. CustomSlider elements may not have the excluded role/tag, but the DragDrop exclusion only matters at priority 15 — and DragDrop checks for draggable attributes, not just roles. This needs verification (see §6 Step 2). |

### 5.3 No Contract Changes

| Frozen Contract | Impact |
|-----------------|--------|
| `ComponentInteraction` type | ✅ No change — `type: 'Slider'` is unchanged |
| `interactionSubtype?: string` | ✅ No change — `'CustomSlider'` is a new string value, not a type change |
| `InteractionType` (23 values) | ✅ No change — Slider is already in the union |
| `BridgeInteractionType` | ✅ No change — `Slider` already in the bridge |
| `IRBridgeInput` | ✅ No change |
| `DomContext` interface | ⚠️ Extended — 4 new optional fields. All existing fields unchanged. Optional fields are backward-compatible. |
| `isSlider()` signature | ⚠️ Extended — additional parameters (`className`, `ancestorClasses`) may be needed. The signature change is internal to `patterns.ts`, not a frozen contract. |

### 5.4 What Stays for R3

| R3 Item | Why It Stays |
|---------|-------------|
| **Behavioral slider detection** — a div with no CSS classes, no ARIA, no role, but which moves when dragged and has a value displayed in a sibling span | R3's behavioral generators would detect the value change (via `valueBefore`/`valueAfter` propagation) and the drag motion, then classify as Slider via `select` intent derivation |
| **Unknown slider surfacing** — if neither structural (R2) nor ARIA/native patterns match, the interaction degrades to Click. R3 adds confidence thresholding to surface these as unrecognized rather than silently misclassifying |
| **Temporal drag context** — multi-interaction window for understanding drag sequences as slider movements | R3 temporal enhancement (O6 in roadmap) |

---

## §6. Implementation Steps

### Step 1: Fix B1 — Subtype → IRAction mapping (ir-bridge.ts)

**Rationale:** This is a pre-existing bug affecting ALL slider subtypes. It must be fixed before R2 detection expansion, otherwise the new CustomSlider subtype would produce the same CLICK fallback.

**Action:**
- Add `NativeSlider`, `AriaSlider`, `RangeSlider` to `INTERACTION_TO_IR_ACTION` with value `IRAction.FILL`
- When `CustomSlider` subtype is introduced (Step 6), add it here too

**Regression gate:** Existing golden master tests continue to pass (they don't set `interactionSubtype`, so they're unaffected). New unit test: slider with `interactionSubtype: 'NativeSlider'` produces `IRAction.FILL` (not CLICK).

### Step 2: Fix B2 — Slider assertion rendering (assertion-deriver.ts + assertion-renderer.ts)

**Action:**
- In `assertion-deriver.ts`: For Slider assertions, differentiate property by subtype:
  - `NativeSlider` → `property: 'value'` (works with `toHaveValue()`)
  - `AriaSlider` / `RangeSlider` / `CustomSlider` → `property: 'aria-valuenow'`
- In `assertion-renderer.ts`: In `renderEquality()`, handle `property: 'value'` with `EQUALS` comparison → `toHaveValue(expectedValue)`. Handle `property: 'aria-valuenow'` → `toHaveAttribute('aria-valuenow', expectedValue)`.

**Regression gate:** Golden master assertion snapshots updated. New unit test: slider value assertion generates correct Playwright assertion.

### Step 3: Fix B3 — Timeline metadata keys (timeline-renderer.ts)

**Action:**
- Change `m.sliderMin` → `m.min` and `m.sliderMax` → `m.max` in `formatInteractionMetadata()`.

**Regression gate:** Existing timeline tests pass (they likely don't test this specific code path). Visual confirmation in side panel.

### Step 4: Add CSS class patterns to `patterns.ts`

**Action:**
- Add `SLIDER_CLASS_RE` regex matching common slider handle class names (word-boundary delimited)
- Add `TRACK_CLASS_RE` regex matching common slider track class names
- Expand `isSlider()` to accept `className` and `ancestorClasses` parameters and check these patterns as a fallback after the existing native/ARIA checks

**Function signature change:**
```typescript
// Before
export function isSlider(tag: string, inputType: string | null, ariaRole: string | null): boolean

// After
export function isSlider(
  tag: string,
  inputType: string | null,
  ariaRole: string | null,
  className?: string | null,
  ancestorClasses?: string[] | null,
): boolean
```

**Logic:**
```
1. tag === 'INPUT' && inputType === 'range' → true (existing)
2. ariaRole === 'slider' → true (existing)
3. NEW: SLIDER_CLASS_RE.test(className) → true
4. NEW: TRACK_CLASS_RE.test(any ancestorClasses) → true
5. → false
```

**Regression gate:** Existing `isSlider()` calls pass `undefined` for new optional params → same behavior.

### Step 5: Verify DragDrop exclusion covers custom sliders

**Action:** Check that `drag-and-drop.ts` does not intercept custom slider handles before Slider (priority 25) fires.

DragDrop is at priority 15 (before Slider at 25). Its exclusion set includes `'slider'` role and `'INPUT'` tag, but custom slider handles (e.g., `<div class="ui-slider-handle">`) have neither.

**Analysis:** DragDrop's `detectTrigger` requires `draggable === true` attribute OR a specific set of DnD-related patterns. Pure CSS-class sliders are unlikely to set `draggable`. However, this must be verified:
- If DragDrop claims the mousedown on a custom slider handle, Slider at priority 25 never fires.
- **Mitigation:** Add common slider handle classes to DragDrop's exclusion list (same pattern as the existing `EXCLUDED_ROLES` set), OR add a slider-class check to DragDrop's exclusion.

**Decision:** Add slider CSS class patterns to DragDrop's exclusion set. This is a one-line addition to the exclusion check and follows the exact same pattern already used for ARIA roles.

### Step 6: Add geometry fields to DomContext

**Action:**
- Add `targetOffsetLeft`, `targetOffsetTop`, `trackOffsetLeft`, `trackOffsetWidth` to `DomContext` interface in `component-types.ts`
- Extract these in `dom-context-extractor.ts` during the existing ancestor walk: when an ancestor matches `TRACK_CLASS_RE`, capture its `offsetLeft` and `offsetWidth`. Always capture the target's `offsetLeft`/`offsetTop`.

### Step 7: Add geometry-based value extraction to `slider.ts buildResult()`

**Action:**
- After the existing ARIA/native value extraction chain, add a geometry fallback:
  ```
  if no value extracted from ARIA or native:
    if trackOffsetWidth > 0:
      percent = (targetOffsetLeft - trackOffsetLeft) / trackOffsetWidth * 100
      sliderValue = hasMin/Max ? mapToRange(percent) : String(Math.round(percent))
  ```
- Set `interactionSubtype = 'CustomSlider'` when geometry path is used
- Set `dragTracked = true` if the mousedown→mousemove drag lifecycle was followed (same as existing)

### Step 8: Update `slider.ts detectTrigger` to pass new parameters

**Action:**
- Update the `isSlider()` call in `detectTrigger` to pass `domContext.className` (target's class) and `domContext.ancestorClasses`
- The `detectTrigger` already has access to `domContext` from the `ObservedEvent`
- Add `CustomSlider` to `INTERACTION_TO_IR_ACTION` in `ir-bridge.ts` (completing Step 1's list)

### Step 9: Add golden master fixtures

**Action:** Add 3-4 new fixtures to `tests/golden-master/corpus.ts`:
1. jQuery UI-style slider drag (`ui-slider-handle` class, geometry extraction)
2. noUiSlider-style slider click (`noUi-handle` class, geometry extraction)
3. Custom slider with min/max data attributes (geometry + range mapping)
4. Custom slider without min/max (percentage-only value)

### Step 10: Add validation harness tests

**Action:** Add 2-3 new validation scenarios to the harness:
1. C2 variant: Custom slider drag produces Slider interaction with correct geometry-based value
2. Verify custom slider click (no drag) produces Slider, not Click
3. Verify DragDrop does not intercept custom slider handles

---

## §7. Regression Gates

### Gate 1: TypeScript Compilation
```
npx tsc --noEmit
```
**Pass criteria:** 0 errors in `src/`. The 4 new optional DomContext fields, expanded `isSlider()` signature, new IR_ACTION entries, and assertion renderer changes must not break any existing callers.

### Gate 2: Golden Master
```
npx vitest run tests/golden-master/golden-master.test.ts
```
**Pass criteria:** All existing 130 + new fixtures pass. Existing fixtures unchanged (custom slider detection doesn't affect native/ARIA slider paths). Golden master snapshots updated for B1/B2 fixes (assertion rendering changes will alter snapshots — must verify changes are correct).

### Gate 3: Slider Unit Tests
```
npx vitest run tests/runtime/slider-drag.test.ts
```
**Pass criteria:** All existing slider tests pass (7 tests). Native and ARIA slider paths are unchanged.

### Gate 4: DragDrop Tests
```
npx vitest run tests/ --keyword drag
```
**Pass criteria:** DragDrop tests pass. Slider handle classes added to exclusion don't break legitimate drag-and-drop detection.

### Gate 5: Full Test Suite
```
npx vitest run
```
**Pass criteria:** ≥2993 tests pass (same as R1 baseline + new fixtures/tests). 1 pre-existing flaky perf test acceptable.

### Gate 6: E2E Pipeline Verification
```
npx vitest run tests/e2e-pipeline-verification.test.ts tests/e2e-detailed-trace.test.ts
```
**Pass criteria:** 17/17 tests pass. Additionally, the slider scenario should produce FILL action (not CLICK) in the IR plan.

### Gate 7: Custom Slider Detection Verification
New tests verifying:
1. `isSlider()` returns `true` for `ui-slider-handle` class
2. `isSlider()` returns `true` for ancestor `slider-track` class
3. `isSlider()` returns `false` for unrelated elements (no false positives)
4. Geometry-based value extraction produces correct percentage
5. Custom slider fixture produces `ComponentInteraction` with `type: 'Slider'`, `subtype: 'CustomSlider'`

### Gate 8: End-to-End Slider Replay Verification
New tests verifying:
1. Native slider with `interactionSubtype: 'NativeSlider'` → IRAction.FILL → `fill('75')` → assertion `toHaveValue('75')`
2. ARIA slider with `interactionSubtype: 'AriaSlider'` → IRAction.FILL → assertion `toHaveAttribute('aria-valuenow', '75')`
3. Custom slider with `interactionSubtype: 'CustomSlider'` → IRAction.FILL → assertion `toHaveAttribute('aria-valuenow', '75')`
4. Side panel displays slider range when `min`/`max` present in metadata

---

## §8. Completion / Exit Criteria

| Criterion | Verification |
|-----------|-------------|
| `isSlider()` recognizes custom slider CSS class patterns | Gate 7 tests 1-2 |
| No false positives from slider CSS patterns | Gate 7 test 3 |
| Geometry-based value extraction works for custom sliders | Gate 7 test 4 |
| Custom slider produces `type: 'Slider'` with `subtype: 'CustomSlider'` | Gate 7 test 5 |
| DragDrop does not intercept custom slider handles | Gate 4 |
| Existing native/ARIA slider behavior unchanged | Gates 2, 3 |
| No contract breaks | Gate 1 (tsc), unchanged frozen contracts |
| Golden master corpus includes custom slider fixtures | Gate 2 |
| Full suite green | Gate 5 |
| E2E pipeline intact | Gate 6 |
| **Slider subtypes produce IRAction.FILL (B1 fix)** | Gate 8 test 1-3 |
| **Slider assertions render correctly (B2 fix)** | Gate 8 test 1-3 |
| **Side panel displays slider range (B3 fix)** | Gate 8 test 4 |
| **Complete end-to-end: detect → classify → enrich → IR → Playwright → assertion** | All gates combined |

---

## §9. Risk Analysis

### Risk 1: CSS Class False Positives

**Risk:** Elements with `slider-handle` in their class name that are not sliders (e.g., a carousel navigation handle, a sidebar resize handle).

**Impact:** Misclassified as Slider → produces `fill()` in generated tests instead of click/drag.

**Mitigation:**
- Word-boundary regex prevents partial matches (`my-slider-handle-wrapper` matches but `slider-handler-service` does not)
- The handle class patterns are specific enough (`ui-slider-handle`, `noUi-handle`, `irs-handle`) that false positives are unlikely
- The fallback (geometry percentage) only activates when no ARIA/native value is available, so a misclassified non-slider would produce a Slider with a geometry percentage — visibly wrong, not silently wrong
- R3's behavioral reasoning provides the safety net: if a misclassified slider doesn't exhibit value-change behavior, the evidence engine can reclassify

**Residual risk:** LOW. CSS class patterns are well-known slider library conventions.

### Risk 2: Geometry Inaccuracy

**Risk:** `offsetLeft`/`offsetWidth` don't always reflect the visual position if CSS transforms or flexbox are involved.

**Impact:** Incorrect percentage/value computation for some custom sliders.

**Mitigation:**
- `getBoundingClientRect` would be more accurate but is not available in the DomContext extraction context (which runs in the content script)
- `offsetLeft`/`offsetWidth` are relative to `offsetParent`, which may not be the track element if the DOM structure is nested differently than expected
- For sliders with known min/max (from data attributes), the mapping is more accurate than percentage-only
- The value extraction is a **fallback** — the primary path (ARIA/native) still works for modern sliders

**Residual risk:** MEDIUM for complex custom slider implementations. Acceptable given that R2 targets bespoke sliders where some inaccuracy is better than complete non-detection.

### Risk 3: Ancestor Walk Performance

**Risk:** The existing ancestor walk in `dom-context-extractor.ts` already walks 10 ancestors. Adding geometry extraction (`offsetLeft`, `offsetWidth` per ancestor) adds 3 property reads per ancestor.

**Impact:** Negligible — 30 additional property reads per event, and these are synchronous DOM property accesses.

**Residual risk:** NONE.

---

## §10. Relationship to R3

R2 is the **structural ceiling** for slider detection. After R2:

| Implementation Style | Detected By |
|---------------------|-------------|
| `<input type="range">` | Existing native check |
| `role="slider"` + `aria-valuenow` | Existing ARIA check |
| `ui-slider-handle` / `noUi-handle` / `slider-thumb` | **R2 CSS pattern check** |
| Unknown div with no structural signals | **R3 behavioral reasoning** (value-change detection) |

R3 will make R2's CSS pattern matching **less critical** over time — if the behavioral layer can detect "a value changed during a drag" without needing CSS class hints, the CSS patterns become an optimization (higher confidence) rather than a necessity. But R3 does NOT make R2 redundant: structural detection is always faster, more precise, and produces higher confidence than behavioral inference. The two layers are complementary:

- **R2 (structural):** "This element has slider CSS classes → it's a slider." Confidence: 1.0 (deterministic).
- **R3 (behavioral):** "This element changed its value during a drag motion → it's probably a slider." Confidence: 0.5-0.7 (inferred).

R2's CSS pattern matching will continue to fire first (at the definition layer), and R3's behavioral reasoning will serve as the fallback for anything R2 misses.

---

## §11. Summary

R2 is a focused, low-risk expansion of the slider definition's detection function and value extraction logic. It adds:

1. **~30 lines** of CSS class regex patterns to `patterns.ts`
2. **~20 lines** of geometry field extraction to `dom-context-extractor.ts`
3. **~40 lines** of geometry-based value fallback to `slider.ts`
4. **4 optional fields** to the `DomContext` interface

It touches no frozen contracts, introduces no new types or layers, and follows the exact same pattern already established for dropdown, date picker, and rich text editor detection. The downstream pipeline (evidence annotation, domain adapter, enrichment, IR bridge, Playwright generation, assertions) is completely unchanged.

R2 is the last structural detection expansion. R3 takes over for implementations that have no recognizable structural signals at all.

---

*End of R2 Design Document.*

# Tier 2 — Framework Coverage Design Document

**Status:** Draft for review
**Scope:** Extend Pattern Registry coverage to Bootstrap, AGGrid, Radix, Chakra
**Constraint:** Refactoring only — no new features, no observation model changes

---

## 1. Problem Statement

The expanded validation (53 observations across 7 frameworks) identified **8 P2 findings** from frameworks with missing or incomplete Pattern Registry plugins:

| Finding | Framework | Root Cause |
|---------|-----------|------------|
| FW-BS-01 | Bootstrap | Dropdown uses `dropdown-toggle` CSS class — not registered |
| FW-BS-02 | Bootstrap | Modal surface detected but no trigger patterns |
| FW-RDX-01 | Radix | DropdownMenu uses `menu`/`menuitem` roles — not in dropdown trigger detection |
| FW-RDX-02 | Radix | Dialog portal breaks ancestor-based surface detection |
| FW-CHK-02 | Chakra | Modal contents not captured (portal issue) |
| FW-AGG-01 | AGGrid | Grid cell classified as generic Click — no grid-specific semantics |
| FW-AGG-02 | AGGrid | Header sort detected as Click (post-T1-1) but no sort intent |

All share one root cause: **the Pattern Registry has no CSS class or role patterns for these frameworks**, so the Dropdown/Click definitions fall back to generic ARIA detection, which works for standard roles but fails for framework-specific patterns.

---

## 2. Architectural Approach

### 2.1 Core Principle: Framework Knowledge Stays in the Registry

The recorder's core pipeline — Component Runtime, definitions, IR Bridge, Enrichment Pass — is and remains **completely framework-agnostic**. No framework-specific logic enters the runtime, the definitions, or the IR Bridge.

Framework knowledge lives in exactly two places:
1. **PatternRegistry** (`pattern-registry.ts`) — CSS class patterns that tell definitions "this element is a dropdown trigger / option / surface"
2. **`patterns.ts`** — ARIA role/tag sets that tell definitions "this role means interactive / dropdown / datepicker"

Tier 2 adds data to both without changing any pipeline code.

### 2.2 Three Extension Mechanisms (No Code Changes to Pipeline)

Tier 2 uses three existing extension points. No new mechanisms are needed:

| Mechanism | What it extends | How | Used for |
|-----------|----------------|-----|----------|
| **CSS class patterns** | `FrameworkPatterns` plugin objects | Add class strings to existing arrays in `pattern-registry.ts` | Bootstrap, AGGrid |
| **ARIA role sets** | `INTERACTIVE_ROLES`, `DROPDOWN_TRIGGER_ROLES` in `patterns.ts` | Add roles to existing `Set` constants | Radix (menu roles) |
| **Surface patterns** | `surfacePatterns` in `FrameworkPatterns` | Add regex objects | Bootstrap modal, Chakra modal |

No new interfaces, no new pipeline stages, no changes to `ComponentDefinition`, `ComponentRuntime`, `IRBridge`, or `EnrichmentPass`.

### 2.3 What This Design Does NOT Do

Three things are explicitly out of scope:

1. **Attribute-based detection** (`data-bs-toggle`, `data-state`). The observation model (`ElementIdentity`) does not capture arbitrary data attributes. Adding this requires an observation model change — deferred to a future phase. Section 9 explains why CSS classes + ARIA roles are sufficient for Tier 2.

2. **Portal-aware surface detection refactor.** The `surfaceId` tracker already handles portals. The `ancestorClasses` fallback does not, and we will not attempt to fix it. Radix portal issues are acknowledged as a known limitation.

3. **Unification of PatternRegistry and `component-detector.ts`.** These are two separate systems with different jobs (boolean oracle vs framework classifier). Unifying them is architecturally desirable but not required for Tier 2. Section 8 addresses this as a future refinement.

---

## 3. Plugin Specifications

### 3.1 Bootstrap Plugin (T2-3) — Highest Confidence

**Problem:** Bootstrap dropdowns produce 2× Click instead of 1 Dropdown.

**Root cause:** `BOOTSTRAP_PATTERNS` (lines 196-204 of `pattern-registry.ts`) registers only `surfacePatterns` for modal/popover. No dropdown trigger, option, or surface CSS classes.

**Fix:** Expand `BOOTSTRAP_PATTERNS` with:

```typescript
const BOOTSTRAP_PATTERNS: FrameworkPatterns = {
  name: 'Bootstrap',
  // ── Dropdown ──
  dropdownTriggerClasses: ['dropdown-toggle'],     // .dropdown-toggle on trigger button
  dropdownOptionClasses: ['dropdown-item'],         // .dropdown-item on menu options
  dropdownSurfaceClasses: ['dropdown-menu'],        // .dropdown-menu on open listbox
  // ── Existing surface patterns (unchanged) ──
  surfacePatterns: [
    // ... existing modal/popover patterns
  ],
};
```

**Why this works:** Bootstrap adds these CSS classes via its JavaScript initialization — they are present on the rendered DOM regardless of whether the developer used `data-bs-toggle` or manual JavaScript. The classes are stable across Bootstrap 4 and 5.

**Confidence:** HIGH. These are documented, stable CSS classes in Bootstrap's public API.

### 3.2 AGGrid Plugin (T2-2) — High Confidence

**Problem:** AGGrid cells classified as generic Click. Header sort produces a Click but no sort intent.

**Root cause:** No PatternRegistry plugin for AGGrid. Grid cells have `role="gridcell"` (now recognized as interactive after T1-1) but no dropdown/date patterns.

**Fix:** Register new `AGGRID_PATTERNS`:

```typescript
const AGGRID_PATTERNS: FrameworkPatterns = {
  name: 'AGGrid',
  interactiveClasses: [
    'ag-header-cell',      // sortable column headers
    'ag-header-cell-label',
    'ag-row',              // selectable rows
    'ag-cell',             // interactive cells
  ],
  // No dropdown/datePicker patterns — AGGrid uses native browser
  // controls for cell editing, not custom dropdowns.
};
```

**Why this works:** AGGrid uses predictable, version-stable CSS class prefixes (`ag-*`). These classes are documented in AGGrid's theming API and are present on every grid instance.

**Limitation:** Sort intent detection (clicking a header to sort) will still produce a generic Click interaction. Recognizing sort intent requires reading `aria-sort` attribute changes, which is a capability extension (Tier 3), not a framework pattern.

**Confidence:** HIGH. AGGrid CSS classes are stable and well-documented.

### 3.3 Radix UI (T2-1) — Medium Confidence

**Problem:** Radix DropdownMenu produces 2× Click. Radix Dialog portal breaks surface detection.

**Root cause:** Radix uses standard ARIA roles but in patterns the Dropdown definition doesn't recognize:
- DropdownMenu trigger: `role="button"` (detected as interactive, but not as dropdown trigger)
- DropdownMenu content: `role="menu"` containing `role="menuitem"` / `role="menuitemcheckbox"`
- The trigger opens a portal to `document.body`, breaking `ancestorClasses`-based surface detection

**Fix — Part A: Role expansion in `patterns.ts`:**

Add `menu` to dropdown trigger detection. When a `role="button"` element has `aria-haspopup="menu"`, it should be recognized as a dropdown trigger:

```typescript
// In patterns.ts, DROPDOWN_TRIGGER_ROLES:
const DROPDOWN_TRIGGER_ROLES = new Set([
  'combobox', 'listbox',
  // Add: Radix/Headless UI dropdown menus use aria-haspopup="menu"
  // The existing ariaHasPopup check already handles this value,
  // but the role-based path doesn't. Adding "menu" ensures the
  // Dropdown definition claims these triggers.
]);
```

Actually, reviewing the code more carefully: the Dropdown definition's `detectTrigger` already checks `ariaHasPopup` (line 371). If Radix sets `aria-haspopup="menu"` on the trigger, the existing code path should work. The validation finding (FW-RDX-01) shows 2× Click, which suggests either:
- Radix doesn't set `aria-haspopup` on the trigger (it may set it on a child element), OR
- The `menu`/`menuitem` roles in the open panel aren't recognized as dropdown options

**Fix — Part B: Menu option recognition:**

Add `menuitem`, `menuitemcheckbox`, `menuitemradio` to `DROPDOWN_OPTION_ROLES` in `patterns.ts`:

```typescript
const DROPDOWN_OPTION_ROLES = new Set([
  'option',
  // Add: Radix/Headless UI menu items behave as dropdown options
  'menuitem', 'menuitemcheckbox', 'menuitemradio',
]);
```

This ensures that when the Dropdown session is active and a `menuitem` is clicked, it's classified as a `selectOption` subAction rather than a separate Click.

**Portal limitation:** When Radix portals the menu content to `document.body`, the `ancestorClasses` mechanism can't connect the option back to the trigger. The `surfaceId` tracker is the viable path — it assigns a surface ID when the menu opens and matches subsequent events within that surface. **If `surfaceId` is not populated by the content script for Radix portals, this fix will not work end-to-end.** This must be validated with browser testing.

**Confidence:** MEDIUM. Role-based fixes are architecturally sound, but the portal surface binding needs browser validation. The validation harness cannot test this because it doesn't simulate DOM surface creation.

### 3.4 Chakra UI (T2-4) — Low Confidence

**Problem:** Chakra modal contents not captured.

**Root cause:** Chakra uses Emotion CSS-in-JS with hashed class names (`css-abc123`). These are already filtered by `isCssInJsClass`. Chakra's modal content is portaled, same issue as Radix.

**Fix:** No CSS class patterns are reliable for Chakra (hashed class names). Chakra does set some predictable classes in certain components (`chakra-select__wrapper` in older versions), but these are not stable across versions.

**Assessment:** Chakra's native `<select>` already works (detected via `change` event, FW-CHK-01). The modal issue (FW-CHK-02) is a portal/surface problem identical to Radix's — not a CSS class problem.

**Recommendation:** **Defer Chakra to browser validation.** The fix is the same surface-tracking mechanism that Radix needs. Once portal surfaces work for Radix, they work for Chakra. No separate Chakra plugin is needed at this time.

---

## 4. Pattern Registry Refinements

Three refinements to `pattern-registry.ts` improve correctness and performance without changing the API contract:

### 4.1 Word-Boundary Matching (Correctness Fix)

**Current:** `buildRegex` joins patterns with `|` in a non-capturing group, case-insensitive, with no anchoring. Pattern `select` matches `preselected`.

**Fix:** Add word boundaries:
```typescript
private static buildRegex(patterns: string[]): RegExp | null {
  if (patterns.length === 0) return null;
  const escaped = patterns.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  // Use word boundaries to prevent false-positive substring matches.
  // Pattern "select" matches "MuiSelect" (boundary before 's') but not "preselected".
  return new RegExp(`(?:\\b${escaped.join('|')}\\b)`, 'i');
}
```

**Risk:** This is a behavioral change. Existing patterns that relied on substring matching may stop matching. Must run full golden master + validation suite to confirm no regressions. If any pattern breaks, the pattern string should be made more specific (e.g., `select` → `MuiSelect`).

**Mitigation:** Run golden master (131 tests) + full validation suite (99 tests) after this change. Any snapshot changes indicate a pattern that relied on substring matching.

### 4.2 Regex Caching (Performance Fix)

**Current:** `buildRegex` is called on every `is*Class` invocation. For a page with 100 events, each calling `isInteractiveElement` (which calls `isInteractiveClass`), this means 100 regex compilations.

**Fix:** Cache compiled regexes in a `Map<string, RegExp>` keyed by the patterns array hash:

```typescript
private static regexCache = new Map<string, RegExp>();

private static buildRegex(patterns: string[]): RegExp | null {
  if (patterns.length === 0) return null;
  const key = patterns.join('\0');
  const cached = PatternRegistry.regexCache.get(key);
  if (cached) return cached;
  // ... build regex ...
  PatternRegistry.regexCache.set(key, regex);
  return regex;
}
```

Cache is invalidated automatically when `merged` is nullified by `registerPlugin`.

### 4.3 Dead Code Removal (Cleanup)

Remove three dead code paths:
1. `inferRoleFromClassName` method (line 412) — zero callers
2. `classRoleMap` field from `FrameworkPatterns` interface and all plugins — only consumed by `inferRoleFromClassName`
3. Stale docstring examples (`create()`, `registerPlugin('name', {...})` signatures that don't exist)

Also audit `surfacePatterns` — if no `is*Class` method consumes them, either add a `isSurfaceClass` method or remove them. Based on the researcher's finding that they are registered but never queried through the PatternRegistry API, they appear to be vestigial from before the merge refactor. If the surface detection code in `component-runtime.ts` uses a different path (it does — via `surfaceId`), these patterns are dead.

---

## 5. Responsibility and Boundary Model

### 5.1 What Each Layer Owns

```
┌─────────────────────────────────────────────────┐
│ Component Runtime (framework-agnostic)          │
│  • Event dispatch, lifecycle, dedup, surfaces   │
│  • Does NOT know about frameworks               │
├─────────────────────────────────────────────────┤
│ Definitions (framework-agnostic logic)          │
│  • dropdown.ts, click.ts, date-picker.ts, etc.  │
│  • Calls patterns.ts helpers                    │
│  • Does NOT know about frameworks               │
├─────────────────────────────────────────────────┤
│ patterns.ts (framework-agnostic facade)         │
│  • ARIA role/tag Sets                           │
│  • Delegates to PatternRegistry as last resort  │
│  • Does NOT know about frameworks               │
├─────────────────────────────────────────────────┤
│ PatternRegistry (framework knowledge layer)     │
│  • CSS class pattern matching                   │
│  • Plugin registration                          │
│  • KNOWS about frameworks (via plugin data)     │
├─────────────────────────────────────────────────┤
│ Framework Plugins (data, not code)              │
│  • MUI_PATTERNS, AGGRID_PATTERNS, etc.          │
│  • Pure data objects — no logic                 │
└─────────────────────────────────────────────────┘
```

### 5.2 Plugin Contract

Every plugin is a `FrameworkPatterns` object — pure data, no logic, no methods. A plugin specifies:

| Responsibility | How |
|----------------|-----|
| Identify dropdown triggers | `dropdownTriggerClasses: string[]` |
| Identify dropdown options | `dropdownOptionClasses: string[]` |
| Identify dropdown surfaces | `dropdownSurfaceClasses: string[]` |
| Identify date picker triggers | `datePickerTriggerClasses: string[]` |
| Identify calendar cells | `datePickerCellClasses: string[]` |
| Identify interactive elements | `interactiveClasses: string[]` |
| Identify surface containers | `surfacePatterns: Array<{regex, type}>` |

A plugin does NOT specify:
- How triggers are detected (the definition handles this)
- How options are classified (the definition handles this)
- How surfaces are tracked (the runtime handles this)
- What IR action to produce (the IR Bridge handles this)
- What Playwright code to generate (the action renderer handles this)

### 5.3 Boundary Against Framework-Specific Logic

The design rule is: **if a framework needs custom logic beyond CSS class/ARIA role data, it needs a new ComponentDefinition, not a Pattern Registry plugin.**

For example, AGGrid sort detection (clicking a header to toggle sort direction) requires reading `aria-sort` attribute changes across two events — this is logic, not pattern matching. It would require either a new `GridDefinition` or an extension to the Click definition's metadata extraction. This is explicitly out of scope for Tier 2.

---

## 6. Framework Detection, Priority, and Conflict Resolution

### 6.1 Current Model: Union with No Priority

All patterns from all plugins are unioned into a single merged `FrameworkPatterns` object. When multiple frameworks could match, the regex returns true if **any** pattern matches. There is no priority, no first-match-wins, no conflict resolution.

This is **correct for the boolean-oracle model**. The question PatternRegistry answers is "is this element a dropdown trigger?" — not "which framework's dropdown trigger is this?". Framework attribution is a separate concern handled by `component-detector.ts`.

### 6.2 Why No Priority Is Needed for Tier 2

CSS class patterns are naturally framework-specific:
- `dropdown-toggle` (Bootstrap) will never appear on an MUI element
- `ag-header-cell` (AGGrid) will never appear on an Ant Design element
- `MuiSelect` will never appear on a Bootstrap element

False positives from the GENERIC tier (`select`, `dropdown`, `combobox`) are the only risk. The word-boundary fix (§4.1) mitigates this by preventing substring false-positives.

### 6.3 When Priority Would Be Needed

Priority/conflict resolution would become necessary if:
1. Two frameworks share the same CSS class prefix (unlikely — frameworks differentiate via prefixes)
2. A generic pattern false-positives on a specific framework's class (mitigated by word boundaries)
3. Framework-specific definitions need to override generic behavior (requires a new definition, not registry priority)

None of these apply to Tier 2. **No priority mechanism is needed.**

### 6.4 Fallback Chain (Unchanged)

The existing fallback chain in `patterns.ts` remains:

```
ARIA role check (fastest, most reliable)
    ↓ miss
Tag name check
    ↓ miss
tabIndex check
    ↓ miss
PatternRegistry CSS class check (last resort)
```

This ensures that standards-compliant elements (correct ARIA roles) are detected before falling back to CSS class heuristics. Framework plugins only fire when ARIA and tag checks fail — which is exactly when CSS class patterns are most valuable.

---

## 7. Integration with Existing Systems

### 7.1 Component Runtime — No Changes

The runtime dispatches events to definitions and manages lifecycles. It never calls PatternRegistry. **No changes needed.**

### 7.2 Definitions — Minimal Changes

| Definition | Change | Details |
|-----------|--------|---------|
| `patterns.ts` | Add roles | `menuitem`, `menuitemcheckbox`, `menuitemradio` to `DROPDOWN_OPTION_ROLES` for Radix |
| `patterns.ts` | Add roles | `menu` to interactive/dropdown detection if needed |
| All other definitions | No changes | They use `patterns.ts` wrappers, which automatically benefit from new registry data |

### 7.3 Pattern Registry — Data + Refinements

| Change | Type |
|--------|------|
| Expand `BOOTSTRAP_PATTERNS` with dropdown classes | Data addition |
| Register new `AGGRID_PATTERNS` plugin | Data addition |
| Word-boundary matching in `buildRegex` | Correctness fix |
| Regex caching | Performance fix |
| Dead code removal | Cleanup |

### 7.4 Interaction Enrichment Pass — No Changes

The Enrichment Pass operates on `ComponentInteraction[]` after classification. Framework detection (`component-detector.ts`) already identifies all 7 frameworks (MUI, Ant, Radix, Chakra, AGGrid, etc.) via its own regex system. **No changes needed.**

### 7.5 IR Bridge — No Changes

The IR Bridge maps interaction types to IR actions. New framework patterns produce the same interaction types (Dropdown, Click) that the IR Bridge already handles. **No changes needed.**

### 7.6 Evidence Engine — No Changes

The evidence engine annotates interactions with intent/confidence. It uses `TYPE_TO_INTENT` mapping, not framework-specific data. **No changes needed.**

---

## 8. Validation Strategy

### 8.1 Pre-Implementation Baseline

Before any changes, capture the current test outputs:

| Check | Current State |
|-------|---------------|
| Golden master | 131/131 pass |
| Validation harness | 99/99 pass |
| Full test suite | 3044/3045 (1 flaky benchmark) |
| tsc --noEmit | 0 src errors |

### 8.2 Per-Step Verification

Each plugin addition is verified independently:

**Step 1: Bootstrap plugin**
- Run `framework-patterns.test.ts` → FW-BS-01 should improve from 2× Click to 1× Dropdown
- Run golden master → no snapshot changes expected (no Bootstrap fixtures in golden master)
- Run full suite → no regressions

**Step 2: AGGrid plugin**
- Run `framework-patterns.test.ts` → FW-AGG-01 classification unchanged (already Click), but Q1 may improve
- Run golden master → no changes expected
- Run full suite → no regressions

**Step 3: Radix role expansion**
- Run `framework-patterns.test.ts` → FW-RDX-01 may improve
- Run golden master → check for changes (if any golden fixtures use `menuitem` roles)
- Run full suite → no regressions

**Step 4: Pattern Registry refinements (word boundaries, caching)**
- Run golden master → **critical checkpoint**: any snapshot changes indicate patterns that relied on substring matching
- Run full suite → no regressions
- Run validation harness → no regressions

**Step 5: Dead code removal**
- Run tsc → 0 src errors
- Run full suite → no regressions

### 8.3 Regression Gates

| Gate | Criterion |
|------|-----------|
| G1 | tsc --noEmit: 0 src errors |
| G2 | Golden master: 131/131 pass |
| G3 | Validation harness: 99/99 pass |
| G4 | Full test suite: ≥3044/3045 pass |
| G5 | No new framework test failures |

### 8.4 What We Cannot Validate

- **Portal surface binding** (Radix/Chakra): The validation harness doesn't simulate DOM surfaces. Portal behavior must be validated with browser testing in a future round.
- **Real framework versions**: Tests use static CSS class fixtures. Framework version updates may change class names.
- **Sort intent** (AGGrid): Requires `aria-sort` attribute tracking across events — not testable with current harness.

---

## 9. Assumptions, Limitations, Risks

### 9.1 Assumptions

1. **Bootstrap CSS classes are present on rendered DOM.** The `dropdown-toggle`, `dropdown-menu`, `dropdown-item` classes are added by Bootstrap's CSS/JS and are present regardless of initialization method. Assumed stable across Bootstrap 4 and 5.

2. **AGGrid CSS classes use `ag-` prefix.** This is documented in AGGrid's theming API and stable across versions.

3. **Radix sets `aria-haspopup` on trigger elements.** Radix UI components are built on ARIA compliance. If a specific Radix version omits `aria-haspopup`, the role-based fix won't work.

4. **CSS class signals are sufficient without attribute matching.** Bootstrap and AGGrid have reliable CSS class signals. Radix relies on ARIA roles (already captured). No framework in Tier 2 requires `data-*` attribute matching.

### 9.2 Limitations

1. **Portal surfaces remain a known gap.** Radix and Chakra portal their overlays to `document.body`. The `surfaceId` tracker is designed for this but operates independently of PatternRegistry. If `surfaceId` is not populated for portal content, dropdown option clicks inside portals will produce separate Click interactions instead of Dropdown subActions. **This cannot be fixed with Pattern Registry plugins — it requires content script changes.**

2. **Sort intent not detected for AGGrid.** Clicking an AGGrid header to sort produces a Click interaction with no sort semantics. Detecting sort intent requires reading `aria-sort` attribute transitions, which is a capability extension.

3. **Chakra deferred.** Chakra's hashed CSS class names are not reliably predictable. Modal surface detection requires the same portal fix as Radix. No standalone Chakra plugin is proposed.

4. **Substring false positives possible.** Even with word boundaries, a pattern like `dropdown` could match `my-custom-dropdown-thing`. The risk is low because framework CSS classes are typically prefixed, but monitoring is needed.

### 9.3 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Word-boundary change breaks existing pattern matches | Medium | High (golden master regression) | Run golden master after change; fix any broken patterns individually |
| Radix roles don't have `aria-haspopup` on trigger | Medium | Medium (fix won't work) | Validate with Radix documentation; if missing, fall back to `role="menuitem"` detection |
| Regex caching introduces stale-match bug | Low | High (wrong classification) | Invalidate cache on `registerPlugin`; cache key is the joined pattern array |
| Bootstrap class names differ between v4/v5 | Low | Low (most apps on v5) | Test with both class name variants if available |

### 9.4 Future Extension Points

1. **Attribute-based detection**: Adding `data-*` attribute capture to the observation model would enable `data-bs-toggle` (Bootstrap), `data-state` (Radix), and `data-value` (various) detection. This is the highest-value observation model extension for framework coverage.

2. **PatternRegistry ↔ component-detector unification**: Currently two disconnected systems. Unifying them would let definitions know which framework they're dealing with, enabling framework-specific lifecycle behavior (e.g., Radix's portal-aware dropdown completion).

3. **Runtime plugin registration**: The `registerPlugin` API supports runtime registration but nothing uses it. A future extension could let the content script detect the framework on page load and register only the relevant plugin, reducing false-positive risk.

4. **Pattern certification pipeline**: The `.drytis/RECORDER_CERTIFICATION_FRAMEWORK.md` document describes a certification gate where new plugins must pass a test suite. This could be formalized as a CI check.

---

## 10. Implementation Order

Ordered by confidence and dependency:

| Step | Task | Confidence | Depends On |
|------|------|-----------|------------|
| 1 | Bootstrap plugin (CSS classes) | HIGH | None |
| 2 | AGGrid plugin (CSS classes) | HIGH | None |
| 3 | Radix role expansion (patterns.ts) | MEDIUM | None |
| 4 | Word-boundary matching refinement | MEDIUM (regression risk) | Steps 1-3 (patterns must be correct before changing matcher) |
| 5 | Regex caching | HIGH | Step 4 |
| 6 | Dead code removal | HIGH | Step 5 |
| 7 | Validation re-run + regression gates | — | Steps 1-6 |

Each step maintains the repository in a working state with all tests passing.

---

## 11. Summary

Tier 2 is a **data-driven extension** — it adds CSS class patterns and ARIA roles to the existing Pattern Registry without changing any pipeline code. The core recorder remains framework-agnostic. The Pattern Registry refinements (word boundaries, caching, dead code removal) improve correctness and performance but are independent of the plugin additions.

The design deliberately defers three things:
1. **Attribute-based detection** (observation model change)
2. **Portal surface tracking** (content script change)
3. **Sort intent detection** (capability extension)

These deferrals are documented as known limitations, not oversights. They represent the boundary between what Pattern Registry plugins can achieve (CSS class + ARIA role matching) and what requires deeper system changes.

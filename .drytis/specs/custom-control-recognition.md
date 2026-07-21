# Custom Control Recognition Expansion

## Goal

Expand Control Recognition from native HTML controls to modern custom UI components (React, Material UI, Ant Design, Headless UI, Radix UI, custom enterprise widgets). Currently the recorder correctly identifies native HTML controls (AvisFord) but misses custom/framework-built controls (AdaniOne) that use `<div onClick>` with hashed CSS classes and no ARIA roles.

## Root Cause

Three signal layers exist: DOM tags (DomProvider), ARIA roles (AriaProvider), CSS classes (CssClassnameProvider). Custom controls that emit none of these signals fall through to generic `Click` at confidence 0.60.

## Architecture Constraints

- **No new providers** — extend existing evidence providers with new detection paths
- **No interface changes** — provider `onEvent()` / `onCommit()` signatures unchanged
- **No data model changes** — InteractionMetadata fields unchanged
- **No recording behavior changes** — content script / recorder event capture unchanged
- **Backward compatible** — all existing 2,335 tests must pass
- **Weighted voting preserved** — new evidence feeds into the same `EvidenceEngine.merge()` pipeline

## Implementation Phases

### Phase 1: CssClassnameProvider Expansion

**Files to change:**
- `src/classifier/evidence/providers/css-classname-provider.ts`
- `tests/evidence-engine/css-classname-provider-custom.test.ts` (new)

**Acceptance Criteria:**

- [ ] Headless UI patterns detected: `headlessui-listbox`, `headlessui-combobox`, `headlessui-menu`, `headlessui-disclosure`
- [ ] Radix UI data-attribute detection: `data-radix-collection-item`, `data-radix-popper-content-wrapper` (via className-adjacent attribute matching in DomProvider if Radix uses data attributes — but for CssClassnameProvider, match `radix-` prefixed classes if present)
- [ ] React-Select patterns detected: `select__control`, `select__option`, `select__value-container`
- [ ] react-datepicker patterns detected: `react-datepicker__day`, `react-datepicker__month`, `react-datepicker`
- [ ] Broader generic substring matching: any class token containing `dropdown`, `select`, `picker`, `calendar`, `combobox`, `listbox`, `popover`, `menu-item` as a substring or word boundary match
- [ ] CSS-in-JS hashed classes (`css-*`) explicitly excluded — NOT falsely matched
- [ ] All existing CSS classname provider tests pass
- [ ] New patterns have confidence ≤ 0.75 and weight ≤ 0.65 (lower than ARIA/framework-specific, higher than generic Click 0.60)

### Phase 2: MutationProvider Behavioral Lifecycle Detection

**Files to change:**
- `src/classifier/evidence/providers/mutation-provider.ts`
- `tests/evidence-engine/mutation-provider-lifecycle.test.ts` (new)

**Acceptance Criteria:**

- [ ] Dropdown lifecycle: trigger click → popup container appears (mutation: childList added) → option click → container disappears (mutation: childList removed) → evidence for `CustomDropdown` at confidence ≥ 0.65, weight ≥ 0.55
- [ ] Calendar lifecycle: trigger click → grid container appears (mutation: childList added) → cell click → container disappears → evidence for `DatePicker` at confidence ≥ 0.65, weight ≥ 0.55
- [ ] Autocomplete lifecycle: input focus → typing events → suggestions appear (mutation: childList added) → option click → value change → evidence for `Autocomplete` at confidence ≥ 0.65, weight ≥ 0.55
- [ ] Lifecycle detection works WITHOUT any ARIA roles on trigger or options
- [ ] Lifecycle detection works WITHOUT any CSS framework classes
- [ ] Lifecycle detection works WITHOUT `<select>` or `<input type="date">`
- [ ] Lifecycle evidence is committed via `onCommit()` (buffer-level), not `onEvent()` (per-event)
- [ ] Native dropdowns (`<select>`) are NOT double-classified (existing ARIA/DomProvider evidence at higher confidence wins)
- [ ] All existing mutation provider tests pass

### Phase 3: DomProvider Structural Heuristics

**Files to change:**
- `src/classifier/evidence/providers/dom-provider.ts`
- `tests/evidence-engine/dom-provider-structural.test.ts` (new)

**Acceptance Criteria:**

- [ ] Grid pattern detection: parent container with ≥7 children arranged as date-like cells (numeric text content) → weak `DatePicker` evidence at confidence ≥ 0.55, weight ≥ 0.50
- [ ] Trigger+popup structural relationship: element with `aria-expanded` OR visible popup sibling/child that appears on click → enhanced dropdown context (but ONLY when ARIA is absent; if `aria-expanded` is present, AriaProvider already handles it at higher confidence)
- [ ] Data attribute signals: `data-value`, `data-index`, `data-key`, `data-testid` containing dropdown/option/date keywords → weak evidence
- [ ] Structural evidence does NOT conflict with stronger evidence from other providers
- [ ] All existing DomProvider tests pass

### Phase 4: Tests & Regression

**Acceptance Criteria:**

- [ ] ≥40 new tests across the three phases
- [ ] All 2,335 existing tests pass
- [ ] Build succeeds (vite build)
- [ ] No new TypeScript errors
- [ ] Reviewer PASS
- [ ] Infra_verifier PASS

## Test Cases — Key Scenarios

### Phase 1 Tests (CssClassnameProvider)
1. Headless UI listbox option class → CustomDropdown
2. Headless UI combobox class → Autocomplete
3. React-Select control/option classes → CustomDropdown/Autocomplete
4. react-datepicker day cell → DatePicker
5. Generic `dropdown-trigger` class → CustomDropdown
6. Generic `calendar-day` class → DatePicker
7. Hashed `css-1abc2de` class → NO false match (Click or Unknown)
8. All existing framework patterns (MUI/AntD/Bootstrap) still work

### Phase 2 Tests (MutationProvider Lifecycle)
9. Div-based dropdown lifecycle: click trigger → list appears → click option → list disappears → CustomDropdown
10. Calendar lifecycle: click trigger → grid appears → click cell → grid disappears → DatePicker
11. Autocomplete lifecycle: type in input → suggestions appear → click option → value changes → Autocomplete
12. Lifecycle without ARIA roles or CSS classes
13. Native `<select>` interaction does NOT trigger lifecycle false positive
14. Simple button click (no mutation) does NOT trigger lifecycle false positive

### Phase 3 Tests (DomProvider Structural)
15. 7-column grid with numeric cell text → DatePicker structural evidence
16. `data-value="option1"` on a clicked div → weak CustomDropdown context
17. `data-testid="city-option"` → CustomDropdown context
18. Structural evidence yields to ARIA evidence when both present

## Out of Scope

- Content script changes (recorder event capture unchanged)
- New evidence providers (extending existing 5)
- InteractionMetadata field additions
- V1 detector changes (V2 engine is primary path)
- Closed Shadow DOM support
- Cross-origin iframe control detection

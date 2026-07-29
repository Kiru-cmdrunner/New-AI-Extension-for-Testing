# Reference Implementation Analysis — Commit 9976ff8 (v10.9.0)

## Source: `upstream/main` at `9976ff8` — "feat: three-layer enrichment model"

### Commit chain since working-better (f546cef):
- bdc16fa: OXD radio, checkbox, date picker detection + health check debounce
- 5502c60: diag logging for radio/date/checkbox
- 4e2f2d7: **fix: radio noOpSelection always false + date picker blur completion**
- 57583b9: content script injection path + session context URL capture
- 80c1b79: **fix: content script missing PING handler (root cause of "tab not responding")**
- 5905634: **feat: Slider, Tab, FileUpload definitions + fix checkbox double-capture**
- 9976ff8: **feat: three-layer enrichment model**

### Packaged Extension Verification
- Downloaded ZIP from ref subdomain (272KB), version 10.9.0
- Manifest permissions: sidePanel, storage, unlimitedStorage, activeTab, webNavigation, tabs, scripting, alarms
- Content script registered via manifest content_scripts
- SW bundle (42KB) contains: noOpSelection (5), shouldCancelOnOutside (5), shouldCompleteOnOutside (6), selectedDate (14), componentFramework (5), businessMeaning (4), OXD wrapper classes
- **Packaged extension matches source code** ✓

---

## Interaction Handling Improvements (v10.9.0 vs working-better)

### 1. Checkbox Double-Capture Fix [commit 5905634]
**Problem**: Browser fires both `click` AND `change` for checkbox toggles → two interactions captured.
**Fix**: Removed `change` from `triggerEventTypes`. Only `{click}`.
**Pre-click activation**: `checkedBefore` captured at click time is the NEW state (browser sets checked=true before click fires). Use directly without negation.
**Cross-element dedup**: Same accessibleName within 2s window = duplicate (OXD label→input synthetic click).
**Our status**: We already handle single-event recognition. Need cross-element dedup.

### 2. Radio Button noOpSelection Fix [commit 4e2f2d7]
**Problem**: `checkedBefore` was always `true` at click time due to pre-click activation → every radio click was filtered as no-op.
**Fix**: `noOpSelection` hardcoded to `false`. Radios can only be turned ON, so every click is a real selection.
**Cross-element dedup**: Same as checkbox (same-name within 2s).
**Our status**: We don't have this bug (no noOpSelection logic in Phase 5). ✓

### 3. Date Picker Blur Completion [commit 4e2f2d7]
**Problem**: OXD date fields are text inputs → user types a date then clicks away. No calendar cell click → no completion → 15s timeout → abandoned with no value.
**Fix**: Added `blur` completion path: if dateValue non-empty on blur → complete. If empty → abandon.
**Navigation button rejection**: Calendar prev/next/switch buttons are lifecycle-internal (return null, stay active). Class RE: `oxd-calendar-switch-button|calendar.*nav|prev|next|today|switch|chevron`.
**Our status**: Our lifecycle engine doesn't handle multi-completion-mode lifecycles. **ADOPT blur completion**.

### 4. Scroll Burst Coalescing [commit f546cef, carried into v10.9.0]
**Problem**: Each scroll event produced a separate interaction → "4 Scroll interactions for one gesture".
**Fix**: Scroll is now a lifecycle component with 500ms burst gap coalescing. `shouldCompleteOnOutside: true` (any non-scroll event finalizes the gesture).
**Delta**: Accumulated `lastScrollY - firstScrollY`, `hasDelta` filter.
**Our status**: Our scroll is immediate pass-through. **ADOPT burst coalescing**.

### 5. Dropdown No-Op Detection
**Problem**: Opening dropdown and selecting the already-selected option shouldn't be a test step.
**Fix**: `normalizeDisplayValue(selectedValue) === normalizeDisplayValue(triggerDisplay) && normalizedSelected !== ''`. Uses `||` not `??` for accessibleName (empty string fallthrough).
**Our status**: We don't have no-op detection. **ADOPT** — a QA engineer would not write "select the already-selected option".

### 6. Text Entry Outside-Click Cancellation
**Nuance**: `shouldCancelOnOutside` returns true ONLY for `click`, NOT for `mousedown`. Browser order is `mousedown → blur → click`. Cancelling on mousedown would abandon before blur completes.
**Our status**: Our text entry is self-committing (value captured at activation). Less relevant but **note for when wiring**.

### 7. Three-Layer Enrichment Model [commit 9976ff8]
**Layer 1**: Interaction Type (from runtime — Dropdown, TextEntry, Click, etc.)
**Layer 2**: Component Type (DataGrid, IconButton, SortButton, etc.) — via `detectComponent()`
  - Framework detection: 13 frameworks (MUI, AntDesign, OXD, etc.) via class regex
  - 26 component types via cascading first-match-wins rules
  - Icon button detection: no accessibleName → extract semantic name from icon classes
  - ICON_SEMANTIC_NAMES: maps fa-close→Close, fa-trash→Delete, fa-pencil→Edit, etc.
**Layer 3**: Business Meaning — `resolveMeaning()` generates human-readable string
  - Component-type-specific first (e.g., SortButton → "Sort by ${column}")
  - Interaction-type fallback (e.g., TextEntry → "Enter "${val}" in "${name}"")

### 8. DOM Context Extractor
Runs in content script at capture time. Extracts: inputType, ariaExpanded, ariaHasPopup, isContentEditable, disabled, readOnly, required, ancestorRoles (depth 10), ancestorClasses (depth 10).
**All downstream definitions operate on serialized strings, never live DOM.**
**Our status**: Our Phase 3 EventTap extracts similar fields. Need to verify ancestor extraction.

### 9. Priority-Based Discovery (Click is fallback, priority 180)
Click (priority 180) is separated from non-click definitions. Only tried as fallback after all others fail. `isInteractiveElement` check rejects bare divs/spans.
**Our status**: We have immediate verbs but no priority system for discovery. Our `findActivatingDefinition` uses first-match.

### 10. Per-Type Temporal Dedup
- 2000ms window, per-type (interleaved types don't reset each other)
- Checkbox/Radio: same accessibleName + different elementKey = duplicate
- DatePicker: also compares selectedDate (different dates not suppressed)
- Scroll: exempt (burst coalescing handles it)
- seenEventIds cap 500 (halved when exceeded)
**Our status**: We don't have temporal dedup. **ADOPT**.

---

## Comparison with Our Declarative Pipeline

| Behaviour | v10.9.0 Reference | Our Phase 1-5 | Assessment |
|-----------|-------------------|---------------|------------|
| Checkbox trigger events | `{click}` only | Single pattern match | ✓ Aligned |
| Checkbox pre-click activation | checkedBefore = NEW state | Not relevant (pattern-based) | N/A |
| Radio noOpSelection | Hardcoded false | No noOp logic | ✓ No bug |
| Date picker completion modes | 3 modes (cell/blur/change) | Single activate→commit | **GAP** |
| Date picker nav buttons | Rejected as lifecycle-internal | Not handled | **GAP** |
| Scroll burst coalescing | 500ms lifecycle + complete-on-outside | Immediate pass-through | **GAP** |
| Dropdown no-op detection | Normalized display value compare | None | **GAP** |
| Text entry cancel timing | click-only (not mousedown) | Self-commit (N/A) | N/A |
| Hover confidence model | Weighted evidence (100/70/60/50) | Threshold 0.5 | **DIFFERENT** |
| Three-layer enrichment | Full (26 types, 13 frameworks) | SemanticActionBuilder (basic) | **GAP** |
| Per-type temporal dedup | 2000ms, per-type, cross-element | None | **GAP** |
| Priority-based discovery | 13 levels, Click=180 fallback | First-match | **DIFFERENT** |
| Interactive element filter | Rejects bare divs | No filter | **GAP** |
| Escape key cancellation | NOT supported | **SUPPORTED** (we're better) | ✅ IMPROVED |
| Outside-click cancellation | NOT supported (false) | **SUPPORTED** | ✅ IMPROVED |
| Stale timeout | Passive 15s | Active cleanup on every cycle | ✅ IMPROVED |

## Where Our Architecture is Better

1. **Escape key cancellation**: We cancel on Escape; reference doesn't handle it at all.
2. **Outside-click cancellation**: We cancel on genuine outside click via ARIA scope detection; reference uses 15s passive timeout (zombie lifecycles).
3. **Active stale cleanup**: We check on every processResult; reference only cleans up when the next event arrives.
4. **Declarative lifecycle definitions**: Our lifecycle is pure data (LifecycleDefinition objects). Reference uses procedural code in each definition file.
5. **Evidence channels**: Our 5-channel architecture (A-E) is richer than reference's flat domContext.

## Where We Have Gaps to Close

1. **Scroll burst coalescing** (CRITICAL)
2. **Date picker multi-mode completion** (blur, change, cell-click)
3. **Date picker navigation button rejection**
4. **Dropdown no-op detection** (already-selected option)
5. **Per-type temporal dedup** (duplicate event suppression)
6. **Interactive element filter** (reject bare divs)
7. **Three-layer enrichment** (component type + business meaning)
8. **Priority-based discovery** (Click as fallback)

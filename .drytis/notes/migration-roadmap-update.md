# Migration Roadmap (Updated) — v10.9.0 Deep-Dive Corrections

## Critical Architectural Correction

The v10.9.0 deep-dive investigation revealed that:

1. **`deterministic-recorder.ts` is dead code in v10.9.0** — NOT wired into
   the manifest. The active content script is `recorder-entry.ts` → EventTap
   (`src/tap/event-tap.ts`). Component Runtime (`src/runtime/component-runtime.ts`)
   is the active lifecycle engine.

2. **Our workspace (integration branch) is v10.4.18** — uses
   `deterministic-recorder.ts` (2,739 lines) as the active content script
   wired in `src/manifest.json`. We have NOT evolved past the monolith yet.

3. **Our Phase 3 EventTap is architecturally equivalent to v10.9.0's
   EventTap** — same event types, same capture-phase passive listeners,
   same scroll/mousemove throttling, same isTrusted filter, same value
   capture cascade, same target resolution strategies, same sessionStorage
   buffer + exponential backoff retry.

4. **Gap: ancestor class extraction** — v10.9.0's `dom-context-extractor.ts`
   extracts ancestor CLASSES (10 levels) for framework wrapper detection.
   Our Channel B extracts ancestor ROLES (tag + role) but NOT ancestor CSS
   classes. This is needed for OXD/MUI/AntD wrapper detection in recognition.

## Updated Gap Analysis

### Already Equivalent (✅)
- Event types: 12 types, capture-phase, passive, isTrusted filter
- Value capture cascade: select → input/textarea → aria-valuetext → aria-valuenow → contentEditable → aria-selected → aria-activedescendant
- Value timing: focus/click/mousedown=valueBefore, input/change/blur=valueAfter
- Target resolution: 4-strategy cascade (composedPath → INTERACTIVE_SELECTOR → clickable heuristic → raw target)
- captureCheckedState: HTMLInputElement → aria-checked → aria-pressed → CSS class fallback (mui-checked, ant-*, checked)
- Delivery: sessionStorage buffer, exponential backoff (100→1600ms), pagehide flush
- Scroll throttle: 16ms (60fps), mousemove throttle: 50ms (20fps)
- Blur-time value capture (autofill/paste/React fallback)

### Gaps to Close (⚠️)
1. **Ancestor CSS class extraction** (Phase 2 update — Channel B)
2. **Scroll burst coalescing** (Phase 5b — lifecycle improvement)
3. **Date picker multi-mode completion** (Phase 5b)
4. **Date picker nav button rejection** (Phase 5b)
5. **Dropdown no-op detection** (Phase 5b)
6. **Per-type temporal dedup** (Phase 5b)
7. **Interactive element filter** (Phase 4 update)
8. **Priority-based discovery** (Phase 4 update)
9. **Three-layer enrichment** (Phase 6)

### Where We're Better (✅)
- Escape key cancellation (v10.9.0 doesn't handle it)
- Outside-click cancellation via ARIA scope (v10.9.0 uses false + 15s timeout)
- Active stale cleanup (v10.9.0 is passive)
- Declarative lifecycle definitions (v10.9.0 uses procedural code)
- 5-channel evidence architecture (v10.9.0 uses flat domContext)

## Updated Phase Plan

### Phase 2b — Channel B Enhancement (small)
Add ancestor CSS class extraction to Channel B's `captureAncestorChain`.
Currently captures tag + role only. Add class extraction for framework
wrapper detection (oxd-checkbox, MuiSelect, ant-checkbox-checked, etc.).

### Phase 5b — Lifecycle + Recognition Improvements (same as before)
1. Scroll burst coalescing
2. Date picker multi-mode completion + nav rejection
3. Dropdown no-op detection
4. Per-type temporal dedup
5. Interactive element filter (Click pattern)
6. Priority-based discovery

### Phase 6-10 — Same as original roadmap

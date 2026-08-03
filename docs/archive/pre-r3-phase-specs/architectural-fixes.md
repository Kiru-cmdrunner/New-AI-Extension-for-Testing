# Spec: Architectural Fixes — Framework-Independent Interaction Pipeline

## Context

Root cause investigation revealed 5 architectural issues causing missing interactions.
This spec covers ONLY framework-independent fixes. No CSS class regex expansion,
no OrangeHRM-specific patterns.

## Fix 1: Sort Direction (Bug Fix)

**File**: `src/runtime/component-runtime.ts:122`
**Problem**: `b.priority - a.priority` sorts descending. Click(180) ends up first.
The `priority` field comment says "Higher = checked first" but Click(180) is
described as "always lowest priority" — contradiction. The spec says lower number
= higher priority = checked first.
**Fix**: Changed to `a.priority - b.priority` (ascending). DatePicker(10) checked
first, Click(180) last.
**Classification**: Bug fix (contradicts documented spec)
**Status**: ✅ Implemented

## Fix 2: Scroll Gesture Coalescing (Architecture Improvement)

**Files**: `src/definitions/scroll.ts`, `src/shared/component-types.ts`, `src/runtime/component-runtime.ts`
**Problem**: Each 16ms scroll tick created a separate completed interaction. Scroll is a
continuous gesture, not discrete events. User saw 4+ Scroll interactions for one gesture.
**Fix**: Scroll is now a lifecycle component, not immediate-complete:
- Consecutive scroll events within `SCROLL_BURST_GAP_MS = 500ms` are coalesced
- `isInScope` returns true only for scroll events within the gap window
- `handleEvent` accumulates the last scroll position in `ctx.data`
- Added optional `shouldCompleteOnOutside` method to ComponentDefinition interface
- Scroll's `shouldCompleteOnOutside` returns true — any non-scroll event completes the gesture
- `buildResult` computes delta as `lastScrollPosition - firstScrollPosition`
- Runtime calls `shouldCompleteOnOutside` when `shouldCancelOnOutside` returns false
- Flush() and stale cleanup complete gesture components as 'completed' (not interrupted/abandoned)
- Scroll is exempt from per-type dedup (gesture coalescing already prevents rapid-fire)
**Classification**: Architecture improvement
**Status**: ✅ Implemented

## Fix 3: Per-Type Dedup (Architecture Improvement)

**File**: `src/runtime/component-runtime.ts`
**Problem**: Single `lastEmittedForDedup` record. When a TextEntry fires between
two scroll bursts, the dedup record is overwritten and the next scroll passes.
**Fix**: `Map<InteractionType, DedupRecord>` — each type tracks its own last
interaction independently. `RuntimeSnapshot.dedupRecords` stores per-type records
as an array for MV3 recovery.
**Classification**: Architecture improvement
**Status**: ✅ Implemented

## Fix 4: Timeout-Based Lifecycle Abandonment (Architecture Improvement)

**Files**: `src/runtime/component-runtime.ts`, `src/definitions/dropdown.ts`, `src/definitions/date-picker.ts`
**Problem**: `shouldCancelOnOutside` uses DOM boundary heuristics (surface regex)
that are framework-specific. Portal-rendered overlays trigger premature abandonment.
**Fix**: Replaced with timeout-based abandonment:
- Runtime enforces `MAX_LIFECYCLE_DURATION_MS = 15_000` — any active component
  older than this is automatically abandoned via `cleanupStaleComponents()`
- Lifecycle definitions (Dropdown, DatePicker) set `shouldCancelOnOutside` to
  always return `false` — they wait passively for completion evidence or timeout
- TextEntry keeps its current `shouldCancelOnOutside` (click after blur)
- Navigation flush still interrupts everything
- Gesture components (Scroll) complete on stale cleanup, not abandoned
**Classification**: Architecture improvement
**Status**: ✅ Implemented

## Fix 5: mousemove Rate Limiting (Performance Optimization)

**File**: `src/tap/event-tap.ts`
**Problem**: `mousemove` fires at 60+ Hz, flooding the message pipeline.
**Fix**: `MOUSEMOVE_MIN_INTERVAL_MS = 50` — only forward every 50ms (~20Hz max),
sufficient for Hover dwell/stationarity tracking without flooding chrome.runtime.sendMessage.
**Classification**: Performance optimization (defensive)
**Status**: ✅ Implemented

## Acceptance Criteria

- [x] AC1: Discovery checks DatePicker(10) before TextEntry(50)
- [x] AC2: Single scroll gesture produces ONE Scroll interaction
- [x] AC3: Interleaved TextEntry + Scroll doesn't break Scroll dedup
- [x] AC4: Dropdown lifecycle survives mousedown on option (no premature abandon)
- [x] AC5: Active components auto-abandon after 15s timeout
- [x] AC6: mousemove forwarded at most every 50ms
- [x] AC7: All existing tests pass (3,333 tests, with updated expectations)
- [x] AC8: New tests cover each architectural fix (14 tests in architectural-fixes.test.ts)

## Test Results
- `tests/runtime/architectural-fixes.test.ts`: 14 tests ✅
- Full suite: 3,333 tests ✅
- Build: v10.9.0, 32 files, 107.0 KB ✅

# Type System Unification & Pattern Registry — Architecture Changes

## P0-1: Dual Type System Unified

### What Changed
The service worker no longer re-classifies events through the V1/V2 detector pipeline.
Instead, a `ComponentToClassifierAdapter` directly maps `ComponentInteraction[]` → `DetectedInteraction[]`.

### Key Files
- `src/generation/component-to-classifier-adapter.ts` — NEW: Pure transform function
- `src/shared/component-types.ts` — Added `interactionSubtype?: string` to ComponentInteraction
- `src/runtime/component-runtime.ts` — Reads `interactionSubtype` from `ctx.data`
- `src/background/service-worker.ts` — Replaced ~80 lines of V1/V2/merge/reasoner with adapter
- `src/definitions/dropdown.ts` — Sets NativeDropdown/CustomDropdown subtype
- `src/definitions/navigation.ts` — Sets PageNavigation subtype
- `src/definitions/scroll.ts` — Sets PageScroll/ContainerScroll subtype

### Service Worker Bundle
Dropped from 246KB to 170KB (V1/V2/merge/reasoner code tree-shaken out).

### What's Preserved
- V1/V2/merge/reasoner code is NOT deleted — it's bypassed. Still available as fallback.
- Sidepanel rendering unchanged (still uses ComponentInteraction[])
- IR bridge unchanged (still consumes DetectedInteraction[])
- Tests: 4462 pass, 2 pre-existing JSDOM timing flakes

## P0-2: Pattern Registry Created

### What Changed
Created `src/definitions/pattern-registry.ts` — a three-tier plugin system:
1. GENERIC defaults (cross-framework conventions)
2. FRAMEWORK plugins (MUI, Ant, Bootstrap, OXD, PrimeReact)
3. DOMAIN plugins (AdaniOne travel/flight vocabulary)

### Migration Status
- `patterns.ts` functions now delegate to PatternRegistry:
  - `isInteractiveElement` → `PatternRegistry.isInteractiveClass`
  - `isDropdownTrigger` → `PatternRegistry.isDropdownTriggerClass`
  - `isDropdownOption` → `PatternRegistry.isDropdownOptionClass`
  - `isInsideDropdownSurface` → `PatternRegistry.isDropdownSurfaceClass`
  - `isCalendarCell` → `PatternRegistry.isDatePickerCellClass`
  - `isDatePickerTrigger` → `PatternRegistry.isDatePickerTriggerClass`
  - `isInsideCalendarSurface` → `PatternRegistry.isCalendarSurfaceClass`
  - `isCalendarNavigationButton` → PatternRegistry calendarNavButtonClasses
- `dropdown.ts` stepper detection now uses PatternRegistry
- Old hardcoded regexes remain as dead code (not yet cleaned up)

### Still Hardcoded (to migrate later)
- `dropdown.ts` extractStepperLabel: passenger-type keywords (adult/child/infant)
- `structural-enrichment.ts` GENERIC_COUNTER_LABELS + SPECIFIC_RE
- Classifier files (detectors.ts, engine.ts, etc.) — bypassed but not cleaned
- `identity-extractor.ts` display value patterns
- `dom-context-extractor.ts` surface patterns

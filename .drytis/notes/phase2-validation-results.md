# Phase 2 Real-Browser Validation Results

**Date:** 2026-08-13
**Commit:** `6d088f0`
**Status:** PASS — TD-5 navigation identity fix working, no regressions

## Validated Scenarios

### Navigation ✅ (TD-5 fixed)
- Navigation now shows meaningful synthetic identity (destination URL)
- No longer shows "Unknown element"
- Synthetic notice updated to "synthetic" instead of "behavioral details unavailable"

### Regression Checks — All PASS
- Text input ✅
- Dropdown ✅
- Date picker ✅
- Radio ✅
- Scroll ✅
- Click ✅

## New Technical Debt

### TD-8: TextEntry max-duration / incorrect state after long pause
- **Added:** 2026-08-13 (Phase 2 real-browser validation)
- **Status:** Open
- **Priority:** Medium
- **Symptom:** "First Name" field: typed "Amanda", but after a 10s pause the evidence shows `manda → empty` (partial value, then cleared). EndReason appears to be `max-duration` rather than `lifecycle-complete`.
- **Scope:** TextEntry lifecycle or evidence window behavior during long pauses between keystrokes. May be related to the idle-time stale eviction (300s) or an interaction with AdaptiveWindow stabilization.
- **Note:** This did NOT happen during Step 1 validation (text input with slow typing captured complete values). The 10s pause is well within the 300s idle timeout. This may be a new edge case or was not previously tested with this specific pattern.
- **Do NOT touch:** Lifecycle architecture

## Conclusion
TD-5 is validated. Navigation identity works. All existing interactions remain
functional. New TD-8 recorded for the First Name long-pause issue.

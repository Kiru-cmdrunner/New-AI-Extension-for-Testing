# Working Baseline — v10.9.0 (f546cef)

**Commit:** `f546cef2914a88398aa1a2eb7d12c29cb2b43956`
**Date:** 2026-07-26 14:42:59 UTC
**Git tag:** `working-baseline-v10.9.0` (pushed to origin)
**User verdict:** "This is the one which is working better than others."

## What it contains (5 commits accumulated)

| Commit | Time | What it fixed |
|--------|------|---------------|
| `45363fb` | 11:21 | Component Runtime UI + auto-pack zip to download endpoint |
| `4bdb9fa` | 11:44 | Text entry empty value (`shouldCancelOnOutside` firing on mousedown) + click→hover misclassification |
| `bb6e846` | 12:19 | Hover redesign — candidate lifecycle with evidence promotion |
| `1940d3b` | 12:35 | Hover confidence model — weighted evidence (aria-expanded=100, dwell+stationary=50) |
| `f546cef` | 14:42 | Priority sort fix, scroll gesture coalescing, per-type dedup, timeout lifecycle, mousemove throttle |

## Test status
3,333 tests passing.

## Known remaining issues (from OrangeHRM testing)
- RadioButton not captured (OXD custom wrappers — fixed in b3e8e77 but not in this baseline)
- DatePicker falls through to TextEntry (OXD date input — fixed in b3e8e77)
- Checkbox not captured (OXD wrappers — fixed in b3e8e77)
- "Tab not responding" false positive (health check — fixed in b3e8e77)

## How to rebuild this exact version
```bash
git checkout working-baseline-v10.9.0
npm install && npm run build
# zip is at download/cmdrunner-extension.zip
```

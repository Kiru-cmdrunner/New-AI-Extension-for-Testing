# M8.4 — Memory Protection Regression Tests

## Overview

Dedicated regression tests proving that every bounded collection in the
evidence capture pipeline enforces its cap under high-churn conditions,
without affecting normal evidence capture.

## Bounds Inventory (12 caps)

| # | Bound | File | Value | Existing Test? |
|---|-------|------|-------|----------------|
| 1 | Concurrent windows | evidence-collector.ts:75 | 5 | ✅ basic displacement |
| 2 | DOM changes/window | evidence-collector.ts:81 | 200 | ✅ utility only |
| 3 | Evidence buffer (sessionStorage) | evidence-collector.ts:85 | 50 | ✅ pagehide test |
| 4 | Surfaces (added) | evidence-collector.ts:475 | 50 | ❌ |
| 5 | Surfaces (removed) | evidence-collector.ts:476 | 50 | ❌ |
| 6 | Visibility changes | evidence-collector.ts:625 | 50 | ❌ |
| 7 | Network buffer | network-bridge.ts:58 | 500 | ✅ basic |
| 8 | Network per window | network-bridge.ts:64 | 50 | ✅ basic |
| 9 | Stability trace | adaptive-window.ts:59 | 50 | ✅ |
| 10 | Shadow roots | dom-observer.ts:111 | 20 | ❌ |
| 11 | TextContent capture | target-state-cache.ts:171 | 500 chars | ❌ |
| 12 | Pending evidence | sw-integration.ts | 100 | ❌ |

## M8.4 Deliverable

A single test file (`tests/memory-protection-caps.test.ts`) that tests
each cap with:
1. **Under-cap**: normal operation is unaffected
2. **At-cap**: boundary case works correctly
3. **Over-cap**: cap enforced, eviction/drop behavior correct

## Acceptance Criteria

- [ ] Every bound has a test verifying the cap value
- [ ] Every bound has a test verifying eviction/drop behavior
- [ ] Tests confirm normal (under-cap) evidence capture is unaffected
- [ ] All tests pass against current code
- [ ] All existing tests pass unchanged
- [ ] TSC 0 errors

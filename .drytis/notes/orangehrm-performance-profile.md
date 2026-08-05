# OrangeHRM Performance Profile — M1 Complete Evidence Build

## Test Environment
- OrangeHRM v5.9 (opensource-demo.orangehrmlive.com)
- Playwright Chromium
- Diagnostic harness using IDENTICAL MutationObserver config to M1 DocumentObserver

## Key Findings Summary

### 1. OrangeHRM is Nearly Mutation-Free
| Scenario | Duration | Total Mutations | Mutations/Sec |
|---|---|---|---|
| Idle dashboard (30s) | 30s | 0 | 0 |
| 3s idle observation window | 3s | 0 | 0 |
| Click search field | instant | 1 (class) | N/A |
| Type in search + Search button | instant | 16 (14 childList, 2 class) | N/A |
| Open custom dropdown | instant | 4 (2 class, 2 childList) | N/A |
| Checkbox toggle | instant | 1 (class) | N/A |

**Conclusion: OrangeHRM generates ZERO mutations when idle and only 1-16 mutations per interaction.**

### 2. Mutation Breakdown (OrangeHRM Interactions)
| Type | Count | % |
|---|---|---|
| style | 0 | 0% |
| class | ~50% | varies |
| aria | 0 | 0% |
| otherAttr | 0 | 0% |
| characterData | 0 | 0% |
| childList | ~50% | varies |

### 3. Callback Timing (OrangeHRM)
| Metric | Value |
|---|---|
| Total callback time (33s recording) | 0.2ms |
| Average callback | 0.2ms |
| Max callback | 0.2ms |
| getPath per mutation (warm cache) | negligible |

### 4. DocumentObserver Callback Timing (Stress Test Comparison)
| Config | Callback Total (185s) | Avg Callback | Mutations/Sec |
|---|---|---|---|
| M1 CURRENT (no filter) | 130.8ms | 0.042ms | 848 |
| With attributeFilter | 10.5ms | 0.003ms | 848 |
| Minimal (no style/char) | 3.0ms | 0.001ms | 552 |

### 5. getPath() Cost (Real computePath with Array.from.filter)
| Scenario | Per Call | At 837 mutations/sec |
|---|---|---|
| Warm cache | 0.00025ms | 0.21ms/sec |
| Cold cache (new elements) | 0.086ms | 72.15ms/sec |

Cold cache is 344x more expensive. React re-renders create new DOM nodes → cache miss.

### 6. Phase E Rendering
| Load | Render Time |
|---|---|
| 1 window, 5 mutations | 0.04ms |
| 1 window, 100 mutations | 0.29ms |
| 5 windows, 500 mutations | 1.15ms |
| 10 windows, 1000 mutations | 1.77ms |

**Phase E rendering is negligible — not a bottleneck.**

### 7. Concurrent Windows
During rapid interactions (clicks < 3s apart), observation windows overlap. Each window keeps the DocumentObserver active. With M1's refcounting, the observer stays active as long as ANY window is open. During active recording with frequent interactions, the observer is effectively always-on.

### 8. SPA Navigation
OrangeHRM uses React Router (pushState). Every SPA route change destroys the window context, including any injected diagnostic code AND any content script state. This means:
- Observation windows started on one route are lost when navigating to another
- The M1 pipeline must be re-injected on every route change
- Any in-flight observation results may be lost

## Root Cause Analysis

On OrangeHRM specifically, mutation volume is NOT the bottleneck (0 idle, 1-16 per interaction). The performance issue likely comes from:

### RC-A: Three Concurrent MutationObservers
M1 adds a THIRD MutationObserver on document.body alongside the existing deterministic recorder's:
1. M1 DocumentObserver (heavy config, 3s per interaction)
2. Deterministic recorder surface detection (500ms per click)
3. Deterministic recorder hover observer

Even with few mutations, three observers triple the per-mutation processing overhead.

### RC-B: Capture-Phase Event Listeners Always Active
M1's state-cache-listeners attaches capture-phase mousedown + focus listeners on document. These fire on EVERY mouse/focus event during recording, calling ElementStateCache.capture() which reads 9 DOM properties per event.

### RC-C: getPath Array.from().filter() on Table Rows
OrangeHRM's user table has 27 rows × 6 cells. When getPath() hits a cold cache element in this table, it computes nth-of-type via Array.from(parent.children).filter() — O(27) or O(6) per depth level.

## Recommended Fixes (in order of impact)

### Fix 1: Add attributeFilter to M1 DocumentObserver
Current: `attributes: true` (observes ALL attributes)
Proposed: `attributeFilter: ['class','style','aria-checked','aria-expanded','aria-pressed','aria-selected','aria-disabled','hidden','aria-hidden','role','data-state','value','checked','selected','disabled','open']`
Impact: 12.5x reduction in callback time (130.8ms → 10.5ms on stress test)

### Fix 2: Drop 'style' from attributeFilter
Style mutations are ~35% of volume and are mostly animation noise (opacity, transform, color transitions).
Impact: 35% reduction in mutation volume

### Fix 3: Cap getPath computation for large batches
When a mutation batch exceeds N records, defer getPath to requestIdleCallback or skip for non-state attributes.
Impact: Eliminates cold-cache getPath spikes during React re-renders

### Fix 4: Reuse deterministic recorder's existing observer
Instead of running a third MutationObserver, consider piggybacking on the existing surface detection observer during its 500ms active window.
Impact: Eliminates one of three concurrent observers

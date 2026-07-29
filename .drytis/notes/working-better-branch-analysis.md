# working-better Branch (v10.9.0, commit f546cef) — Deep Source Analysis

## Executive Summary
The working-better branch builds 15 commits on top of integration (581fd96) and
introduces a complete "Component Runtime" architecture that moves all interaction
detection from the content script into the service worker.

## Architecture
EventTap (255 lines, pure forwarder) → sessionStorage buffer → SW →
ComponentRuntime (529 lines) → 10 definitions → ComponentInteraction → IR Bridge

## Key Reliability Patterns (TO ADOPT)
1. sessionStorage event buffer with exponential backoff (100→1600ms, 5 retries)
2. Events only removed on confirmed delivery (response.ok === true)
3. Page lifecycle: pagehide flush, pageshow resume, auto-resume on re-injection
4. Immediate persistence (no debounce) for live interactions
5. Runtime snapshot/restore for MV3 crash recovery
6. Every definition call in try/catch (error isolation)
7. 15s stale component timeout
8. seenEventIds dedup (cap 500, halve on overflow)
9. Per-type temporal dedup (2000ms window)

## Component Definition Contract (6 methods)
- detectTrigger(event, patterns): boolean
- isInScope(event, ctx): boolean
- handleEvent(event, ctx): { completed?: boolean }
- shouldCancelOnOutside(event, ctx): boolean
- shouldCompleteOnOutside?(): boolean
- buildResult(ctx): Record<string, unknown>

## 10 Definitions
| Priority | Type | Lifecycle | Key Features |
|----------|------|-----------|--------------|
| 10 | DatePicker | Multi-event | Native + custom calendars, timeout abandonment |
| 20 | Dropdown | Multi-event | SELECT, combobox, option clicks |
| 30 | Checkbox | Immediate | checkedAfter/Before negation |
| 40 | RadioButton | Immediate | noOpSelection on checkedBefore=true |
| 50 | TextEntry | Multi-event | focus→input→blur, userTyped flag |
| 60 | Hover | Evidence-accumulating | Confidence scoring (aria-expanded=100, overlay-dwell=70, haspopup-dwell=60, sustained-dwell=50) |
| 70 | Link | Immediate | A tag, role=link |
| 110 | Scroll | Gesture-coalesced | 500ms gap coalescing, hasDelta flag |
| 120 | Navigation | Immediate | Runtime-wide flush trigger |
| 180 | Click | Immediate fallback | Universal for unclassified clicks |

## What Was Removed (vs integration branch)
- V2 evidence engine (5-provider voting)
- Two-tier recognition (structural + behavioral)
- Pattern catalogue (6 patterns)
- Enrichment pipeline (contracts, capabilities, workflows, surfaces)
- Page-world dialog interception (alert/confirm/prompt)
- Surface detection (MutationObserver)
- Session-wide valueTracker Map
- Cross-session element healing from SW

## Impact on Our Migration
REINFORCES the blueprint. Key changes:
1. Phase 3: MUST adopt sessionStorage buffer + exponential backoff
2. Phase 5: Component definitions validate LifecycleConfig direction
3. Phase 4: Confidence-based Hover model validates evidence accumulation
4. No rework of Phase 1-2 types needed

## Critical Assessment
working-better trades recognition depth for operational simplicity. Its CSS-class
regex matching is fragile (breaks on framework updates). Our evidence-first approach
is more robust but adds pipeline complexity. Best path: adopt working-better's
reliability patterns and definition structure, keep our evidence model underneath.

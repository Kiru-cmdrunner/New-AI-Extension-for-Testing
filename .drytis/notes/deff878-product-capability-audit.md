# CmdRunner — Current Product Capability & Limitation Audit
## Frozen Baseline: deff878a0cfdf6f42d65f19d4b0c62ec39edf8a8

## CRITICAL BASELINE NOTE

All findings below are verified against the actual `deff878` source code, NOT the post-DF working tree. At deff878:
- **14 component definitions** (not 18 — no DragDrop, Stepper, MultiSelect, Autocomplete)
- **5 effect rules + 2 fallbacks** (not 9+2 — no checkSelectionChange, checkNavigationState, checkClassStateChange, checkValueChange)
- **12 DOM event types** (not 22 — no pointer, drag, touch events)
- **2 transient types** (mousemove, scroll only)
- **Observation windows open for click + change only** (inline check, no OBSERVATION_ELIGIBLE_EVENT_TYPES)
- **10 ElementStateSnapshot fields** (not 19 — no ARIA expansion or computed styles)
- **No NetworkTap** (does not exist at this commit)
- **114 test files, 2,578 tests, ALL PASSING** (3 untracked post-DF test files excluded)
- **No batching** (OBSERVED_EVENT sent individually, not OBSERVED_EVENTS_BATCH)

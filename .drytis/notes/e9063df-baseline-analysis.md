# e9063df Baseline Analysis — What Exists and What's Missing for Behaviour-First

## What e9063df HAS
- EventTap: 18 event types, capture-phase listeners
- Post-click value polling (50/150/400ms) for SPA controlled inputs
- Deferred blur value reading (setTimeout 0) for framework state flush
- IdentityExtractor: 7-strategy value cascade, 5-strategy checked state, implicit ARIA role, descendant walk (latter two added in 103a605)
- DomContext: 30+ fields including ancestorRoles (10-level), surfaceType, surfaceId, aria values
- ComponentRuntime: 23 lifecycle definitions, priority-sorted (30-180), detectTrigger/isInScope/handleEvent
- ComponentInteraction output type with metadata, memberEvents
- Surface tracking: modal/popover/drawer detection, surfaceId binding
- Classifier: priority cascade (Checkbox@30 → Radio@30 → ToggleSwitch@60 → Tab@60 → Link@70 → Click@180)
- Deterministic recorder: getImplicitRole() with TAG_ROLE_MAP, captureCheckedState()
- Domain adapter (V2): interactions → UiElement + ObservedTransition
- Recognition orchestrator: structural pattern matching
- Enrichment orchestrator: NoOp DomInspector (MV3)
- Capability deriver: fragment → CapabilityCandidate
- IR Bridge: interactions → ExecutionIRPlan → Playwright

## What e9063df LACKS (critical for behaviour-first)
1. NO post-click attribute re-snapshot — DOM is captured BEFORE page handler runs
2. NO MutationObserver — no detection of DOM changes after interaction
3. NO evidence-based classification — pure priority cascade on structure
4. NO checked-state transition tracking on click events (checkedBefore/checkedAfter both null for non-native)
5. NO behavioral evidence — only structural/ARIA/tag signals
6. NO evidenceTrail or intent on interactions
7. NO confidence calibration — all interactions at 1.0
8. NO annotation deferral — Click emits and finalizes immediately
9. NO attribute-change BrowserEventType
10. Ancestor roles truncated in pipeline-runner.ts (only target, not full chain)

## The Amazon Failure at e9063df (root cause)
The DOM snapshot is taken synchronously during the capture-phase click handler.
Amazon's page handler runs AFTER capture, toggling the class (opt→opt selected).
So the recorder never sees the state change. This is a TIMING problem, not just
a selector problem. Even with perfect structural patterns, the recorder would
miss the toggle because it captured too early.

## Key Timing Insight
Post-click value polling EXISTS (for input values) but there is NO equivalent
for attribute changes. The recorder knows "the input value changed 50ms after
the click" but does NOT know "the element's class changed 50ms after the click"
or "a new element appeared 50ms after the click."

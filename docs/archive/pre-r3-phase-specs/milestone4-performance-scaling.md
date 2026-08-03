# Milestone 4: Performance + Scaling

## Architectural Questions
- **C1 (Continuous Performance):** Does a continuous MutationObserver block the main thread unacceptably?
- **C2 (Scaling):** Can the Control Model handle enterprise DOMs with thousands of elements?

## Scope
Test the Control Model under stress conditions:
1. Discovery time at scale (100 → 2000 controls)
2. Mutation processing under continuous load
3. Batch processing budget enforcement
4. Memory behavior (WeakMap/WeakRef at scale)
5. Observer callback blocking time
6. Throttling/debouncing strategy validation

## Constraints (from control-model-design.md stress test)
- Max 2000 active controls
- Max 100ms per mutation batch
- Max 100ms per initial discovery
- Lazy discovery via IntersectionObserver (viewport-gated)
- Batched mutation processing

## Test Cases

### Discovery Scaling
1. 100 controls → discovery < 50ms
2. 500 controls → discovery < 150ms
3. 1000 controls → discovery < 300ms
4. 2000 controls → discovery < 600ms

### Mutation Processing Under Load
5. 50 simultaneous additions → batch < 50ms
6. 100 simultaneous additions → batch < 100ms
7. Continuous mutations (rapid class toggles) → no blocking > 16ms (1 frame)
8. Mixed additions + removals + attribute changes → budget not exceeded

### Budget Enforcement
9. Control count cap: discovery stops at maxControls
10. Batch processing yields when budget exceeded (chunked processing)

### Memory
11. Removed controls are GC-eligible (WeakRef returns undefined)
12. WeakMap doesn't retain removed elements

### Throttling
13. High-frequency mutations are coalesced (no per-mutation overhead)
14. Observer callback fires once per microtask regardless of mutation count

## Acceptance Criteria
- [ ] Discovery scales linearly with control count
- [ ] Mutation batches stay within 100ms budget
- [ ] Control count can be capped at configurable max
- [ ] Batch processing can be chunked for very large DOMs
- [ ] Removed elements don't cause memory leaks
- [ ] Observer callbacks don't block for >16ms per microtask

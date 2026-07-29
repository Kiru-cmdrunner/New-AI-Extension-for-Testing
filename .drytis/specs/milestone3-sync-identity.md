# Milestone 3: Synchronization + Identity Stability

## Architectural Questions
- **A2 (Identity Stability):** Do controls maintain stable identities across re-renders?
- **A3 (Mutation Observability):** Can DOM mutations be tracked correctly and efficiently?

## Scope
Build a mutation-synced Control Model prototype that:
1. Uses MutationObserver to maintain the model as DOM changes
2. Maintains stable controlId via semantic fingerprint
3. Re-binds identity when elements are removed and re-inserted
4. Handles CSS-only state changes (class toggles)
5. Handles SPA route changes (full content replacement)

## Test Cases

### A3: Mutation Observability
1. **Element added** → new Control discovered via MutationObserver
2. **Element removed** → Control marked destroyed (or re-bound)
3. **Attribute change (aria-expanded)** → Control state updated
4. **Attribute change (class)** → Framework state detected (oxd-checkbox-checked)
5. **Attribute change (value)** → Control state.value updated
6. **CSS-only state change** → class toggle detected via attributes filter
7. **Shadow DOM mutation** → open shadow root observed
8. **Batch mutation** → multiple changes processed in one observer callback

### A2: Identity Stability
9. **Re-render (innerHTML replacement)** → controlId preserved if semantic fingerprint matches
10. **Virtualization (remove+re-add after grace period)** → new controlId if destroyed, same if within grace
11. **Reorder (identical controls swap position)** → identity followed by name, not position
12. **SPA route change** → all old controls destroyed, new page discovered
13. **Dynamic name change** → controlId changes (correct — identity changed)
14. **Grace period expiry** → control destroyed after 200ms

## Acceptance Criteria
- [ ] MutationObserver correctly tracks element additions/removals/attribute changes
- [ ] Control identities survive re-renders when semantic fingerprint matches
- [ ] Control identities change when semantic properties change
- [ ] Virtualized list controls are discovered/destroyed as expected
- [ ] CSS class changes are detected and trigger state updates
- [ ] Shadow DOM mutations are observed
- [ ] Performance: observer callback processes batch < 50ms for typical forms

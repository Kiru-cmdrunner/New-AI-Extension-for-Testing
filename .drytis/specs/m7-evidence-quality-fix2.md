# M7 Evidence Quality Hardening Fix Round 2 — Real-Browser Defects

## Problem

After M7 evidence quality hardening (commit `d48f72a`), real-browser testing on OrangeHRM showed:
- GAP-2 (text value): ❌ Still failing — "No observable state changes" on all text inputs
- GAP-3 (visibility): ❌ Still failing — dropdowns show no DOM/surface/visibility changes
- GAP-4 (navigation): ❌ Still failing — stuck "Collecting behavioral evidence…"
- GAP-5 (network): ❌ Still failing — zero network entries visible
- GAP-6 (all state changes): ❌ Still failing — only `checked` works

## Root Causes (Confirmed)

### P0-1: Element Identity Mismatch
`target-state-listeners.ts` uses `resolveEl(e)` → first Element in `composedPath()`.
EventTap uses `resolveTarget(event)` → first **interactive** element.
Different elements → WeakMap key mismatch → `before` snapshot is null.

**Fix**: Import and use `resolveTarget` from `identity-extractor.ts` in `target-state-listeners.ts`.

### P0-2: Visibility Cold-Start Bug
`detectClassVisibilityChange()` in `dom-observer.ts` uses a `prevComputedStyles` WeakMap
that is never seeded. First class mutation → no cached "before" → change silently dropped.

**Fix**: Seed `prevComputedStyles` for elements in the `start()` method by snapshotting
computed styles for all elements on `document.body` when observation begins.

### P1-3: Navigation Evidence Delivery
1. Full-page reloads destroy the content script before the evidence window closes.
2. No timeout — interactions stuck at "Collecting…" forever if evidence never arrives.

**Fix A**: SW-side navigation evidence for full-page reloads — use `webNavigation.onCommitted`
to generate synthetic evidence for navigation interactions that never received evidence.
**Fix B**: Bounded timeout (5s) — SW marks interactions as "evidence timeout" if no
behavioral evidence arrives within 5 seconds.

### P1-4: Network Capture
Diagnosis needed: MAIN-world injection may fail silently due to CSP.
webRequest forwarding uses `performance.now()` from SW which may not match content script timeline.

**Fix A**: Add diagnostic logging in network-bridge.ts to confirm events received.
**Fix B**: Increase bounded re-check from 200ms to 1000ms.
**Fix C**: Ensure webRequest timestamps use `Date.now()` consistently.

## Target/State Rule (from user)

Do NOT blindly walk ancestors and attribute their state to the clicked element.
Clearly distinguish:
- Physical event target (resolveEl — deepest element)
- Semantic interactive target (resolveTarget — interactive element)
- State-owning element (the element that actually has the state change)

Preserve the relationship explicitly if they differ.

## Constraints
- Reuse existing EventTap/IdentityExtractor infrastructure
- No second identity/event-ID system
- Preserve dual-scope model (TargetEvidence + ApplicationEvidence)
- Preserve raw timing + batchIndex
- Keep evidence bounded
- Do not modify M1–M6 behavior unnecessarily
- Do not modify persistence/Dexie
- Do not start M8

## Acceptance Criteria

### P0-1 (Element Resolution Alignment)
- [ ] target-state-listeners.ts uses resolveTarget from identity-extractor.ts
- [ ] WeakMap cache key matches EvidenceCollector peek/capture key
- [ ] Unit test: wrapper div + inner input → same resolved element
- [ ] Unit test: button + span child → same resolved element
- [ ] Real browser: Username/Password/FirstName/LastName show value diffs

### P0-2 (Visibility Cold-Start)
- [ ] prevComputedStyles seeded when DOMObserver.start() is called
- [ ] First class mutation on an element produces a visibility change
- [ ] Unit test: cold-start class change detected
- [ ] Real browser: dropdown visibility changes visible in evidence

### P1-3 (Navigation + Timeout)
- [ ] SW generates synthetic evidence for full-page-reload navigations
- [ ] Bounded 5s timeout for interactions without evidence
- [ ] "Collecting…" placeholder replaced with "No evidence (timeout)" after 5s
- [ ] Unit test: timeout fires and marks interaction
- [ ] Real browser: navigation interactions show evidence or timeout

### P1-4 (Network)
- [ ] Diagnostic logging confirms whether events are received from each source
- [ ] Bounded re-check increased to 1000ms
- [ ] Timestamp normalization verified
- [ ] Unit test: webRequest event produces NetworkActivity entry

### M1-M6 Regression
- [ ] All existing tests pass
- [ ] M1-M6 source files unchanged

## Files to Change
1. `src/tap/target-state-listeners.ts` — use resolveTarget
2. `src/tap/dom-observer.ts` — seed prevComputedStyles
3. `src/runtime/sw-integration.ts` — evidence timeout
4. `src/background/service-worker.ts` — synthetic nav evidence + timeout broadcast
5. `src/sidepanel/sidepanel.ts` — handle timeout state
6. `src/sidepanel/evidence-renderer.ts` — render timeout state
7. `src/tap/evidence-collector.ts` — increase network re-check
8. `src/tap/network-bridge.ts` — diagnostic logging

## Test Files
- `tests/integration/evidence-quality-fix2.test.ts`

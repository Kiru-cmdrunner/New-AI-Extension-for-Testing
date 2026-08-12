# M7 Evidence Quality Hardening — Task Spec

## Goal
Fix all 7 capture-quality gaps identified in the gap analysis. No renderer changes, no correlation architecture changes. All fixes are in the **capture pipeline**.

## Acceptance Criteria

### GAP-1: Identity passthrough (CRITICAL)
- [ ] `onAfterEvent` signature extended to pass full `ElementIdentity`
- [ ] EvidenceCollector stores identity from metadata, not null
- [ ] TargetEvidence.identity is never null for events that have identity
- [ ] No second identity extraction system (reuse EventTap's existing extraction)

### GAP-2: Before-snapshot reliability (HIGH)
- [ ] keydown capture-phase listener added to target-state-listeners.ts
- [ ] Typing window before-snapshot available even without prior focus/mousedown
- [ ] Works for: click-then-type, Tab-then-type, direct-type (already focused)

### GAP-3: Visibility detection (MEDIUM)
- [ ] DOMObserver detects display/visibility/opacity changes from style attribute
- [ ] DOMObserver detects visibility changes from class attribute mutations
- [ ] Existing hidden/aria-hidden detection preserved
- [ ] Bounded: WeakMap for computed styles, no unbounded growth

### GAP-4: Navigation evidence (HIGH)
- [ ] navType passed from EventTap (not hardcoded 'pushState')
- [ ] fromUrl passed from EventTap (not empty string)
- [ ] Navigation events open their own evidence window for DOM capture
- [ ] pendingNavEvents "next window" attribution removed

### GAP-5: Network timing (MEDIUM)
- [ ] In-flight network requests detected at window close
- [ ] Bounded re-check (max 1000ms, 200ms intervals) for completion
- [ ] Evidence delivered with complete network data when possible
- [ ] No unbounded waiting

### GAP-6: All state changes (MEDIUM)
- [ ] Verified via GAP-3 fix — visibility changes now detected
- [ ] TargetStateSnapshot 9 properties confirmed working

### GAP-7: Typing keydown filter (MEDIUM)
- [ ] EventTap only calls onAfterEvent for Enter keydown
- [ ] Non-Enter keydown does not open evidence windows
- [ ] Typing windows extend on input, not keydown

## Constraints
- Reuse existing EventTap/IdentityExtractor
- No new identity/event-ID system
- No semantic/causal interpretation
- Preserve dual-scope model
- Preserve raw timing + batchIndex
- Keep all evidence bounded
- Do not modify M1–M6 behavior unnecessarily

## Tests
- Regression tests for each GAP
- Real-browser tests for Amazon + OrangeHRM
- Verify actual BehavioralEvidence object, not just rendering

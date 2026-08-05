# M1 Redesign Decision (2026-08-04)

The M1/M2 split was artificial. M1's original purpose was "reliably observe
behavioral consequences of an interaction." The M1 implementation proved the
mechanism but real-world testing revealed it only captured PART of the
behavior (target subtree + 200ms window). The planned M2 pieces (document-wide
observation, delayed effects, overlapping interactions, element state cache)
are NOT a new capability — they're the MISSING PIECES of the original M1.

Decision: Merge M2 into M1. One complete observation foundation.

## What Stays from Current M1
- BehavioralObserver target subtree observer (class/aria/childList/text/removal)
- EventTap onAfterEvent hook
- Buffered delivery pipeline (sessionStorage + exponential backoff)
- SW correlation (handleBehavioralEffects by eventId)
- Pending effects in sw-integration.ts
- behavioralObservations field on ComponentInteraction
- Side panel INTERACTION_EFFECTS_UPDATE handler
- All 29 existing M1 tests

## What Changes from Current M1
- behavioral-observer.ts: stability management extracted to coordinator
- recorder-entry.ts: onAfterEvent calls coordinator.startObservation()
- Pre-snapshot enhanced with element state cache
- BehavioralObservation extended with documentEffects, noiseProfile, captureStats
- Side panel display extended

## What Moves In from Planned M2
- Document-wide singleton MutationObserver (lightweight capture)
- Element state cache (before-state for change events)
- Observation coordinator (target + document + stability orchestration)
- Shared stability manager (500ms quiet + 1000ms minimum + 3000ms cap)
- Periodicity detection (sub-500ms recurring mutations → noise gate)
- Shared record buffer with windowIds (Approach B — preserves attribution ambiguity)
- Deferred deterministic analysis (noise/proximity/consequence/grouping/path)
- Performance instrumentation

## Stability Redesign
- LOCAL stabilization (target subtree quiet for 200ms) → marker only, does NOT close window
- WINDOW CLOSURE: document-wide non-periodic quiet for 500ms AND minimum 1000ms elapsed
- HARD CAP: 3000ms
- Minimum duration ensures delayed consequences (e.g., 850ms ProductResults) survive

## M1 Boundary (Strict)
M1 captures trustworthy evidence. M1 does NOT:
- Decide semantic meaning
- Classify component types
- Determine causality
- Call AI
- Validate outcomes
- Prompt tester

## The Claim M1 Must Support
"For a recorded user interaction, the recorder can reliably preserve the
relevant before/state evidence and observable behavioral consequences — local,
distant, and delayed — within a bounded observation period, while handling
overlapping interactions, background activity, and uncertainty without
claiming causation or semantic meaning."

## Implementation Phases
A: Element State Cache (before-state preservation)
B: Document Observer Engine (singleton, lightweight capture, periodicity)
C: Stability Manager + Observation Coordinator (delayed effects, overlap)
D: Deferred Deterministic Analysis (noise, proximity, consequence, grouping)
E: Integration, Display & Performance Proof (end-to-end real-world)

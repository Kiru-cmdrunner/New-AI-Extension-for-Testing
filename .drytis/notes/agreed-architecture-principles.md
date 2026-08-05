# Agreed Architecture Principles (Current — as of 2026-08-03)

These principles supersede all earlier proposals. They were established through
five guidance documents and iterative correction. Anything below marked CURRENT
is the agreed position; anything marked REJECTED was explored and discarded.

## 1. Three Separate Layers (CURRENT)

| Layer | Question | Owner | When |
|-------|----------|-------|------|
| Observation | What happened in the DOM? | Mechanical recording (content script) | During bounded window |
| Performance | Was it fast enough? | Threshold comparison | After observation |
| Validation | Was it the RIGHT outcome? | Semantic knowledge model | Later, progressive |

These are NOT mixed. Observation captures facts. Performance is arithmetic.
Validation is semantic and knowledge-dependent.

## 2. Deterministic-First, AI Only When Required (CURRENT)

Hierarchy of reasoning:
  1. Deterministic browser evidence (ground truth)
  2. Existing application/capability knowledge (learned, deterministic)
  3. Deterministic reasoning where possible
  4. AI assistance ONLY when 1-3 are insufficient

AI is NEVER the default reasoning path. AI dependency DECREASES over time.
AI output is always hypothesis + confidence, never ground truth.
AI never creates facts, never replaces observation, never becomes the authority.

REJECTED: "AI interpretation is part of the system from day one, runs on every
meaningful interaction." This was wrong — AI is the fallback of last resort.

## 3. Bounded Broad Capture + Deferred Analysis (CURRENT)

During the observation window after a meaningful interaction:
- Capture ALL mutations across the entire document (childList + attributes +
  characterData, subtree:true on document.body)
- Capture callback is LIGHTWEIGHT: O(1) per record, compact plain objects
  (where/what/old→new/when). No region identification, no noise filtering,
  no semantic analysis in the callback.
- ALL correlation, noise filtering, region discovery, and interpretation are
  DEFERRED to deterministic analysis after the window closes.
- "Capture broadly ≠ process everything deeply in real time."
- "During recording, optimise for evidence completeness. After recording,
  optimise for meaningful knowledge."

REJECTED: Body childList + filtered attributes + deep local observer.
This pre-filtered signal during capture, violating "don't assume what matters
on novel apps." Rejected because "we don't yet know which signal will matter."

REJECTED: Two-tier detect→escalate→observe model. Has a timing gap — by the
time escalation triggers, the mutations that triggered detection are already gone.

## 4. Region-Aware Observation (CURRENT — FUTURE MILESTONE)

Identify logical regions from deterministic structural/accessibility evidence.
Observe interaction region deeply. Detect evidence of cross-region consequences.
Expand observation. Discover relationships like "PriceFilter → affects →
ProductResults." Learn these relationships for future pre-wiring.

DO NOT assume component type first (no predefined Dropdown/Filter/Accordion).
Preserve behavioral patterns as evidence first. Deterministic recognition if
known. AI hypothesis only if unknown and genuinely needed.

## 5. Five-Case Interaction Model (CURRENT — FUTURE MILESTONE)

For outcome-producing actions (Search, Filter, Navigation):
- Case 1: Action + response + consistency → continue silently
- Case 2: No response in window → prompt "may not have completed" → Continue/Wait/Retry
- Case 3: Response fast but inconsistent → prompt "may not match" → Accept/Mark/Retry
- Case 4: Search → validate relevance if confident, else UNKNOWN
- Case 5: Navigation → validate view/URL change if confident, else UNKNOWN

Form filling (Name, Email, etc.) → observe only, don't validate after each field.
Tester confirmation/correction → labeled training data for capability model.

## 6. First Recording ≠ Everything UNKNOWN (CURRENT)

Deterministic browser evidence alone is often sufficient for confident conclusions
even on first encounter. AI can minimally assist interpretation. Accumulated
knowledge makes future decisions stronger/cheaper but is NOT a prerequisite.

REJECTED: "On first recording, everything is UNKNOWN, observe everything,
prompt nothing." Too pessimistic — ignores available evidence.

## 7. Performance Budget (CURRENT)

3-second observation window hard cap. If no response within 3 seconds, that IS
the finding (performance issue or validation failure). NOT a reason to extend
observation. Observation window and performance expectation are separate concepts.
Different capabilities may have different learned performance expectations later.

## 8. Stability Quiet Period (CURRENT)

500ms quiet period (revised from M1's 200ms after real-world testing showed
200ms misses React/Vue/Angular async updates at 300ms). Resets on each mutation.
3000ms hard cap. Catches normal async framework responses. Slow network
responses (>500ms after last mutation) may be missed — that becomes a Case 2
finding (tester prompt) in the five-case model.

## 9. Before-State Preservation (CURRENT — FUTURE MILESTONE)

Element state cache: maintain rolling cache of element properties across events.
Pre-state for interaction N = cached value from interaction N-1. Solves the
change-event timing problem (value already set before change fires).

## 10. Temporary Rich Evidence → Consolidation (CURRENT — FUTURE MILESTONE)

During recording: multi-snapshot timeline, rich behavioral sequences, broad capture.
After recording: analyze, extract semantic understanding, discard redundancy,
retain evidence for confidence/capability/self-healing.

## What M1 Established (CURRENT — WORKING)

- BehavioralObserver: target subtree MutationObserver + parent removal observer
- 200ms stability (TOO SHORT — will be 500ms in M2)
- Pre/final ElementStateSnapshots (property-gap mitigation)
- OBSERVABLE_EVENT_TYPES = click + change only
- Separate buffered delivery to SW (BEHAVIORAL_EFFECTS message)
- eventId correlation against memberEvents
- Side panel collapsible display
- Amazon checkbox case RESOLVED (subtree observer catches child aria-checked)

## M1 Limitations (PROVEN by real-world testing)

1. SPATIAL SCOPE: misses sibling/ancestor/body mutations (modal, toast, results)
2. TEMPORAL SCOPE: 200ms stability misses 300ms+ async framework updates
3. BEFORE-STATE: change events fire after value already set
4. CSS-ONLY: computed style changes invisible (no DOM mutation)

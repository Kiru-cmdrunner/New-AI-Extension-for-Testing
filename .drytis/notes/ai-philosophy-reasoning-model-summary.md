# AI Philosophy & Reasoning Model Summary

**Date:** 2026-07-17  
**Spec:** `.drytis/specs/milestone-ai-philosophy-reasoning-model.md` (802 lines)

## 8 Frozen AI Principles (P1-P8)
- **P1 Observation First:** AI reasons from evidence, never imagination
- **P2 Progressive Understanding:** Accumulates incrementally; confidence starts low
- **P3 Evidence Sovereignty:** Deterministic evidence is ground truth; AI is subordinate
- **P4 Hypothesis Discipline:** Max 3 competing hypotheses per domain; revise on contradiction
- **P5 Honest Confidence:** Represents belief, not truth; conservative by default; under-confidence safer than over
- **P6 Evidence Citation:** Every non-trivial conclusion must cite supporting evidence
- **P7 Hallucination Rejection:** Prefer null over fabrication; 7 anti-hallucination rules (AH1-AH7)
- **P8 Provider Independence:** Enforced through structural validation, not prompt engineering

## Operating Philosophy (frozen)
"Observe before interpreting. Build understanding progressively. Preserve deterministic facts. Cite evidence for every conclusion. Form hypotheses, not assumptions. Prefer uncertainty over fabricated certainty. Ground all reasoning in observed reality. Never replace deterministic systems."

## Evidence Hierarchy (4 tiers)
T1 Deterministic Facts (highest) → T2 Structural Context → T3 Behavioral Patterns → T4 Semantic Inference (lowest, needs corroboration)

## 8 Supplementary frozen decisions (S1-S8)
Key: 4-tier evidence weighting; max 3 hypotheses/domain; context switches reset workflow; confidence never absolute; hypotheses below floor discarded; 7 AH rules; null is success; graceful degradation always.

## Research foundation
Hallucination prevention (CoT prompting -86.4%, mandatory source citation, RAG grounding), MHT (competing hypotheses scored by likelihood, pruned by disconfirmation), Confidence calibration (RLCR -90% calibration error, conservative defaults, calibration vs sharpness trade-off).

## Compatibility: ALL frozen milestones preserved. Zero architecture changes.

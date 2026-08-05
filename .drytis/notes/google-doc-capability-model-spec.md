# Google Doc: Capability Model Architecture Specification

Source: https://docs.google.com/document/d/1j6S-OxgjlKevDHr8vVkwBEEqG4NSJkZwlukAksU0QUU/edit

## Full Content

We will perform the remaining real-world extension validation manually. Now please proceed with the complete Capability Model architecture and detailed design only — do not implement anything yet.

The Capability Model's responsibility is: "Identify what application/UI capability was exercised based on observable recording evidence, without speculating about the user's broader intent or goal."

Design it on top of our accepted pipeline:
ComponentInteraction → M1 Behavioral Observation → M2 Semantic Effects → Capability Model

The user is deliberately recording an existing test scenario by following its test steps, so treat the recording as a purposeful test workflow rather than arbitrary browsing.

### Required sections:
1. Capability definition and boundary
2. Capability V1 taxonomy (smallest useful set)
3. Evidence model (which existing fields to consume)
4. Inference architecture (how signals combine)
5. Keyword dictionary architecture (extensible, app-agnostic)
6. Confidence model (HIGH/MEDIUM/LOW)
7. Unknown/unclassified handling
8. Sequence/context use
9. Capability output schema
10. Replay relationship
11. Amazon case trace (physical stays Link, capability = FilterSelection)
12. Counterexamples ("Learn about filters" must NOT become FilterSelection)
13. Representative examples (search, filter, sort, pagination, submit, etc.)
14. M1 raw evidence question (operate from M2 normally, selectively consult M1)
15. Performance architecture (not heavy, when inference runs)
16. Extensibility
17. Failure/conflict handling
18. Testing strategy

Do not implement until reviewed and approved.

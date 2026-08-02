# FROZEN ROADMAP — Architectural Decisions & Phase Ordering

> **FROZEN:** 2026-08-02. Do not reinterpret these decisions without code-level evidence.
> **SHA:** 00f9fcebe3009c17f2481f2df20786a4899aaf3d
> **Predecessors:** whole-system-consolidation.md, roadmap-sequencing-qa.md, audits 01-04

---

## Frozen Architectural Decisions

### AD-1: Three Identity Layers (Non-Overlapping)
- **R4 Element Identity** — cross-session reconciliation, 8-dimension scoring at 0.70 threshold
- **businessField** — intra-session data-field binding, `accessibleName` (Tier 1)
- **displayLabel** — human-readable display, preserved independently on LogicalAction/CapabilityInput

Evidence: R4 spec (frozen b4d558a), Phase 5 deriveBusinessField (commit 55fea59), P2 binding resolver (element-binding-resolver.ts:111,133).

### AD-2: businessField = accessibleName (Tier 1 Restoration)
Not the long-term P1 vision (field="maxPrice", label="Maximum Price"). Requires future fieldKey derivation layer. displayLabel is forward-compatible.

Evidence: Original Phase 5 deriveBusinessField returned accessibleName. P1 aspirational examples (P1 spec lines 469, 558) assume fieldKey layer that doesn't exist. UiElementSummary carries accessibleName but not identity.name. Binding resolver fallback paths expect accessibleName.

### AD-3: Phase 3 ComponentInteraction Is Authoritative Classifier
Component Runtime's shouldComplete() determines semantic completeness. Lifecycle/CONFIRMED must evolve to consume endState, not duplicate the check with cruder multi-operation set-containment.

Evidence: Phase 2 classified Component Runtime as authoritative. Phase 3 unified to single ComponentInteraction model. Adapter creates ONE transition per ComponentInteraction. Multi-operation expectedLifecycle sets can never be satisfied.

### AD-4: P1 Review Flow Already Production-Wired
createReview() → processDecision() → P2CapabilityContract lifecycle exists in production code. Reviewer edits UI is the only missing piece (UX enhancement, not pipeline gate).

Evidence: session-persistence-service.ts:126 calls createReview(). service-worker.ts:942 calls processDecision(). sidepanel.ts:780 renders review card with approve/reject. Contract stored at CAPABILITY_INVENTORY + '_contract'.

### AD-5: Evidence Trail NOT Persisted in Capability Knowledge
P1 spec §4.2: evidence trail provenance lifetime is intentional. Confidence surfaced in review UI only.

### AD-6: PatternDefinitions Complementary, Not Prerequisite
Single-element interactions (Slider, DatePicker, FileUpload, TextEntry, Checkbox) reach capability through standalone path WITHOUT PatternDefinitions. Missing patterns are NOT defects.

### AD-7: Non-Data-Input Types Produce No DataRequirements
Click, Navigation, Tab, Hover, Scroll do not produce DataRequirements. Binary gate (businessField !== null) is deliberate. D7.

### AD-8: P2 Not Production-Wired (Intentional Sequencing)
generateCapabilityIR() has zero production callers. P2 depends on Tier 1 making contracts non-empty. Wiring happens after Tier 1.

---

## Frozen Phase Ordering

```
Phase A (Tier 1) → Phase B (P2 Wiring) → Phase C (Tier 2) → Phase E (Tier 3) → Phase F (P3) → Phase G (P4-P6)
                                                ↑
                                    Phase D (Reviewer Edits UI — parallel)
```

**Critical path: Tier 1 → P2 Wiring.** Everything after is enrichment.

### Dependency Justification

| Transition | Evidence |
|---|---|
| Tier 1 before P2 | P2 needs non-empty DataRequirements. Without Tier 1, contracts have zero inputs. |
| P2 before Tier 2 | P2 works with standalone actions. Component recognition bugs don't obscure P2 wiring bugs. |
| Tier 2 before Tier 3 | ARIA-compliant path (data exists) validates recognition before ARIA-absent path (needs MV3 DOM access). |
| P3 after P2 | P3 generates TestData. P2 consumes it. P2 must exist first. |

### Tier 1 Boundary

Unblocks ALL single-element data-input interactions with non-empty accessibleName. Does NOT unblock: optionSets, multi-field configuration, component-grouped actions.

---

## Finding Classification (Final)

| ID | Category | Description |
|---|---|---|
| A1/C3 | Defect | domAttributes always empty — typed fields never projected |
| A2/C5 | Defect | componentId never assigned — dead code from Phase 6 |
| A3/C2 | Defect | businessField always null — NoOpDomInspector, accessibleName never read |
| A4/C4 | Defect | ancestorRoles truncated — only target, not chain |
| A5 | Defect | Checkbox behavioral recognizer lifecycle mismatch |
| A6 | Defect | RadioButton TOGGLE vs RADIO_GROUP SELECT |
| A7 | Defect | Dropdown [CLICK,SELECT] unachievable with single transition |
| A8 | Defect | relatedElementIds always empty |
| C7 | Arch mismatch | Lifecycle model incompatible with Phase 3 ComponentInteraction |
| D1-D8 | Intentional | Standalone, patterns, P2 sequencing, evidence trail, non-data-input, fieldKey |
| U1-U5 | Unresolved | OptionSets, enrichConfigurationSession wiring, structural recognition coverage, fieldKey |

*End of Frozen Roadmap.*

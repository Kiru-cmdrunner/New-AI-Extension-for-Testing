# Evidence Classifier Stabilization Phase

## Goal
Validate that the Phase 1 evidence-based classifier is stable, accurate, and ready to become the foundation for Phase 2. No new features — only validation, diagnostics, tuning, and regression analysis.

## Scope

### 1. Cross-Domain Validation Suite
Create `tests/evidence-stabilization.test.ts` with realistic DOM interaction patterns from:
- E-commerce (filter toggles, product cards, checkout buttons)
- Banking (account cards, transfer forms, security toggles)
- Travel (flight search, seat selection, booking)
- Enterprise CRM/ERP/HRMS (data tables, CRUD, tabs, modals)
- SaaS dashboards (chart clicks, filter panels, settings)
- CMS/Admin (editors, menus, publish buttons)
- Healthcare (appointment schedulers, forms)
- Government (form wizards, document upload)
- Social media (like/follow toggles, comments)
- Component libraries (MUI, AntD, Chakra, Radix patterns)
- Accessibility-first (aria-only semantics)
- Non-semantic sites (div-soup, no aria)

Each scenario tests classifyByEvidence with realistic ElementIdentity + DomContext.
Acceptance criteria: each scenario asserts the expected InteractionType.

### 2. Developer Diagnostics Module
Create `src/classifier/evidence/diagnostics.ts`:
- `formatReasoningTrace(result: EvidenceClassification): string` — human-readable trace
- `formatCompact(result: EvidenceClassification): string` — one-line summary
- Include: selected intent, derived type, confidence, positive/negative evidence sorted by weight, runner-up

### 3. Evidence Weight Calibration Analysis
After running validation:
- Count how often each generator fires
- Identify generators that dominate (decide >60% of cases alone)
- Identify generators that never fire
- Identify misclassifications
- Document recommended adjustments

### 4. Regression Analysis
Compare evidence classifier vs old cascade classifier behavior:
- Cases that improved (correct now, wrong before)
- Cases that regressed (wrong now, correct before)
- Cases that are ambiguous (could go either way)
- Cases that fall back to Click

### 5. Stabilization Report
Final output documenting readiness, risks, and Phase 2 recommendations.

## Files to Create/Modify
- NEW: `src/classifier/evidence/diagnostics.ts`
- NEW: `tests/evidence-stabilization.test.ts`
- NEW: `tests/evidence-diagnostics.test.ts`
- POSSIBLY MODIFIED: `src/classifier/evidence/generators.ts` (weight tuning)
- POSSIBLY MODIFIED: `src/classifier/evidence/type-deriver.ts` (edge case fixes)
- POSSIBLY MODIFIED: existing test expectations (if weight tuning changes confidence values)

## Acceptance Criteria
- [ ] Cross-domain validation suite covers 10+ domains with 40+ scenarios
- [ ] Developer diagnostics module with formatReasoningTrace + formatCompact
- [ ] Diagnostics unit tests pass
- [ ] Weight calibration analysis documented
- [ ] Any weight adjustments applied and validated
- [ ] No regressions in full test suite (4712+ pass, only pre-existing flaky test fails)
- [ ] Stabilization report produced
- [ ] Infrastructure gate passes
- [ ] Reviewer passes

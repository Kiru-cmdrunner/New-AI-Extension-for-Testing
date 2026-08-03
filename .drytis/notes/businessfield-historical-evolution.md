# businessField: Historical Evolution and Semantic Meaning

## Timeline

### Era 1: AI-Assigned Semantic Name (Root commit 55fea59, Jul 21)
- `ComponentGrouping.businessField`: "Semantic name in the application domain (e.g., 'Travel Class'). **Null until AI enrichment or manual naming.**"
- `LogicalAction.businessField`: "Business-field label for the affected field, from enrichment."
- `ui-knowledge-model.md`: "businessField: semantic name (AI-assigned, null until enrichment)"
- Entity design: null on creation, populated by a future AI/manual enrichment step.
- Examples in domain-schema.md use accessibleName ('Email', 'Password', 'Sign In') at the IR level — NOT businessField.

### Era 2: Three-Layer Architecture (fcb0b0b, Jul 30)
STRUCTURAL_SEMANTIC_ENRICHMENT_DESIGN.md introduced the explicit three-layer split:
- Layer 1: Observation (ComponentInteraction with subActions)
- Layer 2: Structural Semantic (ConfigurationSession via enrichConfigurationSession())
- Layer 3: Business Semantic (Capability Model, "Phase 2")

Layer 2 produces Title Case display labels via normalizeFieldName():
- 'Increase adults' → strip verb → 'Adults' (Title Case)
- 'On Sale' → label as-is → 'On Sale'
- 'Maximum Price' → label as-is → 'Maximum Price'
- Principle S3: "Structural, Not Semantic — recognizes patterns, never assigns business meaning."

§9.4 shows the TWO-STEP derivation:
```
Layer 2 output:  { label: "Adults", kind: "counter", finalValue: "2" }
Layer 3 output:  { businessField: "adultCount", source: "Adults", type: "number", value: 2 }
```
Layer 3 was responsible for: structural label → camelCase business key mapping.

### Era 3: Phase 5 Simplification (root commit, spec within 55fea59)
Phase 5 spec changed the derivation source:
- Constraint #3: "businessField from accessibleName/label" — moved from AI enrichment to deterministic accessibleName
- Acceptance: "BusinessField populated from accessibleName/label of component root"
- Flow: "For each confirmed component: extract optionSet + businessField (DOM inspection)"
- Only specified for CONFIRMED COMPONENTS — standalone transitions had no derivation path.

### Era 4: P1/P2 Design Examples (7ccc4e6 / cb75d94, Aug 1)
Both specs consistently show camelCase businessField values:
- Login: 'email', 'password'
- Filter Products: 'category', 'onSale', 'maxPrice'
- Search: 'searchQuery'

P1 spec says "enrichConfigurationSession() — Reused as-is — produces businessField names" but that function produces Title Case ('Adults'), not camelCase ('adultCount'). The P1 author assumed the Layer 3 mapping exists — it does not.

P2 binding resolver does exact match: `LogicalAction.businessField === DataRequirement.field`.

humanizeLabel() in capability-mappers.ts was designed for camelCase → Title Case: 'maxPrice' → 'Max Price'. Confirms design intent was camelCase input.

### Era 5: Actual Implementation
- deriveBusinessField() in option-set-extractor.ts reads accessibleName as-is: 'Maximum Price'
- buildStandaloneAction() hardcodes businessField: null
- No camelCase normalization exists anywhere in the production pipeline
- humanizeLabel('Maximum Price') = 'Maximum Price' (no-op since already display format)
- P2 walkthrough test manually constructs camelCase businessFields that production never produces

## Key Findings
1. businessField was NEVER intended to be raw accessibleName — it was always a semantic key
2. The original three-layer design explicitly assigned camelCase key derivation to Layer 3
3. Layer 3 (the Capability Model's structural→business mapping) was never implemented
4. Phase 5 moved the derivation to Layer 2 but only for confirmed components
5. The camelCase examples in P1/P2 specs assume a mapping step that doesn't exist
6. The implementation gap (raw accessibleName instead of camelCase key) means humanizeLabel is a no-op on production data

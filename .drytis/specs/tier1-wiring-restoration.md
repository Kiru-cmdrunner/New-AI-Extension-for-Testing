# Tier 1 Implementation + Validation Plan

> **Status:** APPROVED — ready for implementation
> **Baseline:** Frozen baseline 4c7cae2 + audit commit 900a51e
> **Principle:** Complete wiring connections between data that already exists. No new architecture.

---

## Scope

Four changes restore the designed data flow from ComponentInteraction → Domain Adapter → Enrichment → Capability → P2:

| ID | Change | Boundary |
|---|---|---|
| C1 | `sourceInteractionType` through adapter → standalone | ComponentInteraction → ObservedTransition → LogicalAction |
| C2 | `businessField` from accessibleName + `displayLabel` independently | UiElement.identity → LogicalAction → CapabilityInput → DataRequirement |
| C3 | `domAttributes` Record from typed DomContext fields | RecordedEvent.DomContext → UiElement.domAttributes → InteractionContract |
| D1 | Wire C1+C2 into `buildStandaloneAction` | semantic-aggregator.ts |

---

## C1: Restore `sourceInteractionType`

### Contract Being Restored
> "The interaction type survives via LogicalAction.sourceInteractionType → DataRequirement.inputMethod." — P1 spec §4.2

### The Problem
`ComponentInteraction.type` (e.g., `'TextEntry'`, `'Checkbox'`) is the authoritative classification from the Component Runtime. The domain adapter discards it — `ObservedTransition` has no field for it. `buildStandaloneAction()` hardcodes `sourceInteractionType: null`. P1's `INTERACTION_TYPE_TO_INPUT_METHOD` map can never fire.

### Changes

**`src/domain/entities/observed-transition.ts`:**
- Add to `ObservedTransition` interface: `readonly sourceInteractionType: string | null;`
- Add to `CreateObservedTransitionInput`: `sourceInteractionType?: string | null;`
- In `createObservedTransition()`: `sourceInteractionType: input.sourceInteractionType ?? null,`

**`src/recorder/pipeline/domain-adapter-v2.ts`** (transition creation, ~line 427):
- Add: `sourceInteractionType: resolvedType,` to `createObservedTransition` call

**`src/recorder/enrichment/semantic-aggregator.ts`** (`buildStandaloneAction`, line 316-327):
- Change `sourceInteractionType: null` → `sourceInteractionType: t.sourceInteractionType as InteractionType | null`

### Regression Risks
- Existing tests constructing ObservedTransition without the field → mitigated by optional + `?? null` default
- `TransitionSummary` doesn't carry it → not needed (LogicalAction carries it)
- Code checking `sourceInteractionType === null` as standalone signal → `componentId === null` is the real discriminator

### Tests Required
- Unit: adapter creates transition with `sourceInteractionType === ci.type` for each InteractionType
- Unit: `buildStandaloneAction` passes it from transition to LogicalAction
- Integration: `INTERACTION_TYPE_TO_INPUT_METHOD` resolves correct `inputMethod` on standalone actions

---

## C2: Restore `businessField` + Preserve `displayLabel` Independently

### Contract Being Restored
> "businessField from accessibleName/label (a DOM attribute)." — Phase 5 spec §3
> "field = Machine-readable field identifier; label = Human-readable label." — P1 spec §3.1
> "do not assume humanizeLabel(field) can always reconstruct the real UI/business label." — User directive

### Design Decision
`businessField = accessibleName` (from `UiElement.identity.accessibleName`). This is the original Phase 5 designed flow. Always available, consistent with all binding resolver paths.

`displayLabel = accessibleName` (same value, preserved independently). Ensures `DataRequirement.label` uses the real accessibleName, NOT `humanizeLabel(businessField)`. When businessField = accessibleName (always in Tier 1), displayLabel is redundant but forward-compatible.

**Why not use `identity.name` (HTML form name)?**
- Only present on form elements (`<input>`, `<select>`), not on custom ARIA widgets
- R4 already scores FORM_NAME at 15% for cross-session matching — that's where form name provides value
- Breaks binding resolver fallback paths that expect `accessibleName === businessField`
- The P1 spec's camelCase examples (`email`, `maxPrice`) were aspirational — no normalization function exists
- A future `fieldKey` derivation layer can split `field` from `label` without changing types

### Changes

**New function** in `src/recorder/enrichment/business-field-resolver.ts`:
```typescript
interface ResolvedBusinessField {
  businessField: string | null;
  displayLabel: string | null;
}

function resolveBusinessField(identity: ElementIdentity): ResolvedBusinessField {
  const accessibleName = identity.accessibleName?.trim() || null;
  const humanLabel = accessibleName
    ?? identity.ariaLabel?.trim() || null
    ?? identity.placeholder?.trim() || null
    ?? null;
  return {
    businessField: humanLabel,
    displayLabel: humanLabel,
  };
}
```

**`src/domain/entities/application-knowledge.ts`** — `LogicalAction`:
- Add: `readonly displayLabel: string | null;`

**`src/recorder/enrichment/semantic-aggregator.ts`**:
- Add `elements: readonly UiElement[]` to `AggregationInput`
- `buildStandaloneAction(t, elements)` — look up element by `t.elementId`, resolve businessField

**`src/domain/entities/capability-candidate.ts`** — `CapabilityInput`:
- Add: `readonly displayLabel: string | null;`

**`src/recorder/enrichment/capability-deriver.ts`** — `deriveInputs`:
- Set `displayLabel` from element summary's accessibleName

**`src/domain/mappings/capability-mappers.ts`** — `capabilityInputToDataRequirement`:
- `field = input.label` (= businessField = accessibleName)
- `label = input.displayLabel ?? humanizeLabel(input.label)` (= real accessibleName, not humanized)

### Regression Risks
- `AggregationInput` signature change — callers must pass `elements` (only enrichment-orchestrator.ts)
- `LogicalAction` new field — check Repository V2 serialization and golden master
- P2 binding fallback `el.accessibleName === action.businessField` works (both accessibleName)
- Standalone LogicalActions now have non-null businessField → `deriveInputs` produces real inputs

### Tests Required
- Unit: `resolveBusinessField` with various ElementIdentity combinations
- Unit: `buildStandaloneAction` resolves businessField from elements
- Unit: `capabilityInputToDataRequirement` uses displayLabel, falls back to humanizeLabel
- Integration: login form → DataRequirement.field = DataRequirement.label = accessibleName

---

## C3: Restore `domAttributes` From Typed DomContext Fields

### Contract Being Restored
> "No DOM inspection needed — domAttributes is already captured on the UiElement." — Phase 5 spec §1
> "6.1: Extended DomContext with key DOM attributes (required, min, max, step, minlength, maxlength, pattern)" — Phase 6-7 commit

### The Problem
`dom-context-extractor.ts` captures typed fields (`required`, `pattern`, `minLength`, etc.) on `component-types.ts DomContext`. The adapter reads `firstEvent.domContext?.domAttributes` — a Record that was NEVER populated. Phase 6-7 added `domAttributes` to `RecordedEvent.DomContext` with a comment saying it's "the source of InteractionContract derivation" but never implemented the capture function.

### Changes

**`src/recorder/pipeline/domain-adapter-v2.ts`** (replacing lines 393-394):
```typescript
const dc = firstEvent?.domContext as {
  required?: boolean;
  inputType?: string | null;
  pattern?: string | null;
  minLength?: number | null;
  maxLength?: number | null;
  min?: string | null;
  max?: string | null;
  step?: string | null;
} | undefined;

const domAttributes: Record<string, string> = {};
if (dc && firstEvent.eventType !== 'navigation') {
  if (dc.required) domAttributes['required'] = '';
  if (dc.inputType) domAttributes['type'] = dc.inputType;
  if (dc.pattern) domAttributes['pattern'] = dc.pattern;
  if (dc.minLength != null) domAttributes['minlength'] = String(dc.minLength);
  if (dc.maxLength != null) domAttributes['maxlength'] = String(dc.maxLength);
  if (dc.min) domAttributes['min'] = dc.min;
  if (dc.max) domAttributes['max'] = dc.max;
  if (dc.step) domAttributes['step'] = dc.step;
}
```

### Regression Risks
- Test fixtures without full DomContext → domAttributes stays {} (same as current)
- InteractionContractDeriver now gets real constraints → NEW behavior. Validation rules will be generated.
- Golden master may need updating to reflect populated constraints.

### Tests Required
- Unit: adapter builds domAttributes with all fields from typed DomContext
- Unit: adapter produces {} when DomContext fields are null/absent
- Integration: `deriveInteractionContract` produces non-null constraints
- Integration: `deriveValidationRules` produces correct rules

---

## D1: Wire Standalone Enrichment

### Contract Being Restored
> "Transitions with componentId === null are standalone — each forms its own action." — Phase 5 spec §5

### The Problem
`buildStandaloneAction()` hardcodes `businessField: null` and `sourceInteractionType: null`. D1 is not a separate code change — it's the integration that connects C1 and C2 to the standalone action output.

### Changes
Covered by C1 (pass through sourceInteractionType) and C2 (resolve businessField). No additional code.

---

## Expected Output: Before vs After

### Test Scenario: Login Form
- `<input name="email" type="email" required aria-label="Email Address">`
- `<input name="password" type="password" required>`

**BEFORE (current):**
```
LogicalActions: [{ businessField: null, sourceInteractionType: null }]
InteractionContracts: [{ constraints: { ALL NULL } }]
CapabilityCandidate: { name: undefined, inputs: [], validationRules: [] }
DataRequirements: []
```

**AFTER Tier 1:**
```
LogicalActions: [
  { businessField: "Email Address", displayLabel: "Email Address", sourceInteractionType: "TextEntry" },
  { businessField: "Password", displayLabel: null, sourceInteractionType: "TextEntry" },
]
InteractionContracts: [
  { constraints: { required: true, inputType: "email", format: {...} } },
  { constraints: { required: true, inputType: "password" } },
]
CapabilityCandidate: {
  name: "Email Address",
  inputs: [
    { label: "Email Address", displayLabel: "Email Address", sourceInteractionType: "TextEntry", required: true, inputType: "email" },
    { label: "Password", displayLabel: null, sourceInteractionType: "TextEntry", required: true, inputType: "password" },
  ],
  validationRules: [
    { field: "Email Address", type: "required" },
    { field: "Email Address", type: "format" },
    { field: "Password", type: "required" },
  ],
}
DataRequirements: [
  { field: "Email Address", label: "Email Address", kind: "email", inputMethod: "text", required: true },
  { field: "Password", label: "Password", kind: "text", inputMethod: "text", required: true },
]
```

---

## Test Matrix

### Category 1: Native Controls
| Interaction | Expected sourceInteractionType | Expected constraints |
|---|---|---|
| TextEntry (email) | TextEntry | required, email format |
| TextEntry (password, minlength=8) | TextEntry | required, minLength:8 |
| Checkbox | Checkbox | inputType:checkbox |
| Native Slider (min/max/step) | Slider | valueRange:{min,max,step} |

### Category 2: Custom Controls (R3-reclassified)
| Scenario | Expected type | Reaches capability? |
|---|---|---|
| div-checkbox (class toggle) | Checkbox | YES |
| button[aria-expanded] dropdown | Dropdown | YES |
| contentEditable text | TextEntry | YES |

### Category 3: End-to-End Extension Flow
| Test | What it proves |
|---|---|
| Record 3-field form via extension | Full production pipeline works |
| Inspect UnderstandingResult in storage | Semantic knowledge reaches SW context |

### Category 4: Edge Cases
| Scenario | Expected |
|---|---|
| Button click (non-data-input) | businessField=null, no CapabilityInput |
| Text input without accessibleName | businessField=ariaLabel or placeholder |
| Element with neither | businessField=null, skipped |

---

## Implementation Order

```
Step 1: C1 — ObservedTransition.sourceInteractionType
Step 2: C3 — domAttributes from typed DomContext  (parallel with C1)
Step 3: C2 — resolveBusinessField + displayLabel   (depends on C1)
Step 4: D1 — buildStandaloneAction integration     (depends on C1+C2)
```

After each step: run `npm test`. After all steps: run full test matrix.

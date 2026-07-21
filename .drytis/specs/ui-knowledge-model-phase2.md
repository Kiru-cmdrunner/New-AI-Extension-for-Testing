# Phase 2 — Pattern Catalogue + Structural Recognizer (Tier 1)

> **Status:** Ready for implementation.
> **Depends on:** Phase 1 (foundational entities) — complete.
> **Architecture ref:** `.drytis/ui-knowledge-model.md` §4 (Component Recognition, Tier 1)

## Goal

Build the declarative pattern catalogue and a generic structural recognizer that uses it.
Validate that `UiElement` and `ComponentGrouping` provide enough information for reliable
component recognition across real-world applications (Radix, MUI, Headless UI, WAI-ARIA APG).

## Design Principle

The recognizer must be **generic** — zero pattern-specific logic. The catalogue is the
**declarative source** of pattern definitions. Adding a new pattern = adding a catalogue
entry, NOT modifying the recognizer.

## Files to Create

```
src/recorder/recognition/
  pattern-catalogue.ts      — PatternDefinition type + V1 patterns + registry
  structural-recognizer.ts  — generic Tier 1 recognizer driven by catalogue
tests/recognition/
  pattern-catalogue.test.ts       — catalogue registration, lookup, validation
  structural-recognizer.test.ts   — recognition against real-world ARIA fixtures
```

## Data Structures

### PatternDefinition (declarative)

```typescript
interface PatternDefinition {
  patternType: PatternType;

  /** ARIA roles that identify this pattern's root/container element. */
  rootAriaRoles: string[];

  /**
   * Constituent roles this pattern expects.
   * Maps ComponentRole → ARIA roles that indicate an element playing that part.
   * The recognizer assigns roles based on these mappings.
   */
  constituentRoles: Record<ComponentRole, string[]>;

  /**
   * Affordances (operations) this component type supports.
   * Used by InteractionContract derivation (Phase 7 enrichment).
   */
  affordances: string[];

  /**
   * Whether this pattern type has a selectable option set.
   * true: dropdown, radioGroup, combobox → optionSet extracted at enrichment.
   * false: modal, tabs (container) → no option set.
   */
  hasOptionSet: boolean;

  /**
   * Minimum number of constituents required for confident recognition.
   * e.g., dropdown needs at least: trigger + 1 option.
   */
  minConstituents: number;

  /**
   * Human-readable description for debugging/audit.
   */
  description: string;
}
```

### RecognitionInput

```typescript
interface RecognitionInput {
  /** The element that was interacted with (primary target). */
  element: {
    elementId: string;
    ariaRole: string | null;
    tag: string;
  };
  /**
   * Ancestor roles from root to target (inclusive).
   * This comes from AncestorContext.roles + the element's own role.
   * Ordered outermost → innermost.
   */
  ancestorRoles: string[];
  /**
   * All elements in the current DOM subtree of the recognized root.
   * Populated by the ConstituentResolver (Phase 5). For Tier 1,
   * the recognizer uses ancestorRoles + elementRole to match.
   */
  siblingElementRoles?: Array<{ elementId: string; ariaRole: string | null }>;
}
```

### RecognitionResult

```typescript
interface RecognitionResult {
  /** null = no structural match found. */
  patternType: PatternType | null;

  /** The root elementId anchoring the component (the element with the root ARIA role). */
  rootElementId: string | null;

  /** Assigned constituent roles, keyed by elementId. */
  constituents: Array<{ elementId: string; role: ComponentRole }>;

  /** Confidence for this recognition (always ≥0.95 for Tier 1 structural). */
  confidence: number;

  /** Which root ARIA role matched. */
  matchedRole: string | null;

  /** null if no match. */
  reason: string | null;
}
```

## V1 Patterns (5)

### 1. Dropdown / Combobox

```
rootAriaRoles: ['combobox', 'listbox']
constituentRoles:
  TRIGGER → ['combobox']
  OPTION  → ['option']
  CONTAINER → ['listbox']
affordances: ['open', 'select', 'search', 'commit', 'close']
hasOptionSet: true
minConstituents: 2 (trigger + at least 1 option)
```

### 2. Checkbox

```
rootAriaRoles: ['checkbox']  (single element, no composite)
constituentRoles:
  TRIGGER → ['checkbox']
affordances: ['toggle']
hasOptionSet: false
minConstituents: 1
```

### 3. Radio Group

```
rootAriaRoles: ['radiogroup']
constituentRoles:
  CONTAINER → ['radiogroup']
  OPTION    → ['radio', 'menuitemradio']
affordances: ['select']
hasOptionSet: true
minConstituents: 2 (container + at least 1 radio)
```

### 4. Modal / Dialog

```
rootAriaRoles: ['dialog', 'alertdialog']
constituentRoles:
  CONTAINER → ['dialog', 'alertdialog']
  COMMIT    → ['button']   (confirm/close — role inferred from position)
  CANCEL    → ['button']
affordances: ['close', 'commit', 'cancel']
hasOptionSet: false
minConstituents: 1 (the dialog itself)
```

### 5. Tabs

```
rootAriaRoles: ['tablist']
constituentRoles:
  CONTAINER → ['tablist']
  TAB       → ['tab']
  PANEL     → ['tabpanel']
affordances: ['activate']
hasOptionSet: false
minConstituents: 2 (tablist + at least 1 tab)
```

## Recognition Algorithm (generic)

```
function recognize(input: RecognitionInput): RecognitionResult

1. Build role chain: ancestorRoles + element's own role (outermost → innermost)
2. For each PatternDefinition in catalogue (ordered by specificity):
   a. Find the root ARIA role: check if any role in the chain matches rootAriaRoles
   b. If root found:
      - Assign TRIGGER/OPTION/CONTAINER roles to elements based on constituentRoles mapping
      - Check minConstituents is satisfied
      - Return RecognitionResult with confidence = 0.95
3. Return null result if no pattern matched
```

Specificity ordering: patterns with fewer rootAriaRoles (more specific) are checked first.
E.g., `radiogroup` is more specific than `listbox`.

## Acceptance Criteria

- [ ] `PatternDefinition` type defined with all fields above
- [ ] 5 V1 patterns registered in catalogue: dropdown, checkbox, radioGroup, modal, tabs
- [ ] `getPattern(type)`, `getAllPatterns()`, `registerPattern(def)` API on catalogue
- [ ] `registerPattern` validates: non-empty rootAriaRoles, non-empty constituentRoles, minConstituents ≥ 1
- [ ] `StructuralRecognizer` class with `recognize(input: RecognitionInput): RecognitionResult`
- [ ] Recognizer contains ZERO pattern-specific if/switch logic — all from catalogue
- [ ] Recognition works against WAI-ARIA APG examples (combobox, dialog, tabs, radiogroup)
- [ ] Recognition works against real component library ARIA output (Radix, MUI, Headless UI)
- [ ] Confidence is always 0.95 for structural matches (Tier 1 minimum)
- [ ] Returns null result when no pattern matches (non-component element)
- [ ] Unit tests: ≥15 tests covering catalogue + recognizer with real-world fixtures
- [ ] No modifications to existing code outside `src/recorder/recognition/` and `tests/recognition/`

## Real-World Validation Fixtures

Tests MUST use real ARIA structures from actual component libraries:

1. **WAI-ARIA APG Combobox** — the canonical reference: `role="combobox"` with
   `aria-expanded`, child `role="listbox"` with `role="option"` children.

2. **Radix UI Select** — `role="combobox"` trigger, `role="listbox"` popup with
   `role="option"` children and `data-radix-*` attributes.

3. **Headless UI Listbox** — `role="listbox"` container with `role="option"` children,
   `aria-selected` state, `tabindex` management.

4. **Material UI Dialog** — `role="dialog"` with `aria-modal="true"`, focus trap,
   close button as `role="button"`.

5. **MUI Tabs** — `role="tablist"` container, `role="tab"` children with
   `aria-selected`, `aria-controls` pointing to `role="tabpanel"`.

6. **Standalone button** — no ARIA widget role → should return null (no component).

## What We're Validating

This phase validates:
1. The `UiElement` shape carries enough ARIA role data for recognition (element's own role)
2. The `AncestorContext` pattern (ancestor roles chain) provides sufficient context
3. `ComponentGrouping` accepts the recognized constituents cleanly
4. The catalogue's declarative format is expressive enough for 5 real patterns
5. The recognizer needs no pattern-specific code

If any of these fail, we refine the foundational entities rather than adding complexity.

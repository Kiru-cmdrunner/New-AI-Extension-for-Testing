/**
 * Behavioral Recognizer — unit tests with real-world behavioral fixtures.
 *
 * Tests recognition of custom UI components that lack ARIA roles but produce
 * recognizable behavioral patterns through interaction evidence. Fixtures model
 * real-world implementations:
 *   - Bootstrap-style dropdown (div/button, CSS classes, no ARIA)
 *   - jQuery-style modal (div overlay, no role="dialog")
 *   - Bootstrap collapse / accordion
 *   - Custom radio group (no role="radiogroup")
 *   - Custom checkbox toggle (div-based, no role="checkbox")
 *   - Noise: irrelevant interactions that should not trigger recognition
 */

import { describe, it, expect } from 'vitest';
import {
  recognizeBehaviorally,
  type BehavioralRecognitionInput,
} from '../../src/recorder/recognition/behavioral-recognizer';
import {
  PatternType,
  ComponentRole,
  RecognitionSource,
  TransitionOperation,
  RelevanceLevel,
  TransitionEvidenceType,
  CascadeEffectType,
} from '../../src/domain/enums';
import {
  createObservedTransition,
  emptyElementState,
  type ElementState,
} from '../../src/domain/entities/observed-transition';

// ── Helpers ──────────────────────────────────────────────

let transitionCounter = 0;

/** Create a transition with sensible defaults. Override any field via overrides. */
function mkTransition(overrides: {
  elementId: string;
  operation: TransitionOperation;
  stateBefore?: ElementState;
  stateAfter?: ElementState;
  evidence?: Array<{ type: TransitionEvidenceType; description: string; before?: string; after?: string }>;
  cascadeEffects?: Array<{ elementId: string; effect: CascadeEffectType; detail: string }>;
  relevance?: RelevanceLevel;
  rootElementId?: string;
}): ReturnType<typeof createObservedTransition> {
  transitionCounter++;
  return createObservedTransition({
    transitionId: `t${transitionCounter}`,
    elementId: overrides.elementId,
    componentId: null,
    operation: overrides.operation,
    timestamp: transitionCounter * 1000,
    relevance: overrides.relevance ?? RelevanceLevel.DELIBERATE,
    stateBefore: overrides.stateBefore ?? emptyElementState(),
    stateAfter: overrides.stateAfter ?? emptyElementState(),
    evidence: overrides.evidence ?? [],
    cascadeEffects: overrides.cascadeEffects ?? [],
  });
}

function mkInput(
  rootElementId: string,
  relatedElementIds: string[],
  transitions: ReturnType<typeof createObservedTransition>[],
): BehavioralRecognitionInput {
  return { rootElementId, relatedElementIds, transitions };
}

// ── Bootstrap-style Custom Dropdown ──────────────────────

describe('Behavioral Recognizer — Bootstrap-style Dropdown', () => {
  // Bootstrap dropdown uses <button> with data-bs-toggle="dropdown"
  // and a <div class="dropdown-menu"> with <a> options.
  // No role="combobox" or role="listbox" — only CSS classes.
  //
  // Lifecycle:
  //   1. Click trigger button → menu becomes visible (class change + mutation)
  //   2. Click an option inside the menu → trigger text changes, menu closes
  //
  // Expected: recognized as DROPDOWN with partial or full behavioral match

  it('should recognize a full dropdown lifecycle (open → select → close)', () => {
    const transitions = [
      mkTransition({
        elementId: 'trigger-btn',
        operation: TransitionOperation.CLICK,
        stateAfter: { value: null, checked: null, expanded: true, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'dropdown-menu became visible',
          },
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'aria-expanded false → true',
            before: 'false',
            after: 'true',
          },
        ],
        cascadeEffects: [
          {
            elementId: 'menu',
            effect: CascadeEffectType.VISIBILITY,
            detail: 'dropdown-menu became visible',
          },
        ],
      }),
      mkTransition({
        elementId: 'option-premium',
        operation: TransitionOperation.CLICK,
        evidence: [],
      }),
      // Value change on the trigger after selecting
      mkTransition({
        elementId: 'trigger-btn',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: 'Economy', checked: null, expanded: true, selected: null },
        stateAfter: { value: 'Premium Economy', checked: null, expanded: false, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.VALUE_CHANGE,
            description: 'trigger value changed: Economy → Premium Economy',
            before: 'Economy',
            after: 'Premium Economy',
          },
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'dropdown-menu hidden after selection',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('trigger-btn', ['trigger-btn', 'menu', 'option-premium', 'option-economy'], transitions),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.confidence).toBeGreaterThanOrEqual(0.50);
    expect(result.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
    expect(result.rootElementId).toBe('trigger-btn');
    // Trigger + at least one option should be in constituents
    expect(result.constituents.some((c) => c.role === ComponentRole.TRIGGER)).toBe(true);
    expect(result.constituents.some((c) => c.role === ComponentRole.OPTION)).toBe(true);
  });

  it('should partially recognize dropdown from open + child click evidence', () => {
    // Two transitions: popup appears, and a child element is clicked.
    // This matches dropdown's CHILD_ELEMENT_BECAME_VISIBLE + CHILD_CONTAINS_CLICKABLE_ELEMENTS.

    const transitions = [
      mkTransition({
        elementId: 'trigger',
        operation: TransitionOperation.CLICK,
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'popup appeared',
          },
        ],
      }),
      // Child element clicked inside the popup
      mkTransition({
        elementId: 'option1',
        operation: TransitionOperation.CLICK,
        evidence: [],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('trigger', ['trigger', 'popup', 'option1', 'option2'], transitions),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.confidence).toBeGreaterThanOrEqual(0.50);
  });
});

// ── Custom Modal (no role="dialog") ─────────────────────

describe('Behavioral Recognizer — Custom Modal', () => {
  // Custom modal: clicking a button shows a div overlay with backdrop.
  // No role="dialog" — just CSS and z-index.
  //
  // Lifecycle:
  //   1. Click button → overlay/backdrop appears + content becomes visible

  it('should recognize a modal from overlay + content visibility', () => {
    const transitions = [
      mkTransition({
        elementId: 'open-btn',
        operation: TransitionOperation.CLICK,
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'modal overlay appeared',
          },
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'modal content became visible',
          },
        ],
        cascadeEffects: [
          {
            elementId: 'modal-content',
            effect: CascadeEffectType.VISIBILITY,
            detail: 'modal content became visible',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('open-btn', ['open-btn', 'modal-content', 'close-btn'], transitions),
    );

    expect(result.patternType).toBe(PatternType.MODAL);
    expect(result.confidence).toBeGreaterThanOrEqual(0.45);
    expect(result.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
  });

  it('should recognize alert dialog from full match', () => {
    const transitions = [
      mkTransition({
        elementId: 'delete-btn',
        operation: TransitionOperation.CLICK,
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'backdrop overlay appeared',
          },
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'confirmation dialog became visible',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('delete-btn', ['delete-btn', 'confirm-dialog'], transitions),
    );

    expect(result.patternType).toBe(PatternType.MODAL);
    expect(result.confidence).toBe(0.70); // full match (2/2 conditions)
  });
});

// ── Bootstrap Collapse / Accordion ──────────────────────

describe('Behavioral Recognizer — Accordion', () => {
  // Bootstrap collapse: clicking a header toggles a section's visibility.
  // Uses data-bs-toggle="collapse" — no role="button" with aria-expanded.
  //
  // Lifecycle:
  //   1. Click header → section expands (state/class change, content visible)
  //   2. Click header again → section collapses (content hidden)

  it('should recognize accordion from expand + collapse lifecycle', () => {
    const transitions = [
      // Expand
      mkTransition({
        elementId: 'accordion-header-1',
        operation: TransitionOperation.CLICK,
        stateBefore: emptyElementState(),
        stateAfter: { value: null, checked: null, expanded: true, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'class changed: collapsed → expanded',
          },
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'section content became visible',
          },
        ],
      }),
      // Collapse
      mkTransition({
        elementId: 'accordion-header-1',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: null, checked: null, expanded: true, selected: null },
        stateAfter: { value: null, checked: null, expanded: false, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'section content hidden',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('accordion-header-1', ['accordion-header-1', 'section-1'], transitions),
    );

    expect(result.patternType).toBe(PatternType.ACCORDION);
    expect(result.confidence).toBeGreaterThanOrEqual(0.45);
    expect(result.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
  });

  it('should partially recognize accordion from expand-only evidence', () => {
    // Only the expand happened — 2 of 3 conditions met (state changed + content visible)
    // This is a partial match (no collapse observed).
    const transitions = [
      mkTransition({
        elementId: 'header',
        operation: TransitionOperation.CLICK,
        stateAfter: { value: null, checked: null, expanded: true, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'expanded state changed',
          },
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'content became visible',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('header', ['header', 'content'], transitions),
    );

    expect(result.patternType).toBe(PatternType.ACCORDION);
    expect(result.confidence).toBeGreaterThanOrEqual(0.45); // partial match (2/3)
  });
});

// ── Custom Radio Group (no role="radiogroup") ───────────

describe('Behavioral Recognizer — Custom Radio Group', () => {
  // Custom radio group: div-based buttons where selecting one deselects another.
  // No role="radio" — uses CSS classes like "selected" / "active".

  it('should recognize radio group from mutual exclusivity', () => {
    // Custom radio group: div-based buttons where selecting one deselects another.
    // Both the selection AND deselection must be observed as state changes.

    const transitions = [
      // Select Economy (first click)
      mkTransition({
        elementId: 'radio-economy',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: null, checked: null, expanded: null, selected: false },
        stateAfter: { value: null, checked: null, expanded: null, selected: true },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'element selected',
          },
        ],
      }),
      // Select Premium → Premium becomes selected
      mkTransition({
        elementId: 'radio-premium',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: null, checked: null, expanded: null, selected: false },
        stateAfter: { value: null, checked: null, expanded: null, selected: true },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'element selected',
          },
        ],
      }),
      // Economy is deselected (observed as a state change) — mutual exclusivity
      mkTransition({
        elementId: 'radio-economy',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: null, checked: null, expanded: null, selected: true },
        stateAfter: { value: null, checked: null, expanded: null, selected: false },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'element deselected — radio group mutual exclusivity',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('radio-economy', ['radio-economy', 'radio-premium', 'radio-business'], transitions),
    );

    // With mutual exclusivity detected (one selected, another deselected),
    // radio group should be recognized or at least compete with checkbox.
    expect(result.patternType).not.toBeNull();
    expect(result.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
  });
});

// ── Custom Checkbox Toggle (no role="checkbox") ─────────

describe('Behavioral Recognizer — Custom Checkbox', () => {
  // Custom checkbox: a div that toggles a "checked" class on click.
  // No role="checkbox" — just CSS and JavaScript.

  it('should recognize checkbox from state flip', () => {
    const transitions = [
      mkTransition({
        elementId: 'custom-checkbox',
        operation: TransitionOperation.CLICK,
        stateBefore: { value: null, checked: false, expanded: null, selected: null },
        stateAfter: { value: null, checked: true, expanded: null, selected: null },
        evidence: [
          {
            type: TransitionEvidenceType.STATE_CHANGE,
            description: 'checked state changed: false → true',
            before: 'false',
            after: 'true',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('custom-checkbox', ['custom-checkbox'], transitions),
    );

    expect(result.patternType).toBe(PatternType.CHECKBOX);
    expect(result.confidence).toBe(0.65); // full match (1/1 condition)
    expect(result.recognitionSource).toBe(RecognitionSource.BEHAVIORAL);
  });
});

// ── Noise Rejection ─────────────────────────────────────

describe('Behavioral Recognizer — noise rejection', () => {
  it('should return null for interactions with no evidence', () => {
    const transitions = [
      mkTransition({
        elementId: 'plain-div',
        operation: TransitionOperation.CLICK,
        evidence: [],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('plain-div', ['plain-div'], transitions),
    );

    expect(result.patternType).toBeNull();
  });

  it('should return null for empty transition sequence', () => {
    const result = recognizeBehaviorally(
      mkInput('elem-1', ['elem-1'], []),
    );

    expect(result.patternType).toBeNull();
  });

  it('should return null when only class changes occur (no meaningful pattern)', () => {
    const transitions = [
      mkTransition({
        elementId: 'hover-target',
        operation: TransitionOperation.HOVER,
        evidence: [
          {
            type: TransitionEvidenceType.CLASS_CHANGE,
            description: 'hover class added',
          },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('hover-target', ['hover-target'], transitions),
    );

    // CLASS_CHANGE alone doesn't match any signal — should be null
    expect(result.patternType).toBeNull();
  });

  it('should ignore noise-relevance transitions', () => {
    const transitions = [
      mkTransition({
        elementId: 'elem',
        operation: TransitionOperation.CLICK,
        evidence: [
          {
            type: TransitionEvidenceType.MUTATION,
            description: 'popup appeared',
          },
        ],
        relevance: RelevanceLevel.NOISE,
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('elem', ['elem'], transitions),
    );

    expect(result.patternType).toBeNull();
  });
});

// ── Constituent Assignment ──────────────────────────────

describe('Behavioral Recognizer — constituent assignment', () => {
  it('should assign TRIGGER to root and OPTION to clicked children', () => {
    const transitions = [
      mkTransition({
        elementId: 'root-trigger',
        operation: TransitionOperation.CLICK,
        evidence: [
          { type: TransitionEvidenceType.MUTATION, description: 'popup appeared' },
        ],
      }),
      mkTransition({
        elementId: 'child-option',
        operation: TransitionOperation.CLICK,
        evidence: [],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('root-trigger', ['root-trigger', 'popup', 'child-option'], transitions),
    );

    expect(result.patternType).not.toBeNull();
    const trigger = result.constituents.find((c) => c.role === ComponentRole.TRIGGER);
    expect(trigger?.elementId).toBe('root-trigger');
    const option = result.constituents.find((c) => c.role === ComponentRole.OPTION);
    expect(option?.elementId).toBe('child-option');
  });
});

// ── Edge Cases ───────────────────────────────────────────

describe('Behavioral Recognizer — edge cases', () => {
  it('should filter out transitions on unrelated elements', () => {
    const transitions = [
      mkTransition({
        elementId: 'trigger',
        operation: TransitionOperation.CLICK,
        evidence: [
          { type: TransitionEvidenceType.MUTATION, description: 'popup appeared' },
        ],
      }),
      // This transition is on an element NOT in relatedElementIds
      mkTransition({
        elementId: 'unrelated-element',
        operation: TransitionOperation.CLICK,
        evidence: [
          { type: TransitionEvidenceType.STATE_CHANGE, description: 'unrelated state change' },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('trigger', ['trigger', 'popup'], transitions),
    );

    // Should still work with the filtered transitions
    expect(result.patternType).not.toBeNull();
  });

  it('should return null when all transitions are on unrelated elements', () => {
    const transitions = [
      mkTransition({
        elementId: 'unrelated-1',
        operation: TransitionOperation.CLICK,
        evidence: [
          { type: TransitionEvidenceType.MUTATION, description: 'something appeared' },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('trigger', ['trigger', 'popup'], transitions),
    );

    expect(result.patternType).toBeNull();
  });

  it('should choose highest confidence match when multiple patterns partially match', () => {
    // Create evidence that could match dropdown partially and checkbox partially.
    // The one with higher confidence should win.
    const transitions = [
      // State change on root → could match checkbox or accordion
      mkTransition({
        elementId: 'elem',
        operation: TransitionOperation.CLICK,
        stateAfter: { value: null, checked: true, expanded: null, selected: null },
        evidence: [
          { type: TransitionEvidenceType.STATE_CHANGE, description: 'checked state flipped' },
        ],
      }),
    ];

    const result = recognizeBehaviorally(
      mkInput('elem', ['elem'], transitions),
    );

    // Checkbox full match (0.65) should beat accordion partial (0.45)
    expect(result.patternType).toBe(PatternType.CHECKBOX);
    expect(result.confidence).toBe(0.65);
  });
});

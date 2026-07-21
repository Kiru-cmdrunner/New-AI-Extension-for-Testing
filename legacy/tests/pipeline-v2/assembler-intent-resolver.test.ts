/**
 * Unit tests for the Interaction Assembler and Intent Resolver.
 *
 * Tests cover:
 *   - Assembler: pattern-based assembly for each behavior
 *   - Assembler: generic-fallback assembly from state diff alone
 *   - Assembler: state diff as ground truth (diff wins over pattern metadata)
 *   - Intent Resolver: behavior → SessionEvent type mapping
 *   - Intent Resolver: confidence computation
 *   - Intent Resolver: field extraction
 *   - Intent Resolver: always produces a valid action (graceful degradation)
 *   - End-to-end: unit → diff → pattern → assembled → resolved → SessionEvent fields
 */

import { describe, it, expect } from 'vitest';
import {
  assembleInteraction,
  type AssembledAction,
} from '../../src/recorder/pipeline-v2/interaction-assembler';
import {
  resolveIntent,
} from '../../src/recorder/pipeline-v2/intent-resolver';
import type {
  InteractionUnit,
  StateDiff,
  PipelineEvent,
  PatternMatch,
  ElementIdentity,
  ElementDescriptor,
} from '../../src/recorder/pipeline-v2/canonical-event-schema';
import { hasMeaningfulChanges } from '../../src/recorder/pipeline-v2/state-diff-engine';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn',
    name: null,
    stableId: 'test',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#test',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeDescriptor(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    accessibleName: 'Test',
    ariaRole: null,
    tag: 'INPUT',
    id: 'test',
    cssSelector: '#test',
    ...overrides,
  };
}

function makeEvent(
  type: PipelineEvent['type'],
  overrides: Partial<PipelineEvent> = {},
): PipelineEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type,
    timestamp: '2026-07-18T00:00:00.000Z',
    element: null,
    targetTag: null,
    payload: {},
    isTrusted: true,
    ...overrides,
  };
}

function makeUnit(
  events: PipelineEvent[],
  element: ElementIdentity | null = null,
): InteractionUnit {
  const primary = events[0] || makeEvent('click');
  return {
    unitId: 'unit-0001',
    events,
    primaryEvent: { ...primary, element },
    startTime: events[0]?.timestamp || '2026-07-18T00:00:00.000Z',
    endTime: events[events.length - 1]?.timestamp || '2026-07-18T00:00:00.000Z',
    boundaryReason: 'temporal_gap',
  };
}

const emptyDiff: StateDiff = {
  valueChanges: [],
  toggleChanges: [],
  radioChanges: [],
  rangeChanges: [],
  focusChange: null,
  surfaceChanges: [],
  tabChange: null,
  urlChange: null,
  structuralChangeDetected: false,
};

// ════════════════════════════════════════════════════════════════════════
// INTERACTION ASSEMBLER TESTS
// ════════════════════════════════════════════════════════════════════════

describe('Interaction Assembler', () => {
  // ── Pattern-Based Assembly ─────────────────────────────────────────

  describe('pattern-based assembly', () => {
    it('should assemble a single-selection-from-set with state diff as ground truth', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Travel Class' }));
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Travel Class' }),
          field: 'Travel Class',
          before: 'Economy',
          after: 'Premium Economy',
          inputType: 'text',
        }],
      };
      const match: PatternMatch = {
        behavior: 'single-selection-from-set',
        confidence: 0.95,
        rationale: 'test',
        metadata: { selectedValue: 'WRONG', previousValue: 'WRONG' },
      };

      const result = assembleInteraction(unit, diff, match);

      // State diff wins over pattern metadata
      expect(result.fields.selectedValue).toBe('Premium Economy');
      expect(result.fields.previousValue).toBe('Economy');
      expect(result.description).toContain('Premium Economy');
      expect(result.resolutionSource).toBe('pattern');
    });

    it('should assemble a boolean-toggle', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Subscribe' }));
      const diff: StateDiff = {
        ...emptyDiff,
        toggleChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Subscribe' }),
          field: 'Subscribe',
          before: false,
          after: true,
        }],
      };
      const match: PatternMatch = {
        behavior: 'boolean-toggle',
        confidence: 0.95,
        rationale: 'test',
        metadata: {},
      };

      const result = assembleInteraction(unit, diff, match);

      expect(result.fields.toggleState).toBe(true);
      expect(result.description).toBe('Check "Subscribe"');
    });

    it('should assemble a text-entry-commit', () => {
      const unit = makeUnit([
        makeEvent('focus'),
        makeEvent('input'),
        makeEvent('blur'),
      ], makeElementIdentity({ accessibleName: 'Email', tag: 'INPUT' }));
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Email' }),
          field: 'Email',
          before: '',
          after: 'test@example.com',
          inputType: 'email',
        }],
      };
      const match: PatternMatch = {
        behavior: 'text-entry-commit',
        confidence: 0.92,
        rationale: 'test',
        metadata: {},
      };

      const result = assembleInteraction(unit, diff, match);

      expect(result.fields.textValue).toBe('test@example.com');
      expect(result.description).toBe('Enter "test@example.com" into "Email"');
    });

    it('should assemble a date-time-selection', () => {
      const unit = makeUnit([makeEvent('change')], makeElementIdentity({ accessibleName: 'Departure Date', tag: 'INPUT' }));
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Departure Date' }),
          field: 'Departure Date',
          before: '',
          after: '2026-07-18',
          inputType: 'date',
        }],
      };
      const match: PatternMatch = {
        behavior: 'date-time-selection',
        confidence: 0.95,
        rationale: 'test',
        metadata: { dateValue: '2026-07-18', dateIsoValue: '2026-07-18' },
      };

      const result = assembleInteraction(unit, diff, match);

      expect(result.fields.dateValue).toBe('2026-07-18');
      expect(result.description).toContain('2026-07-18');
    });

    it('should assemble a navigation', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Next Page', tag: 'A' }));
      const diff: StateDiff = {
        ...emptyDiff,
        urlChange: { from: 'https://a.com', to: 'https://b.com' },
      };
      const match: PatternMatch = {
        behavior: 'navigation',
        confidence: 1.0,
        rationale: 'test',
        metadata: {},
      };

      const result = assembleInteraction(unit, diff, match);

      expect(result.fields.url).toBe('https://b.com');
    });

    it('should assemble a simple-click', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Submit' }));
      const match: PatternMatch = {
        behavior: 'simple-click',
        confidence: 0.85,
        rationale: 'test',
        metadata: {},
      };

      const result = assembleInteraction(unit, diff_empty(), match);

      expect(result.description).toBe('Click "Submit"');
      expect(result.behavior).toBe('simple-click');
    });

    it('should assemble a context-switch (tab change)', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Settings Tab' }));
      const diff: StateDiff = {
        ...emptyDiff,
        tabChange: {
          from: makeDescriptor({ accessibleName: 'Overview' }),
          to: makeDescriptor({ accessibleName: 'Settings' }),
        },
      };
      const match: PatternMatch = {
        behavior: 'context-switch',
        confidence: 0.90,
        rationale: 'test',
        metadata: {},
      };

      const result = assembleInteraction(unit, diff, match);

      expect(result.description).toContain('Overview');
      expect(result.description).toContain('Settings');
    });
  });

  // ── Generic Fallback Assembly ──────────────────────────────────────

  describe('generic-fallback assembly (no pattern match)', () => {
    it('should assemble from value change when no pattern matches', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Custom Widget' }));
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Custom Widget' }),
          field: 'Custom Widget',
          before: 'A',
          after: 'B',
          inputType: 'text',
        }],
      };

      const result = assembleInteraction(unit, diff, null);

      expect(result.behavior).toBe('generic-fallback');
      expect(result.resolutionSource).toBe('state-diff');
      expect(result.fields.selectedValue).toBe('B');
      expect(result.description).toContain('Custom Widget');
    });

    it('should assemble from toggle change when no pattern matches', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity());
      const diff: StateDiff = {
        ...emptyDiff,
        toggleChanges: [{
          descriptor: makeDescriptor({ accessibleName: 'Custom Toggle' }),
          field: 'Custom Toggle',
          before: false,
          after: true,
        }],
      };

      const result = assembleInteraction(unit, diff, null);

      expect(result.behavior).toBe('generic-fallback');
      expect(result.fields.toggleState).toBe(true);
    });

    it('should assemble a click when no meaningful changes exist', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity({ accessibleName: 'Action Button' }));
      const result = assembleInteraction(unit, emptyDiff, null);

      expect(result.behavior).toBe('generic-fallback');
      expect(result.description).toContain('Action Button');
    });

    it('should assemble navigation from URL change', () => {
      const unit = makeUnit([makeEvent('click')], makeElementIdentity());
      const diff: StateDiff = {
        ...emptyDiff,
        urlChange: { from: 'https://a.com', to: 'https://b.com' },
      };

      const result = assembleInteraction(unit, diff, null);

      expect(result.fields.url).toBe('https://b.com');
    });
  });
});

function diff_empty(): StateDiff {
  return { ...emptyDiff };
}

// ════════════════════════════════════════════════════════════════════════
// INTENT RESOLVER TESTS
// ════════════════════════════════════════════════════════════════════════

describe('Intent Resolver', () => {
  // ── Behavior → SessionEvent Type Mapping ───────────────────────────

  describe('behavior to session event type mapping', () => {
    it('should map single-selection-from-set to select', () => {
      const assembled: AssembledAction = {
        behavior: 'single-selection-from-set',
        elementIdentity: makeElementIdentity(),
        description: 'Select "Canada"',
        fields: { selectedValue: 'Canada' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('select');
    });

    it('should map single-selection-from-set with radio to radio', () => {
      const assembled: AssembledAction = {
        behavior: 'single-selection-from-set',
        elementIdentity: makeElementIdentity(),
        description: 'Select "Pro"',
        fields: { selectedValue: 'Pro' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };
      const diff: StateDiff = {
        ...emptyDiff,
        radioChanges: [{
          groupName: 'plan',
          groupDescriptor: makeDescriptor(),
          before: null,
          after: makeDescriptor({ accessibleName: 'Pro' }),
        }],
      };

      const resolved = resolveIntent(assembled, diff);
      expect(resolved.sessionEventType).toBe('radio');
    });

    it('should map boolean-toggle to checkbox', () => {
      const assembled: AssembledAction = {
        behavior: 'boolean-toggle',
        elementIdentity: makeElementIdentity(),
        description: 'Check "Subscribe"',
        fields: { toggleState: true },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('checkbox');
      expect(resolved.fields.checked).toBe(true);
    });

    it('should map text-entry-commit to text', () => {
      const assembled: AssembledAction = {
        behavior: 'text-entry-commit',
        elementIdentity: makeElementIdentity(),
        description: 'Enter "hello"',
        fields: { textValue: 'hello' },
        patternConfidence: 0.92,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('text');
      expect(resolved.fields.value).toBe('hello');
    });

    it('should map date-time-selection to dateSelect', () => {
      const assembled: AssembledAction = {
        behavior: 'date-time-selection',
        elementIdentity: makeElementIdentity(),
        description: 'Select date',
        fields: { dateValue: '2026-07-18', dateIsoValue: '2026-07-18' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('dateSelect');
      expect(resolved.fields.displayValue).toBe('2026-07-18');
    });

    it('should map navigation to navigation', () => {
      const assembled: AssembledAction = {
        behavior: 'navigation',
        elementIdentity: makeElementIdentity(),
        description: 'Navigate',
        fields: { url: 'https://example.com' },
        patternConfidence: 1.0,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('navigation');
      expect(resolved.fields.url).toBe('https://example.com');
    });

    it('should map simple-click to click', () => {
      const assembled: AssembledAction = {
        behavior: 'simple-click',
        elementIdentity: makeElementIdentity(),
        description: 'Click "Submit"',
        fields: {},
        patternConfidence: 0.85,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('click');
    });

    it('should map hover-intent to hover', () => {
      const assembled: AssembledAction = {
        behavior: 'hover-intent',
        elementIdentity: makeElementIdentity(),
        description: 'Hover over "Menu"',
        fields: {},
        patternConfidence: 0.75,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.sessionEventType).toBe('hover');
    });
  });

  // ── Confidence Computation ─────────────────────────────────────────

  describe('confidence computation', () => {
    it('should return HIGH confidence when pattern matched and diff confirms', () => {
      const assembled: AssembledAction = {
        behavior: 'single-selection-from-set',
        elementIdentity: makeElementIdentity(),
        description: 'Select',
        fields: { selectedValue: 'Canada' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor(),
          field: 'Country',
          before: '',
          after: 'Canada',
          inputType: 'select-one',
        }],
      };

      const resolved = resolveIntent(assembled, diff);
      expect(resolved.confidence).toBeGreaterThanOrEqual(0.90);
    });

    it('should return LOW confidence for generic-fallback with changes', () => {
      const assembled: AssembledAction = {
        behavior: 'generic-fallback',
        elementIdentity: makeElementIdentity(),
        description: 'Change',
        fields: { selectedValue: 'B' },
        patternConfidence: null,
        resolutionSource: 'state-diff',
      };
      const diff: StateDiff = {
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor(),
          field: 'X',
          before: 'A',
          after: 'B',
          inputType: 'text',
        }],
      };

      const resolved = resolveIntent(assembled, diff);
      expect(resolved.confidence).toBeLessThan(0.5);
    });

    it('should return LOW confidence for generic-fallback with no changes', () => {
      const assembled: AssembledAction = {
        behavior: 'generic-fallback',
        elementIdentity: makeElementIdentity(),
        description: 'Click',
        fields: {},
        patternConfidence: null,
        resolutionSource: 'state-diff',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.confidence).toBeLessThan(0.4);
    });
  });

  // ── Field Extraction ───────────────────────────────────────────────

  describe('field extraction', () => {
    it('should extract value for select events', () => {
      const assembled: AssembledAction = {
        behavior: 'single-selection-from-set',
        elementIdentity: makeElementIdentity(),
        description: 'Select',
        fields: { selectedValue: 'Premium Economy' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.fields.value).toBe('Premium Economy');
    });

    it('should extract checked for checkbox events', () => {
      const assembled: AssembledAction = {
        behavior: 'boolean-toggle',
        elementIdentity: makeElementIdentity(),
        description: 'Check',
        fields: { toggleState: true },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.fields.checked).toBe(true);
    });

    it('should extract date fields for dateSelect events', () => {
      const assembled: AssembledAction = {
        behavior: 'date-time-selection',
        elementIdentity: makeElementIdentity(),
        description: 'Select date',
        fields: { dateValue: '18 July 2026', dateIsoValue: '2026-07-18' },
        patternConfidence: 0.95,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.fields.displayValue).toBe('18 July 2026');
      expect(resolved.fields.isoValue).toBe('2026-07-18');
      expect(resolved.fields.dateType).toBe('date');
    });
  });

  // ── Always Produces a Valid Action ─────────────────────────────────

  describe('graceful degradation', () => {
    it('should always produce a ResolvedAction even for generic-fallback', () => {
      const assembled: AssembledAction = {
        behavior: 'generic-fallback',
        elementIdentity: null,
        description: 'Unknown interaction',
        fields: {},
        patternConfidence: null,
        resolutionSource: 'state-diff',
      };

      const resolved = resolveIntent(assembled, emptyDiff);

      expect(resolved).toBeDefined();
      expect(resolved.sessionEventType).toBe('click'); // safe fallback
      expect(resolved.confidence).toBeLessThan(0.5);
      expect(resolved.description).toBe('Unknown interaction');
    });

    it('should always have a non-empty rationale', () => {
      const assembled: AssembledAction = {
        behavior: 'simple-click',
        elementIdentity: makeElementIdentity(),
        description: 'Click',
        fields: {},
        patternConfidence: 0.85,
        resolutionSource: 'pattern',
      };

      const resolved = resolveIntent(assembled, emptyDiff);
      expect(resolved.rationale.length).toBeGreaterThan(0);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// END-TO-END: Assembler + Intent Resolver
// ════════════════════════════════════════════════════════════════════════

describe('end-to-end: assemble + resolve', () => {
  it('should produce a complete select action for a dropdown interaction', () => {
    const unit = makeUnit(
      [
        makeEvent('click'),
        makeEvent('surface_open', { payload: { surfaceType: 'dropdown' } }),
        makeEvent('click', { targetTag: 'LI' }),
        makeEvent('surface_close', { payload: { surfaceType: 'dropdown' } }),
      ],
      makeElementIdentity({ accessibleName: 'Travel Class', ariaRole: 'combobox', tag: 'DIV' }),
    );
    const diff: StateDiff = {
      ...emptyDiff,
      valueChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Travel Class' }),
        field: 'Travel Class',
        before: 'Economy',
        after: 'Premium Economy',
        inputType: 'text',
      }],
    };
    const match: PatternMatch = {
      behavior: 'single-selection-from-set',
      confidence: 0.95,
      rationale: 'Surface + value change',
      metadata: {},
    };

    const assembled = assembleInteraction(unit, diff, match);
    const resolved = resolveIntent(assembled, diff);

    expect(resolved.sessionEventType).toBe('select');
    expect(resolved.fields.value).toBe('Premium Economy');
    expect(resolved.elementIdentity?.accessibleName).toBe('Travel Class');
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.90);
    expect(resolved.description).toContain('Premium Economy');
    expect(resolved.description).toContain('Travel Class');
  });

  it('should produce a complete checkbox action for a toggle interaction', () => {
    const unit = makeUnit(
      [makeEvent('click')],
      makeElementIdentity({ accessibleName: 'Subscribe', tag: 'INPUT', ariaRole: 'checkbox' }),
    );
    const diff: StateDiff = {
      ...emptyDiff,
      toggleChanges: [{
        descriptor: makeDescriptor({ accessibleName: 'Subscribe' }),
        field: 'Subscribe',
        before: false,
        after: true,
      }],
    };
    const match: PatternMatch = {
      behavior: 'boolean-toggle',
      confidence: 0.95,
      rationale: 'Toggle changed',
      metadata: {},
    };

    const assembled = assembleInteraction(unit, diff, match);
    const resolved = resolveIntent(assembled, diff);

    expect(resolved.sessionEventType).toBe('checkbox');
    expect(resolved.fields.checked).toBe(true);
    expect(resolved.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it('should produce a complete navigation action', () => {
    const unit = makeUnit(
      [makeEvent('navigation', { payload: { url: 'https://example.com/page2' } })],
      null,
    );
    const diff: StateDiff = {
      ...emptyDiff,
      urlChange: { from: 'https://example.com', to: 'https://example.com/page2' },
    };
    const match: PatternMatch = {
      behavior: 'navigation',
      confidence: 1.0,
      rationale: 'URL change',
      metadata: {},
    };

    const assembled = assembleInteraction(unit, diff, match);
    const resolved = resolveIntent(assembled, diff);

    expect(resolved.sessionEventType).toBe('navigation');
    expect(resolved.fields.url).toBe('https://example.com/page2');
    expect(resolved.confidence).toBe(1.0);
  });
});

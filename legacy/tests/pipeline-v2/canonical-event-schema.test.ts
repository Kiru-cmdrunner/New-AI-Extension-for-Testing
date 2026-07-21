/**
 * Unit tests for the Pipeline V2 canonical event schema.
 *
 * These tests verify:
 *   - The event vocabulary is closed and well-formed
 *   - Type guards correctly identify valid/invalid event types
 *   - The PipelineEvent interface is constructible with all required fields
 *   - Every type in the vocabulary is a valid string
 *   - The schema types compile correctly with TypeScript
 */

import { describe, it, expect } from 'vitest';
import {
  RECORDED_EVENT_TYPES,
  isRecordedEventType,
  type PipelineEvent,
  type RecordedEventType,
  type InteractionUnit,
  type StateSnapshot,
  type StateDiff,
  type PatternMatch,
  type ResolvedAction,
  type InteractionBehavior,
  type TraceEntry,
  type BoundaryReason,
  type SurfaceType,
  type EventPayload,
  type ElementDescriptor,
  type EventModifiers,
} from '../../src/recorder/pipeline-v2/canonical-event-schema';
import type { ElementIdentity } from '../../src/shared/types';

// ── Test Helpers ────────────────────────────────────────────────────────

function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn-primary',
    name: null,
    stableId: 'test-btn',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: '#test-btn',
    xPath: '//button[@id=\'test-btn\']',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeElementDescriptor(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    accessibleName: 'Test Element',
    ariaRole: 'button',
    tag: 'BUTTON',
    id: 'test-el',
    cssSelector: '#test-el',
    ...overrides,
  };
}

// ── Event Vocabulary Tests ──────────────────────────────────────────────

describe('RECORDED_EVENT_TYPES', () => {
  it('should be a non-empty readonly array', () => {
    expect(RECORDED_EVENT_TYPES).toBeInstanceOf(Array);
    expect(RECORDED_EVENT_TYPES.length).toBeGreaterThan(0);
  });

  it('should contain only unique strings', () => {
    const unique = new Set(RECORDED_EVENT_TYPES);
    expect(unique.size).toBe(RECORDED_EVENT_TYPES.length);
  });

  it('should contain all expected core event types', () => {
    const expected = ['click', 'change', 'input', 'focus', 'blur', 'keydown',
                      'mouseenter', 'mouseleave', 'navigation'];
    for (const type of expected) {
      expect(RECORDED_EVENT_TYPES).toContain(type);
    }
  });

  it('should contain surface lifecycle events (Learning 4: real producers)', () => {
    expect(RECORDED_EVENT_TYPES).toContain('surface_open');
    expect(RECORDED_EVENT_TYPES).toContain('surface_close');
  });

  it('should contain submit event', () => {
    expect(RECORDED_EVENT_TYPES).toContain('submit');
  });
});

// ── Type Guard Tests ────────────────────────────────────────────────────

describe('isRecordedEventType', () => {
  it('should return true for all types in the vocabulary', () => {
    for (const type of RECORDED_EVENT_TYPES) {
      expect(isRecordedEventType(type)).toBe(true);
    }
  });

  it('should return false for unknown type strings', () => {
    expect(isRecordedEventType('')).toBe(false);
    expect(isRecordedEventType('unknown')).toBe(false);
    expect(isRecordedEventType('CLICK')).toBe(false); // case-sensitive
    expect(isRecordedEventType('click ')).toBe(false); // whitespace
  });

  it('should return false for non-string values', () => {
    expect(isRecordedEventType(null as unknown as string)).toBe(false);
    expect(isRecordedEventType(undefined as unknown as string)).toBe(false);
    expect(isRecordedEventType(123 as unknown as string)).toBe(false);
  });
});

// ── PipelineEvent Construction Tests ───────────────────────────────────

describe('PipelineEvent', () => {
  it('should construct a click event with all required fields', () => {
    const event: PipelineEvent = {
      eventId: 'evt-001',
      type: 'click',
      timestamp: '2026-07-18T00:00:00.000Z',
      element: makeElementIdentity(),
      targetTag: 'BUTTON',
      payload: {
        clickCount: 1,
        button: 0,
        modifiers: { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      },
      isTrusted: true,
    };

    expect(event.type).toBe('click');
    expect(event.eventId).toBe('evt-001');
    expect(event.element).not.toBeNull();
    expect(event.element?.accessibleName).toBe('Test Button');
    expect(event.payload.clickCount).toBe(1);
    expect(event.isTrusted).toBe(true);
  });

  it('should construct a change event with value payload', () => {
    const event: PipelineEvent = {
      eventId: 'evt-002',
      type: 'change',
      timestamp: '2026-07-18T00:00:01.000Z',
      element: makeElementIdentity({ accessibleName: 'Country', ariaRole: 'combobox' }),
      targetTag: 'SELECT',
      payload: {
        value: 'Canada',
        previousValue: '',
      },
      isTrusted: true,
    };

    expect(event.type).toBe('change');
    expect(event.payload.value).toBe('Canada');
    expect(event.payload.previousValue).toBe('');
  });

  it('should construct a navigation event with null element', () => {
    const event: PipelineEvent = {
      eventId: 'evt-003',
      type: 'navigation',
      timestamp: '2026-07-18T00:00:02.000Z',
      element: null,
      targetTag: null,
      payload: {
        url: 'https://example.com/page2',
        title: 'Page 2',
      },
      isTrusted: true,
    };

    expect(event.type).toBe('navigation');
    expect(event.element).toBeNull();
    expect(event.payload.url).toBe('https://example.com/page2');
  });

  it('should construct a surface_open event (Learning 4: real producers)', () => {
    const surfaceEl = makeElementDescriptor({ accessibleName: 'Country Dropdown', ariaRole: 'listbox' });
    const event: PipelineEvent = {
      eventId: 'evt-004',
      type: 'surface_open',
      timestamp: '2026-07-18T00:00:03.000Z',
      element: makeElementIdentity({ accessibleName: 'Country', ariaRole: 'combobox' }),
      targetTag: 'DIV',
      payload: {
        surfaceType: 'dropdown',
        surfaceElement: surfaceEl,
      },
      isTrusted: true,
    };

    expect(event.type).toBe('surface_open');
    expect(event.payload.surfaceType).toBe('dropdown');
    expect(event.payload.surfaceElement?.accessibleName).toBe('Country Dropdown');
  });

  it('should construct a keydown event', () => {
    const event: PipelineEvent = {
      eventId: 'evt-005',
      type: 'keydown',
      timestamp: '2026-07-18T00:00:04.000Z',
      element: makeElementIdentity({ accessibleName: 'Search', ariaRole: 'searchbox' }),
      targetTag: 'INPUT',
      payload: {
        key: 'Enter',
        code: 'Enter',
        modifiers: { ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      },
      isTrusted: true,
    };

    expect(event.type).toBe('keydown');
    expect(event.payload.key).toBe('Enter');
  });
});

// ── InteractionUnit Construction Tests ──────────────────────────────────

describe('InteractionUnit', () => {
  it('should construct with events array and boundary reason', () => {
    const clickEvent: PipelineEvent = {
      eventId: 'evt-010',
      type: 'click',
      timestamp: '2026-07-18T00:00:00.000Z',
      element: makeElementIdentity(),
      targetTag: 'BUTTON',
      payload: { clickCount: 1, button: 0 },
      isTrusted: true,
    };

    const unit: InteractionUnit = {
      unitId: 'unit-001',
      events: [clickEvent],
      primaryEvent: clickEvent,
      startTime: '2026-07-18T00:00:00.000Z',
      endTime: '2026-07-18T00:00:00.000Z',
      boundaryReason: 'temporal_gap',
    };

    expect(unit.unitId).toBe('unit-001');
    expect(unit.events).toHaveLength(1);
    expect(unit.boundaryReason).toBe('temporal_gap');
    expect(unit.primaryEvent.eventId).toBe('evt-010');
  });

  it('should support all boundary reasons', () => {
    const reasons: BoundaryReason[] = [
      'surface_closed',
      'temporal_gap',
      'focus_lost',
      'navigation',
      'explicit_flush',
    ];

    for (const reason of reasons) {
      const unit: InteractionUnit = {
        unitId: `unit-${reason}`,
        events: [],
        primaryEvent: {
          eventId: 'e',
          type: 'click',
          timestamp: '',
          element: null,
          targetTag: null,
          payload: {},
          isTrusted: true,
        },
        startTime: '',
        endTime: '',
        boundaryReason: reason,
      };
      expect(unit.boundaryReason).toBe(reason);
    }
  });
});

// ── StateSnapshot + StateDiff Construction Tests ────────────────────────

describe('StateSnapshot', () => {
  it('should construct with all state model fields', () => {
    const snapshot: StateSnapshot = {
      timestamp: '2026-07-18T00:00:00.000Z',
      url: 'https://example.com',
      pageTitle: 'Example',
      inputs: [{
        descriptor: makeElementDescriptor({ accessibleName: 'Email' }),
        value: 'test@example.com',
        inputType: 'email',
      }],
      checkboxes: [{
        descriptor: makeElementDescriptor({ accessibleName: 'Subscribe' }),
        checked: true,
      }],
      radios: [{
        name: 'plan',
        descriptor: makeElementDescriptor({ accessibleName: 'Plan' }),
        selectedOption: makeElementDescriptor({ accessibleName: 'Pro' }),
        options: [
          makeElementDescriptor({ accessibleName: 'Basic' }),
          makeElementDescriptor({ accessibleName: 'Pro' }),
        ],
      }],
      toggles: [],
      ranges: [{
        descriptor: makeElementDescriptor({ accessibleName: 'Volume' }),
        value: '75',
        min: '0',
        max: '100',
      }],
      focusedElement: makeElementDescriptor({ accessibleName: 'Email' }),
      openSurfaces: [],
      activeTab: null,
      expandedAccordions: [],
      interactiveElementCount: 15,
    };

    expect(snapshot.inputs).toHaveLength(1);
    expect(snapshot.inputs[0].value).toBe('test@example.com');
    expect(snapshot.checkboxes[0].checked).toBe(true);
    expect(snapshot.radios[0].selectedOption?.accessibleName).toBe('Pro');
    expect(snapshot.ranges[0].value).toBe('75');
    expect(snapshot.interactiveElementCount).toBe(15);
  });
});

describe('StateDiff', () => {
  it('should construct with value changes', () => {
    const diff: StateDiff = {
      valueChanges: [{
        descriptor: makeElementDescriptor({ accessibleName: 'Country' }),
        field: 'Country',
        before: '',
        after: 'Canada',
        inputType: 'select-one',
      }],
      toggleChanges: [],
      radioChanges: [],
      rangeChanges: [],
      focusChange: null,
      surfaceChanges: [],
      tabChange: null,
      urlChange: null,
      structuralChangeDetected: true,
    };

    expect(diff.valueChanges).toHaveLength(1);
    expect(diff.valueChanges[0].after).toBe('Canada');
    expect(diff.structuralChangeDetected).toBe(true);
  });

  it('should construct with toggle changes', () => {
    const diff: StateDiff = {
      valueChanges: [],
      toggleChanges: [{
        descriptor: makeElementDescriptor({ accessibleName: 'Subscribe' }),
        field: 'Subscribe',
        before: false,
        after: true,
      }],
      radioChanges: [],
      rangeChanges: [],
      focusChange: null,
      surfaceChanges: [],
      tabChange: null,
      urlChange: null,
      structuralChangeDetected: false,
    };

    expect(diff.toggleChanges[0].after).toBe(true);
  });

  it('should construct with surface changes', () => {
    const diff: StateDiff = {
      valueChanges: [],
      toggleChanges: [],
      radioChanges: [],
      rangeChanges: [],
      focusChange: null,
      surfaceChanges: [{
        type: 'dropdown',
        action: 'opened',
        descriptor: makeElementDescriptor({ accessibleName: 'Country List' }),
      }],
      tabChange: null,
      urlChange: null,
      structuralChangeDetected: true,
    };

    expect(diff.surfaceChanges[0].action).toBe('opened');
    expect(diff.surfaceChanges[0].type).toBe('dropdown');
  });

  it('should construct an empty diff (no changes)', () => {
    const diff: StateDiff = {
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

    expect(diff.valueChanges).toHaveLength(0);
    expect(diff.structuralChangeDetected).toBe(false);
  });
});

// ── PatternMatch Tests ──────────────────────────────────────────────────

describe('PatternMatch', () => {
  it('should construct a single-selection-from-set match', () => {
    const match: PatternMatch = {
      behavior: 'single-selection-from-set',
      confidence: 0.95,
      rationale: 'Surface opened and closed with one value change',
      metadata: {
        selectedValue: 'Premium Economy',
        previousValue: 'Economy',
      },
    };

    expect(match.behavior).toBe('single-selection-from-set');
    expect(match.confidence).toBe(0.95);
    expect(match.metadata.selectedValue).toBe('Premium Economy');
  });

  it('should construct a generic-fallback match', () => {
    const match: PatternMatch = {
      behavior: 'generic-fallback',
      confidence: 0.4,
      rationale: 'No pattern matched; resolved from state diff',
      metadata: {},
    };

    expect(match.behavior).toBe('generic-fallback');
    expect(match.confidence).toBeLessThan(0.5);
  });
});

// ── ResolvedAction Tests ────────────────────────────────────────────────

describe('ResolvedAction', () => {
  it('should construct a select action', () => {
    const action: ResolvedAction = {
      behavior: 'single-selection-from-set',
      sessionEventType: 'select',
      confidence: 0.95,
      elementIdentity: makeElementIdentity({ accessibleName: 'Travel Class' }),
      fields: { value: 'Premium Economy' },
      description: 'Select "Premium Economy" from "Travel Class"',
      rationale: 'State diff: value changed Economy → Premium Economy',
    };

    expect(action.sessionEventType).toBe('select');
    expect(action.fields.value).toBe('Premium Economy');
    expect(action.confidence).toBeGreaterThan(0.9);
  });

  it('should construct a navigation action', () => {
    const action: ResolvedAction = {
      behavior: 'navigation',
      sessionEventType: 'navigation',
      confidence: 1.0,
      elementIdentity: null,
      fields: { url: 'https://example.com/page2', title: 'Page 2' },
      description: 'Navigate to "Page 2"',
      rationale: 'URL changed',
    };

    expect(action.sessionEventType).toBe('navigation');
    expect(action.elementIdentity).toBeNull();
    expect(action.fields.url).toBe('https://example.com/page2');
  });

  it('should construct a generic-fallback action (graceful degradation)', () => {
    const action: ResolvedAction = {
      behavior: 'generic-fallback',
      sessionEventType: 'click',
      confidence: 0.3,
      elementIdentity: makeElementIdentity(),
      fields: {},
      description: 'Click "Test Button"',
      rationale: 'No pattern matched and no meaningful state change; emitted as click',
    };

    expect(action.behavior).toBe('generic-fallback');
    expect(action.confidence).toBeLessThan(0.5);
    expect(action.sessionEventType).toBe('click');
  });
});

// ── TraceEntry Tests ────────────────────────────────────────────────────

describe('TraceEntry', () => {
  it('should construct a trace entry for boundary detection', () => {
    const entry: TraceEntry = {
      timestamp: '2026-07-18T00:00:00.500Z',
      layer: 'boundary-detection',
      eventId: 'evt-001',
      unitId: 'unit-001',
      action: 'close-unit',
      input: 'click event on BUTTON',
      output: 'InteractionUnit with 3 events',
      durationMs: 2,
      decision: 'surface_closed',
    };

    expect(entry.layer).toBe('boundary-detection');
    expect(entry.decision).toBe('surface_closed');
    expect(entry.durationMs).toBe(2);
  });

  it('should support all trace layers', () => {
    const layers: TraceEntry['layer'][] = [
      'event-capture',
      'boundary-detection',
      'state-diff',
      'pattern-registry',
      'interaction-assembler',
      'intent-resolver',
      'pipeline-output',
    ];

    expect(layers).toHaveLength(7);
  });
});

// ── InteractionBehavior Completeness ───────────────────────────────────

describe('InteractionBehavior', () => {
  it('should include all generic interaction behaviors', () => {
    const behaviors: InteractionBehavior[] = [
      'single-selection-from-set',
      'multi-selection-from-set',
      'boolean-toggle',
      'text-entry-commit',
      'date-time-selection',
      'expand-collapse',
      'context-switch',
      'navigation',
      'hover-intent',
      'simple-click',
      'form-submit',
      'generic-fallback',
    ];

    // 12 generic behaviors — should NOT include framework-specific patterns
    expect(behaviors).toHaveLength(12);
    expect(behaviors).not.toContain('material-select');
    expect(behaviors).not.toContain('ant-datepicker');
    expect(behaviors).toContain('generic-fallback');
  });
});

// ── SurfaceType Tests ───────────────────────────────────────────────────

describe('SurfaceType', () => {
  it('should include all surface types', () => {
    const types: SurfaceType[] = ['modal', 'dropdown', 'menu', 'popover', 'dialog'];
    expect(types).toHaveLength(5);
  });
});

// ── Exhaustive Switch Verification ─────────────────────────────────────

describe('Exhaustive switch over RecordedEventType', () => {
  /**
   * This test verifies that every type in the vocabulary can be handled
   * by an exhaustive switch. If a new type is added to RECORDED_EVENT_TYPES
   * without updating consumers, the TypeScript compiler will fail.
   *
   * The `never` default case enforces exhaustiveness at compile time.
   */
  it('should handle every event type without falling through to never', () => {
    function handle(type: RecordedEventType): string {
      switch (type) {
        case 'click': return 'handled:click';
        case 'dblclick': return 'handled:dblclick';
        case 'change': return 'handled:change';
        case 'input': return 'handled:input';
        case 'focus': return 'handled:focus';
        case 'blur': return 'handled:blur';
        case 'keydown': return 'handled:keydown';
        case 'mouseenter': return 'handled:mouseenter';
        case 'mouseleave': return 'handled:mouseleave';
        case 'submit': return 'handled:submit';
        case 'navigation': return 'handled:navigation';
        case 'surface_open': return 'handled:surface_open';
        case 'surface_close': return 'handled:surface_close';
        case 'scroll': return 'handled:scroll';
        default: {
          // Exhaustiveness check — if a new type is added without a case,
          // TypeScript flags this line as an error
          const _exhaustive: never = type;
          return `unhandled:${_exhaustive}`;
        }
      }
    }

    for (const type of RECORDED_EVENT_TYPES) {
      expect(handle(type)).toMatch(/^handled:/);
    }
  });
});

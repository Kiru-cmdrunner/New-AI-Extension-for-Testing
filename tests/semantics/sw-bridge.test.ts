/**
 * Tests: SW Bridge — interpretBehavioralObservations()
 *
 * Verifies that the bridge correctly:
 * - Translates ComponentInteraction into InterpretationContext
 * - Calls interpret() on each observation
 * - Attaches semanticEffects to the result
 * - Is idempotent (doesn't reinterpret)
 * - Handles missing/null observations gracefully
 * - Swallows interpretation failures (evidence durability > interpretation)
 *
 * Architecture: .drytis/specs/semantic-effect-interpretation.md §Sub-phase 2
 */

import { describe, it, expect } from 'vitest';
import { interpretBehavioralObservations } from '../../src/semantics/sw-bridge';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ObservationResult } from '../../src/shared/observation-types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<ObservationResult> = {}): ObservationResult {
  return {
    sourceEventId: 'evt-001',
    sourceEventType: 'click',
    windowId: 'obs-evt-001',
    openedAt: 1000,
    closedAt: 4000,
    durationMs: 3000,
    endReason: 'completed',
    beforeSnapshot: null,
    finalSnapshot: null,
    mutations: [],
    mutationCount: 0,
    documentWideMutationTotal: 0,
    performanceCondition: null,
    ...overrides,
  };
}

function makeInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-001',
    type: 'Click',
    trigger: {
      accessibleName: 'Test Checkbox',
      ariaRole: 'checkbox',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'INPUT',
      className: 'checkbox',
      name: null,
      stableId: 'cb1',
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'body > div.checkbox',
      xPath: '//div',
      inIframe: false,
      inShadowDom: false,
      elementId: 'elem-0001',
    },
    triggerEvent: {
      eventId: 'evt-001',
      eventType: 'click',
      timestamp: Date.now(),
      isTrusted: true,
      target: {
        tag: 'INPUT',
        cssSelector: 'body > div.checkbox',
        xPath: '//div',
        accessibleName: 'Test Checkbox',
      },
      domContext: { ancestorRoles: ['body'] },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 0,
      clientY: 0,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com',
      pageTitle: 'Test',
    },
    memberEvents: [],
    startTime: 0,
    endTime: 0,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('interpretBehavioralObservations', () => {
  it('interprets state-toggle when ariaChecked delta present', () => {
    const result = makeResult({
      beforeSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: 'false', ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
      finalSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: 'true', ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
    });
    const interaction = makeInteraction({ behavioralObservations: [result] });

    interpretBehavioralObservations(interaction);

    expect(result.semanticEffects).toBeDefined();
    expect(result.semanticEffects!.length).toBeGreaterThanOrEqual(1);
    const toggle = result.semanticEffects!.find(e => e.category === 'state-toggle');
    expect(toggle).toBeDefined();
    expect(toggle!.confidence).toBe('high');
    expect(toggle!.confidenceBasis).toBe('direct-property');
  });

  it('interprets no-observable-effect for completed window with no mutations', () => {
    const result = makeResult({
      beforeSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: null, ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
      finalSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: null, ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
    });
    const interaction = makeInteraction({ behavioralObservations: [result] });

    interpretBehavioralObservations(interaction);

    expect(result.semanticEffects).toBeDefined();
    expect(result.semanticEffects!.length).toBe(1);
    expect(result.semanticEffects![0].category).toBe('no-observable-effect');
    expect(result.semanticEffects![0].confidence).toBe('high');
  });

  it('is idempotent — does not re-interpret if semanticEffects already set', () => {
    const result = makeResult({
      semanticEffects: [{
        category: 'no-observable-effect',
        description: 'preset',
        affectedTarget: { role: null, label: null, cssPath: 'body' },
        confidence: 'high',
        confidenceBasis: 'direct-property',
        evidenceRef: { windowId: 'obs-evt-001', sourceEventId: 'evt-001' },
      }],
    });
    const interaction = makeInteraction({ behavioralObservations: [result] });

    interpretBehavioralObservations(interaction);

    // Should NOT have been reinterpreted
    expect(result.semanticEffects!.length).toBe(1);
    expect(result.semanticEffects![0].description).toBe('preset');
  });

  it('handles null behavioralObservations gracefully', () => {
    const interaction = makeInteraction({ behavioralObservations: undefined });

    // Should not throw
    expect(() => interpretBehavioralObservations(interaction)).not.toThrow();
  });

  it('handles empty behavioralObservations array', () => {
    const interaction = makeInteraction({ behavioralObservations: [] });

    expect(() => interpretBehavioralObservations(interaction)).not.toThrow();
  });

  it('interprets multiple observations on same interaction', () => {
    const result1 = makeResult({
      sourceEventId: 'evt-001',
      windowId: 'obs-evt-001',
    });
    const result2 = makeResult({
      sourceEventId: 'evt-002',
      windowId: 'obs-evt-002',
    });
    const interaction = makeInteraction({ behavioralObservations: [result1, result2] });

    interpretBehavioralObservations(interaction);

    expect(result1.semanticEffects).toBeDefined();
    expect(result2.semanticEffects).toBeDefined();
  });

  it('builds context from interaction type and trigger identity', () => {
    // Test that the bridge correctly maps interaction fields to context.
    // Use a checkbox interaction to verify state-toggle fires.
    const result = makeResult({
      beforeSnapshot: {
        value: null, checked: false, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: null, ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
      finalSnapshot: {
        value: null, checked: true, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: null, ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
    });
    const interaction = makeInteraction({
      type: 'Checkbox',
      trigger: {
        ...makeInteraction().trigger,
        ariaRole: 'checkbox',
        accessibleName: 'Accept Terms',
        cssSelector: 'form > label > input[type=checkbox]',
      },
      behavioralObservations: [result],
    });

    interpretBehavioralObservations(interaction);

    expect(result.semanticEffects).toBeDefined();
    const toggle = result.semanticEffects!.find(e => e.category === 'state-toggle');
    expect(toggle).toBeDefined();
    expect(toggle!.affectedTarget.role).toBe('checkbox');
    expect(toggle!.affectedTarget.label).toBe('Accept Terms');
    expect(toggle!.affectedTarget.cssPath).toBe('form > label > input[type=checkbox]');
  });

  it('handles beforeSnapshot=null with aria mutation', () => {
    const result = makeResult({
      beforeSnapshot: null,
      finalSnapshot: null,
      mutations: [{
        id: 0,
        type: 'attributes',
        targetPath: 'body > div.row',
        targetTag: 'DIV',
        attributeName: 'aria-checked',
        oldValue: 'false',
        newValue: 'true',
        addedNodesCount: 0,
        removedNodesCount: 0,
        timestamp: 2000,
        windowIds: ['obs-evt-001'],
      }],
    });
    const interaction = makeInteraction({ behavioralObservations: [result] });

    interpretBehavioralObservations(interaction);

    expect(result.semanticEffects).toBeDefined();
    const toggle = result.semanticEffects!.find(e => e.category === 'state-toggle');
    expect(toggle).toBeDefined();
    expect(toggle!.confidence).toBe('high');
  });

  it('multiple effects per observation (toggle + content-change)', () => {
    const result = makeResult({
      beforeSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: 'false', ariaPressed: null,
        textContent: null, childCount: 0, capturedAt: Date.now(),
      },
      finalSnapshot: {
        value: null, checked: null, className: '', disabled: false,
        ariaExpanded: null, ariaChecked: 'true', ariaPressed: null,
        textContent: null, childCount: 2, capturedAt: Date.now(),
      },
    });
    const interaction = makeInteraction({ behavioralObservations: [result] });

    interpretBehavioralObservations(interaction);

    expect(result.semanticEffects).toBeDefined();
    const toggle = result.semanticEffects!.find(e => e.category === 'state-toggle');
    const content = result.semanticEffects!.find(e => e.category === 'content-change');
    expect(toggle).toBeDefined();
    expect(content).toBeDefined();
    // Toggle stays HIGH even alongside structural change
    expect(toggle!.confidence).toBe('high');
  });
});

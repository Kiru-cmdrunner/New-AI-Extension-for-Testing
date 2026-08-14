/**
 * D7 — Attribute-Based Counter Detection Tests
 *
 * Verifies that counter detection works via attribute mutations
 * (aria-valuenow, data-count, data-badge, data-quantity, etc.),
 * not just characterData deltas.
 *
 * Architecture: .drytis/specs/deterministic-defects.md §D7
 */

import { describe, it, expect } from 'vitest';
import { CounterSignalExtractor, parseCounterValue } from '../../src/understanding/signal-extractors/counter-signals';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

function makeInteractionWithAttrDelta(
  attrName: string,
  oldVal: string,
  newVal: string,
  targetPath = '/html/body/div/span',
): ComponentInteraction {
  const id = `int-${Math.random()}`;
  const now = Date.now();
  const evidence = {
    sourceEventId: `evt-${id}`,
    sourceEventType: 'click',
    windowId: `bev-${id}`,
    frameId: 'main',
    window: { openedAt: now, closedAt: now + 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
    targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, changed: false, changeSummary: [] },
    applicationEvidence: {
      domChanges: [{
        types: ['attributes' as const],
        targetPath,
        targetTag: 'DIV',
        shadowContext: null,
        changedAttributes: [attrName],
        attributeDeltas: { [attrName]: { old: oldVal, new: newVal } },
        addedNodesCount: 0,
        removedNodesCount: 0,
        characterDataDelta: null,
        firstMutationAt: 0,
        lastMutationAt: 10,
        rawMutationCount: 1,
        globalBatchIndex: 0,
      }],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;

  return {
    interactionId: id,
    type: 'click',
    trigger: {
      elementId: `elem-${id}`,
      accessibleName: 'Button',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      domContext: { eventType: 'click', cssSelector: `#${id}`, xPath: '/html/body/button', url: 'https://example.com/' },
    },
    memberEvents: [],
    inScopeElements: new Set(),
    componentDefinition: 'Button',
    completionReason: 'event-matched',
    startTime: now,
    endTime: now + 100,
    behavioralEvidence: evidence,
  } as unknown as ComponentInteraction;
}

function makeInteractionWithCharData(
  oldVal: string,
  newVal: string,
): ComponentInteraction {
  const id = `int-${Math.random()}`;
  const now = Date.now();
  const evidence = {
    sourceEventId: `evt-${id}`,
    sourceEventType: 'click',
    windowId: `bev-${id}`,
    frameId: 'main',
    window: { openedAt: now, closedAt: now + 100, durationMs: 100, endReason: 'stabilized', stabilityTrace: [] },
    targetEvidence: { identity: null, identityCapturedAt: 0, before: null, after: null, changed: false, changeSummary: [] },
    applicationEvidence: {
      domChanges: [{
        types: ['characterData' as const],
        targetPath: '/html/body/div/span',
        targetTag: 'SPAN',
        shadowContext: null,
        changedAttributes: [],
        attributeDeltas: {},
        addedNodesCount: 0,
        removedNodesCount: 0,
        characterDataDelta: { old: oldVal, new: newVal },
        firstMutationAt: 0,
        lastMutationAt: 10,
        rawMutationCount: 1,
        globalBatchIndex: 0,
      }],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: [],
      networkActivity: [],
      performanceCondition: null,
    },
  } as unknown as BehavioralEvidence;

  return {
    interactionId: id,
    type: 'click',
    trigger: {
      elementId: `elem-${id}`,
      accessibleName: 'Button',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      domContext: { eventType: 'click', cssSelector: `#${id}`, xPath: '/html/body/button', url: 'https://example.com/' },
    },
    memberEvents: [],
    inScopeElements: new Set(),
    componentDefinition: 'Button',
    completionReason: 'event-matched',
    startTime: now,
    endTime: now + 100,
    behavioralEvidence: evidence,
  } as unknown as ComponentInteraction;
}

describe('D7 — Attribute-Based Counter Detection', () => {
  const extractor = new CounterSignalExtractor();

  it('detects counter change via aria-valuenow attribute', () => {
    const interaction = makeInteractionWithAttrDelta('aria-valuenow', '25', '50');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect(signals[0].type).toBe('counter-change');
    expect((signals[0] as any).oldValue).toBe('25');
    expect((signals[0] as any).newValue).toBe('50');
    expect((signals[0] as any).numericDelta).toBe(25);
  });

  it('detects counter change via data-count attribute', () => {
    const interaction = makeInteractionWithAttrDelta('data-count', '0', '3');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).numericDelta).toBe(3);
  });

  it('detects counter change via data-badge attribute', () => {
    const interaction = makeInteractionWithAttrDelta('data-badge', '5', '2');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).numericDelta).toBe(-3);
  });

  it('detects counter change via data-quantity attribute', () => {
    const interaction = makeInteractionWithAttrDelta('data-quantity', '1', '4');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
  });

  it('detects counter change via data-total attribute', () => {
    const interaction = makeInteractionWithAttrDelta('data-total', '100', '150');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).numericDelta).toBe(50);
  });

  it('detects counter change via aria-valuetext attribute', () => {
    const interaction = makeInteractionWithAttrDelta('aria-valuetext', '3', '7');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
  });

  it('does not detect counter from non-counter attribute', () => {
    const interaction = makeInteractionWithAttrDelta('data-color', 'red', 'blue');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(0);
  });

  it('does not detect counter when attr value is non-numeric', () => {
    const interaction = makeInteractionWithAttrDelta('data-count', 'abc', 'def');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(0);
  });

  it('backward compat: characterData delta still works', () => {
    const interaction = makeInteractionWithCharData('0', '1');
    const signals = extractor.extract(interaction);
    expect(signals.length).toBe(1);
    expect((signals[0] as any).oldValue).toBe('0');
    expect((signals[0] as any).newValue).toBe('1');
  });

  it('parseCounterValue helper handles parenthesized values', () => {
    expect(parseCounterValue('(3)')).toBe(3);
    expect(parseCounterValue('1,234')).toBe(1234);
    expect(parseCounterValue('  5  ')).toBe(5);
    expect(parseCounterValue(null)).toBeNull();
    expect(parseCounterValue('abc')).toBeNull();
  });
});

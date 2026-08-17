/**
 * D1 — workflow-normalizer twin subsumption in REAL conditions:
 * the twin now carries a rich elementKey (ledger identity) and both sides
 * carry capture origins, so subsumption works — but a genuine unclaimed
 * mousedown on a DIFFERENT element (or different tab) survives.
 */
import { describe, it, expect } from 'vitest';
import { normalizeWorkflow } from '../../src/presentation/workflow-normalizer';
import type { ComponentInteraction } from '../../src/shared/component-types';

function identity(name: string, tag: string, cssSelector: string) {
  return {
    accessibleName: name, ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag, className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector, xPath: '',
    inIframe: false, shadowDom: false, href: null, inputType: null, elementId: '',
  };
}

function interaction(id: string, type: string, name: string, tag: string, css: string, t0: number, tabId?: number): ComponentInteraction {
  return {
    interactionId: id,
    type: type as never,
    endState: 'completed',
    startTime: t0,
    endTime: t0,
    trigger: identity(name, tag, css),
    triggerEvent: {
      eventId: `evt-pX-${id}`,
      eventType: type === 'Unclassified' ? 'mousedown' : 'click',
      timestamp: t0,
      captureSeq: t0,
      captureOrigin: tabId !== undefined ? { tabId, frameId: 0 } : undefined,
    } as never,
    memberEvents: [],
    metadata: tabId !== undefined ? { captureOrigin: { tabId, frameId: 0 } } : {},
  } as unknown as ComponentInteraction;
}

describe('D1 normalizeWorkflow subsumption', () => {
  it('mousedown twin on the SAME element+tab within the gesture window is subsumed', () => {
    const twin = interaction('int-90', 'Unclassified', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1000, 7);
    const click = interaction('int-1', 'Click', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1004, 7);
    const out = normalizeWorkflow([click, twin]);
    expect(out.map((i) => i.interactionId)).toEqual(['int-1']);
  });

  it('twin on a DIFFERENT element survives (genuine unclaimed mousedown preserved)', () => {
    const twin = interaction('int-90', 'Unclassified', 'Drag area', 'DIV', '#dragzone', 1000, 7);
    const click = interaction('int-1', 'Click', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1004, 7);
    const out = normalizeWorkflow([click, twin]);
    expect(out.map((i) => i.interactionId).sort()).toEqual(['int-1', 'int-90']);
  });

  it('same element but DIFFERENT tab survives (cross-tab gestures are distinct actions)', () => {
    const twin = interaction('int-90', 'Unclassified', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1000, 8);
    const click = interaction('int-1', 'Click', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1004, 7);
    const out = normalizeWorkflow([click, twin]);
    expect(out.map((i) => i.interactionId).sort()).toEqual(['int-1', 'int-90']);
  });

  it('unknown origin on either side does NOT block subsumption (legacy compatibility)', () => {
    // Twin has full identity but no captureOrigin (legacy SW), recognized
    // click has one. Subsumption must still work — origin comparison is
    // skipped when unknown, exactly as pre-D1 behavior.
    const twinNoOrigin = interaction('int-90', 'Unclassified', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1000);
    const click = interaction('int-1', 'Click', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1004, 7);
    const out = normalizeWorkflow([click, twinNoOrigin]);
    expect(out.map((i) => i.interactionId)).toEqual(['int-1']);
  });

  it('twin outside the gesture window survives (500ms bound respected)', () => {
    const twin = interaction('int-90', 'Unclassified', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1000, 7);
    const click = interaction('int-1', 'Click', 'Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox', 1600, 7);
    const out = normalizeWorkflow([click, twin]);
    expect(out.map((i) => i.interactionId).sort()).toEqual(['int-1', 'int-90']);
  });
});

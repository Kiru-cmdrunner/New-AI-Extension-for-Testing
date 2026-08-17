/**
 * D1 — Projection Engine twins carry full identity + capture origin.
 *
 * createUnclassifiedFromLedger previously built the twin's trigger from
 * diagnostic-only fields (cssSelector '', elementId '') with no
 * captureOrigin — the twin's elementKey never matched the recognized
 * interaction's rich key, defeating workflow subsumption. D1 fills the
 * twin from the ledger entry's captured targetIdentity/captureOrigin.
 */
import { describe, it, expect } from 'vitest';
import { EvidenceLedger, DISCRETE_ACTION_TYPES } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { elementKey } from '../../src/definitions/patterns';
import type { ComponentInteraction, ObservedEvent } from '../../src/shared/component-types';

function identity(name: string, tag: string, cssSelector: string) {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector,
    xPath: '',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
  };
}

function mousedownEvent(id: string, seq: number, opts: { name: string; tag: string; css: string; tabId?: number }): ObservedEvent {
  return {
    eventId: id,
    eventType: 'mousedown',
    timestamp: 1000,
    captureSeq: seq,
    isTrusted: true,
    target: identity(opts.name, opts.tag, opts.css),
    captureOrigin: opts.tabId !== undefined ? { tabId: opts.tabId, frameId: 0 } : undefined,
  } as unknown as ObservedEvent;
}

/** A recognized Click interaction on the same element, same tab. */
function recognizedClick(tabId: number | undefined): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'Click',
    endState: 'completed',
    startTime: 1005,
    endTime: 1005,
    trigger: identity('Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox'),
    triggerEvent: {
      eventId: 'evt-pA-2',
      eventType: 'click',
      timestamp: 1005,
      captureSeq: 2,
      captureOrigin: tabId !== undefined ? { tabId, frameId: 0 } : undefined,
    } as never,
    memberEvents: [],
    metadata: {
      captureOrigin: tabId !== undefined ? { tabId, frameId: 0 } : undefined,
    },
  } as unknown as ComponentInteraction;
}

describe('D1 Projection Engine twin identity', () => {
  it('unclaimed mousedown twin carries the captured cssSelector + captureOrigin', () => {
    const ledger = new EvidenceLedger();
    ledger.append(mousedownEvent('evt-pA-1', 1, { name: 'Search Replica Bazaar', tag: 'INPUT', css: '#twotabsearchtextbox', tabId: 7 }));
    ledger.setDisposition('evt-pA-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(1);
    const twin = result.projectedUnclassified[0];
    expect(twin.trigger.cssSelector).toBe('#twotabsearchtextbox');
    expect(twin.trigger.tag).toBe('INPUT');
    expect(twin.triggerEvent.captureOrigin).toEqual({ tabId: 7, frameId: 0 });
    expect(twin.metadata?.captureOrigin).toEqual({ tabId: 7, frameId: 0 });
  });

  it("twin's elementKey MATCHES the recognized interaction's key (subsumption precondition)", () => {
    const ledger = new EvidenceLedger();
    ledger.append(mousedownEvent('evt-pA-1', 1, { name: 'Search Replica Bazaar', tag: 'INPUT', css: '#twotabsearchtextbox', tabId: 7 }));
    ledger.setDisposition('evt-pA-1', 'unclaimed');

    const recognized = recognizedClick(7);
    const result = projectInteractions(ledger, [recognized]);
    const twin = result.projectedUnclassified[0];

    expect(elementKey(twin.trigger)).toBe(elementKey(recognized.trigger));
  });

  it('legacy entries (null identity) still project with diagnostic-only shape', () => {
    const ledger = new EvidenceLedger();
    ledger.restore([
      {
        eventId: 'evt-pOLD-9', captureSeq: 9, pageId: 'pOLD', eventType: 'mousedown',
        timestamp: 42, disposition: 'unclaimed', targetTag: 'DIV', targetName: 'old-div',
        targetRole: null, targetIdentity: null, captureOrigin: null,
      } as never,
    ]);
    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(1);
    const twin = result.projectedUnclassified[0];
    expect(twin.trigger.tag).toBe('DIV');
    expect(twin.trigger.cssSelector).toBe('');
    expect(twin.triggerEvent.captureOrigin).toBeUndefined();
  });

  it('DISCRETE_ACTION_TYPES still includes mousedown (genuine unclaimed mousedown remains capturable)', () => {
    expect(DISCRETE_ACTION_TYPES.has('mousedown')).toBe(true);
    // And the twin is genuinely produced for it when nothing claims it.
    const ledger = new EvidenceLedger();
    ledger.append(mousedownEvent('evt-pA-5', 5, { name: 'Drag area', tag: 'DIV', css: '#dragzone', tabId: 7 }));
    ledger.setDisposition('evt-pA-5', 'unclaimed');
    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified.map((t) => t.metadata?.targetName)).toContain('Drag area');
  });
});

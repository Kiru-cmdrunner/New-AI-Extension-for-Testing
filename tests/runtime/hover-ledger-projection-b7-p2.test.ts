/**
 * B7-P2 §5.2.4/§5.2.5 — ledger decomposition + projection rules.
 *
 * LEDGER_APPENDABLE: gated discovery mouseenters append; ungated pointer
 * crossings NEVER touch the ledger (no Unclassified flood).
 * R-1: pending hover claims never mint twins; unclaimed and abandoned
 * hover claims DO mint (F-3 backstop).
 * W-8: a completed discovered hover CLAIMS its events through the lifecycle
 * completion path (coveredEventIds suppression of its own twin).
 * W-3: mousedown anchor pin — Dropdown can trigger on mousedown, so
 * ANCHOR_ELIGIBLE must keep mousedown if any triggerEventType uses it.
 */

import { describe, it, expect } from 'vitest';
import {
  EvidenceLedger,
  DISCRETE_ACTION_TYPES,
  LEDGER_APPENDABLE,
  ANCHOR_ELIGIBLE,
} from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { makeObservedEvent } from '../helpers/make-event';
import type { ObservedEvent, ElementIdentity, DomContext } from '../../src/shared/component-types';

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Menu', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'button',
    inputType: null,
    xPath: '/html/body/button', inIframe: false, shadowDom: false, elementId: '',
    href: null,
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    tabIndex: null,
    ...overrides,
  };
}

function enterEvent(
  eventId: string,
  opts: { tag?: string; className?: string | null; ariaRole?: string | null } = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: 'mouseenter',
    target: makeTarget({ tag: opts.tag ?? 'BUTTON', className: opts.className ?? null, ariaRole: opts.ariaRole ?? null }),
    domContext: makeDomContext(),
    isTrusted: true,
    timestamp: 1000,
  });
}

describe('B7-P2: LEDGER_APPENDABLE decomposition', () => {
  it('gated discovery enter (interactive BUTTON) appends to the ledger', () => {
    const ledger = new EvidenceLedger();
    ledger.append(enterEvent('evt-pA-1'));
    expect(ledger.get('evt-pA-1')).not.toBeNull();
    expect(ledger.get('evt-pA-1')!.eventType).toBe('mouseenter');
  });

  it('ungated pointer crossing (bare DIV, no affordance) NEVER touches the ledger', () => {
    const ledger = new EvidenceLedger();
    ledger.append(enterEvent('evt-pA-2', { tag: 'DIV', className: 'some-random-container' }));
    expect(ledger.get('evt-pA-2')).toBeUndefined();
  });

  it('mouseleave/mousemove remain non-appendable', () => {
    const ledger = new EvidenceLedger();
    const leave = makeObservedEvent({
      eventId: 'evt-pA-3', eventType: 'mouseleave',
      target: makeTarget(), domContext: makeDomContext(), isTrusted: true, timestamp: 1200,
    });
    const move = makeObservedEvent({
      eventId: 'evt-pA-4', eventType: 'mousemove',
      target: makeTarget(), domContext: makeDomContext(), isTrusted: true, timestamp: 1250,
    });
    ledger.append(leave);
    ledger.append(move);
    expect(ledger.get('evt-pA-3')).toBeUndefined();
    expect(ledger.get('evt-pA-4')).toBeUndefined();
  });

  it('legacy members intact: click/contextmenu/mousedown/keydown/dragstart/drop still append', () => {
    expect([...DISCRETE_ACTION_TYPES]).toEqual(expect.arrayContaining([
      'click', 'contextmenu', 'mousedown', 'keydown', 'dragstart', 'drop',
    ]));
    // The monolithic set gains NO members.
    expect(DISCRETE_ACTION_TYPES.has('mouseenter')).toBe(false);
    // ...but LEDGER_APPENDABLE extends it for gated enters only (predicate,
    // not membership — the gate lives in append()).
    expect([...LEDGER_APPENDABLE]).toEqual(expect.arrayContaining([...DISCRETE_ACTION_TYPES]));
  });
});

describe('B7-P2: R-1 disposition truth table for hover claims', () => {
  function hoverClaimEntry(eventId: string, disposition: 'pending' | 'unclaimed' | 'absorbed') {
    const ledger = new EvidenceLedger();
    ledger.append(enterEvent(eventId));
    if (disposition !== 'pending') {
      ledger.setDisposition(eventId, disposition, 'lc-test', 'Hover');
    }
    return ledger;
  }

  it('PENDING hover claim → NO Unclassified twin (extended rule)', () => {
    const ledger = hoverClaimEntry('evt-pB-1', 'pending');
    const result = projectInteractions(ledger, []);
    const twins = result.interactions.filter(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-pB-1',
    );
    expect(twins.length).toBe(0);
  });

  it('UNCLAIMED hover claim → Unclassified twin mints (F-3 backstop)', () => {
    const ledger = hoverClaimEntry('evt-pB-2', 'unclaimed');
    const result = projectInteractions(ledger, []);
    const twins = result.interactions.filter(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-pB-2',
    );
    expect(twins.length).toBe(1);
  });

  it('ABANDONED hover (releaseClaims → unclaimed) → twin mints', () => {
    const ledger = new EvidenceLedger();
    ledger.append(enterEvent('evt-pB-3'));
    // Absorbed by a lifecycle that then abandons → releaseClaims flips to unclaimed.
    ledger.setDisposition('evt-pB-3', 'absorbed', 'lc-ab', 'Hover');
    ledger.releaseClaims('lc-ab');
    const entry = ledger.get('evt-pB-3')!;
    expect(entry.disposition).toBe('unclaimed');
    const result = projectInteractions(ledger, []);
    const twins = result.interactions.filter(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-pB-3',
    );
    expect(twins.length).toBe(1);
  });

  it('COMPLETED hover (claimed) suppresses its own twin via coveredEventIds (W-8)', () => {
    const ledger = new EvidenceLedger();
    const ev = enterEvent('evt-pB-4');
    ledger.append(ev);
    ledger.setDisposition('evt-pB-4', 'claimed', 'int-9', 'Hover');
    // A completed Hover interaction covering that enter event.
    const hover = {
      interactionId: 'int-9',
      lifecycleId: 'lc-9',
      type: 'Hover',
      trigger: ev.target,
      triggerEvent: ev,
      memberEvents: [],
      startTime: 1000,
      endTime: 1200,
      endState: 'completed',
      metadata: {},
    };
    const result = projectInteractions(ledger, [hover as never]);
    const twins = result.interactions.filter(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-pB-4',
    );
    expect(twins.length).toBe(0);
    // And the completed hover itself is present.
    expect(result.interactions.some((i) => i.interactionId === 'int-9')).toBe(true);
  });
});

describe('B7-P2: W-3 mousedown anchor pin', () => {
  it('ANCHOR_ELIGIBLE keeps mousedown (Dropdown triggers on mousedown — no definition loses anchoring)', () => {
    expect(ANCHOR_ELIGIBLE.has('mousedown')).toBe(true);
    expect(ANCHOR_ELIGIBLE.has('click')).toBe(true);
    expect(ANCHOR_ELIGIBLE.has('drop')).toBe(true);
    expect(ANCHOR_ELIGIBLE.has('keydown')).toBe(true);
    expect(ANCHOR_ELIGIBLE.has('contextmenu')).toBe(true);
  });
});

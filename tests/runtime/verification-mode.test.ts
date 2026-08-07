/**
 * Tests: Verification Mode — Shadow Comparison
 *
 * Milestone 4 of the End-to-End Capture Guarantee.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { compareOutputs, formatVerificationReport } from '../../src/runtime/verification-mode';
import { makeObservedEvent } from '../helpers/make-event';
import type { ComponentInteraction } from '../../src/shared/component-types';

function makeInteraction(
  type: string,
  eventId: string,
  timestamp: number = 1000,
): ComponentInteraction {
  return {
    interactionId: `int-${Math.floor(Math.random() * 100000)}`,
    type: type as any,
    trigger: {
      accessibleName: 'Test', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: 'btn1',
      testId: null, dataCy: null, dataQa: null, cssSelector: 'button', xPath: '',
      inIframe: false, shadowDom: false, href: null, elementId: '',
    },
    triggerEvent: makeObservedEvent({ eventId, eventType: 'click', timestamp }),
    memberEvents: [],
    startTime: timestamp,
    endTime: timestamp,
    endState: 'completed',
    metadata: { targetName: 'Test' },
  };
}

function makeUnclassified(eventId: string, physicalType: string): ComponentInteraction {
  return {
    ...makeInteraction('Unclassified', eventId),
    metadata: { physicalEventType: physicalType, recognized: false, reason: 'fallback' },
  };
}

describe('Verification Mode', () => {
  let ledger: EvidenceLedger;

  beforeEach(() => {
    ledger = new EvidenceLedger();
  });

  it('identical outputs → match:true', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const result = compareOutputs([click], [click], ledger);
    expect(result.match).toBe(true);
    expect(result.differences).toHaveLength(0);
  });

  it('runtime has Unclassified, projection has Unclassified for same eventId → match', () => {
    const unclassified = makeUnclassified('evt-p1-1', 'mousedown');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = compareOutputs([unclassified], [unclassified], ledger);
    expect(result.match).toBe(true);
  });

  it('runtime has Click, projection has Click for same eventId → match', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const result = compareOutputs([click], [click], ledger);
    expect(result.match).toBe(true);
  });

  it('runtime has Click, projection has Unclassified → mismatch (type)', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    const unclassified = makeUnclassified('evt-p1-1', 'click');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'pending');

    const result = compareOutputs([click], [unclassified], ledger);
    expect(result.match).toBe(false);
    expect(result.differences).toHaveLength(1);
    expect(result.differences[0].kind).toBe('type-mismatch');
    expect(result.differences[0].runtimeType).toBe('Click');
    expect(result.differences[0].projectedType).toBe('Unclassified');
  });

  it('runtime has 0 interactions, projection has 1 Unclassified → mismatch (extra)', () => {
    const unclassified = makeUnclassified('evt-p1-1', 'mousedown');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = compareOutputs([], [unclassified], ledger);
    expect(result.match).toBe(false);
    expect(result.differences[0].kind).toBe('extra');
    expect(result.differences[0].eventId).toBe('evt-p1-1');
  });

  it('runtime has 1 Click, projection has 0 → mismatch (missing)', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const result = compareOutputs([click], [], ledger);
    expect(result.match).toBe(false);
    expect(result.differences[0].kind).toBe('missing');
  });

  it('difference includes ledger entries with disposition evidence', () => {
    const unclassified = makeUnclassified('evt-p1-1', 'mousedown');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = compareOutputs([], [unclassified], ledger);
    expect(result.differences[0].ledgerEntries).toHaveLength(1);
    expect(result.differences[0].ledgerEntries[0].disposition).toBe('unclaimed');
    expect(result.differences[0].ledgerEntries[0].claimedBy).toBe('lc-1');
  });

  it('both outputs preserved in VerificationResult', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    const unclassified = makeUnclassified('evt-p1-2', 'mousedown');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'mousedown' }));

    const result = compareOutputs([click], [click, unclassified], ledger);
    expect(result.runtimeOutput).toHaveLength(1);
    expect(result.projectedOutput).toHaveLength(2);
  });

  it('formatVerificationReport produces readable text for match', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    const result = compareOutputs([click], [click], ledger);
    const report = formatVerificationReport(result);
    expect(report).toContain('MATCH');
    expect(report).toContain('1 interactions');
  });

  it('formatVerificationReport produces readable text for mismatch', () => {
    const unclassified = makeUnclassified('evt-p1-1', 'mousedown');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = compareOutputs([], [unclassified], ledger);
    const report = formatVerificationReport(result);
    expect(report).toContain('MISMATCH');
    expect(report).toContain('extra');
    expect(report).toContain('evt-p1-1');
  });

  it('multiple differences all reported', () => {
    const click1 = makeInteraction('Click', 'evt-p1-1');
    const click2 = makeInteraction('Click', 'evt-p1-2');
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click' }));

    const result = compareOutputs([click1], [click2], ledger);
    expect(result.differences.length).toBeGreaterThanOrEqual(2); // missing evt-p1-2 in runtime + extra evt-p1-1 in projected
  });
});

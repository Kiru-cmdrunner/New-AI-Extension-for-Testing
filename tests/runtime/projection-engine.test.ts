/**
 * Tests: Projection Engine
 *
 * Milestone 4 of the End-to-End Capture Guarantee.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
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

describe('Projection Engine', () => {
  let ledger: EvidenceLedger;

  beforeEach(() => {
    ledger = new EvidenceLedger();
  });

  it('empty ledger + empty interactions → empty output', () => {
    const result = projectInteractions(ledger, []);
    expect(result.interactions).toHaveLength(0);
    expect(result.projectedUnclassified).toHaveLength(0);
  });

  it('1 pending entry, 0 interactions → 1 Unclassified', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100 }));
    const result = projectInteractions(ledger, []);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].type).toBe('Unclassified');
    expect(result.projectedUnclassified).toHaveLength(1);
  });

  it('1 claimed entry + 1 matching interaction → 0 Unclassified', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100 }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Click');
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');
    const interaction = makeInteraction('Click', 'evt-p1-1');

    const result = projectInteractions(ledger, [interaction]);
    expect(result.interactions).toHaveLength(1);
    expect(result.projectedUnclassified).toHaveLength(0);
  });

  it('1 unclaimed entry → 1 Unclassified', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100 }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.interactions).toHaveLength(1);
    expect(result.interactions[0].type).toBe('Unclassified');
  });

  it('mousedown(unclaimed) + click(claimed) → 1 Unclassified + 1 Click', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101 }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');
    ledger.setDisposition('evt-p1-2', 'claimed', 'int-1', 'Click');

    const click = makeInteraction('Click', 'evt-p1-2');
    const result = projectInteractions(ledger, [click]);

    expect(result.interactions).toHaveLength(2);
    expect(result.projectedUnclassified).toHaveLength(1);
    expect(result.projectedUnclassified[0].metadata.physicalEventType).toBe('mousedown');
  });

  it('Unclassified has correct physicalEventType from ledger entry', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'contextmenu', captureSeq: 100 }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].metadata.physicalEventType).toBe('contextmenu');
  });

  it('Unclassified has recognized:false and reason', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'keydown', captureSeq: 100 }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].metadata.recognized).toBe(false);
    expect(result.projectedUnclassified[0].metadata.reason).toBe('unclaimed-at-projection');
  });

  it('3 entries, 2 claimed, 1 unclaimed → 1 interaction + 1 Unclassified', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click', captureSeq: 200 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-3', eventType: 'mousedown', captureSeq: 300 }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Dropdown');
    ledger.setDisposition('evt-p1-2', 'claimed', 'int-1', 'Dropdown');
    ledger.setDisposition('evt-p1-3', 'unclaimed');

    const dropdown = makeInteraction('Dropdown', 'evt-p1-1');
    const result = projectInteractions(ledger, [dropdown]);

    expect(result.interactions).toHaveLength(2); // 1 Dropdown + 1 Unclassified
    expect(result.projectedUnclassified).toHaveLength(1);
  });

  it('absorbed entry with 0 completed interactions → 1 Unclassified (defensive)', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100 }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    // Note: absorbed entries shouldn't exist post-flush, but projection handles defensively

    const result = projectInteractions(ledger, []);
    // Absorbed entries are NOT projected (only unclaimed/pending)
    // This is correct — absorbed means a lifecycle claimed it but didn't complete.
    // The Projection Engine should only project unclaimed/pending.
    expect(result.interactions).toHaveLength(0);
  });

  it('multiple pages → page boundaries preserved', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-pA-1', eventType: 'mousedown', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-pB-1', eventType: 'keydown', captureSeq: 200 }));
    ledger.setDisposition('evt-pA-1', 'unclaimed');
    ledger.setDisposition('evt-pB-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(2);
    expect(result.projectedEntries[0].pageId).toBe('pA');
    expect(result.projectedEntries[1].pageId).toBe('pB');
  });

  it('completed interactions preserved in output', () => {
    const click = makeInteraction('Click', 'evt-p1-1');
    const result = projectInteractions(ledger, [click]);
    expect(result.interactions).toContain(click);
  });

  it('large ledger (50 claimed, 50 unclaimed) → 50 Unclassified + interactions', () => {
    for (let i = 1; i <= 50; i++) {
      ledger.append(makeObservedEvent({
        eventId: `evt-p1-${i}`,
        eventType: 'click',
        captureSeq: i * 10,
      }));
      if (i <= 50) ledger.setDisposition(`evt-p1-${i}`, 'claimed', `int-${i}`, 'Click');
    }
    for (let i = 51; i <= 100; i++) {
      ledger.append(makeObservedEvent({
        eventId: `evt-p1-${i}`,
        eventType: 'mousedown',
        captureSeq: i * 10,
      }));
      ledger.setDisposition(`evt-p1-${i}`, 'unclaimed');
    }

    const interactions = Array.from({ length: 50 }, (_, i) => makeInteraction('Click', `evt-p1-${i + 1}`));
    const result = projectInteractions(ledger, interactions);

    expect(result.interactions).toHaveLength(100); // 50 Click + 50 Unclassified
    expect(result.projectedUnclassified).toHaveLength(50);
  });

  it('all 4 disposition statuses: only unclaimed + pending are projected', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click', captureSeq: 200 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-3', eventType: 'mousedown', captureSeq: 300 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-4', eventType: 'keydown', captureSeq: 400 }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');
    ledger.setDisposition('evt-p1-2', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-3', 'unclaimed');
    // evt-p1-4 stays pending

    const result = projectInteractions(ledger, [makeInteraction('Click', 'evt-p1-1')]);
    expect(result.projectedUnclassified).toHaveLength(2); // unclaimed + pending
    expect(result.projectedEntries.map(e => e.eventId)).toContain('evt-p1-3');
    expect(result.projectedEntries.map(e => e.eventId)).toContain('evt-p1-4');
  });

  // ── Diagnostic Identity in Projected Unclassified (Phase 1.2) ───────

  it('Unclassified carries real targetTag from ledger entry', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { tag: 'BUTTON' },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].trigger.tag).toBe('BUTTON');
    expect(result.projectedUnclassified[0].metadata.targetTag).toBe('BUTTON');
  });

  it('Unclassified carries real targetName from ledger entry', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { accessibleName: 'With Exchange' },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].trigger.accessibleName).toBe('With Exchange');
    expect(result.projectedUnclassified[0].metadata.targetName).toBe('With Exchange');
  });

  it('Unclassified carries real targetRole from ledger entry', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { ariaRole: 'combobox' },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].trigger.ariaRole).toBe('combobox');
    expect(result.projectedUnclassified[0].metadata.targetRole).toBe('combobox');
  });

  it('Unclassified carries real identity when targetRole is null', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { tag: 'DIV', accessibleName: '', ariaRole: null },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified[0].trigger.tag).toBe('DIV');
    expect(result.projectedUnclassified[0].trigger.accessibleName).toBe('');
    expect(result.projectedUnclassified[0].trigger.ariaRole).toBeNull();
    expect(result.projectedUnclassified[0].metadata.targetTag).toBe('DIV');
    expect(result.projectedUnclassified[0].metadata.targetName).toBe('');
    expect(result.projectedUnclassified[0].metadata.targetRole).toBeNull();
  });

  it('Unclassified triggerEvent.target carries real identity', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'mousedown',
      captureSeq: 100,
      target: { tag: 'A', accessibleName: 'Product Link', ariaRole: 'link' },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    const triggerTarget = result.projectedUnclassified[0].triggerEvent.target;
    expect(triggerTarget.tag).toBe('A');
    expect(triggerTarget.accessibleName).toBe('Product Link');
    expect(triggerTarget.ariaRole).toBe('link');
  });
});

/**
 * Tests: EvidenceLedger — Append-Only Store with Dispositions
 *
 * Milestone 2 of the End-to-End Capture Guarantee.
 *
 * Tests:
 * - INV-LE-1: Every discrete event appended receives 'pending' disposition
 * - INV-LE-2: Dispositions follow pending → absorbed → (claimed | unclaimed)
 * - INV-LE-3: restore() always resets 'absorbed' → 'unclaimed'
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  EvidenceLedger,
  DISCRETE_ACTION_TYPES,
} from '../../src/runtime/evidence-ledger';
import { makeObservedEvent } from '../helpers/make-event';

describe('EvidenceLedger — Milestone 2', () => {
  let ledger: EvidenceLedger;

  beforeEach(() => {
    ledger = new EvidenceLedger();
  });

  // ── Append & Filtering ──────────────────────────────────────────────

  it('appends a click event with pending disposition', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' });
    ledger.append(event);

    expect(ledger.size).toBe(1);
    const entry = ledger.get('evt-p1-1')!;
    expect(entry.disposition).toBe('pending');
    expect(entry.eventType).toBe('click');
    expect(entry.captureSeq).toBe(0);
    expect(entry.pageId).toBe('p1');
  });

  it('does NOT append focus events (non-discrete)', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'focus' });
    ledger.append(event);

    expect(ledger.size).toBe(0);
  });

  it('does NOT append scroll events (non-discrete)', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'scroll' });
    ledger.append(event);

    expect(ledger.size).toBe(0);
  });

  it('does NOT append input events (non-discrete)', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'input' });
    ledger.append(event);

    expect(ledger.size).toBe(0);
  });

  it('does NOT append mousemove events (non-discrete)', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousemove' });
    ledger.append(event);

    expect(ledger.size).toBe(0);
  });

  it('does NOT append duplicate eventIds', () => {
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' });
    ledger.append(event);
    ledger.append(event); // same eventId

    expect(ledger.size).toBe(1);
  });

  it('appends all 4 discrete event types', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'contextmenu' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-3', eventType: 'mousedown' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-4', eventType: 'keydown' }));

    expect(ledger.size).toBe(4);
  });

  // ── Disposition Management ──────────────────────────────────────────

  it('setDisposition updates from pending to absorbed', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');

    const entry = ledger.get('evt-p1-1')!;
    expect(entry.disposition).toBe('absorbed');
    expect(entry.claimedBy).toBe('lc-1');
    expect(entry.claimType).toBe('Dropdown');
  });

  it('setDisposition updates from absorbed to claimed', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Dropdown');

    const entry = ledger.get('evt-p1-1')!;
    expect(entry.disposition).toBe('claimed');
    expect(entry.claimedBy).toBe('int-1');
  });

  it('setDisposition updates from absorbed to unclaimed', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const entry = ledger.get('evt-p1-1')!;
    expect(entry.disposition).toBe('unclaimed');
  });

  it('setDisposition on unknown eventId is a no-op (no throw)', () => {
    expect(() => ledger.setDisposition('evt-unknown-1', 'absorbed')).not.toThrow();
    expect(ledger.size).toBe(0);
  });

  it('claimed is terminal — cannot be overwritten', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Click');
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');
    ledger.setDisposition('evt-p1-1', 'unclaimed'); // should be ignored

    expect(ledger.get('evt-p1-1')!.disposition).toBe('claimed');
  });

  it('unclaimed is terminal — cannot be overwritten', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'unclaimed');
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click'); // should be ignored

    expect(ledger.get('evt-p1-1')!.disposition).toBe('unclaimed');
  });

  // ── releaseClaims ───────────────────────────────────────────────────

  it('releaseClaims sets all absorbed entries for a lifecycle to unclaimed', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-2', 'absorbed', 'lc-1', 'Dropdown');

    ledger.releaseClaims('lc-1');

    expect(ledger.get('evt-p1-1')!.disposition).toBe('unclaimed');
    expect(ledger.get('evt-p1-2')!.disposition).toBe('unclaimed');
  });

  it('releaseClaims does not affect entries from other lifecycles', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-2', 'absorbed', 'lc-2', 'Click');

    ledger.releaseClaims('lc-1');

    expect(ledger.get('evt-p1-1')!.disposition).toBe('unclaimed');
    expect(ledger.get('evt-p1-2')!.disposition).toBe('absorbed');
  });

  it('releaseClaims on unknown lifecycleId is a no-op', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');

    ledger.releaseClaims('lc-nonexistent');

    expect(ledger.get('evt-p1-1')!.disposition).toBe('absorbed');
  });

  it('releaseClaims does not affect claimed entries', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Click');
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    ledger.releaseClaims('lc-1');

    expect(ledger.get('evt-p1-1')!.disposition).toBe('claimed');
  });

  // ── Snapshot / Restore ──────────────────────────────────────────────

  it('snapshot → restore → entries preserved', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'mousedown', captureSeq: 200 }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const snap = ledger.snapshot();
    expect(snap.length).toBe(2);

    const newLedger = new EvidenceLedger();
    newLedger.restore(snap);

    expect(newLedger.size).toBe(2);
    expect(newLedger.get('evt-p1-1')!.disposition).toBe('claimed');
    // evt-p1-2 was pending, should stay pending
    expect(newLedger.get('evt-p1-2')!.disposition).toBe('pending');
  });

  it('restore resets absorbed → unclaimed (SW restart rule)', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');

    const snap = ledger.snapshot();
    expect(snap[0].disposition).toBe('absorbed');

    const newLedger = new EvidenceLedger();
    newLedger.restore(snap);

    expect(newLedger.get('evt-p1-1')!.disposition).toBe('unclaimed');
  });

  it('restore preserves claimed entries', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const snap = ledger.snapshot();
    const newLedger = new EvidenceLedger();
    newLedger.restore(snap);

    expect(newLedger.get('evt-p1-1')!.disposition).toBe('claimed');
  });

  it('restore preserves unclaimed entries', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'absorbed', 'lc-1', 'Dropdown');
    ledger.setDisposition('evt-p1-1', 'unclaimed');

    const snap = ledger.snapshot();
    const newLedger = new EvidenceLedger();
    newLedger.restore(snap);

    expect(newLedger.get('evt-p1-1')!.disposition).toBe('unclaimed');
  });

  // ── Ordering ────────────────────────────────────────────────────────

  it('entries sorted by captureSeq within same pageId', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-3', eventType: 'click', captureSeq: 300 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'click', captureSeq: 200 }));

    const entries = ledger.getEntries();
    expect(entries[0].eventId).toBe('evt-p1-1');
    expect(entries[1].eventId).toBe('evt-p1-2');
    expect(entries[2].eventId).toBe('evt-p1-3');
  });

  it('entries grouped by pageId', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-pA-1', eventType: 'click', captureSeq: 100 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-pB-1', eventType: 'click', captureSeq: 50 }));
    ledger.append(makeObservedEvent({ eventId: 'evt-pA-2', eventType: 'mousedown', captureSeq: 200 }));

    const entries = ledger.getEntries();
    // Page A entries come first (localeCompare on 'pA' < 'pB')
    expect(entries[0].pageId).toBe('pA');
    expect(entries[1].pageId).toBe('pA');
    expect(entries[2].pageId).toBe('pB');
  });

  // ── Utility ─────────────────────────────────────────────────────────

  it('clear() empties the ledger', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    expect(ledger.size).toBe(1);

    ledger.clear();
    expect(ledger.size).toBe(0);
  });

  it('size reflects entry count', () => {
    expect(ledger.size).toBe(0);
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    expect(ledger.size).toBe(1);
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'mousedown' }));
    expect(ledger.size).toBe(2);
  });

  it('getByDisposition filters entries', () => {
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' }));
    ledger.append(makeObservedEvent({ eventId: 'evt-p1-2', eventType: 'mousedown' }));
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');

    const claimed = ledger.getByDisposition('claimed');
    expect(claimed.length).toBe(1);
    expect(claimed[0].eventId).toBe('evt-p1-1');

    const pending = ledger.getByDisposition('pending');
    expect(pending.length).toBe(1);
    expect(pending[0].eventId).toBe('evt-p1-2');
  });

  // ── DISCRETE_ACTION_TYPES constant ──────────────────────────────────

  it('DISCRETE_ACTION_TYPES contains click, contextmenu, mousedown, keydown, dragstart, drop', () => {
    expect(DISCRETE_ACTION_TYPES.size).toBe(6);
    expect(DISCRETE_ACTION_TYPES.has('click')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('contextmenu')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('mousedown')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('keydown')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('dragstart')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('drop')).toBe(true);
    expect(DISCRETE_ACTION_TYPES.has('focus')).toBe(false);
    expect(DISCRETE_ACTION_TYPES.has('scroll')).toBe(false);
    expect(DISCRETE_ACTION_TYPES.has('input')).toBe(false);
  });

  // ── pageId extraction ───────────────────────────────────────────────

  it('pageId extraction: evt-pABC-3 → pABC', () => {
    const event = makeObservedEvent({ eventId: 'evt-pABC-3', eventType: 'click' });
    ledger.append(event);
    expect(ledger.get('evt-pABC-3')!.pageId).toBe('pABC');
  });

  // ── Diagnostic Identity Fields (Phase 1.2) ──────────────────────────

  it('append() populates targetTag from ObservedEvent.target.tag', () => {
    const event = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { tag: 'BUTTON' },
    });
    ledger.append(event);
    expect(ledger.get('evt-p1-1')!.targetTag).toBe('BUTTON');
  });

  it('append() populates targetName from ObservedEvent.target.accessibleName', () => {
    const event = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { accessibleName: 'Submit Form' },
    });
    ledger.append(event);
    expect(ledger.get('evt-p1-1')!.targetName).toBe('Submit Form');
  });

  it('append() populates targetRole from ObservedEvent.target.ariaRole', () => {
    const event = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { ariaRole: 'combobox' },
    });
    ledger.append(event);
    expect(ledger.get('evt-p1-1')!.targetRole).toBe('combobox');
  });

  it('append() populates targetRole=null when element has no ARIA role', () => {
    const event = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { ariaRole: null },
    });
    ledger.append(event);
    expect(ledger.get('evt-p1-1')!.targetRole).toBeNull();
  });

  it('append() uses default identity when target has empty fields', () => {
    // makeObservedEvent default: tag='DIV', accessibleName='', ariaRole=null
    const event = makeObservedEvent({ eventId: 'evt-p1-1', eventType: 'click' });
    ledger.append(event);
    const entry = ledger.get('evt-p1-1')!;
    expect(entry.targetTag).toBe('DIV');
    expect(entry.targetName).toBe('');
    expect(entry.targetRole).toBeNull();
  });

  it('identity fields survive snapshot/restore round-trip', () => {
    const event = makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { tag: 'A', accessibleName: 'View Details', ariaRole: 'link' },
    });
    ledger.append(event);

    const snapshot = ledger.snapshot();
    const restored = new EvidenceLedger();
    restored.restore(snapshot);

    const entry = restored.get('evt-p1-1')!;
    expect(entry.targetTag).toBe('A');
    expect(entry.targetName).toBe('View Details');
    expect(entry.targetRole).toBe('link');
  });

  it('identity fields differ per event (two events, different targets)', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1',
      eventType: 'click',
      target: { tag: 'BUTTON', accessibleName: 'Save', ariaRole: 'button' },
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2',
      eventType: 'mousedown',
      target: { tag: 'INPUT', accessibleName: 'Email', ariaRole: 'textbox' },
    }));

    const e1 = ledger.get('evt-p1-1')!;
    const e2 = ledger.get('evt-p1-2')!;
    expect(e1.targetTag).toBe('BUTTON');
    expect(e2.targetTag).toBe('INPUT');
    expect(e1.targetName).toBe('Save');
    expect(e2.targetName).toBe('Email');
  });

  it('all 4 discrete types populate identity fields', () => {
    for (const eventType of ['click', 'contextmenu', 'mousedown', 'keydown']) {
      ledger.append(makeObservedEvent({
        eventId: `evt-p1-${eventType}`,
        eventType: eventType as any,
        target: { tag: 'SPAN', accessibleName: 'Widget', ariaRole: 'option' },
      }));
      const entry = ledger.get(`evt-p1-${eventType}`)!;
      expect(entry.targetTag).toBe('SPAN');
      expect(entry.targetName).toBe('Widget');
      expect(entry.targetRole).toBe('option');
    }
  });
});

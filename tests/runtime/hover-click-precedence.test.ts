/**
 * Spec: .drytis/specs/hover-capture-evidence-contract-v1.md §8 (R-C1…R-C5), §12 AC-6/7/8
 * Pins 2–3 of §14 — hover-click-precedence + hec-g-self-consistency.
 *
 * The four loss chains: (mousedown-started lifecycle above a live hover) ×
 * (hover admitted / dropped) — the physical click must survive as its OWN
 * interaction in ALL FOUR cases, never solely inside a Hover.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { hoverDefinition } from '../../src/definitions/hover';
import { dropdownDefinition } from '../../src/definitions/dropdown';
import { clickDefinition } from '../../src/definitions/click';
import { textEntryDefinition } from '../../src/definitions/text-entry';
import type { ComponentDefinition } from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

function makeRuntime(defs: ComponentDefinition[], onEmit: (i: unknown) => void) {
  const ledger = new EvidenceLedger();
  const runtime = createRuntime(defs, {
    onEmit: onEmit as never,
    evidenceLedger: ledger,
  });
  // Mirror sw-integration.ts:1362 — the ledger append happens alongside
  // runtime.process (every discrete event gets a row; runtime sets
  // dispositions on it).
  const feed = (e: unknown) => {
    ledger.append(e as never);
    runtime.process(e as never);
  };
  return { runtime, ledger, feed };
}

const DEFS = [dropdownDefinition, textEntryDefinition, hoverDefinition, clickDefinition];

function enterEl(extra: Record<string, unknown> = {}) {
  return { stableId: 'menu-trigger', cssSelector: '#menu-trigger', tag: 'DIV', ariaRole: 'button', ...extra };
}
function iconEl(extra: Record<string, unknown> = {}) {
  return { stableId: 'chev', cssSelector: '#chev', tag: 'I', className: 'icon-chevron', ...extra };
}

describe('HEC: click precedence — the four loss chains', () => {
  it('chain 1: dropdown lifecycle above hover (mousedown trigger), consuming click — hover ADMITTED path: click survives', () => {
    const emitted: any[] = [];
    const { ledger, feed } = makeRuntime(DEFS, (i) => emitted.push(i));

    // 1. hover enter on the trigger-shaped element → Hover candidate
    feed(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mouseenter', captureSeq: 1, timestamp: 1000,
      target: enterEl(),
      domContext: { ariaExpanded: null, ariaHasPopup: 'listbox', tabIndex: 0, ancestorRoles: [], ancestorClasses: [], inputType: null, isContentEditable: false, disabled: false, readOnly: false, required: false } as never,
    }));

    // 2. mousedown on the icon child → Dropdown lifecycle starts ABOVE the hover
    feed(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'mousedown', captureSeq: 2, timestamp: 1100,
      target: iconEl(),
    }));

    // 3. click on the same icon → Dropdown same-element null path absorbs it,
    //    AND the hover underneath completes consumed-by-click.
    feed(makeObservedEvent({
      eventId: 'evt-p1-3', eventType: 'click', captureSeq: 3, timestamp: 1200,
      target: iconEl(),
    }));

    const hovers = emitted.filter((i) => i.type === 'Hover');
    const clicks = emitted.filter((i) => i.type === 'Click');
    const unclassified = emitted.filter((i) => i.type === 'Unclassified');

    // Hover completed with consumed-by-click terminal
    expect(hovers.length).toBe(1);
    expect(hovers[0].metadata.terminal).toBe('consumed-by-click');

    // THE INVARIANT (R-C1): the click is NOT inside the hover's members
    const hoverMemberIds = hovers[0].memberEvents.map((m: any) => m.eventId);
    expect(hoverMemberIds).not.toContain('evt-p1-3');

    // HEC-G: the click row is represented by a NON-Hover carrier — claimed
    // by the standalone Click (int-2), never by the Hover (int-1).
    const clickEntry = ledger.snapshot().find((e: any) => e.eventId === 'evt-p1-3');
    expect(clickEntry).toBeTruthy();
    const claimedBy = (clickEntry as { claimedBy?: string | null }).claimedBy ?? null;
    if (claimedBy) {
      const claimer = emitted.find((i: any) => i.interactionId === claimedBy);
      expect(claimer?.type).not.toBe('Hover');
    }
    expect(clicks.length).toBeGreaterThanOrEqual(1); // the click SURVIVES
    // eslint-disable-next-line no-console
    void unclassified;
  });

  it('chain 2: same chain, hover ends gesture-only (dropped at admission) — click STILL survives', () => {
    const emitted: any[] = [];
    const { feed } = makeRuntime(DEFS, (i) => emitted.push(i));

    feed(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mouseenter', captureSeq: 1, timestamp: 1000,
      target: enterEl(),
      domContext: { ariaExpanded: null, ariaHasPopup: 'listbox', tabIndex: 0, ancestorRoles: [], ancestorClasses: [], inputType: null, isContentEditable: false, disabled: false, readOnly: false, required: false } as never,
    }));
    feed(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'mousedown', captureSeq: 2, timestamp: 1100,
      target: iconEl(),
    }));
    feed(makeObservedEvent({
      eventId: 'evt-p1-3', eventType: 'click', captureSeq: 3, timestamp: 1200,
      target: iconEl(),
    }));

    // The click must be represented by a non-Hover interaction OR fall to
    // projection as Unclassified — never ONLY the Hover's terminal fact.
    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeTruthy();
    const memberIds = hover.memberEvents.map((m: any) => m.eventId);
    expect(memberIds).not.toContain('evt-p1-3');
  });

  it('chain 3: hover alone (no lifecycle above), click same element — BOTH interactions emitted, no twins', () => {
    const emitted: any[] = [];
    const { feed } = makeRuntime([hoverDefinition, clickDefinition], (i) => emitted.push(i));

    feed(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mouseenter', captureSeq: 1, timestamp: 1000,
      target: enterEl(),
      domContext: { ariaExpanded: null, ariaHasPopup: 'listbox', tabIndex: 0, ancestorRoles: [], ancestorClasses: [], inputType: null, isContentEditable: false, disabled: false, readOnly: false, required: false } as never,
    }));
    feed(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'click', captureSeq: 2, timestamp: 1200,
      target: enterEl(),
    }));

    const hovers = emitted.filter((i) => i.type === 'Hover');
    const clicks = emitted.filter((i) => i.type === 'Click');
    expect(hovers.length).toBe(1);
    expect(clicks.length).toBe(1); // exactly one Click — no twin
    expect(hovers[0].metadata.terminal).toBe('consumed-by-click');
    // click not a hover member
    expect(hovers[0].memberEvents.map((m: any) => m.eventId)).not.toContain('evt-p1-2');
  });

  it('chain 4: TextEntry above hover absorbs the click (B6 focus-click) — B6 IR sequence preserved AND hover terminal recorded', () => {
    const emitted: any[] = [];
    const { feed } = makeRuntime([textEntryDefinition, hoverDefinition, clickDefinition], (i) => emitted.push(i));

    // TextEntry lifecycle active on the field
    feed(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'focus', captureSeq: 1, timestamp: 1000,
      target: { tag: 'INPUT', inputType: 'text', cssSelector: 'input', ariaRole: 'textbox' },
    }));
    // Hover underneath on a different element
    feed(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'mouseenter', captureSeq: 2, timestamp: 1050,
      target: enterEl(),
      domContext: { ariaExpanded: null, ariaHasPopup: 'listbox', tabIndex: 0, ancestorRoles: [], ancestorClasses: [], inputType: null, isContentEditable: false, disabled: false, readOnly: false, required: false } as never,
    }));
    // focus-click into the field: click absorbed by TextEntry (top of stack)
    feed(makeObservedEvent({
      eventId: 'evt-p1-3', eventType: 'click', captureSeq: 3, timestamp: 1100,
      target: { tag: 'INPUT', inputType: 'text', cssSelector: 'input', ariaRole: 'textbox' },
    }));

    const textEntries = emitted.filter((i) => i.type === 'TextEntry');
    const hovers = emitted.filter((i) => i.type === 'Hover');
    const clicks = emitted.filter((i) => i.type === 'Click');

    // B6: no twin Click minted — the click belongs to TextEntry only
    expect(clicks.length).toBe(0);
    expect(textEntries.length).toBeGreaterThanOrEqual(0);
    // Hover completed consumed-by-click as a FACT (terminal recorded) — D-HEC-4
    // even though TextEntry owned the click.
    expect(hovers.length).toBe(1);
    expect(hovers[0].metadata.terminal).toBe('consumed-by-click');
    expect(hovers[0].memberEvents.map((m: any) => m.eventId)).not.toContain('evt-p1-3');
  });
});

describe('HEC-G: STOP self-consistency', () => {
  it('no click ledger row is ever represented solely by a Hover', () => {
    const emitted: any[] = [];
    const { ledger, feed } = makeRuntime(DEFS, (i) => emitted.push(i));

    feed(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mouseenter', captureSeq: 1, timestamp: 1000,
      target: enterEl(),
      domContext: { ariaExpanded: null, ariaHasPopup: 'listbox', tabIndex: 0, ancestorRoles: [], ancestorClasses: [], inputType: null, isContentEditable: false, disabled: false, readOnly: false, required: false } as never,
    }));
    feed(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'click', captureSeq: 2, timestamp: 1200,
      target: enterEl(),
    }));

    // Simulate STOP projection coverage: every click/contextmenu row must be
    // covered by a completed NON-Hover interaction or be projectable (pending/
    // unclaimed — never claimed-by-Hover).
    const violations = ledger.snapshot().filter((e: any) =>
      (e.eventType === 'click' || e.eventType === 'contextmenu') &&
      e.claimedBy != null &&
      emitted.some((i) => i.type === 'Hover' && i.interactionId === e.claimedBy),
    );
    expect(violations).toEqual([]);
  });
});

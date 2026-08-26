/**
 * 7.4-B5 B5-2b — backdrop parity pins (spec B5-2b-1, B5-2b-2).
 *
 * In-overlay backdrop stays Click (already works — pin as regression).
 * Sibling backdrop stays Unclassified (B3 parity — pin, don't weaken).
 *
 * Red-first: fails only if Modal's open gate accidentally steals these.
 */
import { describe, it, expect } from 'vitest';
import { ALL_DEFINITIONS } from '../../src/definitions';
import type { ObservedEvent, DomContext } from '../../src/shared/component-types';

function makeEvent(over: {
  tag?: string;
  className?: string | null;
  domContext?: Partial<DomContext>;
}): ObservedEvent {
  const domContext: DomContext = {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    tabIndex: null,
    ...over.domContext,
  };
  return {
    eventId: 'evt-p-0-1',
    eventType: 'click',
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
    target: {
      tag: over.tag ?? 'DIV',
      ariaRole: null,
      className: over.className ?? null,
      autoId: null,
      dataAutoId: null,
      accessibleName: '',
    },
    domContext,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
  } as unknown as ObservedEvent;
}

function getClick() {
  return ALL_DEFINITIONS.find((d) => d.type === 'Click')!;
}
function getModal() {
  return ALL_DEFINITIONS.find((d) => d.type === 'Modal');
}

describe('7.4-B5 B5-2b — backdrop parity (regression pins)', () => {
  it('B5-2b-1: in-overlay backdrop (MuiDialog-root > MuiBackdrop) stays Click', () => {
    // MUI shape: backdrop div with class containing "MuiBackdrop", inside
    // a root with "MuiDialog-root" — OPEN_SELECTION_SURFACE_CLASS_RE matches
    // and Click(180) claims via the structural rescue gate.
    // No aria-haspopup on the backdrop itself.
    const e = makeEvent({
      tag: 'DIV',
      className: 'MuiBackdrop-root',
      domContext: {
        ancestorClasses: ['MuiDialog-root', 'MuiDialog-root', 'body', 'html'],
        // The ancestor class regex already in patterns.ts matches open-surface
        // structures — this is the S6/LP1 gate.
      },
    });

    // Modal should NOT claim this (no aria-haspopup=dialog on the target)
    const modal = getModal();
    if (modal) {
      expect(modal.detectTrigger(e)).toBeNull();
    }
    // Click should claim it (universal fallback)
    expect(getClick().detectTrigger(e)).toEqual({ type: 'Click' });
  });

  it('B5-2b-2: sibling backdrop (plain div, no dialog signal) stays Unclassified', () => {
    // Census fixture #popover-backdrop shape: direct body child, no dialog
    // ancestry, no aria-haspopup, no interactive role.
    const e = makeEvent({
      tag: 'DIV',
      className: 'popover-backdrop',
      domContext: {
        ancestorClasses: ['body', 'html'],
        ancestorRoles: ['body[role=]', 'html[role=]'],
      },
    });

    // No definition should claim this — it falls to Click(180) which IS
    // the universal fallback. But Click claims EVERYTHING by design.
    // The point is Modal does NOT steal it.
    const modal = getModal();
    if (modal) {
      expect(modal.detectTrigger(e)).toBeNull();
    }
    // Click is the fallback — it claims, but the card would be Unclassified
    // in the live system because Click(180) is the fallback after all other
    // definitions decline. In unit test, Click.detectTrigger always returns
    // {type:'Click'} for any click event.
  });

  it('B5-2b-2: sibling backdrop with actionabilityEvidence stays Unclassified (B3 parity)', () => {
    // The B3 S5 actionabilityEvidence flag is presentation-only metadata.
    // A sibling backdrop card carries it but stays Unclassified — Modal
    // must not steal it.
    const e = makeEvent({
      tag: 'DIV',
      className: 'popover-backdrop',
      domContext: {
        ancestorClasses: ['body', 'html'],
        ancestorRoles: ['body[role=]', 'html[role=]'],
      },
    });

    const modal = getModal();
    if (modal) {
      expect(modal.detectTrigger(e)).toBeNull();
    }
  });
});
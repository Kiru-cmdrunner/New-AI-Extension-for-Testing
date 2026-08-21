/**
 * LP2 + LP3 (S6) — post-hoc enrichment of projected Unclassified cards.
 *
 * LP1 recognized clicks inside open selection surfaces at runtime, but the
 * remaining Unclassified population (e.g. closed selectbox openers on
 * AdaniOne-class widgets) still reached storage without Layer-2/Layer-3
 * enrichment because two defects compounded:
 *
 *   LP3 (data loss): the Evidence Ledger persisted targetIdentity but not
 *   the ancestor context; the projection's synthetic triggerEvent hard-coded
 *   ancestorRoles/ancestorClasses to [], destroying Dialog/surface ancestry.
 *
 *   LP2 (architectural gap): stopRecording() never called enrichInteraction
 *   on the projected output — only the runtime's onEmit path enriched.
 *
 * Together: the ledger persists minimal ancestor context (two arrays), the
 * projection restores it into the synthetic triggerEvent, and stopRecording
 * enriches ONLY the projected Unclassified cards. Type stays 'Unclassified'
 * so NOISE_TYPES keeps excluding them from the IR — no fabricated steps.
 */
import { describe, it, expect } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import type { ObservedEvent } from '../../src/shared/component-types';
import { enrichInteraction } from '../../src/enrichment';

function identity(name: string, tag: string, className: string | null = null, cssSelector = '') {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className,
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

function event(
  id: string,
  type: string,
  opts: {
    name: string;
    tag: string;
    className?: string | null;
    css?: string;
    seq?: number;
    ts?: number;
    ancestorRoles?: string[];
    ancestorClasses?: string[];
  },
): ObservedEvent {
  return {
    eventId: id,
    eventType: type as never,
    timestamp: opts.ts ?? 1000,
    captureSeq: opts.seq ?? 1,
    isTrusted: true,
    target: identity(opts.name, opts.tag, opts.className ?? null, opts.css ?? ''),
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: opts.ancestorRoles ?? [],
      ancestorClasses: opts.ancestorClasses ?? [],
      tabIndex: null,
    },
  } as unknown as ObservedEvent;
}

const LEGACY_SNAPSHOT_ENTRY = {
  // Pre-LP3 row: neither ancestor field present at all.
  eventId: 'evt-pOld-1',
  captureSeq: 1,
  pageId: 'pOld',
  eventType: 'click',
  timestamp: 500,
  disposition: 'unclaimed',
  targetTag: 'DIV',
  targetName: 'Older row',
  targetRole: null,
} as never;

describe('LP3 — ledger persists ancestor context', () => {
  it('appends ancestorRoles/ancestorClasses from the event domContext', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pA-1', 'click', {
      name: '1 Economy', tag: 'DIV', className: 'PaxAndClass-selectbox',
      ancestorRoles: ['dialog'],
      ancestorClasses: ['PaxAndClass-tab', 'flyout', 'modal-shell'],
    }));
    const e = ledger.get('evt-pA-1')!;
    expect(e.ancestorRoles).toEqual(['dialog']);
    expect(e.ancestorClasses).toEqual(['PaxAndClass-tab', 'flyout', 'modal-shell']);
  });

  it('persists null (not undefined) when the event carries no domContext', () => {
    const ledger = new EvidenceLedger();
    ledger.append({
      eventId: 'evt-pA-2', eventType: 'click', timestamp: 1000, captureSeq: 2,
      isTrusted: true, target: identity('Bare', 'DIV'),
    } as unknown as ObservedEvent);
    const e = ledger.get('evt-pA-2')!;
    expect(e.ancestorRoles).toBeNull();
    expect(e.ancestorClasses).toBeNull();
  });

  it('restore() normalizes legacy snapshots to null for both fields', () => {
    const ledger = new EvidenceLedger();
    ledger.restore([LEGACY_SNAPSHOT_ENTRY]);
    const e = ledger.get('evt-pOld-1')!;
    expect(e.targetIdentity).toBeNull();       // D1 normalization intact
    expect(e.captureOrigin).toBeNull();
    expect(e.ancestorRoles).toBeNull();        // LP3 normalization
    expect(e.ancestorClasses).toBeNull();
  });

  it('snapshot() round-trips the ancestor arrays (persisted to storage)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pA-3', 'click', {
      name: 'One Way', tag: 'DIV',
      ancestorRoles: ['listbox'], ancestorClasses: ['trip-type'],
    }));
    const snap = ledger.snapshot();
    expect(snap[0].ancestorRoles).toEqual(['listbox']);
    const restored = new EvidenceLedger();
    restored.restore(snap);
    expect(restored.get('evt-pA-3')!.ancestorRoles).toEqual(['listbox']);
  });
});

describe('LP3 — projection restores ancestor context into the synthetic triggerEvent', () => {
  it('uses persisted ancestorRoles/ancestorClasses instead of []', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pB-1', 'click', {
      name: 'Round Trip', tag: 'DIV', className: 'opt-row',
      ancestorRoles: ['listbox'], ancestorClasses: ['dropdown-list'],
      seq: 1,
    }));
    const out = projectInteractions(ledger, []);
    const card = out.interactions.find((i) => i.type === 'Unclassified');
    expect(card).toBeDefined();
    expect(card!.triggerEvent!.domContext.ancestorRoles).toEqual(['listbox']);
    expect(card!.triggerEvent!.domContext.ancestorClasses).toEqual(['dropdown-list']);
  });

  it('falls back to [] for legacy rows restored with null ancestor fields', () => {
    const ledger = new EvidenceLedger();
    ledger.restore([LEGACY_SNAPSHOT_ENTRY]);
    const out = projectInteractions(ledger, []);
    const card = out.interactions.find((i) => i.type === 'Unclassified');
    expect(card).toBeDefined();
    expect(card!.triggerEvent!.domContext.ancestorRoles).toEqual([]);
    expect(card!.triggerEvent!.domContext.ancestorClasses).toEqual([]);
  });

  it('paired memberEvent mirrors the enriched ancestor context (S1′ shape intact)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pC-1', 'mousedown', {
      name: 'Premium Economy', tag: 'DIV', className: 'opt-row',
      ancestorRoles: ['listbox'], ancestorClasses: ['dropdown-list'], seq: 1,
    }));
    ledger.append(event('evt-pC-2', 'click', {
      name: 'Premium Economy', tag: 'DIV', className: 'opt-row',
      ancestorRoles: ['listbox'], ancestorClasses: ['dropdown-list'], seq: 2,
    }));
    const out = projectInteractions(ledger, []);
    const card = out.interactions.find(
      (i) => i.type === 'Unclassified' && (i.memberEvents?.length ?? 0) === 1,
    );
    expect(card).toBeDefined();
    expect(card!.triggerEvent!.domContext.ancestorRoles).toEqual(['listbox']);
    expect(card!.memberEvents![0].domContext.ancestorRoles).toEqual(['listbox']);
  });
});

describe('LP2 — post-hoc enrichment fires on persisted ancestor context', () => {
  it('enrichInteraction assigns Dialog componentType from restored ancestry', () => {
    // The exact AdaniOne shape LP1 could not help (bare div inside a dialog
    // surface that carries no interactive semantics at all).
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pD-1', 'click', {
      name: '1 Economy', tag: 'DIV', className: 'PaxAndClass-selectbox',
      ancestorRoles: ['dialog'],
      ancestorClasses: ['PaxAndClass-tab', 'PaxAndClass-dialog'],
      seq: 1,
    }));
    const out = projectInteractions(ledger, []);
    const card = out.interactions.find((i) => i.type === 'Unclassified');
    expect(card).toBeDefined();
    // stopRecording's LP2 loop, applied:
    enrichInteraction(card!);
    expect(card!.componentType).toBeDefined();
    // Dialog ancestry is the signal detectComponent consumes (P2/RC5 lineage):
    expect(String(card!.componentType).toLowerCase()).toContain('dialog');
    expect(card!.type).toBe('Unclassified'); // honesty invariant: still not a step
  });

  it('cards with no ancestry enrich to their no-ancestry baseline (no fabrication)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pD-2', 'click', {
      name: '1 Economy', tag: 'DIV', className: 'PaxAndClass-selectbox',
      seq: 1,
    }));
    const out = projectInteractions(ledger, []);
    const card = out.interactions.find((i) => i.type === 'Unclassified');
    enrichInteraction(card!);
    expect(card!.businessMeaning).toBeTypeOf('string'); // defined, not thrown
    expect(card!.type).toBe('Unclassified');
  });
});

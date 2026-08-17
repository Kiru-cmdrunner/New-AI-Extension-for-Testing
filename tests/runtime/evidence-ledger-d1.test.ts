/**
 * D1 — EvidenceLedger full-identity + capture-origin capture.
 *
 * The ledger's diagnostic fields (tag/name/role) were too impoverished for
 * twin affinity: a projected Unclassified twin built from them could never
 * match the recognized interaction's elementKey, so normalizeWorkflow's
 * same-element subsumption silently failed (one physical click → Click +
 * Unclassified twin). D1 adds targetIdentity + captureOrigin to every
 * appended entry.
 */
import { describe, it, expect } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import type { ObservedEvent } from '../../src/shared/component-types';

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

function event(id: string, type: string, opts: { name: string; tag: string; css: string; tabId?: number; frameId?: number; seq?: number; ts?: number }): ObservedEvent {
  return {
    eventId: id,
    eventType: type as never,
    timestamp: opts.ts ?? 1000,
    captureSeq: opts.seq ?? 1,
    isTrusted: true,
    target: identity(opts.name, opts.tag, opts.css),
    captureOrigin: opts.tabId !== undefined
      ? { tabId: opts.tabId, frameId: opts.frameId ?? 0 }
      : undefined,
  } as unknown as ObservedEvent;
}

describe('D1 EvidenceLedger', () => {
  it('appends full targetIdentity + captureOrigin on discrete events', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pA-1', 'mousedown', { name: 'Search Replica Bazaar', tag: 'INPUT', css: '#twotabsearchtextbox', tabId: 7, frameId: 0, seq: 1 }));
    const e = ledger.get('evt-pA-1');
    expect(e).toBeDefined();
    expect(e!.targetIdentity).not.toBeNull();
    expect(e!.targetIdentity!.cssSelector).toBe('#twotabsearchtextbox');
    expect(e!.targetIdentity!.tag).toBe('INPUT');
    expect(e!.captureOrigin).toEqual({ tabId: 7, frameId: 0 });
  });

  it('identity copies are shallow copies — later mutation of the source event cannot rewrite history', () => {
    const ledger = new EvidenceLedger();
    const ev = event('evt-pA-1', 'mousedown', { name: 'Go', tag: 'BUTTON', css: '#go-search', tabId: 7, seq: 1 });
    ledger.append(ev);
    ev.target.cssSelector = '#MUTATED';
    const e = ledger.get('evt-pA-1');
    expect(e!.targetIdentity!.cssSelector).toBe('#go-search');
  });

  it('null captureOrigin is stored as null (not undefined)', () => {
    const ledger = new EvidenceLedger();
    ledger.append(event('evt-pA-1', 'mousedown', { name: 'x', tag: 'DIV', css: '.x', seq: 1 }));
    const e = ledger.get('evt-pA-1');
    expect(e!.captureOrigin).toBeNull();
    expect(e!.targetIdentity).not.toBeNull();
  });

  it('restore() normalizes legacy snapshots (no optional fields) to explicit nulls', () => {
    const ledger = new EvidenceLedger();
    const legacy = {
      eventId: 'evt-pOLD-1',
      captureSeq: 1,
      pageId: 'pOLD',
      eventType: 'mousedown',
      timestamp: 500,
      disposition: 'claimed',
      targetTag: 'DIV',
      targetName: 'old',
      targetRole: null,
    };
    ledger.restore([legacy as never]);
    const e = ledger.get('evt-pOLD-1');
    expect(e!.targetIdentity).toBeNull();
    expect(e!.captureOrigin).toBeNull();
    // Terminal disposition preserved through restore.
    expect(e!.disposition).toBe('claimed');
  });

  it('snapshot()/restore() round-trips the new fields', () => {
    const a = new EvidenceLedger();
    a.append(event('evt-pA-1', 'mousedown', { name: 'Go', tag: 'BUTTON', css: '#go-search', tabId: 3, seq: 2, ts: 2000 }));
    a.setDisposition('evt-pA-1', 'claimed', 'lc-1', 'Click');

    const b = new EvidenceLedger();
    b.restore(a.snapshot());
    const e = b.get('evt-pA-1');
    expect(e!.targetIdentity?.cssSelector).toBe('#go-search');
    expect(e!.captureOrigin).toEqual({ tabId: 3, frameId: 0 });
    expect(e!.disposition).toBe('claimed');
  });
});

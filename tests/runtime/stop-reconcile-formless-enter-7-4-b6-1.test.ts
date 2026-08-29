/**
 * Phase 7.4-B6.1 — STOP reconciliation: tier C (network + corroboration)
 *
 * Spec: .drytis/specs/phase-7-4-b6-1-formless-spa-enter-commit.md §4.3, §5.2
 *
 * Tier C rescues an INTERRUPTED form-less Enter TextEntry to 'completed' at
 * STOP only when BOTH:
 *   E-C1 exact network join: a network row with sourceEventId === enterEventId
 *   E-C2 recorded corroboration: viewConfirmation | notificationSurfaceChange
 *        | fieldRemoval — from the interaction's own behavioralEvidence
 *
 * C-1 (ledger immutability): the ledger is NEVER rewritten; projection
 * suppresses twins because the rescued interaction is 'completed' and its
 * member events are covered.
 *
 * TDD: red until reconcileFormlessEnterCommits exists and is wired into
 * stopRecording after flush() and before projectInteractions().
 */

import { describe, it, expect } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { reconcileFormlessEnterCommits } from '../../src/runtime/sw-integration';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
} from '../../src/shared/component-types';
import type { BehavioralEvidence } from '../../src/shared/behavioral-evidence-types';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div',
    xPath: '/html/body/div', inIframe: false, shadowDom: false, href: null,
    inputType: null, elementId: '', ...overrides,
  };
}

const SEARCH_INPUT: Partial<ElementIdentity> = {
  tag: 'INPUT', ariaRole: 'textbox', stableId: 'q', accessibleName: 'Search',
  inputType: 'text', cssSelector: '#q',
};

function ev(id: string, type: string, seq: number, over: Record<string, unknown> = {}): ObservedEvent {
  return makeObservedEvent({
    eventId: id, eventType: type as never, target: makeTarget(SEARCH_INPUT),
    captureSeq: seq, ...over,
  } as never);
}

/** An interrupted, form-less, Enter-terminal TextEntry — the tier C input. */
function interruptedEnterTextEntry(enterEventId = 'evt-x-3'): ComponentInteraction {
  const memberEvents = [
    ev('evt-x-1', 'focus', 1),
    ev('evt-x-2', 'input', 2, { valueAfter: 'wireless earbuds' }),
    ev(enterEventId, 'keydown', 3, { key: 'Enter' }),
  ];
  return {
    interactionId: 'int-1',
    type: 'TextEntry',
    trigger: makeTarget(SEARCH_INPUT),
    triggerEvent: memberEvents[0],
    memberEvents,
    startTime: 1,
    endTime: 3,
    endState: 'interrupted',
    metadata: {
      targetName: 'Search',
      textValue: 'wireless earbuds',
      typedValue: 'wireless earbuds',
      userTyped: true,
    },
  };
}

/** Minimal behavioral evidence with an app-effect of the chosen kind. */
function evidenceWith(
  kind: 'view' | 'notification' | 'fieldRemoval' | 'none',
): BehavioralEvidence {
  return {
    sourceEventId: 'evt-x-3',
    targetEvidence: {
      valueChange: { before: null, after: 'wireless earbuds' },
      stateChanges: [], attributeChanges: [], visibility: null,
    },
    applicationEvidence: {
      domChanges: [],
      domChangeOverflow: 0,
      coarseMode: false,
      newSurfaces: kind === 'notification' ? [{
        path: 'div[role=alert]', tagName: 'DIV', ariaRole: 'alert',
        accessibleName: 'Results updated', shadowContext: null,
        descendantCount: 0, relativeTime: 50, batchIndex: 1,
        change: 'added',
      }] : [],
      removedSurfaces: [],
      visibilityChanges: [],
      navigation: kind === 'view' ? [{
        type: 'pushState', fromUrl: 'https://app.test/', toUrl: 'https://app.test/search?q=x',
        relativeTime: 80, batchIndex: 2,
      }] : [],
      networkActivity: [],
    },
  } as unknown as BehavioralEvidence;
}

/** fieldRemoval corroboration: domChanges summary with removedNodesCount. */
function evidenceWithFieldRemoval(): BehavioralEvidence {
  const base = evidenceWith('none');
  base.applicationEvidence.domChanges = [{
    types: ['childList'],
    targetPath: 'div#q', // the search field's own path — the field left the DOM
    targetTag: 'INPUT',
    shadowContext: null,
    changedAttributes: [],
    attributeDeltas: {},
    addedNodesCount: 0,
    removedNodesCount: 1,
    characterDataDelta: null,
    firstMutationAt: 90,
    lastMutationAt: 95,
    rawMutationCount: 1,
    firstBatchIndex: 1,
    lastBatchIndex: 1,
  }];
  return base;
}

type NetworkRow = { requestId: string; sourceEventId: string; url: string; method: string; status: number | null };

function row(rid: string, sourceEventId: string): NetworkRow {
  return { requestId: rid, sourceEventId, url: 'https://api.app.test/search', method: 'GET', status: 200 };
}

describe('reconcileFormlessEnterCommits — tier C (7.4-B6.1 §4.3)', () => {
  it('T1: stamped request + viewConfirmation → rescued completed, network commit metadata', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('view');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);

    expect(out).toHaveLength(1);
    expect(out[0].endState).toBe('completed');
    expect(out[0].metadata['commitSignal']).toBe('network');
    expect(out[0].metadata['committedValue']).toBe('wireless earbuds');
    expect(out[0].metadata['enterCause']).toBe(true);
    expect(out[0].metadata['corroboration']).toBe('viewConfirmation');
    expect(Array.isArray(out[0].metadata['networkCommitRequestIds'])).toBe(true);
  });

  it('T2: debounce-rider shape — stamped request, NO corroboration → stays interrupted', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('none');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);

    expect(out[0].endState).toBe('interrupted');
    expect(out[0].metadata['commitSignal']).toBeUndefined();
  });

  it('T3: corroboration WITHOUT exact network join → no rescue (E-C1 required)', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('view');
    // Row stamped to a DIFFERENT event — initiation-time rider from earlier typing
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-2')]);

    expect(out[0].endState).toBe('interrupted');
    expect(out[0].metadata['commitSignal']).toBeUndefined();
  });

  it('T4: notificationSurfaceChange corroboration → rescue', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('notification');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);

    expect(out[0].endState).toBe('completed');
    expect(out[0].metadata['corroboration']).toBe('notificationSurfaceChange');
  });

  it('T5: fieldRemoval corroboration → rescue', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWithFieldRemoval();
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);

    expect(out[0].endState).toBe('completed');
    expect(out[0].metadata['corroboration']).toBe('fieldRemoval');
  });

  it('T6: non-TextEntry / completed / already-committed interactions pass through untouched', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('view');
    const alreadyNav = { ...interruptedEnterTextEntry('evt-y-9') };
    alreadyNav.endState = 'completed';
    alreadyNav.metadata = { ...alreadyNav.metadata, commitSignal: 'navigation' };
    const click = { ...te, type: 'Click', endState: 'interrupted' } as unknown as ComponentInteraction;

    const out = reconcileFormlessEnterCommits([alreadyNav, click], [row('r1', 'evt-x-3')]);
    expect(out.find((i) => i.type === 'TextEntry')?.metadata['commitSignal']).toBe('navigation');
    expect(out.find((i) => i.type === 'Click')?.endState).toBe('interrupted');
  });

  it('T7: userTyped=false → no rescue even with full effect evidence', () => {
    const te = interruptedEnterTextEntry();
    te.metadata = { ...te.metadata, userTyped: false };
    te.behavioralEvidence = evidenceWith('view');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    expect(out[0].endState).toBe('interrupted');
  });

  it('T8: has-owner-form interaction is invisible to tier C (B6 preserved)', () => {
    const te = interruptedEnterTextEntry();
    // Give the trigger an owner form via the trigger event's domContext
    te.triggerEvent = makeObservedEvent({
      eventId: 'evt-x-1', eventType: 'focus' as never,
      target: makeTarget(SEARCH_INPUT),
      domContext: { formElementKey: 'id:search-form' } as never,
    } as never);
    te.behavioralEvidence = evidenceWith('view');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    expect(out[0].endState).toBe('interrupted');
  });

  it('T9: P4 violated (input after Enter) → no rescue', () => {
    const te = interruptedEnterTextEntry();
    te.memberEvents = [...te.memberEvents, ev('evt-x-4', 'input', 4, { valueAfter: 'more' })];
    te.behavioralEvidence = evidenceWith('view');
    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    expect(out[0].endState).toBe('interrupted');
  });

  // ── C-1: projection, not ledger rewrite ────────────────────────────

  it('T10 (C-1): ledger dispositions UNCHANGED by rescue; projection suppresses twins', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('view');

    const ledger = new EvidenceLedger();
    for (const m of te.memberEvents) ledger.append(m);
    // Simulate the STOP flush having released the lifecycle's claims
    ledger.getEntries().forEach((e) => {
      (e as { disposition: string }).disposition = 'unclaimed';
    });

    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    expect(out[0].endState).toBe('completed');

    // Ledger untouched — still unclaimed (C-1 immutability)
    for (const e of ledger.getEntries()) {
      expect(e.disposition).toBe('unclaimed');
    }

    // Projection: rescued (completed) interaction covers its member events
    // → NO Unclassified twin for the Enter keydown
    const projection = projectInteractions(ledger, out);
    const enterTwin = projection.interactions.find(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-x-3',
    );
    expect(enterTwin).toBeUndefined();
  });

  it('T10b (C-1 regression guard): no rescue → projection mints the honest twin as today', () => {
    const te = interruptedEnterTextEntry();
    te.behavioralEvidence = evidenceWith('none');

    const ledger = new EvidenceLedger();
    for (const m of te.memberEvents) ledger.append(m);
    ledger.getEntries().forEach((e) => {
      (e as { disposition: string }).disposition = 'unclaimed';
    });

    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    const projection = projectInteractions(ledger, out);
    const enterTwin = projection.interactions.find(
      (i) => i.type === 'Unclassified' && i.triggerEvent?.eventId === 'evt-x-3',
    );
    expect(enterTwin).toBeDefined(); // honest Unclassified survives
  });

  it('T12 (reviewer FAIL-1 regression): real-Chrome stream shape — implicit change AFTER Enter does not defeat tier C', () => {
    // Real Chrome (formless-search/noop E2E) always fires a trusted
    // `change` on the SAME element between the Enter keydown and the app
    // effect. Tier C must use the SAME canonical derivation as tier N
    // (terminalEnterMemberOf, with the change exemption) or it never fires
    // on real streams. This test feeds the exact live shape.
    const te = interruptedEnterTextEntry();
    // Append the browser-implicit change AFTER the Enter — real stream order.
    te.memberEvents = [
      ...te.memberEvents,
      ev('evt-x-4', 'change', 3.5, { valueAfter: 'wireless earbuds' }),
    ];
    te.behavioralEvidence = evidenceWith('view');

    const out = reconcileFormlessEnterCommits([te], [row('r1', 'evt-x-3')]);
    expect(out[0].endState).toBe('completed');
    expect(out[0].metadata['commitSignal']).toBe('network');
    expect(out[0].metadata['networkCommitRequestIds']).toEqual(['r1']);
  });

  it('T13 (spec §8 item 10): rescued interaction passes filterProductionInteractions; unrescued is still dropped', () => {
    // The production filter requires completed + userTyped + non-empty
    // textValue for TextEntry. A rescued (tier C) interaction must SURVIVE
    // it; the same interaction without the effect evidence must NOT.
    const rescued = interruptedEnterTextEntry();
    rescued.behavioralEvidence = evidenceWith('view');
    const afterRescue = reconcileFormlessEnterCommits([rescued], [row('r1', 'evt-x-3')]);

    const unrescued = interruptedEnterTextEntry();
    unrescued.behavioralEvidence = evidenceWith('none');
    const afterNone = reconcileFormlessEnterCommits([unrescued], [row('r1', 'evt-x-3')]);

    const prod = filterProductionInteractions([...afterRescue, ...afterNone]);
    expect(prod).toHaveLength(1);
    expect(prod[0].interactionId).toBe('int-1');
    expect(prod[0].endState).toBe('completed');
  });
});

// Import at module scope (ESM — require is unavailable in vitest ESM mode).
import { filterProductionInteractions } from '../../src/presentation/output-adapter';

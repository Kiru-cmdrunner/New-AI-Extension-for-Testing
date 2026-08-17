/**
 * D6 — Workflow ↔ Signature Linkage
 *
 * Verifies the aggregation seam: per-instance linkage computed from anchor
 * interaction membership (pure observation, no invented semantics), union
 * linkage for the pattern, honest absence when no co-occurring signatures
 * exist, and identity stability (linkage must not disturb patternId).
 */
import { describe, expect, it } from 'vitest';

import {
  aggregateRecordedWorkflows,
  hashPattern,
} from '../../../src/understanding/enrichment/recorded-workflow';
import type {
  RecordedWorkflow,
  SemanticWorkflow,
} from '../../../src/understanding/enrichment/semantic-types';

const EFFECTS = {
  entitiesCreated: [], entitiesModified: [], counterDeltas: [],
  collectionChanges: [], notificationsEmitted: [], viewTransitions: [],
};

function wf(
  sessionId: string,
  index: number,
  stepIds: string[],
  stepIntents: string[],
): SemanticWorkflow {
  return {
    workflowId: `wf-${sessionId}-${index}`,
    sessionId,
    label: 'Checkout flow',
    stepIds,
    stepIntents,
    viewIds: ['search-results', 'product', 'cart'],
    overallOutcome: 'success',
    effects: EFFECTS,
  };
}

const CHECKOUT_STEPS = ['search products', 'navigate', 'add to cart'];

describe('D6 workflow-signature linkage (aggregation)', () => {
  it('two identical sessions link the same signatureIds set; linked; occ=2', () => {
    const s1 = wf('s1', 0, ['i-1', 'i-2', 'i-3'], CHECKOUT_STEPS);
    const s2 = wf('s2', 0, ['j-1', 'j-2', 'j-3'], CHECKOUT_STEPS);
    const sigMap = new Map<string, string>([
      ['i-1', 'app-x:sig:aaa'], ['i-2', 'app-x:sig:bbb'], ['i-3', 'app-x:sig:ccc'],
      ['j-1', 'app-x:sig:aaa'], ['j-2', 'app-x:sig:bbb'], ['j-3', 'app-x:sig:ccc'],
    ]);
    const out = aggregateRecordedWorkflows([s1, s2], [], sigMap);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.occurrenceCount).toBe(2);
    expect(p.patternId).toBe(hashPattern(CHECKOUT_STEPS));
    expect(p.signatureIds).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc']);
    expect(p.linkageState).toBe('linked');
    expect(p.instanceSignatureIds).toEqual({
      'wf-s1-0': ['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc'],
      'wf-s2-0': ['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc'],
    });
    expect(p.sessionIds).toEqual(['s1', 's2']);
  });

  it('no co-occurring signatures → honest absence (empty + linkage-pending)', () => {
    const s1 = wf('s1', 0, ['i-1'], ['search products']);
    const out = aggregateRecordedWorkflows([s1], []);
    expect(out).toHaveLength(1);
    expect(out[0].signatureIds).toEqual([]);
    expect(out[0].linkageState).toBe('linkage-pending');
    expect(out[0].instanceSignatureIds).toEqual({ 'wf-s1-0': [] });
  });

  it('session boundary: session-A signature never links to session-B instance', () => {
    const s1 = wf('s1', 0, ['i-1', 'i-2'], ['search products', 'navigate']);
    const s2 = wf('s2', 0, ['j-1', 'j-2'], ['search products', 'navigate']);
    const sigMap = new Map<string, string>([
      // Only s1's interactions map to signatures.
      ['i-1', 'app-x:sig:aaa'], ['i-2', 'app-x:sig:bbb'],
    ]);
    const out = aggregateRecordedWorkflows([s1, s2], [], sigMap);
    expect(out).toHaveLength(1);
    const p = out[0];
    expect(p.occurrenceCount).toBe(2);
    expect(p.instanceSignatureIds!['wf-s1-0']).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb']);
    expect(p.instanceSignatureIds!['wf-s2-0']).toEqual([]);
    // Pattern-level union stays honest: only signatures observed inside SOME instance.
    expect(p.signatureIds).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb']);
  });

  it('dedup: same signature across both sessions of one pattern appears once', () => {
    const s1 = wf('s1', 0, ['i-1', 'i-2'], CHECKOUT_STEPS.slice(0, 2));
    const s2 = wf('s2', 0, ['j-1', 'j-2'], CHECKOUT_STEPS.slice(0, 2));
    const sigMap = new Map<string, string>([
      ['i-1', 'app-x:sig:aaa'], ['i-2', 'app-x:sig:aaa'],
      ['j-1', 'app-x:sig:aaa'], ['j-2', 'app-x:sig:aaa'],
    ]);
    const out = aggregateRecordedWorkflows([s1, s2], [], sigMap);
    expect(out).toHaveLength(1);
    expect(out[0].signatureIds).toEqual(['app-x:sig:aaa']);
    expect(out[0].instanceSignatureIds!['wf-s1-0']).toEqual(['app-x:sig:aaa']);
  });

  it('identity stability: linkage fields do not change patternId', () => {
    const s1 = wf('s1', 0, ['i-1'], ['search products']);
    const bare = aggregateRecordedWorkflows([s1], [])[0];
    const linked = aggregateRecordedWorkflows(
      [s1], [], new Map([['i-1', 'app-x:sig:aaa']]),
    )[0];
    expect(linked.patternId).toBe(bare.patternId);
    expect(linked.patternId).toBe(hashPattern(['search products']));
    // canonicalSteps untouched by linkage.
    expect(linked.canonicalSteps).toEqual(bare.canonicalSteps);
  });

  it('prior with linkage merges: union signatureIds, per-instance map preserved', () => {
    const prior: RecordedWorkflow = {
      patternId: hashPattern(CHECKOUT_STEPS),
      label: 'Checkout flow',
      canonicalSteps: [...CHECKOUT_STEPS],
      viewSequence: ['search-results', 'product', 'cart'],
      sessionIds: ['s0'],
      occurrenceCount: 1,
      instances: ['wf-s0-0'],
      signatureIds: ['app-x:sig:old'],
      linkageState: 'linked',
      instanceSignatureIds: { 'wf-s0-0': ['app-x:sig:old'] },
    };
    const s1 = wf('s1', 0, ['i-1', 'i-2', 'i-3'], CHECKOUT_STEPS);
    const out = aggregateRecordedWorkflows([s1], [prior], new Map([
      ['i-1', 'app-x:sig:aaa'], ['i-2', 'app-x:sig:bbb'], ['i-3', 'app-x:sig:ccc'],
    ]));
    const p = out.find((x) => x.label === 'Checkout flow')!;
    expect(p.occurrenceCount).toBe(2);
    expect(p.signatureIds).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc', 'app-x:sig:old']);
    expect(p.linkageState).toBe('linked');
    expect(p.instanceSignatureIds!['wf-s0-0']).toEqual(['app-x:sig:old']);
    expect(p.instanceSignatureIds!['wf-s1-0']).toEqual(['app-x:sig:aaa', 'app-x:sig:bbb', 'app-x:sig:ccc']);
  });

  it('prior WITHOUT linkage fields (pre-D6 row) converges, nothing fabricated', () => {
    const prior = {
      patternId: hashPattern(CHECKOUT_STEPS),
      label: 'Checkout flow',
      canonicalSteps: [...CHECKOUT_STEPS],
      viewSequence: ['search-results', 'product', 'cart'],
      sessionIds: ['s0'],
      occurrenceCount: 1,
      instances: ['wf-s0-0'],
    } as RecordedWorkflow; // pre-D6 literal: no signatureIds/linkageState.
    const s1 = wf('s1', 0, ['i-1', 'i-2', 'i-3'], CHECKOUT_STEPS);
    const out = aggregateRecordedWorkflows([s1], [prior], new Map([
      ['i-1', 'app-x:sig:aaa'],
    ]));
    const p = out.find((x) => x.label === 'Checkout flow')!;
    expect(p.occurrenceCount).toBe(2);
    expect(p.signatureIds).toEqual(['app-x:sig:aaa']);
    expect(p.instanceSignatureIds!['wf-s0-0']).toEqual([]);
    expect(p.instanceSignatureIds!['wf-s1-0']).toEqual(['app-x:sig:aaa']);
    expect(p.linkageState).toBe('linked');
  });
});

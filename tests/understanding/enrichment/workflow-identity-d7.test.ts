/**
 * D7 — workflow identity canonicalization.
 *
 * Verifies that heartbeat/background API noise, literal label differences
 * and absolute-URL forms do not split one physical workflow into distinct
 * patternIds, while genuinely different workflows stay distinct.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalizeSteps,
  hashPattern,
  aggregateRecordedWorkflows,
  getRecurringPatterns,
} from '../../../src/understanding/enrichment/recorded-workflow';
import type { SemanticWorkflow, RecordedWorkflow } from '../../../src/understanding/enrichment/semantic-types';

function wf(sessionId: string, steps: string[], workflowId = `wf-${sessionId}-0`): SemanticWorkflow {
  return {
    workflowId,
    sessionId,
    label: steps[0] ?? 'Workflow',
    stepIds: steps.map((_, i) => `int-${i + 1}`),
    stepIntents: steps,
    viewIds: ['search-results'],
    overallOutcome: 'success',
    effects: {
      entitiesCreated: [],
      entitiesUpdated: [],
      entitiesRemoved: [],
      viewsVisited: [],
      countersChanged: [],
      collectionsChanged: [],
      notifications: [],
    },
  } as unknown as SemanticWorkflow;
}

function prior(patternId: string, steps: string[], sessions: string[]): RecordedWorkflow {
  return {
    patternId,
    label: 'Search products',
    canonicalSteps: steps,
    viewSequence: ['search-results'],
    sessionIds: sessions,
    occurrenceCount: sessions.length,
    instances: sessions.map((s) => `wf-${s}-0`),
  } as unknown as RecordedWorkflow;
}

describe('D7 canonicalizeSteps', () => {
  it('drops ambient API-operation labels (heartbeat/polling noise)', () => {
    const withNoise = ['Search products', 'Fetch data', 'Go', 'Submit form', '/product.html?id=P100', 'Add to cart'];
    const clean = ['Search products', 'Go', '/product.html?id=P100', 'Add to cart'];
    expect(canonicalizeSteps(withNoise)).toEqual(canonicalizeSteps(clean));
    expect(canonicalizeSteps(withNoise)).not.toContain('Fetch data');
  });

  it('normalizes case and whitespace in literal labels', () => {
    expect(canonicalizeSteps(['Search   Products', 'go'])).toEqual(
      canonicalizeSteps(['search products', 'Go']),
    );
  });

  it('collapses exact consecutive duplicates', () => {
    expect(canonicalizeSteps(['Search products', 'search products', 'Go'])).toEqual(
      canonicalizeSteps(['Search products', 'Go']),
    );
  });

  it('normalizes absolute URLs to path+query (strips scheme/host/port)', () => {
    const a = canonicalizeSteps(['http://127.0.0.1:8098/product.html?id=P100']);
    const b = canonicalizeSteps(['https://www.example.com/product.html?id=P100']);
    expect(a).toEqual(b);
    expect(a[0]).toBe('/product.html?id=p100');
  });

  it('keeps genuinely different query strings distinct', () => {
    expect(canonicalizeSteps(['/product.html?id=P100'])).not.toEqual(
      canonicalizeSteps(['/product.html?id=P200']),
    );
  });

  it('drops empty/whitespace-only tokens', () => {
    expect(canonicalizeSteps(['Go', '   ', ''])).toEqual(['go']);
  });
});

describe('D7 hashPattern', () => {
  it('identical canonical form → identical patternId', () => {
    const s1 = ['Search products', 'Fetch data', 'Go', '/product.html?id=P100', 'Add to cart'];
    const s2 = ['Search products', 'Go', 'Submit form', 'http://anywhere.example/product.html?id=P100', 'Add to cart'];
    expect(hashPattern(s1)).toBe(hashPattern(s2));
  });

  it('different workflows → different patternId', () => {
    const searchOnly = ['Search products', 'Go'];
    const full = ['Search products', 'Go', '/product.html?id=P100', 'Add to cart'];
    expect(hashPattern(searchOnly)).not.toBe(hashPattern(full));
  });
});

describe('D7 aggregateRecordedWorkflows', () => {
  it('two identical sessions (one with heartbeat noise) consolidate to occ=2', () => {
    const s1 = wf('session-1', ['Search products', 'Fetch data', 'Go', 'Submit form', '/product.html?id=P100', 'Add to cart']);
    const s2 = wf('session-2', ['Search products', 'Go', '/product.html?id=P100', 'Add to cart']);
    const out = aggregateRecordedWorkflows([s1, s2], []);
    expect(out).toHaveLength(1);
    expect(out[0].occurrenceCount).toBe(2);
    expect(out[0].sessionIds).toEqual(['session-1', 'session-2']);
  });

  it('a genuinely different workflow stays its own pattern at occ=1', () => {
    const full = wf('session-1', ['Search products', 'Go', '/product.html?id=P100', 'Add to cart']);
    const searchOnly = wf('session-2', ['Search products', 'Go']);
    const out = aggregateRecordedWorkflows([full, searchOnly], []);
    expect(out).toHaveLength(2);
    expect(out.every((w) => w.occurrenceCount === 1)).toBe(true);
  });

  it('seeds colliding priors merge instead of splitting (D7.3)', () => {
    // Two legacy priors whose OLD ids differ but whose canonical steps
    // collide under the new rules.
    const p1 = prior('wf-pattern-legacyA', ['Search products', 'Fetch data', 'Go'], ['session-1']);
    const p2 = prior('wf-pattern-legacyB', ['Search products', 'Go'], ['session-2']);
    const newWf = wf('session-3', ['Search products', 'Go']);
    const out = aggregateRecordedWorkflows([newWf], [p1, p2]);
    expect(out).toHaveLength(1);
    expect(out[0].occurrenceCount).toBe(3);
    expect(out[0].sessionIds.sort()).toEqual(['session-1', 'session-2', 'session-3']);
  });

  it('persists canonicalSteps (not raw) on new patterns', () => {
    const s1 = wf('session-1', ['Search products', 'Fetch data', 'Go']);
    const out = aggregateRecordedWorkflows([s1], []);
    expect(out[0].canonicalSteps).toEqual(['search products', 'go']);
  });

  it('getRecurringPatterns keeps only occ>=2', () => {
    const s1 = wf('session-1', ['Search products', 'Go']);
    const s2 = wf('session-2', ['Search products', 'Go']);
    const s3 = wf('session-3', ['Search products', 'Go', '/product.html?id=P100']);
    const out = aggregateRecordedWorkflows([s1, s2, s3], []);
    expect(getRecurringPatterns(out)).toHaveLength(1);
    expect(getRecurringPatterns(out)[0].occurrenceCount).toBe(2);
  });
});

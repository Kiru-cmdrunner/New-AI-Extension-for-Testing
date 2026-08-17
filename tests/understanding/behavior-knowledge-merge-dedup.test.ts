import { describe, expect, it } from 'vitest';

import { mergeConsequenceProfile } from '../../src/understanding/persistence/behavior-knowledge-merge';
import type { SignatureConsequenceInput } from '../../src/understanding/persistence/behavior-knowledge-merge';

const s1 = 'session-a';
const s2 = 'session-b';

function consIn(identity: string, edgeKey: string): SignatureConsequenceInput {
  return {
    identity,
    tier: 'T1-stamp',
    kind: 'entity',
    targetIdentity: 'cart-item:create',
    edgeKey,
    observedVia: 'behavior/entity-derivation',
  };
}

describe('mergeConsequenceProfile — same-identity dedup (F2 regression)', () => {
  it('duplicate same-identity consequences within ONE session produce ONE profile entry', () => {
    // CP5-accepted D1 duplicate entity edges map to one identity; pre-F2
    // this inserted two parallel entries with identical identity.
    const out = mergeConsequenceProfile(
      [],
      [consIn('T1-stamp|entity|cart-item:create', 'edge-a'), consIn('T1-stamp|entity|cart-item:create', 'edge-b')],
      s1,
      1,
      true,
    );

    expect(out).toHaveLength(1);
    expect(out[0].identity).toBe('T1-stamp|entity|cart-item:create');
    // One SESSION/fold observed the consequence → hitCount=1 and
    // occurrenceCount=1: intra-fold duplicates collapse to one observation
    // (F2). occurrenceCount counts fold observations, never raw duplicate
    // inputs — pre-F2 these duplicates inserted TWO occ=1 entries.
    expect(out[0].hitCount).toBe(1);
    expect(out[0].occurrenceCount).toBe(1);
    expect(out[0].evidenceSamples).toHaveLength(1);
    expect(out[0].evidenceSamples[0].edgeKey).toBe('edge-a'); // first observation wins, deterministic
  });

  it('repeated sessions increment the correct counters, never duplicating the consequence', () => {
    let profile = mergeConsequenceProfile([], [consIn('T1-stamp|entity|cart-item:create', 'edge-a')], s1, 1, true);

    profile = mergeConsequenceProfile(profile, [consIn('T1-stamp|entity|cart-item:create', 'edge-c')], s2, 2, true);
    expect(profile).toHaveLength(1);
    expect(profile[0].hitCount).toBe(2);
    expect(profile[0].occurrenceCount).toBe(2);
    expect(profile[0].evidenceSamples.map((e) => e.sessionId)).toEqual([s1, s2]);

    // Same-session duplicate observation (boundary=false, later episode of
    // session 2): folds by observation, never inserts, never re-bumps
    // hitCount for the same session (session guard).
    profile = mergeConsequenceProfile(profile, [consIn('T1-stamp|entity|cart-item:create', 'edge-d')], s2, 2, false);
    expect(profile).toHaveLength(1);
    expect(profile[0].hitCount).toBe(2);
    expect(profile[0].occurrenceCount).toBe(3);
    expect(profile[0].evidenceSamples.map((e) => e.sessionId)).toEqual([s1, s2]);
  });

  it('existing distinct consequences remain unaffected', () => {
    const base = mergeConsequenceProfile(
      [],
      [consIn('T1-stamp|api|POST /cart/add', 'edge-x'), consIn('T1-stamp|entity|cart-item:create', 'edge-y')],
      s1,
      1,
      true,
    );
    expect(base).toHaveLength(2);

    const out = mergeConsequenceProfile(
      base,
      [
        consIn('T1-stamp|api|POST /cart/add', 'edge-x2'),
        consIn('T1-stamp|entity|cart-item:create', 'edge-y2'),
        consIn('T1-stamp|entity|cart-item:create', 'edge-y3'),
      ],
      s2,
      2,
      true,
    );

    expect(out).toHaveLength(2);
    const api = out.find((c) => c.identity === 'T1-stamp|api|POST /cart/add');
    expect(api?.hitCount).toBe(2);
    expect(api?.occurrenceCount).toBe(2);
    expect(api?.evidenceSamples.map((e) => e.sessionId)).toEqual([s1, s2]);

    const entity = out.filter((c) => c.identity === 'T1-stamp|entity|cart-item:create');
    expect(entity).toHaveLength(1);
    expect(entity[0].hitCount).toBe(2);
    expect(entity[0].occurrenceCount).toBe(2); // one fold in s1 + ONE collapsed fold in s2 (dupes = one observation)
  });
});

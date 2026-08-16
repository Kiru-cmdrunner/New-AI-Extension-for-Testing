/**
 * CP1 unit tests — evidence-refs.ts
 *
 * Pure-function behavior: canonical keys, degradation canonicalization,
 * factories (validation + normalization), summaries, and the ref registry
 * that mechanically enforces the model's uniqueness law.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalDegradations,
  createRefRegistry,
  DEGRADATION_ORDER,
  evidenceRefKey,
  hasDegradation,
  mergeDegradations,
  ref,
  refSummary,
} from '../../../src/understanding/behavior-model/evidence-refs';
import type { EvidenceRef } from '../../../src/understanding/behavior-model/model-types';

// ── canonical key ───────────────────────────────────────────────────────

describe('evidenceRefKey', () => {
  it('keys request refs by requestId alone', () => {
    expect(evidenceRefKey({ kind: 'request', requestId: 'req-9001' })).toBe(
      'request:req-9001',
    );
  });

  it('keys event refs by eventId alone', () => {
    expect(evidenceRefKey({ kind: 'event', eventId: 'ev-123' })).toBe('event:ev-123');
  });

  it('keys transition refs by transitionId alone', () => {
    expect(evidenceRefKey({ kind: 'transition', transitionId: 'st-4471' })).toBe(
      'transition:st-4471',
    );
  });

  it('keys entity refs by entityId AND interactionId (pair identity)', () => {
    const a = evidenceRefKey({
      kind: 'entity',
      entityId: 'cart-item:B0FFF9VPMN',
      interactionId: 'int-19',
    });
    const b = evidenceRefKey({
      kind: 'entity',
      entityId: 'cart-item:B0FFF9VPMN',
      interactionId: 'int-20',
    });
    expect(a).toBe('entity:cart-item:B0FFF9VPMN@int-19');
    expect(b).toBe('entity:cart-item:B0FFF9VPMN@int-20');
    expect(a).not.toBe(b); // same entity id, different interaction → different artifact
  });

  it('keys dom refs by windowId#sequence', () => {
    expect(evidenceRefKey({ kind: 'dom', windowId: 'ev-nav-1', sequence: 0 })).toBe(
      'dom:ev-nav-1#0',
    );
    expect(evidenceRefKey({ kind: 'dom', windowId: 'ev-nav-1', sequence: 12 })).toBe(
      'dom:ev-nav-1#12',
    );
    // Different windows, same sequence → different artifacts.
    expect(evidenceRefKey({ kind: 'dom', windowId: 'ev-a', sequence: 0 })).not.toBe(
      evidenceRefKey({ kind: 'dom', windowId: 'ev-b', sequence: 0 }),
    );
  });

  it('keys nav refs by navEventId alone', () => {
    expect(evidenceRefKey({ kind: 'nav', navEventId: 'nav-77' })).toBe('nav:nav-77');
  });

  it('is stable across degradation variants of the same artifact', () => {
    const plain: EvidenceRef = { kind: 'request', requestId: 'req-9001' };
    const degraded: EvidenceRef = {
      kind: 'request',
      requestId: 'req-9001',
      degradation: ['body-less-row'],
    };
    expect(evidenceRefKey(plain)).toBe(evidenceRefKey(degraded));
  });
});

// ── degradation canonicalization ────────────────────────────────────────

describe('degradations', () => {
  it('DEGRADATION_ORDER lists all six flags in canonical order', () => {
    expect(DEGRADATION_ORDER).toEqual([
      'body-less-row',
      'synthesized-evidence',
      'capped-window',
      'missing-window',
      'malformed-trigger',
      'tail-capped',
    ]);
  });

  it('canonicalDegradations sorts out-of-order input', () => {
    expect(canonicalDegradations(['tail-capped', 'body-less-row', 'capped-window'])).toEqual([
      'body-less-row',
      'capped-window',
      'tail-capped',
    ]);
  });

  it('canonicalDegradations deduplicates', () => {
    expect(canonicalDegradations(['capped-window', 'capped-window'])).toEqual([
      'capped-window',
    ]);
  });

  it('canonicalDegradations returns [] for empty/undefined/null', () => {
    expect(canonicalDegradations([])).toEqual([]);
    expect(canonicalDegradations(undefined)).toEqual([]);
    expect(canonicalDegradations(null)).toEqual([]);
  });

  it('mergeDegradations unions multiple lists in canonical order', () => {
    expect(
      mergeDegradations(['tail-capped'], ['body-less-row', 'capped-window'], undefined),
    ).toEqual(['body-less-row', 'capped-window', 'tail-capped']);
  });

  it('hasDegradation is membership-only and null-safe', () => {
    const flags: EvidenceRef['degradation'] = ['body-less-row'];
    expect(hasDegradation(flags, 'body-less-row')).toBe(true);
    expect(hasDegradation(flags, 'tail-capped')).toBe(false);
    expect(hasDegradation(undefined, 'tail-capped')).toBe(false);
    expect(hasDegradation(null, 'tail-capped')).toBe(false);
  });
});

// ── factories ───────────────────────────────────────────────────────────

describe('ref factories', () => {
  it('build each kind with kind + identity fields', () => {
    expect(ref.request('req-1')).toEqual({ kind: 'request', requestId: 'req-1', degradation: undefined });
    expect(ref.event('ev-1')).toEqual({ kind: 'event', eventId: 'ev-1', degradation: undefined });
    expect(ref.transition('st-1')).toEqual({ kind: 'transition', transitionId: 'st-1', degradation: undefined });
    expect(ref.entity('cart-item:X', 'int-19')).toEqual({
      kind: 'entity',
      entityId: 'cart-item:X',
      interactionId: 'int-19',
      degradation: undefined,
    });
    expect(ref.dom('ev-w', 3)).toEqual({ kind: 'dom', windowId: 'ev-w', sequence: 3, degradation: undefined });
    expect(ref.nav('nav-1')).toEqual({ kind: 'nav', navEventId: 'nav-1', degradation: undefined });
  });

  it('normalize degradation lists (sorted, deduped) and drop [] → undefined', () => {
    expect(ref.request('req-1', ['tail-capped', 'body-less-row'])).toEqual({
      kind: 'request',
      requestId: 'req-1',
      degradation: ['body-less-row', 'tail-capped'],
    });
    expect(ref.event('ev-1', []).degradation).toBeUndefined();
  });

  it('reject empty identity strings on every factory', () => {
    expect(() => ref.request('')).toThrow();
    expect(() => ref.event('')).toThrow();
    expect(() => ref.transition('')).toThrow();
    expect(() => ref.entity('', 'int-1')).toThrow();
    expect(() => ref.entity('cart-item:X', '')).toThrow();
    expect(() => ref.dom('', 0)).toThrow();
    expect(() => ref.nav('')).toThrow();
  });

  it('reject non-string and non-integer identities', () => {
    expect(() => ref.request(undefined as unknown as string)).toThrow();
    expect(() => ref.dom('ev-w', 1.5)).toThrow();
    expect(() => ref.dom('ev-w', -1)).toThrow();
  });

  it('produced refs are usable by evidenceRefKey (round-trip)', () => {
    expect(evidenceRefKey(ref.request('req-9001'))).toBe('request:req-9001');
    expect(evidenceRefKey(ref.dom('ev-nav-1', 4))).toBe('dom:ev-nav-1#4');
    expect(evidenceRefKey(ref.entity('cart-item:B0', 'int-19'))).toBe(
      'entity:cart-item:B0@int-19',
    );
  });
});

// ── summary ─────────────────────────────────────────────────────────────

describe('refSummary', () => {
  it('is the canonical key when no degradations', () => {
    expect(refSummary(ref.nav('nav-77'))).toBe('nav:nav-77');
  });

  it('appends canonically-ordered degradation flags', () => {
    const r = ref.request('req-9001', ['tail-capped', 'body-less-row']);
    expect(refSummary(r)).toBe('request:req-9001 [body-less-row,tail-capped]');
  });
});

// ── ref registry — the uniqueness law ───────────────────────────────────

describe('createRefRegistry', () => {
  it('first tryClaim wins, second fails', () => {
    const registry = createRefRegistry();
    const artifact = ref.request('req-9001');
    expect(registry.tryClaim(artifact, 'edge-ep-int-19-0')).toBe(true);
    expect(registry.tryClaim(artifact, 'edge-ep-int-20-0')).toBe(false);
  });

  it('treats degraded and plain variants of the same artifact as ONE key', () => {
    const registry = createRefRegistry();
    expect(
      registry.tryClaim(ref.request('req-9001', ['body-less-row']), 'edge-a'),
    ).toBe(true);
    // Same artifact claimed plainly by another episode — must fail.
    expect(registry.tryClaim(ref.request('req-9001'), 'edge-b')).toBe(false);
  });

  it('ownerOf returns the winning edge id and null for unclaimed', () => {
    const registry = createRefRegistry();
    expect(registry.ownerOf(ref.event('ev-9'))).toBeNull();
    registry.tryClaim(ref.event('ev-9'), 'edge-x');
    expect(registry.ownerOf(ref.event('ev-9'))).toBe('edge-x');
  });

  it('claimedKeys is lexicographically sorted and deterministic', () => {
    const registry = createRefRegistry();
    registry.tryClaim(ref.nav('nav-9'), 'edge-1');
    registry.tryClaim(ref.request('req-1'), 'edge-2');
    registry.tryClaim(ref.event('ev-5'), 'edge-3');
    expect(registry.claimedKeys()).toEqual([
      'event:ev-5',
      'nav:nav-9',
      'request:req-1',
    ]);
    expect(registry.size).toBe(3);
  });

  it('distinct entity artifacts from different interactions claim independently', () => {
    const registry = createRefRegistry();
    expect(registry.tryClaim(ref.entity('cart-item:B0', 'int-19'), 'edge-1')).toBe(true);
    expect(registry.tryClaim(ref.entity('cart-item:B0', 'int-21'), 'edge-2')).toBe(true);
    expect(registry.size).toBe(2);
  });

  it('rejects empty ownerEdgeId', () => {
    const registry = createRefRegistry();
    expect(() => registry.tryClaim(ref.request('req-1'), '')).toThrow();
  });

  it('enforces the Amazon shape: one cart entity cannot be owned by two episodes', () => {
    const registry = createRefRegistry();
    // T1 entity edge from the Add-to-cart episode claims the artifact first.
    const claim1 = registry.tryClaim(
      ref.entity('cart-item:B0FFF9VPMN', 'int-19'),
      'edge-ep-int-19-1',
    );
    // A later Navigation-episode edge citing the SAME artifact must fail.
    const claim2 = registry.tryClaim(
      ref.entity('cart-item:B0FFF9VPMN', 'int-19'),
      'edge-ep-int-20-0',
    );
    expect(claim1).toBe(true);
    expect(claim2).toBe(false);
    expect(registry.ownerOf(ref.entity('cart-item:B0FFF9VPMN', 'int-19'))).toBe(
      'edge-ep-int-19-1',
    );
  });
});

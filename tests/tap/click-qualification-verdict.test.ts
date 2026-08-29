/**
 * Capture-Time Click Qualification v1.2 — Step 1 (inert) — TDD-1
 *
 * Pure verdict function: table-driven tests over EVERY §4.2 boundary row,
 * including the amended edges (R-2 disabledNative tag restriction, R-3
 * fieldsetDisabled form-control restriction + first-legend exemption,
 * R-4 pointerEventsNone joint gate, R-5 zeroSizeLifted demotion).
 *
 * Spec: .drytis/specs/click-capture-qualification-v1.md §4.1, §4.2
 *
 * These tests exercise qualifyClick() as a PURE function over a
 * ClickQualificationFacts vector — no DOM, no probe. Per-fact capture
 * tests (TDD-2) live in click-qualification-capture tests; this file
 * pins the decision boundary itself.
 */

import { describe, it, expect } from 'vitest';
import {
  qualifyClick,
  type ClickQualificationFacts,
} from '../../src/tap/click-qualification';

/** Neutral baseline: a plain enabled semantic element hit directly. */
function base(over: Partial<ClickQualificationFacts>): ClickQualificationFacts {
  return {
    // invalidity facts — all absent
    disabledNative: false,
    disabledAttrNonNative: false,
    fieldsetDisabled: false,
    ariaDisabled: false,
    inertSubtree: false,
    pointerEventsNone: false,
    zeroSizeLifted: false,
    hitTest: { checked: false, miss: null },
    // hit-target structure
    hitTarget: {
      kind: 'element',
      rawTag: 'BUTTON',
      lifted: false,
      liftStrategy: 'raw',
      rawInteractiveShaped: true,
    },
    ...over,
  };
}

describe('qualifyClick — pure provable-invalidity boundary (§4.2)', () => {
  // ── Independent causes (8) ─────────────────────────────────────────

  it.each([
    ['disabled-native', { disabledNative: true }],
    ['fieldset-disabled', { fieldsetDisabled: true }],
    ['inert-subtree', { inertSubtree: true }],
    ['hit-test-miss', { hitTest: { checked: true, miss: true } }],
    ['aria-disabled', { ariaDisabled: true }],
    ['disabled-attr-non-native', { disabledAttrNonNative: true }],
  ])('cause %s fires alone → provably-invalid with exactly that cause', (cause, over) => {
    const q = qualifyClick(base(over as Partial<ClickQualificationFacts>));
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual([cause]);
    expect(q.insufficient).toBe(false);
  });

  it('pointer-events-none fires ONLY jointly with hit-test-miss (R-4) — standalone is a recorded fact, not a cause', () => {
    // Standalone: qualified, marker recorded (fact present on input), no cause
    const standalone = qualifyClick(base({ pointerEventsNone: true }));
    expect(standalone.verdict).toBe('qualified');
    expect(standalone.causes).toEqual([]);
    // Joint: miss=true + lifted → both hit-test-miss AND pointer-events-none
    const joint = qualifyClick(base({
      pointerEventsNone: true,
      hitTarget: { kind: 'element', rawTag: 'SPAN', lifted: true, liftStrategy: 'parent', rawInteractiveShaped: false },
      hitTest: { checked: true, miss: true },
    }));
    expect(joint.verdict).toBe('provably-invalid');
    expect(joint.causes).toEqual(['hit-test-miss', 'pointer-events-none']);
  });

  it('pointer-events-none joint gate requires lifted (R-4): PE-none + miss on a NON-lifted target does not add the PE cause', () => {
    const q = qualifyClick(base({
      pointerEventsNone: true,
      hitTarget: { kind: 'element', rawTag: 'BUTTON', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: true },
      hitTest: { checked: true, miss: true },
    }));
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['hit-test-miss']);
  });

  it('zero-size-lifted is NEVER a standalone cause (R-5) — qualified + insufficient marker', () => {
    const q = qualifyClick(base({
      zeroSizeLifted: true,
      hitTarget: { kind: 'element', rawTag: 'SPAN', lifted: true, liftStrategy: 'parent', rawInteractiveShaped: true },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    expect(q.insufficient).toBe(true);
  });

  it('zero-size-lifted joins hit-test-miss as an auxiliary cause (R-5)', () => {
    const q = qualifyClick(base({
      zeroSizeLifted: true,
      hitTarget: { kind: 'element', rawTag: 'SPAN', lifted: true, liftStrategy: 'parent', rawInteractiveShaped: false },
      hitTest: { checked: true, miss: true },
    }));
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['hit-test-miss', 'zero-size-lifted']);
  });

  // ── Guard rows (R-2/R-3/R-4/R-5 edge pins) ────────────────────────

  it('R-4 guard: parent PE-none + child PE-auto + miss=false ⇒ QUALIFIED (legitimate hit child lifted to a none parent)', () => {
    const q = qualifyClick(base({
      pointerEventsNone: true,
      hitTarget: { kind: 'element', rawTag: 'SPAN', lifted: true, liftStrategy: 'path', rawInteractiveShaped: false },
      hitTest: { checked: true, miss: false },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    // lifted && !rawInteractiveShaped ⇒ insufficient marker
    expect(q.insufficient).toBe(true);
  });

  it('R-5 guard: zero-area ancestor with positioned hittable child, miss=false ⇒ QUALIFIED + insufficient', () => {
    const q = qualifyClick(base({
      zeroSizeLifted: true,
      hitTarget: { kind: 'element', rawTag: 'BUTTON', lifted: true, liftStrategy: 'parent', rawInteractiveShaped: true },
      hitTest: { checked: true, miss: false },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    expect(q.insufficient).toBe(true);
  });

  // ── Qualified population ──────────────────────────────────────────

  it('plain div, no lift, no invalidity facts ⇒ qualified (the flip population — today Unclassified)', () => {
    const q = qualifyClick(base({
      hitTarget: { kind: 'element', rawTag: 'DIV', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: false },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    expect(q.insufficient).toBe(false);
  });

  it('BODY/HTML canvas click ⇒ qualified + insufficient=canvas (B3 S4 click-away preserved)', () => {
    const q = qualifyClick(base({
      hitTarget: { kind: 'canvas', rawTag: 'BODY', lifted: false, liftStrategy: 'raw', rawInteractiveShaped: false },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    expect(q.insufficient).toBe(true);
  });

  it('plain leaf lifted to plain ancestor ⇒ qualified + insufficient=lifted-unshaped', () => {
    const q = qualifyClick(base({
      hitTarget: { kind: 'element', rawTag: 'SPAN', lifted: true, liftStrategy: 'parent', rawInteractiveShaped: false },
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
    expect(q.insufficient).toBe(true);
  });

  it('all probes inconclusive (miss=null, checked=false) ⇒ qualified — never fabricate exclusion', () => {
    const q = qualifyClick(base({
      hitTest: { checked: true, miss: null },
      pointerEventsNone: false,
      zeroSizeLifted: false,
    }));
    expect(q.verdict).toBe('qualified');
    expect(q.causes).toEqual([]);
  });

  // ── Disabled button edge the old gates let through ────────────────

  it('disabled native button with cursor:pointer (gate-4 claim today) ⇒ provably-invalid disabled-native', () => {
    const q = qualifyClick(base({ disabledNative: true }));
    expect(q.verdict).toBe('provably-invalid');
    expect(q.causes).toEqual(['disabled-native']);
  });

  // ── Purity ────────────────────────────────────────────────────────

  it('pure: input facts are never mutated (frozen at capture)', () => {
    const facts = base({ disabledNative: true });
    const snapshot = JSON.stringify(facts);
    qualifyClick(facts);
    qualifyClick(facts);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });

  it('deterministic: identical inputs → identical verdict across calls', () => {
    const facts = base({
      ariaDisabled: true,
      hitTest: { checked: true, miss: true },
    });
    const a = qualifyClick(facts);
    const b = qualifyClick(facts);
    expect(a).toEqual(b);
    // aria-disabled + hit-test-miss both fire
    expect(a.causes).toEqual(['hit-test-miss', 'aria-disabled']);
  });
});

/**
 * B7-P2 §5.2.3 — gated discovery enter stamps SECONDARY create-only.
 *
 * R-4: the gate is computed at the DISPATCHER call site from the payload's
 * target fields via isInteractiveElement — ungated mouseenters never stamp.
 * R14 guard: a hover enter stamp can NEVER overwrite a click/Enter primary.
 */

import { describe, it, expect } from 'vitest';
import { stampClass, stampEligible } from '../../../src/background/network-observation';

describe('B7-P2: stampClass — gated enter as secondary create-only', () => {
  it('mouseenter classified via the explicit gated-enter path when the payload proves interactivity', () => {
    // The dispatcher computes the gate; the classifier gains a marker.
    // 'mouseenter' + gated:true → 'secondary'; bare 'mouseenter' → 'ineligible'.
    expect(stampClass('mouseenter', null, true)).toBe('secondary');
    expect(stampClass('mouseenter', null, false)).toBe('ineligible');
    expect(stampClass('mouseenter', null)).toBe('ineligible');
  });

  it('mouseleave/mousemove remain ineligible in every form', () => {
    expect(stampClass('mouseleave', null, true)).toBe('ineligible');
    expect(stampClass('mousemove', null, true)).toBe('ineligible');
    expect(stampEligible('mousemove', null)).toBe(false);
  });

  it('existing primary/secondary classes unchanged (submit still secondary create-only)', () => {
    expect(stampClass('click')).toBe('primary');
    expect(stampClass('contextmenu')).toBe('primary');
    expect(stampClass('change')).toBe('primary');
    expect(stampClass('drop')).toBe('primary');
    expect(stampClass('keydown', 'Enter')).toBe('primary');
    expect(stampClass('keydown', 'a')).toBe('ineligible');
    expect(stampClass('submit')).toBe('secondary');
    expect(stampClass('focus')).toBe('ineligible');
  });
});

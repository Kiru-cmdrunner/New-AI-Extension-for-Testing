/**
 * 6F-M3 Wave 1 — O12 no-owner recovered-evidence label
 *
 * Spec: .drytis/specs/phase-6f-m3-w1-display-honesty.md §3 (AC1–AC4)
 *
 * Sw-recovered windows with NO resolved owner keep null identity by
 * constraint (RC7). The panel must explain WHY "Unknown element" is honest
 * on that path — one synthetic-notice line — while staying silent when the
 * 6F-M2b identity seed already tells the truth.
 */
import { describe, it, expect } from 'vitest';
import type { BehavioralEvidence } from '../../../src/shared/behavioral-evidence-types';
import { renderEvidence } from '../../../src/sidepanel/evidence-renderer';

const NOTICE_FRAGMENT = 'recovered after page unload';

function evidence(endReason: string, identity: unknown): BehavioralEvidence {
  return {
    window: { endReason: endReason as never, durationMs: 0 },
    targetEvidence: { identity: identity as never, before: null, after: null },
    applicationEvidence: {
      domChanges: [],
      newSurfaces: [],
      removedSurfaces: [],
      visibilityChanges: [],
    },
  } as unknown as BehavioralEvidence;
}

const SEEDED_IDENTITY = {
  accessibleName: 'Add to cart',
  tag: 'BUTTON',
  ariaRole: 'button',
  stableId: 'add-to-cart-button',
};

function render(ev: BehavioralEvidence): HTMLElement {
  const c = document.createElement('div');
  renderEvidence(c, ev);
  return c;
}

describe('6F-M3 O12 — recovered no-owner label', () => {
  it('AC1: sw-recovered + null identity → notice rendered exactly once', () => {
    const el = render(evidence('sw-recovered-form-submit', null));
    const text = el.textContent ?? '';
    expect(text).toContain(NOTICE_FRAGMENT);
    expect(text).toContain('no owner resolved');
    const notices = el.querySelectorAll('.evidence-synthetic-notice');
    expect(notices.length).toBe(1);
  });

  it('AC2: sw-recovered + seeded identity → NO notice (6F-M2b path untouched)', () => {
    const el = render(evidence('sw-recovered-form-submit', SEEDED_IDENTITY));
    expect(el.textContent ?? '').not.toContain(NOTICE_FRAGMENT);
    expect(el.querySelectorAll('.evidence-synthetic-notice').length).toBe(0);
  });

  it('AC3: page-reload-synthetic notice unchanged', () => {
    const el = render(evidence('page-reload-synthetic', null));
    const text = el.textContent ?? '';
    expect(text).toContain('Navigation evidence (page reloaded — synthetic)');
    expect(text).not.toContain('no owner resolved');
  });

  it('AC4: no notice for unrelated endReasons (e.g. evidence-timeout)', () => {
    const el = render(evidence('evidence-timeout', null));
    expect(el.textContent ?? '').not.toContain(NOTICE_FRAGMENT);
  });
});

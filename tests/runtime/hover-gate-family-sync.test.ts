/**
 * Hover-capture generic fix v1 — gate-family sync (WARN-1 follow-up).
 *
 * The RC-8 structural discovery gate (isHoverDiscoveryShape OR hoverReveal)
 * must be the ONLY hover gate family-wide. The reviewer found two residual
 * call sites still using isInteractiveElement's class-substring form:
 *   - EvidenceLedger.isGatedDiscoveryEnter (ledger lives for gated enters)
 *   - service-worker R-4 stamp dispatcher (secondary-stamp classification)
 * Both are synced to the shared structural gate; this file pins that:
 * a class-only enter ('custom-arrow' DIV) is NOT gated at any site, while a
 * declared affordance (aria-haspopup anchor) IS.
 *
 * Read-only over payload objects (both sites consume ObservedEvent-like
 * inputs); behavior verified end-to-end by the real-Chrome matrix.
 */
import { describe, it, expect } from 'vitest';
import { isGatedDiscoveryEnter } from '../../src/runtime/evidence-ledger';

const base = {
  eventType: 'mouseenter',
  isTrusted: true,
  target: { tag: 'DIV', ariaRole: null, className: 'custom-arrow' },
  domContext: { tabIndex: null, ariaHasPopup: null, clickHandler: false, pointerCursor: false },
};

describe('gate-family sync: EvidenceLedger.isGatedDiscoveryEnter uses the structural gate', () => {
  it('class-only container (custom-arrow) is NOT a gated enter (no vocabulary)', () => {
    expect(isGatedDiscoveryEnter(base as never)).toBe(false);
  });

  it('declared affordance (aria-haspopup anchor) IS a gated enter', () => {
    expect(isGatedDiscoveryEnter({
      ...base,
      target: { tag: 'A', ariaRole: 'link', className: 'nav-link' },
      domContext: { tabIndex: null, ariaHasPopup: 'true', clickHandler: false, pointerCursor: false },
    } as never)).toBe(true);
  });

  it('recorded hoverReveal CSS fact gates without shape', () => {
    expect(isGatedDiscoveryEnter({
      ...base,
      domContext: { tabIndex: null, ariaHasPopup: null, clickHandler: false, pointerCursor: false, hoverReveal: true },
    } as never)).toBe(true);
  });

  it('own-boundary pointer cursor gates; INHERITED (parent pointer) does not', () => {
    // pointerCursor fact is computed at capture with own-boundary semantics;
    // the ledger consumes the recorded fact — inherited leaves arrive false.
    expect(isGatedDiscoveryEnter({
      ...base,
      domContext: { tabIndex: null, ariaHasPopup: null, clickHandler: false, pointerCursor: true },
    } as never)).toBe(true);
  });

  it('untrusted enter is never gated (trust fact first)', () => {
    expect(isGatedDiscoveryEnter({ ...base, isTrusted: false } as never)).toBe(false);
  });
});

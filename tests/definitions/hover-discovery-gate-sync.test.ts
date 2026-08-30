/**
 * T3 (red) — hover discovery gate: shape OR hoverReveal.
 * Spec: `.drytis/specs/hover-capture-generic-fix-v1.md` §5 G3.
 *
 * BOTH call sites must move together (spec): evidence-collector
 * isHoverDiscoveryEnter AND hover.ts detectTrigger.
 */
import { describe, it, expect } from 'vitest';
import { isHoverDiscoveryEnter } from '../../src/tap/evidence-collector';
import { hoverDefinition } from '../../src/definitions/hover';
import type { ObservedEvent } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

function identity(over: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: null, ariaRole: null, ariaLabel: null,
    ariaLabelledBy: null, placeholder: null, tag: 'DIV',
    className: null, name: null, stableId: null, testId: null,
    dataCy: null, dataQa: null, cssSelector: 'div', xPath: '/div',
    inIframe: false, shadowDom: false, href: null, inputType: null,
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function enter(over: {
  target?: Partial<ElementIdentity>;
  domContext?: Partial<ObservedEvent['domContext']>;
}): ObservedEvent {
  return {
    eventId: 'ev-1',
    eventType: 'mouseenter',
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
    target: identity(over.target),
    domContext: {
      inputType: null, ariaExpanded: null, ariaHasPopup: null,
      isContentEditable: false, disabled: false, readOnly: false,
      required: false, ancestorRoles: [], ancestorClasses: [],
      tabIndex: null,
      ...over.domContext,
    },
    valueBefore: null, valueAfter: null,
    checkedBefore: null, checkedAfter: null,
    clientX: null, clientY: null,
    key: null, code: null,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    scrollDeltaY: null, scrollDeltaX: null,
    pageUrl: 'https://example.test/', pageTitle: 'Test',
  } as unknown as ObservedEvent;
}

describe('isHoverDiscoveryEnter — class vocabulary no longer starts discovery (RC-8)', () => {
  it('class-only container is NOT a discovery enter', () => {
    const ev = enter({
      target: { tag: 'DIV', className: 'HeroBannerCarousel_homeHeroBanner__61LDi custom-arrow' },
    });
    expect(isHoverDiscoveryEnter(ev)).toBe(false);
  });

  it('class-only dropdown UL is NOT a discovery enter', () => {
    const ev = enter({ target: { tag: 'UL', className: 'tripType-dropDown', ariaRole: 'list' } });
    expect(isHoverDiscoveryEnter(ev)).toBe(false);
  });

  it('icon <i class="icon-arrow-down"> is NOT a discovery enter (class-only)', () => {
    const ev = enter({ target: { tag: 'I', className: 'font-icons mr-l10 fs-14 icon-arrow-down' } });
    expect(isHoverDiscoveryEnter(ev)).toBe(false);
  });

  it('shaped A remains a discovery enter', () => {
    const ev = enter({ target: { tag: 'A', ariaRole: 'link' } });
    expect(isHoverDiscoveryEnter(ev)).toBe(true);
  });

  it('cursor:pointer DIV is a discovery enter (declared affordance)', () => {
    const ev = enter({ domContext: { pointerCursor: true } });
    expect(isHoverDiscoveryEnter(ev)).toBe(true);
  });

  it('aria-haspopup DIV is a discovery enter', () => {
    const ev = enter({ domContext: { ariaHasPopup: 'menu' } });
    expect(isHoverDiscoveryEnter(ev)).toBe(true);
  });

  it('hoverReveal CSS fact is a discovery enter without shape', () => {
    const ev = enter({ target: { tag: 'DIV', className: 'custom-arrow' }, domContext: { hoverReveal: true } });
    expect(isHoverDiscoveryEnter(ev)).toBe(true);
  });
});

describe('hover.ts detectTrigger — synced with the same gate', () => {
  it('class-only container does not claim', () => {
    const ev = enter({
      target: { tag: 'DIV', className: 'custom-arrow HeroBanner_x' },
    });
    expect(hoverDefinition.detectTrigger(ev)).toBeNull();
  });

  it('shaped A claims', () => {
    const ev = enter({ target: { tag: 'A' } });
    expect(hoverDefinition.detectTrigger(ev)).toEqual({ type: 'Hover' });
  });

  it('hoverReveal claims without shape', () => {
    const ev = enter({ domContext: { hoverReveal: true } });
    expect(hoverDefinition.detectTrigger(ev)).toEqual({ type: 'Hover' });
  });

  it('cursor:pointer claims', () => {
    const ev = enter({ domContext: { pointerCursor: true } });
    expect(hoverDefinition.detectTrigger(ev)).toEqual({ type: 'Hover' });
  });
});

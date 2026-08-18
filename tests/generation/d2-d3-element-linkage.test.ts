/**
 * D2/D3 — element linkage, healing wiring, truthful staleness.
 *
 * Red-phase tests for the NEW behavior (harvest module + ir-bridge mapping +
 * OR-1 with real IDs). Written BEFORE implementation (spec:
 * .drytis/specs/d2-d3-element-linkage-healing.md).
 */
import { describe, it, expect } from 'vitest';
import { elementIdentityKey, harvestSessionElements } from '../../src/repository/services/session-element-harvest';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── Fixtures ───────────────────────────────────────────────

let evtCounter = 0;
function makeEvent(): { eventId: string; timestamp: number } {
  evtCounter += 1;
  return { eventId: `evt-1-${evtCounter}`, timestamp: Date.now() };
}

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Search',
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: 'Type here',
    tag: 'INPUT',
    className: 'search-input',
    name: 'q',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'input.search-input',
    xPath: '//input[@class="search-input"]',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: 'text',
    elementId: '', // D3: as captured today
    ...overrides,
  };
}

function makeInteraction(
  type: string,
  identity: ElementIdentity,
  overrides: Record<string, unknown> = {},
): ComponentInteraction {
  const ev = makeEvent();
  return {
    interactionId: `int-${evtCounter}`,
    type: type as never,
    trigger: identity,
    triggerEvent: {
      eventId: ev.eventId,
      eventType: 'click' as never,
      timestamp: ev.timestamp,
      captureSeq: evtCounter,
      isTrusted: true,
      target: identity,
      domContext: { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      pageUrl: 'https://shop.example.com/',
    } as never,
    memberEvents: [] as never[],
    startTime: ev.timestamp,
    endTime: ev.timestamp + 50,
    endState: 'completed' as never,
    metadata: {},
    ...overrides,
  };
}

const SEARCH = makeIdentity();
const CART_BTN = makeIdentity({
  accessibleName: 'Add to cart',
  ariaRole: 'button',
  tag: 'BUTTON',
  placeholder: null,
  className: 'btn btn-primary',
  name: null,
  inputType: null,
  cssSelector: 'button.btn-primary',
  xPath: '//button[@class="btn btn-primary"]',
});
const SEARCH_SAME = makeIdentity(); // identical fields to SEARCH → same element

// ── elementIdentityKey ────────────────────────────────────

describe('elementIdentityKey', () => {
  it('same identity fields → same key', () => {
    expect(elementIdentityKey(SEARCH)).toBe(elementIdentityKey(SEARCH_SAME));
  });

  it('different cssSelector → different key', () => {
    const other = makeIdentity({ cssSelector: 'input.other' });
    expect(elementIdentityKey(SEARCH)).not.toBe(elementIdentityKey(other));
  });

  it('prefers testId when present (stable business id wins)', () => {
    const a = makeIdentity({ testId: 'submit-btn', cssSelector: 'div.a > button' });
    const b = makeIdentity({ testId: 'submit-btn', cssSelector: 'div.b > button' });
    expect(elementIdentityKey(a)).toBe(elementIdentityKey(b));
  });

  it('ignores elementId field itself (pre-assignment value irrelevant)', () => {
    const withId = makeIdentity({ elementId: 'elem-0009' });
    expect(elementIdentityKey(withId)).toBe(elementIdentityKey(SEARCH));
  });
});

// ── harvestSessionElements ────────────────────────────────

describe('harvestSessionElements', () => {
  it('assigns distinct elem-NNNN ids to distinct elements, in first-seen order', () => {
    const interactions = [
      makeInteraction('Click', SEARCH),
      makeInteraction('Click', CART_BTN),
    ];
    const { freshElements, idByKey } = harvestSessionElements(interactions, 'https://shop.example.com/');
    expect(freshElements).toHaveLength(2);
    expect(freshElements[0].elementId).toBe('elem-0001');
    expect(freshElements[1].elementId).toBe('elem-0002');
    expect(idByKey.get(elementIdentityKey(SEARCH))).toBe('elem-0001');
    expect(idByKey.get(elementIdentityKey(CART_BTN))).toBe('elem-0002');
  });

  it('dedupes identical identities across multiple interactions to one element', () => {
    const interactions = [
      makeInteraction('TextEntry', SEARCH),
      makeInteraction('Click', SEARCH_SAME),
      makeInteraction('Click', CART_BTN),
    ];
    const { freshElements } = harvestSessionElements(interactions, 'https://shop.example.com/');
    expect(freshElements).toHaveLength(2);
  });

  it('produces UiElements with non-empty elementId (createUiElement invariant)', () => {
    const interactions = [makeInteraction('Click', CART_BTN)];
    const { freshElements } = harvestSessionElements(interactions, 'https://shop.example.com/');
    expect(freshElements[0].elementId).toMatch(/^elem-\d{4}$/);
    expect(freshElements[0].identity.cssSelector).toBe('button.btn-primary');
    expect(freshElements[0].sourceUrl).toBe('https://shop.example.com/');
  });

  it('empty interactions → empty harvest', () => {
    const r = harvestSessionElements([], 'https://x.test/');
    expect(r.freshElements).toEqual([]);
    expect(r.idByKey.size).toBe(0);
  });
});

// ── ir-bridge: elementIdByKey mapping ─────────────────────

describe('build with elementIdByKey', () => {
  const ctx = { startUrl: 'https://shop.example.com/', title: 'Shop' };

  function planFor(interactions: ComponentInteraction[], map?: ReadonlyMap<string, string>) {
    return build({
      interactions,
      recordingContext: ctx,
      testCaseName: 'D3 test',
      ...(map ? { elementIdByKey: map } : {}),
    });
  }

  it('maps real element ids onto element steps', () => {
    const interactions = [makeInteraction('Click', CART_BTN)];
    const { idByKey } = harvestSessionElements(interactions, ctx.startUrl);
    const plan = planFor(interactions, idByKey);
    const elSteps = plan.steps.filter((s) => s.target.kind === 'element');
    expect(elSteps.length).toBeGreaterThan(0);
    for (const s of elSteps) {
      expect((s.target as { elementId: string }).elementId).toBe('elem-0001');
    }
  });

  it('without the map, elementId stays as-captured (backward compatible)', () => {
    const interactions = [makeInteraction('Click', CART_BTN)];
    const plan = planFor(interactions);
    const elSteps = plan.steps.filter((s) => s.target.kind === 'element');
    for (const s of elSteps) {
      expect((s.target as { elementId: string }).elementId).toBe('');
    }
  });

  it('OR-1: consecutive clicks on DIFFERENT elements are NOT merged when ids differ', () => {
    const interactions = [
      makeInteraction('Click', SEARCH),
      makeInteraction('Click', CART_BTN),
    ];
    const { idByKey } = harvestSessionElements(interactions, ctx.startUrl);
    const plan = planFor(interactions, idByKey);
    const clicks = plan.steps.filter(
      (s) => s.action === 'click' && s.target.kind === 'element',
    );
    expect(clicks.length).toBe(2);
  });

  it('OR-1: consecutive clicks on the SAME element still merge', () => {
    const interactions = [
      makeInteraction('Click', CART_BTN),
      makeInteraction('Click', makeIdentity({
        accessibleName: 'Add to cart',
        ariaRole: 'button',
        tag: 'BUTTON',
        className: 'btn btn-primary',
        cssSelector: 'button.btn-primary',
        xPath: '//button[@class="btn btn-primary"]',
      })),
    ];
    const { idByKey } = harvestSessionElements(interactions, ctx.startUrl);
    expect(idByKey.size).toBe(1); // same identity → one element
    const plan = planFor(interactions, idByKey);
    const clicks = plan.steps.filter(
      (s) => s.action === 'click' && s.target.kind === 'element',
    );
    expect(clicks.length).toBe(1);
  });

  it('unknown identity (not in map) falls back to captured elementId', () => {
    const interactions = [makeInteraction('Click', CART_BTN)];
    const plan = planFor(interactions, new Map()); // empty map
    const elSteps = plan.steps.filter((s) => s.target.kind === 'element');
    for (const s of elSteps) {
      expect((s.target as { elementId: string }).elementId).toBe('');
    }
  });
});

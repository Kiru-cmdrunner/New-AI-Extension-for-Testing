/**
 * Regression Tests: null === null Identity Bug
 *
 * Tests that a discrete click on a DIFFERENT element (both lacking `id`)
 * is NOT silently absorbed by an active TextEntry/Slider lifecycle.
 *
 * Before the fix: stableId(null) === stableId(null) evaluated to true,
 * causing the runtime to consider two different elements as the same.
 * The click was then swallowed (handled=true), never reaching discovery.
 *
 * Bug report: Amazon product page — "With Exchange" click sometimes
 * silently lost when a text input lifecycle was active.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import type {
  ComponentDefinition,
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
  DomContext,
  ElementIdentity,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';
import { textEntryDefinition } from '../../src/definitions/text-entry';
import { sliderDefinition } from '../../src/definitions/slider';
import { clickDefinition } from '../../src/definitions/click';
import { colorInputDefinition } from '../../src/definitions/color-input';
import { hoverDefinition } from '../../src/definitions/hover';
import { elementKey } from '../../src/definitions/patterns';

// ── Helpers ──────────────────────────────────────────────────────────────

const BASE_DOM: DomContext = {
  inputType: null,
  ariaExpanded: null,
  ariaHasPopup: null,
  isContentEditable: false,
  disabled: false,
  readOnly: false,
  required: false,
  ancestorRoles: [],
  ancestorClasses: [],
  tabIndex: null,
};

function makeTarget(overrides: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
    ...overrides,
  };
}

describe('null-identity regression — lifecycle does not absorb different-element click', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    emitted = [];
  });

  // ═══════════════════════════════════════════════════════════════════
  // TextEntry lifecycle absorbs click on a different element (both no ID)
  // This is the exact Amazon "With Exchange" bug.
  // ═══════════════════════════════════════════════════════════════════

  describe('TextEntry lifecycle', () => {
    beforeEach(() => {
      const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
      runtime = createRuntime([textEntryDefinition, clickDefinition], config);
    });

    it('does NOT absorb a click on a different element when both lack IDs', () => {
      // 1. Focus a text input (no id) — starts TextEntry lifecycle
      const focusEvent = makeObservedEvent({
        eventId: 'te-focus',
        eventType: 'focus',
        target: makeTarget({
          accessibleName: 'Quantity',
          tag: 'INPUT',
          inputType: undefined as any,
          stableId: null,        // ← no id
          cssSelector: 'input[name="qty"]',
          ariaRole: 'textbox',
        }),
        domContext: {
          ...BASE_DOM,
          inputType: 'text',
        },
      });

      runtime.process(focusEvent);
      expect(runtime.activeCount).toBe(1); // TextEntry is active

      // 2. Click "With Exchange" (no id) — DIFFERENT element
      const exchangeClick = makeObservedEvent({
        eventId: 'exchange-click',
        eventType: 'click',
        target: makeTarget({
          accessibleName: 'With Exchange',
          tag: 'DIV',
          stableId: null,        // ← no id (null === null was the bug)
          cssSelector: 'div.exchange-option.with',
          className: 'exchange-option',
          ariaRole: 'radio',
        }),
      });

      const result = runtime.process(exchangeClick);

      // BEFORE FIX: result.length === 0 (click silently absorbed)
      // AFTER FIX: click falls through to discovery → Click or Unclassified
      expect(result.length).toBeGreaterThan(0);

      // The click should NOT have been swallowed by TextEntry
      const clickInteraction = result.find(
        (i) => i.type === 'Click' || i.type === 'Unclassified',
      );
      expect(clickInteraction).toBeDefined();
    });

    it('TextEntry isInScope returns false for a click on a different element without ID', () => {
      const ctx = {
        type: 'TextEntry' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[name="search"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-1',
        eventType: 'click',
        target: makeTarget({
          tag: 'DIV',
          stableId: null,
          cssSelector: 'div.exchange-option',
        }),
      });

      // Directly test isInScope — should be false (different elements)
      expect(textEntryDefinition.isInScope(event, ctx)).toBe(false);
    });

    it('TextEntry shouldCancelOnOutside returns true for click on different element without ID', () => {
      const ctx = {
        type: 'TextEntry' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[name="search"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-2',
        eventType: 'click',
        target: makeTarget({
          tag: 'DIV',
          stableId: null,
          cssSelector: 'div.exchange-option',
        }),
      });

      // Directly test shouldCancelOnOutside — should be true (different element)
      expect(textEntryDefinition.shouldCancelOnOutside(event, ctx)).toBe(true);
    });

    it('still correctly identifies same-element events when both have IDs', () => {
      const ctx = {
        type: 'TextEntry' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: 'search-input',
          cssSelector: '#search-input',
        }),
      } as any;

      const sameEvent = makeObservedEvent({
        eventId: 'test-3',
        eventType: 'input',
        target: makeTarget({
          tag: 'INPUT',
          stableId: 'search-input',
          cssSelector: '#search-input',
        }),
      });

      expect(textEntryDefinition.isInScope(sameEvent, ctx)).toBe(true);
    });

    it('still correctly identifies same-element events when both lack IDs but have same selector', () => {
      const ctx = {
        type: 'TextEntry' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[name="qty"]',
        }),
      } as any;

      const sameEvent = makeObservedEvent({
        eventId: 'test-4',
        eventType: 'input',
        target: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[name="qty"]',
        }),
      });

      // Same selector → same elementKey → should be in scope
      expect(textEntryDefinition.isInScope(sameEvent, ctx)).toBe(true);
    });

    it('reproduces state-dependent capture: first click lost before fix, second captured', () => {
      // This test mirrors the exact Amazon scenario:
      // 1. Focus input → TextEntry active
      // 2. Click "With Exchange" → should be captured (not absorbed)
      // 3. Blur input → TextEntry completes
      // 4. Click "With Exchange" again → also captured

      const focus = makeObservedEvent({
        eventId: 'f1',
        eventType: 'focus',
        target: makeTarget({
          tag: 'INPUT',
          accessibleName: 'Search',
          stableId: null,
          cssSelector: 'input.search-box',
          ariaRole: 'textbox',
        }),
        domContext: { ...BASE_DOM, inputType: 'text' },
      });
      runtime.process(focus);

      const exchangeClick1 = makeObservedEvent({
        eventId: 'ec1',
        eventType: 'click',
        target: makeTarget({
          tag: 'DIV',
          accessibleName: 'With Exchange',
          stableId: null,
          cssSelector: 'div.exchange-with',
          ariaRole: 'radio',
        }),
      });
      const result1 = runtime.process(exchangeClick1);
      expect(result1.length).toBeGreaterThan(0); // ← was 0 before fix

      const blur = makeObservedEvent({
        eventId: 'b1',
        eventType: 'blur',
        target: makeTarget({
          tag: 'INPUT',
          accessibleName: 'Search',
          stableId: null,
          cssSelector: 'input.search-box',
          ariaRole: 'textbox',
        }),
        domContext: { ...BASE_DOM, inputType: 'text' },
      });
      runtime.process(blur);

      const exchangeClick2 = makeObservedEvent({
        eventId: 'ec2',
        eventType: 'click',
        timestamp: Date.now() + 3000, // after dedup window (2000ms)
        target: makeTarget({
          tag: 'DIV',
          accessibleName: 'With Exchange',
          stableId: null,
          cssSelector: 'div.exchange-with',
          ariaRole: 'radio',
        }),
      });
      const result2 = runtime.process(exchangeClick2);
      expect(result2.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Slider lifecycle — same bug pattern
  // ═══════════════════════════════════════════════════════════════════

  describe('Slider lifecycle', () => {
    beforeEach(() => {
      const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
      runtime = createRuntime([sliderDefinition, clickDefinition], config);
    });

    it('does NOT absorb a click on a different element when both lack IDs', () => {
      const focusEvent = makeObservedEvent({
        eventId: 'sl-focus',
        eventType: 'focus',
        target: makeTarget({
          tag: 'INPUT',
          accessibleName: 'Price Range',
          stableId: null,
          cssSelector: 'input[type="range"]',
          ariaRole: 'slider',
        }),
        domContext: { ...BASE_DOM, inputType: 'range' },
      });

      runtime.process(focusEvent);
      expect(runtime.activeCount).toBe(1);

      const outsideClick = makeObservedEvent({
        eventId: 'sl-outside',
        eventType: 'click',
        target: makeTarget({
          tag: 'BUTTON',
          accessibleName: 'Add to Cart',
          stableId: null,
          cssSelector: 'button.add-to-cart',
        }),
      });

      const result = runtime.process(outsideClick);

      // BEFORE FIX: 0 (silently absorbed)
      // AFTER FIX: click falls through to discovery
      expect(result.length).toBeGreaterThan(0);

      const clickInteraction = result.find(
        (i) => i.type === 'Click' || i.type === 'Unclassified',
      );
      expect(clickInteraction).toBeDefined();
    });

    it('Slider isInScope returns false for click on different element without ID', () => {
      const ctx = {
        type: 'Slider' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[type="range"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-5',
        eventType: 'click',
        target: makeTarget({
          tag: 'BUTTON',
          stableId: null,
          cssSelector: 'button.submit',
        }),
      });

      expect(sliderDefinition.isInScope(event, ctx)).toBe(false);
    });

    it('Slider shouldCancelOnOutside returns true for click on different element without ID', () => {
      const ctx = {
        type: 'Slider' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[type="range"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-6',
        eventType: 'click',
        target: makeTarget({
          tag: 'BUTTON',
          stableId: null,
          cssSelector: 'button.submit',
        }),
      });

      expect(sliderDefinition.shouldCancelOnOutside(event, ctx)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ColorInput lifecycle — same bug pattern (isInScope gate is different,
  // but shouldCancelOnOutside had the raw comparison)
  // ═══════════════════════════════════════════════════════════════════

  describe('ColorInput lifecycle', () => {
    it('shouldCancelOnOutside returns true for click on different element without ID', () => {
      const ctx = {
        type: 'ColorInput' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[type="color"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-7',
        eventType: 'click',
        target: makeTarget({
          tag: 'BUTTON',
          stableId: null,
          cssSelector: 'button.apply',
        }),
      });

      expect(colorInputDefinition.shouldCancelOnOutside(event, ctx)).toBe(true);
    });

    it('isInScope returns false for input event on different element without ID', () => {
      const ctx = {
        type: 'ColorInput' as any,
        trigger: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[type="color"]',
        }),
      } as any;

      const event = makeObservedEvent({
        eventId: 'test-8',
        eventType: 'input',
        target: makeTarget({
          tag: 'INPUT',
          stableId: null,
          cssSelector: 'input[type="text"]',
        }),
      });

      expect(colorInputDefinition.isInScope(event, ctx)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Hover lifecycle — mouseleave sameElement check
  // ═══════════════════════════════════════════════════════════════════

  describe('Hover lifecycle', () => {
    it('does not falsely match mouseleave on a different element (both no ID)', () => {
      const ctx = {
        type: 'Hover' as any,
        trigger: makeTarget({
          tag: 'DIV',
          accessibleName: 'Menu',
          stableId: null,
          cssSelector: 'div.menu-item',
          ariaRole: 'menuitem',
        }),
        data: { confidence: 0 },
      } as any;

      // mouseenter on a DIFFERENT element (both no ID)
      const differentLeave = makeObservedEvent({
        eventId: 'test-9',
        eventType: 'mouseleave',
        target: makeTarget({
          tag: 'DIV',
          accessibleName: 'Sidebar',
          stableId: null,
          cssSelector: 'div.sidebar',
        }),
      });

      // handleEvent should return null (not complete/discard) because
      // the mouseleave is on a different element
      const result = hoverDefinition.handleEvent(differentLeave, ctx);
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // elementKey() consistency — direct unit test
  // ═══════════════════════════════════════════════════════════════════

  describe('elementKey() null safety', () => {
    it('produces different keys for two elements with null stableId but different selectors', () => {
      const a = makeTarget({
        stableId: null,
        cssSelector: 'input[name="qty"]',
      });
      const b = makeTarget({
        stableId: null,
        cssSelector: 'div.exchange-option',
      });

      expect(elementKey(a)).not.toBe(elementKey(b));
    });

    it('produces same key for same element (null stableId, same selector)', () => {
      const a = makeTarget({
        stableId: null,
        cssSelector: 'input[name="qty"]',
        accessibleName: 'Qty',
      });
      const b = makeTarget({
        stableId: null,
        cssSelector: 'input[name="qty"]',
        accessibleName: 'Qty',
      });

      expect(elementKey(a)).toBe(elementKey(b));
    });

    it('produces different keys when both stableId and cssSelector differ', () => {
      const a = makeTarget({
        stableId: null,
        cssSelector: 'div.a',
      });
      const b = makeTarget({
        stableId: null,
        cssSelector: 'div.b',
      });

      expect(elementKey(a)).not.toBe(elementKey(b));
    });
  });
});

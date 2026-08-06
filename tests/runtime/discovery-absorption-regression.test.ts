/**
 * Regression Test: Discovery Absorption — Click Consumed by Lifecycle Trigger
 *
 * Bug: When discovery matches a definition (e.g., Dropdown) but handleEvent
 * returns null (the click was a trigger, not a completion), the click was
 * silently consumed. No interaction emitted, no Unclassified fallback.
 *
 * Root cause: The if/else structure at discovery only fired the Unclassified
 * fallback when tryDiscovery returned null. When it returned non-null (matched
 * a definition), the code pushed the lifecycle and checked for immediate
 * completion. If no completion, the code fell through to `return emitted`
 * with an empty array — the Unclassified fallback was structurally unreachable.
 *
 * Fix: After discovery matches but handleEvent returns null, if the event
 * is a discrete action (click, mousedown, contextmenu, keydown), emit an
 * Unclassified interaction so the trigger event is preserved.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import type {
  ComponentDefinition,
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Test Definition: A lifecycle that triggers on click but doesn't complete ──

function makeDropdownLikeDef(): ComponentDefinition {
  return {
    type: 'Dropdown',
    priority: 20,
    triggerEventTypes: new Set(['click', 'mousedown', 'focus', 'change']),
    detectTrigger(event) {
      // Matches if className contains "select" (simulates broad DROPDOWN_TRIGGER_CLASS_RE)
      if (event.target.className && /select/i.test(event.target.className)) {
        return { type: 'Dropdown' };
      }
      return null;
    },
    isInScope(event, ctx) {
      // Same element as trigger
      const triggerKey = ctx.trigger.stableId ?? ctx.trigger.cssSelector ?? '';
      const eventKey = event.target.stableId ?? event.target.cssSelector ?? '';
      return triggerKey === eventKey;
    },
    handleEvent(event) {
      // Only completes on change event (not click)
      if (event.eventType === 'change') {
        return { endState: 'completed' as const };
      }
      return null; // click on trigger → null → lifecycle stays active
    },
    shouldCancelOnOutside() {
      return false; // Dropdown never cancels
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName } };
    },
  };
}

describe('Discovery Absorption Regression', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  function setup(defs: ComponentDefinition[]) {
    emitted = [];
    const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
    runtime = createRuntime(defs, config);
  }

  beforeEach(() => {
    emitted = [];
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 1: Click that triggers a lifecycle but doesn't complete
  // ═══════════════════════════════════════════════════════════════════

  describe('discovery-matches-but-no-completion', () => {
    beforeEach(() => {
      setup([makeDropdownLikeDef()]);
    });

    it('preserves a click as Unclassified when discovery matches but lifecycle does not complete', () => {
      // Click on an element whose class contains "select"
      // Dropdown.detectTrigger matches → lifecycle created → handleEvent returns null
      // Before fix: click silently consumed, emitted.length === 0
      // After fix: Unclassified emitted alongside the lifecycle
      const click = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'exchange-option',
          cssSelector: 'div.exchange-option',
          className: 'a-button-select exchange',
          accessibleName: 'Without Exchange',
          ariaRole: null,
        } as any,
      });

      const result = runtime.process(click);

      // Before fix: 0 (click silently consumed by Dropdown lifecycle)
      // After fix: 1 (Unclassified preserves the click)
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('click');
      expect(result[0].metadata.recognized).toBe(false);
    });

    it('lifecycle is still on the stack after the click is preserved', () => {
      const click = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'size-select',
          cssSelector: 'div.size-select',
          className: 'a-dropdown-select',
          accessibleName: 'Size',
        } as any,
      });

      runtime.process(click);

      // The Dropdown lifecycle was created and is still active
      expect(runtime.activeCount).toBe(1);
      // But the click was ALSO preserved
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Unclassified');
    });

    it('lifecycle can still complete from a later event after click preservation', () => {
      const target = {
        tag: 'SELECT',
        stableId: 'qty-select',
        cssSelector: 'select.qty',
        className: 'a-dropdown-select',
        accessibleName: 'Quantity',
      };

      const click = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: target as any,
      });
      runtime.process(click);

      // Click preserved
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Unclassified');
      expect(runtime.activeCount).toBe(1);

      // Change event completes the lifecycle
      const change = makeObservedEvent({
        eventId: 'e2',
        eventType: 'change',
        target: target as any,
        valueAfter: '2',
      });
      runtime.process(change);

      // Now both the Unclassified (click) and the Dropdown (completed) exist
      expect(emitted.length).toBe(2);
      expect(emitted[1].type).toBe('Dropdown');
      expect(emitted[1].endState).toBe('completed');
      expect(runtime.activeCount).toBe(0);
    });

    it('does NOT emit Unclassified when definition completes immediately', () => {
      // A definition that completes on click (like Click, Checkbox, etc.)
      const immediateDef: ComponentDefinition = {
        type: 'Click',
        priority: 180,
        triggerEventTypes: new Set(['click']),
        detectTrigger() {
          return { type: 'Click' };
        },
        isInScope() {
          return false;
        },
        handleEvent() {
          return { endState: 'completed' as const };
        },
        shouldCancelOnOutside() {
          return false;
        },
        buildResult(ctx) {
          return { metadata: { targetName: ctx.trigger.accessibleName } };
        },
      };

      const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
      const rt = createRuntime([immediateDef], config);

      const click = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: {
          tag: 'BUTTON',
          stableId: 'btn1',
          cssSelector: '#btn1',
          accessibleName: 'Submit',
        } as any,
      });

      const result = rt.process(click);

      // Click completed immediately → only 1 emission (Click), NOT Unclassified
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Click');
    });

    it('does NOT emit Unclassified for non-discrete events (change, input)', () => {
      const change = makeObservedEvent({
        eventId: 'e1',
        eventType: 'change',
        target: {
          tag: 'SELECT',
          stableId: 'sel1',
          cssSelector: 'select.qty',
          className: 'a-dropdown-select',
          accessibleName: 'Qty',
        } as any,
        valueAfter: '3',
      });

      // change is NOT a discrete action — should complete the lifecycle
      // without any Unclassified side-emission
      const result = runtime.process(change);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Dropdown');
      expect(result[0].endState).toBe('completed');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 2: The Amazon "With/Without Exchange" scenario
  // ═══════════════════════════════════════════════════════════════════

  describe('Amazon exchange option scenario', () => {
    beforeEach(() => {
      setup([makeDropdownLikeDef()]);
    });

    it('mousedown (no select class) → Unclassified, click (has select class) → also preserved', () => {
      // This simulates the mousedown/click target asymmetry:
      // mousedown resolves to a child element WITHOUT "select" in its class
      // click resolves to a parent element WITH "select" in its class

      const mousedown = makeObservedEvent({
        eventId: 'md1',
        eventType: 'mousedown',
        target: {
          tag: 'SPAN',
          stableId: 'exchange-label',
          cssSelector: 'span.exchange-label',
          className: 'exchange-text', // no "select"
          accessibleName: 'With Exchange',
        } as any,
      });

      const mdResult = runtime.process(mousedown);
      expect(mdResult.length).toBe(1);
      expect(mdResult[0].type).toBe('Unclassified');
      expect(mdResult[0].metadata.physicalEventType).toBe('mousedown');

      const click = makeObservedEvent({
        eventId: 'cl1',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'exchange-container',
          cssSelector: 'div.exchange-container',
          className: 'a-button-select exchange-option', // has "select"
          accessibleName: 'With Exchange',
        } as any,
      });

      const clickResult = runtime.process(click);
      // Before fix: 0 (Dropdown discovery absorbed the click)
      // After fix: 1 (Unclassified preserves the click)
      expect(clickResult.length).toBe(1);
      expect(clickResult[0].type).toBe('Unclassified');
      expect(clickResult[0].metadata.physicalEventType).toBe('click');
    });

    it('multiple rapid clicks on select-classed elements all preserved', () => {
      const click1 = makeObservedEvent({
        eventId: 'c1',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'exchange-with',
          cssSelector: 'div.exchange-with',
          className: 'a-button-select',
          accessibleName: 'With Exchange',
        } as any,
      });

      const click2 = makeObservedEvent({
        eventId: 'c2',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'exchange-without',
          cssSelector: 'div.exchange-without',
          className: 'a-button-selected',
          accessibleName: 'Without Exchange',
        } as any,
        timestamp: Date.now() + 3000, // after dedup window
      });

      const r1 = runtime.process(click1);
      expect(r1.length).toBe(1);
      expect(r1[0].metadata.physicalEventType).toBe('click');

      const r2 = runtime.process(click2);
      expect(r2.length).toBe(1);
      expect(r2[0].metadata.physicalEventType).toBe('click');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 3: The onEmit callback is called
  // ═══════════════════════════════════════════════════════════════════

  describe('onEmit callback', () => {
    it('calls onEmit for Unclassified when discovery matches but does not complete', () => {
      const emittedViaCallback: ComponentInteraction[] = [];
      const config: RuntimeConfig = {
        onEmit: (i) => emittedViaCallback.push(i),
      };
      const rt = createRuntime([makeDropdownLikeDef()], config);

      const click = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: {
          tag: 'DIV',
          stableId: 'opt1',
          cssSelector: 'div.opt1',
          className: 'a-button-select',
          accessibleName: 'Option 1',
        } as any,
      });

      rt.process(click);

      // onEmit must have been called — this was the bug that caused
      // Unclassified interactions to be invisible in the side panel
      expect(emittedViaCallback.length).toBe(1);
      expect(emittedViaCallback[0].type).toBe('Unclassified');
    });
  });
});

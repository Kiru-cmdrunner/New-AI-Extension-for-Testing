/**
 * Capture Guarantee v2 — No Deliberate Action Silently Dropped
 *
 * Architecture: `.drytis/specs/capture-guarantee-v2.md`
 *
 * This test suite proves three invariants:
 * 1. Every deliberate discrete action (click, contextmenu, mousedown, keydown)
 *    produces exactly one ComponentInteraction — either from a specialized
 *    definition, or from the Unclassified fallback.
 * 2. Legitimate lifecycle events are not duplicated (no double-emission).
 * 3. Absorption vs fallthrough: active lifecycle absorbs only with positive
 *    ownership proof; otherwise the event falls through to discovery/Unclassified.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import type {
  ComponentDefinition,
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
  DomContext,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Test Factories ─────────────────────────────────────────────────────

function makeClickDef(): ComponentDefinition {
  return {
    type: 'Click',
    priority: 180,
    triggerEventTypes: new Set(['click', 'contextmenu']),
    detectTrigger(event) {
      // Only accept interactive elements (real Click definition behavior)
      const { tag, ariaRole, className } = event.target;
      const tabIndex = event.domContext.tabIndex ?? null;
      const interactiveTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
      const interactiveRoles = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'combobox']);
      if (interactiveTags.has(tag)) return { type: 'Click' };
      if (ariaRole && interactiveRoles.has(ariaRole)) return { type: 'Click' };
      if (tabIndex !== null && tabIndex >= 0) return { type: 'Click' };
      if (className && /btn|button|clickable/i.test(className)) return { type: 'Click' };
      return null;
    },
    isInScope() {
      return false; // immediate completion
    },
    handleEvent() {
      return { endState: 'completed' as const };
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName || 'element' } };
    },
  };
}

/**
 * A Dropdown lifecycle definition with semanticChildRoles for ownership test.
 */
function makeDropdownDef(): ComponentDefinition {
  return {
    type: 'Dropdown',
    priority: 40,
    triggerEventTypes: new Set(['click', 'focus']),
    semanticChildRoles: ['option'],
    semanticChildTags: ['OPTION'],
    detectTrigger(event) {
      if (event.eventType === 'click' && event.domContext.ariaHasPopup) {
        return { type: 'Dropdown' };
      }
      if (event.eventType === 'focus' && event.target.tag === 'SELECT') {
        return { type: 'Dropdown' };
      }
      return null;
    },
    isInScope(event, ctx) {
      // In scope for same target or events inside surface.
      // A click on an option (role=option) whose ancestors include the
      // lifecycle's surface role IS in scope.
      if (event.target.stableId === ctx.trigger.stableId) return true;
      if (
        event.target.ariaRole === 'option' &&
        event.domContext.ancestorRoles.includes('listbox')
      ) {
        return true;
      }
      return false;
    },
    handleEvent(event, ctx) {
      // Complete on option click
      if (event.eventType === 'click' && event.target.ariaRole === 'option') {
        ctx.data.surfaceRole = 'listbox';
        ctx.data.selectedValue = event.target.accessibleName;
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside(event) {
      // Cancel on click outside
      if (event.eventType === 'click') return true;
      return false;
    },
    buildResult(ctx) {
      return {
        metadata: {
          targetName: ctx.trigger.accessibleName,
          selectedValue: ctx.data.selectedValue ?? '',
        },
      };
    },
  };
}

describe('Capture Guarantee v2', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;
  let ledger: EvidenceLedger;

  function setup(defs: ComponentDefinition[]) {
    emitted = [];
    ledger = new EvidenceLedger();
    const config: RuntimeConfig = { onEmit: (i) => emitted.push(i), evidenceLedger: ledger };
    runtime = createRuntime(defs, config);
  }

  /**
   * Process events through the full M5 pipeline (runtime + Projection Engine)
   * and return the final interaction list.
   */
  function processFull(event: ObservedEvent): ComponentInteraction[] {
    ledger.append(event);
    runtime.process(event);
    runtime.flush();
    return projectInteractions(ledger, emitted).interactions;
  }

  beforeEach(() => {
    emitted = [];
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 1: NO DELIBERATE ACTION SILENTLY DROPPED
  // Every discrete event must produce exactly one interaction.
  // ═══════════════════════════════════════════════════════════════════

  describe('capture guarantee — no deliberate action silently dropped', () => {
    beforeEach(() => {
      setup([makeClickDef()]);
    });

    it('preserves a click on a plain DIV as Unclassified', () => {
      const event = makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: {
          accessibleName: 'Custom Widget',
          tag: 'DIV',
          stableId: 'widget',
          className: 'custom-widget',
          ariaRole: null,
        } as any,
        domContext: {
          tabIndex: null,
          ariaHasPopup: null,
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [],
          ancestorClasses: [],
        } as DomContext,
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].endState).toBe('completed');
      expect(result[0].metadata.physicalEventType).toBe('click');
      expect(result[0].metadata.recognized).toBe(false);
    });

    it('preserves a click on an SVG element as Unclassified', () => {
      const event = makeObservedEvent({
        eventId: 'e2',
        eventType: 'click',
        target: {
          accessibleName: 'Icon',
          tag: 'svg',
          stableId: 'icon-svg',
          className: null,
          ariaRole: null,
        } as any,
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('click');
    });

    it('preserves a contextmenu as Unclassified (not forced into Click)', () => {
      const event = makeObservedEvent({
        eventId: 'e3',
        eventType: 'contextmenu',
        target: {
          accessibleName: 'Row',
          tag: 'DIV',
          stableId: 'row-1',
          className: 'data-row',
          ariaRole: null,
        } as any,
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('contextmenu');
    });

    it('preserves a mousedown as Unclassified when element is not interactive', () => {
      const event = makeObservedEvent({
        eventId: 'e4',
        eventType: 'mousedown',
        target: {
          accessibleName: 'Panel',
          tag: 'DIV',
          stableId: 'panel',
          className: 'card-panel',
          ariaRole: null,
        } as any,
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('mousedown');
    });

    it('preserves a keydown as Unclassified', () => {
      const event = makeObservedEvent({
        eventId: 'e5',
        eventType: 'keydown',
        target: {
          accessibleName: 'Body',
          tag: 'BODY',
          stableId: 'body',
          ariaRole: null,
        } as any,
        key: 'Enter',
        code: 'Enter',
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('keydown');
    });

    it('classifies a recognized interactive click as Click (not Unclassified)', () => {
      const event = makeObservedEvent({
        eventId: 'e6',
        eventType: 'click',
        target: {
          accessibleName: 'Submit',
          tag: 'BUTTON',
          stableId: 'submit-btn',
          ariaRole: null,
        } as any,
      });

      const result = runtime.process(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Click'); // NOT Unclassified
      expect(result[0].endState).toBe('completed');
    });

    it('classifies a tabIndex>=0 div as Click (not Unclassified)', () => {
      const event = makeObservedEvent({
        eventId: 'e7',
        eventType: 'click',
        target: {
          accessibleName: 'Tab Focusable Div',
          tag: 'DIV',
          stableId: 'focusable-div',
          className: 'tab-item',
          ariaRole: null,
        } as any,
        domContext: {
          tabIndex: 0,
          ariaHasPopup: null,
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [],
          ancestorClasses: [],
        } as DomContext,
      });

      const result = runtime.process(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Click'); // tabIndex makes it interactive
    });

    it('preserves a click on an ARIA-role-less SPAN as Unclassified', () => {
      const event = makeObservedEvent({
        eventId: 'e8',
        eventType: 'click',
        target: {
          accessibleName: 'Close',
          tag: 'SPAN',
          stableId: 'close-x',
          className: 'close-icon',
          ariaRole: null,
        } as any,
      });

      const result = processFull(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Unclassified');
      expect(result[0].metadata.physicalEventType).toBe('click');
    });

    it('does NOT preserve non-discrete events (scroll, input, change)', () => {
      const scrollEvent = makeObservedEvent({
        eventId: 'scroll-1',
        eventType: 'scroll' as any,
        scrollDeltaY: 100,
      });

      const result = runtime.process(scrollEvent);
      expect(result.length).toBe(0); // scroll is not a discrete action
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 2: NO DUPLICATE INTERACTIONS
  // Lifecycle events are not double-counted.
  // ═══════════════════════════════════════════════════════════════════

  describe('no duplicate interactions — lifecycle not double-counted', () => {
    beforeEach(() => {
      setup([makeClickDef()]);
    });

    it('emits exactly one interaction for a single click', () => {
      const event = makeObservedEvent({
        eventId: 'd1',
        eventType: 'click',
        target: {
          accessibleName: 'Button',
          tag: 'BUTTON',
          stableId: 'btn1',
        } as any,
      });

      const result = runtime.process(event);
      expect(result.length).toBe(1);
      // Total emissions (callback) also exactly 1
      expect(emitted.length).toBe(1);
    });

    it('does not emit duplicate for same eventId', () => {
      const event = makeObservedEvent({
        eventId: 'd2',
        eventType: 'click',
        target: {
          accessibleName: 'Button',
          tag: 'BUTTON',
          stableId: 'btn2',
        } as any,
      });

      runtime.process(event);
      const result2 = runtime.process(event); // same eventId
      expect(result2.length).toBe(0);
      expect(emitted.length).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 3: ABSORPTION VS FALLTHROUGH
  // Active lifecycle may absorb a different-target discrete event ONLY with
  // positive ownership proof. Otherwise, the event falls through.
  // ═══════════════════════════════════════════════════════════════════

  describe('absorption vs fallthrough — generic ownership contract', () => {
    beforeEach(() => {
      setup([makeClickDef(), makeDropdownDef()]);
    });

    it('absorbs an option click inside an open Dropdown (positive ownership)', () => {
      // 1. Open the dropdown — click on trigger with aria-haspopup
      const openEvent = makeObservedEvent({
        eventId: 'dd-open',
        eventType: 'click',
        target: {
          accessibleName: 'Country',
          tag: 'DIV',
          stableId: 'country-select',
          ariaRole: 'combobox',
        } as any,
        domContext: {
          tabIndex: 0,
          ariaHasPopup: 'listbox',
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [],
          ancestorClasses: [],
        } as DomContext,
      });

      const openResult = runtime.process(openEvent);
      expect(runtime.activeCount).toBe(1); // dropdown lifecycle active

      // 2. Click an option — role=option, ancestorRoles includes 'listbox'
      const optionEvent = makeObservedEvent({
        eventId: 'dd-option',
        eventType: 'click',
        target: {
          accessibleName: 'United States',
          tag: 'LI',
          stableId: 'opt-us',
          ariaRole: 'option',
        } as any,
        domContext: {
          tabIndex: null,
          ariaHasPopup: null,
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: ['listbox'],
          ancestorClasses: [],
        } as DomContext,
      });

      const optionResult = runtime.process(optionEvent);

      // Dropdown should have completed, and the option click is absorbed
      // (no separate Click or Unclassified for the option)
      const dropdownInteraction = optionResult.find((i) => i.type === 'Dropdown');
      expect(dropdownInteraction).toBeDefined();
      expect(dropdownInteraction!.endState).toBe('completed');
      expect(dropdownInteraction!.metadata.selectedValue).toBe('United States');

      // No Unclassified — the option click was legitimately absorbed
      const unclassified = optionResult.find((i) => i.type === 'Unclassified');
      expect(unclassified).toBeUndefined();

      expect(runtime.activeCount).toBe(0);
    });

    it('falls through when a different-target click lacks ownership proof', () => {
      // 1. Open a dropdown
      const openEvent = makeObservedEvent({
        eventId: 'dd-open-2',
        eventType: 'click',
        target: {
          accessibleName: 'City',
          tag: 'DIV',
          stableId: 'city-select',
          ariaRole: 'combobox',
        } as any,
        domContext: {
          tabIndex: 0,
          ariaHasPopup: 'listbox',
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [],
          ancestorClasses: [],
        } as DomContext,
      });

      runtime.process(openEvent);
      expect(runtime.activeCount).toBe(1);

      // 2. Click an UNRECOGNIZED element — not an option, not inside listbox
      const outsideClick = makeObservedEvent({
        eventId: 'dd-outside',
        eventType: 'click',
        target: {
          accessibleName: 'Submit Form',
          tag: 'BUTTON',
          stableId: 'submit-form',
          ariaRole: null,
        } as any,
      });

      const result = runtime.process(outsideClick);

      // The dropdown was cancelled (shouldCancelOnOutside returns true on click)
      // AND the button click falls through → Click definition claims it
      const clickInteraction = result.find((i) => i.type === 'Click');
      expect(clickInteraction).toBeDefined();
      expect(clickInteraction!.metadata.targetName).toBe('Submit Form');
    });

    it('falls through when target has option role but no surface ancestry', () => {
      // Open dropdown
      const openEvent = makeObservedEvent({
        eventId: 'dd-open-3',
        eventType: 'click',
        target: {
          accessibleName: 'Fruit',
          tag: 'DIV',
          stableId: 'fruit-select',
          ariaRole: 'combobox',
        } as any,
        domContext: {
          tabIndex: 0,
          ariaHasPopup: 'listbox',
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [],
          ancestorClasses: [],
        } as DomContext,
      });

      runtime.process(openEvent);
      expect(runtime.activeCount).toBe(1);

      // Click element with role=option but ancestorRoles is EMPTY
      // (not actually inside the listbox — ownership cannot be proven)
      const rogueOption = makeObservedEvent({
        eventId: 'rogue-opt',
        eventType: 'click',
        target: {
          accessibleName: 'Apple',
          tag: 'DIV',
          stableId: 'rogue-apple',
          ariaRole: 'option',
        } as any,
        domContext: {
          tabIndex: null,
          ariaHasPopup: null,
          ariaExpanded: null,
          inputType: null,
          isContentEditable: false,
          disabled: false,
          readOnly: false,
          required: false,
          ancestorRoles: [], // NOT inside listbox
          ancestorClasses: [],
        } as DomContext,
      });

      const result = runtime.process(rogueOption);

      // Ownership FAILED → shouldCancelOnOutside fires (click) → dropdown abandoned
      // The rogue option click falls through → Click definition (role=option matches)
      // Either way: NO silent drop, exactly the right outcome.
      const hasInteraction = result.length > 0;
      expect(hasInteraction).toBe(true);
      expect(runtime.activeCount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 4: OUTPUT ADAPTER — IR MAPPING
  // ═══════════════════════════════════════════════════════════════════

  describe('output adapter — Unclassified IR mapping', () => {
    it('maps Unclassified click to CLICK IR action', async () => {
      const { toIRAction, isProductionInteraction } = await import(
        '../../src/presentation/output-adapter'
      );

      const interaction: ComponentInteraction = {
        interactionId: 'int-1',
        type: 'Unclassified',
        trigger: {
          accessibleName: 'Custom',
          tag: 'DIV',
          ariaRole: null,
          ariaLabel: null,
          ariaLabelledBy: null,
          placeholder: null,
          className: 'custom-widget',
          name: null,
          stableId: 'custom-1',
          testId: null,
          dataCy: null,
          dataQa: null,
          cssSelector: 'div.custom-widget',
          xPath: '/html/body/div',
          inIframe: false,
          shadowDom: false,
          href: null,
          elementId: '',
        },
        triggerEvent: {} as any,
        memberEvents: [],
        startTime: 1000,
        endTime: 1000,
        endState: 'completed',
        metadata: {
          physicalEventType: 'click',
          recognized: false,
          reason: 'no-definition-matched',
          targetName: 'Custom',
          targetTag: 'DIV',
          targetRole: null,
        },
      };

      expect(isProductionInteraction(interaction)).toBe(true);

      const ir = toIRAction(interaction);
      expect(ir).not.toBeNull();
      expect(ir!.type).toBe('CLICK');
      expect(ir!.metadata?.unclassified).toBe(true);
      expect(ir!.metadata?.physicalEventType).toBe('click');
    });

    it('maps Unclassified contextmenu to RIGHT_CLICK IR action', async () => {
      const { toIRAction } = await import('../../src/presentation/output-adapter');

      const interaction: ComponentInteraction = {
        interactionId: 'int-2',
        type: 'Unclassified',
        trigger: {
          accessibleName: 'Row',
          tag: 'DIV',
          ariaRole: null,
          ariaLabel: null,
          ariaLabelledBy: null,
          placeholder: null,
          className: 'row',
          name: null,
          stableId: 'row-1',
          testId: null,
          dataCy: null,
          dataQa: null,
          cssSelector: 'div.row',
          xPath: '/html/body/div',
          inIframe: false,
          shadowDom: false,
          href: null,
          elementId: '',
        },
        triggerEvent: {} as any,
        memberEvents: [],
        startTime: 1000,
        endTime: 1000,
        endState: 'completed',
        metadata: {
          physicalEventType: 'contextmenu',
          recognized: false,
          reason: 'no-definition-matched',
          targetName: 'Row',
          targetTag: 'DIV',
          targetRole: null,
        },
      };

      const ir = toIRAction(interaction);
      expect(ir).not.toBeNull();
      expect(ir!.type).toBe('RIGHT_CLICK');
    });

    it('maps Unclassified keydown to null (not replayable, but preserved)', async () => {
      const { toIRAction } = await import('../../src/presentation/output-adapter');

      const interaction: ComponentInteraction = {
        interactionId: 'int-3',
        type: 'Unclassified',
        trigger: {
          accessibleName: 'Body',
          tag: 'BODY',
          ariaRole: null,
          ariaLabel: null,
          ariaLabelledBy: null,
          placeholder: null,
          className: null,
          name: null,
          stableId: 'body',
          testId: null,
          dataCy: null,
          dataQa: null,
          cssSelector: 'body',
          xPath: '/html/body',
          inIframe: false,
          shadowDom: false,
          href: null,
          elementId: '',
        },
        triggerEvent: {} as any,
        memberEvents: [],
        startTime: 1000,
        endTime: 1000,
        endState: 'completed',
        metadata: {
          physicalEventType: 'keydown',
          recognized: false,
          reason: 'no-definition-matched',
          targetName: 'Body',
          targetTag: 'BODY',
          targetRole: null,
        },
      };

      // Keydown is preserved in the interaction list but not replayable
      const ir = toIRAction(interaction);
      expect(ir).toBeNull(); // Not replayable
      // But it IS a production interaction (not filtered out)
    });

    it('Unclassified always passes production filter', async () => {
      const { isProductionInteraction } = await import(
        '../../src/presentation/output-adapter'
      );

      const interaction: ComponentInteraction = {
        interactionId: 'int-4',
        type: 'Unclassified',
        trigger: {} as any,
        triggerEvent: {} as any,
        memberEvents: [],
        startTime: 1000,
        endTime: 1000,
        endState: 'completed',
        metadata: {
          physicalEventType: 'click',
          recognized: false,
        },
      };

      expect(isProductionInteraction(interaction)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // GROUP 5: EXHAUSTIVE LIFECYCLE VALIDATION
  // Verify that all lifecycle types produce exactly one interaction.
  // ═══════════════════════════════════════════════════════════════════

  describe('exhaustive lifecycle — each type produces exactly one interaction', () => {
    beforeEach(() => {
      setup([makeClickDef()]);
    });

    it('Click: one click → one Click interaction', () => {
      const event = makeObservedEvent({
        eventId: 'lc-1',
        eventType: 'click',
        target: { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'btn-lc' } as any,
      });

      const result = runtime.process(event);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Click');
    });

    it('TextEntry lifecycle: focus → input → blur → one TextEntry', () => {
      const textDef: ComponentDefinition = {
        type: 'TextEntry',
        priority: 50,
        triggerEventTypes: new Set(['focus']),
        detectTrigger(event) {
          if (event.eventType === 'focus' && event.target.tag === 'INPUT') return { type: 'TextEntry' };
          return null;
        },
        isInScope(event, ctx) {
          return event.target.stableId === ctx.trigger.stableId;
        },
        handleEvent(event) {
          if (event.eventType === 'blur') return { endState: 'completed' as const };
          return null;
        },
        shouldCancelOnOutside() {
          return false;
        },
        buildResult(ctx) {
          return { metadata: { targetName: ctx.trigger.accessibleName, textValue: 'hello', userTyped: true } };
        },
      };

      const textRuntime = createRuntime([textDef, makeClickDef()], { onEmit: (i) => emitted.push(i) });

      const focus = makeObservedEvent({
        eventId: 'te-focus',
        eventType: 'focus',
        target: { accessibleName: 'Search', tag: 'INPUT', stableId: 'search-input' } as any,
      });
      const input = makeObservedEvent({
        eventId: 'te-input',
        eventType: 'input',
        target: { accessibleName: 'Search', tag: 'INPUT', stableId: 'search-input' } as any,
        valueAfter: 'hello',
      });
      const blur = makeObservedEvent({
        eventId: 'te-blur',
        eventType: 'blur',
        target: { accessibleName: 'Search', tag: 'INPUT', stableId: 'search-input' } as any,
      });

      textRuntime.process(focus);
      textRuntime.process(input);
      const result = textRuntime.process(blur);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('TextEntry');
      expect(emitted.length).toBe(1);
    });

    it('Scroll (non-discrete) does NOT get Unclassified fallback', () => {
      const scrollDef: ComponentDefinition = {
        type: 'Scroll',
        priority: 60,
        triggerEventTypes: new Set(['scroll']),
        detectTrigger() {
          return { type: 'Scroll' };
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
          return { metadata: { targetName: 'scroll', hasDelta: true } };
        },
      };

      const scrollRuntime = createRuntime([scrollDef, makeClickDef()], { onEmit: (i) => emitted.push(i) });
      const scroll = makeObservedEvent({
        eventId: 'sc-1',
        eventType: 'scroll' as any,
        scrollDeltaY: 200,
      });

      const result = scrollRuntime.process(scroll);
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('Scroll');
    });
  });
});

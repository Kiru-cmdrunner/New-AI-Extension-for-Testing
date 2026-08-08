/**
 * M0.5 G7 Tests — Slider Lifecycle Fix
 *
 * Validates the TextEntry-style lifecycle for Slider:
 *   - Triggers on focus ONLY (no longer click)
 *   - Accumulates value on input/change events
 *   - Completes on blur with final committed value
 *   - userAdjusted flag filters out focus-only traversal
 *
 * Scenarios tested:
 *   1. Mouse drag: focus → input(60) → blur → value=60, userAdjusted=true
 *   2. Keyboard arrows: focus → input(52) → blur → value=52, userAdjusted=true
 *   3. Click-to-set on track: focus → change(75) → blur → value=75, userAdjusted=true
 *   4. Focus-only traversal: focus → blur → no production interaction
 *   5. Direct click without focus event → Slider does NOT trigger (Click wins)
 *   6. Input+change sequence: focus → input(55) → change(55) → blur → value=55
 *   7. Multiple inputs: focus → input(51) → input(52) → input(53) → blur → value=53
 *   8. Blur with value fallback: focus → blur(valueAfter=58) → value=58
 *   9. shouldCancelOnOutside: click elsewhere cancels pending Slider
 *  10. shouldCancelOnOutside: click on same slider does NOT cancel
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3
 * M0.5 Fix: G7 — stale value from immediate completion
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';
import { isProductionInteraction, toIRAction } from '../../src/presentation/output-adapter';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
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

function makeContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
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
    ...overrides,
  };
}

const SLIDER_TARGET: ElementIdentity = makeTarget({
  tag: 'INPUT',
  accessibleName: 'Volume',
  stableId: 'vol-slider',
  cssSelector: '#vol-slider',
});

const SLIDER_CTX: DomContext = makeContext({ inputType: 'range' });

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity> = {},
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget({ ...SLIDER_TARGET, ...target }),
    domContext: makeContext({ ...SLIDER_CTX, ...domContext }),
    ...eventOverrides,
  });
}

function setupRuntime(): { runtime: ComponentRuntime; emitted: ComponentInteraction[] } {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

// ── G7 Slider Lifecycle Unit Tests ───────────────────────────────────

describe('G7: Slider Lifecycle', () => {
  describe('detectTrigger: focus-only trigger', () => {
    it('triggers on focus of input[type=range]', () => {
      const { runtime, emitted } = setupRuntime();
      runtime.process(makeEvent('e1', 'focus'));
      // Focus alone should not emit — lifecycle is incomplete
      expect(emitted.length).toBe(0);
    });

    it('does NOT trigger on click alone (was trigger before M0.5)', () => {
      const { runtime, emitted } = setupRuntime();
      // A click without preceding focus on the slider should be claimed by Click (priority 180)
      runtime.process(
        makeEvent('e1', 'click', {}, {}, { valueBefore: '50', valueAfter: '60' }),
      );
      // Click should not fire either since slider is interactive via tag INPUT
      // Actually Slider has priority 25 and click event is not in triggerEventTypes anymore
      // So Click (priority 180) should claim it as a Click
      if (emitted.length > 0) {
        expect(emitted[0].type).not.toBe('Slider');
      }
    });

    it('triggers on focus of ARIA slider role', () => {
      const { runtime, emitted } = setupRuntime();
      runtime.process(
        makeEvent('e1', 'focus', { tag: 'DIV', ariaRole: 'slider' }, { inputType: null }),
      );
      expect(emitted.length).toBe(0); // not complete yet
    });
  });

  describe('Scenario 1: Mouse drag (focus → input → blur)', () => {
    it('captures final value=60 after drag from 50', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      expect(emitted.length).toBe(0);

      runtime.process(makeEvent('e2', 'input', {}, {}, { valueBefore: '50', valueAfter: '55' }));
      expect(emitted.length).toBe(0);

      runtime.process(makeEvent('e3', 'input', {}, {}, { valueBefore: '55', valueAfter: '60' }));
      expect(emitted.length).toBe(0);

      runtime.process(makeEvent('e4', 'blur', {}, {}, { valueBefore: '60', valueAfter: '60' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Slider');
      expect(emitted[0].metadata.value).toBe('60');
      expect(emitted[0].metadata.userAdjusted).toBe(true);
    });
  });

  describe('Scenario 2: Keyboard arrows (focus → input → blur)', () => {
    it('captures final value=52 after two Right Arrow presses', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));

      runtime.process(makeEvent('e2', 'input', {}, {}, { valueBefore: '50', valueAfter: '51' }));
      runtime.process(makeEvent('e3', 'input', {}, {}, { valueBefore: '51', valueAfter: '52' }));

      runtime.process(makeEvent('e4', 'blur', {}, {}, { valueAfter: '52' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Slider');
      expect(emitted[0].metadata.value).toBe('52');
      expect(emitted[0].metadata.userAdjusted).toBe(true);
    });
  });

  describe('Scenario 3: Click-to-set (focus → change → blur)', () => {
    it('captures value=75 from click-to-set on slider track', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'change', {}, {}, { valueBefore: '50', valueAfter: '75' }));
      runtime.process(makeEvent('e3', 'blur', {}, {}, { valueAfter: '75' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].metadata.value).toBe('75');
      expect(emitted[0].metadata.userAdjusted).toBe(true);
    });
  });

  describe('Scenario 4: Focus-only traversal (no adjustment)', () => {
    it('does NOT produce production interaction when user only tabs through', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'blur', {}, {}, { valueAfter: '50' }));

      // Slider interaction IS emitted (endState=completed) but filtered by production layer
      expect(emitted.length).toBe(1);
      expect(emitted[0].type).toBe('Slider');
      expect(emitted[0].metadata.userAdjusted).toBe(false);
    });
  });

  describe('Scenario 6: input + change sequence', () => {
    it('value from change event takes precedence on same adjustment', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'input', {}, {}, { valueBefore: '50', valueAfter: '55' }));
      runtime.process(makeEvent('e3', 'change', {}, {}, { valueBefore: '55', valueAfter: '55' }));
      runtime.process(makeEvent('e4', 'blur', {}, {}, { valueAfter: '55' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].metadata.value).toBe('55');
    });
  });

  describe('Scenario 7: Multiple input events', () => {
    it('captures last value=53 from three consecutive inputs', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'input', {}, {}, { valueBefore: '50', valueAfter: '51' }));
      runtime.process(makeEvent('e3', 'input', {}, {}, { valueBefore: '51', valueAfter: '52' }));
      runtime.process(makeEvent('e4', 'input', {}, {}, { valueBefore: '52', valueAfter: '53' }));
      runtime.process(makeEvent('e5', 'blur', {}, {}, { valueAfter: '53' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].metadata.value).toBe('53');
      expect(emitted[0].metadata.userAdjusted).toBe(true);
    });
  });

  describe('Scenario 8: Blur value fallback', () => {
    it('uses blur valueAfter when input/change events were missed', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      // No input/change events — only blur with valueAfter
      runtime.process(makeEvent('e2', 'blur', {}, {}, { valueAfter: '58' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].metadata.value).toBe('58');
      expect(emitted[0].metadata.userAdjusted).toBe(true);
    });
  });

  describe('shouldCancelOnOutside', () => {
    it('does NOT cancel on click on same slider element', () => {
      // Click-to-set pattern: user clicks slider track → focus fires →
      // value changes → click on same element should not cancel the lifecycle
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'change', {}, {}, { valueBefore: '50', valueAfter: '70' }));

      // Click on same element should NOT cancel
      runtime.process(makeEvent('e3', 'click', {}, {}, { valueAfter: '70' }));
      runtime.process(makeEvent('e4', 'blur', {}, {}, { valueAfter: '70' }));

      expect(emitted.length).toBe(1);
      expect(emitted[0].metadata.value).toBe('70');
    });

    it('cancels on click elsewhere (user clicked another element)', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));
      runtime.process(makeEvent('e2', 'input', {}, {}, { valueBefore: '50', valueAfter: '55' }));

      // Click on a DIFFERENT element
      runtime.process(
        makeEvent('e3', 'click',
          { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'submit-btn', cssSelector: '#submit' },
          { inputType: null },
        ),
      );

      // Slider should be abandoned (cancelled), Button should emit as Click
      const sliderInt = emitted.find((i) => i.type === 'Slider');
      const clickInt = emitted.find((i) => i.type === 'Click');

      // Click should be emitted
      expect(clickInt).toBeDefined();
      expect(clickInt!.metadata.targetName).toBe('Submit');

      // Slider should be abandoned — not emitted as completed
      if (sliderInt) {
        expect(sliderInt.endState).not.toBe('completed');
      }
    });
  });

  describe('isInScope: only slider-lifecycle events on same element', () => {
    it('rejects events on different elements', () => {
      const { runtime, emitted } = setupRuntime();

      runtime.process(makeEvent('e1', 'focus', {}, {}, { valueBefore: '50' }));

      // Input on a different element should not be claimed by slider
      runtime.process(
        makeEvent('e2', 'input',
          { tag: 'INPUT', accessibleName: 'Name', stableId: 'name-field', cssSelector: '#name' },
          { inputType: 'text' },
          { valueBefore: '', valueAfter: 'hello' },
        ),
      );

      // Should not complete the slider
      expect(emitted.find((i) => i.type === 'Slider')).toBeUndefined();
    });
  });
});

// ── G7 Production Filter Tests ───────────────────────────────────────

describe('G7: Slider Production Filter', () => {
  function makeSliderInteraction(
    overrides: Partial<ComponentInteraction> = {},
  ): ComponentInteraction {
    return {
      interactionId: 'int-1',
      type: 'Slider',
      triggerEvent: makeObservedEvent({
        eventId: 'e1',
        eventType: 'focus',
      }),
      trigger: makeTarget(),
      memberEvents: [],
      startTime: 1000,
      endTime: 2000,
      metadata: { targetName: 'Volume', value: '60', userAdjusted: true },
      endState: 'completed',
      ...overrides,
    };
  }

  it('passes production filter when userAdjusted=true', () => {
    const interaction = makeSliderInteraction({
      metadata: { targetName: 'Volume', value: '60', userAdjusted: true },
    });
    expect(isProductionInteraction(interaction)).toBe(true);
  });

  it('fails production filter when userAdjusted=false (focus-only traversal)', () => {
    const interaction = makeSliderInteraction({
      metadata: { targetName: 'Volume', value: '50', userAdjusted: false },
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('fails production filter when userAdjusted is undefined', () => {
    const interaction = makeSliderInteraction({
      metadata: { targetName: 'Volume', value: '50' } as any,
    });
    expect(isProductionInteraction(interaction)).toBe(false);
  });

  it('toIRAction produces FILL for adjusted slider', () => {
    const interaction = makeSliderInteraction({
      metadata: { targetName: 'Volume', value: '60', userAdjusted: true },
    });
    const action = toIRAction(interaction);
    expect(action).not.toBeNull();
    expect(action!.type).toBe('FILL');
    expect((action as any).value).toBe('60');
  });
});

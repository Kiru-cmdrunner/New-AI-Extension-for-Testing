/**
 * Unit Tests: Confidence-Based Hover Model
 *
 * Tests the weighted evidence system where hover promotion depends on
 * accumulated confidence exceeding a threshold, not pass/fail rules.
 *
 * Key design principle: dwell is the WEAKEST form of evidence. It only
 * counts when combined with pointer stationarity and a longer duration.
 *
 * Spec: .drytis/specs/evidence-based-hover.md
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { hoverDefinition } from '../../src/definitions/hover';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
  ComponentContext,
} from '../../src/shared/component-types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div',
    xPath: '/html/body/div', inIframe: false, shadowDom: false, elementId: '',
    href: null,
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [],
    tabIndex: null,
    ...overrides,
  };
}

function makeEvent(
  eventId: string,
  eventType: string,
  target: Partial<ElementIdentity>,
  domContext: Partial<DomContext> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeDomContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

function makeCtx(trigger: ObservedEvent): ComponentContext {
  return {
    type: 'Hover', state: 'active', lifecycleId: 'lc-001', trigger: trigger.target,
    triggerEvent: trigger, memberEvents: [trigger], scopeKeys: new Set(),
    startTime: trigger.timestamp, endTime: 0, data: {},
  };
}

const BTN = { tag: 'BUTTON', ariaRole: 'button', stableId: 'btn1', accessibleName: 'Menu', cssSelector: 'button#btn1' };

// ── Transit Discard ───────────────────────────────────────────────────

describe('Confidence Hover — Transit Discard', () => {
  it('discards hover with 0 confidence (quick transit, no evidence)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
    expect(hover.metadata.confidence).toBe(0);
    expect(hover.metadata.meaningful).toBe(false);
  });

  it('discards hover at 2.5s without any evidence (below fallback threshold)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 3500 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
    expect(hover.metadata.confidence).toBe(0);
  });
});

// ── Very High Confidence: aria-expanded ───────────────────────────────

describe('Confidence Hover — aria-expanded (100)', () => {
  it('promotes instantly on aria-expanded transition', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { ...BTN, accessibleName: 'Expand Section' };

    runtime.process(makeEvent('me1', 'mouseenter', target, { ariaExpanded: false }, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', target, { ariaExpanded: true }, { timestamp: 1100 }));
    runtime.process(makeEvent('ml1', 'mouseleave', target, { ariaExpanded: true }, { timestamp: 1500 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.meaningful).toBe(true);
    expect(hover.metadata.confidence).toBe(100);
    expect(hover.metadata.evidenceReason).toBe('aria-expanded');
  });

  it('does NOT promote if aria-expanded was already true at enter', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ariaExpanded: true }, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ariaExpanded: true }, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
  });
});

// ── High Confidence: overlay role + dwell ─────────────────────────────

describe('Confidence Hover — Overlay Role (70)', () => {
  it('promotes menuitem hover after 500ms dwell', () => {
    const { runtime, emitted } = setupRuntime();
    const menuItem = { ...BTN, ariaRole: 'menuitem', accessibleName: 'File' };

    runtime.process(makeEvent('me1', 'mouseenter', menuItem, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', menuItem, {}, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', menuItem, {}, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.meaningful).toBe(true);
    expect(hover.metadata.confidence).toBe(70);
    expect(hover.metadata.evidenceReason).toBe('overlay-role-dwell');
  });

  it('promotes via ancestor role (tab ancestor)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.confidence).toBe(70);
  });

  it('does NOT promote overlay role before 500ms dwell', () => {
    const { runtime, emitted } = setupRuntime();
    const menuItem = { ...BTN, ariaRole: 'menuitem' };

    runtime.process(makeEvent('me1', 'mouseenter', menuItem, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', menuItem, {}, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
  });
});

// ── High Confidence: aria-haspopup + dwell ────────────────────────────

describe('Confidence Hover — aria-haspopup (60)', () => {
  it('promotes haspopup=menu after 500ms dwell', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { ...BTN, accessibleName: 'Open Menu' };

    runtime.process(makeEvent('me1', 'mouseenter', target, { ariaHasPopup: 'menu' }, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', target, { ariaHasPopup: 'menu' }, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', target, { ariaHasPopup: 'menu' }, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.meaningful).toBe(true);
    expect(hover.metadata.confidence).toBe(60);
    expect(hover.metadata.evidenceReason).toBe('haspopup-dwell');
  });

  it('does NOT promote haspopup before 500ms', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ariaHasPopup: 'tooltip' }, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ariaHasPopup: 'tooltip' }, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
  });
});

// ── Medium Confidence: sustained dwell + stationary (fallback) ─────────

describe('Confidence Hover — Sustained Dwell + Stationary (50, fallback)', () => {
  it('promotes after 3s with pointer stationary (< 10px)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000, clientX: 100, clientY: 200 }));
    // mousemoves that stay within 10px
    runtime.process(makeEvent('mm1', 'mousemove', BTN, {}, { timestamp: 2500, clientX: 103, clientY: 202 }));
    runtime.process(makeEvent('mm2', 'mousemove', BTN, {}, { timestamp: 4001, clientX: 105, clientY: 199 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 4100, clientX: 106, clientY: 201 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.meaningful).toBe(true);
    expect(hover.metadata.confidence).toBe(50);
    expect(hover.metadata.evidenceReason).toBe('sustained-dwell-stationary');
  });

  it('does NOT promote after 3s if pointer moved > 10px (not stationary)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000, clientX: 100, clientY: 200 }));
    // mousemoves that move well beyond 10px
    runtime.process(makeEvent('mm1', 'mousemove', BTN, {}, { timestamp: 2000, clientX: 150, clientY: 250 }));
    runtime.process(makeEvent('mm2', 'mousemove', BTN, {}, { timestamp: 4001, clientX: 145, clientY: 248 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 4100, clientX: 100, clientY: 200 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
    expect(hover.metadata.confidence).toBe(0);
  });

  it('does NOT promote at 2.9s even if stationary (below 3s threshold)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000, clientX: 100, clientY: 200 }));
    runtime.process(makeEvent('mm1', 'mousemove', BTN, {}, { timestamp: 2000, clientX: 102, clientY: 201 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 3900, clientX: 103, clientY: 202 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
  });

  it('thinking pause over disabled button does NOT promote (no evidence, dwell < 3s)', () => {
    const { runtime, emitted } = setupRuntime();
    const disabledBtn = { ...BTN, accessibleName: 'Submit', ariaRole: 'button' };

    runtime.process(makeEvent('me1', 'mouseenter', disabledBtn, { disabled: true }, { timestamp: 1000, clientX: 100, clientY: 200 }));
    runtime.process(makeEvent('mm1', 'mousemove', disabledBtn, { disabled: true }, { timestamp: 2500, clientX: 101, clientY: 201 }));
    runtime.process(makeEvent('ml1', 'mouseleave', disabledBtn, { disabled: true }, { timestamp: 2800, clientX: 102, clientY: 202 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('discarded');
    expect(hover.metadata.confidence).toBe(0);
  });
});

// ── Click Precedence ──────────────────────────────────────────────────

describe('Confidence Hover — Click Precedence', () => {
  it('discards hover when click fires on same element (Click wins)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('c1', 'click', BTN, {}, { timestamp: 1500 }));

    const click = emitted.find((e) => e.type === 'Click')!;
    expect(click).toBeDefined();
    expect(click.metadata.targetName).toBe('Menu');

    const hover = emitted.find((e) => e.type === 'Hover');
    if (hover) {
      expect(hover.endState).not.toBe('completed');
    }
  });

  it('discards hover when click fires elsewhere', () => {
    const { runtime, emitted } = setupRuntime();
    const other = { tag: 'BUTTON', ariaRole: 'button', stableId: 'btn2', accessibleName: 'Other', cssSelector: 'button#btn2' };

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('c1', 'click', other, {}, { timestamp: 1500 }));

    const click = emitted.find((e) => e.type === 'Click')!;
    expect(click.metadata.targetName).toBe('Other');

    const hover = emitted.find((e) => e.type === 'Hover');
    if (hover) {
      expect(hover.endState).not.toBe('completed');
    }
  });
});

// ── isInScope Exclusivity ─────────────────────────────────────────────

describe('Confidence Hover — isInScope Exclusivity', () => {
  const enter = makeEvent('me1', 'mouseenter', BTN);
  const ctx = makeCtx(enter);

  it('claims mouseenter, mouseleave, mousemove', () => {
    expect(hoverDefinition.isInScope(makeEvent('me2', 'mouseenter', BTN), ctx)).toBe(true);
    expect(hoverDefinition.isInScope(makeEvent('ml1', 'mouseleave', BTN), ctx)).toBe(true);
    expect(hoverDefinition.isInScope(makeEvent('mm1', 'mousemove', BTN), ctx)).toBe(true);
  });

  it('does NOT claim click, mousedown, focus, blur, input, change, keydown, scroll', () => {
    const excluded = ['click', 'mousedown', 'focus', 'blur', 'input', 'change', 'keydown', 'scroll'] as const;
    for (const et of excluded) {
      expect(hoverDefinition.isInScope(makeEvent('e1', et, BTN), ctx)).toBe(false);
    }
  });
});

// ── Confidence Stacking ───────────────────────────────────────────────

describe('Confidence Hover — Signal Stacking', () => {
  it('aria-expanded + haspopup signals stack confidence', () => {
    const { runtime, emitted } = setupRuntime();
    const target = { ...BTN, accessibleName: 'Expandable Menu' };

    runtime.process(makeEvent('me1', 'mouseenter', target, { ariaExpanded: false, ariaHasPopup: 'menu' }, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', target, { ariaExpanded: true, ariaHasPopup: 'menu' }, { timestamp: 1100 }));
    // dwell over 500ms — haspopup signal also fires
    runtime.process(makeEvent('mm2', 'mousemove', target, { ariaExpanded: true, ariaHasPopup: 'menu' }, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', target, { ariaExpanded: true, ariaHasPopup: 'menu' }, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover')!;
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.confidence).toBe(160); // 100 + 60
  });
});

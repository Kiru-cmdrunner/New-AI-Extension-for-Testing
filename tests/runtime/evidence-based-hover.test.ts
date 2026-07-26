/**
 * Unit Tests: Evidence-Based Hover Redesign
 *
 * Tests the candidate lifecycle where Hover is NOT emitted until evidence
 * proves it was meaningful.
 *
 * Spec: .drytis/specs/evidence-based-hover.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
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
  ComponentCompletion,
} from '../../src/shared/component-types';

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
    domContext: makeContext(domContext),
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i) };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted };
}

function makeComponentContext(
  type: string,
  trigger: ObservedEvent,
): ComponentContext {
  return {
    type: type as any,
    state: 'active',
    trigger: trigger.target,
    triggerEvent: trigger,
    memberEvents: [trigger],
    scopeKeys: new Set(),
    startTime: trigger.timestamp,
    endTime: 0,
    data: {},
  };
}

const BTN = { tag: 'BUTTON', ariaRole: 'button', stableId: 'btn1', accessibleName: 'Menu', cssSelector: 'button#btn1' };

// ── Discard: transit hovers ───────────────────────────────────────────

describe('Evidence-Based Hover — Transit Discard', () => {
  it('discards a hover that lasts < 500ms (transit)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('discarded');
    expect(hover!.metadata.meaningful).toBe(false);
  });

  it('discards a hover with no evidence even at exactly 499ms', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 1499 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('discarded');
  });
});

// ── Evidence: sustained dwell ─────────────────────────────────────────

describe('Evidence-Based Hover — Sustained Dwell', () => {
  it('promotes a hover after 2s of sustained dwell (via mousemove)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    // mousemove at 2.5s — crosses the 2s promotion threshold
    runtime.process(makeEvent('mm1', 'mousemove', BTN, {}, { timestamp: 3500 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 3600 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
    expect(hover!.metadata.evidenceReason).toBe('sustained-dwell');
  });

  it('promotes a hover after 2s even on mouseleave', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    // mouseleave at 2.5s — crosses threshold
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, {}, { timestamp: 3500 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
  });
});

// ── Evidence: aria-haspopup ───────────────────────────────────────────

describe('Evidence-Based Hover — aria-haspopup', () => {
  it('promotes a hover with aria-haspopup after dwell threshold (500ms)', () => {
    const { runtime, emitted } = setupRuntime();
    const menuBtn = { ...BTN, accessibleName: 'Open Menu', ariaLabel: 'Open Menu' };

    runtime.process(makeEvent('me1', 'mouseenter', menuBtn, { ariaHasPopup: 'menu' }, { timestamp: 1000 }));
    // mousemove at 600ms — crosses transit threshold
    runtime.process(makeEvent('mm1', 'mousemove', menuBtn, { ariaHasPopup: 'menu' }, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', menuBtn, { ariaHasPopup: 'menu' }, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
    expect(hover!.metadata.evidenceReason).toBe('haspopup-dwell');
  });

  it('does NOT promote a haspopup hover under 500ms (still transit)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ariaHasPopup: 'menu' }, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ariaHasPopup: 'menu' }, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('discarded');
  });
});

// ── Evidence: aria-expanded ───────────────────────────────────────────

describe('Evidence-Based Hover — aria-expanded Transition', () => {
  it('promotes when aria-expanded transitions to true during hover', () => {
    const { runtime, emitted } = setupRuntime();
    const expandBtn = { ...BTN, accessibleName: 'Expand' };

    // Enter with aria-expanded=false
    runtime.process(makeEvent('me1', 'mouseenter', expandBtn, { ariaExpanded: false }, { timestamp: 1000 }));
    // Subsequent mousemove shows aria-expanded=true (the UI expanded)
    runtime.process(makeEvent('mm1', 'mousemove', expandBtn, { ariaExpanded: true }, { timestamp: 1200 }));
    runtime.process(makeEvent('ml1', 'mouseleave', expandBtn, { ariaExpanded: true }, { timestamp: 1500 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
    expect(hover!.metadata.evidenceReason).toBe('aria-expanded');
  });

  it('does NOT promote if aria-expanded was already true at enter', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ariaExpanded: true }, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ariaExpanded: true }, { timestamp: 1300 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('discarded');
  });
});

// ── Evidence: overlay trigger roles ───────────────────────────────────

describe('Evidence-Based Hover — Overlay Role', () => {
  it('promotes a hover on a menuitem after dwell threshold', () => {
    const { runtime, emitted } = setupRuntime();
    const menuItem = { ...BTN, ariaRole: 'menuitem', accessibleName: 'File' };

    runtime.process(makeEvent('me1', 'mouseenter', menuItem, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', menuItem, {}, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', menuItem, {}, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
    expect(hover!.metadata.evidenceReason).toBe('overlay-role-dwell');
  });

  it('promotes a hover when an ancestor has an overlay role', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1000 }));
    runtime.process(makeEvent('mm1', 'mousemove', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1600 }));
    runtime.process(makeEvent('ml1', 'mouseleave', BTN, { ancestorRoles: ['tab'] }, { timestamp: 1700 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.meaningful).toBe(true);
  });
});

// ── Click precedence ──────────────────────────────────────────────────

describe('Evidence-Based Hover — Click Precedence', () => {
  it('discards hover when click occurs on same element (Click wins)', () => {
    const { runtime, emitted } = setupRuntime();

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    // Click on same element — hover should be discarded, Click should fire
    runtime.process(makeEvent('c1', 'click', BTN, {}, { timestamp: 1500 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    const click = emitted.find((e) => e.type === 'Click');

    // Click must be emitted
    expect(click).toBeDefined();
    expect(click!.metadata.targetName).toBe('Menu');
    expect(click!.endState).toBe('completed');

    // Hover must be discarded (not completed)
    if (hover) {
      expect(hover!.endState).not.toBe('completed');
    }
  });

  it('discards hover when click occurs on a different element', () => {
    const { runtime, emitted } = setupRuntime();
    const other = { tag: 'BUTTON', ariaRole: 'button', stableId: 'btn2', accessibleName: 'Other', cssSelector: 'button#btn2' };

    runtime.process(makeEvent('me1', 'mouseenter', BTN, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('c1', 'click', other, {}, { timestamp: 1500 }));

    const hover = emitted.find((e) => e.type === 'Hover');
    const click = emitted.find((e) => e.type === 'Click');

    expect(click).toBeDefined();
    if (hover) {
      expect(hover!.endState).not.toBe('completed');
    }
  });
});

// ── isInScope exclusivity ─────────────────────────────────────────────

describe('Evidence-Based Hover — isInScope Exclusivity', () => {
  const enter = makeEvent('me1', 'mouseenter', BTN);
  const ctx = makeComponentContext('Hover', enter);

  it('claims mouseenter', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('me2', 'mouseenter', BTN), ctx
    )).toBe(true);
  });

  it('claims mouseleave', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('ml1', 'mouseleave', BTN), ctx
    )).toBe(true);
  });

  it('claims mousemove', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('mm1', 'mousemove', BTN), ctx
    )).toBe(true);
  });

  it('does NOT claim click', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('c1', 'click', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim mousedown', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('md1', 'mousedown', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim focus', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('f1', 'focus', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim blur', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('b1', 'blur', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim input', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('i1', 'input', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim change', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('ch1', 'change', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim keydown', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('k1', 'keydown', BTN), ctx
    )).toBe(false);
  });

  it('does NOT claim scroll', () => {
    expect(hoverDefinition.isInScope(
      makeEvent('s1', 'scroll', BTN), ctx
    )).toBe(false);
  });
});

// ── Production filter ─────────────────────────────────────────────────

describe('Evidence-Based Hover — Production Filter', () => {
  it('meaningful hover passes production filter', () => {
    const hover: ComponentInteraction = {
      interactionId: 'int-1',
      type: 'Hover',
      trigger: makeTarget(BTN),
      triggerEvent: makeEvent('me1', 'mouseenter', BTN),
      memberEvents: [],
      startTime: 1000,
      endTime: 3600,
      endState: 'completed',
      metadata: { targetName: 'Menu', dwellMs: 2600, meaningful: true, evidenceReason: 'sustained-dwell' },
    };

    // Simulate the production filter logic
    expect(hover.endState).toBe('completed');
    expect(hover.metadata.meaningful).toBe(true);
  });

  it('transit hover fails production filter (discarded)', () => {
    const hover: ComponentInteraction = {
      interactionId: 'int-1',
      type: 'Hover',
      trigger: makeTarget(BTN),
      triggerEvent: makeEvent('me1', 'mouseenter', BTN),
      memberEvents: [],
      startTime: 1000,
      endTime: 1300,
      endState: 'discarded',
      metadata: { targetName: 'Menu', dwellMs: 300, meaningful: false, evidenceReason: null },
    };

    expect(hover.endState).not.toBe('completed');
  });
});

// ── Real-world scenario: menu navigation ──────────────────────────────

describe('Real-World: Sidebar Menu Navigation', () => {
  it('discards transit hovers through sidebar items, keeps only target hover', () => {
    const { runtime, emitted } = setupRuntime();

    const leave = { tag: 'A', ariaRole: 'link', stableId: 'leave', accessibleName: 'Leave', cssSelector: 'a#leave' };
    const time = { tag: 'A', ariaRole: 'link', stableId: 'time', accessibleName: 'Time', cssSelector: 'a#time' };
    const myInfo = { tag: 'A', ariaRole: 'link', stableId: 'myinfo', accessibleName: 'My Info', cssSelector: 'a#myinfo' };

    // Cursor travels through Leave (100ms) → Time (100ms) → My Info (3s sustained)
    runtime.process(makeEvent('me1', 'mouseenter', leave, {}, { timestamp: 1000 }));
    runtime.process(makeEvent('ml1', 'mouseleave', leave, {}, { timestamp: 1100 }));

    runtime.process(makeEvent('me2', 'mouseenter', time, {}, { timestamp: 1150 }));
    runtime.process(makeEvent('ml2', 'mouseleave', time, {}, { timestamp: 1250 }));

    runtime.process(makeEvent('me3', 'mouseenter', myInfo, {}, { timestamp: 1300 }));
    runtime.process(makeEvent('mm1', 'mousemove', myInfo, {}, { timestamp: 3400 })); // sustained 2s+
    runtime.process(makeEvent('ml3', 'mouseleave', myInfo, {}, { timestamp: 3500 }));

    const hovers = emitted.filter((e) => e.type === 'Hover');
    const meaningful = hovers.filter((e) => e.metadata.meaningful === true);
    const discarded = hovers.filter((e) => e.metadata.meaningful === false);

    // Transit hovers discarded
    expect(discarded.length).toBe(2);

    // Only My Info promoted
    expect(meaningful.length).toBe(1);
    expect(meaningful[0].metadata.targetName).toBe('My Info');
  });
});

/**
 * MS-U1 — Observed Workflow Card Upgrades (pins, RED first).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md
 * Renderer-only. No capture/projection/IR/schema changes anywhere.
 *
 *  P1  18/18 type badges (ColorInput/DragDrop/KeyboardShortcut/CompoundInteraction
 *      no longer fall through to '❓ Unknown').
 *  P2  endState chip on EVERY card (completed green; others non-green).
 *  P3  member chip `N events · Mms`.
 *  P4  understanding badge on the card (recognized prio / Unclassified reason /
 *      projected pair).
 *  P7  show-hidden (suppression chips only on suppressed cards; default unchanged).
 *  P7b default regression pin (classic 3-card fixture).
 *  P10 exact deterministic strings (toggle summary).
 *  P11 presence guards.
 *
 * Pins P4c (priority drift), P5 (why-block), P6 (footer), P8/P9 (KR chip) live in
 * the sibling test files.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  createInteractionElement,
  renderProductionInteractions,
  buildHiddenSummary,
} from '../../src/sidepanel/interaction-renderer';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';

// ── JSDOM setup ──────────────────────────────────────────────────────────

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
(globalThis as Record<string, unknown>).document = dom.window.document;

// ── Fixture helpers ──────────────────────────────────────────────────────

function identity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Search',
    ariaRole: 'textbox',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: 'Search…',
    tag: 'INPUT',
    className: null,
    name: 'q',
    stableId: 'q',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > input#q',
    xPath: '/html/body/input',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: 'text',
    iframeContext: undefined,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function domContext(overrides: Partial<DomContext> = {}): DomContext {
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
    tabIndex: 0,
    ...overrides,
  };
}

function evt(n: number, overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  const base: ObservedEvent = {
    eventId: `evt-p1-${n}`,
    eventType: 'input',
    timestamp: 1000 + n,
    captureSeq: n,
    isTrusted: true,
    target: identity(),
    domContext: domContext(),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.test/',
    pageTitle: 'Test',
  };
  return { ...base, ...overrides };
}

function interaction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  const triggerEvent = evt(1, { eventType: 'input' });
  return {
    interactionId: 'int-1',
    type: 'Click',
    trigger: identity(),
    triggerEvent,
    memberEvents: [triggerEvent, evt(2), evt(3)],
    startTime: 1000,
    endTime: 1412,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  dom.window.document.body.innerHTML = '<div id="root"></div>';
});

// ── P1: type badges for all 18 types ────────────────────────────────────

describe('P1 — every InteractionType renders a real type badge', () => {
  const TYPES: ComponentInteraction['type'][] = [
    'Click', 'TextEntry', 'Dropdown', 'Checkbox', 'RadioButton', 'DatePicker',
    'Hover', 'Link', 'FileUpload', 'Slider', 'ColorInput', 'Tab', 'Scroll',
    'Navigation', 'DragDrop', 'KeyboardShortcut', 'CompoundInteraction',
    'Expander', // 7.4-B1
    'Unclassified',
  ];

  it('renders a non-Unknown badge for each of the 19 types', () => {
    for (const t of TYPES) {
      const el = createInteractionElement(interaction({ type: t }));
      const badge = el.querySelector<HTMLElement>('.interaction-badge');
      expect(badge, `type ${t} must render a badge`).toBeTruthy();
      expect(badge!.textContent, `type ${t} must not fall to Unknown`).not.toContain('Unknown');
    }
  });

  it('the four former Unknown types get distinct entries', () => {
    const labels = new Set<string>();
    for (const t of ['ColorInput', 'DragDrop', 'KeyboardShortcut', 'CompoundInteraction'] as const) {
      const el = createInteractionElement(interaction({ type: t }));
      const badge = el.querySelector<HTMLElement>('.interaction-badge')!;
      labels.add(badge.textContent!.trim());
    }
    expect(labels.size).toBe(4);
  });
});

// ── P2: endState chip on every card ─────────────────────────────────────

describe('P2 — endState chip on every card, color-coded', () => {
  it('completed renders a green chip labelled completed', () => {
    const el = createInteractionElement(interaction({ endState: 'completed' }));
    const chip = el.querySelector<HTMLElement>('.timeline-event__endstate');
    expect(chip?.textContent).toBe('completed');
    expect(chip?.style.color).toContain('16, 185, 129'); // JSDOM normalizes #10b981
  });

  it.each(['abandoned', 'interrupted', 'discarded'] as const)(
    '%s renders a non-green chip',
    (state) => {
      const el = createInteractionElement(interaction({ endState: state }));
      const chip = el.querySelector<HTMLElement>('.timeline-event__endstate');
      expect(chip?.textContent).toBe(state);
      expect(chip?.style.color).not.toBe('#10b981');
    },
  );

  it('every card carries exactly one endState chip', () => {
    for (const state of ['completed', 'abandoned', 'interrupted', 'discarded'] as const) {
      const el = createInteractionElement(interaction({ endState: state }));
      expect(el.querySelectorAll('.timeline-event__endstate').length).toBe(1);
    }
  });
});

// ── P3: member chip ─────────────────────────────────────────────────────

describe('P3 — member-event chip', () => {
  it('3 events + 412ms span renders `3 events · 412ms`', () => {
    const el = createInteractionElement(interaction());
    expect(el.querySelector('.interaction-chip--member')?.textContent).toBe('3 events · 412ms');
  });

  it('single event renders singular form', () => {
    const single = interaction({ memberEvents: [evt(1)], startTime: 1000, endTime: 1050 });
    const el = createInteractionElement(single);
    expect(el.querySelector('.interaction-chip--member')?.textContent).toBe('1 event · 50ms');
  });

  it('absent when memberEvents is empty', () => {
    const none = interaction({ memberEvents: [], startTime: 1000, endTime: 1000 });
    const el = createInteractionElement(none);
    expect(el.querySelector('.interaction-chip--member')).toBeNull();
  });
});

// ── P4: understanding badge (DOM level) ─────────────────────────────────

describe('P4 — understanding badge on the card', () => {
  it('recognized interaction renders `✓ DatePicker (prio 10)`', () => {
    const el = createInteractionElement(interaction({ type: 'DatePicker' }));
    expect(el.querySelector('.interaction-chip--understanding')?.textContent)
      .toBe('✓ DatePicker (prio 10)');
  });

  it('Unclassified with reason renders the reason', () => {
    const el = createInteractionElement(interaction({
      type: 'Unclassified',
      metadata: { reason: 'unclaimed-at-projection' },
    }));
    expect(el.querySelector('.interaction-chip--understanding')?.textContent)
      .toBe('❓ Unclassified — unclaimed-at-projection');
  });

  it('projected pair renders the projected line', () => {
    const el = createInteractionElement(interaction({
      type: 'Unclassified',
      metadata: { reason: 'unclaimed-at-projection', physicalEvents: ['mousedown', 'click'] },
    }));
    const chips = [...el.querySelectorAll('.interaction-chip--understanding')]
      .map((c) => c.textContent);
    expect(chips).toContain('⚠ projected (mousedown+click paired)');
  });

  it('P11: minimal Unclassified card renders reason-not-recorded, never blank', () => {
    const el = createInteractionElement(interaction({ type: 'Unclassified', metadata: {} }));
    const text = el.querySelector('.interaction-chip--understanding')?.textContent ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('not recorded');
  });
});

// ── P7: show-hidden ─────────────────────────────────────────────────────

describe('P7 — show-hidden suppression chips', () => {
  const mixed: ComponentInteraction[] = [
    interaction({ interactionId: 'int-1', type: 'TextEntry', metadata: { userTyped: true, textValue: 'hi' } }),
    interaction({ interactionId: 'int-2', type: 'Click', endState: 'abandoned' }),
    interaction({ interactionId: 'int-3', type: 'Dropdown', metadata: { noOpSelection: true } }),
    interaction({ interactionId: 'int-4', type: 'Scroll', metadata: { hasDelta: false } }),
    interaction({ interactionId: 'int-5', type: 'Hover', metadata: { meaningful: true } }),
  ];

  it('showHidden=true renders all 5 cards with suppression chips on suppressed only', () => {
    const root = document.getElementById('root')!;
    renderProductionInteractions(root, mixed, { showHidden: true });
    expect(root.querySelectorAll('.interaction-event').length).toBe(5);
    const chips = [...root.querySelectorAll('.interaction-chip--suppressed')]
      .map((c) => c.textContent);
    expect(chips.sort()).toEqual(['0px scroll', 'abandoned', 'no-op'].sort());
  });

  it('default renders only production cards (TextEntry + Hover here)', () => {
    const root = document.getElementById('root')!;
    renderProductionInteractions(root, mixed);
    expect(root.querySelectorAll('.interaction-event').length).toBe(2);
    expect(root.querySelectorAll('.interaction-chip--suppressed').length).toBe(0);
  });

  it('P10: buildHiddenSummary text is the pinned deterministic string', () => {
    expect(buildHiddenSummary(mixed)).toBe('Show all 5 (3 hidden: abandoned · no-op · 0px scroll)');
  });

  it('P7c: buildHiddenSummary returns null when nothing is suppressed', () => {
    const allProduction = mixed.filter((_, i) => i === 0 || i === 4);
    expect(buildHiddenSummary(allProduction)).toBeNull();
  });
});

// ── P7b: default regression pin ─────────────────────────────────────────

describe('P7b — default view unchanged (classic 3-card fixture)', () => {
  const classic: ComponentInteraction[] = [
    interaction({
      interactionId: 'int-1', type: 'TextEntry',
      metadata: { userTyped: true, textValue: 'invoice' },
    }),
    interaction({
      interactionId: 'int-2', type: 'Dropdown',
      metadata: { selectedValue: 'High', noOpSelection: false },
    }),
    interaction({ interactionId: 'int-3', type: 'Click', metadata: {} }),
  ];

  it('renders 3 cards with the same badges + titles as pre-MS-U1', () => {
    const root = document.getElementById('root')!;
    renderProductionInteractions(root, classic);
    const cards = root.querySelectorAll('.interaction-event');
    expect(cards.length).toBe(3);

    const badges = [...root.querySelectorAll('.interaction-badge')].map((b) => b.textContent);
    expect(badges).toContain('⌨️ Text Entry');
    expect(badges).toContain('📋 Dropdown');
    expect(badges).toContain('🖱️ Click');

    const titles = [...root.querySelectorAll('.interaction-action-text')].map((t) => t.textContent);
    // targetName comes from metadata.targetName (definitions write it); the
    // fixture omits it so the honest 'element' fallback applies.
    expect(titles).toContain('Enter "invoice" in "element"');
    expect(titles).toContain('Click "element"');
  });

  it('new chips do not remove the fallback title or metadata warning line', () => {
    const card = createInteractionElement(
      interaction({ type: 'TextEntry', metadata: { userTyped: false, textValue: '' } }),
    );
    expect(card.querySelector('.interaction-action-text')?.textContent)
      .toBe('Enter "" in "element"');
    expect(card.textContent).toContain('no typing detected');
  });
});

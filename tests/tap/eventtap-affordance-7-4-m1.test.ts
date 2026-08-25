/**
 * Phase 7.4-M1 — integration pins: capture → DomContext → classification,
 * through the REAL EventTap in jsdom.
 *
 * Spec .drytis/specs/phase-7-4-m1-affordance-capture.md (baseline aca8082):
 *   C1 pointerCursor wired end-to-end on a stylesheet-styled plain div
 *   C2 runtime classification yields a Click (not Unclassified)
 *   C3 affordance is a FACT AT EVENT TIME (cursor removed later → Unclassified)
 *   C4 child-click lift: inner span resolves to the pointer-styled parent
 *
 * Generic fixture shapes only — no test attributes, no site tokens.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEventTap, TEST_HOOK } from '../../src/tap/event-tap';
import { clickDefinition } from '../../src/definitions/click';
import type { ObservedEvent } from '../../src/shared/component-types';

function mountChip(): HTMLElement {
  // NOTE: class name deliberately avoids every INTERACTIVE_CLASS_RE token
  // (chip/btn/menu-item/…) so ONLY the affordance gate can claim this target.
  const style = document.createElement('style');
  style.textContent = '.m1-sort { cursor: pointer; }';
  document.head.appendChild(style);
  const chip = document.createElement('div');
  chip.className = 'm1-sort';
  chip.id = 'chip';
  chip.textContent = 'Sort by departure';
  document.body.appendChild(chip);
  return chip;
}

describe('7.4-M1 C-series — EventTap affordance integration', () => {
  let tapHandle: ReturnType<typeof createEventTap> | null = null;
  let captured: ObservedEvent[] = [];

  beforeEach(() => {
    captured = [];
    document.body.innerHTML = '';
    document.head.querySelectorAll('style').forEach((s) => s.remove());
    TEST_HOOK.forceTrusted = true;
  });

  afterEach(() => {
    TEST_HOOK.forceTrusted = false;
    tapHandle?.stop();
    tapHandle = null;
  });

  function captureClick(el: Element): ObservedEvent {
    tapHandle = createEventTap({ onEvent: (e) => captured.push(e) });
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const evt = captured.find((e) => e.eventType === 'click');
    if (!evt) throw new Error('click event was not captured');
    return evt;
  }

  it('C1: stylesheet-styled plain div → domContext.pointerCursor === true', () => {
    const chip = mountChip();
    const evt = captureClick(chip);
    expect(evt.domContext.pointerCursor).toBe(true);
  });

  it('C2: pointer-styled chip classifies as Click (not Unclassified)', () => {
    const chip = mountChip();
    const evt = captureClick(chip);
    const trigger = clickDefinition.detectTrigger(evt);
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('C3: same element with cursor REMOVED → pointerCursor false → Unclassified (fact at event time)', () => {
    const chip = mountChip();
    // First click WITH the affordance class
    const evt1 = captureClick(chip);
    expect(evt1.domContext.pointerCursor).toBe(true);

    // Remove the affordance — the next event must see the NEW truth
    captured = [];
    chip.className = '';
    const evt2 = captureClick(chip);
    expect(evt2.domContext.pointerCursor).toBe(false);
    expect(clickDefinition.detectTrigger(evt2)).toBeNull();
  });

  it('C4: child-click lift — inner span with cursor:auto resolves to the pointer parent', () => {
    const chip = mountChip();
    // Real Chrome inherits cursor:pointer to children, so a bare inner span
    // is itself affordance-carrying (the span IS the resolved target there —
    // E2E V3 pinned that Chrome truth on 2026-08-25). The LIFT behavior is
    // engine-divergent for inherited cursors, so this pin forces the one
    // shape where lift is deterministic in EVERY engine: the leaf explicitly
    // opts OUT of the inherited pointer (cursor:auto) and has no interactive
    // signal of its own → Strategy 2 must walk up to the pointer-styled chip.
    chip.innerHTML = '<span class="chip-label" style="cursor: auto">Sort</span>';
    const span = chip.querySelector('span')!;
    const evt = captureClick(span);

    // resolveTarget must have lifted to the pointer-styled parent. The span
    // has no id, so an UNlifted capture would carry a span-chain selector;
    // the id selector '#chip' (id > class precedence) proves the resolved
    // element is the chip div itself, and pointerCursor on that same event
    // proves the context was extracted from the RESOLVED target.
    expect(evt.target.tag).toBe('DIV');
    expect(evt.target.cssSelector).toBe('#chip');
    // …and the parent's affordance must be in the persisted context.
    expect(evt.domContext.pointerCursor).toBe(true);
    expect(clickDefinition.detectTrigger(evt)).toEqual({ type: 'Click' });
  });

  it('C4b: inherited-pointer leaf (Chrome truth) is claimed on ITSELF with pointerCursor=true', () => {
    const chip = mountChip();
    // jsdom does not cascade cursor into children — emulate the inherited
    // computed style a real browser reports for a bare span under a
    // cursor:pointer parent. This is the E2E V3 observation, unit-pinned:
    // the leaf is a legitimate affordance target; no parent lift required.
    chip.innerHTML = '<span class="chip-label">Sort</span>';
    const span = chip.querySelector('span')!;
    const getCS = window.getComputedStyle;
    (window as any).getComputedStyle = (el: Element) => {
      const s = getCS(el);
      return el === span ? ({ ...s, cursor: 'pointer' } as CSSStyleDeclaration) : s;
    };
    try {
      const evt = captureClick(span);
      expect(evt.target.tag).toBe('SPAN');
      expect(evt.domContext.pointerCursor).toBe(true);
      expect(clickDefinition.detectTrigger(evt)).toEqual({ type: 'Click' });
    } finally {
      (window as any).getComputedStyle = getCS;
    }
  });
});

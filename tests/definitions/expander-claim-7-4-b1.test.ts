/**
 * 7.4-B1 Expander — claim-matrix pins (spec phase-7-4-b1-expander.md AC-2/3).
 *
 * Every fixture shape is GENERIC: no test attributes, no site tokens. The
 * only signal under test is the W3C/ARIA disclosure convention aria-expanded.
 */
import { describe, it, expect } from 'vitest';
import { expanderDefinition } from '../../src/definitions/expander';
import { clickDefinition } from '../../src/definitions/click';
import { tabDefinition } from '../../src/definitions/tab';
import { linkDefinition } from '../../src/definitions/link';
import { ALL_DEFINITIONS } from '../../src/definitions';
import type { ObservedEvent, DomContext } from '../../src/shared/component-types';
/** Minimal event builder in the house pattern (click-claim-wb-7-3). */
function makeEvent(over: {
  tag: string; ariaRole?: string | null; className?: string | null;
  domContext?: Partial<DomContext>;
}): ObservedEvent {
  const domContext: DomContext = {
    inputType: null, ariaExpanded: null, ariaHasPopup: null,
    isContentEditable: false, disabled: false, readOnly: false, required: false,
    ancestorRoles: [], ancestorClasses: [], tabIndex: null,
    ...over.domContext,
  };
  return {
    eventId: 'evt-p-0-1', eventType: 'click', timestamp: 1, captureSeq: 1,
    target: {
      tag: over.tag, ariaRole: over.ariaRole ?? null, className: over.className ?? null,
      autoId: null, dataAutoId: null,
    },
    domContext,
    // remaining fields unused by detectTrigger; cast for type simplicity
  } as unknown as ObservedEvent;
}

describe('7.4-B1 Expander claim matrix', () => {
  it('B1-1: <button aria-expanded="false"> → Expander (not Click)', () => {
    const e = makeEvent({ tag: 'BUTTON', domContext: { ariaExpanded: false } });
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' });
    // and the runtime ordering guarantees Expander (80) is tried before Click (180)
  });

  it('B1-2: plain <div aria-expanded="true"> → Expander (no affordance needed)', () => {
    const e = makeEvent({ tag: 'DIV', className: 'x', domContext: { ariaExpanded: true } });
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' });
  });

  it('B1-3: pointer-styled div + aria-expanded → Expander (composes with 7.4-M1)', () => {
    const e = makeEvent({
      tag: 'DIV', className: 'x',
      domContext: { ariaExpanded: false, pointerCursor: true },
    });
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' });
  });

  it('B1-4: role="button" aria-expanded → Expander', () => {
    const e = makeEvent({ tag: 'DIV', ariaRole: 'button', domContext: { ariaExpanded: true } });
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' });
  });

  it('B1-5: <button> WITHOUT aria-expanded → Expander declines (Click keeps it)', () => {
    const e = makeEvent({ tag: 'BUTTON' });
    expect(expanderDefinition.detectTrigger(e)).toBeNull();
    expect(clickDefinition.detectTrigger(e)).toEqual({ type: 'Click' });
  });

  it('B1-6: div WITHOUT aria-expanded + pointerCursor → still Click (7.4-M1 unchanged)', () => {
    const e = makeEvent({ tag: 'DIV', className: 'x', domContext: { pointerCursor: true } });
    expect(expanderDefinition.detectTrigger(e)).toBeNull();
    expect(clickDefinition.detectTrigger(e)).toEqual({ type: 'Click' });
  });

  it('B1-7: role="tab" aria-expanded → Tab (priority 65 wins — no steal)', () => {
    const e = makeEvent({ tag: 'DIV', ariaRole: 'tab', domContext: { ariaExpanded: true } });
    // Tab's own detectTrigger must claim it; Expander would too, but the
    // runtime tries Tab first (65 < 80).
    expect(tabDefinition.detectTrigger(e)).toEqual({ type: 'Tab' });
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' }); // claims if reached
  });

  it('B1-8: contextmenu does NOT trigger Expander (click-only)', () => {
    const e = makeEvent({ tag: 'BUTTON', domContext: { ariaExpanded: false } });
    (e as { eventType: string }).eventType = 'contextmenu';
    expect(expanderDefinition.triggerEventTypes.has('contextmenu')).toBe(false);
  });

  it('B1-9: registry — Expander registered at priority 80; runtime sort places it after Link(70) and before Scroll(110)/Click(180)', () => {
    expect(ALL_DEFINITIONS.map((d) => d.type)).toContain('Expander');
    // The registry array is NOT priority-sorted by convention (ColorInput 15
    // historically sits after Slider 25); the CONTRACT is that the runtime
    // sorts ascending before discovery (component-runtime.ts:241). Pin the
    // runtime behavior, not the array accident.
    const sorted = [...ALL_DEFINITIONS].sort((a, b) => a.priority - b.priority);
    const idx = sorted.findIndex((d) => d.type === 'Expander');
    expect(sorted[idx - 1].priority).toBeLessThanOrEqual(80);
    expect(sorted[idx + 1].priority).toBeGreaterThanOrEqual(80);
    expect(expanderDefinition.priority).toBe(80);
    // And the claim-order reality that matters: Expander outranks Click only.
    expect(expanderDefinition.priority).toBeLessThan(180);
    expect(expanderDefinition.priority).toBeGreaterThan(linkDefinition.priority);
  });

  it('B1-10: immediate completion, no lifecycle', () => {
    expect(expanderDefinition.isInScope(makeEvent({ tag: 'BUTTON', domContext: { ariaExpanded: false } }) as never, {} as never)).toBe(false);
    expect(expanderDefinition.handleEvent(makeEvent({ tag: 'BUTTON', domContext: { ariaExpanded: false } }) as never, {} as never)).toEqual({ endState: 'completed' });
  });

  it('B1-11: buildResult carries targetName + expandedAtTrigger (pre-flip diagnostic)', () => {
    const e = makeEvent({ tag: 'BUTTON', domContext: { ariaExpanded: false } });
    const ctx = {
      trigger: {
        accessibleName: 'More filters', ariaLabel: null, placeholder: null,
        className: null, tag: 'BUTTON', ariaRole: null,
      },
      triggerEvent: { clientX: 10, clientY: 20, domContext: e.domContext },
    } as never;
    const r = expanderDefinition.buildResult(ctx, { endState: 'completed' });
    expect(r.metadata?.targetName).toBe('More filters');
    expect((r.metadata as Record<string, unknown>).expandedAtTrigger).toBe(false);
  });

  it('B1-12: domContext WITHOUT the ariaExpanded field (old sessions, partial contexts) → honest decline', () => {
    // 6D.1 W3 AC-W3a regression: a domContext literal that omits
    // ariaExpanded yields undefined; a strict `!== null` gate over-claims
    // it as Expander, stealing clicks from the Click fallback. Only an
    // actual true/false attribute value claims (extractor always emits
    // null|boolean; undefined = pre-7.4-B1/legacy shape → decline).
    const e = makeEvent({ tag: 'LI', className: 'opt' });
    delete (e.domContext as unknown as Record<string, unknown>).ariaExpanded;
    expect(expanderDefinition.detectTrigger(e)).toBeNull();
    // and the Click surface path still claims it exactly as in 6D.1:
    const e2 = makeEvent({ tag: 'LI', className: 'opt' });
    delete (e2.domContext as unknown as Record<string, unknown>).ariaExpanded;
    e2.domContext.ancestorClasses = ['options-list'];
    expect(clickDefinition.detectTrigger(e2)).toEqual({ type: 'Click' });
  });

  it('B1-13 (added 2026-08-25, reviewer WARN-1 — spec B1-8 restored): SELECT + aria-expanded → Dropdown wins (priority 20 < 80) — Expander never steals native select-family triggers', () => {
    const e = makeEvent({ tag: 'SELECT', domContext: { ariaExpanded: true } });
    // Both claim in isolation — the runtime ordering is the guard under test:
    expect(expanderDefinition.detectTrigger(e)).toEqual({ type: 'Expander' }); // claims if reached
    // The dropdown definition family (priority 20) is consulted FIRST; pin the
    // ordering contract directly against the runtime-sorted registry.
    const sorted = [...ALL_DEFINITIONS].sort((a, b) => a.priority - b.priority);
    const dropdownIdx = sorted.findIndex(d => d.type === 'Dropdown');
    const expanderIdx = sorted.findIndex(d => d.type === 'Expander');
    expect(dropdownIdx).toBeGreaterThanOrEqual(0);
    expect(expanderIdx).toBeGreaterThan(dropdownIdx);
    // (End-to-end Dropdown completion for native selects is already pinned by
    // the dropdown suite; the ordering pin above is the Expander-scoped guard.)
  });
});

/**
 * Phase 6D.0 — Semantic Surface Vocabulary Normalization (regression pins)
 *
 * Spec: `.drytis/specs/phase-6d0-surface-vocabulary-normalization.md`
 *
 * Root cause pinned by the int-47 card RCA (2026-08-21): ancestor role entries
 * arrive from capture as `tag[role=x]` (e.g. `div[role=dialog]`) but four
 * comparison sites test against bare tokens ('dialog', 'listbox', …) — so the
 * role-based branches were dead against REAL captured data (tests only passed
 * because fixtures hand-fed bare tokens). These pins lock the normalized
 * comparison AND the DIALOG_RE ⊆ surface-vocabulary alignment (`popup`).
 *
 * Constraints honored: generic fix, no AdaniOne-specific rules; ledger /
 * projection / IR / NOISE_TYPES untouched; no timing rules.
 */

import { describe, it, expect } from 'vitest';
import {
  isInsideOpenSelectionSurface,
  extractSemanticRoles,
} from '../../src/definitions/patterns';
import { clickDefinition } from '../../src/definitions/click';
import { createRuntime, lifecycleOwnsTarget } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentContext,
  ComponentInteraction,
  RuntimeConfig,
  ObservedEvent,
  ElementIdentity,
  DomContext,
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
    href: null,
    inputType: null,
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

// ── extractSemanticRoles ─────────────────────────────────────────────

describe('Phase 6D.0 — extractSemanticRoles (format normalization)', () => {
  it('derives the semantic role from tag[role=x] entries', () => {
    const roles = extractSemanticRoles(['div[role=dialog]', 'ul', 'li[role=option]']);
    expect(roles).toContain('dialog');
    expect(roles).toContain('option');
    expect(roles).toContain('ul'); // bare tag entries preserved (native surfaces)
  });

  it('splits multi-token roles (div[role=button menuitem])', () => {
    const roles = extractSemanticRoles(['div[role=button menuitem]']);
    expect(roles).toContain('button');
    expect(roles).toContain('menuitem');
  });

  it('handles empty input', () => {
    expect(extractSemanticRoles([])).toEqual([]);
  });

  it('is case-sensitive (ARIA roles are lowercase)', () => {
    expect(extractSemanticRoles(['div[role=Dialog]'])).not.toContain('dialog');
    expect(extractSemanticRoles(['div[role=dialog]'])).toContain('dialog');
  });

  it('unwraps quoted role syntax div[role="dialog"] deterministically', () => {
    // defensive: capture never emits quotes, but persisted variants must
    // still parse deterministically.
    expect(extractSemanticRoles(['div[role="dialog"]'])).toContain('dialog');
  });

  it('emits semantic tokens only (no raw bracketed entries in output)', () => {
    expect(extractSemanticRoles(['div[role=dialog]'])).not.toContain('div[role=dialog]');
  });
});

// ── LP1: isInsideOpenSelectionSurface with REAL capture format ────────

describe('Phase 6D.0 — LP1 role branch now live (real capture format)', () => {
  it('recognizes div[role=dialog] ancestry (int-47 regression)', () => {
    expect(isInsideOpenSelectionSurface(['div', 'div[role=dialog]'], [])).toBe(true);
  });

  it('recognizes div[role=listbox] ancestry', () => {
    expect(isInsideOpenSelectionSurface(['div[role=listbox]'], [])).toBe(true);
  });

  it('recognizes div[role=menu] and div[role=grid] ancestry', () => {
    expect(isInsideOpenSelectionSurface(['div[role=menu]'], [])).toBe(true);
    expect(isInsideOpenSelectionSurface(['div[role=grid]'], [])).toBe(true);
  });

  it('negative space holds: generic roles rejected in both formats', () => {
    expect(isInsideOpenSelectionSurface(['main', 'navigation', 'form'], [])).toBe(false);
    expect(isInsideOpenSelectionSurface(['div[role=main]'], [])).toBe(false);
    expect(isInsideOpenSelectionSurface(['div[role=navigation]'], [])).toBe(false);
  });

  it('bare non-surface tags (div/span) are not surfaces', () => {
    expect(isInsideOpenSelectionSurface(['div', 'span'], [])).toBe(false);
  });

  it('empty ancestry stays rejected', () => {
    expect(isInsideOpenSelectionSurface([], [])).toBe(false);
  });

  it('case pin preserved: div[role=Dialog] is not a surface', () => {
    expect(isInsideOpenSelectionSurface(['div[role=Dialog]'], [])).toBe(false);
  });
});

// ── Vocabulary alignment: DIALOG_RE tokens ⊆ surface class vocabulary ─

describe('Phase 6D.0 — surface vocabulary aligned with DIALOG_RE', () => {
  it('accepts popup-class ancestor (was Dialog-enriched but not Click-eligible)', () => {
    expect(isInsideOpenSelectionSurface([], ['traveler-popup'])).toBe(true);
    expect(isInsideOpenSelectionSurface([], ['popup show'])).toBe(true);
  });

  it('accepts framework dialog families (substring-covered by dialog/modal)', () => {
    expect(isInsideOpenSelectionSurface([], ['MuiDialog-root'])).toBe(true);
    expect(isInsideOpenSelectionSurface([], ['ant-modal-wrap'])).toBe(true);
    expect(isInsideOpenSelectionSurface([], ['p-dialog'])).toBe(true);
  });

  it('rejects generic layout ancestry (unchanged negative space)', () => {
    expect(isInsideOpenSelectionSurface([], ['row', 'container', 'flex'])).toBe(false);
  });
});

// ── click.detectTrigger integration: int-47 promotion path ────────────

describe('Phase 6D.0 — click.detectTrigger gate with real-format ancestry', () => {
  function baseEvent(over: { ancestorRoles?: string[]; ancestorClasses?: string[] }) {
    return makeEvent('e1', 'click', { tag: 'DIV' }, {
      ancestorRoles: over.ancestorRoles ?? [],
      ancestorClasses: over.ancestorClasses ?? [],
    });
  }

  it('bare div with div[role=dialog] ancestry → Click (int-47 regression pin)', () => {
    expect(
      clickDefinition.detectTrigger(baseEvent({ ancestorRoles: ['div', 'div[role=dialog]'] })),
    ).toEqual({ type: 'Click' });
  });

  it('bare div with popup-class ancestry → Click', () => {
    expect(
      clickDefinition.detectTrigger(baseEvent({ ancestorClasses: ['traveler-popup show'] })),
    ).toEqual({ type: 'Click' });
  });

  it('bare div with generic bracketed ancestry → claims Click (v1.2 flip)', () => {
    // Click Qualification v1.2 §8.5: surface ancestry no longer gates
    // detectTrigger; qualification is capture-time.
    expect(
      clickDefinition.detectTrigger(baseEvent({ ancestorRoles: ['div[role=main]'] })),
    ).toEqual({ type: 'Click' });
  });

  it('bare div with no ancestry → claims Click (v1.2 flip)', () => {
    expect(clickDefinition.detectTrigger(baseEvent({}))).toEqual({ type: 'Click' });
  });
});

// ── Dropdown S3' containment proof (b): real-format surfaceRole match ─

describe('Phase 6D.0 — dropdown containment proof (b) with real format', () => {
  function optionClickEvent(ancestorRoles: string[]) {
    return makeEvent(
      'opt1',
      'click',
      { tag: 'DIV', ariaRole: 'option', accessibleName: 'Premium Economy' },
      { ancestorRoles },
    );
  }

  function armDropdown(runtime: ReturnType<typeof createRuntime>, triggerId: string) {
    runtime.process(
      makeEvent(
        triggerId,
        'click',
        { tag: 'DIV', className: 'custom-select trigger' },
        { ariaHasPopup: 'listbox', ariaExpanded: true },
      ),
    );
  }

  it('completes with selectionConfirmed when option sits under div[role=listbox]', () => {
    const { runtime, emitted } = setupRuntime();
    armDropdown(runtime, 't1');
    expect(runtime.activeCount).toBe(1);

    // Option click with REAL capture-format ancestry. Before 6D.0, proof (b)
    // compared 'listbox' against 'div[role=listbox]' (never equal) and the
    // click was parked instead of completing.
    runtime.process(optionClickEvent(['div[role=listbox]']));

    const sel = emitted.find((i) => i.type === 'Dropdown');
    expect(sel).toBeDefined();
    expect(sel!.metadata.selectedValue).toBe('Premium Economy');
    // 7.4-B2b (dropdown-whyline-dead-path fix): a CONFIRMED completion now
    // WRITES selectionConfirmed=true — the key the IR bridge gate reads for
    // the two-step CLICK path on INPUT-triggered Dropdowns, and the panel
    // why-line. Previously this was undefined (the documented dead path).
    expect(sel!.metadata.selectionConfirmed).toBe(true);
    expect(sel!.endState).toBe('completed');
  });

  it('bare-format parity: option under plain [\'listbox\'] entry also completes', () => {
    const { runtime, emitted } = setupRuntime();
    armDropdown(runtime, 't2');
    runtime.process(optionClickEvent(['listbox']));
    const sel = emitted.find((i) => i.type === 'Dropdown');
    expect(sel).toBeDefined();
    expect(sel!.endState).toBe('completed');
    expect(sel!.metadata.selectedValue).toBe('Premium Economy');
  });

  it('parks (no completion) when ancestry has no listbox — honesty preserved', () => {
    const { runtime, emitted } = setupRuntime();
    armDropdown(runtime, 't3');
    runtime.process(optionClickEvent(['div[role=main]', 'section']));

    const sel = emitted.find((i) => i.type === 'Dropdown');
    expect(sel).toBeUndefined(); // parked as provisional, not completed
  });
});

// ── lifecycleOwnsTarget Part 2: real-format surface containment ──────

describe('Phase 6D.0 — lifecycleOwnsTarget Part 2 with real format', () => {
  function makeCtx(type: string, surfaceRole: string | null): ComponentContext {
    return {
      lifecycleId: 'lc-1',
      type: type as any,
      state: 'active',
      trigger: makeTarget({ tag: 'DIV', ariaRole: 'combobox' }),
      triggerEvent: makeEvent('trg', 'click', { tag: 'DIV', ariaRole: 'combobox' }),
      startTime: 1_000,
      lastActivityTime: 1_000,
      memberEvents: [],
      data: surfaceRole != null ? { surfaceRole } : {},
    } as unknown as ComponentContext;
  }

  function findDef(type: string) {
    return ALL_DEFINITIONS.find((d) => d.type === type)!;
  }

  it('gridchild under div[role=grid] with surfaceRole=grid → OWNED', () => {
    const evt = makeEvent(
      'g1', 'click',
      { tag: 'DIV', ariaRole: 'gridcell' },
      { ancestorRoles: ['div[role=grid]'] },
    );
    expect(lifecycleOwnsTarget(evt, makeCtx('DatePicker', 'grid'), findDef('DatePicker'))).toBe(true);
  });

  it('bare-format parity: gridchild under bare [\'grid\'] entry → OWNED (unchanged)', () => {
    const evt = makeEvent(
      'g2', 'click',
      { tag: 'DIV', ariaRole: 'gridcell' },
      { ancestorRoles: ['grid'] },
    );
    expect(lifecycleOwnsTarget(evt, makeCtx('DatePicker', 'grid'), findDef('DatePicker'))).toBe(true);
  });

  it('gridchild under div[role=main] → NOT owned (negative space)', () => {
    const evt = makeEvent(
      'g3', 'click',
      { tag: 'DIV', ariaRole: 'gridcell' },
      { ancestorRoles: ['div[role=main]'] },
    );
    expect(lifecycleOwnsTarget(evt, makeCtx('DatePicker', 'grid'), findDef('DatePicker'))).toBe(false);
  });

  it('Part 1 still gates: non-child role is never owned regardless of ancestry', () => {
    const evt = makeEvent(
      'g4', 'click',
      { tag: 'DIV', ariaRole: 'button' },
      { ancestorRoles: ['div[role=grid]'] },
    );
    expect(lifecycleOwnsTarget(evt, makeCtx('DatePicker', 'grid'), findDef('DatePicker'))).toBe(false);
  });

  it('option under div[role=listbox] with surfaceRole=listbox → OWNED (Dropdown)', () => {
    const evt = makeEvent(
      'g5', 'click',
      { tag: 'DIV', ariaRole: 'option' },
      { ancestorRoles: ['div[role=listbox]'] },
    );
    expect(lifecycleOwnsTarget(evt, makeCtx('Dropdown', 'listbox'), findDef('Dropdown'))).toBe(true);
  });
});

// ── Hover overlay-role dwell: real-format ancestry ────────────────────

describe('Phase 6D.0 — hover overlay-role dwell with real format', () => {
  it('ancestor div[role=tooltip] on trigger contributes overlay evidence', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 1_000;

    // Interactive trigger (BUTTON) inside a tooltip-ancestor — real format.
    runtime.process(
      makeEvent('h1', 'mouseenter', { tag: 'BUTTON', accessibleName: 'Info' },
        { ancestorRoles: ['div[role=tooltip]'] }, { timestamp: t0 }),
    );
    expect(runtime.activeCount).toBe(1);

    // Leave after 600ms dwell (> 500ms transit threshold). Overlay-role
    // dwell alone is worth 70 ≥ 50 confidence → meaningful Hover emitted.
    runtime.process(
      makeEvent('h2', 'mouseleave', { tag: 'BUTTON', accessibleName: 'Info' },
        { ancestorRoles: ['div[role=tooltip]'] }, { timestamp: t0 + 600 }),
    );

    const hover = emitted.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    // B7-P2: ancestry NEVER gates semantics (F-2 vocabulary rule). The
    // tooltip-ancestor hover completes on leave like any other; meaning is
    // derived downstream from consequence evidence only.
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.terminal).toBe('left');
  });

  it('generic ancestry does not fire the overlay-role path', () => {
    const { runtime, emitted } = setupRuntime();
    const t0 = 1_000;
    runtime.process(
      makeEvent('h3', 'mouseenter', { tag: 'BUTTON', accessibleName: 'Info' },
        { ancestorRoles: ['div[role=main]'] }, { timestamp: t0 }),
    );
    runtime.process(
      makeEvent('h4', 'mouseleave', { tag: 'BUTTON', accessibleName: 'Info' },
        { ancestorRoles: ['div[role=main]'] }, { timestamp: t0 + 600 }),
    );
    const hover = emitted.find((i) => i.type === 'Hover');
    // B7-P2: generic ancestry behaves IDENTICALLY to tooltip ancestry —
    // ancestry is never a semantic input. Both complete on the "left"
    // terminal; neither carries stored meaning.
    expect(hover).toBeDefined();
    expect(hover!.endState).toBe('completed');
    expect(hover!.metadata.terminal).toBe('left');
    expect(hover!.metadata.meaningful).toBeUndefined();
  });
});

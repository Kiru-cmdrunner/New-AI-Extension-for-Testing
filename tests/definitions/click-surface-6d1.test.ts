/**
 * Phase 6D.1 W3 — Options-list / suggestion-surface click classification.
 *
 * Spec: .drytis/specs/phase-6d1-universal-interaction-classes.md §3 W3
 *
 * Root cause (audit 92de517, reactish typeahead): ul.options-list matches
 * no OPEN_SELECTION_SURFACE_CLASS_RE token, so click on li.opt inside it
 * is rejected by click.detectTrigger's S6/LP1 gate → Unclassified
 * (unclaimed-at-projection).
 *
 * Fix (§2.3 decision 3): vocabulary-only. Add generic suggestion-family
 * class tokens — suggestion, autocomplete, typeahead, options-list — to
 * OPEN_SELECTION_SURFACE_CLASS_RE. The claim is a plain Click (fallback
 * tier), no new definition, no new InteractionType.
 *
 * Pins:
 *  - AC-W3a: li.opt inside ul.options-list → Click claims via surface gate
 *  - AC-W3b: plain ul with NO surface token → still not a Click (honesty)
 *  - AC-W3c: suggestion-container and typeahead-menu surfaces → Click
 *  - AC-W3e: no site tokens; tokens are generic conventions
 *  - AC-W3f: dropdown lifecycle is NOT stolen by the vocabulary (native
 *    select flow still completes as Dropdown)
 *
 * TDD: written before implementation. Red until the vocabulary ships.
 */

import { describe, it, expect } from 'vitest';
import { isInsideOpenSelectionSurface } from '../../src/definitions/patterns';
import { clickDefinition } from '../../src/definitions/click';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { createRuntime } from '../../src/runtime/component-runtime';
import { makeObservedEvent } from '../helpers/make-event';
import type { ComponentInteraction } from '../../src/shared/component-types';

// ── helpers (same shape as phase-6d0-surface-vocabulary.test.ts) ──────

function makeTarget(overrides: Record<string, unknown> = {}) {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    tag: 'LI',
    className: 'opt',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'li.opt',
    xPath: '/html/body/ul/li',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...overrides,
  } as any;
}

function makeClickEvent(
  ancestorClasses: string[],
  targetOverrides: Record<string, unknown> = {},
) {
  return makeObservedEvent({
    eventId: 'e1',
    eventType: 'click',
    target: makeTarget(targetOverrides),
    domContext: {
      ancestorRoles: [],
      ancestorClasses,
      tabIndex: null,
    } as any,
  });
}

// ── AC-W3a: the audit shape claims as Click ────────────────────────────

describe('6D.1 W3 — options-list surface vocabulary', () => {
  it('isInsideOpenSelectionSurface accepts options-list class ancestry', () => {
    expect(isInsideOpenSelectionSurface([], ['options-list'])).toBe(true);
  });

  it('isInsideOpenSelectionSurface accepts suggestion / autocomplete / typeahead tokens', () => {
    expect(isInsideOpenSelectionSurface([], ['suggestion-container'])).toBe(true);
    expect(isInsideOpenSelectionSurface([], ['autocomplete-list'])).toBe(true);
    expect(isInsideOpenSelectionSurface([], ['typeahead-menu'])).toBe(true);
  });

  it('AC-W3a: li.opt inside ul.options-list → Click (audit regression pin)', () => {
    const trigger = clickDefinition.detectTrigger(
      makeClickEvent(['options-list']),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });

  it('AC-W3a: runtime pipeline — the click produces a Click interaction (not Unclassified)', () => {
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime(ALL_DEFINITIONS, { onEmit: (i) => emitted.push(i) });
    runtime.process(
      makeObservedEvent({
        eventId: 'opt-1',
        eventType: 'click',
        target: makeTarget({ accessibleName: 'Bengaluru', ariaLabel: 'Bengaluru' }),
        domContext: {
          ancestorRoles: ['ul'],
          ancestorClasses: ['options-list'],
          tabIndex: null,
        } as any,
      }),
    );
    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
    expect(emitted[0].endState).toBe('completed');
    // AC-W3a metadata: the option's own text names the step (bestName reads
    // accessibleName/ariaLabel first). Reviewer WARN fix — pinned, not
    // assumed-by-construction.
    expect((emitted[0].metadata as Record<string, unknown>).targetName).toBe('Bengaluru');
  });
});

// ── AC-W3b: negative space holds ───────────────────────────────────────

describe('6D.1 W3 — honesty: non-surface ancestry still rejected', () => {
  it('plain ul/li with no surface token anywhere → claims Click (v1.2 flip — surface ancestry no longer gates)', () => {
    // Click Qualification v1.2 §8.5: the LP1 open-surface gate is DELETED;
    // qualification is capture-time (src/tap/click-qualification.ts). The
    // AC-W3a pin above (opt INSIDE an open surface) is unchanged in
    // outcome — it claimed Click before and claims Click now.
    expect(clickDefinition.detectTrigger(makeClickEvent([]))).toEqual({ type: 'Click' });
    expect(clickDefinition.detectTrigger(makeClickEvent(['row', 'flex']))).toEqual({ type: 'Click' });
  });

  it('isInsideOpenSelectionSurface negative space unchanged (generic layout)', () => {
    expect(isInsideOpenSelectionSurface([], ['row', 'container', 'flex'])).toBe(false);
    expect(isInsideOpenSelectionSurface(['main', 'form'], [])).toBe(false);
  });

  it('options-list-ad still matches (substring convention, accepted P3 family style)', () => {
    // Pre-existing family anchoring style (menu matches menu-item, etc.) —
    // pinning the behavior so it is a KNOWN convention, not an accident.
    expect(isInsideOpenSelectionSurface([], ['options-list-ad'])).toBe(true);
  });
});

// ── AC-W3c: two more conventions ───────────────────────────────────────

describe('6D.1 W3 — suggestion and typeahead conventions claim as Click', () => {
  it('li inside div.suggestion-container → Click', () => {
    expect(
      clickDefinition.detectTrigger(makeClickEvent(['suggestion-container'])),
    ).toEqual({ type: 'Click' });
  });

  it('div option inside div.typeahead-menu → Click', () => {
    expect(
      clickDefinition.detectTrigger(
        makeClickEvent(['typeahead-menu'], { tag: 'DIV', className: 'tt-option' }),
      ),
    ).toEqual({ type: 'Click' });
  });

  it('input.autocomplete wrapper is NOT self-promoted (ancestry gate is on the CLICKED element)', () => {
    // The token check runs on ancestorClasses of the clicked element — an
    // input whose OWN class contains autocomplete does not carry surface
    // ancestry unless its ANCESTORS do. But the input IS interactive, so
    // the click still claims via the normal interactive path.
    const trigger = clickDefinition.detectTrigger(
      makeClickEvent([], { tag: 'INPUT', className: 'autocomplete-input', inputType: 'text' }),
    );
    expect(trigger).toEqual({ type: 'Click' });
  });
});

// ── AC-W3f: dropdown lifecycle not stolen ──────────────────────────────

describe('6D.1 W3 — dropdown regression: open-dropdown options stay Dropdown', () => {
  it('armed combobox + role=option click under div[role=listbox] still completes as Dropdown', () => {
    const emitted: ComponentInteraction[] = [];
    const runtime = createRuntime(ALL_DEFINITIONS, { onEmit: (i) => emitted.push(i) });

    // Arm a real dropdown lifecycle (combobox trigger, aria-expanded).
    runtime.process(
      makeObservedEvent({
        eventId: 't1',
        eventType: 'click',
        target: makeTarget({
          tag: 'DIV',
          className: 'custom-select trigger',
          ariaRole: 'combobox',
          cssSelector: 'div.trigger',
        }),
        domContext: {
          ancestorRoles: [],
          ancestorClasses: [],
          ariaHasPopup: 'listbox',
          ariaExpanded: true,
          tabIndex: 0,
        } as any,
      }),
    );
    expect(runtime.activeCount).toBe(1);

    // Option click under a listbox surface — the Dropdown definition must
    // claim it (priority 20 < Click's 180), Click is never even consulted.
    runtime.process(
      makeObservedEvent({
        eventId: 'opt1',
        eventType: 'click',
        target: makeTarget({
          tag: 'DIV',
          ariaRole: 'option',
          accessibleName: 'Premium Economy',
          cssSelector: 'div[role=option]',
        }),
        domContext: {
          ancestorRoles: ['div[role=listbox]'],
          ancestorClasses: ['options-list'],
          tabIndex: -1,
        } as any,
      }),
    );

    const dropdown = emitted.find((i) => i.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('Premium Economy');
    expect(dropdown!.endState).toBe('completed');
  });
});

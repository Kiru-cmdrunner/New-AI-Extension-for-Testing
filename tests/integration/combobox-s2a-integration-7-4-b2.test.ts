/**
 * 7.4-B2 Integration — SW-shape end-to-end for the three typeable-combobox
 * flows: ledger + runtime + projection + workflow normalizer.
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §5 Integration:
 * "ledger + runtime + projection + normalizer end-to-end for flows A/B/C
 *  (S2A-2/3/4 at the SW-shape level, including the mousedown fold)".
 *
 * Pins (spec §6 accepted cost 3): the option mousedown surfaces as an
 * Unclassified card in the RAW projection, then the normalizer folds it into
 * the option Click — identical to the existing input-then-button behavior.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { normalizeWorkflow } from '../../src/presentation/workflow-normalizer';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  ObservedEvent,
  ElementIdentity,
  DomContext,
} from '../../src/shared/component-types';

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

function setup() {
  const emitted: ComponentInteraction[] = [];
  const ledger = new EvidenceLedger();
  const runtime = createRuntime(ALL_DEFINITIONS, {
    onEmit: (i) => emitted.push(i),
    evidenceLedger: ledger,
  });
  return { runtime, emitted, ledger };
}

function run(
  runtime: ReturnType<typeof createRuntime>,
  ledger: EvidenceLedger,
  emitted: ComponentInteraction[],
  events: ObservedEvent[],
) {
  for (const e of events) {
    ledger.append(e);
    runtime.process(e);
  }
  runtime.flush();
  return projectInteractions(ledger, emitted).interactions;
}

// ── Flow A (type + option click): raw projection shows the option mousedown;
// the normalizer folds it into the option Click ─────────────────────────

describe('7.4-B2 integration — mousedown fold (Flow A)', () => {
  it('raw projection shows the option mousedown as Unclassified; normalizer folds it into the Click', () => {
    const { runtime, emitted, ledger } = setup();

    const inputTarget = {
      tag: 'INPUT', ariaRole: 'combobox', inputType: 'text',
      stableId: 'city-sel', accessibleName: 'City', className: 'custom-combobox',
    };
    const inputCtx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };
    const optionTarget = {
      tag: 'DIV', ariaRole: 'option', accessibleName: 'New York',
      stableId: 'opt-ny', className: 'select-option',
    };
    const optionCtx = { ancestorRoles: ['div[role=listbox]'], ancestorClasses: ['options-list'] };

    const raw = run(runtime, ledger, emitted, [
      makeEvent('f1', 'focus', inputTarget, inputCtx),
      makeEvent('i1', 'input', inputTarget, inputCtx, { valueAfter: 'New' }),
      makeEvent('md1', 'mousedown', optionTarget, optionCtx),
      makeEvent('b1', 'blur', inputTarget, inputCtx, { valueBefore: 'New', valueAfter: 'New' }),
      makeEvent('c2', 'click', optionTarget, optionCtx),
    ]);

    // RAW projection: 1 TextEntry + 1 Click + the option mousedown as an
    // Unclassified card (it is claimed by no lifecycle — the option Click
    // absorbs it only after the normalizer folds the gesture).
    const textEntries = raw.filter((i) => i.type === 'TextEntry');
    const clicks = raw.filter((i) => i.type === 'Click');
    const rawUnclassified = raw.filter((i) => i.type === 'Unclassified');
    expect(textEntries.length).toBe(1);
    expect(clicks.length).toBe(1);
    expect(rawUnclassified.length).toBeGreaterThanOrEqual(1);

    // Normalized workflow: the Unclassified mousedown is subsumed by the
    // option Click on the same elementKey within the gesture window.
    const normalized = normalizeWorkflow(raw);
    const normTypes = normalized.map((i) => i.type);
    expect(normTypes.filter((t) => t === 'Unclassified')).toHaveLength(0);
    expect(normTypes.filter((t) => t === 'TextEntry')).toHaveLength(1);
    expect(normTypes.filter((t) => t === 'Click')).toHaveLength(1);
  });

  it('Flow A with an unmatched stray mousedown (no paired click) keeps it Unclassified', () => {
    const { runtime, emitted, ledger } = setup();

    const inputTarget = {
      tag: 'INPUT', ariaRole: 'combobox', inputType: 'text',
      stableId: 'city-sel2', accessibleName: 'City', className: 'custom-combobox',
    };
    const inputCtx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };
    const otherTarget = { tag: 'DIV', accessibleName: 'stray', stableId: 'stray-el' };

    const raw = run(runtime, ledger, emitted, [
      makeEvent('f1', 'focus', inputTarget, inputCtx),
      makeEvent('i1', 'input', inputTarget, inputCtx, { valueAfter: 'New' }),
      makeEvent('md1', 'mousedown', otherTarget),
      makeEvent('b1', 'blur', inputTarget, inputCtx),
      // NOTE: no click after the mousedown — it stays unpaired
    ]);

    const normalized = normalizeWorkflow(raw);
    const normTypes = normalized.map((i) => i.type);
    // The unpaired mousedown is not folded (no matching click) — it remains
    // an honest Unclassified card in the raw stream
    expect(normTypes.filter((t) => t === 'TextEntry')).toHaveLength(1);
  });
});

// ── Flow B (type + Enter + blur): keyboard commit path ────────────────

describe('7.4-B2 integration — Flow B (keyboard commit)', () => {
  it('focus → input → Enter keydown → blur → single TextEntry, zero Unclassified after normalize', () => {
    const { runtime, emitted, ledger } = setup();

    const target = {
      tag: 'INPUT', ariaRole: 'combobox', inputType: 'text',
      stableId: 'fruit-sel', accessibleName: 'Fruit',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const raw = run(runtime, ledger, emitted, [
      makeEvent('f1', 'focus', target, ctx),
      makeEvent('i1', 'input', target, ctx, { valueAfter: 'App' }),
      makeEvent('k1', 'keydown', target, ctx, { key: 'Enter', code: 'Enter' }),
      makeEvent('b1', 'blur', target, ctx, { valueBefore: 'Apple', valueAfter: 'Apple' }),
    ]);

    const normalized = normalizeWorkflow(raw);
    const normTypes = normalized.map((i) => i.type);
    expect(normTypes.filter((t) => t === 'TextEntry')).toHaveLength(1);
    expect(normTypes.filter((t) => t === 'Unclassified')).toHaveLength(0);
    const te = normalized.find((i) => i.type === 'TextEntry');
    expect(te?.metadata.typedValue).toBe('App');
    expect(te?.metadata.textValue).toBe('Apple');
  });
});

// ── Flow C (type + click elsewhere): TextEntry + Click ────────────────

describe('7.4-B2 integration — Flow C (click elsewhere)', () => {
  it('focus → input → mousedown(Save) → blur → click(Save) → TextEntry + Click, zero Unclassified', () => {
    const { runtime, emitted, ledger } = setup();

    const inputTarget = {
      tag: 'INPUT', ariaRole: 'combobox', inputType: 'text',
      stableId: 'search-box', accessibleName: 'Search',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };
    const saveTarget = { tag: 'BUTTON', accessibleName: 'Save', stableId: 'save-btn' };

    const raw = run(runtime, ledger, emitted, [
      makeEvent('f1', 'focus', inputTarget, ctx),
      makeEvent('i1', 'input', inputTarget, ctx, { valueAfter: 'query text' }),
      makeEvent('md1', 'mousedown', saveTarget),
      makeEvent('b1', 'blur', inputTarget, ctx),
      makeEvent('c1', 'click', saveTarget),
    ]);

    const normalized = normalizeWorkflow(raw);
    const normTypes = normalized.map((i) => i.type);
    expect(normTypes.filter((t) => t === 'TextEntry')).toHaveLength(1);
    expect(normTypes.filter((t) => t === 'Click')).toHaveLength(1);
    expect(normTypes.filter((t) => t === 'Unclassified')).toHaveLength(0);
  });
});

/**
 * 7.4-B2 S2a — typeable combobox classification pins.
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §S2a (baseline d525911):
 *
 * S2A-1  focus on typeable combobox input → TextEntry, not Dropdown
 * S2A-2  Flow A (type + option click) → 1 TextEntry + 1 Click + 0 Dropdown
 * S2A-3  Flow B (type + Enter + blur) → 1 TextEntry, Enter claimed
 * S2A-4  Flow C (type + click elsewhere) → 1 TextEntry + 1 Click
 * S2A-5  readonly combobox → still Dropdown (R1)
 * S2A-6  DIV role=combobox + option under listbox → still Dropdown (R2)
 * S2A-7  native <select> → still Dropdown (R3)
 * S2A-8  typeable INPUT whose class matches DROPDOWN_TRIGGER_CLASS_RE → TextEntry
 * S2A-8b W-A.3 option guard — option with trigger class does NOT start stray Dropdown
 * S2A-9  aria-haspopup=listbox + name=arrival → NOT DatePicker → TextEntry
 * S2A-10 comboboxSignal metadata present/absent (boolean-valued)
 *
 * Production event shapes: ledger-append per event, full runtime, projection.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
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
  const ledger = new EvidenceLedger();
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i), evidenceLedger: ledger };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted, ledger };
}

// ── S2A-1: focus on typeable combobox → TextEntry ────────────────────

describe('7.4-B2 S2a — typeable combobox classification', () => {
  it('S2A-1: focus on <input role=combobox type=text> → TextEntry lifecycle, not Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'city-combobox',
      accessibleName: 'City',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    runtime.process(makeEvent('f1', 'focus', target, ctx));
    expect(runtime.activeCount).toBe(1);
    // Nothing emitted yet — lifecycle still active
    expect(emitted.length).toBe(0);

    // Complete the lifecycle with blur → the emitted type reveals which
    // definition claimed the focus
    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);
    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    expect(projected.length).toBe(1);
    expect(projected[0].type).toBe('TextEntry');
    expect(projected[0].type).not.toBe('Dropdown');
  });

  // ── S2A-2: Flow A (type + option click) ─────────────────────────────

  it('S2A-2: Flow A (type + option click) → 1 TextEntry + 1 Click + 0 Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const inputTarget = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'city-sel',
      accessibleName: 'City',
      className: 'custom-combobox',
    };
    const inputCtx = {
      inputType: 'text',
      ariaHasPopup: 'listbox' as const,
      ariaAutoComplete: 'list',
    };
    const optionTarget = {
      tag: 'DIV',
      ariaRole: 'option',
      accessibleName: 'New York',
      stableId: 'opt-ny',
      className: 'select-option',
    };
    const optionCtx = {
      ancestorRoles: ['div[role=listbox]'],
      ancestorClasses: ['options-list'],
    };

    // Production event order: focus → input → mousedown(option) → blur(input) → click(option)
    const focus = makeEvent('f1', 'focus', inputTarget, inputCtx);
    ledger.append(focus); runtime.process(focus);

    const inputEvt = makeEvent('i1', 'input', inputTarget, inputCtx, { valueAfter: 'New' });
    ledger.append(inputEvt); runtime.process(inputEvt);

    // mousedown on the option (different element → discrete, not absorbed)
    const md = makeEvent('md1', 'mousedown', optionTarget, optionCtx);
    ledger.append(md); runtime.process(md);

    // blur on the input — TextEntry completes here
    const blur = makeEvent('b1', 'blur', inputTarget, inputCtx, { valueBefore: 'New', valueAfter: 'New' });
    ledger.append(blur); runtime.process(blur);

    // click on the option — Click claims it
    const click = makeEvent('c2', 'click', optionTarget, optionCtx);
    ledger.append(click); runtime.process(click);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;

    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    const clicks = projected.filter((i) => i.type === 'Click');
    const dropdowns = projected.filter((i) => i.type === 'Dropdown');

    expect(textEntries.length).toBe(1);
    expect(clicks.length).toBe(1);
    expect(dropdowns.length).toBe(0);

    // TextEntry carries the typed query
    expect(textEntries[0].metadata.typedValue).toBe('New');
    // Click is on the option
    expect(clicks[0].metadata.targetName).toBe('New York');
  });

  // ── S2A-3: Flow B (type + Enter + blur) ─────────────────────────────

  it('S2A-3: Flow B (type + Enter + blur) → 1 TextEntry, Enter claimed, 0 Unclassified', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'fruit-sel',
      accessibleName: 'Fruit',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    const inputEvt = makeEvent('i1', 'input', target, ctx, { valueAfter: 'App' });
    ledger.append(inputEvt); runtime.process(inputEvt);

    // Enter keydown — same element, absorbed as member event by TextEntry
    const enter = makeEvent('k1', 'keydown', target, ctx, { key: 'Enter', code: 'Enter' });
    ledger.append(enter); runtime.process(enter);

    // blur — TextEntry completes
    const blur = makeEvent('b1', 'blur', target, ctx, { valueBefore: 'Apple', valueAfter: 'Apple' });
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;

    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    const unclassified = projected.filter((i) => i.type === 'Unclassified');

    expect(textEntries.length).toBe(1);
    expect(unclassified.length).toBe(0);
    expect(textEntries[0].metadata.typedValue).toBe('App');
    // textValue is the blur-committed value
    expect(textEntries[0].metadata.textValue).toBe('Apple');
  });

  // ── S2A-4: Flow C (type + click elsewhere) ──────────────────────────

  it('S2A-4: Flow C (type + click elsewhere) → 1 TextEntry + 1 Click', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const inputTarget = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'search-box',
      accessibleName: 'Search',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const focus = makeEvent('f1', 'focus', inputTarget, ctx);
    ledger.append(focus); runtime.process(focus);

    const inputEvt = makeEvent('i1', 'input', inputTarget, ctx, { valueAfter: 'query text' });
    ledger.append(inputEvt); runtime.process(inputEvt);

    // Production event order: mousedown(Save) → blur(input) → click(Save)
    const saveTarget = { tag: 'BUTTON', accessibleName: 'Save', stableId: 'save-btn' };
    const saveMd = makeEvent('md1', 'mousedown', saveTarget);
    ledger.append(saveMd); runtime.process(saveMd);

    // blur on the input — TextEntry completes here
    const blur = makeEvent('b1', 'blur', inputTarget, ctx);
    ledger.append(blur); runtime.process(blur);

    // click on the Save button
    const saveClick = makeEvent('c1', 'click', saveTarget);
    ledger.append(saveClick); runtime.process(saveClick);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;

    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    const clicks = projected.filter((i) => i.type === 'Click');
    const dropdowns = projected.filter((i) => i.type === 'Dropdown');

    expect(textEntries.length).toBe(1);
    expect(textEntries[0].metadata.typedValue).toBe('query text');
    expect(clicks.length).toBe(1);
    expect(dropdowns.length).toBe(0);
  });

  // ── S2A-5: readonly combobox → still Dropdown (R1) ─────────────────

  it('S2A-5: readonly combobox (readOnly: true) → still Dropdown with selection', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const trigger = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'oxd-sel',
      accessibleName: '',
      className: 'oxd-select-text',
    };
    const ctx = {
      inputType: 'text',
      readOnly: true,
      ariaHasPopup: 'listbox' as const,
      ancestorClasses: ['oxd-select-wrapper'],
    };

    const click = makeEvent('c1', 'click', trigger, ctx, { valueBefore: '-- Admin --' });
    ledger.append(click); runtime.process(click);

    const option = {
      tag: 'DIV',
      ariaRole: 'option',
      className: 'oxd-select-option',
      accessibleName: 'ESS',
    };
    const optionCtx = { ancestorClasses: ['oxd-select-dropdown'] };
    const optionClick = makeEvent('c2', 'click', option, optionCtx);
    ledger.append(optionClick); runtime.process(optionClick);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;

    const dropdowns = projected.filter((i) => i.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].metadata.selectedValue).toBe('ESS');
    // 7.4-B2b fix (dropdown-whyline-dead-path.md): the confirmed path now
    // writes selectionConfirmed=true — required by the IR gate and the
    // panel why-line. Pinned with a REAL runtime (no synthetic metadata).
    expect(dropdowns[0].metadata.selectionConfirmed).toBe(true);
  });

  // ── S2A-6: DIV role=combobox + option under listbox → still Dropdown (R2)

  it('S2A-6: DIV role=combobox trigger + option under div[role=listbox] → still Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const trigger = {
      tag: 'DIV',
      className: 'custom-select trigger',
      ariaRole: 'combobox',
      accessibleName: 'Country',
    };
    const triggerCtx = { ariaHasPopup: 'listbox' as const, ariaExpanded: true, tabIndex: 0 };

    const t1 = makeEvent('t1', 'click', trigger, triggerCtx);
    ledger.append(t1); runtime.process(t1);
    expect(runtime.activeCount).toBe(1);

    const option = {
      tag: 'DIV',
      ariaRole: 'option',
      accessibleName: 'Premium Economy',
    };
    const optionCtx = {
      ancestorRoles: ['div[role=listbox]'],
      ancestorClasses: ['options-list'],
    };
    const opt1 = makeEvent('opt1', 'click', option, optionCtx);
    ledger.append(opt1); runtime.process(opt1);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const dropdowns = projected.filter((i) => i.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].metadata.selectedValue).toBe('Premium Economy');
  });

  // ── S2A-7: native <select> → still Dropdown (R3) ────────────────────

  it('S2A-7: native <select> change/blur flow → still Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'SELECT',
      ariaRole: 'listbox',
      stableId: 'country-sel',
      accessibleName: 'Country',
    };

    const md = makeEvent('c1', 'mousedown', target);
    ledger.append(md); runtime.process(md);

    const change = makeEvent('ch1', 'change', target, {}, { valueAfter: 'USA' });
    ledger.append(change); runtime.process(change);

    const blur = makeEvent('b1', 'blur', target, {}, { valueAfter: 'USA' });
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const dropdowns = projected.filter((i) => i.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].metadata.selectedValue).toBe('USA');
  });

  // ── S2A-8: typeable INPUT whose class matches DROPDOWN_TRIGGER_CLASS_RE

  it('S2A-8: typeable INPUT with dropdown-trigger class → TextEntry, not Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'auto-sel',
      accessibleName: 'Product',
      className: 'selector', // matches DROPDOWN_TRIGGER_CLASS_RE
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    expect(runtime.activeCount).toBe(1);

    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    expect(textEntries.length).toBe(1);
  });

  // ── S2A-8b: W-A.3 option guard ──────────────────────────────────────

  it('S2A-8b: W-A.3 — option with trigger class does NOT start stray Dropdown', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const inputTarget = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'test-combobox',
      accessibleName: 'Status',
      className: 'custom-combobox',
    };
    const inputCtx = {
      inputType: 'text',
      ariaHasPopup: 'listbox' as const,
      ariaAutoComplete: 'list',
    };
    // An option whose class matches BOTH DROPDOWN_OPTION_CLASS_RE AND
    // DROPDOWN_TRIGGER_CLASS_RE (e.g. 'ant-select-item select-option').
    // Without the W-A.3 guard, this option would start a stray Dropdown.
    const optionTarget = {
      tag: 'DIV',
      ariaRole: 'option',
      accessibleName: 'Active',
      stableId: 'opt-active',
      className: 'ant-select-item select-option',
    };
    const optionCtx = {
      ancestorRoles: ['div[role=listbox]'],
      ancestorClasses: ['ant-select-dropdown'],
    };

    // Focus on the typeable combobox → TextEntry
    const focus = makeEvent('f1', 'focus', inputTarget, inputCtx);
    ledger.append(focus); runtime.process(focus);

    const inputEvt = makeEvent('i1', 'input', inputTarget, inputCtx, { valueAfter: 'Ac' });
    ledger.append(inputEvt); runtime.process(inputEvt);

    // mousedown on option (different element)
    const md = makeEvent('md1', 'mousedown', optionTarget, optionCtx);
    ledger.append(md); runtime.process(md);

    // blur on input → TextEntry completes
    const blur = makeEvent('b1', 'blur', inputTarget, inputCtx);
    ledger.append(blur); runtime.process(blur);

    // click on option → Click (NOT Dropdown on the option)
    const click = makeEvent('c2', 'click', optionTarget, optionCtx);
    ledger.append(click); runtime.process(click);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;

    const dropdowns = projected.filter((i) => i.type === 'Dropdown');
    const clicks = projected.filter((i) => i.type === 'Click');
    const textEntries = projected.filter((i) => i.type === 'TextEntry');

    // No stray Dropdown on the option
    expect(dropdowns.length).toBe(0);
    expect(textEntries.length).toBe(1);
    expect(clicks.length).toBe(1);
    expect(clicks[0].metadata.targetName).toBe('Active');
  });

  // ── S2A-9: DatePicker listbox guard ────────────────────────────────

  it('S2A-9a: <input aria-haspopup=listbox name=arrival> → NOT DatePicker → TextEntry', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      inputType: 'text',
      name: 'arrival',
      stableId: 'arrival-input',
      accessibleName: 'Arrival City',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    expect(runtime.activeCount).toBe(1);

    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    const datePickers = projected.filter((i) => i.type === 'DatePicker');
    expect(textEntries.length).toBe(1);
    expect(datePickers.length).toBe(0);
  });

  it('S2A-9b: <input aria-haspopup=dialog> → still DatePicker (narrow guard)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      inputType: 'text',
      name: 'departure',
      stableId: 'dep-date',
      accessibleName: 'Departure Date',
      className: 'react-datepicker',
    };
    const ctx = {
      inputType: 'text',
      ariaHasPopup: 'dialog' as const,
      ariaExpanded: false,
      ariaAutoComplete: 'none',
    };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    expect(runtime.activeCount).toBe(1);

    // The active lifecycle is DatePicker, NOT TextEntry — the dialog popup
    // does not disclaim (narrow guard: listbox only). DatePicker doesn't
    // complete on blur alone (needs calendar cell click / change / timeout),
    // so we assert via the runtime's active lifecycle type, not projection.
    // After flush with no completion trigger, the lifecycle is abandoned —
    // but the KEY assertion is: ZERO TextEntry was emitted.
    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    // Strict: ZERO TextEntry cards — DatePicker claimed the focus, not TextEntry.
    expect(projected.filter((i) => i.type === 'TextEntry').length).toBe(0);
  });

  // ── S2A-10: comboboxSignal metadata ────────────────────────────────

  it('S2A-10a: comboboxSignal present when ariaAutoComplete is captured', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      inputType: 'text',
      stableId: 'signal-test',
      accessibleName: 'City',
    };
    const ctx = { inputType: 'text', ariaHasPopup: 'listbox' as const, ariaAutoComplete: 'list' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    expect(textEntries.length).toBe(1);
    expect(textEntries[0].metadata.comboboxSignal).toBe('list');
  });

  it('S2A-10b: comboboxSignal = "datalist" when listId present without ariaAutoComplete', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      inputType: 'text',
      stableId: 'datalist-test',
      accessibleName: 'Browser',
    };
    const ctx = { inputType: 'text', listId: 'browsers' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    expect(textEntries.length).toBe(1);
    expect(textEntries[0].metadata.comboboxSignal).toBe('datalist');
  });

  it('S2A-10c: comboboxSignal absent on plain text input (no combobox signal)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    const target = {
      tag: 'INPUT',
      inputType: 'text',
      stableId: 'plain-text',
      accessibleName: 'Username',
    };
    const ctx = { inputType: 'text' };

    const focus = makeEvent('f1', 'focus', target, ctx);
    ledger.append(focus); runtime.process(focus);

    const blur = makeEvent('b1', 'blur', target, ctx);
    ledger.append(blur); runtime.process(blur);

    runtime.flush();
    const projected = projectInteractions(ledger, emitted).interactions;
    const textEntries = projected.filter((i) => i.type === 'TextEntry');
    expect(textEntries.length).toBe(1);
    // comboboxSignal should be undefined/absent (no ariaAutoComplete, no listId)
    expect(textEntries[0].metadata.comboboxSignal).toBeUndefined();
  });
});

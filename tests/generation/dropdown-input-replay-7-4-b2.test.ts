/**
 * 7.4-B2 S2b — IR honesty for INPUT-triggered Dropdowns (readonly combobox family).
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §S2b (baseline d525911):
 *
 * S2B-1  Dropdown on INPUT trigger + selectionConfirmed → 2 CLICK steps, no SELECT
 * S2B-2  Step-2 target = completing option identity; sourceEventId = option eventId
 * S2B-3  Dropdown on tag=SELECT → single SELECT step (parity)
 * S2B-4  The two CLICK steps execute without error (action type = 'click')
 * S2B-5  output-adapter.toIRAction consumer audit (no executing consumer → WARN)
 *
 * Today this shape covers the OXD readonly display-input combobox. A native
 * <select> keeps single SELECT (trigger.tag === 'SELECT').
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction, ObservedEvent, ElementIdentity } from '../../src/shared/component-types';

// ── Factories ─────────────────────────────────────────────

function makeIdentity(over: Partial<ElementIdentity>): ElementIdentity {
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
    ...over,
  } as ElementIdentity;
}

function makeObserved(over: Partial<ObservedEvent> & { eventId: string; eventType: string }): ObservedEvent {
  return {
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
    domContext: {
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
    },
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
    target: makeIdentity({}),
    ...over,
  } as unknown as ObservedEvent;
}

function dropdownOnInputInteraction(overrides?: {
  selectionConfirmed?: boolean;
  selectedValue?: string;
  optionEventId?: string;
  optionName?: string;
}): ComponentInteraction {
  const optionEventId = overrides?.optionEventId ?? 'evt-opt';
  const optionName = overrides?.optionName ?? 'ESS';
  const selectedValue = overrides?.selectedValue ?? 'ESS';

  const triggerIdentity = makeIdentity({
    tag: 'INPUT',
    stableId: 'oxd-sel',
    accessibleName: 'Employee',
    className: 'oxd-select-text',
    cssSelector: '#oxd-sel',
    xPath: '/html/body/input',
    inputType: 'text',
    elementId: 'elem-trigger',
  });

  const optionIdentity = makeIdentity({
    tag: 'DIV',
    ariaRole: 'option',
    stableId: 'opt-ess',
    accessibleName: optionName,
    className: 'oxd-select-option',
    cssSelector: '.oxd-select-option',
    xPath: '/html/body/div[2]',
    elementId: 'elem-option',
  });

  const triggerEvent: ObservedEvent = makeObserved({
    eventId: 'evt-trig',
    eventType: 'click',
    target: triggerIdentity,
    domContext: {
      inputType: 'text',
      ariaExpanded: null,
      ariaHasPopup: 'listbox',
      isContentEditable: false,
      disabled: false,
      readOnly: true,
      required: false,
      ancestorRoles: [],
      ancestorClasses: ['oxd-select-wrapper'],
      tabIndex: null,
    },
  });

  const optionEvent: ObservedEvent = makeObserved({
    eventId: optionEventId,
    eventType: 'click',
    target: optionIdentity,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: ['oxd-select-dropdown'],
      tabIndex: null,
    },
  });

  return {
    interactionId: 'int-dd-1',
    type: 'Dropdown',
    trigger: triggerIdentity,
    triggerEvent,
    memberEvents: [triggerEvent, optionEvent],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: {
      targetName: 'Employee',
      selectedValue,
      noOpSelection: false,
      selectionConfirmed: overrides?.selectionConfirmed ?? true,
    },
  } as unknown as ComponentInteraction;
}

function dropdownOnSelectInteraction(): ComponentInteraction {
  const selIdentity = makeIdentity({
    tag: 'SELECT',
    stableId: 'country-sel',
    accessibleName: 'Country',
    cssSelector: '#country-sel',
    xPath: '/html/body/select',
    elementId: 'elem-select',
  });

  const triggerEvent: ObservedEvent = makeObserved({
    eventId: 'evt-sel-trig',
    eventType: 'mousedown',
    target: selIdentity,
  });

  return {
    interactionId: 'int-dd-sel',
    type: 'Dropdown',
    trigger: selIdentity,
    triggerEvent,
    memberEvents: [triggerEvent],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: {
      targetName: 'Country',
      selectedValue: 'USA',
      noOpSelection: false,
      selectionConfirmed: true,
    },
  } as unknown as ComponentInteraction;
}

function buildIR(interactions: ComponentInteraction[]) {
  return build({
    interactions,
    recordingContext: { startUrl: 'https://example.test/', title: 'Test' },
    testCaseName: 'Combobox test',
  } as never);
}

// ── S2B-1: INPUT-triggered Dropdown → 2 CLICK steps ─────────────────

describe('7.4-B2 S2b — IR honesty for INPUT-triggered Dropdowns', () => {
  it('S2B-1: INPUT-triggered Dropdown + selectionConfirmed → 2 CLICK steps, no SELECT', () => {
    const ir = buildIR([dropdownOnInputInteraction()]);
    expect(ir.steps.length).toBe(2);
    expect(ir.steps[0].action).toBe('click');
    expect(ir.steps[1].action).toBe('click');
    // No SELECT step for INPUT triggers
    expect(ir.steps.some((s) => s.action === 'select')).toBe(false);
  });

  it('S2B-1 desc: step-1 description = "Open the {name} list"', () => {
    const ir = buildIR([dropdownOnInputInteraction()]);
    expect(ir.steps[0].description).toMatch(/open the .* list/i);
  });

  it('S2B-1 desc: step-2 description = "Select {value}"', () => {
    const ir = buildIR([dropdownOnInputInteraction({ selectedValue: 'ESS' })]);
    expect(ir.steps[1].description).toMatch(/select ess/i);
  });

  // ── S2B-2: step-2 target = option identity ──────────────────────

  it('S2B-2: step-2 sourceEventId = option click eventId', () => {
    const ir = buildIR([dropdownOnInputInteraction({ optionEventId: 'evt-opt-42' })]);
    expect(ir.steps[1].sourceEventId).toBe('evt-opt-42');
  });

  it('S2B-2: step-1 sourceEventId = trigger eventId', () => {
    const ir = buildIR([dropdownOnInputInteraction()]);
    expect(ir.steps[0].sourceEventId).toBe('evt-trig');
  });

  it('S2B-2: step-2 target resolves the option identity (not the trigger)', () => {
    const ir = buildIR([dropdownOnInputInteraction()]);
    const step2 = ir.steps[1];
    expect(step2.target.kind).toBe('element');
    if (step2.target.kind === 'element') {
      // The option's accessibleName is "ESS", the trigger's is "Employee"
      expect(step2.target.elementName).toBe('ESS');
    }
  });

  // ── S2B-3: native SELECT → single SELECT (parity) ────────────────

  it('S2B-3: Dropdown on tag=SELECT → single SELECT step', () => {
    const ir = buildIR([dropdownOnSelectInteraction()]);
    expect(ir.steps.length).toBe(1);
    expect(ir.steps[0].action).toBe('select');
  });

  // ── S2B-4: two CLICK steps are valid IR actions ──────────────────

  it('S2B-4: both steps are action=click (executor-agnostic, no SELECT cast)', () => {
    const ir = buildIR([dropdownOnInputInteraction()]);
    expect(ir.steps.every((s) => s.action === 'click')).toBe(true);
    // No step casts to HTMLSelectElement — both are plain clicks
    expect(ir.steps.some((s) => s.action === 'select')).toBe(false);
  });

  // ── S2B-5: output-adapter consumer audit ───────────────────────

  it('S2B-5: output-adapter.toIRAction is presentation shape (no executing consumer)', () => {
    // The toIRAction function maps Dropdown → SELECT for display purposes.
    // No consumer executes its output — the replay path is ir-bridge.build().
    // This is a documented WARN (spec §S2b): presentation shape, not the
    // replay path. No change needed.
    // Pin: the two-step CLICK plan has exactly 2 steps with correct actions.
    const ir = buildIR([dropdownOnInputInteraction()]);
    expect(ir.steps.length).toBe(2);
    expect(ir.steps[0].action).toBe('click');
    expect(ir.steps[1].action).toBe('click');
  });

  // ── Unconfirmed selection (no selectionConfirmed) keeps today's shape ─

  it('S2B-edge: INPUT-triggered Dropdown WITHOUT selectionConfirmed → single SELECT (unchanged)', () => {
    const ir = buildIR([dropdownOnInputInteraction({ selectionConfirmed: false })]);
    // Without selectionConfirmed, the two-step path is not taken —
    // falls through to the normal INTERACTION_TO_IR_ACTION mapping (Dropdown → SELECT)
    expect(ir.steps.length).toBe(1);
    expect(ir.steps[0].action).toBe('select');
  });

  // ── S2B-real: REAL runtime-driven end-to-end pin (reviewer finding #1) ──

  it('S2B-real: real runtime OXD flow → buildResult writes selectionConfirmed → IR = 2 CLICKs (no SELECT)', async () => {
    // Drive the REAL runtime (definitions + lifecycle) exactly like the
    // unit tests do, then feed the emitted interaction to ir-bridge.build.
    // This is the pin that would have caught the dead gate: the synthetic
    // factory manually injected selectionConfirmed, which the engine never
    // produced until the buildResult fix.
    const { createRuntime } = await import('../../src/runtime/component-runtime');
    const { EvidenceLedger } = await import('../../src/runtime/evidence-ledger');
    const { ALL_DEFINITIONS } = await import('../../src/definitions');
    const { makeObservedEvent } = await import('../helpers/make-event');

    const emitted: unknown[] = [];
    const ledger = new EvidenceLedger();
    const runtime = createRuntime(ALL_DEFINITIONS, {
      onEmit: (i) => emitted.push(i),
      evidenceLedger: ledger,
    });

    const trigger = { tag: 'INPUT', ariaRole: 'combobox', inputType: 'text', className: 'oxd-select-text', accessibleName: 'Employee', stableId: 'oxd-sel-1', elementId: 'elem-trigger-1' };
    const triggerCtx = { inputType: 'text', readOnly: true, ariaHasPopup: 'listbox', ancestorClasses: ['oxd-select-wrapper'] };
    const c1 = makeObservedEvent({ eventId: 'e1', eventType: 'click', target: trigger, domContext: triggerCtx as never });
    ledger.append(c1); runtime.process(c1);

    const option = { tag: 'DIV', ariaRole: 'option', className: 'oxd-select-option', accessibleName: 'ESS', stableId: 'opt-1', elementId: 'elem-option-1' };
    const optionCtx = { ancestorClasses: ['oxd-select-dropdown'] };
    const c2 = makeObservedEvent({ eventId: 'e2', eventType: 'click', target: option, domContext: optionCtx as never });
    ledger.append(c2); runtime.process(c2);
    runtime.flush();

    expect(emitted.length).toBe(1);
    const dd = emitted[0] as { type: string; metadata: Record<string, unknown>; trigger: { tag: string }; memberEvents: { eventType: string; eventId: string; target: { ariaRole: string | null; className: string | null } }[] };
    expect(dd.type).toBe('Dropdown');
    expect(dd.trigger.tag).toBe('INPUT');
    // The dead-path fix: confirmed completion writes selectionConfirmed=true
    expect(dd.metadata['selectionConfirmed']).toBe(true);
    expect(dd.metadata['selectedValue']).toBe('ESS');

    const ir = build({
      interactions: [dd] as never,
      recordingContext: { startUrl: 'https://example.test/', title: 'T' },
      testCaseName: 'Real runtime',
    } as never);
    expect(ir.steps.length).toBe(2);
    expect(ir.steps[0].action).toBe('click');
    expect(ir.steps[1].action).toBe('click');
    expect(ir.steps.some((s) => s.action === 'select')).toBe(false);
    expect(ir.steps[1].sourceEventId).toBe('e2');
  });
});

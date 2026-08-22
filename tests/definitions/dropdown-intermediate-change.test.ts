/**
 * P11 — Native `<select>` intermediate-change completion (6C family).
 *
 * Real-Chrome validation (2026-08-22, notes/multipattern-validation-2026-08-22.md
 * finding F4/V4): a keyboard-driven native <select> fires a TRUSTED `change`
 * after every ArrowDown. The Dropdown lifecycle completes on the FIRST change
 * (dropdown.ts native-SELECT branch) → selectedValue pins the intermediate
 * option ("Low") while the user kept driving to "high". The generated spec
 * replays the WRONG choice.
 *
 * Contract (spec §3b, mirrors DatePicker's typed-wins precedent):
 *   selectedValue = FINAL committed choice, not the first observed change.
 *   Structural completion only — no timing.
 *
 * These pins are RED on the current build (they fail for the right reason:
 * the lifecycle completes on the first change) and must go GREEN under 6C.
 * The old "completes on first change" behavior is captured as a legacy guard
 * test (last change == first change → same result, single-change flow must
 * still work).
 */

import { describe, it, expect } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { ALL_DEFINITIONS } from '../../src/definitions';
import { makeObservedEvent } from '../helpers/make-event';
import type {
  ComponentInteraction,
  ElementIdentity,
  ObservedEvent,
} from '../../src/shared/component-types';

// ── harness (mirrors tests/definitions/core-definitions.test.ts) ──────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    tag: 'SELECT',
    stableId: 'prio',
    ariaRole: 'listbox',
    accessibleName: 'Priority',
    ariaLabel: null,
    className: '',
    textContent: '',
    inputType: null,
    value: null,
    checked: null,
    uniqueAttrSelector: null,
    elementPath: 'body > select#prio',
    // remaining ElementIdentity fields
    ...({} as Partial<ElementIdentity>),
    ...overrides,
  } as ElementIdentity;
}

function makeContext(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputType: null,
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
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return makeObservedEvent({
    eventId,
    eventType: eventType as any,
    target: makeTarget(target),
    domContext: makeContext() as any,
    ...eventOverrides,
  });
}

function setupRuntime() {
  const emitted: ComponentInteraction[] = [];
  const ledger = new EvidenceLedger();
  const config = { onEmit: (i: ComponentInteraction) => emitted.push(i), evidenceLedger: ledger };
  const runtime = createRuntime(ALL_DEFINITIONS, config);
  return { runtime, emitted, ledger };
}

function processFull(
  runtime: ComponentRuntime,
  ledger: EvidenceLedger,
  event: ObservedEvent,
): void {
  // NOTE: no flush() between events — flush interrupts active lifecycles
  // (it is the end-of-recording drain). The native-select test in
  // core-definitions.test.ts processes events the same way.
  ledger.append(event);
  runtime.process(event);
}

const SELECT = { tag: 'SELECT' as const, stableId: 'prio', accessibleName: 'Priority' };

/** Drive the real user path observed live: focus → open (Enter) → ArrowDown×n → Enter commit → blur. */
function driveKeyboardSelect(
  runtime: ComponentRuntime,
  ledger: EvidenceLedger,
  changes: string[],
): void {
  // focus the select (opens lifecycle via focus trigger)
  processFull(runtime, ledger, makeEvent('f1', 'focus', SELECT));
  // open dropdown
  processFull(runtime, ledger, makeEvent('k1', 'keydown', SELECT));
  // each ArrowDown lands on a new option → trusted change fires per step
  let n = 0;
  for (const value of changes) {
    n += 1;
    processFull(runtime, ledger, makeEvent(`k${n + 1}`, 'keydown', SELECT));
    processFull(runtime, ledger, makeEvent(`c${n}`, 'change', SELECT, { valueAfter: value }));
  }
  // commit (Enter) and leave the field (blur) — structural end
  processFull(runtime, ledger, makeEvent(`k${n + 2}`, 'keydown', SELECT));
  processFull(runtime, ledger, makeEvent('b1', 'blur', SELECT, { valueAfter: changes[changes.length - 1] }));
}

// ── P11 pins ─────────────────────────────────────────────────────────

describe('P11 — native select intermediate change (dropdown.ts native-SELECT branch)', () => {
  it('P11a: records the FINAL choice when the user arrows past options (typed-through case)', () => {
    // Live observation: options Any → Low → High → Urgent; user drove to high.
    // Change fired on Low (intermediate) then high (final). Must record high.
    const { runtime, emitted, ledger } = setupRuntime();
    driveKeyboardSelect(runtime, ledger, ['Low', 'high']);

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('high');
  });

  it('P11b: single ArrowDown (one intermediate change) does not pin the wrong value', () => {
    // The exact live case: user wanted 'high' (index 2) — first change was 'Low'.
    const { runtime, emitted, ledger } = setupRuntime();
    driveKeyboardSelect(runtime, ledger, ['Low']);

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('Low'); // last change == only change → correct
    // and the lifecycle must have completed exactly once (no duplicates)
    const dropdowns = emitted.filter((e) => e.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
  });

  it('P11c: intermediate changes do NOT emit a Dropdown per change (no duplicate lifecycles)', () => {
    const { runtime, emitted, ledger } = setupRuntime();
    driveKeyboardSelect(runtime, ledger, ['Low', 'high', 'urgent']);

    const dropdowns = emitted.filter((e) => e.type === 'Dropdown');
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].metadata.selectedValue).toBe('urgent');
  });

  it('P11d: lifecycle stays open between keydowns (blur ends it, not the first change)', () => {
    // After the FIRST change, a second keydown+change must still land in the SAME lifecycle.
    const { runtime, emitted, ledger } = setupRuntime();
    driveKeyboardSelect(runtime, ledger, ['Low', 'high']);

    const dropdowns = emitted.filter((e) => e.type === 'Dropdown');
    // The pinned defect emits on the first change; the second change then has
    // no lifecycle (falls to Unclassified). Exactly-one lifecycle proves it
    // stayed open through both changes.
    expect(dropdowns.length).toBe(1);
    expect(dropdowns[0].metadata.selectedValue).toBe('high');
    // and the second change must not spawn a second interaction of any type
    const straySelect = emitted.filter(
      (e) => e.trigger.stableId === 'prio' && e.type !== 'Dropdown',
    );
    expect(straySelect.length).toBe(0);
  });

  it('P11e LEGACY GUARD: single-change flow still completes with that value', () => {
    // Mouse-driven or one-shot commit: focus → change → blur. Same as today's
    // core-definitions pin (must not regress when completion moves to blur).
    const { runtime, emitted, ledger } = setupRuntime();
    processFull(runtime, ledger, makeEvent('f1', 'focus', SELECT));
    processFull(runtime, ledger, makeEvent('c1', 'change', SELECT, { valueAfter: 'USA' }));
    processFull(runtime, ledger, makeEvent('b1', 'blur', SELECT, { valueAfter: 'USA' }));

    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('USA');
  });

  it('P11f LEGACY GUARD: existing no-op / option-click paths unchanged', () => {
    // Option-click path (combobox) is untouched by P11 — one option click
    // completes with the option's name (mirrors core-definitions 'real
    // selection' fixture).
    const { runtime, emitted, ledger } = setupRuntime();
    const trigger = {
      tag: 'INPUT',
      ariaRole: 'combobox',
      stableId: 'sel2',
      accessibleName: '',
      className: 'oxd-select-text',
    };
    const ctx = makeContext({
      inputType: 'text',
      readOnly: true,
      ariaHasPopup: 'listbox',
      ancestorClasses: ['oxd-select-wrapper'],
    });
    processFull(
      runtime, ledger,
      makeEvent('c1', 'click', trigger, { domContext: ctx as any, valueBefore: '-- Admin --' }),
    );
    const option = {
      tag: 'DIV',
      ariaRole: 'option',
      className: 'oxd-select-option',
      accessibleName: 'ESS',
    };
    processFull(
      runtime, ledger,
      makeEvent('c2', 'click', option, {
        domContext: makeContext({ ancestorClasses: ['oxd-select-dropdown'] }) as any,
      }),
    );
    const dropdown = emitted.find((e) => e.type === 'Dropdown');
    expect(dropdown).toBeDefined();
    expect(dropdown!.metadata.selectedValue).toBe('ESS');
  });
})

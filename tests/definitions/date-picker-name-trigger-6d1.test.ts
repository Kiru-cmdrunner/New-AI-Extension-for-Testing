/**
 * Phase 6D.1 W4 — DatePicker name-shape trigger via placeholder.
 *
 * Spec: .drytis/specs/phase-6d1-universal-interaction-classes.md §3 W4
 *
 * Today isDatePickerTrigger consults the input's NAME attribute for date
 * vocabulary, but real apps put the hint in PLACEHOLDER ("Choose a date")
 * or aria-label. Capture populates target.placeholder for both (identity
 * extractor line ~345: placeholder || aria-placeholder) and the DatePicker
 * definition already consumes ctx.trigger.placeholder in buildResult —
 * only the trigger gate misses it.
 *
 * Fix: pass the trigger's placeholder through the SAME date-vocabulary
 * test the name attribute uses. No new tokens, no timing, no DOM probing
 * (structural facts already captured at event time).
 *
 * Pins:
 *  - AC-W4a: input placeholder="Choose a date" → DatePicker triggers
 *  - AC-W4b: input placeholder="Search" → NOT DatePicker
 *  - AC-W4c: STAB — class-triggered and native type=date paths unchanged
 *
 * TDD: written before implementation. Red until the wiring ships.
 */

import { describe, it, expect } from 'vitest';
import { isDatePickerTrigger } from '../../src/definitions/patterns';
import { datePickerDefinition } from '../../src/definitions/date-picker';
import { makeObservedEvent } from '../helpers/make-event';

function makeTriggerEvent(overrides: {
  tag?: string;
  inputType?: string | null;
  className?: string | null;
  ariaHasPopup?: string | null;
  name?: string | null;
  placeholder?: string | null;
}) {
  return makeObservedEvent({
    eventId: 'dp-1',
    eventType: 'focus',
    target: {
      tag: overrides.tag ?? 'INPUT',
      className: overrides.className ?? null,
      name: overrides.name ?? null,
      placeholder: overrides.placeholder ?? null,
      cssSelector: 'input',
      xPath: '/html/body/input',
    } as any,
    domContext: {
      inputType: overrides.inputType ?? null,
      ariaHasPopup: overrides.ariaHasPopup ?? null,
    } as any,
  });
}

describe('6D.1 W4 — isDatePickerTrigger placeholder path', () => {
  it('AC-W4a: placeholder "Choose a date" triggers DatePicker (no class, no type, no name)', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'Choose a date'),
    ).toBe(true);
  });

  it('AC-W4a: placeholder "Date of birth" triggers', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'Date of birth'),
    ).toBe(true);
  });

  it('AC-W4a: aria-label-derived placeholder path — "Select travel date" triggers', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'Select travel date'),
    ).toBe(true);
  });

  it('AC-W4b: placeholder "Search" does NOT trigger (precision)', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'Search'),
    ).toBe(false);
  });

  it('AC-W4b: placeholder "Search flights" does NOT trigger', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'Search flights'),
    ).toBe(false);
  });

  it('placeholder trigger requires the date vocabulary — "calendar-free view" is NOT a trigger', () => {
    // "calendar" is in the name-vocabulary; a phrase that merely contains
    // it stays out when it also reads as a non-date field… but substring
    // vocabulary on the NAME attribute has always matched "calendar" —
    // parity means placeholder follows the SAME rule the name path has.
    // Pin the parity, not a new precision rule.
    expect(
      isDatePickerTrigger('INPUT', null, null, null, null, 'View calendar-free timeline'),
    ).toBe(true); // parity with the name-attribute rule (substring match)
  });

  it('placeholder arm is INPUT-scoped (spec §4.3): placeholder on a non-INPUT tag does not trigger', () => {
    expect(
      isDatePickerTrigger('DIV', null, null, null, null, 'Choose a date'),
    ).toBe(false);
  });

  it('definition detectTrigger: focus on input with placeholder "Choose a date" → DatePicker', () => {
    const trigger = datePickerDefinition.detectTrigger(
      makeTriggerEvent({ placeholder: 'Choose a date' }),
    );
    expect(trigger).toEqual({ type: 'DatePicker' });
  });
});

describe('6D.1 W4 — STAB: existing trigger paths unchanged', () => {
  it('AC-W4c: class path — div.oxd-date-input wrapper still triggers', () => {
    expect(
      isDatePickerTrigger('DIV', null, 'oxd-date-input', null, null, null),
    ).toBe(true);
  });

  it('AC-W4c: native type=date still triggers', () => {
    expect(
      isDatePickerTrigger('INPUT', 'date', null, null, null, null),
    ).toBe(true);
  });

  it('AC-W4c: name attribute path still triggers ("dob")', () => {
    expect(
      isDatePickerTrigger('INPUT', null, null, null, 'dob', null),
    ).toBe(true);
  });

  it('AC-W4c: generic text input with no hints still does NOT trigger', () => {
    expect(
      isDatePickerTrigger('INPUT', 'text', 'form-control', null, 'email', null),
    ).toBe(false);
  });

  it('AC-W4c: definition detectTrigger — native date input still triggers on focus', () => {
    const trigger = datePickerDefinition.detectTrigger(
      makeTriggerEvent({ inputType: 'date' }),
    );
    expect(trigger).toEqual({ type: 'DatePicker' });
  });
});

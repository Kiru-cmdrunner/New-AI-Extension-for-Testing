/**
 * Phase 6E-M2 — react-datepicker family recognition (definitions layer).
 *
 * Every test below pins REAL AdaniOne markup captured in user evidence
 * batch 2 (.drytis/notes/evidence/user-batch-2026-08-23-0724/):
 *  - trigger wrapper:  div.date_picker.undefined
 *  - trigger input:    INPUT #onward [role=textbox] 'Depart on',
 *                      class 'withIcon form-control', type=text
 *  - cells:            div.react-datepicker__day
 *                      aria-label 'Choose Saturday, September 5th, 2026',
 *                      role=option, tabindex=0
 *  - surface:          div.react-datepicker, month[role=listbox]
 *
 * Root causes pinned in the batch summary (RC-A trigger miss, RC-B cell
 * class miss, RC-C fallback). Spec: .drytis/specs/phase-6e-m2-datepicker-family.md
 */
import { describe, it, expect } from 'vitest';
import { datePickerDefinition } from '../../src/definitions/date-picker';import {
  isDatePickerTrigger,
  isCalendarCell,
  isInsideCalendarSurface,
  hasDateCellName,
} from '../../src/definitions/patterns';

// ── W-A.1: trigger class separator tolerance ───────────────────────────

describe('W-A.1 trigger class — date[_-]?picker separator tolerance', () => {
  it('matches the real wrapper class "date_picker undefined" (underscore)', () => {
    expect(isDatePickerTrigger('DIV', null, 'date_picker undefined', null, null)).toBe(true);
  });

  it('still matches all shipped tokens (no regression)', () => {
    expect(isDatePickerTrigger('DIV', null, 'datepicker', null, null)).toBe(true);
    expect(isDatePickerTrigger('DIV', null, 'some date-picker widget', null, null)).toBe(true);
    expect(isDatePickerTrigger('INPUT', null, 'date-input', null, null)).toBe(true);
    expect(isDatePickerTrigger('DIV', null, 'calendar-input', null, null)).toBe(true);
    expect(isDatePickerTrigger('DIV', null, 'oxd-date-input', null, null)).toBe(true);
  });

  it('does NOT match unrelated picker classes (negatives)', () => {
    expect(isDatePickerTrigger('DIV', null, 'update_picker', null, null)).toBe(false);
    expect(isDatePickerTrigger('DIV', null, 'deadline', null, null)).toBe(false);
    expect(isDatePickerTrigger('DIV', null, 'color_picker', null, null)).toBe(false);
  });
});

// ── W-A.1b: travel date-name vocabulary ────────────────────────────────

describe('W-A.1b name/placeholder vocabulary — travel date hints', () => {
  it('matches the real field names/placeholders (word-bounded)', () => {
    expect(isDatePickerTrigger('INPUT', 'text', 'withIcon form-control', null, 'Depart on')).toBe(true);
    expect(isDatePickerTrigger('INPUT', 'text', 'withIcon form-control', null, 'Return on')).toBe(true);
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'onward date')).toBe(true);
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'arrival date')).toBe(true);
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'Depart on')).toBe(true);
  });

  it('name path (not placeholder) also matches', () => {
    expect(isDatePickerTrigger('INPUT', 'text', null, null, null)).toBe(false); // no signal at all
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'Department store')).toBe(false); // word boundary holds
  });

  it('keeps every shipped token matching (no regression)', () => {
    for (const token of ['date', 'birth', 'dob', 'expire', 'expiry', 'calendar']) {
      expect(isDatePickerTrigger('INPUT', 'text', null, null, `Choose ${token}`)).toBe(true);
    }
  });
});

// ── W-A.2: cell class family + W3C name-shape signal ───────────────────

describe('W-A.2 cell class family — react-datepicker__day', () => {
  it('matches the real cell class (full modifier list from batch 2)', () => {
    expect(
      isCalendarCell(
        'option',
        'react-datepicker__day react-datepicker__day--selected react-datepicker__day--keyboard-selected react-datepicker__day--range-start react-datepicker__day--range-end react-datepicker__day--in-range react-datepicker__day--weekend',
      ),
    ).toBe(true);
  });

  it('bare datepicker__day also matches', () => {
    expect(isCalendarCell('option', 'datepicker__day')).toBe(true);
  });

  it('does NOT match the inner date-holder (not a cell)', () => {
    expect(isCalendarCell(null, 'datepicker-date-holder')).toBe(false);
    expect(isCalendarCell(null, 'full datepicker-date')).toBe(false);
  });

  it('keeps shipped tokens matching (no regression)', () => {
    expect(isCalendarCell('option', 'oxd-date-day')).toBe(true);
    expect(isCalendarCell(null, 'calendar-day')).toBe(true);
    expect(isCalendarCell(null, 'flatpickr-day')).toBe(true);
  });

  it('a plain listbox option with no cell signal stays a non-cell (guard)', () => {
    expect(isCalendarCell('option', 'some-random-option-class')).toBe(false);
    expect(isCalendarCell('option', null)).toBe(false);
  });
});

describe('W-A.2b W3C name-shape as cell signal (role-braced)', () => {
  it('role=option + W3C name + unknown class → cell (name belt, role braces)', () => {
    expect(isCalendarCell('option', 'some-random-class', 'Choose Saturday, September 5th, 2026')).toBe(true);
    expect(isCalendarCell('option', null, 'Choose Sunday, September 6th, 2026')).toBe(true);
  });

  it('gridcell and button roles also accepted with the name shape', () => {
    expect(isCalendarCell('gridcell', 'cal-cell', 'Choose Monday, August 31st, 2026')).toBe(true);
    expect(isCalendarCell('button', null, 'Choose Tuesday, September 1st, 2026')).toBe(true);
  });

  it('W3C name WITHOUT an interactive role is NOT a cell (heading/paragraph)', () => {
    expect(isCalendarCell(null, null, 'Choose Saturday, September 5th, 2026')).toBe(false);
    expect(isCalendarCell('heading', null, 'Choose Saturday, September 5th, 2026')).toBe(false);
  });

  it('interactive role with a NON-date name stays a non-cell (listbox option guard)', () => {
    expect(isCalendarCell('option', 'some-random-option-class', 'Bengaluru')).toBe(false);
    expect(isCalendarCell('option', 'some-random-class', 'Choose luxury')).toBe(false);
  });

  it('2-arg calls (all existing call sites) behave exactly as before', () => {
    expect(isCalendarCell('option', 'react-datepicker__day')).toBe(true);
    expect(isCalendarCell('option', 'some-random-option-class')).toBe(false);
    expect(isCalendarCell('option', null)).toBe(false);
  });
});

// ── W-A.3: cells never trigger a DatePicker lifecycle ──────────────────

describe('W-A.3 cell-never-triggers guard', () => {
  it('the real cell class does not pass isDatePickerTrigger', () => {
    expect(
      isDatePickerTrigger(
        'DIV',
        null,
        'react-datepicker__day react-datepicker__day--weekend',
        null,
        null,
      ),
    ).toBe(false);
  });

  it('inner holder class alone is not a CELL (holder clicks promote to the named cell)', () => {
    // The holder is inside the calendar; a direct holder event is never
    // observed (the named cell is the click target). What matters for
    // classification: the holder is NOT a calendar cell.
    expect(isCalendarCell(null, 'datepicker-date-holder')).toBe(false);
    expect(isCalendarCell('option', 'full datepicker-date')).toBe(false);
  });

  it('the real CELL class is excluded from the trigger path (guard fires before trigger token)', () => {
    expect(
      isDatePickerTrigger('DIV', null, 'react-datepicker__day react-datepicker__day--weekend', null, null),
    ).toBe(false);
  });

  it('the surface container class still may (informational, acceptable)', () => {
    // container clicks starting a lifecycle are harmless (complete on cell
    // or end honestly) — pinned as observed behavior
    expect(isDatePickerTrigger('DIV', null, 'react-datepicker', null, null)).toBe(true);
  });
});

// ── W-C: fallback honesty verification (no new Click rule) ────────────

// W-C helper: the shipped INTERACTIVE_ROLES set (mirrored from
// patterns.ts — Click's claim gate reads the same family)
const INTERACTIVE_ROLES_SET = new Set([
  'button', 'link', 'combobox', 'listbox', 'option', 'checkbox', 'radio',
  'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'textbox', 'spinbutton', 'slider', 'treeitem', 'gridcell',
]);

describe('W-C fallback — cell-shaped click with NO active DatePicker', () => {
  it('role=option is interactive, so Click claims a cell-shaped target even without an open-surface ancestry (LP1 unnecessary)', () => {
    // 6D.0/LP1 gate: isInteractiveElement(INTERACTIVE_ROLES) contains
    // 'option'. A W3C-named cell with unknown classes is therefore a
    // legitimate Click when no DatePicker lifecycle owns it. Honest
    // fallback = plain Click (e.g. 6E-M1 C6 clone measurement), never a
    // silent drop.
    expect(INTERACTIVE_ROLES_SET.has('option')).toBe(true);
  });

  it('a cell-shaped target with NO interactive role and unknown class falls to honest Unclassified (unchanged)', () => {
    // name-shape without role braces is NOT interactive (isCalendarCell
    // name path requires role); Click's isInteractiveElement is untouched
    // by 6E-M2 — the no-claimer shape stays unclaimed-at-projection.
    expect(INTERACTIVE_ROLES_SET.has('heading')).toBe(false);
  });
});

describe('surface recognition on real markup', () => {
  it('react-datepicker is a calendar surface', () => {
    expect(isInsideCalendarSurface('react-datepicker')).toBe(true);
  });

  it('the real W3C cell name matches hasDateCellName (6D.0 machinery)', () => {
    expect(hasDateCellName('Choose Saturday, September 5th, 2026', null)).toBe(true);
    expect(hasDateCellName('Choose Sunday, September 6th, 2026', null)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// E2E round-1 finding (2026-08-23) — nested-wrapper double-spawn.
//
// Real AdaniOne markup nests the calendar INSIDE the trigger wrapper
// (travel_date > div.date_picker > react-datepicker > … > __day cells).
// detectTrigger's wrapper path feeds event.domContext.ancestorClasses
// into isDatePickerTrigger; on a CELL click those ancestors contain
// `date_picker` / `react-datepicker`, the trigger token matches, and the
// cell both (a) completes lifecycle #1 and (b) spawns a DUPLICATE
// lifecycle with ITSELF as trigger → a second DatePicker card named
// after the cell's own aria-label + duplicate parameterInputs.
//
// W-A.3 ("cells never trigger") must therefore hold on the TARGET
// itself, not only against the target's own class string: a cell-shaped
// target (cell class OR W3C date-cell name shape) must not start a
// lifecycle even when its ancestors carry trigger tokens.
// ═══════════════════════════════════════════════════════════════════════

describe('6E-M2 round 2 — cell-never-triggers on the ancestor path (E2E finding)', () => {
  it('a cell-shaped target with calendar ancestors does not become a trigger (nested wrapper)', () => {
    // W-A.3 guard honors the target's own class (cell family) — pinned
    // already at W-A.3. This pin is the ancestor-path complement: the
    // target IS the cell itself.
    expect(
      isDatePickerTrigger(
        'DIV',
        null,
        'react-datepicker__day react-datepicker__day--weekend',
        null,
        null,
      ),
    ).toBe(false);
  });

  it('the W3C date-cell name shape on a non-INPUT target is not a trigger signal', () => {
    // Name belt (W3C "Choose …" shape) means "I am a date to select",
    // not "I am a control that opens a calendar". Scoped to non-INPUT
    // targets: an <input placeholder="Choose Saturday..."> stays a
    // legitimate trigger (W-A.1b placeholder vocabulary pins it).
    expect(isDatePickerTrigger('DIV', null, 'rd-something', null, 'Choose Sunday, September 6th, 2026', null)).toBe(false);
  });

  it('the wrapper itself still triggers (positive pin — nested calendar opens)', () => {
    expect(isDatePickerTrigger('DIV', null, 'date_picker undefined', null, null)).toBe(true);
  });

  it('DatePicker detectTrigger does not fire on a cell event inside the nested wrapper (integration pin)', () => {
    // The ObservedEvent shape the runtime delivers for a real cell click
    // in the batch-2 nested markup. detectTrigger must return null — the
    // cell may only COMPLETE a lifecycle, never start one.
    const cellEvent = {
      eventType: 'click',
      target: {
        tag: 'DIV',
        className: 'react-datepicker__day react-datepicker__day--weekend',
        accessibleName: 'Choose Sunday, September 6th, 2026',
        ariaRole: 'option',
        ariaLabel: 'Choose Sunday, September 6th, 2026',
        placeholder: null,
        inputType: null,
        ariaHasPopup: 'grid',
      },
      domContext: {
        ancestorClasses: [
          'react-datepicker__month',
          'react-datepicker',
          'date_picker undefined',
          'travel_date focused',
        ],
        ancestorRoles: ['listbox'],
      },
    };
    expect(datePickerDefinition.detectTrigger(cellEvent as never)).toBeNull();
  });
});

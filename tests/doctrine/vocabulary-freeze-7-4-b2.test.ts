/**
 * 7.4-B2 S2A-12 / R12 — vocabulary freeze pin.
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §S2A-12:
 *   - DROPDOWN_TRIGGER_CLASS_RE source token list byte-identical before/after
 *   - No new class/keyword vocabulary introduced in src/definitions/
 *
 * Doctrine: "vocabulary shrinks, never grows" — the guard REMOVES INPUT-tag
 * exposure of DROPDOWN_TRIGGER_CLASS_RE; no tokens are added anywhere.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('7.4-B2 S2A-12 — vocabulary freeze (R12)', () => {
  const DEFS_DIR = path.join(__dirname, '..', '..', 'src', 'definitions');

  it('DROPDOWN_TRIGGER_CLASS_RE token list unchanged', () => {
    const patternsSrc = fs.readFileSync(
      path.join(DEFS_DIR, 'patterns.ts'),
      'utf-8',
    );
    // The exact regex literal from patterns.ts:276-277
    const match = patternsSrc.match(
      /DROPDOWN_TRIGGER_CLASS_RE\s*=\s*\n?\s*(\/.+?\/i);/,
    );
    expect(match, 'DROPDOWN_TRIGGER_CLASS_RE must exist in patterns.ts').toBeTruthy();
    const expected =
      '/(oxd-select-text|select|combobox|dropdown|antd.*select|MuiSelect|selector|traveler|passenger|cabin|class-selector|trip-type|economy|traveller)/i';
    expect(match![1]).toBe(expected);
  });

  it('DROPDOWN_OPTION_CLASS_RE token list unchanged', () => {
    const patternsSrc = fs.readFileSync(
      path.join(DEFS_DIR, 'patterns.ts'),
      'utf-8',
    );
    const match = patternsSrc.match(
      /DROPDOWN_OPTION_CLASS_RE\s*=\s*\n?\s*(\/.+?\/i);/,
    );
    expect(match).toBeTruthy();
    const expected = '/(oxd-select-option|select-option|option-item|list-option|ant-select-item)/i';
    expect(match![1]).toBe(expected);
  });

  it('no new vocabulary tokens introduced in src/definitions/ (grep guard)', () => {
    // The B2 change only ADDS guards (isTextEntry, isDropdownOption, ariaHasPopup=listbox)
    // — no new class regexes or keyword arrays are introduced.
    // Parse all .ts files in src/definitions/ for new const ..._CLASS_RE declarations
    // that weren't there before. We count them: the count must match the known baseline.
    const files = fs.readdirSync(DEFS_DIR).filter(
      (f) => f.endsWith('.ts') && f !== 'index.ts',
    );
    let classReCount = 0;
    for (const f of files) {
      const src = fs.readFileSync(path.join(DEFS_DIR, f), 'utf-8');
      const matches = src.match(/const\s+\w+_CLASS_RE\s*=/g);
      if (matches) classReCount += matches.length;
    }
    // Known baseline: 10 *_CLASS_RE constants across src/definitions/
    // (patterns.ts: INTERACTIVE, OPEN_SELECTION_SURFACE, DROPDOWN_TRIGGER,
    //  DROPDOWN_OPTION, DROPDOWN_SURFACE, DATEPICKER_TRIGGER, DATEPICKER_CELL,
    //  CALENDAR_SURFACE; checkbox.ts: CHECKBOX_WRAPPER; radio-button.ts: RADIO_WRAPPER)
    expect(classReCount).toBe(10);
  });
});

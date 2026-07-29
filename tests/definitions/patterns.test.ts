/**
 * Unit tests for pattern matching utilities.
 *
 * Tests cover: interactivity checks, dropdown detection, date picker
 * detection, checkbox/radio detection, bestName, elementKey, scroll delta,
 * and the OrangeHRM-specific normalization (§4.2).
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.3, §4
 */

import { describe, it, expect } from 'vitest';
import {
  bestName,
  isInteractiveElement,
  isDropdownTrigger,
  isDropdownOption,
  isInsideDropdownSurface,
  normalizeDisplayValue,
  isDatePickerTrigger,
  isCalendarCell,
  isCalendarCellWithFallback,
  isInsideCalendarSurface,
  isCalendarNavigationButton,
  isCheckbox,
  isRadio,
  isLink,
  isTextEntry,
  isFileInput,
  isSlider,
  isTab,
  hasScrollDelta,
  elementKey,
  HOVER_DWELL_THRESHOLD_MS,
} from '../../src/definitions/patterns';
import type { ElementIdentity } from '../../src/shared/types';

// Helper to create a minimal ElementIdentity
function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
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
    xPath: '//div',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

// ── bestName ───────────────────────────────────────────────────────────

describe('bestName', () => {
  it('returns accessibleName when present', () => {
    expect(bestName('Submit', 'aria-label', 'placeholder')).toBe('Submit');
  });

  it('falls back to ariaLabel when accessibleName is empty', () => {
    expect(bestName('', 'Login Button', 'placeholder')).toBe('Login Button');
  });

  it('falls back to placeholder when name and label are empty', () => {
    expect(bestName('', null, 'Enter password')).toBe('Enter password');
  });

  it('returns "element" when nothing is available', () => {
    expect(bestName('', null, null)).toBe('element');
  });

  it('trims whitespace', () => {
    expect(bestName('  Submit  ', null, null)).toBe('Submit');
  });

  // Bug 2 regression: empty string accessibleName must fall through via || (not ??)
  it('returns "element" when accessibleName is empty string and no fallbacks', () => {
    expect(bestName('', null, null)).toBe('element');
  });
});

// ── isInteractiveElement ───────────────────────────────────────────────

describe('isInteractiveElement', () => {
  it('returns true for BUTTON tag', () => {
    expect(isInteractiveElement('BUTTON', null, null, null)).toBe(true);
  });

  it('returns true for A tag', () => {
    expect(isInteractiveElement('A', null, null, null)).toBe(true);
  });

  it('returns true for INPUT tag', () => {
    expect(isInteractiveElement('INPUT', null, null, null)).toBe(true);
  });

  it('returns true for SELECT tag', () => {
    expect(isInteractiveElement('SELECT', null, null, null)).toBe(true);
  });

  it('returns true for role=button', () => {
    expect(isInteractiveElement('DIV', 'button', null, null)).toBe(true);
  });

  it('returns true for role=combobox', () => {
    expect(isInteractiveElement('DIV', 'combobox', null, null)).toBe(true);
  });

  it('returns true for tabIndex >= 0', () => {
    expect(isInteractiveElement('DIV', null, null, 0)).toBe(true);
  });

  it('returns true for interactive class patterns', () => {
    expect(isInteractiveElement('DIV', null, 'btn btn-primary', null)).toBe(true);
    expect(isInteractiveElement('DIV', null, 'clickable', null)).toBe(true);
  });

  it('returns false for bare div', () => {
    expect(isInteractiveElement('DIV', null, null, null)).toBe(false);
  });

  it('returns false for non-interactive span', () => {
    expect(isInteractiveElement('SPAN', null, 'label-text', null)).toBe(false);
  });

  it('returns false for negative tabIndex', () => {
    expect(isInteractiveElement('DIV', null, null, -1)).toBe(false);
  });
});

// ── Dropdown patterns ──────────────────────────────────────────────────

describe('Dropdown patterns', () => {
  it('detects native SELECT as dropdown trigger', () => {
    expect(isDropdownTrigger('SELECT', null, null)).toBe(true);
  });

  it('detects role=combobox as dropdown trigger', () => {
    expect(isDropdownTrigger('DIV', 'combobox', null)).toBe(true);
  });

  it('detects OXD class as dropdown trigger', () => {
    expect(isDropdownTrigger('DIV', null, 'oxd-select-text--after')).toBe(true);
  });

  it('detects role=option as dropdown option', () => {
    expect(isDropdownOption('option', null)).toBe(true);
  });

  it('detects OXD option class', () => {
    expect(isDropdownOption(null, 'oxd-select-option')).toBe(true);
  });

  it('detects dropdown surface', () => {
    expect(isInsideDropdownSurface('oxd-select-dropdown')).toBe(true);
  });

  // Bug 2 regression: normalizeDisplayValue strips OXD formatting
  describe('normalizeDisplayValue', () => {
    it('strips leading/trailing dashes', () => {
      expect(normalizeDisplayValue('-- Fijian --')).toBe('Fijian');
    });

    it('strips em-dashes', () => {
      expect(normalizeDisplayValue('— Married —')).toBe('Married');
    });

    it('handles plain values', () => {
      expect(normalizeDisplayValue('India')).toBe('India');
    });

    it('handles empty string', () => {
      expect(normalizeDisplayValue('')).toBe('');
    });

    it('strips colons', () => {
      expect(normalizeDisplayValue(': Single :')).toBe('Single');
    });
  });
});

// ── DatePicker patterns ────────────────────────────────────────────────

describe('DatePicker patterns', () => {
  it('detects native date input', () => {
    expect(isDatePickerTrigger('INPUT', 'date', null, null, null)).toBe(true);
  });

  it('detects native datetime-local input', () => {
    expect(isDatePickerTrigger('INPUT', 'datetime-local', null, null, null)).toBe(true);
  });

  it('detects OXD date input class', () => {
    expect(isDatePickerTrigger('DIV', null, 'oxd-date-input', null, null)).toBe(true);
  });

  it('detects name attribute hints', () => {
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'date_of_birth')).toBe(true);
    expect(isDatePickerTrigger('INPUT', 'text', null, null, 'emp_birthday')).toBe(true);
  });

  it('detects calendar cells', () => {
    expect(isCalendarCell('gridcell', 'oxd-date-day')).toBe(true);
  });

  it('detects calendar surface', () => {
    expect(isInsideCalendarSurface('oxd-date-input-dropdown')).toBe(true);
  });

  // Bug 7 regression: calendar navigation buttons must be identified
  describe('calendar navigation buttons', () => {
    it('detects OXD switch button class', () => {
      expect(isCalendarNavigationButton('button', null, 'oxd-calendar-switch-button')).toBe(true);
    });

    it('detects "Next Month" by name', () => {
      expect(isCalendarNavigationButton('button', 'Next Month', null)).toBe(true);
    });

    it('detects "Previous" by name', () => {
      expect(isCalendarNavigationButton('button', 'Previous Month', null)).toBe(true);
    });

    it('detects "Today" by name', () => {
      expect(isCalendarNavigationButton('button', 'Today', null)).toBe(true);
    });

    it('does NOT match actual calendar cells', () => {
      expect(isCalendarNavigationButton('gridcell', '15', 'oxd-date-day')).toBe(false);
    });
  });
});

// ── Checkbox / Radio patterns ──────────────────────────────────────────

describe('Checkbox / Radio patterns', () => {
  it('detects native checkbox', () => {
    expect(isCheckbox('INPUT', 'checkbox', null)).toBe(true);
  });

  it('detects ARIA checkbox', () => {
    expect(isCheckbox('DIV', null, 'checkbox')).toBe(true);
  });

  it('detects ARIA switch', () => {
    expect(isCheckbox('DIV', null, 'switch')).toBe(true);
  });

  it('detects native radio', () => {
    expect(isRadio('INPUT', 'radio', null)).toBe(true);
  });

  it('detects ARIA radio', () => {
    expect(isRadio('DIV', null, 'radio')).toBe(true);
  });
});

// ── Link patterns ──────────────────────────────────────────────────────

describe('Link patterns', () => {
  it('detects <a> tag', () => {
    expect(isLink('A', null)).toBe(true);
  });

  it('detects role=link', () => {
    expect(isLink('SPAN', 'link')).toBe(true);
  });

  it('rejects div without role', () => {
    expect(isLink('DIV', null)).toBe(false);
  });
});

// ── TextEntry patterns ─────────────────────────────────────────────────

describe('TextEntry patterns', () => {
  it('detects TEXTAREA', () => {
    expect(isTextEntry('TEXTAREA', null, null, false)).toBe(true);
  });

  it('detects text input', () => {
    expect(isTextEntry('INPUT', 'text', null, false)).toBe(true);
  });

  it('detects email input', () => {
    expect(isTextEntry('INPUT', 'email', null, false)).toBe(true);
  });

  it('detects password input', () => {
    expect(isTextEntry('INPUT', 'password', null, false)).toBe(true);
  });

  it('detects role=textbox', () => {
    expect(isTextEntry('DIV', null, 'textbox', false)).toBe(true);
  });

  it('detects contentEditable', () => {
    expect(isTextEntry('DIV', null, null, true)).toBe(true);
  });

  it('rejects checkbox input', () => {
    expect(isTextEntry('INPUT', 'checkbox', null, false)).toBe(false);
  });

  it('rejects radio input', () => {
    expect(isTextEntry('INPUT', 'radio', null, false)).toBe(false);
  });
});

// ── Other patterns ─────────────────────────────────────────────────────

describe('Other patterns', () => {
  it('detects file input', () => {
    expect(isFileInput('INPUT', 'file')).toBe(true);
    expect(isFileInput('INPUT', 'text')).toBe(false);
  });

  it('detects slider', () => {
    expect(isSlider('INPUT', 'range', null)).toBe(true);
    expect(isSlider('DIV', null, 'slider')).toBe(true);
  });

  it('detects tab', () => {
    expect(isTab('tab')).toBe(true);
    expect(isTab(null)).toBe(false);
  });

  it('hover threshold is 500ms', () => {
    expect(HOVER_DWELL_THRESHOLD_MS).toBe(500);
  });
});

// ── Scroll delta ───────────────────────────────────────────────────────

describe('hasScrollDelta', () => {
  // Bug 5 regression: zero-delta scroll events must be detected
  it('returns true for non-zero Y delta', () => {
    expect(hasScrollDelta(100, 0)).toBe(true);
  });

  it('returns true for non-zero X delta', () => {
    expect(hasScrollDelta(0, 50)).toBe(true);
  });

  it('returns true for both non-zero', () => {
    expect(hasScrollDelta(100, 50)).toBe(true);
  });

  it('returns false for zero deltas', () => {
    expect(hasScrollDelta(0, 0)).toBe(false);
  });

  it('returns false for null deltas', () => {
    expect(hasScrollDelta(null, null)).toBe(false);
  });
});

// ── elementKey ─────────────────────────────────────────────────────────

describe('elementKey', () => {
  it('prefers testId', () => {
    const id = makeIdentity({ testId: 'login-btn', stableId: 'submit', cssSelector: 'button#submit' });
    expect(elementKey(id)).toBe('testId:login-btn');
  });

  it('prefers dataCy over dataQa', () => {
    const id = makeIdentity({ dataCy: 'login', dataQa: 'qa-login' });
    expect(elementKey(id)).toBe('dataCy:login');
  });

  it('uses stableId when no test data attributes', () => {
    const id = makeIdentity({ stableId: 'username' });
    expect(elementKey(id)).toBe('id:username');
  });

  it('uses name + selector when no IDs', () => {
    const id = makeIdentity({ accessibleName: 'Username', cssSelector: 'input.username' });
    expect(elementKey(id)).toBe('name:Username|sel:input.username');
  });

  it('falls back to selector only', () => {
    const id = makeIdentity({ cssSelector: 'div.container > span' });
    expect(elementKey(id)).toBe('sel:div.container > span');
  });

  it('falls back to tag', () => {
    const id = makeIdentity({ cssSelector: '' });
    expect(elementKey(id)).toBe('tag:DIV');
  });

  it('produces same key for same identity', () => {
    const id1 = makeIdentity({ testId: 'btn', stableId: 'x' });
    const id2 = makeIdentity({ testId: 'btn', stableId: 'y' });
    expect(elementKey(id1)).toBe(elementKey(id2));
  });

  it('produces different keys for different testIds', () => {
    const id1 = makeIdentity({ testId: 'btn-1' });
    const id2 = makeIdentity({ testId: 'btn-2' });
    expect(elementKey(id1)).not.toBe(elementKey(id2));
  });
});

// ── Calendar Cell Fallback (AdaniOne) ────────────────────────────────

describe('isCalendarCellWithFallback (AdaniOne SPA)', () => {
  it('detects standard calendar cells (class-based)', () => {
    expect(isCalendarCellWithFallback('gridcell', 'react-datepicker__day', null)).toBe(true);
  });

  it('detects plain divs with day-number accessible names', () => {
    expect(isCalendarCellWithFallback(null, null, '15')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, '1')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, '31')).toBe(true);
  });

  it('rejects numbers outside day range', () => {
    expect(isCalendarCellWithFallback(null, null, '0')).toBe(false);
    expect(isCalendarCellWithFallback(null, null, '32')).toBe(false);
    expect(isCalendarCellWithFallback(null, null, '100')).toBe(false);
  });

  it('detects formatted date strings', () => {
    expect(isCalendarCellWithFallback(null, null, '15 July')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, 'July 15')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, '15/07')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, '2026-07-15')).toBe(true);
    expect(isCalendarCellWithFallback(null, null, 'Thu, 30 Jul')).toBe(true);
  });

  it('rejects non-date text', () => {
    expect(isCalendarCellWithFallback(null, null, 'Search')).toBe(false);
    expect(isCalendarCellWithFallback(null, null, 'Next Month')).toBe(false);
    expect(isCalendarCellWithFallback(null, null, '')).toBe(false);
    expect(isCalendarCellWithFallback(null, null, null)).toBe(false);
  });
});

// ── Expanded DatePicker Patterns (AdaniOne) ──────────────────────────

describe('Expanded DatePicker Patterns', () => {
  it('detects react-datepicker trigger', () => {
    expect(isDatePickerTrigger('INPUT', 'text', 'react-datepicker__input', null, null)).toBe(true);
  });

  it('detects AdaniOne-style trigger classes', () => {
    expect(isDatePickerTrigger('INPUT', null, 'depart-on', null, null)).toBe(true);
    expect(isDatePickerTrigger('INPUT', null, 'departure-date', null, null)).toBe(true);
    expect(isDatePickerTrigger('INPUT', null, 'travel-date', null, null)).toBe(true);
    expect(isDatePickerTrigger('INPUT', null, 'journey-date', null, null)).toBe(true);
  });

  it('detects expanded calendar surface patterns', () => {
    expect(isInsideCalendarSurface('react-datepicker')).toBe(true);
    expect(isInsideCalendarSurface('calendar-panel')).toBe(true);
    expect(isInsideCalendarSurface('picker-panel')).toBe(true);
    expect(isInsideCalendarSurface('date-picker-dropdown')).toBe(true);
  });

  it('detects expanded calendar cell patterns', () => {
    expect(isCalendarCell('gridcell', 'react-datepicker__day')).toBe(true);
    expect(isCalendarCell('gridcell', 'calendar-date')).toBe(true);
    expect(isCalendarCell(null, 'date-number')).toBe(true);
    expect(isCalendarCell(null, 'day-number')).toBe(true);
  });
});

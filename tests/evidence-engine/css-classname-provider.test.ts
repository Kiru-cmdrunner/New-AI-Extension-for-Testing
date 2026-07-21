/**
 * CSS Classname Provider Tests
 *
 * Tests framework component detection via CSS class names for:
 * - Material UI (MUI) — MuiCheckbox-root, MuiSwitch-root, etc.
 * - Ant Design (AntD) — ant-checkbox, ant-switch, etc.
 * - Bootstrap — btn, form-check-input, etc.
 * - Unknown classes produce no false positives
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CssClassnameProvider } from '../../src/classifier/evidence/providers/css-classname-provider.ts';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  mouseenterEvent,
  focusEvent,
} from './helpers.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function provider() {
  return new CssClassnameProvider();
}

const emptyBuffer = {
  events: [],
  startTime: Date.now(),
  endTime: Date.now(),
};

function getEvidence(cls: string, eventType: 'click' | 'mouseenter' | 'focus' = 'click') {
  const p = provider();
  const event = eventType === 'click'
    ? clickEvent({ className: cls })
    : eventType === 'mouseenter'
      ? mouseenterEvent({ className: cls })
      : focusEvent({ className: cls });
  return p.onEvent(event, emptyBuffer);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CssClassnameProvider — MUI Detection', () => {
  beforeEach(() => resetEventCounter());

  it('MuiCheckbox-root → Checkbox', () => {
    const ev = getEvidence('MuiCheckbox-root Mui-checked');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Checkbox');
    expect(ev[0].confidence).toBe(0.85);
    expect(ev[0].reason).toContain('MUI');
  });

  it('MuiSwitch-root → ToggleSwitch', () => {
    const ev = getEvidence('MuiSwitch-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('ToggleSwitch');
    expect(ev[0].confidence).toBe(0.85);
  });

  it('MuiRadio-root → RadioButton', () => {
    const ev = getEvidence('MuiRadio-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('RadioButton');
  });

  it('MuiSelect-select → CustomDropdown (from Select component)', () => {
    const ev = getEvidence('MuiSelect-select');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('CustomDropdown');
  });

  it('MuiAutocomplete-root → Autocomplete', () => {
    const ev = getEvidence('MuiAutocomplete-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Autocomplete');
  });

  it('MuiPickersDay-root → DatePicker (0.9)', () => {
    const ev = getEvidence('MuiPickersDay-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('DatePicker');
    expect(ev[0].confidence).toBe(0.9);
  });

  it('MuiCalendarPicker-root → DatePicker', () => {
    const ev = getEvidence('MuiCalendarPicker-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('DatePicker');
  });

  it('MuiTab-root → Tab', () => {
    const ev = getEvidence('MuiTab-root Mui-selected');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Tab');
  });

  it('MuiButton-root → Click', () => {
    const ev = getEvidence('MuiButton-root MuiButton-containedPrimary');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
  });

  it('MuiTextField-root + MuiInputBase → TextEntry (deduped to 1)', () => {
    // Both MuiTextField-root and MuiInputBase-root map to TextEntry
    // but dedup should collapse them into one evidence
    const ev = getEvidence('MuiTextField-root MuiInputBase-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('TextEntry');
  });

  it('MuiButtonBase-root → Click (lower confidence)', () => {
    const ev = getEvidence('MuiButtonBase-root');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
    expect(ev[0].confidence).toBe(0.7);
  });
});

describe('CssClassnameProvider — AntD Detection', () => {
  beforeEach(() => resetEventCounter());

  it('ant-checkbox → Checkbox', () => {
    const ev = getEvidence('ant-checkbox ant-checkbox-checked');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Checkbox');
    expect(ev[0].reason).toContain('AntD');
  });

  it('ant-switch → ToggleSwitch', () => {
    const ev = getEvidence('ant-switch ant-switch-checked');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('ToggleSwitch');
  });

  it('ant-radio → RadioButton', () => {
    const ev = getEvidence('ant-radio ant-radio-checked');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('RadioButton');
  });

  it('ant-select-selector → CustomDropdown', () => {
    const ev = getEvidence('ant-select-selector');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('CustomDropdown');
  });

  it('ant-picker → DatePicker', () => {
    const ev = getEvidence('ant-picker ant-picker-focused');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('DatePicker');
  });

  it('ant-picker-cell → DatePicker (0.9)', () => {
    const ev = getEvidence('ant-picker-cell ant-picker-cell-selected');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('DatePicker');
    expect(ev[0].confidence).toBe(0.9);
  });

  it('ant-tabs-tab → Tab', () => {
    const ev = getEvidence('ant-tabs-tab ant-tabs-tab-active');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Tab');
  });

  it('ant-btn → Click', () => {
    const ev = getEvidence('ant-btn ant-btn-primary');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
  });

  it('ant-input → TextEntry', () => {
    const ev = getEvidence('ant-input');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('TextEntry');
  });

  it('ant-slider → Slider', () => {
    const ev = getEvidence('ant-slider-handle');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Slider');
  });
});

describe('CssClassnameProvider — Bootstrap Detection', () => {
  beforeEach(() => resetEventCounter());

  it('btn-primary → Click', () => {
    const ev = getEvidence('btn btn-primary');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
    expect(ev[0].reason).toContain('Bootstrap');
  });

  it('btn-outline-success → Click', () => {
    const ev = getEvidence('btn-outline-success');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
  });

  it('form-check-input → Checkbox', () => {
    const ev = getEvidence('form-check-input');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Checkbox');
  });

  it('form-select → NativeDropdown', () => {
    const ev = getEvidence('form-select');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('NativeDropdown');
  });

  it('dropdown-item → CustomDropdown', () => {
    const ev = getEvidence('dropdown-item');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('CustomDropdown');
  });

  it('nav-link → Link', () => {
    const ev = getEvidence('nav-link');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Link');
  });

  it('nav-tab → Tab', () => {
    const ev = getEvidence('nav-tab');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Tab');
  });
});

describe('CssClassnameProvider — No False Positives', () => {
  beforeEach(() => resetEventCounter());

  it('unknown class produces no evidence', () => {
    const ev = getEvidence('some-random-class');
    expect(ev).toHaveLength(0);
  });

  it('empty class produces no evidence', () => {
    const ev = getEvidence('');
    expect(ev).toHaveLength(0);
  });

  it('null class produces no evidence', () => {
    const p = provider();
    const event = clickEvent({ className: null as any });
    const result = p.onEvent(event, emptyBuffer);
    expect(result).toHaveLength(0);
  });

  it('generic CSS classes (no framework prefix) produce no evidence', () => {
    const ev = getEvidence('container row col-md-6 text-center');
    expect(ev).toHaveLength(0);
  });

  it('navigation event produces no evidence', () => {
    const p = provider();
    const event = {
      eventId: 'evt-0001',
      eventType: 'navigation',
      timestamp: new Date().toISOString(),
      url: 'https://example.com',
      title: 'Test',
      transitionType: 'link',
    };
    const result = p.onEvent(event as any, emptyBuffer);
    expect(result).toHaveLength(0);
  });
});

describe('CssClassnameProvider — Click-Type Gating', () => {
  beforeEach(() => resetEventCounter());

  it('MuiButton-root on mouseenter → no evidence (Hover should win)', () => {
    const ev = getEvidence('MuiButton-root', 'mouseenter');
    expect(ev).toHaveLength(0);
  });

  it('ant-btn on mouseenter → no evidence', () => {
    const ev = getEvidence('ant-btn', 'mouseenter');
    expect(ev).toHaveLength(0);
  });

  it('nav-link on mouseenter → no evidence', () => {
    const ev = getEvidence('nav-link', 'mouseenter');
    expect(ev).toHaveLength(0);
  });

  it('MuiTab-root on mouseenter → no evidence (Tab is click-type)', () => {
    const ev = getEvidence('MuiTab-root', 'mouseenter');
    expect(ev).toHaveLength(0);
  });

  it('MuiCheckbox-root on mouseenter → still emits (Checkbox is not click-gated)', () => {
    const ev = getEvidence('MuiCheckbox-root', 'mouseenter');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Checkbox');
  });

  it('MuiTextField-root on focus → still emits (TextEntry is not click-gated)', () => {
    const ev = getEvidence('MuiTextField-root', 'focus');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('TextEntry');
  });
});

describe('CssClassnameProvider — Multi-Class Dedup', () => {
  beforeEach(() => resetEventCounter());

  it('multiple classes mapping to same type emit one evidence', () => {
    const ev = getEvidence('MuiButton-root MuiButtonBase-root MuiButton-containedPrimary');
    expect(ev).toHaveLength(1);
    expect(ev[0].suggestedType).toBe('Click');
  });

  it('multiple classes mapping to different types emit multiple evidence', () => {
    // MuiSelect-select → CustomDropdown, MuiInputBase-root → TextEntry
    const ev = getEvidence('MuiSelect-select MuiInputBase-root');
    expect(ev).toHaveLength(2);
    const types = ev.map(e => e.suggestedType).sort();
    expect(types).toEqual(['CustomDropdown', 'TextEntry']);
  });
});

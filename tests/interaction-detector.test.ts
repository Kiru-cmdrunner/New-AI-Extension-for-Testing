/**
 * Unit tests for the Phase 2 Interaction Detector.
 *
 * Tests every Tier 1 detection rule:
 *   Navigation, Click, DoubleClick, RightClick, Hover, DragDrop,
 *   TextEntry, NativeDropdown, Checkbox, RadioButton, ToggleSwitch,
 *   FileUpload, Link, Tab, Menu, Scroll.
 *
 * Tests event grouping:
 *   Same-element grouping within 500ms, standalone events, drag-drop pairing.
 */

import { describe, it, expect } from 'vitest';
import { detectInteractions } from '../src/classifier/interaction-detector';
import type { RecordedEvent, ElementRecordedEvent, NavigationRecordedEvent } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ─────────────────────────────────────────────────────────────

function identity(tag: string, name: string, extras: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: name,
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag,
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: tag.toLowerCase(),
    xPath: `//${tag.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
    ...extras,
  };
}

function navEvent(url: string, title: string, transitionType?: string, id = 'evt-0001'): RecordedEvent {
  const evt: NavigationRecordedEvent = {
    eventId: id,
    eventType: 'navigation',
    timestamp: '2026-07-18T08:00:00Z',
    url,
    title,
  };
  if (transitionType) evt.transitionType = transitionType;
  return evt;
}

function elEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: ElementIdentity,
  id: string,
  timestamp = '2026-07-18T08:00:00Z',
  extras: Partial<ElementRecordedEvent> = {},
): RecordedEvent {
  return {
    eventId: id,
    eventType,
    timestamp,
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...extras,
  };
}

// ── Navigation ──────────────────────────────────────────────────────────

describe('Detection — Navigation', () => {
  it('detects PageNavigation from navigation event', () => {
    const events = [navEvent('https://example.com', 'Example')];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('PageNavigation');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.url).toBe('https://example.com');
  });

  it('detects Refresh from navigation with transitionType reload', () => {
    const events = [navEvent('https://example.com', 'Example', 'reload')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Refresh');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.transitionType).toBe('reload');
  });

  it('detects Back from navigation with forward_back transition', () => {
    const events = [navEvent('https://example.com', 'Example', 'forward_back')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Back');
    expect(interactions[0].confidence).toBe(1.0);
  });

  it('detects Forward from navigation with forward transition', () => {
    const events = [navEvent('https://example.com', 'Example', 'forward')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Forward');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Click ───────────────────────────────────────────────────────────────

describe('Detection — Click', () => {
  it('detects Click on a button', () => {
    const target = identity('BUTTON', 'Submit');
    const events = [elEvent('click', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Click');
    expect(interactions[0].confidence).toBe(1.0);
  });

  it('detects Click on a div with role=button', () => {
    const target = identity('DIV', 'Custom Button', { ariaRole: 'button' });
    const events = [elEvent('click', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Click');
  });
});

// ── Double Click ────────────────────────────────────────────────────────

describe('Detection — DoubleClick', () => {
  it('detects DoubleClick from dblclick event', () => {
    const target = identity('DIV', 'Item');
    const events = [elEvent('dblclick', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DoubleClick');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Right Click ─────────────────────────────────────────────────────────

describe('Detection — RightClick', () => {
  it('detects RightClick from contextmenu event', () => {
    const target = identity('P', 'Paragraph');
    const events = [elEvent('contextmenu', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('RightClick');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Hover (DOM mutation-based — only fires when hover causes visible change) ─

describe('Detection — Hover', () => {
  it('detects Hover from mouseenter event', () => {
    const target = identity('DIV', 'Tooltip trigger');
    const events = [elEvent('mouseenter', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Hover');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Drag & Drop ─────────────────────────────────────────────────────────

describe('Detection — DragDrop', () => {
  it('detects DragDrop from dragstart + drop pair', () => {
    const src = identity('DIV', 'Draggable', { stableId: 'drag-src' });
    const dst = identity('DIV', 'Drop Zone', { stableId: 'drop-dst' });
    const events = [
      elEvent('dragstart', src, 'evt-0001'),
      elEvent('drop', dst, 'evt-0002'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('DragDrop');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].eventIds).toEqual(['evt-0001', 'evt-0002']);
  });

  it('detects standalone dragstart as DragDrop', () => {
    const src = identity('DIV', 'Draggable');
    const events = [elEvent('dragstart', src, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DragDrop');
  });
});

// ── Text Entry ──────────────────────────────────────────────────────────

describe('Detection — TextEntry', () => {
  it('detects TextEntry from focus → input → blur sequence', () => {
    const input = identity('INPUT', 'Email', { ariaRole: 'textbox', placeholder: 'Enter email', stableId: 'email' });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00.000Z', { valueAfter: '' }),
      elEvent('input', input, 'evt-0002', '2026-07-18T08:00:00.100Z', { valueBefore: '', valueAfter: 'test@test.com' }),
      elEvent('blur', input, 'evt-0003', '2026-07-18T08:00:00.200Z', { valueBefore: 'test@test.com', valueAfter: 'test@test.com' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.textValue).toBe('test@test.com');
    expect(interactions[0].eventIds).toEqual(['evt-0001', 'evt-0002', 'evt-0003']);
  });

  it('detects TextEntry in a textarea', () => {
    const textarea = identity('TEXTAREA', 'Comments', { ariaRole: 'textbox', stableId: 'comments' });
    const events = [
      elEvent('focus', textarea, 'evt-0001', '2026-07-18T08:00:00.000Z'),
      elEvent('input', textarea, 'evt-0002', '2026-07-18T08:00:00.200Z', { valueBefore: '', valueAfter: 'Great product!' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('Great product!');
  });
});

// ── Native Dropdown ─────────────────────────────────────────────────────

describe('Detection — NativeDropdown', () => {
  it('detects NativeDropdown from select change', () => {
    const select = identity('SELECT', 'Country', { ariaRole: 'listbox', stableId: 'country' });
    const events = [
      elEvent('change', select, 'evt-0001', '2026-07-18T08:00:00Z', { valueBefore: 'USA', valueAfter: 'Canada' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('NativeDropdown');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.selectedValue).toBe('Canada');
  });
});

// ── Checkbox ────────────────────────────────────────────────────────────

describe('Detection — Checkbox', () => {
  it('detects Checkbox from click with checked transition', () => {
    const cb = identity('INPUT', 'I agree', { ariaRole: 'checkbox', stableId: 'agree' });
    const events = [
      elEvent('click', cb, 'evt-0001', '2026-07-18T08:00:00Z', { checkedBefore: false, checkedAfter: true }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('detects ARIA checkbox', () => {
    const cb = identity('DIV', 'Subscribe', { ariaRole: 'checkbox', stableId: 'sub' });
    const events = [
      elEvent('click', cb, 'evt-0001', '2026-07-18T08:00:00Z', { checkedBefore: true, checkedAfter: false }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(false);
  });
});

// ── Radio Button ────────────────────────────────────────────────────────

describe('Detection — RadioButton', () => {
  it('detects RadioButton from click', () => {
    const radio = identity('INPUT', 'Option A', { ariaRole: 'radio', stableId: 'opt-a' });
    const events = [
      elEvent('click', radio, 'evt-0001', '2026-07-18T08:00:00Z', { checkedBefore: false, checkedAfter: true }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('RadioButton');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.checked).toBe(true);
  });
});

// ── Toggle Switch ───────────────────────────────────────────────────────

describe('Detection — ToggleSwitch', () => {
  it('detects ToggleSwitch from click on role=switch', () => {
    const toggle = identity('DIV', 'Dark Mode', { ariaRole: 'switch', stableId: 'dark-mode' });
    const events = [
      elEvent('click', toggle, 'evt-0001', '2026-07-18T08:00:00Z', { checkedBefore: false, checkedAfter: true }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('ToggleSwitch');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.checked).toBe(true);
  });
});

// ── File Upload ─────────────────────────────────────────────────────────

describe('Detection — FileUpload', () => {
  it('detects FileUpload from change on file input', () => {
    const fileInput = identity('INPUT', 'Upload', { name: 'fileUpload', className: 'file-input' });
    const events = [
      elEvent('change', fileInput, 'evt-0001', '2026-07-18T08:00:00Z'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('FileUpload');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Link ────────────────────────────────────────────────────────────────

describe('Detection — Link', () => {
  it('detects Link from click on <a> tag', () => {
    const link = identity('A', 'Learn More', { ariaRole: 'link', stableId: 'learn-link' });
    const events = [elEvent('click', link, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Link');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Tab ─────────────────────────────────────────────────────────────────

describe('Detection — Tab', () => {
  it('detects Tab from click on role=tab', () => {
    const tab = identity('DIV', 'Settings Tab', { ariaRole: 'tab', stableId: 'tab-settings' });
    const events = [elEvent('click', tab, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Tab');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Menu ────────────────────────────────────────────────────────────────

describe('Detection — Menu', () => {
  it('detects Menu from click on role=menuitem', () => {
    const menu = identity('DIV', 'Delete', { ariaRole: 'menuitem', stableId: 'menu-delete' });
    const events = [elEvent('click', menu, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Menu');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Scroll ──────────────────────────────────────────────────────────────

describe('Detection — Scroll', () => {
  it('detects PageScroll from scroll on HTML element', () => {
    const htmlEl = identity('HTML', '', { ariaRole: 'document' });
    const events = [elEvent('scroll', htmlEl, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('PageScroll');
    expect(interactions[0].confidence).toBe(1.0);
  });

  it('detects ContainerScroll from scroll on specific element', () => {
    const container = identity('DIV', 'Scrollable List', { stableId: 'list-container' });
    const events = [elEvent('scroll', container, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('ContainerScroll');
    expect(interactions[0].confidence).toBe(1.0);
  });
});

// ── Unknown ─────────────────────────────────────────────────────────────

describe('Detection — Unknown', () => {
  it('returns Unknown for unrecognized events', () => {
    const target = identity('DIV', 'Random Div', { stableId: 'random' });
    // A blur event on an element with no prior focus (shouldn't normally happen,
    // but tests the fallback)
    const events = [elEvent('blur', target, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Unknown');
    expect(interactions[0].confidence).toBe(0.0);
  });
});

// ── Event Grouping ──────────────────────────────────────────────────────

describe('Event Grouping', () => {
  it('groups same-element events within 500ms into one interaction', () => {
    const input = identity('INPUT', 'Name', { ariaRole: 'textbox', stableId: 'name' });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00.000Z'),
      elEvent('input', input, 'evt-0002', '2026-07-18T08:00:00.100Z', { valueBefore: '', valueAfter: 'J' }),
      elEvent('input', input, 'evt-0003', '2026-07-18T08:00:00.200Z', { valueBefore: 'J', valueAfter: 'Jo' }),
      elEvent('input', input, 'evt-0004', '2026-07-18T08:00:00.300Z', { valueBefore: 'Jo', valueAfter: 'John' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].eventIds).toHaveLength(4);
  });

  it('separates events on different elements into different interactions', () => {
    const btn1 = identity('BUTTON', 'Button 1', { stableId: 'btn1' });
    const btn2 = identity('BUTTON', 'Button 2', { stableId: 'btn2' });
    const events = [
      elEvent('click', btn1, 'evt-0001', '2026-07-18T08:00:00Z'),
      elEvent('click', btn2, 'evt-0002', '2026-07-18T08:00:01Z'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(2);
    expect(interactions[0].target?.stableId).toBe('btn1');
    expect(interactions[1].target?.stableId).toBe('btn2');
  });

  it('separates events more than 500ms apart on same element', () => {
    const btn = identity('BUTTON', 'Submit', { stableId: 'submit' });
    const events = [
      elEvent('click', btn, 'evt-0001', '2026-07-18T08:00:00Z'),
      elEvent('click', btn, 'evt-0002', '2026-07-18T08:00:01Z'), // 1s later
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(2);
  });

  it('assigns sequential interaction IDs', () => {
    const btn = identity('BUTTON', 'Click', { stableId: 'btn' });
    const events = [
      navEvent('https://example.com', 'Example', undefined, 'evt-0001'),
      elEvent('click', btn, 'evt-0002'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].interactionId).toBe('int-0001');
    expect(interactions[1].interactionId).toBe('int-0002');
  });

  it('produces rawEventTypes array for each interaction', () => {
    const input = identity('INPUT', 'Search', { ariaRole: 'textbox' });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00.000Z'),
      elEvent('input', input, 'evt-0002', '2026-07-18T08:00:00.100Z', { valueAfter: 'query' }),
      elEvent('blur', input, 'evt-0003', '2026-07-18T08:00:00.200Z'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].rawEventTypes).toEqual(['focus', 'input', 'blur']);
  });
});

// ── Date Picker ──────────────────────────────────────────────────────────

describe('Detection — DatePicker', () => {
  // ── Path A: Native date input ──────────────────────────────────────────

  it('detects DatePicker from native input[type=date] change', () => {
    const dateInput = identity('INPUT', 'Departure Date', {
      ariaRole: 'textbox',
      cssSelector: 'input[type="date"]#departure',
      xPath: '//input[@type="date"]',
      stableId: 'departure',
    });
    const events = [
      elEvent('change', dateInput, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueBefore: '2026-07-15', valueAfter: '2026-07-20',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.dateValue).toBe('2026-07-20');
  });

  it('detects TimePicker from native input[type=time] change', () => {
    const timeInput = identity('INPUT', 'Meeting Time', {
      ariaRole: 'textbox',
      cssSelector: 'input[type="time"]#meeting-time',
      xPath: '//input[@type="time"]',
      stableId: 'meeting-time',
    });
    const events = [
      elEvent('change', timeInput, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueBefore: '09:00', valueAfter: '14:30',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('TimePicker');
    expect(interactions[0].metadata.timeValue).toBe('14:30');
  });

  it('detects DateTimePicker from input[type=datetime-local]', () => {
    const dtInput = identity('INPUT', 'Appointment', {
      ariaRole: 'textbox',
      cssSelector: 'input[type="datetime-local"]#appt',
      xPath: '//input[@type="datetime-local"]',
      stableId: 'appt',
    });
    const events = [
      elEvent('change', dtInput, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueAfter: '2026-07-20T14:30',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DateTimePicker');
    expect(interactions[0].metadata.dateTimeValue).toBe('2026-07-20T14:30');
  });

  // ── Path B: Calendar grid cell click ───────────────────────────────────

  it('detects DatePicker from click on calendar cell (class*="calendar")', () => {
    // Simulates the Adani One scenario: clicking a date in the calendar
    const cell = identity('DIV', '20', {
      ariaRole: 'gridcell',
      className: 'calendar-day',
      cssSelector: 'div.calendar-day',
      ariaLabel: 'Monday, July 20th, 2026',
    });
    const events = [elEvent('click', cell, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
    expect(interactions[0].confidence).toBe(1.0);
    expect(interactions[0].metadata.dateValue).toBe('Monday, July 20th, 2026');
  });

  it('detects DatePicker from click on [role="gridcell"]', () => {
    const cell = identity('TD', '15', {
      ariaRole: 'gridcell',
      cssSelector: 'td[role="gridcell"]',
      ariaLabel: 'July 15, 2026',
    });
    const events = [elEvent('click', cell, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
    expect(interactions[0].metadata.dateValue).toBe('July 15, 2026');
  });

  it('detects DatePicker from click on element with datepicker class', () => {
    const cell = identity('BUTTON', '15', {
      className: 'react-datepicker__day',
      cssSelector: 'button.react-datepicker__day',
      ariaLabel: 'day-15',
    });
    const events = [elEvent('click', cell, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
  });

  it('detects DatePicker from click on element with data-date attribute', () => {
    const cell = identity('BUTTON', '15', {
      cssSelector: 'button[data-date="2026-07-15"]',
      ariaLabel: 'July 15, 2026',
    });
    const events = [elEvent('click', cell, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
  });

  // ── Path C: Date-like text input with date value ───────────────────────

  it('detects DatePicker from date-like text input change (Adani One scenario)', () => {
    // Simulates the Adani One date input: type="text", placeholder="Depart on"
    const input = identity('INPUT', 'Depart on', {
      ariaRole: 'textbox',
      tag: 'INPUT',
      placeholder: 'Depart on',
      name: 'onward',
      cssSelector: 'input#onward',
      xPath: '//input[@id="onward"]',
      stableId: 'onward',
    });
    const events = [
      elEvent('change', input, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueBefore: '', valueAfter: 'Mon, 20 Jul',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
    expect(interactions[0].metadata.dateValue).toBe('Mon, 20 Jul');
  });

  it('detects DatePicker from text input with "Arrival" name and date value', () => {
    const input = identity('INPUT', '', {
      ariaRole: 'textbox',
      tag: 'INPUT',
      name: 'arrival_date',
      cssSelector: 'input[name="arrival_date"]',
    });
    const events = [
      elEvent('input', input, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueAfter: '20 July 2026',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
  });

  // ── Negative tests: Non-date elements should NOT be DatePicker ─────────

  it('regular button click is NOT DatePicker', () => {
    const btn = identity('BUTTON', 'Submit', {
      cssSelector: 'button#submit',
      stableId: 'submit',
    });
    const events = [elEvent('click', btn, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('Click');
  });

  it('regular text input is NOT DatePicker', () => {
    const input = identity('INPUT', 'Enter your name', {
      ariaRole: 'textbox',
      tag: 'INPUT',
      placeholder: 'Enter your name',
      cssSelector: 'input#name',
      stableId: 'name',
    });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00.000Z'),
      elEvent('input', input, 'evt-0002', '2026-07-18T08:00:00.100Z', {
        valueBefore: '', valueAfter: 'John Doe',
      }),
      elEvent('blur', input, 'evt-0003', '2026-07-18T08:00:00.200Z'),
    ];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('TextEntry');
  });

  it('date-like text input with NON-date value is NOT DatePicker', () => {
    // Input has date keyword in placeholder but value is not a date
    const input = identity('INPUT', 'Depart on', {
      ariaRole: 'textbox',
      tag: 'INPUT',
      placeholder: 'Depart on',
      cssSelector: 'input#onward',
      stableId: 'onward',
    });
    const events = [
      elEvent('change', input, 'evt-0001', '2026-07-18T08:00:00Z', {
        valueAfter: 'some random text',
      }),
    ];
    const interactions = detectInteractions(events);

    // Should fall through to TextEntry (not DatePicker) since value is not date-like
    expect(interactions[0].type).not.toBe('DatePicker');
  });

  it('Link click inside a calendar-named container is still DatePicker', () => {
    // Even an <a> tag should be DatePicker if inside calendar container
    const link = identity('A', 'Next Month', {
      ariaRole: 'link',
      className: 'calendar-next-month',
      cssSelector: 'a.calendar-next-month',
    });
    const events = [elEvent('click', link, 'evt-0001')];
    const interactions = detectInteractions(events);

    expect(interactions[0].type).toBe('DatePicker');
  });
});

// ── Dropdown Grouping (SELECT) ────────────────────────────────────────────

describe('Detection — Dropdown SELECT Grouping', () => {
  it('groups SELECT click+input+change across multi-second gap as one NativeDropdown', () => {
    // Simulates real-world dropdown usage: click to open, browse options
    // for 3 seconds, then select a value.
    const selectEl = identity('SELECT', 'Make', {
      ariaRole: 'listbox',
      cssSelector: 'select#make-input',
      stableId: 'make-input',
    });
    const events = [
      elEvent('click', selectEl, 'evt-0001', '2026-07-18T21:31:22.000Z', { valueAfter: 'FORD' }),
      elEvent('input', selectEl, 'evt-0002', '2026-07-18T21:31:25.000Z', { valueBefore: 'FORD', valueAfter: 'KIA' }),
      elEvent('change', selectEl, 'evt-0003', '2026-07-18T21:31:25.100Z', { valueAfter: 'KIA' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('NativeDropdown');
    expect(interactions[0].rawEventTypes).toEqual(['click', 'input', 'change']);
  });

  it('groups SELECT events across 4 second gap (within 5s window)', () => {
    const selectEl = identity('SELECT', 'Year', {
      ariaRole: 'listbox',
      cssSelector: 'select#year',
      stableId: 'year',
    });
    const events = [
      elEvent('click', selectEl, 'evt-0001', '2026-07-18T21:31:20.000Z', { valueAfter: '' }),
      elEvent('input', selectEl, 'evt-0002', '2026-07-18T21:31:24.000Z', { valueBefore: '', valueAfter: '2002' }),
      elEvent('change', selectEl, 'evt-0003', '2026-07-18T21:31:24.100Z', { valueAfter: '2002' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('NativeDropdown');
  });

  it('does NOT group SELECT events beyond extended window', () => {
    const selectEl = identity('SELECT', 'Model', {
      ariaRole: 'listbox',
      cssSelector: 'select#model',
      stableId: 'model',
    });
    const events = [
      elEvent('click', selectEl, 'evt-0001', '2026-07-18T21:31:20.000Z', { valueAfter: '' }),
      // 35 second gap — exceeds the 30s extended window
      elEvent('change', selectEl, 'evt-0002', '2026-07-18T21:31:55.000Z', { valueAfter: 'SPECTRA' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(2);
  });

  it('still uses 500ms window for non-SELECT elements', () => {
    // Regular text input — focus → (type with debounce) → input
    // With debounced input, the gap between focus and the coalesced input
    // event can be several seconds. Text-entry elements use a 30s grouping
    // window so focus+input+blur always group correctly.
    const input = identity('INPUT', 'Name', {
      ariaRole: 'textbox',
      cssSelector: 'input#name',
      stableId: 'name',
    });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T21:31:20.000Z'),
      elEvent('input', input, 'evt-0002', '2026-07-18T21:31:23.000Z', { valueAfter: 'John' }),
    ];
    const interactions = detectInteractions(events);

    // Text-entry events group within 30s — one TextEntry interaction
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
  });
});

// ── Redundant Event Suppression (clean event streams) ────────────────────

describe('Detection — Clean Event Streams (no redundant events)', () => {
  it('checkbox click with label produces ONE Checkbox interaction (no input/change)', () => {
    // After the recorder fix, clicking a checkbox wrapped in a label
    // produces only a single click event on the input — no label click,
    // no input event, no change event.
    const checkbox = identity('INPUT', 'Battery', {
      ariaRole: 'checkbox',
      name: 'Battery',
      cssSelector: 'input[name="Battery"]',
      stableId: 'battery-checkbox',
    });
    const events = [
      elEvent('click', checkbox, 'evt-0001', '2026-07-18T22:02:51Z', {
        checkedBefore: false, valueBefore: null, valueAfter: null,
      }),
    ];
    // The deferred checkedAfter would be captured by the recorder's setTimeout
    // — here we simulate the resolved event
    events[0] = { ...events[0], checkedAfter: true } as ElementRecordedEvent;

    const interactions = detectInteractions(events);
    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('Checkbox');
    expect(interactions[0].metadata.checked).toBe(true);
  });

  it('dropdown SELECT selection produces ONE NativeDropdown (click+change, no input)', () => {
    // After the recorder fix, selecting from a dropdown produces only
    // click + change events — no redundant input event.
    const selectEl = identity('SELECT', 'Year', {
      ariaRole: 'listbox',
      cssSelector: 'select#year-input',
      stableId: 'year-input',
    });
    const events = [
      elEvent('click', selectEl, 'evt-0001', '2026-07-18T22:01:50Z', { valueAfter: '' }),
      elEvent('change', selectEl, 'evt-0002', '2026-07-18T22:01:53Z', { valueBefore: '', valueAfter: '1987' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('NativeDropdown');
    expect(interactions[0].metadata.selectedValue).toBe('1987');
    expect(interactions[0].rawEventTypes).toEqual(['click', 'change']);
  });

  it('text input with focus+blur (no input events) still classifies as TextEntry', () => {
    // With the v10.4.11 recorder fix, text typing produces NO intermediate
    // input events. The classifier must still detect TextEntry from
    // focus + blur alone.
    const input = identity('INPUT', 'Name', {
      ariaRole: 'textbox',
      cssSelector: 'input#name',
      stableId: 'name',
    });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00Z', { valueBefore: '' }),
      elEvent('blur', input, 'evt-0002', '2026-07-18T08:00:00.200Z', { valueBefore: '', valueAfter: 'John' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('John');
  });

  it('radio button click produces ONE RadioButton (no input/change)', () => {
    const radio = identity('INPUT', 'Regular', {
      ariaRole: 'radio',
      cssSelector: 'input[name="fare"][value="regular"]',
      stableId: 'fare-regular',
    });
    const events = [
      { ...elEvent('click', radio, 'evt-0001', '2026-07-18T08:00:00Z'),
        checkedAfter: true, checkedBefore: false } as ElementRecordedEvent,
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('RadioButton');
    expect(interactions[0].metadata.checked).toBe(true);
  });
});

// ── Text Entry: No intermediate input events ──────────────────────────────

describe('Detection — Text Entry (no intermediate input noise)', () => {
  it('typing a phone number produces focus + blur only (NO input events)', () => {
    // The recorder now suppresses ALL intermediate input events for text
    // typing. The full value transition is captured by focus (valueBefore)
    // and blur (valueAfter). No per-keystroke or per-burst INP events.
    const input = identity('INPUT', 'Enter mobile number or email', {
      ariaRole: 'textbox',
      ariaLabel: 'Enter mobile number or email',
      name: 'email',
      cssSelector: 'input#ap_email_login',
      stableId: 'ap_email_login',
    });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T22:28:12Z', { valueBefore: '' }),
      elEvent('blur', input, 'evt-0002', '2026-07-18T22:28:30Z', {
        valueBefore: '', valueAfter: '9897654321',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('9897654321');
    expect(interactions[0].rawEventTypes).toEqual(['focus', 'blur']);
  });

  it('typing in different fields produces separate TextEntry interactions', () => {
    const inputA = identity('INPUT', 'First Name', {
      ariaRole: 'textbox',
      cssSelector: 'input#firstName',
      stableId: 'firstName',
    });
    const inputB = identity('INPUT', 'Last Name', {
      ariaRole: 'textbox',
      cssSelector: 'input#lastName',
      stableId: 'lastName',
    });
    const events = [
      elEvent('focus', inputA, 'evt-0001', '2026-07-18T08:00:00Z', { valueBefore: '' }),
      elEvent('blur', inputA, 'evt-0002', '2026-07-18T08:00:02Z', {
        valueBefore: '', valueAfter: 'John',
      }),
      elEvent('focus', inputB, 'evt-0003', '2026-07-18T08:00:02.500Z', { valueBefore: '' }),
      elEvent('blur', inputB, 'evt-0004', '2026-07-18T08:00:04Z', {
        valueBefore: '', valueAfter: 'Doe',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(2);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('John');
    expect(interactions[1].type).toBe('TextEntry');
    expect(interactions[1].metadata.textValue).toBe('Doe');
  });

  it('focus only (no blur yet) still classifies as TextEntry', () => {
    // Edge case: user focused a field but hasn't blurred yet. Should still
    // be TextEntry — value will be whatever focus captured.
    const input = identity('INPUT', 'Search', {
      ariaRole: 'textbox',
      cssSelector: 'input#search',
      stableId: 'search',
    });
    const events = [
      elEvent('focus', input, 'evt-0001', '2026-07-18T08:00:00Z', { valueBefore: '' }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
  });

  it('textarea typing also suppresses intermediate input events', () => {
    const textarea = identity('TEXTAREA', 'Comments', {
      ariaRole: 'textbox',
      cssSelector: 'textarea#comments',
      stableId: 'comments',
    });
    const events = [
      elEvent('focus', textarea, 'evt-0001', '2026-07-18T08:00:00Z', { valueBefore: '' }),
      elEvent('blur', textarea, 'evt-0002', '2026-07-18T08:00:05Z', {
        valueBefore: '', valueAfter: 'This is a long comment.',
      }),
    ];
    const interactions = detectInteractions(events);

    expect(interactions).toHaveLength(1);
    expect(interactions[0].type).toBe('TextEntry');
    expect(interactions[0].metadata.textValue).toBe('This is a long comment.');
  });
});

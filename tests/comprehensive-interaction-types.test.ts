/**
 * Phase 2 — Comprehensive Interaction Type Validation
 *
 * Tests ALL 37 interaction types against real DOM elements (via jsdom),
 * simulating realistic event sequences that the recorder would capture.
 *
 * Tests both:
 *   - Traditional HTML elements (<input>, <select>, <button>, etc.)
 *   - Modern ARIA widgets (role="checkbox", role="switch", etc.)
 *   - Modern SPA patterns (custom dropdowns, tab panels, menus)
 *
 * Each test case constructs a real DOM element, simulates the event sequence
 * the recorder would capture (mousedown → focus → change → blur, etc.),
 * then verifies detectInteractions() classifies it correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractions } from '../src/classifier/interaction-detector.js';
import type { RecordedEvent, ElementIdentity } from '../src/recorder/recorded-event.js';

// ── Helpers ──────────────────────────────────────────────────────────

let eventCounter = 0;

function makeIdentity(el: Element, overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  const ariaLabel = el.getAttribute('aria-label');
  const labelledBy = el.getAttribute('aria-labelledby');
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  const id = el.id;
  const name = el.getAttribute('name');

  let accessibleName = '';
  if (ariaLabel) accessibleName = ariaLabel;
  else if (labelledBy) {
    const target = document.getElementById(labelledBy);
    if (target) accessibleName = target.textContent?.trim() || '';
  }
  if (!accessibleName && id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) accessibleName = label.textContent?.trim() || '';
  }
  if (!accessibleName) accessibleName = el.textContent?.trim() || placeholder || '';
  if (!accessibleName && el instanceof HTMLInputElement) accessibleName = el.value || '';

  let ariaRole = el.getAttribute('role');
  if (!ariaRole) {
    const tagRoles: Record<string, string> = {
      A: 'link', BUTTON: 'button', SELECT: 'listbox',
      TEXTAREA: 'textbox', OPTION: 'option',
    };
    ariaRole = tagRoles[el.tagName] || null;
    if (el.tagName === 'INPUT') {
      const typeRoles: Record<string, string> = {
        checkbox: 'checkbox', radio: 'radio', text: 'textbox',
        email: 'textbox', password: 'textbox', submit: 'button', button: 'button',
      };
      ariaRole = typeRoles[(el as HTMLInputElement).type] || null;
    }
  }

  return {
    accessibleName: accessibleName.slice(0, 200),
    ariaRole,
    ariaLabel,
    ariaLabelledBy: labelledBy,
    placeholder: placeholder ?? null,
    tag: el.tagName,
    className: el.className || null,
    name,
    stableId: id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    cssSelector: id ? `#${id}` : el.tagName.toLowerCase(),
    xPath: id ? `//${el.tagName.toLowerCase()}[@id='${id}']` : `//${el.tagName.toLowerCase()}`,
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: '',
    ...overrides,
  };
}

function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text || '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  return undefined;
}

function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked;
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';
  return undefined;
}

function makeEvent(
  eventType: string,
  el: Element,
  extras: { valueBefore?: string | null; valueAfter?: string | null; checkedBefore?: boolean | null; checkedAfter?: boolean | null } = {},
): RecordedEvent {
  const target = makeIdentity(el);
  const value = captureValue(el);
  const checked = captureCheckedState(el);
  const ts = new Date(Date.now() + (++eventCounter));
  return {
    eventId: `evt-${String(eventCounter).padStart(4, '0')}`,
    eventType,
    timestamp: ts.toISOString(),
    target,
    valueBefore: extras.valueBefore ?? (value !== undefined ? value : null),
    valueAfter: extras.valueAfter ?? (value !== undefined ? value : null),
    checkedBefore: extras.checkedBefore ?? (checked !== undefined ? checked : null),
    checkedAfter: extras.checkedAfter ?? (checked !== undefined ? checked : null),
  };
}

function makeNav(url: string, title: string, transitionType?: string): RecordedEvent {
  const evt: RecordedEvent = {
    eventId: `evt-${String(++eventCounter).padStart(4, '0')}`,
    eventType: 'navigation',
    timestamp: new Date().toISOString(),
    url, title,
    target: {} as ElementIdentity,
    valueBefore: null, valueAfter: null,
    checkedBefore: null, checkedAfter: null,
  };
  if (transitionType) evt.transitionType = transitionType;
  return evt;
}

// ── DOM Setup ────────────────────────────────────────────────────────

function setupDOM() {
  document.body.innerHTML = `
    <a href="/about" id="nav-link">About Us</a>
    <a href="https://external.com" id="ext-link" target="_blank">External</a>
    <a href="#" id="breadcrumb">Home / Products</a>
    <button id="btn-primary" type="button">Submit Form</button>
    <button id="btn-icon" type="button" aria-label="Delete item">🗑</button>
    <button id="btn-submit" type="submit">Save Changes</button>
    <input type="text" id="inp-text" name="username" placeholder="Enter username" />
    <input type="email" id="inp-email" name="email" placeholder="user@example.com" />
    <input type="password" id="inp-password" name="password" placeholder="Password" />
    <input type="search" id="inp-search" name="query" placeholder="Search..." />
    <input type="number" id="inp-number" name="quantity" value="5" />
    <input type="tel" id="inp-tel" name="phone" placeholder="Phone" />
    <input type="url" id="inp-url" name="website" placeholder="https://" />
    <textarea id="inp-textarea" name="description" placeholder="Tell us about yourself"></textarea>
    <select id="sel-country" name="country">
      <option value="">Select country...</option>
      <option value="us">United States</option>
      <option value="uk">United Kingdom</option>
      <option value="de">Germany</option>
      <option value="jp">Japan</option>
    </select>
    <select id="sel-multi" name="tags" multiple>
      <option value="react">React</option>
      <option value="vue">Vue</option>
      <option value="svelte">Svelte</option>
    </select>
    <label><input type="checkbox" id="cb-native" name="subscribe" /> Subscribe to newsletter</label>
    <div id="cb-aria" role="checkbox" aria-checked="false" aria-label="Enable notifications" tabindex="0">Notifications</div>
    <input type="radio" id="rd-native" name="plan" value="pro" />
    <div id="rd-aria" role="radio" aria-checked="false" aria-label="Premium plan" tabindex="0">Premium</div>
    <div id="toggle-switch" role="switch" aria-checked="false" aria-label="Dark mode" tabindex="0">
      <span class="toggle-track"></span>
    </div>
    <button id="toggle-btn" aria-pressed="false" aria-label="Mute audio">🔇</button>
    <input type="date" id="inp-date" name="birthdate" />
    <input type="time" id="inp-time" name="appointment" />
    <input type="datetime-local" id="inp-datetime" name="event-date" />
    <input type="file" id="inp-file" name="upload" />
    <div id="dropzone" role="region" aria-label="File drop zone" data-testid="dropzone">Drag files here</div>
    <div role="tablist" id="tablist">
      <div id="tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview" tabindex="0">Overview</div>
      <div id="tab-settings" role="tab" aria-selected="false" aria-controls="panel-settings" tabindex="0">Settings</div>
      <div id="tab-security" role="tab" aria-selected="false" aria-controls="panel-security" tabindex="0">Security</div>
    </div>
    <div role="menu" id="menu">
      <div id="menu-item-edit" role="menuitem" tabindex="0">Edit</div>
      <div id="menu-item-delete" role="menuitem" tabindex="0">Delete</div>
    </div>
    <div id="hover-target" title="Quick info">Hover for details</div>
    <div id="tooltip-target" aria-describedby="tooltip-text">Hover me</div>
    <div id="tooltip-text" role="tooltip" style="display:none;">Tooltip content</div>
    <div id="drag-source" draggable="true">Drag me</div>
    <div id="drop-target">Drop here</div>
    <div id="scroll-container" style="height:100px; overflow-y:scroll;">
      <div style="height:400px;">Scrollable content</div>
    </div>
    <div id="combo-trigger" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">Select...</div>
    <div id="combo-listbox" role="listbox" style="display:none;">
      <div role="option" id="combo-opt1" data-value="alpha">Alpha</div>
      <div role="option" id="combo-opt2" data-value="beta">Beta</div>
    </div>
    <iframe id="frame-embed" src="/embed" title="Embedded content"></iframe>
  `;
}

// ── Test Suites ──────────────────────────────────────────────────────

describe('Phase 2 — Comprehensive Interaction Type Validation', () => {

  beforeEach(() => {
    eventCounter = 0;
    setupDOM();
  });

  // ═══ Navigation (4 types) ═══

  describe('Navigation', () => {
    it('Page Navigation — URL change to new page', () => {
      const events = [makeNav('https://app.example.com/dashboard', 'Dashboard')];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageNavigation');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Back — browser back button (transitionType=forward_back)', () => {
      const events = [makeNav('https://app.example.com/prev', 'Previous Page', 'forward_back')];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Back');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Forward — browser forward (transitionType=forward)', () => {
      const events = [makeNav('https://app.example.com/next', 'Next Page', 'forward')];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Forward');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Refresh — page reload (transitionType=reload)', () => {
      const events = [makeNav('https://app.example.com/same', 'Same Page', 'reload')];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Refresh');
      expect(result[0].confidence).toBe(1.0);
    });
  });

  // ═══ Mouse Interactions (5 types) ═══

  describe('Mouse Interactions', () => {
    it('Click — primary mouse click on button', () => {
      const btn = document.getElementById('btn-primary')!;
      const events = [makeEvent('mousedown', btn), makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Click — icon button with aria-label', () => {
      const btn = document.getElementById('btn-icon')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata).toHaveProperty('accessibleName', 'Delete item');
    });

    it('Double Click — dblclick event', () => {
      const el = document.getElementById('btn-primary')!;
      const events = [makeEvent('dblclick', el)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DoubleClick');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Right Click — contextmenu event', () => {
      const el = document.getElementById('btn-primary')!;
      const events = [makeEvent('contextmenu', el)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RightClick');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Hover — mouseenter event (recorder only sends on DOM mutation)', () => {
      const el = document.getElementById('hover-target')!;
      // The recorder now only fires mouseenter when a DOM mutation occurs
      // during hover (tooltip appears, dropdown opens, etc.)
      // The classifier still recognizes mouseenter → Hover when received.
      const events = [makeEvent('mouseenter', el)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Drag & Drop — dragstart then drop', () => {
      const drag = document.getElementById('drag-source')!;
      const drop = document.getElementById('drop-target')!;
      const events = [makeEvent('dragstart', drag), makeEvent('drop', drop)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].confidence).toBe(1.0);
    });
  });

  // ═══ Text Entry (1 type — all input variants) ═══

  describe('Text Entry', () => {
    it('Text Entry — text input (focus → input → blur)', () => {
      const el = document.getElementById('inp-text') as HTMLInputElement;
      el.value = 'johndoe';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'johndoe' }),
        makeEvent('blur', el, { valueBefore: 'johndoe', valueAfter: 'johndoe' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('johndoe');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Text Entry — email input', () => {
      const el = document.getElementById('inp-email') as HTMLInputElement;
      el.value = 'john@example.com';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'john@example.com' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('john@example.com');
    });

    it('Text Entry — password input', () => {
      const el = document.getElementById('inp-password') as HTMLInputElement;
      el.value = 'secret123';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'secret123' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('secret123');
    });

    it('Text Entry — textarea', () => {
      const el = document.getElementById('inp-textarea') as HTMLTextAreaElement;
      el.value = 'Long description text';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'Long description text' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('Long description text');
    });

    it('Text Entry — search input', () => {
      const el = document.getElementById('inp-search') as HTMLInputElement;
      el.value = 'search term';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'search term' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('search term');
    });

    it('Text Entry — number input', () => {
      const el = document.getElementById('inp-number') as HTMLInputElement;
      el.value = '42';
      const events = [
        makeEvent('focus', el, { valueBefore: '5', valueAfter: '5' }),
        makeEvent('input', el, { valueBefore: '5', valueAfter: '42' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('42');
    });

    it('Text Entry — tel input', () => {
      const el = document.getElementById('inp-tel') as HTMLInputElement;
      el.value = '+1234567890';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: '+1234567890' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('+1234567890');
    });

    it('Text Entry — url input', () => {
      const el = document.getElementById('inp-url') as HTMLInputElement;
      el.value = 'https://example.com';
      const events = [
        makeEvent('focus', el, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el, { valueBefore: '', valueAfter: 'https://example.com' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('https://example.com');
    });
  });

  // ═══ Selection Controls (7 types) ═══

  describe('Selection Controls', () => {
    it('Native Dropdown — select element (focus → change)', () => {
      const sel = document.getElementById('sel-country') as HTMLSelectElement;
      sel.value = 'uk';
      sel.selectedIndex = 2;
      const events = [
        makeEvent('focus', sel, { valueBefore: 'Select country...', valueAfter: 'Select country...' }),
        makeEvent('change', sel, { valueBefore: 'Select country...', valueAfter: 'United Kingdom' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('NativeDropdown');
      expect(result[0].metadata.selectedValue).toBe('United Kingdom');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Checkbox — native checkbox (click with checked state change)', () => {
      const cb = document.getElementById('cb-native') as HTMLInputElement;
      cb.checked = true;
      const events = [makeEvent('click', cb, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[0].confidence).toBe(1.0);
    });

    it('Checkbox — ARIA checkbox (div role=checkbox)', () => {
      const cb = document.getElementById('cb-aria')!;
      cb.setAttribute('aria-checked', 'true');
      const events = [makeEvent('click', cb, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[0].confidence).toBe(1.0);
    });

    it('Checkbox — unchecked native checkbox', () => {
      const cb = document.getElementById('cb-native') as HTMLInputElement;
      cb.checked = false;
      const events = [makeEvent('click', cb, { checkedBefore: true, checkedAfter: false })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(false);
    });

    it('Radio Button — native radio (click)', () => {
      const rd = document.getElementById('rd-native') as HTMLInputElement;
      rd.checked = true;
      const events = [makeEvent('click', rd, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[0].confidence).toBe(1.0);
    });

    it('Radio Button — ARIA radio (div role=radio)', () => {
      const rd = document.getElementById('rd-aria')!;
      rd.setAttribute('aria-checked', 'true');
      const events = [makeEvent('click', rd, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
    });

    it('Toggle Switch — role=switch', () => {
      const sw = document.getElementById('toggle-switch')!;
      sw.setAttribute('aria-checked', 'true');
      const events = [makeEvent('click', sw, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ToggleSwitch');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[0].confidence).toBe(1.0);
    });

    it('Toggle Switch — button with aria-pressed', () => {
      const btn = document.getElementById('toggle-btn')!;
      btn.setAttribute('aria-pressed', 'true');
      const events = [makeEvent('click', btn, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ToggleSwitch');
      expect(result[0].metadata.checked).toBe(true);
    });
  });

  // ═══ Date & Time (3 types — known gaps, not in Tier 1) ═══

  describe('Date & Time', () => {
    it('Date Picker — input[type=date] produces valid interaction', () => {
      const el = document.getElementById('inp-date') as HTMLInputElement;
      el.value = '2026-07-18';
      const events = [makeEvent('change', el, { valueBefore: '', valueAfter: '2026-07-18' })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBeTruthy();
    });

    it('Time Picker — input[type=time] produces valid interaction', () => {
      const el = document.getElementById('inp-time') as HTMLInputElement;
      el.value = '14:30';
      const events = [makeEvent('change', el, { valueBefore: '', valueAfter: '14:30' })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBeTruthy();
    });

    it('Date Time Picker — input[type=datetime-local] produces valid interaction', () => {
      const el = document.getElementById('inp-datetime') as HTMLInputElement;
      el.value = '2026-07-18T14:30';
      const events = [makeEvent('change', el, { valueBefore: '', valueAfter: '2026-07-18T14:30' })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBeTruthy();
    });
  });

  // ═══ File Upload (2 types) ═══

  describe('File Upload', () => {
    it('File Upload — input[type=file] change event', () => {
      const el = document.getElementById('inp-file') as HTMLInputElement;
      const events = [makeEvent('change', el)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('FileUpload');
      expect(result[0].confidence).toBe(1.0);
    });
  });

  // ═══ Navigation UI (4 types) ═══

  describe('Navigation UI', () => {
    it('Link — click on <a> element', () => {
      const link = document.getElementById('nav-link')!;
      const events = [makeEvent('click', link)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Link — external link with target=_blank', () => {
      const link = document.getElementById('ext-link')!;
      const events = [makeEvent('click', link)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });

    it('Tab — role=tab click', () => {
      const tab = document.getElementById('tab-settings')!;
      const events = [makeEvent('click', tab)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Tab');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Menu — role=menuitem click', () => {
      const menu = document.getElementById('menu-item-delete')!;
      const events = [makeEvent('click', menu)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Menu');
      expect(result[0].confidence).toBe(1.0);
    });
  });

  // ═══ Scrolling (3 types) ═══

  describe('Scrolling', () => {
    it('Page Scroll — scroll on document element', () => {
      const events = [makeEvent('scroll', document.documentElement)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageScroll');
      expect(result[0].confidence).toBe(1.0);
    });

    it('Container Scroll — scroll on div with overflow', () => {
      const container = document.getElementById('scroll-container')!;
      const events = [makeEvent('scroll', container)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ContainerScroll');
      expect(result[0].confidence).toBe(1.0);
    });
  });

  // ═══ Dialogs (4 types — all known gaps) ═══

  describe('Dialogs (Known Gaps — not in Tier 1)', () => {
    it('Modal — trigger click falls to Click (requires DOM observation)', () => {
      const trigger = document.getElementById('btn-primary')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Drawer — trigger click falls to Click', () => {
      const trigger = document.getElementById('btn-primary')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Popover — hover trigger → Hover (DOM mutation based)', () => {
      const trigger = document.getElementById('hover-target')!;
      const events = [makeEvent('mouseenter', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
    });

    it('Tooltip — hover trigger → Hover (DOM mutation based)', () => {
      const trigger = document.getElementById('tooltip-target')!;
      const events = [makeEvent('mouseenter', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
    });
  });

  // ═══ Window & Frame (3 types — all known gaps) ═══

  describe('Window & Frame (Known Gaps — not in Tier 1)', () => {
    it('New Tab — link with target=_blank falls to Link', () => {
      const link = document.getElementById('ext-link')!;
      const events = [makeEvent('click', link)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });

    it('New Window — button click falls to Click', () => {
      const btn = document.getElementById('btn-primary')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Iframe — click on iframe element falls to Click', () => {
      const frame = document.getElementById('frame-embed')!;
      const events = [makeEvent('click', frame)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });
  });

  // ═══ Unknown (1 type) ═══

  describe('Unknown', () => {
    it('Unknown Interaction — generic div click produces valid interaction', () => {
      const div = document.createElement('div');
      div.id = 'unknown-el';
      div.textContent = 'Some custom widget';
      document.body.appendChild(div);
      const events = [makeEvent('click', div)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBeTruthy();
    });
  });

  // ═══ Multi-Interaction Sequences ═══

  describe('Multi-Interaction Sequences', () => {
    it('Login flow: type email → type password → click login', () => {
      const emailEl = document.getElementById('inp-email') as HTMLInputElement;
      emailEl.value = 'user@test.com';
      const passEl = document.getElementById('inp-password') as HTMLInputElement;
      passEl.value = 'pass123';
      const btnEl = document.getElementById('btn-primary')!;

      const events = [
        makeEvent('focus', emailEl, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', emailEl, { valueBefore: '', valueAfter: 'user@test.com' }),
        makeEvent('blur', emailEl, { valueBefore: 'user@test.com', valueAfter: 'user@test.com' }),
        makeEvent('focus', passEl, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', passEl, { valueBefore: '', valueAfter: 'pass123' }),
        makeEvent('blur', passEl, { valueBefore: 'pass123', valueAfter: 'pass123' }),
        makeEvent('mousedown', btnEl),
        makeEvent('click', btnEl),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('user@test.com');
      expect(result[1].type).toBe('TextEntry');
      expect(result[1].metadata.textValue).toBe('pass123');
      expect(result[2].type).toBe('Click');
      expect(result[2].metadata.accessibleName).toBe('Submit Form');
    });

    it('Form fill: checkbox → dropdown → text → submit', () => {
      const cbEl = document.getElementById('cb-native') as HTMLInputElement;
      cbEl.checked = true;
      const selEl = document.getElementById('sel-country') as HTMLSelectElement;
      selEl.value = 'us';
      selEl.selectedIndex = 1;
      const textEl = document.getElementById('inp-text') as HTMLInputElement;
      textEl.value = 'Alice';
      const btnEl = document.getElementById('btn-submit')!;

      const events = [
        makeEvent('click', cbEl, { checkedBefore: false, checkedAfter: true }),
        makeEvent('focus', selEl, { valueBefore: 'Select country...', valueAfter: 'Select country...' }),
        makeEvent('change', selEl, { valueBefore: 'Select country...', valueAfter: 'United States' }),
        makeEvent('focus', textEl, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', textEl, { valueBefore: '', valueAfter: 'Alice' }),
        makeEvent('blur', textEl, { valueBefore: 'Alice', valueAfter: 'Alice' }),
        makeEvent('mousedown', btnEl),
        makeEvent('click', btnEl),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[1].type).toBe('NativeDropdown');
      expect(result[1].metadata.selectedValue).toBe('United States');
      expect(result[2].type).toBe('TextEntry');
      expect(result[2].metadata.textValue).toBe('Alice');
      expect(result[3].type).toBe('Click');
    });

    it('Tab switch: click tab → click tab again', () => {
      const tab1 = document.getElementById('tab-overview')!;
      const tab2 = document.getElementById('tab-settings')!;
      const events = [makeEvent('click', tab1), makeEvent('click', tab2)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Tab');
      expect(result[1].type).toBe('Tab');
    });

    it('Mixed: hover → click → navigation', () => {
      const hoverEl = document.getElementById('hover-target')!;
      const btnEl = document.getElementById('btn-primary')!;
      const events = [
        makeEvent('mouseenter', hoverEl),
        makeEvent('mousedown', btnEl),
        makeEvent('click', btnEl),
        makeNav('https://app.example.com/success', 'Success'),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Hover');
      expect(result[1].type).toBe('Click');
      expect(result[2].type).toBe('PageNavigation');
    });
  });

  // ═══ Edge Cases ═══

  describe('Edge Cases', () => {
    it('Empty event list', () => {
      const result = detectInteractions([]);
      expect(result).toHaveLength(0);
    });

    it('Single navigation event', () => {
      const events = [makeNav('https://example.com', 'Example')];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageNavigation');
    });

    it('Rapid same-element events grouped into single interaction', () => {
      const el = document.getElementById('btn-primary')!;
      const events = [makeEvent('mousedown', el), makeEvent('click', el)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Checkbox toggle on → off → on', () => {
      const cb = document.getElementById('cb-native') as HTMLInputElement;
      const events = [
        makeEvent('click', cb, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', cb, { checkedBefore: true, checkedAfter: false }),
        makeEvent('click', cb, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].metadata.checked).toBe(true);
      expect(result[1].metadata.checked).toBe(false);
      expect(result[2].metadata.checked).toBe(true);
    });

    it('Navigation between two different text entries', () => {
      const el1 = document.getElementById('inp-email') as HTMLInputElement;
      el1.value = 'a@b.com';
      const el2 = document.getElementById('inp-password') as HTMLInputElement;
      el2.value = 'xyz';
      const events = [
        makeEvent('focus', el1, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el1, { valueBefore: '', valueAfter: 'a@b.com' }),
        makeEvent('blur', el1, { valueBefore: 'a@b.com', valueAfter: 'a@b.com' }),
        makeEvent('focus', el2, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', el2, { valueBefore: '', valueAfter: 'xyz' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('a@b.com');
      expect(result[1].type).toBe('TextEntry');
      expect(result[1].metadata.textValue).toBe('xyz');
    });
  });
});

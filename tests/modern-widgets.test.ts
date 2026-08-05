/**
 * Phase 2 — Modern Application Widget Validation
 *
 * Tests interaction detection against real-world modern UI patterns:
 *   - Custom dropdowns (Material UI, Ant Design, Radix, Headless UI styles)
 *   - Down arrow / caret triggers
 *   - Icon-only buttons (various labeling patterns)
 *   - Complex widgets: star rating, segmented control, accordion, stepper,
 *     search autocomplete, chip selector, range slider, toggle button group,
 *     color picker, breadcrumb, carousel
 *
 * These simulate the actual DOM structures that modern component libraries
 * (MUI, AntD, Chakra, Radix, Headless UI) render.
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
        number: 'spinbutton', search: 'searchbox',
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

// ── Modern UI DOM Setup ──────────────────────────────────────────────

function setupModernDOM() {
  document.body.innerHTML = `
    <!-- ═══ Material UI Style Select ═══ -->
    <div class="MuiFormControl-root">
      <label id="mui-label" class="MuiInputLabel-root">Country</label>
      <div class="MuiSelect-root" id="mui-select-trigger" role="combobox" aria-expanded="false"
           aria-haspopup="listbox" aria-labelledby="mui-label" tabindex="0">
        <span data-value="">Select a country</span>
        <svg class="MuiSvgIcon-root" data-testid="ArrowDropDownIcon"><path d="M7 10l5 5 5-5z"/></svg>
      </div>
    </div>
    <ul class="MuiMenu-list" role="listbox" id="mui-listbox" style="display:none;">
      <li role="option" id="mui-opt-us" data-value="us" aria-selected="false">United States</li>
      <li role="option" id="mui-opt-uk" data-value="uk" aria-selected="false">United Kingdom</li>
      <li role="option" id="mui-opt-de" data-value="de" aria-selected="false">Germany</li>
    </ul>

    <!-- ═══ Ant Design Style Select ═══ -->
    <div class="ant-select ant-select-single">
      <div class="ant-select-selector" id="antd-trigger" role="combobox" aria-expanded="false"
           aria-haspopup="listbox" aria-owns="antd-listbox" tabindex="0">
        <span class="ant-select-selection-item">Choose option</span>
        <span class="ant-select-arrow" aria-hidden="true">
          <svg viewBox="0 0 1024 1024"><path d="M884 256h-468c-4.4 0-8 3.6-8 8v56c0 4.4 3.6 8 8 8h468c4.4 0 8-3.6 8-8v-56c0-4.4-3.6-8-8-8z"/></svg>
        </span>
      </div>
    </div>
    <div class="ant-select-dropdown" id="antd-listbox" role="listbox" style="display:none;">
      <div class="ant-select-item" role="option" id="antd-opt1" aria-selected="false">Option A</div>
      <div class="ant-select-item" role="option" id="antd-opt2" aria-selected="false">Option B</div>
    </div>

    <!-- ═══ Radix UI Style Select ═══ -->
    <button type="button" role="combobox" id="radix-trigger" aria-expanded="false"
            aria-haspopup="listbox" aria-controls="radix-content">
      <span>Placeholder</span>
      <svg aria-hidden="true" class="chevron-down"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div role="listbox" id="radix-content" style="display:none;">
      <div role="option" id="radix-opt1" data-value="apple" aria-selected="false">Apple</div>
      <div role="option" id="radix-opt2" data-value="banana" aria-selected="false">Banana</div>
    </div>

    <!-- ═══ Headless UI Listbox ═══ -->
    <div class="relative">
      <button type="button" id="hui-trigger" aria-haspopup="listbox" aria-expanded="false"
              aria-labelledby="hui-label">
        <span id="hui-label">Framework</span>
        <span>React</span>
        <svg aria-hidden="true"><path d="M19 9l-7 7-7-7"/></svg>
      </button>
      <ul role="listbox" id="hui-listbox" style="display:none;" tabindex="-1">
        <li role="option" id="hui-opt1" aria-selected="false">React</li>
        <li role="option" id="hui-opt2" aria-selected="false">Vue</li>
        <li role="option" id="hui-opt3" aria-selected="false">Angular</li>
      </ul>
    </div>

    <!-- ═══ Search Autocomplete (React-Select / Downshift style) ═══ -->
    <div class="react-select-container">
      <div class="react-select__control" id="rs-control" role="combobox" aria-expanded="false"
           aria-haspopup="listbox" aria-owns="rs-listbox" tabindex="0">
        <div class="react-select__input">
          <input type="text" id="rs-input" name="search" placeholder="Search..." aria-autocomplete="list"
                 aria-controls="rs-listbox" />
        </div>
        <div class="react-select__indicator" id="rs-arrow" aria-hidden="true">
          <svg><path d="M4 6h16l-8 8z"/></svg>
        </div>
      </div>
      <div class="react-select__menu" id="rs-listbox" role="listbox" style="display:none;">
        <div role="option" id="rs-opt1">Apple MacBook Pro</div>
        <div role="option" id="rs-opt2">Apple iPhone</div>
        <div role="option" id="rs-opt3">Apple Watch</div>
      </div>
    </div>

    <!-- ═══ Icon-Only Buttons ═══ -->
    <!-- Material icon button with aria-label -->
    <button id="icon-delete" class="MuiIconButton-root" aria-label="Delete" type="button">
      <svg class="MuiSvgIcon-root"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
    </button>
    <!-- Icon button with title instead of aria-label -->
    <button id="icon-edit" class="icon-btn" title="Edit item" type="button">
      <svg><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"/></svg>
    </button>
    <!-- Icon button with just SVG, no text label -->
    <button id="icon-bare" class="icon-btn" type="button">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>
    </button>
    <!-- Font Awesome icon button -->
    <button id="icon-fa" type="button" aria-label="Settings">
      <i class="fa-solid fa-gear" aria-hidden="true"></i>
    </button>
    <!-- Icon button wrapping an SVG with aria-hidden and text for screen readers -->
    <button id="icon-sr" type="button">
      <svg aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>
      <span class="sr-only">Notifications</span>
    </button>

    <!-- ═══ Star Rating Widget ═══ -->
    <div id="star-rating" role="radiogroup" aria-label="Rate this product">
      <button id="star1" type="button" role="radio" aria-checked="false" aria-label="1 star" data-testid="star-1">★</button>
      <button id="star2" type="button" role="radio" aria-checked="false" aria-label="2 stars" data-testid="star-2">★★</button>
      <button id="star3" type="button" role="radio" aria-checked="false" aria-label="3 stars" data-testid="star-3">★★★</button>
      <button id="star4" type="button" role="radio" aria-checked="false" aria-label="4 stars" data-testid="star-4">★★★★</button>
      <button id="star5" type="button" role="radio" aria-checked="false" aria-label="5 stars" data-testid="star-5">★★★★★</button>
    </div>

    <!-- ═══ Segmented Control / Toggle Button Group ═══ -->
    <div role="group" id="seg-control" aria-label="View mode">
      <button id="seg-list" type="button" aria-pressed="true" aria-label="List view">
        <svg aria-hidden="true"><path d="M3 5h18v2H3zM3 11h18v2H3zM3 17h18v2H3z"/></svg>
      </button>
      <button id="seg-grid" type="button" aria-pressed="false" aria-label="Grid view">
        <svg aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>
      </button>
    </div>

    <!-- ═══ Accordion ═══ -->
    <div id="acc-section">
      <button id="acc-trigger" type="button" aria-expanded="false" aria-controls="acc-panel">
        <span>Personal Information</span>
        <svg aria-hidden="true" class="accordion-chevron"><path d="M7 10l5 5 5-5z"/></svg>
      </button>
      <div id="acc-panel" role="region" aria-labelledby="acc-trigger" style="display:none;">
        <input type="text" id="acc-name" placeholder="Full name" />
      </div>
    </div>

    <!-- ═══ Stepper / Number Input with +/- ═══ -->
    <div class="stepper" id="stepper">
      <button id="step-dec" type="button" aria-label="Decrease quantity">
        <svg aria-hidden="true"><path d="M19 13H5v-2h14v2z"/></svg>
      </button>
      <input type="number" id="step-value" value="1" readonly aria-label="Quantity" />
      <button id="step-inc" type="button" aria-label="Increase quantity">
        <svg aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
      </button>
    </div>

    <!-- ═══ Range Slider ═══ -->
    <input type="range" id="range-slider" min="0" max="100" value="50" aria-label="Volume" aria-valuenow="50" />

    <!-- ═══ Chip / Tag Selector ═══ -->
    <div role="group" id="chip-group" aria-label="Skills">
      <button id="chip-react" type="button" role="checkbox" aria-checked="false" class="chip">React</button>
      <button id="chip-vue" type="button" role="checkbox" aria-checked="false" class="chip">Vue</button>
      <button id="chip-svelte" type="button" role="checkbox" aria-checked="true" class="chip selected">Svelte</button>
    </div>

    <!-- ═══ Color Picker ═══ -->
    <div class="color-picker">
      <button id="cp-trigger" type="button" aria-label="Open color picker" aria-haspopup="dialog" aria-expanded="false">
        <span class="swatch" style="background:#ff0000"></span>
      </button>
      <div id="cp-grid" role="dialog" aria-modal="false" style="display:none;">
        <button id="cp-red" type="button" aria-label="Red" class="color-opt" data-color="#ff0000"></button>
        <button id="cp-blue" type="button" aria-label="Blue" class="color-opt" data-color="#0000ff"></button>
        <button id="cp-green" type="button" aria-label="Green" class="color-opt" data-color="#00ff00"></button>
      </div>
    </div>

    <!-- ═══ Breadcrumb ═══ -->
    <nav aria-label="Breadcrumb" id="breadcrumb-nav">
      <ol>
        <li><a href="/home" id="bc-home" aria-current="false">Home</a></li>
        <li><span aria-hidden="true">/</span></li>
        <li><a href="/products" id="bc-products" aria-current="false">Products</a></li>
        <li><span aria-hidden="true">/</span></li>
        <li><a href="/products/laptop" id="bc-laptop" aria-current="page">Laptops</a></li>
      </ol>
    </nav>

    <!-- ═══ Carousel / Slider ═══ -->
    <div class="carousel">
      <button id="car-prev" type="button" aria-label="Previous slide">
        <svg aria-hidden="true"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <div class="carousel-track">
        <div class="slide" id="car-slide1" role="tabpanel" aria-label="1 of 3">Slide 1</div>
      </div>
      <button id="car-next" type="button" aria-label="Next slide">
        <svg aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>
      <div class="carousel-dots" role="tablist">
        <button id="car-dot1" type="button" role="tab" aria-selected="true" aria-label="Go to slide 1">●</button>
        <button id="car-dot2" type="button" role="tab" aria-selected="false" aria-label="Go to slide 2">○</button>
      </div>
    </div>

    <!-- ═══ Toggle Button Group (single-select, like radio) ═══ -->
    <div role="radiogroup" id="tbg" aria-label="Sort order">
      <button id="tbg-asc" type="button" role="radio" aria-checked="true" aria-label="Sort ascending">
        <svg aria-hidden="true"><path d="M7 14l5-5 5 5z"/></svg>
      </button>
      <button id="tbg-desc" type="button" role="radio" aria-checked="false" aria-label="Sort descending">
        <svg aria-hidden="true"><path d="M7 10l5 5 5-5z"/></svg>
      </button>
    </div>

    <!-- ═══ Copy-to-clipboard button ═══ -->
    <button id="btn-copy" type="button" aria-label="Copy to clipboard">
      <svg aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2z"/></svg>
    </button>

    <!-- ═══ Dropdown menu button (overflow menu) ═══ -->
    <button id="overflow-menu" type="button" aria-label="More options" aria-haspopup="menu" aria-expanded="false">
      <svg aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
    </button>
    <div role="menu" id="overflow-content" style="display:none;">
      <div role="menuitem" id="of-edit" tabindex="0">Edit</div>
      <div role="menuitem" id="of-duplicate" tabindex="0">Duplicate</div>
      <div role="menuitem" id="of-delete" tabindex="0">Delete</div>
    </div>

    <!-- ═══ Filter dropdown with checkboxes ═══ -->
    <div class="filter-dropdown">
      <button id="filter-trigger" type="button" aria-haspopup="true" aria-expanded="false">
        <span>Filters</span>
        <span class="badge">2</span>
      </button>
      <div class="filter-panel" id="filter-panel" role="group" style="display:none;">
        <label><input type="checkbox" id="filter-active" /> Active</label>
        <label><input type="checkbox" id="filter-pending" /> Pending</label>
      </div>
    </div>
  `;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Modern Application Widgets — Dropdowns, Icons & Complex Components', () => {

  beforeEach(() => {
    eventCounter = 0;
    setupModernDOM();
  });

  // ═══════════════════════════════════════════════════════════════════
  // CUSTOM DROPDOWNS — The biggest challenge
  // ═══════════════════════════════════════════════════════════════════

  describe('Material UI Style Select', () => {
    it('Click on MUI select trigger (combobox role)', () => {
      const trigger = document.getElementById('mui-select-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      // Should detect as Click — combobox isn't in Tier 1 yet
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Country');
    });

    it('MUI select full flow: trigger click → option click', () => {
      const trigger = document.getElementById('mui-select-trigger')!;
      const opt = document.getElementById('mui-opt-uk')!;
      const events = [
        makeEvent('click', trigger),
        makeEvent('click', opt),
      ];
      const result = detectInteractions(events);
      // Two clicks on DIFFERENT elements → 2 interactions
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Click');
      expect(result[1].metadata.accessibleName).toBe('United Kingdom');
    });
  });

  describe('Ant Design Style Select', () => {
    it('Click on AntD select trigger (combobox)', () => {
      const trigger = document.getElementById('antd-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Choose option');
    });

    it('AntD full flow: trigger → option selection', () => {
      const trigger = document.getElementById('antd-trigger')!;
      const opt = document.getElementById('antd-opt2')!;
      const events = [
        makeEvent('click', trigger),
        makeEvent('click', opt),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[1].metadata.accessibleName).toBe('Option B');
    });
  });

  describe('Radix UI Style Select', () => {
    it('Click on Radix select trigger (button role=combobox)', () => {
      const trigger = document.getElementById('radix-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Radix option selection', () => {
      const opt = document.getElementById('radix-opt1')!;
      const events = [makeEvent('click', opt)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('Apple');
    });
  });

  describe('Headless UI Listbox', () => {
    it('Click on HUI trigger button', () => {
      const trigger = document.getElementById('hui-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('HUI full flow: trigger → option click', () => {
      const trigger = document.getElementById('hui-trigger')!;
      const opt = document.getElementById('hui-opt2')!;
      const events = [
        makeEvent('click', trigger),
        makeEvent('click', opt),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[1].metadata.accessibleName).toBe('Vue');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // SEARCH AUTOCOMPLETE
  // ═══════════════════════════════════════════════════════════════════

  describe('Search Autocomplete (React-Select Style)', () => {
    it('Type in autocomplete input', () => {
      const input = document.getElementById('rs-input') as HTMLInputElement;
      input.value = 'apple';
      const events = [
        makeEvent('focus', input, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', input, { valueBefore: '', valueAfter: 'apple' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('apple');
    });

    it('Autocomplete full flow: type → click suggestion', () => {
      const input = document.getElementById('rs-input') as HTMLInputElement;
      input.value = 'apple';
      const opt = document.getElementById('rs-opt1')!;
      const events = [
        makeEvent('focus', input, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', input, { valueBefore: '', valueAfter: 'apple' }),
        makeEvent('blur', input, { valueBefore: 'apple', valueAfter: 'apple' }),
        makeEvent('click', opt),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('apple');
      expect(result[1].type).toBe('Click');
      expect(result[1].metadata.accessibleName).toBe('Apple MacBook Pro');
    });

    it('Click on dropdown arrow indicator to open', () => {
      const arrow = document.getElementById('rs-arrow')!;
      const events = [makeEvent('click', arrow)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // ICON BUTTONS — various labeling patterns
  // ═══════════════════════════════════════════════════════════════════

  describe('Icon-Only Buttons', () => {
    it('Icon button with aria-label (delete)', () => {
      const btn = document.getElementById('icon-delete')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Delete');
    });

    it('Icon button with title attribute (edit)', () => {
      const btn = document.getElementById('icon-edit')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      // accessibleName from textContent of SVG is empty, should fall back to title
    });

    it('Icon button with no label (bare SVG)', () => {
      const btn = document.getElementById('icon-bare')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      // No accessible name — but still a valid interaction
    });

    it('Icon button with Font Awesome (settings)', () => {
      const btn = document.getElementById('icon-fa')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Settings');
    });

    it('Icon button with sr-only span (notifications)', () => {
      const btn = document.getElementById('icon-sr')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      // sr-only text is in textContent — accessibleName should capture it
      expect(result[0].metadata.accessibleName).toBeTruthy();
    });

    it('Copy-to-clipboard icon button', () => {
      const btn = document.getElementById('btn-copy')!;
      const events = [makeEvent('click', btn)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Copy to clipboard');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // COMPLEX WIDGETS
  // ═══════════════════════════════════════════════════════════════════

  describe('Star Rating Widget', () => {
    it('Click 4-star rating', () => {
      const star = document.getElementById('star4')!;
      star.setAttribute('aria-checked', 'true');
      const events = [makeEvent('click', star, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
    });

    it('Change rating from 3 to 5 stars', () => {
      const star3 = document.getElementById('star3')!;
      star3.setAttribute('aria-checked', 'true');
      const star5 = document.getElementById('star5')!;
      star5.setAttribute('aria-checked', 'true');
      star3.setAttribute('aria-checked', 'false');
      const events = [
        makeEvent('click', star3, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', star5, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('RadioButton');
      expect(result[1].type).toBe('RadioButton');
    });
  });

  describe('Segmented Control (Toggle Button Group)', () => {
    it('Switch from list view to grid view', () => {
      const grid = document.getElementById('seg-grid')!;
      grid.setAttribute('aria-pressed', 'true');
      const list = document.getElementById('seg-list')!;
      list.setAttribute('aria-pressed', 'false');
      const events = [
        makeEvent('click', grid, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ToggleSwitch');
      expect(result[0].metadata.checked).toBe(true);
    });

    it('Toggle list view off', () => {
      const list = document.getElementById('seg-list')!;
      list.setAttribute('aria-pressed', 'false');
      const events = [
        makeEvent('click', list, { checkedBefore: true, checkedAfter: false }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('ToggleSwitch');
      expect(result[0].metadata.checked).toBe(false);
    });
  });

  describe('Accordion', () => {
    it('Click accordion header to expand', () => {
      const trigger = document.getElementById('acc-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toContain('Personal Information');
    });

    it('Accordion expand → type in revealed field', () => {
      const trigger = document.getElementById('acc-trigger')!;
      const nameInput = document.getElementById('acc-name') as HTMLInputElement;
      nameInput.value = 'John Doe';
      const events = [
        makeEvent('click', trigger),
        makeEvent('focus', nameInput, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', nameInput, { valueBefore: '', valueAfter: 'John Doe' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('TextEntry');
      expect(result[1].metadata.textValue).toBe('John Doe');
    });
  });

  describe('Stepper / Quantity Input', () => {
    it('Click increase button', () => {
      const inc = document.getElementById('step-inc')!;
      const events = [makeEvent('click', inc)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Increase quantity');
    });

    it('Click decrease button', () => {
      const dec = document.getElementById('step-dec')!;
      const events = [makeEvent('click', dec)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Decrease quantity');
    });

    it('Multiple increments: +, +, +', () => {
      const inc = document.getElementById('step-inc')!;
      const events = [
        makeEvent('click', inc),
        makeEvent('click', inc),
        makeEvent('click', inc),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      result.forEach(r => expect(r.type).toBe('Click'));
    });
  });

  describe('Range Slider', () => {
    it('Range slider change event', () => {
      const slider = document.getElementById('range-slider') as HTMLInputElement;
      slider.value = '75';
      const events = [
        makeEvent('change', slider, { valueBefore: '50', valueAfter: '75' }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBeTruthy();
    });
  });

  describe('Chip / Tag Selector', () => {
    it('Select React chip', () => {
      const chip = document.getElementById('chip-react')!;
      chip.setAttribute('aria-checked', 'true');
      const events = [makeEvent('click', chip, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(true);
    });

    it('Deselect pre-selected Svelte chip', () => {
      const chip = document.getElementById('chip-svelte')!;
      chip.setAttribute('aria-checked', 'false');
      const events = [makeEvent('click', chip, { checkedBefore: true, checkedAfter: false })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].metadata.checked).toBe(false);
    });

    it('Multi-select: React + Vue chips', () => {
      const react = document.getElementById('chip-react')!;
      react.setAttribute('aria-checked', 'true');
      const vue = document.getElementById('chip-vue')!;
      vue.setAttribute('aria-checked', 'true');
      const events = [
        makeEvent('click', react, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', vue, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Checkbox');
      expect(result[1].type).toBe('Checkbox');
    });
  });

  describe('Color Picker', () => {
    it('Open color picker trigger', () => {
      const trigger = document.getElementById('cp-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Open color picker');
    });

    it('Select blue color', () => {
      const blue = document.getElementById('cp-blue')!;
      const events = [makeEvent('click', blue)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Blue');
    });
  });

  describe('Breadcrumb Navigation', () => {
    it('Click Products breadcrumb', () => {
      const link = document.getElementById('bc-products')!;
      const events = [makeEvent('click', link)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });

    it('Navigate home via breadcrumb', () => {
      const link = document.getElementById('bc-home')!;
      const events = [
        makeEvent('click', link),
        makeNav('https://app.com/home', 'Home'),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Link');
      expect(result[1].type).toBe('PageNavigation');
    });
  });

  describe('Carousel', () => {
    it('Click next slide button', () => {
      const next = document.getElementById('car-next')!;
      const events = [makeEvent('click', next)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Next slide');
    });

    it('Click previous slide button', () => {
      const prev = document.getElementById('car-prev')!;
      const events = [makeEvent('click', prev)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('Previous slide');
    });

    it('Click carousel dot (tab role)', () => {
      const dot = document.getElementById('car-dot2')!;
      const events = [makeEvent('click', dot)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Tab');
    });
  });

  describe('Toggle Button Group (RadioGroup)', () => {
    it('Switch sort order from ascending to descending', () => {
      const desc = document.getElementById('tbg-desc')!;
      desc.setAttribute('aria-checked', 'true');
      const asc = document.getElementById('tbg-asc')!;
      asc.setAttribute('aria-checked', 'false');
      const events = [makeEvent('click', desc, { checkedBefore: false, checkedAfter: true })];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
    });
  });

  describe('Overflow Menu (Kebab Menu)', () => {
    it('Click overflow menu trigger', () => {
      const trigger = document.getElementById('overflow-menu')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
      expect(result[0].metadata.accessibleName).toBe('More options');
    });

    it('Overflow menu → Delete menuitem', () => {
      const trigger = document.getElementById('overflow-menu')!;
      const deleteItem = document.getElementById('of-delete')!;
      const events = [
        makeEvent('click', trigger),
        makeEvent('click', deleteItem),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Menu');
      expect(result[1].metadata.accessibleName).toBe('Delete');
    });

    it('Overflow menu → Edit menuitem', () => {
      const trigger = document.getElementById('overflow-menu')!;
      const editItem = document.getElementById('of-edit')!;
      const events = [
        makeEvent('click', trigger),
        makeEvent('click', editItem),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Menu');
    });
  });

  describe('Filter Dropdown with Checkboxes', () => {
    it('Open filter panel', () => {
      const trigger = document.getElementById('filter-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Filter: open → check Active → check Pending', () => {
      const trigger = document.getElementById('filter-trigger')!;
      const active = document.getElementById('filter-active') as HTMLInputElement;
      active.checked = true;
      const pending = document.getElementById('filter-pending') as HTMLInputElement;
      pending.checked = true;

      const events = [
        makeEvent('click', trigger),
        makeEvent('click', active, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', pending, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Checkbox');
      expect(result[1].metadata.checked).toBe(true);
      expect(result[2].type).toBe('Checkbox');
      expect(result[2].metadata.checked).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REALISTIC MODERN FORM SEQUENCES
  // ═══════════════════════════════════════════════════════════════════

  describe('Modern Form Sequences', () => {
    it('Product filter flow: search → custom dropdown → chip → apply', () => {
      const searchInput = document.getElementById('rs-input') as HTMLInputElement;
      searchInput.value = 'laptop';
      const muiTrigger = document.getElementById('mui-select-trigger')!;
      const muiOpt = document.getElementById('mui-opt-us')!;
      const chip = document.getElementById('chip-react')!;
      chip.setAttribute('aria-checked', 'true');

      const events = [
        makeEvent('focus', searchInput, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', searchInput, { valueBefore: '', valueAfter: 'laptop' }),
        makeEvent('blur', searchInput, { valueBefore: 'laptop', valueAfter: 'laptop' }),
        makeEvent('click', muiTrigger),
        makeEvent('click', muiOpt),
        makeEvent('click', chip, { checkedBefore: false, checkedAfter: true }),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(4);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('laptop');
      expect(result[1].type).toBe('Click');
      expect(result[2].type).toBe('Click');
      expect(result[2].metadata.accessibleName).toBe('United States');
      expect(result[3].type).toBe('Checkbox');
    });

    it('Settings panel: accordion → toggle → select → save', () => {
      const accTrigger = document.getElementById('acc-trigger')!;
      const toggleBtn = document.getElementById('seg-grid')!;
      toggleBtn.setAttribute('aria-pressed', 'true');
      const radixTrigger = document.getElementById('radix-trigger')!;
      const radixOpt = document.getElementById('radix-opt1')!;
      const copyBtn = document.getElementById('btn-copy')!;

      const events = [
        makeEvent('click', accTrigger),
        makeEvent('click', toggleBtn, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', radixTrigger),
        makeEvent('click', radixOpt),
        makeEvent('click', copyBtn),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(5);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('ToggleSwitch');
      expect(result[1].metadata.checked).toBe(true);
      expect(result[2].type).toBe('Click');
      expect(result[3].type).toBe('Click');
      expect(result[4].type).toBe('Click');
      expect(result[4].metadata.accessibleName).toBe('Copy to clipboard');
    });

    it('E-commerce: star rating → quantity stepper → add to cart', () => {
      const star = document.getElementById('star4')!;
      star.setAttribute('aria-checked', 'true');
      const inc = document.getElementById('step-inc')!;
      const overflow = document.getElementById('overflow-menu')!;
      const wishlistItem = document.getElementById('of-duplicate')!;

      const events = [
        makeEvent('click', star, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', inc),
        makeEvent('click', inc),
        makeEvent('click', overflow),
        makeEvent('click', wishlistItem),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(5);
      expect(result[0].type).toBe('RadioButton');
      expect(result[0].metadata.checked).toBe(true);
      expect(result[1].type).toBe('Click');
      expect(result[1].metadata.accessibleName).toBe('Increase quantity');
      expect(result[2].type).toBe('Click');
      expect(result[3].type).toBe('Click');
      expect(result[4].type).toBe('Menu');
    });

    it('Table row actions: overflow menu → delete → confirm modal', () => {
      const overflow = document.getElementById('overflow-menu')!;
      const deleteItem = document.getElementById('of-delete')!;
      const iconDelete = document.getElementById('icon-delete')!;

      const events = [
        makeEvent('click', overflow),
        makeEvent('click', deleteItem),
        makeEvent('click', iconDelete),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Menu');
      expect(result[2].type).toBe('Click');
      expect(result[2].metadata.accessibleName).toBe('Delete');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // EDGE CASES WITH MODERN PATTERNS
  // ═══════════════════════════════════════════════════════════════════

  describe('Modern Pattern Edge Cases', () => {
    it('Rapid clicks on same stepper button are separate interactions', () => {
      const inc = document.getElementById('step-inc')!;
      const events = [
        makeEvent('click', inc),
        makeEvent('click', inc),
        makeEvent('click', inc),
        makeEvent('click', inc),
        makeEvent('click', inc),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(5);
      result.forEach(r => {
        expect(r.type).toBe('Click');
        expect(r.metadata.accessibleName).toBe('Increase quantity');
      });
    });

    it('Mixed: type in search → click result → navigate', () => {
      const input = document.getElementById('rs-input') as HTMLInputElement;
      input.value = 'macbook';
      const opt = document.getElementById('rs-opt1')!;

      const events = [
        makeEvent('focus', input, { valueBefore: '', valueAfter: '' }),
        makeEvent('input', input, { valueBefore: '', valueAfter: 'macbook' }),
        makeEvent('blur', input, { valueBefore: 'macbook', valueAfter: 'macbook' }),
        makeEvent('click', opt),
        makeNav('https://shop.com/products/macbook', 'MacBook Pro'),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('macbook');
      expect(result[1].type).toBe('Click');
      expect(result[2].type).toBe('PageNavigation');
    });

    it('Chip toggle: select → deselect → reselect', () => {
      const chip = document.getElementById('chip-react')!;
      const events = [
        makeEvent('click', chip, { checkedBefore: false, checkedAfter: true }),
        makeEvent('click', chip, { checkedBefore: true, checkedAfter: false }),
        makeEvent('click', chip, { checkedBefore: false, checkedAfter: true }),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].metadata.checked).toBe(true);
      expect(result[1].metadata.checked).toBe(false);
      expect(result[2].metadata.checked).toBe(true);
    });

    it('Carousel navigation: dot1 → dot2 → prev', () => {
      const dot1 = document.getElementById('car-dot1')!;
      const dot2 = document.getElementById('car-dot2')!;
      const prev = document.getElementById('car-prev')!;

      const events = [
        makeEvent('click', dot1),
        makeEvent('click', dot2),
        makeEvent('click', prev),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Tab');
      expect(result[1].type).toBe('Tab');
      expect(result[2].type).toBe('Click');
      expect(result[2].metadata.accessibleName).toBe('Previous slide');
    });
  });
});

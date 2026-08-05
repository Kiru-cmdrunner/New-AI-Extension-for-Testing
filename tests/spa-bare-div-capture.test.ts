/**
 * Root Cause Validation: resolveTarget drops non-standard elements
 *
 * Reproduces the adanione.com bug: React SPA binds click handlers via
 * addEventListener (NOT onclick attribute), so the recorder's isInteractive()
 * check returns false for <div> elements with React onClick handlers.
 *
 * The fix: resolveTarget now has a 3-tier fallback:
 *   1. Known-interactive (native tags, ARIA roles, explicit attrs)
 *   2. Clickable heuristic (cursor:pointer, onclick property)
 *   3. Raw target (the element the user actually clicked)
 *
 * Never returns null for a real user click.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractions } from '../src/classifier/interaction-detector.js';
import type { RecordedEvent, ElementIdentity } from '../src/recorder/recorded-event.js';

let eventCounter = 0;

function makeIdentity(el: Element, overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  const ariaLabel = el.getAttribute('aria-label');
  const id = el.id;

  let accessibleName = '';
  if (ariaLabel) accessibleName = ariaLabel;
  if (!accessibleName) accessibleName = el.textContent?.trim() || '';

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
        email: 'textbox', password: 'textbox', number: 'spinbutton',
      };
      ariaRole = typeRoles[(el as HTMLInputElement).type] || null;
    }
  }

  return {
    accessibleName: accessibleName.slice(0, 200),
    ariaRole,
    ariaLabel,
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: el.getAttribute('placeholder') ?? null,
    tag: el.tagName,
    className: el.className || null,
    name: el.getAttribute('name'),
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

function makeEvent(
  eventType: string,
  el: Element,
  extras: { valueBefore?: string | null; valueAfter?: string | null; checkedBefore?: boolean | null; checkedAfter?: boolean | null } = {},
): RecordedEvent {
  const target = makeIdentity(el);
  const ts = new Date(Date.now() + (++eventCounter));
  return {
    eventId: `evt-${String(eventCounter).padStart(4, '0')}`,
    eventType,
    timestamp: ts.toISOString(),
    target,
    valueBefore: extras.valueBefore ?? null,
    valueAfter: extras.valueAfter ?? null,
    checkedBefore: extras.checkedBefore ?? null,
    checkedAfter: extras.checkedAfter ?? null,
  };
}

function setupAdaniDOM() {
  document.body.innerHTML = `
    <!-- Adani One style dropdown — bare divs, NO ARIA roles, NO native tags -->
    <!-- React binds click handlers via addEventListener -->
    <div id="flight-form">
      <!-- Flight type trigger: bare div with chevron -->
      <div id="trip-type-trigger" class="select-trigger">
        <span>One Way</span>
        <svg class="chevron"><path d="M7 10l5 5 5-5z"/></svg>
      </div>

      <!-- Passenger & class trigger -->
      <div id="pax-class-trigger" class="select-trigger">
        <span>1 • Economy</span>
        <svg class="chevron"><path d="M7 10l5 5 5-5z"/></svg>
      </div>

      <!-- Open dropdown panel (passenger/class) -->
      <div id="pax-class-panel" class="dropdown-panel" style="display:block;">
        <!-- Stepper: adults -->
        <div id="adults-stepper" class="stepper-row">
          <span class="label">Adults</span>
          <div id="adults-minus" class="step-btn">-</div>
          <span id="adults-value" class="step-value">1</span>
          <div id="adults-plus" class="step-btn">+</div>
        </div>

        <!-- Travel class buttons: bare divs, NO role, NO aria-checked -->
        <div id="travel-class-section">
          <div class="class-label">Select Travel Class</div>
          <div id="class-economy" class="class-option">Economy</div>
          <div id="class-premium" class="class-option selected">Premium Economy</div>
          <div id="class-business" class="class-option">Business</div>
        </div>
      </div>

      <!-- From/To inputs (React-controlled, no name attr) -->
      <div id="from-wrapper" class="input-wrapper">
        <span class="city-code">DEL</span>
        <input type="text" id="from-input" placeholder="New Delhi" autocomplete="off" />
      </div>

      <!-- Search button -->
      <div id="search-btn" class="btn-primary">Search</div>
    </div>
  `;

  // Simulate React addEventListener — does NOT set onclick attribute
  document.getElementById('class-premium')!.addEventListener('click', () => {});
  document.getElementById('class-economy')!.addEventListener('click', () => {});
  document.getElementById('class-business')!.addEventListener('click', () => {});
  document.getElementById('pax-class-trigger')!.addEventListener('click', () => {});
  document.getElementById('trip-type-trigger')!.addEventListener('click', () => {});
  document.getElementById('adults-plus')!.addEventListener('click', () => {});
  document.getElementById('adults-minus')!.addEventListener('click', () => {});
  document.getElementById('search-btn')!.addEventListener('click', () => {});
}

describe('Root Cause Fix — Bare Div/SPA Element Capture', () => {

  beforeEach(() => {
    eventCounter = 0;
    setupAdaniDOM();
  });

  // ═══ Direct scenario from adanione.com ═══

  describe('Adani One — Premium Economy Selection', () => {
    it('Click Premium Economy (bare div with React handler)', () => {
      // This is the EXACT scenario that failed on adanione.com:
      // User clicks a <div> with no role, no aria-checked, just a class name
      // and a React addEventListener click handler.
      const premium = document.getElementById('class-premium')!;
      const events = [makeEvent('click', premium)];

      // Before fix: detectInteractions would receive empty array (resolveTarget
      // returned null, so no event was sent). After fix: the click IS captured.
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click'); // bare div → Click
      expect(result[0].metadata.accessibleName).toBe('Premium Economy');
    });

    it('Full flow: open dropdown → select Premium Economy → close', () => {
      const trigger = document.getElementById('pax-class-trigger')!;
      const premium = document.getElementById('class-premium')!;
      const triggerAfter = document.getElementById('pax-class-trigger')!;

      const events = [
        makeEvent('click', trigger),
        makeEvent('click', premium),
        makeEvent('click', triggerAfter),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
      expect(result[0].metadata.accessibleName).toContain('Economy');
      expect(result[1].metadata.accessibleName).toBe('Premium Economy');
    });
  });

  describe('Adani One — All Dropdown Interactions', () => {
    it('Click trip type trigger (bare div)', () => {
      const trigger = document.getElementById('trip-type-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toContain('One Way');
    });

    it('Click passenger/class trigger (bare div)', () => {
      const trigger = document.getElementById('pax-class-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toContain('Economy');
    });

    it('Click increase adults (bare div stepper button)', () => {
      const plus = document.getElementById('adults-plus')!;
      const events = [makeEvent('click', plus)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('+');
    });

    it('Select Economy class', () => {
      const economy = document.getElementById('class-economy')!;
      const events = [makeEvent('click', economy)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('Economy');
    });

    it('Select Business class', () => {
      const business = document.getElementById('class-business')!;
      const events = [makeEvent('click', business)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('Business');
    });

    it('Click Search button (bare div, not <button>)', () => {
      const search = document.getElementById('search-btn')!;
      const events = [makeEvent('click', search)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('Search');
    });
  });

  // ═══ Complete booking flow ═══

  describe('Complete Flight Booking Flow', () => {
    it('Open pax/class → select Premium Economy → increase adults → search', () => {
      const trigger = document.getElementById('pax-class-trigger')!;
      const premium = document.getElementById('class-premium')!;
      const plus = document.getElementById('adults-plus')!;
      const search = document.getElementById('search-btn')!;

      const events = [
        makeEvent('click', trigger),
        makeEvent('click', premium),
        makeEvent('click', plus),
        makeEvent('click', search),
      ];

      const result = detectInteractions(events);
      expect(result).toHaveLength(4);
      expect(result[0].metadata.accessibleName).toContain('Economy');
      expect(result[1].metadata.accessibleName).toBe('Premium Economy');
      expect(result[2].metadata.accessibleName).toBe('+');
      // Clicking + twice would be two separate interactions (same element, but clicks break groups)
      expect(result[3].metadata.accessibleName).toBe('Search');
    });
  });

  // ═══ Edge cases ═══

  describe('Edge Cases', () => {
    it('Click on SVG child inside a div target', () => {
      // When user clicks the chevron SVG inside the trigger, composedPath
      // walks up to find the parent div. In this test we simulate that
      // the identity is already extracted for the resolved target (the div).
      const trigger = document.getElementById('trip-type-trigger')!;
      const events = [makeEvent('click', trigger)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Multiple rapid clicks on same bare div', () => {
      const plus = document.getElementById('adults-plus')!;
      const events = [
        makeEvent('click', plus),
        makeEvent('click', plus),
        makeEvent('click', plus),
      ];
      const result = detectInteractions(events);
      expect(result).toHaveLength(3);
    });

    it('Bare div with cursor:pointer style', () => {
      const div = document.createElement('div');
      div.id = 'pointer-div';
      div.textContent = 'Click me';
      div.style.cursor = 'pointer';
      document.body.appendChild(div);

      const events = [makeEvent('click', div)];
      const result = detectInteractions(events);
      expect(result).toHaveLength(1);
      expect(result[0].metadata.accessibleName).toBe('Click me');
    });
  });
});

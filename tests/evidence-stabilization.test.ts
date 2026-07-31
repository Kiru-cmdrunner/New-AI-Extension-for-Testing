/**
 * Cross-Domain Validation Suite for the Evidence Classification Engine.
 *
 * Tests classifyByEvidence against realistic DOM interaction patterns from
 * 10+ application domains. Each scenario uses ElementIdentity + DomContext
 * values that mirror what the recorder would actually capture on real websites.
 *
 * The goal is NOT to test every edge case — it's to validate that the
 * evidence engine produces correct classifications across diverse real-world
 * UI patterns, identifying any domains where the current weights or
 * generators produce incorrect results.
 *
 * Domains covered:
 *   1. E-commerce (Amazon, Shopify, Magento patterns)
 *   2. Banking & Financial (Chase, Bank of America patterns)
 *   3. Travel & Booking (airline, hotel patterns)
 *   4. Enterprise (CRM, ERP, HRMS — Salesforce, SAP, Workday patterns)
 *   5. SaaS Dashboards (analytics, admin panels)
 *   6. CMS/Admin (WordPress, Drupal patterns)
 *   7. Healthcare (appointment, insurance patterns)
 *   8. Government (public service portals)
 *   9. Social Media (like/follow/comment patterns)
 *  10. Component Libraries (MUI, AntD, Chakra, Radix patterns)
 *  11. Accessibility-first sites (aria-only semantics)
 *  12. Non-semantic sites (div-soup, no aria, no classes)
 */

import { describe, it, expect } from 'vitest';
import type { ElementIdentity, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import { classifyByEvidence } from '../src/classifier/evidence/evidence-classifier';
import { getScoreBreakdown } from '../src/classifier/evidence/diagnostics';

// ── Test Helpers ─────────────────────────────────────────────────────────

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
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-test',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    ancestorRoles: [],
    ...overrides,
  };
}

function makeClickEvent(
  target: ElementIdentity,
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: 'evt-test',
    eventType: 'click',
    timestamp: '2026-07-31T08:00:00Z',
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext(),
    ...overrides,
  };
}

/**
 * Run classifyByEvidence and return the full result + score breakdown.
 */
function classify(
  target: ElementIdentity,
  event: ElementRecordedEvent,
) {
  const result = classifyByEvidence(target, event);
  const breakdown = getScoreBreakdown(result.evidence);
  return { result, breakdown };
}

// ─────────────────────────────────────────────────────────────────────────

describe('Cross-Domain Evidence Validation', () => {

  // ════════════════════════════════════════════════════════════════════════
  // 1. E-COMMERCE
  // ════════════════════════════════════════════════════════════════════════

  describe('1. E-Commerce', () => {
    it('Amazon filter: <a> with aria-checked → Checkbox', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'vivo',
        className: 's-navigation-item',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
        domContext: makeDomContext({
          ancestorRoles: ['ul', 'div[role=group]'],
        }),
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
      expect(result.intent).toBe('toggle');
    });

    it('Amazon "Get It by Tomorrow" delivery filter → Checkbox', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Get It by Tomorrow',
        className: 's-navigation-item',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Amazon price range "Under ₹15000" filter link → Checkbox', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Under ₹15,000',
        className: 's-navigation-item',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Amazon product card link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'OnePlus Nord CE 4 5G',
        className: 'a-link-normal s-no-outline',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
      expect(result.intent).toBe('navigate');
    });

    it('Amazon "Add to Cart" button → Click', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'button',
        accessibleName: 'Add to Cart',
        className: 'a-button-input',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
      expect(result.intent).toBe('trigger');
    });

    it('Amazon "Buy Now" button → Click', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'button',
        accessibleName: 'Buy Now',
        className: 'a-button-input',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Shopify variant radio button (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'radio',
        accessibleName: 'Large',
        className: 'product-form__radio',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      // Native input with checked transition → toggle
      expect(result.intent).toBe('toggle');
    });

    it('Magento layered navigation checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Category: Electronics',
        className: 'checkbox',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Wishlist heart toggle button (aria-pressed) → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Add to Wishlist',
        className: 'wishlist-btn',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      // Button with checked transition → toggle
      expect(result.intent).toBe('toggle');
      expect(result.type).toBe('ToggleSwitch');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. BANKING & FINANCIAL
  // ════════════════════════════════════════════════════════════════════════

  describe('2. Banking & Financial', () => {
    it('Chase "Transfer" action button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Transfer money',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Bank of America account summary link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Checking ••••4521',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Two-factor auth toggle (aria-checked on div) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'checkbox',
        accessibleName: 'Enable SMS authentication',
        className: 'toggle-container',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
      expect(result.intent).toBe('toggle');
    });

    it('Account notification preference (native checkbox) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Email me about low balance',
        className: 'form-check-input',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Paperless statements toggle switch → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'switch',
        accessibleName: 'Go paperless',
        className: 'switch-control',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });

    it('Statement download link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Download June 2026 statement (PDF)',
        className: 'download-link',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. TRAVEL & BOOKING
  // ════════════════════════════════════════════════════════════════════════

  describe('3. Travel & Booking', () => {
    it('Adani One economy class filter → Checkbox', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'checkbox',
        accessibleName: 'Economy',
        className: 'filter-option',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Airline seat selection button → Click', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'button',
        accessibleName: 'Seat 12A — Window',
        className: 'seat available',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Flight details expand link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Flight details',
        className: 'flight-details-link',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Book now button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Book Now',
        className: 'btn-primary',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Trip insurance opt-in (native checkbox) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Add travel insurance',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Hotel amenities filter (link-based, no aria) → Link (false negative risk)', () => {
      // This is a link-based filter WITHOUT checkedBefore/checkedAfter.
      // The recorder might not capture checked state for SPA-based toggles.
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Free WiFi',
        className: 'amenity-filter',
      });
      const event = makeClickEvent(target); // no checked transition captured
      const { result, breakdown } = classify(target, event);
      // Without a checked transition or aria-checked, there's no toggle evidence.
      // The classifier correctly returns Link — this is a known limitation.
      expect(result.type).toBe('Link');
      expect(result.intent).toBe('navigate');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. ENTERPRISE (CRM, ERP, HRMS)
  // ════════════════════════════════════════════════════════════════════════

  describe('4. Enterprise', () => {
    it('Salesforce tab navigation → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'tab',
        accessibleName: 'Opportunities',
        className: 'tabHeader',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Salesforce record row link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Acme Corporation',
        className: 'slds-truncate',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Workday action button "Submit" → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Submit',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('SAP data table sort header → Click', () => {
      const target = makeIdentity({
        tag: 'TH',
        ariaRole: 'columnheader',
        accessibleName: 'Amount',
        className: 'sapMListTblHdr',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('OrangeHRM save button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Save',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Enterprise preferences checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Receive email notifications',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. SAAS DASHBOARDS
  // ════════════════════════════════════════════════════════════════════════

  describe('5. SaaS Dashboards', () => {
    it('Analytics chart click → Click', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'button',
        accessibleName: 'Revenue chart — July 2026',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Date range filter toggle → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Last 30 days',
        className: 'date-range-picker',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Dark mode toggle switch → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'switch',
        accessibleName: 'Dark mode',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });

    it('Settings save button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Save Settings',
        className: 'btn-save',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Dashboard breadcrumb link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Home',
        className: 'breadcrumb-item',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 6. CMS / ADMIN
  // ════════════════════════════════════════════════════════════════════════

  describe('6. CMS / Admin', () => {
    it('WordPress "Publish" button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Publish',
        className: 'components-button',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('WordPress admin menu link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Posts',
        className: 'wp-first-item',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Drupal content type checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Article',
        className: 'form-checkbox',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('WordPress plugin "Activate" link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Activate',
        className: 'activate',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 7. HEALTHCARE
  // ════════════════════════════════════════════════════════════════════════

  describe('7. Healthcare', () => {
    it('Appointment slot button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: '10:30 AM — Available',
        className: 'time-slot',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Provider directory link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Dr. Sarah Johnson, MD',
        className: 'provider-card',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Insurance consent checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'I authorize release of medical records',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Telehealth join button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Join Video Visit',
        className: 'btn-join',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 8. GOVERNMENT / PUBLIC SERVICE
  // ════════════════════════════════════════════════════════════════════════

  describe('8. Government / Public Service', () => {
    it('Service portal "Apply Now" button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Apply Now',
        className: 'usa-button',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Gov portal navigation link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Renew Driver License',
        className: 'usa-nav__link',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Terms acknowledgment checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'I certify the information provided is true',
        className: 'usa-checkbox__input',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Download form PDF link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Download Form DS-11 (PDF)',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 9. SOCIAL MEDIA & COLLABORATION
  // ════════════════════════════════════════════════════════════════════════

  describe('9. Social Media & Collaboration', () => {
    it('Like button (aria-pressed) → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Like',
        className: 'like-button',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.intent).toBe('toggle');
      expect(result.type).toBe('ToggleSwitch');
    });

    it('Follow button (aria-pressed without checked state) → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Follow',
        className: 'follow-btn',
      });
      const event = makeClickEvent(target);
      // No checked transition → no toggle evidence → trigger
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Profile link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'John Doe',
        className: 'profile-link',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Slack channel name link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: '#general',
        className: 'channel-link',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Comment submit button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Post Comment',
        className: 'comment-submit',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Notification toggle (native checkbox in settings) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Email notifications',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 10. COMPONENT LIBRARIES
  // ════════════════════════════════════════════════════════════════════════

  describe('10. Component Libraries', () => {
    // ── MUI (Material UI) ──
    it('MUI Checkbox (native input, .MuiCheckbox-root) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Accept terms',
        className: 'PrivateSwitchBase-input css-1m9pwf3',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('MUI Switch (aria role switch) → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'switch',
        accessibleName: 'Wi-Fi',
        className: 'PrivateSwitchBase-input',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });

    it('MUI Button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Submit',
        className: 'MuiButtonBase-root MuiButton-root',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    // ── Ant Design ──
    it('AntD Checkbox (native input, .ant-checkbox-input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Remember me',
        className: 'ant-checkbox-input',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('AntD Button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Log in',
        className: 'ant-btn ant-btn-primary',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    // ── Chakra UI ──
    it('Chakra Checkbox (native input, .chakra-checkbox__input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Subscribe to newsletter',
        className: 'chakra-checkbox__input',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    // ── Radix UI ──
    it('Radix Checkbox (button with role=checkbox) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'checkbox',
        accessibleName: 'Enable feature',
        className: 'radix-checkbox',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Radix Switch (role=switch) → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'switch',
        accessibleName: 'Notifications',
        className: 'radix-switch',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 11. ACCESSIBILITY-FIRST SITES
  // ════════════════════════════════════════════════════════════════════════

  describe('11. Accessibility-First', () => {
    it('aria-checked div (no native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'checkbox',
        accessibleName: 'Accept privacy policy',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('role=switch span → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'SPAN',
        ariaRole: 'switch',
        accessibleName: 'High contrast mode',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });

    it('aria-pressed toggle button → ToggleSwitch', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Mute audio',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('ToggleSwitch');
    });

    it('aria-checked menuitemcheckbox → Checkbox', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'menuitemcheckbox',
        accessibleName: 'Show line numbers',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Screen reader-only link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Skip to main content',
        className: 'sr-only',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 12. NON-SEMANTIC SITES (div-soup)
  // ════════════════════════════════════════════════════════════════════════

  describe('12. Non-Semantic Sites (div-soup)', () => {
    it('Generic div with no aria, no classes → Click', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: null,
        accessibleName: '',
        className: null,
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
      expect(result.confidence).toBe(0); // no evidence at all
    });

    it('Div with onClick handler (no semantic info) → Click', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: null,
        accessibleName: 'Close',
        className: 'close-btn',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Span with no role (custom toggle, no aria) → Click', () => {
      // A SPA toggle without aria-checked — the recorder won't capture checked state
      const target = makeIdentity({
        tag: 'SPAN',
        ariaRole: null,
        accessibleName: 'Expand',
        className: 'toggle-icon',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });

    it('Div with checkbox CSS class but no aria/checked → Checkbox (structural evidence alone)', () => {
      // Has CSS class "checkbox" but no aria-checked or checked transition.
      // Structural evidence alone (+0.2) is enough to win toggle intent
      // since there's no competing navigate/trigger evidence.
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: null,
        accessibleName: 'Subscribe',
        className: 'custom-checkbox-wrapper',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      // className includes "checkbox" → structural gives +0.2 toggle.
      // But nothing else. toggle score = 0.2 > 0 → toggle wins.
      expect(result.intent).toBe('toggle');
      expect(result.type).toBe('Checkbox');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('Shadow DOM checkbox (native input) → Checkbox', () => {
      const target = makeIdentity({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Enable feature',
        shadowDom: true,
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
    });

    it('Iframe link → Link', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Embedded resource',
        inIframe: true,
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Link');
    });

    it('Button with target=_blank (opens new tab) → handled by fast path', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Open in new tab',
      });
      const event = makeClickEvent(target, {
        domContext: makeDomContext({
          opensNewTab: true,
          openedUrl: 'https://example.com',
        }),
      });
      const { result } = classify(target, event);
      // Evidence engine sees opensNewTab → navigate +0.7
      expect(result.intent).toBe('navigate');
      expect(result.type).toBe('NewTab');
    });

    it('Anchor with target=_blank → handled by fast path', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'External docs',
      });
      const event = makeClickEvent(target, {
        domContext: makeDomContext({
          opensNewTab: true,
          openedUrl: 'https://docs.example.com',
        }),
      });
      const { result } = classify(target, event);
      expect(result.type).toBe('NewTab');
    });

    it('Checked transition on <a> without aria-checked (SPA filter) → Checkbox', () => {
      // This is the original Amazon bug — <a> tag with a checked transition
      // but no aria-checked. The behavioral evidence (checked transition)
      // should override the tag evidence (anchor → navigate).
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Free Shipping',
        className: 'filter-link',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result, breakdown } = classify(target, event);
      expect(result.type).toBe('Checkbox');
      expect(result.intent).toBe('toggle');
    });

    it('Null checkedBefore/checkedAfter on checkbox-role div still classifies via aria', () => {
      const target = makeIdentity({
        tag: 'DIV',
        ariaRole: 'checkbox',
        accessibleName: 'Agree to terms',
      });
      const event = makeClickEvent(target); // no checkedBefore/checkedAfter
      const { result } = classify(target, event);
      expect(result.type).toBe('Checkbox');
      expect(result.intent).toBe('toggle');
    });

    it('Empty accessible name on button → Click', () => {
      const target = makeIdentity({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: '',
      });
      const event = makeClickEvent(target);
      const { result } = classify(target, event);
      expect(result.type).toBe('Click');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // EVIDENCE AUDITABILITY
  // ════════════════════════════════════════════════════════════════════════

  describe('Evidence Audit Trail', () => {
    it('every classification has a non-null evidence array', () => {
      const scenarios = [
        makeIdentity({ tag: 'A', ariaRole: 'link' }),
        makeIdentity({ tag: 'BUTTON', ariaRole: 'button' }),
        makeIdentity({ tag: 'DIV', ariaRole: 'checkbox' }),
        makeIdentity({ tag: 'INPUT', ariaRole: 'checkbox' }),
        makeIdentity({ tag: 'DIV', ariaRole: null }),
      ];
      for (const target of scenarios) {
        const event = makeClickEvent(target);
        const { result } = classify(target, event);
        expect(Array.isArray(result.evidence)).toBe(true);
      }
    });

    it('every evidence vote has all required fields', () => {
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        className: 'filter-item',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result } = classify(target, event);
      for (const e of result.evidence) {
        expect(typeof e.intent).toBe('string');
        expect(typeof e.weight).toBe('number');
        expect(typeof e.source).toBe('string');
        expect(typeof e.reason).toBe('string');
      }
    });

    it('runner-up is populated when there are competing intents', () => {
      // Amazon filter: toggle competes with navigate
      const target = makeIdentity({
        tag: 'A',
        ariaRole: 'link',
        className: 's-navigation-item',
      });
      const event = makeClickEvent(target, {
        checkedBefore: false,
        checkedAfter: true,
      });
      const { result, breakdown } = classify(target, event);
      expect(breakdown.runnerUp).not.toBeNull();
      expect(breakdown.margin).toBeGreaterThan(0);
    });
  });
});

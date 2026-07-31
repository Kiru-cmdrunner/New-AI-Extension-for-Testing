/**
 * Action-Oriented Phrasing Tests
 *
 * Tests that createComponentInteractionElement renders semantic descriptions
 * like "Enter mobile phone \"9894438714\"" instead of raw accessibleName.
 *
 * Migrated from DetectedInteraction → ComponentInteraction.
 * Uses makeComponentInteraction helper to map resolved (classifier-style)
 * types to ComponentInteraction.type + interactionSubtype.
 */

import { describe, it, expect } from 'vitest';
import { createComponentInteractionElement, actionDescription } from '../src/sidepanel/timeline-renderer.js';
import type { ComponentInteraction } from '../src/shared/component-types';
import { makeComponentInteraction as makeCI, makeElementIdentity } from './helpers/component-interaction-fixture';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeInteraction(
  type: string,
  overrides: {
    target?: ReturnType<typeof makeElementIdentity>;
    metadata?: Record<string, unknown>;
  } = {},
): ComponentInteraction {
  return makeCI(type, {
    trigger: overrides.target,
    metadata: overrides.metadata,
  });
}

function getActionText(el: HTMLElement): string {
  const actionEl = el.querySelector('.interaction-action-text');
  return actionEl?.textContent || '';
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Action-Oriented Interaction Phrasing', () => {

  describe('TextEntry', () => {
    it('renders "Enter Mobile phone \"9894438714\""', () => {
      const ci = makeInteraction('TextEntry', {
        target: makeElementIdentity({ accessibleName: 'Mobile phone', tag: 'INPUT' }),
        metadata: { textValue: '9894438714' },
      });
      expect(actionDescription(ci)).toBe('Enter Mobile phone "9894438714"');
      expect(getActionText(createComponentInteractionElement(ci))).toBe('Enter Mobile phone "9894438714"');
    });

    it('renders "Enter text in Email" when no value', () => {
      const ci = makeInteraction('TextEntry', {
        target: makeElementIdentity({ accessibleName: 'Email', tag: 'INPUT' }),
      });
      expect(actionDescription(ci)).toBe('Enter text in Email');
    });

    it('strips "Enter your" prefix from field labels', () => {
      const ci = makeInteraction('TextEntry', {
        target: makeElementIdentity({ accessibleName: 'Enter your mobile phone number', tag: 'INPUT' }),
        metadata: { textValue: '9894438714' },
      });
      expect(actionDescription(ci)).toBe('Enter mobile phone number "9894438714"');
    });

    it('strips "Please enter your" prefix from field labels', () => {
      const ci = makeInteraction('TextEntry', {
        target: makeElementIdentity({ accessibleName: 'Please enter your email address', tag: 'INPUT' }),
        metadata: { textValue: 'test@test.com' },
      });
      expect(actionDescription(ci)).toBe('Enter email address "test@test.com"');
    });

    it('strips "Type" prefix from field labels', () => {
      const ci = makeInteraction('TextEntry', {
        target: makeElementIdentity({ accessibleName: 'Type your password', tag: 'INPUT' }),
        metadata: { textValue: 'secret123' },
      });
      expect(actionDescription(ci)).toBe('Enter password "secret123"');
    });
  });

  describe('NativeDropdown / CustomDropdown', () => {
    it('renders "Select \"LEXUS\" from Make"', () => {
      const ci = makeInteraction('NativeDropdown', {
        target: makeElementIdentity({ accessibleName: 'Make', tag: 'SELECT' }),
        metadata: { selectedValue: 'LEXUS' },
      });
      expect(actionDescription(ci)).toBe('Select "LEXUS" from Make');
    });

    it('renders CustomDropdown the same way', () => {
      const ci = makeInteraction('CustomDropdown', {
        target: makeElementIdentity({ accessibleName: 'Country', ariaRole: 'combobox' }),
        metadata: { selectedValue: 'United States' },
      });
      expect(actionDescription(ci)).toBe('Select "United States" from Country');
    });

    it('renders just "Select \"value\"" when no field name', () => {
      const ci = makeInteraction('NativeDropdown', {
        target: makeElementIdentity({ accessibleName: '', tag: 'SELECT' }),
        metadata: { selectedValue: 'Option A' },
      });
      expect(actionDescription(ci)).toBe('Select "Option A"');
    });
  });

  describe('DatePicker', () => {
    it('renders "Select date \"August 15\" (Departure)"', () => {
      const ci = makeInteraction('DatePicker', {
        target: makeElementIdentity({ accessibleName: 'Departure', tag: 'INPUT' }),
        metadata: { dateValue: 'August 15' },
      });
      expect(actionDescription(ci)).toBe('Select date "August 15" (Departure)');
    });

    it('renders "Select date \"August 15\"" when no field name', () => {
      const ci = makeInteraction('DatePicker', {
        target: makeElementIdentity({ accessibleName: '', tag: 'INPUT' }),
        metadata: { dateValue: 'August 15' },
      });
      expect(actionDescription(ci)).toBe('Select date "August 15"');
    });

    it('strips date-format placeholder from field label', () => {
      const ci = makeInteraction('DatePicker', {
        target: makeElementIdentity({ accessibleName: 'yyyy-dd-mm', tag: 'INPUT' }),
        metadata: { dateValue: '2023-10-21' },
      });
      expect(actionDescription(ci)).toBe('Select date "2023-10-21"');
    });
  });

  describe('Checkbox', () => {
    it('renders "Check \"Enable notifications\"" when checked=true', () => {
      const ci = makeInteraction('Checkbox', {
        target: makeElementIdentity({ accessibleName: 'Enable notifications', tag: 'INPUT' }),
        metadata: { checked: true },
      });
      expect(actionDescription(ci)).toBe('Check "Enable notifications"');
    });

    it('renders "Uncheck \"Enable notifications\"" when checked=false', () => {
      const ci = makeInteraction('Checkbox', {
        target: makeElementIdentity({ accessibleName: 'Enable notifications', tag: 'INPUT' }),
        metadata: { checked: false },
      });
      expect(actionDescription(ci)).toBe('Uncheck "Enable notifications"');
    });
  });

  describe('RadioButton', () => {
    it('renders "Select \"Monthly\""', () => {
      const ci = makeInteraction('RadioButton', {
        target: makeElementIdentity({ accessibleName: 'Monthly', tag: 'INPUT' }),
        metadata: { checked: true },
      });
      expect(actionDescription(ci)).toBe('Select "Monthly"');
    });
  });

  describe('ToggleSwitch', () => {
    it('renders "Enable \"WiFi\"" when checked=true', () => {
      const ci = makeInteraction('ToggleSwitch', {
        target: makeElementIdentity({ accessibleName: 'WiFi', tag: 'SPAN' }),
        metadata: { checked: true },
      });
      expect(actionDescription(ci)).toBe('Enable "WiFi"');
    });

    it('renders "Disable \"WiFi\"" when checked=false', () => {
      const ci = makeInteraction('ToggleSwitch', {
        target: makeElementIdentity({ accessibleName: 'WiFi', tag: 'SPAN' }),
        metadata: { checked: false },
      });
      expect(actionDescription(ci)).toBe('Disable "WiFi"');
    });
  });

  describe('Hover', () => {
    it('renders "Hover over \"Service\""', () => {
      const ci = makeInteraction('Hover', {
        target: makeElementIdentity({ accessibleName: 'Service', tag: 'A' }),
      });
      expect(actionDescription(ci)).toBe('Hover over "Service"');
    });
  });

  describe('Click / Link', () => {
    it('renders "Click \"Submit\""', () => {
      const ci = makeInteraction('Click', {
        target: makeElementIdentity({ accessibleName: 'Submit', tag: 'BUTTON' }),
      });
      expect(actionDescription(ci)).toBe('Click "Submit"');
    });

    it('renders "Click \"About Us\"" for links (not "Click link")', () => {
      const ci = makeInteraction('Link', {
        target: makeElementIdentity({ accessibleName: 'About Us', tag: 'A' }),
      });
      expect(actionDescription(ci)).toBe('Click "About Us"');
    });
  });

  describe('PageNavigation', () => {
    it('renders "Navigate to example.com/path" without protocol or quotes', () => {
      const ci = makeInteraction('PageNavigation', {
        metadata: { url: 'https://www.avisford.com/service-appointment.aspx' },
      });
      expect(actionDescription(ci)).toBe('Navigate to www.avisford.com/service-appointment.aspx');
    });

    it('renders "Navigate to example.com" for root URL', () => {
      const ci = makeInteraction('PageNavigation', {
        metadata: { url: 'https://example.com' },
      });
      expect(actionDescription(ci)).toBe('Navigate to example.com/');
    });

    it('handles http protocol stripping', () => {
      const ci = makeInteraction('PageNavigation', {
        metadata: { url: 'http://localhost:3000/dashboard' },
      });
      expect(actionDescription(ci)).toBe('Navigate to localhost:3000/dashboard');
    });
  });

  describe('Scroll', () => {
    it('PageScroll includes position', () => {
      const ci = makeInteraction('PageScroll', {
        metadata: { scrollPosition: { x: 0, y: 500 } },
      });
      expect(actionDescription(ci)).toBe('Scroll page to (0, 500)');
    });
  });

  describe('DragDrop', () => {
    it('renders "Drag and drop \"Widget A\""', () => {
      const ci = makeInteraction('DragDrop', {
        target: makeElementIdentity({ accessibleName: 'Widget A', tag: 'DIV' }),
      });
      expect(actionDescription(ci)).toBe('Drag and drop "Widget A"');
    });
  });

  describe('FileUpload', () => {
    it('renders "Upload file \"Avatar\""', () => {
      const ci = makeInteraction('FileUpload', {
        target: makeElementIdentity({ accessibleName: 'Avatar', tag: 'INPUT' }),
      });
      expect(actionDescription(ci)).toBe('Upload file "Avatar"');
    });
  });

  describe('DoubleClick / RightClick', () => {
    it('renders "Double-click \"Row 1\""', () => {
      const ci = makeInteraction('DoubleClick', {
        target: makeElementIdentity({ accessibleName: 'Row 1', tag: 'TR' }),
      });
      expect(actionDescription(ci)).toBe('Double-click "Row 1"');
    });

    it('renders "Right-click \"Cell B2\""', () => {
      const ci = makeInteraction('RightClick', {
        target: makeElementIdentity({ accessibleName: 'Cell B2', tag: 'TD' }),
      });
      expect(actionDescription(ci)).toBe('Right-click "Cell B2"');
    });
  });
});

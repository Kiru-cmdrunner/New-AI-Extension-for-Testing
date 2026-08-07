/**
 * Action-Oriented Phrasing Tests
 *
 * Tests that createDetectedInteractionElement renders semantic descriptions
 * like "Enter mobile phone \"9894438714\"" instead of raw accessibleName.
 */

import { describe, it, expect } from 'vitest';
import { createDetectedInteractionElement } from '../src/sidepanel/timeline-renderer.js';
import type { DetectedInteraction } from '../src/shared/bridge-types';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const baseTarget: ElementIdentity = {
  accessibleName: '', ariaRole: '', ariaLabel: '', ariaLabelledBy: '',
  placeholder: '', tag: 'DIV', className: '', name: '', stableId: null,
  testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '',
  inIframe: false, shadowDom: false, elementId: 'el-0',
    href: null,
};

function makeInteraction(overrides: Partial<DetectedInteraction> = {}): DetectedInteraction {
  return {
    interactionId: 'int-001',
    type: 'Click',
    eventIds: ['evt-0001'],
    rawEventTypes: ['click'],
    target: baseTarget,
    metadata: {},
    confidence: 0.85,
    ...overrides,
  };
}

function getActionText(el: HTMLElement): string {
  const actionEl = el.querySelector('.interaction-action-text');
  return actionEl?.textContent || '';
}

function hasEngineBadge(el: HTMLElement): boolean {
  return !!el.querySelector('.interaction-engine-badge');
}

function getEngineBadgeText(el: HTMLElement): string {
  const badge = el.querySelector('.interaction-engine-badge');
  return badge?.textContent || '';
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Action-Oriented Interaction Phrasing', () => {

  describe('TextEntry', () => {
    it('renders "Enter Mobile phone \"9894438714\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'TextEntry',
        target: { ...baseTarget, accessibleName: 'Mobile phone', tag: 'INPUT' },
        metadata: { textValue: '9894438714' },
      }));
      expect(getActionText(el)).toBe('Enter Mobile phone "9894438714"');
    });

    it('renders "Enter text in Email" when no value', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'TextEntry',
        target: { ...baseTarget, accessibleName: 'Email', tag: 'INPUT' },
      }));
      expect(getActionText(el)).toBe('Enter text in Email');
    });

    it('strips "Enter your" prefix from field labels', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'TextEntry',
        target: { ...baseTarget, accessibleName: 'Enter your mobile phone number', tag: 'INPUT' },
        metadata: { textValue: '9894438714' },
      }));
      expect(getActionText(el)).toBe('Enter mobile phone number "9894438714"');
    });

    it('strips "Please enter your" prefix from field labels', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'TextEntry',
        target: { ...baseTarget, accessibleName: 'Please enter your email address', tag: 'INPUT' },
        metadata: { textValue: 'test@test.com' },
      }));
      expect(getActionText(el)).toBe('Enter email address "test@test.com"');
    });

    it('strips "Type" prefix from field labels', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'TextEntry',
        target: { ...baseTarget, accessibleName: 'Type your password', tag: 'INPUT' },
        metadata: { textValue: 'secret123' },
      }));
      expect(getActionText(el)).toBe('Enter password "secret123"');
    });
  });

  describe('NativeDropdown / CustomDropdown', () => {
    it('renders "Select \"LEXUS\" from Make"', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'NativeDropdown',
        target: { ...baseTarget, accessibleName: 'Make', tag: 'SELECT' },
        metadata: { selectedValue: 'LEXUS' },
      }));
      expect(getActionText(el)).toBe('Select "LEXUS" from Make');
    });

    it('renders CustomDropdown the same way', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'CustomDropdown',
        target: { ...baseTarget, accessibleName: 'Country', ariaRole: 'combobox' },
        metadata: { selectedValue: 'United States' },
      }));
      expect(getActionText(el)).toBe('Select "United States" from Country');
    });

    it('renders just "Select \"value\"" when no field name', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'NativeDropdown',
        target: { ...baseTarget, accessibleName: '', tag: 'SELECT' },
        metadata: { selectedValue: 'Option A' },
      }));
      expect(getActionText(el)).toBe('Select "Option A"');
    });
  });

  describe('DatePicker', () => {
    it('renders "Select date \"August 15\" (Departure)"', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'DatePicker',
        target: { ...baseTarget, accessibleName: 'Departure', tag: 'INPUT' },
        metadata: { dateValue: 'August 15' },
      }));
      expect(getActionText(el)).toBe('Select date "August 15" (Departure)');
    });

    it('renders "Select date \"August 15\"" when no field name', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'DatePicker',
        target: { ...baseTarget, accessibleName: '', tag: 'INPUT' },
        metadata: { dateValue: 'August 15' },
      }));
      expect(getActionText(el)).toBe('Select date "August 15"');
    });
  });

  describe('Checkbox', () => {
    it('renders "Check \"Enable notifications\"" when checked=true', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'Checkbox',
        target: { ...baseTarget, accessibleName: 'Enable notifications', tag: 'INPUT' },
        metadata: { checked: true },
      }));
      expect(getActionText(el)).toBe('Check "Enable notifications"');
    });

    it('renders "Uncheck \"Enable notifications\"" when checked=false', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'Checkbox',
        target: { ...baseTarget, accessibleName: 'Enable notifications', tag: 'INPUT' },
        metadata: { checked: false },
      }));
      expect(getActionText(el)).toBe('Uncheck "Enable notifications"');
    });
  });

  describe('RadioButton', () => {
    it('renders "Select \"Monthly\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'RadioButton',
        target: { ...baseTarget, accessibleName: 'Monthly', tag: 'INPUT' },
        metadata: { checked: true },
      }));
      expect(getActionText(el)).toBe('Select "Monthly"');
    });
  });

  describe('ToggleSwitch', () => {
    it('renders "Enable \"WiFi\"" when checked=true', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'ToggleSwitch',
        target: { ...baseTarget, accessibleName: 'WiFi', tag: 'SPAN' },
        metadata: { checked: true },
      }));
      expect(getActionText(el)).toBe('Enable "WiFi"');
    });

    it('renders "Disable \"WiFi\"" when checked=false', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'ToggleSwitch',
        target: { ...baseTarget, accessibleName: 'WiFi', tag: 'SPAN' },
        metadata: { checked: false },
      }));
      expect(getActionText(el)).toBe('Disable "WiFi"');
    });
  });

  describe('Hover', () => {
    it('renders "Hover over \"Service\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'Hover',
        target: { ...baseTarget, accessibleName: 'Service', tag: 'A' },
      }));
      expect(getActionText(el)).toBe('Hover over "Service"');
    });
  });

  describe('Click / Link', () => {
    it('renders "Click \"Submit\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'Click',
        target: { ...baseTarget, accessibleName: 'Submit', tag: 'BUTTON' },
      }));
      expect(getActionText(el)).toBe('Click "Submit"');
    });

    it('renders "Click \"About Us\"" for links (not "Click link")', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'Link',
        target: { ...baseTarget, accessibleName: 'About Us', tag: 'A' },
      }));
      expect(getActionText(el)).toBe('Click "About Us"');
    });
  });

  describe('PageNavigation', () => {
    it('renders "Navigate to example.com/path" without protocol or quotes', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'PageNavigation',
        metadata: { url: 'https://www.avisford.com/service-appointment.aspx' },
      }));
      expect(getActionText(el)).toBe('Navigate to www.avisford.com/service-appointment.aspx');
    });

    it('renders "Navigate to example.com" for root URL', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'PageNavigation',
        metadata: { url: 'https://example.com' },
      }));
      expect(getActionText(el)).toBe('Navigate to example.com/');
    });

    it('handles http protocol stripping', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'PageNavigation',
        metadata: { url: 'http://localhost:3000/dashboard' },
      }));
      expect(getActionText(el)).toBe('Navigate to localhost:3000/dashboard');
    });
  });

  describe('Scroll', () => {
    it('PageScroll includes position', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'PageScroll',
        metadata: { scrollPosition: { x: 0, y: 500 } },
      }));
      expect(getActionText(el)).toBe('Scroll page to (0, 500)');
    });
  });

  describe('DragDrop', () => {
    it('renders "Drag and drop \"Widget A\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'DragDrop',
        target: { ...baseTarget, accessibleName: 'Widget A', tag: 'DIV' },
      }));
      expect(getActionText(el)).toBe('Drag and drop "Widget A"');
    });
  });

  describe('FileUpload', () => {
    it('renders "Upload file \"Avatar\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'FileUpload',
        target: { ...baseTarget, accessibleName: 'Avatar', tag: 'INPUT' },
      }));
      expect(getActionText(el)).toBe('Upload file "Avatar"');
    });
  });

  describe('DoubleClick / RightClick', () => {
    it('renders "Double-click \"Row 1\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'DoubleClick',
        target: { ...baseTarget, accessibleName: 'Row 1', tag: 'TR' },
      }));
      expect(getActionText(el)).toBe('Double-click "Row 1"');
    });

    it('renders "Right-click \"Cell B2\""', () => {
      const el = createDetectedInteractionElement(makeInteraction({
        type: 'RightClick',
        target: { ...baseTarget, accessibleName: 'Cell B2', tag: 'TD' },
      }));
      expect(getActionText(el)).toBe('Right-click "Cell B2"');
    });
  });
});

describe('Engine Badge Rendering', () => {

  it('shows V2 badge for engine="v2"', () => {
    const el = createDetectedInteractionElement(makeInteraction({
      engine: 'v2',
    }));
    expect(hasEngineBadge(el)).toBe(true);
    expect(getEngineBadgeText(el)).toBe('V2');
  });

  it('shows V1 badge for engine="v1-fallback"', () => {
    const el = createDetectedInteractionElement(makeInteraction({
      engine: 'v1-fallback',
    }));
    expect(hasEngineBadge(el)).toBe(true);
    expect(getEngineBadgeText(el)).toBe('V1');
  });

  it('does not show engine badge when engine is undefined', () => {
    const el = createDetectedInteractionElement(makeInteraction({
      engine: undefined,
    }));
    expect(hasEngineBadge(el)).toBe(false);
  });
});

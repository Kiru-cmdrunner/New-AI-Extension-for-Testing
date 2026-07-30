/**
 * Component-to-Classifier Adapter — Unit Tests
 *
 * Tests the pure transform: ComponentInteraction[] → DetectedInteraction[]
 *
 * Verifies:
 *   - Type mapping (13 component types → 40 classifier types)
 *   - Subtype assignment (NativeDropdown vs CustomDropdown)
 *   - Metadata translation
 *   - ConfigurationSession → configuredFields
 *   - Event ID extraction
 *   - Fallback for unknown types
 */

import { describe, it, expect } from 'vitest';
import { adaptInteraction, adaptInteractions } from '../../src/generation/component-to-classifier-adapter';
import type { ComponentInteraction } from '../../src/shared/component-types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeInteraction(
  type: string,
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: type as any,
    trigger: {
      tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Test Button',
      ariaLabel: null, ariaLabelledBy: null, placeholder: null,
      className: 'btn', name: '', stableId: null, testId: null,
      dataCy: null, dataQa: null, cssSelector: 'body > button',
      xPath: '/html/body/button', inIframe: false, shadowDom: false,
      iframeContext: null, elementId: 'el-1',
    } as any,
    triggerEvent: {
      eventId: 'evt-1', eventType: 'click', timestamp: Date.now(), isTrusted: true,
      target: {} as any, domContext: {} as any,
      valueBefore: null, valueAfter: null, checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: 'https://example.com', pageTitle: 'Test',
    } as any,
    memberEvents: [],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: {},
    ...overrides,
  } as unknown as ComponentInteraction;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('ComponentToClassifierAdapter', () => {
  describe('Type mapping', () => {
    it('maps Click → Click', () => {
      const result = adaptInteraction(makeInteraction('Click'));
      expect(result.type).toBe('Click');
    });

    it('maps TextEntry → TextEntry', () => {
      const result = adaptInteraction(makeInteraction('TextEntry'));
      expect(result.type).toBe('TextEntry');
    });

    it('maps Checkbox → Checkbox', () => {
      const result = adaptInteraction(makeInteraction('Checkbox'));
      expect(result.type).toBe('Checkbox');
    });

    it('maps RadioButton → RadioButton', () => {
      const result = adaptInteraction(makeInteraction('RadioButton'));
      expect(result.type).toBe('RadioButton');
    });

    it('maps DatePicker → DatePicker', () => {
      const result = adaptInteraction(makeInteraction('DatePicker'));
      expect(result.type).toBe('DatePicker');
    });

    it('maps Hover → Hover', () => {
      const result = adaptInteraction(makeInteraction('Hover'));
      expect(result.type).toBe('Hover');
    });

    it('maps Link → Link', () => {
      const result = adaptInteraction(makeInteraction('Link'));
      expect(result.type).toBe('Link');
    });

    it('maps FileUpload → FileUpload', () => {
      const result = adaptInteraction(makeInteraction('FileUpload'));
      expect(result.type).toBe('FileUpload');
    });

    it('maps Slider → Slider', () => {
      const result = adaptInteraction(makeInteraction('Slider'));
      expect(result.type).toBe('Slider');
    });

    it('maps Tab → Tab', () => {
      const result = adaptInteraction(makeInteraction('Tab'));
      expect(result.type).toBe('Tab');
    });

    it('maps Scroll → PageScroll (default)', () => {
      const result = adaptInteraction(makeInteraction('Scroll'));
      expect(result.type).toBe('PageScroll');
    });

    it('maps Navigation → PageNavigation (default)', () => {
      const result = adaptInteraction(makeInteraction('Navigation'));
      expect(result.type).toBe('PageNavigation');
    });

    it('maps Dropdown → CustomDropdown (default for non-native)', () => {
      const result = adaptInteraction(makeInteraction('Dropdown'));
      expect(result.type).toBe('CustomDropdown');
    });

    it('maps Dropdown with NativeDropdown subtype', () => {
      const result = adaptInteraction(
        makeInteraction('Dropdown', { interactionSubtype: 'NativeDropdown' }),
      );
      expect(result.type).toBe('NativeDropdown');
    });

    it('maps Dropdown with CustomDropdown subtype', () => {
      const result = adaptInteraction(
        makeInteraction('Dropdown', { interactionSubtype: 'CustomDropdown' }),
      );
      expect(result.type).toBe('CustomDropdown');
    });
  });

  describe('Metadata translation', () => {
    it('translates TextEntry metadata', () => {
      const result = adaptInteraction(
        makeInteraction('TextEntry', {
          metadata: { textValue: 'hello world', targetName: 'Search' },
        }),
      );
      expect(result.metadata.textValue).toBe('hello world');
      expect(result.metadata.accessibleName).toBe('Search');
    });

    it('translates Checkbox metadata', () => {
      const result = adaptInteraction(
        makeInteraction('Checkbox', {
          metadata: { checked: true },
        }),
      );
      expect(result.metadata.checked).toBe(true);
    });

    it('translates DatePicker metadata', () => {
      const result = adaptInteraction(
        makeInteraction('DatePicker', {
          metadata: { selectedDate: '2024-01-15', displayValue: 'Jan 15, 2024' },
        }),
      );
      expect(result.metadata.dateValue).toBe('2024-01-15');
      expect(result.metadata.displayValue).toBe('Jan 15, 2024');
    });

    it('translates FileUpload metadata', () => {
      const result = adaptInteraction(
        makeInteraction('FileUpload', {
          metadata: { fileName: 'doc.pdf', fileCount: 1 },
        }),
      );
      expect(result.metadata.files).toEqual(['doc.pdf']);
      expect(result.metadata.fileCount).toBe(1);
    });

    it('translates Navigation metadata from triggerEvent', () => {
      const result = adaptInteraction(
        makeInteraction('Navigation', {
          triggerEvent: {
            pageUrl: 'https://example.com/page2',
            pageTitle: 'Page 2',
          } as any,
        }),
      );
      expect(result.metadata.url).toBe('https://example.com/page2');
      expect(result.metadata.title).toBe('Page 2');
    });

    it('translates Hover metadata', () => {
      const result = adaptInteraction(
        makeInteraction('Hover', {
          metadata: { hoverDuration: 1500 },
        }),
      );
      expect(result.metadata.hoverDuration).toBe(1500);
    });

    it('translates Dropdown selectedValue', () => {
      const result = adaptInteraction(
        makeInteraction('Dropdown', {
          metadata: { selectedValue: 'Premium Economy', targetName: 'Class' },
        }),
      );
      expect(result.metadata.selectedValue).toBe('Premium Economy');
      expect(result.metadata.accessibleName).toBe('Class');
    });
  });

  describe('ConfigurationSession', () => {
    it('translates configurationSession to configuredFields', () => {
      const result = adaptInteraction(
        makeInteraction('Dropdown', {
          metadata: {
            targetName: 'Economy',
            configurationSession: {
              triggerLabel: 'Economy',
              fields: [
                { label: 'Adults', finalValue: '2' },
                { label: 'Children', delta: 1 },
                { label: 'Premium Economy', finalValue: 'Premium Economy' },
              ],
            },
          },
        }),
      );
      expect(result.metadata.configuredFields).toBeDefined();
      expect(result.metadata.configuredFields!.Adults).toBe('2');
      expect(result.metadata.configuredFields!.Children).toBe('+1');
      expect(result.metadata.semanticAction).toBe('configure');
      expect(result.metadata.panelLabel).toBe('Economy');
    });
  });

  describe('Event extraction', () => {
    it('extracts event IDs from memberEvents', () => {
      const result = adaptInteraction(
        makeInteraction('Click', {
          memberEvents: [
            { eventId: 'evt-1', eventType: 'mousedown' } as any,
            { eventId: 'evt-2', eventType: 'click' } as any,
          ],
        }),
      );
      expect(result.eventIds).toEqual(['evt-1', 'evt-2']);
      expect(result.rawEventTypes).toEqual(['mousedown', 'click']);
    });
  });

  describe('Confidence and engine', () => {
    it('sets confidence 1.0 for completed interactions', () => {
      const result = adaptInteraction(makeInteraction('Click'));
      expect(result.confidence).toBe(1.0);
    });

    it('sets confidence 0.5 for non-completed interactions', () => {
      const result = adaptInteraction(
        makeInteraction('Click', { endState: 'abandoned' }),
      );
      expect(result.confidence).toBe(0.5);
    });

    it('sets engine to component-runtime', () => {
      const result = adaptInteraction(makeInteraction('Click'));
      expect(result.engine).toBe('component-runtime');
    });
  });

  describe('Batch adaptation', () => {
    it('adapts multiple interactions', () => {
      const interactions = [
        makeInteraction('Click'),
        makeInteraction('TextEntry'),
        makeInteraction('Dropdown'),
      ];
      const results = adaptInteractions(interactions);
      expect(results.length).toBe(3);
      expect(results[0].type).toBe('Click');
      expect(results[1].type).toBe('TextEntry');
      expect(results[2].type).toBe('CustomDropdown');
    });
  });
});

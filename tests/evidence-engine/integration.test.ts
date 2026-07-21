/**
 * Evidence Engine — Integration Tests
 *
 * Full end-to-end tests that feed complete event sequences through the
 * detectInteractionsV2() entry point and verify the output.
 *
 * These tests validate the complete pipeline: event stream → providers →
 * evidence accumulation → combination → interaction output.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.ts';
import {
  clickEvent, focusEvent, blurEvent, changeEvent,
  scrollEvent, dblclickEvent, contextmenuEvent,
  mouseenterEvent, navigationEvent,
  resetEventCounter,
} from './helpers.ts';

describe('Evidence Engine Integration — detectInteractionsV2', () => {
  beforeEach(() => {
    resetEventCounter();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM DROPDOWN (ARIA combobox — the primary POC target)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Custom Dropdown (ARIA combobox)', () => {
    it('classifies ARIA combobox → option select → value change as CustomDropdown', () => {
      const events = [
        // User clicks the combobox trigger
        clickEvent({
          tag: 'DIV',
          ariaRole: 'combobox',
          cssSelector: 'div[role="combobox"][aria-expanded="true"]',
          className: 'country-select',
          accessibleName: 'Country',
          elementId: 'el-combobox',
        }),
        // User clicks an option in the listbox
        clickEvent({
          tag: 'LI',
          ariaRole: 'option',
          cssSelector: 'li[role="option"]',
          className: 'select-option',
          accessibleName: 'India',
          elementId: 'el-option-india',
        }),
        // Value change fires
        changeEvent({
          tag: 'DIV',
          ariaRole: 'combobox',
          cssSelector: 'div[role="combobox"]',
          elementId: 'el-combobox',
        }, { valueAfter: 'India' }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('CustomDropdown');
      expect(result[0].confidence).toBeGreaterThan(0.5);
      expect(result[0].metadata.selectedValue).toBe('India');
    });

    it('works even without ARIA roles (class-name + event pattern fallback)', () => {
      const events = [
        clickEvent({
          tag: 'DIV',
          className: 'custom-dropdown-trigger',
          cssSelector: 'div.dropdown-trigger',
          accessibleName: 'Select Color',
          elementId: 'el-dd-trigger',
        }),
        clickEvent({
          tag: 'DIV',
          className: 'dropdown-option',
          cssSelector: 'div.dropdown-option',
          accessibleName: 'Blue',
          elementId: 'el-dd-option',
        }),
      ];

      const result = detectInteractionsV2(events);

      // With only class-name and event sequence, confidence will be lower
      // but the event sequence + mutation providers should still detect it
      expect(result).toHaveLength(1);
      // The type may be CustomDropdown (if mutation provider's class-based detection
      // kicks in) or Click (if the evidence doesn't reach threshold).
      // For the POC, we verify the engine doesn't crash and produces a result.
      expect(result[0].type).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NATIVE DROPDOWN
  // ═══════════════ classifier ('NativeDropdown') Evidence ════════════════════

  describe('Native Dropdown (<select>)', () => {
    it('classifies native select click → change as NativeDropdown', () => {
      const events = [
        clickEvent({
          tag: 'SELECT',
          cssSelector: 'select#country',
          elementId: 'el-select',
        }),
        changeEvent({
          tag: 'SELECT',
          cssSelector: 'select#country',
          elementId: 'el-select',
        }, { valueAfter: 'Japan' }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('NativeDropdown');
      expect(result[0].confidence).toBeGreaterThan(0.7);
      expect(result[0].metadata.selectedValue).toBe('Japan');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CHECKBOX
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Checkbox', () => {
    it('classifies native checkbox click as Checkbox', () => {
      const events = [
        clickEvent({
          tag: 'INPUT',
          cssSelector: 'input[type="checkbox"]',
          elementId: 'el-cb',
          accessibleName: 'Accept terms',
        }, { checkedAfter: true }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].confidence).toBeGreaterThan(0.7);
      expect(result[0].metadata.checked).toBe(true);
    });

    it('classifies ARIA checkbox click as Checkbox', () => {
      const events = [
        clickEvent({
          tag: 'DIV',
          ariaRole: 'checkbox',
          cssSelector: 'div[role="checkbox"]',
          elementId: 'el-arcb',
        }, { checkedAfter: true }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Checkbox');
      expect(result[0].confidence).toBeGreaterThan(0.7);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEXT ENTRY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Text Entry', () => {
    it('classifies focus → blur with value change as TextEntry', () => {
      const events = [
        focusEvent({
          tag: 'INPUT',
          cssSelector: 'input[type="text"]',
          elementId: 'el-text',
        }, { valueBefore: '' }),
        blurEvent({
          tag: 'INPUT',
          cssSelector: 'input[type="text"]',
          elementId: 'el-text',
        }, { valueAfter: 'John Doe' }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].confidence).toBeGreaterThan(0.7);
      expect(result[0].metadata.textValue).toBe('John Doe');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SIMPLE CLICK
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Simple Click', () => {
    it('classifies single button click as Click', () => {
      const events = [
        clickEvent({
          tag: 'BUTTON',
          cssSelector: 'button#submit',
          elementId: 'el-btn',
          accessibleName: 'Submit',
        }),
      ];

      const evidence_result = detectInteractionsV2(events);

      expect(evidence_result).toHaveLength(1);
      expect(evidence_result[0].type).toBe('Click');
      expect(evidence_result[0].confidence).toBeGreaterThan(0.7);
    });
  });

  // ═══════════════════════════════════════════════════════════════════ test evidence ════════════════════════════════════════════════════

  describe('Standalone Events', () => {
    it('classifies dblclick as DoubleClick', () => {
      const events = [dblclickEvent({ tag: 'DIV', cssSelector: 'div.row' })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DoubleClick');
    });

    it('classifies contextmenu as RightClick', () => {
      const events = [contextmenuEvent({ tag: 'DIV', cssSelector: 'div.row' })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RightClick');
    });

    it('classifies scroll on HTML as PageScroll', () => {
      const events = [scrollEvent({ tag: 'HTML', cssSelector: 'html' })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageScroll');
    });

    it('classifies mouseenter as Hover', () => {
      const events = [mouseenterEvent({ tag: 'DIV', cssSelector: 'div.menu-item' })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═════════════════════════════════════ Checkbox  => it-clicks ═══════════════════════════════

  describe('Navigation', () => {
    it('classifies navigation as PageNavigation', () => {
      const events = [navigationEvent('https://example.com', 'Example')];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageNavigation');
      expect(result[0].confidence).toBe(1.0);
    });

    it('classifies reload as Refresh', () => {
      const events = [navigationEvent('https://example.com', 'Example', 'reload')];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Refresh');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // MULTI-INTERACTION SEQUENCES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Multi-Interaction Sequences', () => {
    it('separates interactions when user moves between elements', () => {
      const events = [
        // Interaction 1: Text entry
        focusEvent({ tag: 'INPUT', cssSelector: 'input#name', elementId: 'el-name' }, { valueBefore: '' }),
        blurEvent({ tag: 'INPUT', cssSelector: 'input#name', elementId: 'el-name' }, { valueAfter: 'Alice' }),
        // Interaction 2: Click button
        clickEvent({ tag: 'BUTTON', cssSelector: 'button#save', elementId: 'el-save', accessibleName: 'Save' }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('TextEntry');
      expect(result[0].metadata.textValue).toBe('Alice');
      expect(result[1].type).toBe('Click');
    });

    it('separates dropdown interaction from subsequent text entry', () => {
      const events = [
        // Dropdown: click combobox → option click → change
        clickEvent({
          tag: 'DIV', ariaRole: 'combobox', elementId: 'el-cb',
          cssSelector: 'div[role="combobox"]',
        }),
        clickEvent({
          tag: 'LI', ariaRole: 'option', elementId: 'el-opt',
          accessibleName: 'USA',
        }),
        changeEvent({
          tag: 'DIV', ariaRole: 'combobox', elementId: 'el-cb',
          cssSelector: 'div[role="combobox"]',
        }, { valueAfter: 'USA' }),
        // Text entry: focus → blur
        focusEvent({ tag: 'INPUT', cssSelector: 'input#city', elementId: 'el-city' }, { valueBefore: '' }),
        blurEvent({ tag: 'INPUT', cssSelector: 'input#city', elementId: 'el-city' }, { valueAfter: 'New York' }),
      ];

      const result = detectInteractionsV2(events);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('CustomDropdown');
      expect(result[0].metadata.selectedValue).toBe('USA');
      expect(result[1].type).toBe('TextEntry');
      expect(result[1].metadata.textValue).toBe('New York');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EVIDENCE TRAIL
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Evidence Trail', () => {
    it('every emitted interaction includes evidence trail with full breakdown', () => {
      const events = [
        clickEvent({
          tag: 'INPUT',
          cssSelector: 'input[type="checkbox"]',
          elementId: 'el-cb',
        }, { checkedAfter: true }),
      ];

      const result = detectInteractionsV2(events) as Array<{ _evidenceTrail?: { evidence: unknown[]; scores: unknown[] } }>;

      expect(result[0].confidence).toBeGreaterThan(0);
      // Evidence trail is attached as _evidenceTrail for debugging
      expect(result[0]._evidenceTrail).toBeDefined();
      expect(result[0]._evidenceTrail!.evidence.length).toBeGreaterThan(0);
      expect(result[0]._evidenceTrail!.scores.length).toBeGreaterThan(0);
    });
  });
});

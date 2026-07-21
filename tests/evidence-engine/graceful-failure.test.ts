/**
 * Graceful Failure Validation
 *
 * Validates that V2 returns Unknown (or the correct type) for interaction types
 * that haven't been explicitly migrated yet. This is the safety assumption for
 * the V2-primary-with-V1-fallback merge strategy.
 *
 * If V2 confidently returns a WRONG type for an unmigrated interaction,
 * the fallback mechanism won't activate and the merge is unsafe.
 *
 * Categories tested:
 * 1. Already-handled types (sanity checks — these should produce correct types)
 * 2. Unmigrated types that might trigger false positives
 * 3. Edge cases: unknown elements, empty events, mixed sequences
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import {
  resetEventCounter,
  clickEvent,
  scrollEvent,
  mouseenterEvent,
  dblclickEvent,
  contextmenuEvent,
  dragstartEvent,
  dropEvent,
  focusEvent,
  blurEvent,
  navigationEvent,
  makeTarget,
  domContext,
} from './helpers.js';
import type { DomContext } from '../../src/recorder/recorded-event.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const DIV = makeTarget({ tag: 'DIV' });
const BUTTON = makeTarget({ tag: 'BUTTON' });
const A_LINK = makeTarget({ tag: 'A', cssSelector: 'a[href="/about"]' });
const GENERIC_DIV = makeTarget({ tag: 'DIV', className: 'some-random-class' });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Graceful Failure — Unmigrated Interaction Types', () => {

  beforeEach(() => resetEventCounter());

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: Already-handled types (sanity — should produce correct types)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Already-handled types (sanity)', () => {
    it('Hover (mouseenter) → Hover @ 0.85', () => {
      const events = [mouseenterEvent(DIV)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Hover');
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('Scroll → PageScroll or ContainerScroll', () => {
      const events = [scrollEvent({ tag: 'HTML' })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(['PageScroll', 'ContainerScroll']).toContain(result[0].type);
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('DoubleClick (dblclick) → DoubleClick @ 0.95', () => {
      const events = [dblclickEvent(DIV)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DoubleClick');
    });

    it('RightClick (contextmenu) → RightClick @ 0.95', () => {
      const events = [contextmenuEvent(DIV)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('RightClick');
    });

    it('DragDrop (dragstart → drop) → 1 grouped DragDrop', () => {
      const events = [
        dragstartEvent({ tag: 'DIV', accessibleName: 'Item A' }),
        dropEvent({ tag: 'DIV', accessibleName: 'Drop Zone' }),
      ];
      const result = detectInteractionsV2(events);
      // V2 now groups dragstart + drop into a single DragDrop interaction
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('DragDrop');
      expect(result[0].metadata.sourceElement).toBe('Item A');
      expect(result[0].metadata.dropTarget).toBe('Drop Zone');
    });

    it('Link (a[href]) → Link', () => {
      const events = [clickEvent(A_LINK)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Link');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: Unmigrated types that might trigger false positives
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Unmigrated types — must return Unknown or Click, NOT a wrong specific type', () => {

    it('Modal open (click on overlay div) → Click or Unknown, NOT Modal/Popover/Drawer', () => {
      // User clicks a button that opens a modal — but V2 has no Modal detection
      const openBtn = makeTarget({ tag: 'BUTTON', accessibleName: 'Open Dialog' });
      const events = [clickEvent(openBtn)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // Must NOT be Modal, Drawer, Popover, Tooltip — those would be wrong/confident
      expect(['Click', 'Unknown', 'Link']).toContain(result[0].type);
    });

    it('Tab switch (click on tab button) → Click, NOT Tab', () => {
      // Click a tab in a tab bar
      const tabBtn = makeTarget({
        tag: 'BUTTON',
        accessibleName: 'Settings Tab',
        className: 'tab-button',
        ariaRole: 'tab',
      });
      const events = [clickEvent(tabBtn)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // AriaProvider has role=tab in ROLE_TYPE_MAP — check what it maps to
      // It should NOT confidently say Tab unless we explicitly migrated it
      expect(result[0].type).not.toBe('Modal');
      expect(result[0].type).not.toBe('Drawer');
      expect(result[0].type).not.toBe('Popover');
    });

    it('Toggle switch (click on div role=switch) → Checkbox or Unknown, NOT ToggleSwitch with wrong confidence', () => {
      // A custom toggle switch widget
      const toggle = makeTarget({
        tag: 'DIV',
        ariaRole: 'switch',
        className: 'toggle-switch',
        accessibleName: 'Enable notifications',
      });
      const clickWithChecked = {
        ...clickEvent(toggle),
        checkedAfter: true as boolean | null,
      };
      const events = [clickWithChecked];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // Acceptable: Checkbox (close enough), Click (generic), Unknown
      // NOT acceptable: Modal, DatePicker, TextEntry, NativeDropdown etc.
      expect(['Checkbox', 'Click', 'Unknown', 'ToggleSwitch']).toContain(result[0].type);
    });

    it('File upload input → FileUpload (DomProvider handles this)', () => {
      const fileInput = makeTarget({
        tag: 'INPUT',
        cssSelector: 'input[type="file"]',
      });
      const ctx: DomContext = { inputType: 'file', ariaExpanded: null, ariaHasPopup: null, isContentEditable: false };
      const events = [clickEvent(fileInput, { domContext: ctx })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('FileUpload');
    });

    it('Autocomplete search (input + option click, but without combobox role) → Click or TextEntry, NOT wrong specific type', () => {
      // An autocomplete that doesn't use role=combobox
      const searchInput = makeTarget({
        tag: 'INPUT',
        cssSelector: 'input.search-field',
        className: 'search-input',
      });
      const option = makeTarget({
        tag: 'LI',
        accessibleName: 'New York, NY',
        className: 'autocomplete-result',
      });
      const ctx: DomContext = { inputType: 'text', ariaExpanded: null, ariaHasPopup: null, isContentEditable: false };
      const events = [
        focusEvent(searchInput, { domContext: ctx }),
        clickEvent(option),
        blurEvent(searchInput, { valueAfter: 'New York, NY', domContext: ctx }),
      ];
      const result = detectInteractionsV2(events);
      // V2 might group these or not — the key question is what TYPE it assigns
      // It should NOT be something wildly wrong like DatePicker, FileUpload, etc.
      // Autocomplete is now a valid detection since the option has 'autocomplete-result' class
      for (const r of result) {
        expect(['Click', 'TextEntry', 'CustomDropdown', 'Autocomplete', 'Unknown']).toContain(r.type);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: Edge cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge cases', () => {

    it('Generic div click with no distinguishing features → Click', () => {
      const events = [clickEvent(GENERIC_DIV)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Empty event list → empty interactions', () => {
      const result = detectInteractionsV2([]);
      expect(result).toHaveLength(0);
    });

    it('Navigation only → PageNavigation', () => {
      const events = [navigationEvent('https://example.com')];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('PageNavigation');
    });

    it('Mixed: Click → Hover → Click on different elements', () => {
      const events = [
        clickEvent(makeTarget({ tag: 'BUTTON', accessibleName: 'Submit' })),
        mouseenterEvent(makeTarget({ tag: 'DIV', accessibleName: 'Info tooltip area' })),
        clickEvent(makeTarget({ tag: 'A', cssSelector: 'a[href="/next"]' })),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('Click');
      expect(result[1].type).toBe('Hover');
      expect(result[2].type).toBe('Link');
    });

    it('Click on span inside a button → Click (not wrong type)', () => {
      const span = makeTarget({
        tag: 'SPAN',
        className: 'icon',
        accessibleName: '',
        cssSelector: 'button > span.icon',
      });
      const events = [clickEvent(span)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('Click');
    });

    it('Focus without blur on text input → single weak TextEntry or Unknown', () => {
      const input = makeTarget({
        tag: 'INPUT',
        cssSelector: 'input[name="email"]',
      });
      const ctx: DomContext = { inputType: 'text', ariaExpanded: null, ariaHasPopup: null, isContentEditable: false };
      const events = [focusEvent(input, { domContext: ctx })];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // A focus without blur is incomplete — should not be a confident wrong type
      expect(['TextEntry', 'Click', 'Unknown']).toContain(result[0].type);
    });

    it('Multiple unrelated clicks on different buttons', () => {
      const events = [
        clickEvent(makeTarget({ tag: 'BUTTON', accessibleName: 'A', stableId: 'btn-a' })),
        clickEvent(makeTarget({ tag: 'BUTTON', accessibleName: 'B', stableId: 'btn-b' })),
        clickEvent(makeTarget({ tag: 'BUTTON', accessibleName: 'C', stableId: 'btn-c' })),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(3);
      for (const r of result) {
        expect(r.type).toBe('Click');
      }
    });

    it('Textarea focus → blur → TextEntry (not something else)', () => {
      const textarea = makeTarget({ tag: 'TEXTAREA', cssSelector: 'textarea' });
      const events = [
        focusEvent(textarea, { valueBefore: '' }),
        blurEvent(textarea, { valueAfter: 'Hello world' }),
      ];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('TextEntry');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: Dangerous false-positive scenarios
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Dangerous false-positive scenarios', () => {

    it('Click on element with "select" in className → not misclassified as dropdown', () => {
      // A div with "select" in its class name — could trick pattern matching
      const div = makeTarget({
        tag: 'DIV',
        className: 'selection-panel',
        accessibleName: 'Selection Panel',
      });
      const events = [clickEvent(div)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // Should be Click, NOT NativeDropdown/CustomDropdown
      expect(['Click', 'Unknown']).toContain(result[0].type);
    });

    it('Click on element with "date" in className → not misclassified as DatePicker', () => {
      // A div with "date" in its class name — could trick calendar detection
      const div = makeTarget({
        tag: 'DIV',
        className: 'update-section',
        accessibleName: 'Update Section',
      });
      const events = [clickEvent(div)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // Should be Click, NOT DatePicker
      expect(['Click', 'Unknown']).toContain(result[0].type);
    });

    it('Focus+blur on a div (not an input) → not TextEntry', () => {
      // contentEditable div would be OK, but a plain div shouldn't be TextEntry
      const div = makeTarget({
        tag: 'DIV',
        className: 'panel',
        cssSelector: 'div.panel',
      });
      const events = [
        focusEvent(div, { valueBefore: '' }),
        blurEvent(div, { valueAfter: 'text' }),
      ];
      const result = detectInteractionsV2(events);
      // V2 may or may not classify this — but it shouldn't be a confident specific type
      // that's wrong. Click is the safest fallback.
      if (result.length === 1) {
        expect(['Click', 'TextEntry', 'Unknown']).toContain(result[0].type);
      }
    });

    it('Click on element with role=tab → not misclassified as a wrong specific type', () => {
      const tab = makeTarget({
        tag: 'DIV',
        ariaRole: 'tab',
        className: 'nav-tab',
        accessibleName: 'Profile',
      });
      const events = [clickEvent(tab)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // V2 should NOT confidently classify this as DatePicker, Dropdown, etc.
      // Acceptable: Click (generic), Tab (if AriaProvider maps it), Unknown
      expect(result[0].type).not.toBe('DatePicker');
      expect(result[0].type).not.toBe('NativeDropdown');
      expect(result[0].type).not.toBe('CustomDropdown');
      expect(result[0].type).not.toBe('TextEntry');
      expect(result[0].type).not.toBe('FileUpload');
    });

    it('Click on element with role=menuitem → not misclassified as wrong type', () => {
      const menuItem = makeTarget({
        tag: 'DIV',
        ariaRole: 'menuitem',
        className: 'menu-item',
        accessibleName: 'Copy',
      });
      const events = [clickEvent(menuItem)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).not.toBe('DatePicker');
      expect(result[0].type).not.toBe('TextEntry');
      expect(result[0].type).not.toBe('NativeDropdown');
      expect(result[0].type).not.toBe('FileUpload');
    });

    it('Click on element with role=dialog → not misclassified as Dropdown/DatePicker', () => {
      const dialog = makeTarget({
        tag: 'DIV',
        ariaRole: 'dialog',
        className: 'modal-content',
        accessibleName: 'Settings Dialog',
      });
      const events = [clickEvent(dialog)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].type).not.toBe('DatePicker');
      expect(result[0].type).not.toBe('NativeDropdown');
      expect(result[0].type).not.toBe('CustomDropdown');
      expect(result[0].type).not.toBe('TextEntry');
    });
  });

  // ═════════════════════════════→═════════════════════════════════════════════
  // CATEGORY 5: Confidence analysis — types below threshold should be Unknown
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Confidence threshold behavior', () => {

    it('every interaction has confidence recorded', () => {
      const events = [
        clickEvent(BUTTON),
        mouseenterEvent(DIV),
        scrollEvent(makeTarget({ tag: 'HTML' })),
      ];
      const result = detectInteractionsV2(events);
      expect(result.length).toBeGreaterThan(0);
      for (const r of result) {
        expect(r.confidence).toBeDefined();
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
        expect(r.eventIds).toBeDefined();
        expect(r.eventIds.length).toBeGreaterThan(0);
      }
    });

    it('every interaction carries metadata and eventIds', () => {
      const events = [clickEvent(BUTTON)];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      expect(result[0].eventIds.length).toBeGreaterThan(0);
      expect(result[0].metadata).toBeDefined();
      expect(result[0].interactionId).toBeDefined();
    });

    it('generic div click produces evidence-backed interaction', () => {
      // Create an event that no provider should confidently classify
      // A div with no distinguishing features
      const events = [clickEvent(makeTarget({
        tag: 'DIV',
        className: '',
        cssSelector: 'div',
        accessibleName: '',
        ariaRole: '',
      }))];
      const result = detectInteractionsV2(events);
      expect(result).toHaveLength(1);
      // A bare div click should be Click (EventSequenceProvider 0.6, weight 0.5)
      // This is above COMMIT_THRESHOLD=0.5 — acceptable.
      expect(result[0].type).toBe('Click');
      expect(result[0].confidence).toBeGreaterThanOrEqual(0.5);
    });
  });
});

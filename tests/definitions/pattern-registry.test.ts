/**
 * Pattern Registry — Unit Tests
 *
 * Tests that the registry correctly merges generic defaults with
 * framework and domain plugins, and that pattern matching works
 * for all categories.
 */

import { describe, it, expect } from 'vitest';
import { PatternRegistry } from '../../src/definitions/pattern-registry';

describe('PatternRegistry', () => {
  describe('Generic defaults', () => {
    it('detects generic interactive classes', () => {
      expect(PatternRegistry.isInteractiveClass('btn btn-primary')).toBe(true);
      expect(PatternRegistry.isInteractiveClass('dropdown-trigger')).toBe(true);
      expect(PatternRegistry.isInteractiveClass('menu-item active')).toBe(true);
    });

    it('rejects non-interactive classes', () => {
      expect(PatternRegistry.isInteractiveClass('container')).toBe(false);
      expect(PatternRegistry.isInteractiveClass('text-content')).toBe(false);
    });

    it('detects generic dropdown triggers', () => {
      expect(PatternRegistry.isDropdownTriggerClass('select')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('combobox')).toBe(true);
    });

    it('detects generic dropdown options', () => {
      expect(PatternRegistry.isDropdownOptionClass('select-option')).toBe(true);
      expect(PatternRegistry.isDropdownOptionClass('option-item')).toBe(true);
    });

    it('detects generic date picker triggers', () => {
      expect(PatternRegistry.isDatePickerTriggerClass('datepicker')).toBe(true);
      expect(PatternRegistry.isDatePickerTriggerClass('date-input')).toBe(true);
    });

    it('detects generic stepper buttons', () => {
      expect(PatternRegistry.isStepperPlusClass('plus')).toBe(true);
      expect(PatternRegistry.isStepperPlusClass('increment')).toBe(true);
      expect(PatternRegistry.isStepperMinusClass('minus')).toBe(true);
      expect(PatternRegistry.isStepperMinusClass('decrement')).toBe(true);
    });
  });

  describe('Framework plugins (MUI, Ant, OXD)', () => {
    it('detects MUI classes', () => {
      expect(PatternRegistry.isDropdownTriggerClass('MuiSelect-root')).toBe(true);
      expect(PatternRegistry.isDatePickerCellClass('MuiPickersDay')).toBe(true);
    });

    it('detects Ant Design classes', () => {
      expect(PatternRegistry.isDropdownTriggerClass('ant-select-selector')).toBe(true);
      expect(PatternRegistry.isDropdownOptionClass('ant-select-item')).toBe(true);
    });

    it('detects OXD classes', () => {
      expect(PatternRegistry.isDropdownTriggerClass('oxd-select-text')).toBe(true);
      expect(PatternRegistry.isDropdownOptionClass('oxd-select-option')).toBe(true);
      expect(PatternRegistry.isDatePickerTriggerClass('oxd-date-input')).toBe(true);
      expect(PatternRegistry.isDatePickerCellClass('oxd-date-day')).toBe(true);
      expect(PatternRegistry.isCalendarSurfaceClass('oxd-calendar')).toBe(true);
    });

    it('infers ARIA roles from OXD classes', () => {
      expect(PatternRegistry.inferRoleFromClassName('oxd-select-text')).toBe('combobox');
      expect(PatternRegistry.inferRoleFromClassName('oxd-button')).toBe('button');
    });
  });

  describe('Domain plugins (AdaniOne)', () => {
    it('detects AdaniOne interactive classes', () => {
      expect(PatternRegistry.isInteractiveClass('fare-option')).toBe(true);
      expect(PatternRegistry.isInteractiveClass('class-option')).toBe(true);
      expect(PatternRegistry.isInteractiveClass('travel-class')).toBe(true);
    });

    it('detects AdaniOne dropdown triggers', () => {
      expect(PatternRegistry.isDropdownTriggerClass('pax')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('cabin')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('economy')).toBe(true);
    });

    it('detects AdaniOne dropdown options', () => {
      expect(PatternRegistry.isDropdownOptionClass('pax-option')).toBe(true);
      expect(PatternRegistry.isDropdownOptionClass('fare-option')).toBe(true);
    });

    it('detects AdaniOne stepper buttons', () => {
      expect(PatternRegistry.isStepperPlusClass('pax-plus')).toBe(true);
      expect(PatternRegistry.isStepperMinusClass('pax-minus')).toBe(true);
    });

    it('detects AdaniOne date picker triggers', () => {
      expect(PatternRegistry.isDatePickerTriggerClass('depart-on')).toBe(true);
      expect(PatternRegistry.isDatePickerTriggerClass('departure-date')).toBe(true);
      expect(PatternRegistry.isDatePickerTriggerClass('arrival-date')).toBe(true);
    });

    it('detects AdaniOne display value classes', () => {
      const merged = PatternRegistry.getMerged();
      expect(merged.displayValueClasses).toContain('city-name');
      expect(merged.displayValueClasses).toContain('airport-name');
    });
  });

  describe('Plugin registration', () => {
    it('allows registering custom patterns', () => {
      PatternRegistry.registerPlugin({
        name: 'TestApp',
        interactiveClasses: ['my-custom-interactive'],
        dropdownTriggerClasses: ['my-select'],
      });

      expect(PatternRegistry.isInteractiveClass('my-custom-interactive')).toBe(true);
      expect(PatternRegistry.isDropdownTriggerClass('my-select')).toBe(true);
    });

    it('merges arrays without duplicates', () => {
      const before = PatternRegistry.getMerged().interactiveClasses?.length ?? 0;
      PatternRegistry.registerPlugin({
        name: 'DupTest',
        interactiveClasses: ['btn', 'new-class'],
      });
      const after = PatternRegistry.getMerged().interactiveClasses?.length ?? 0;
      // Should only add 1 new entry ('new-class'), not 'btn' (already exists)
      expect(after).toBe(before + 1);
    });
  });
});

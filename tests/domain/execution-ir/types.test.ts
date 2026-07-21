/**
 * Execution IR Type System Tests — execution-ir-design.md §2
 *
 * Validates the IR type definitions, IRAction superset property,
 * DEFAULT_EXECUTION_PARAMETERS, and type-level constraints.
 */
import { describe, it, expect } from 'vitest';
import { IRAction, DEFAULT_EXECUTION_PARAMETERS } from '../../../src/domain/execution-ir/types';
import { StepAction } from '../../../src/domain/enums';

describe('Execution IR Type System', () => {

  // ── IRAction Superset Property ─────────────────────────

  describe('IRAction is a superset of StepAction', () => {
    it('contains all StepAction values with identical string values', () => {
      // Every StepAction must have a matching IRAction with the same string value.
      expect(IRAction.CLICK).toBe(StepAction.CLICK);
      expect(IRAction.FILL).toBe(StepAction.FILL);
      expect(IRAction.SELECT).toBe(StepAction.SELECT);
      expect(IRAction.SELECT_DATE).toBe(StepAction.SELECT_DATE);
      expect(IRAction.TOGGLE).toBe(StepAction.TOGGLE);
      expect(IRAction.HOVER).toBe(StepAction.HOVER);
      expect(IRAction.NAVIGATE).toBe(StepAction.NAVIGATE);
      expect(IRAction.VERIFY).toBe(StepAction.VERIFY);
      expect(IRAction.WAIT).toBe(StepAction.WAIT);
    });

    it('includes execution-only actions not in StepAction', () => {
      expect(IRAction.WAIT_FOR_ELEMENT).toBe('waitForElement');
      // Verify it is NOT a StepAction value
      expect(Object.values(StepAction)).not.toContain(IRAction.WAIT_FOR_ELEMENT);
    });
  });

  // ── DEFAULT_EXECUTION_PARAMETERS ───────────────────────

  describe('DEFAULT_EXECUTION_PARAMETERS', () => {
    it('has timeoutMs = 30000', () => {
      expect(DEFAULT_EXECUTION_PARAMETERS.timeoutMs).toBe(30_000);
    });

    it('has retryCount = 0 (V1: no retries)', () => {
      expect(DEFAULT_EXECUTION_PARAMETERS.retryCount).toBe(0);
    });

    it('has retryDelayMs = 1000', () => {
      expect(DEFAULT_EXECUTION_PARAMETERS.retryDelayMs).toBe(1_000);
    });

    it('has waitStrategy = visible (default)', () => {
      expect(DEFAULT_EXECUTION_PARAMETERS.waitStrategy).toBe('visible');
    });

    it('has exactly 4 fields', () => {
      expect(Object.keys(DEFAULT_EXECUTION_PARAMETERS)).toHaveLength(4);
    });
  });
});

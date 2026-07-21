/**
 * Reference IR Plan Suite Tests
 *
 * Validates that the reference plans cover all LocatorStrategyType values,
 * all business-authored IRAction values, and all ValidationType values.
 * These are permanent benchmark cases — if coverage is incomplete, future
 * generators may have untested code paths.
 */
import { describe, it, expect } from 'vitest';
import { ALL_REFERENCE_PLANS } from '../../../src/adapters/playwright/__fixtures__/reference-ir-plans';
import { IRAction } from '../../../src/domain/execution-ir/types';
import { LocatorStrategyType, ValidationType } from '../../../src/domain/enums';
// ── Coverage Sets ─────────────────────────────────────────

const ALL_LOCATOR_TYPES = new Set(Object.values(LocatorStrategyType));
const ALL_VALIDATION_TYPES = new Set(Object.values(ValidationType));

// Business-authored IRAction values (exclude execution-only like WAIT_FOR_ELEMENT)
const BUSINESS_ACTIONS = new Set<IRAction>([
  IRAction.CLICK,
  IRAction.FILL,
  IRAction.SELECT,
  IRAction.SELECT_DATE,
  IRAction.TOGGLE,
  IRAction.HOVER,
  IRAction.NAVIGATE,
  IRAction.VERIFY,
  IRAction.WAIT,
]);

// ── Tests ─────────────────────────────────────────────────

describe('Reference IR Plan Suite', () => {

  // ── Basic Structure ─────────────────────────────────────

  describe('plan structure', () => {
    it('has at least 10 reference plans', () => {
      expect(ALL_REFERENCE_PLANS.length).toBeGreaterThanOrEqual(10);
    });

    it('each plan is a valid ExecutionIRPlan', () => {
      for (const entry of ALL_REFERENCE_PLANS) {
        const plan = entry.factory();
        expect(plan.testCaseId, `${entry.name}: testCaseId`).toBeTruthy();
        expect(plan.testCaseVersionId, `${entry.name}: testCaseVersionId`).toBeTruthy();
        expect(plan.testCaseVersionNumber, `${entry.name}: versionNumber`).toBeGreaterThanOrEqual(1);
        expect(plan.title, `${entry.name}: title`).toBeTruthy();
        expect(plan.tags, `${entry.name}: tags`).toBeInstanceOf(Array);
        expect(plan.environment, `${entry.name}: environment`).toBeTruthy();
        expect(plan.environment.baseUrl, `${entry.name}: baseUrl`).toBeTruthy();
        expect(plan.steps, `${entry.name}: steps`).toBeInstanceOf(Array);
        expect(plan.steps.length, `${entry.name}: steps not empty`).toBeGreaterThan(0);
      }
    });

    it('each plan has unique sequential step ordering', () => {
      for (const entry of ALL_REFERENCE_PLANS) {
        const plan = entry.factory();
        for (let i = 0; i < plan.steps.length; i++) {
          expect(plan.steps[i].order, `${entry.name}: step ${i} order`).toBe(i);
        }
      }
    });

    it('factory functions return fresh objects each call', () => {
      for (const entry of ALL_REFERENCE_PLANS) {
        const plan1 = entry.factory();
        const plan2 = entry.factory();
        expect(plan1).not.toBe(plan2); // Different object identities
        expect(plan1.steps).not.toBe(plan2.steps);
        expect(plan1.steps[0]).not.toBe(plan2.steps[0]);
      }
    });
  });

  // ── LocatorStrategyType Coverage ────────────────────────

  describe('LocatorStrategyType coverage', () => {
    const foundLocatorTypes = new Set<string>();

    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      for (const step of plan.steps) {
        if (step.target.kind === 'element') {
          for (const locator of step.target.resolvedLocators) {
            foundLocatorTypes.add(locator.type);
          }
        }
        for (const assertion of step.assertions) {
          if (assertion.target.kind === 'element') {
            for (const locator of assertion.target.resolvedLocators) {
              foundLocatorTypes.add(locator.type);
            }
          }
        }
      }
    }

    for (const locatorType of ALL_LOCATOR_TYPES) {
      it(`covers LocatorStrategyType.${locatorType}`, () => {
        expect(
          foundLocatorTypes.has(locatorType),
          `LocatorStrategyType.${locatorType} not found in any reference plan`,
        ).toBe(true);
      });
    }
  });

  // ── IRAction Coverage ───────────────────────────────────

  describe('IRAction coverage', () => {
    const foundActions = new Set<IRAction>();

    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      for (const step of plan.steps) {
        foundActions.add(step.action);
      }
    }

    for (const action of BUSINESS_ACTIONS) {
      it(`covers IRAction.${action}`, () => {
        expect(
          foundActions.has(action),
          `IRAction.${action} not found in any reference plan`,
        ).toBe(true);
      });
    }
  });

  // ── ValidationType Coverage ─────────────────────────────

  describe('ValidationType coverage', () => {
    const foundValidationTypes = new Set<string>();

    for (const entry of ALL_REFERENCE_PLANS) {
      const plan = entry.factory();
      for (const step of plan.steps) {
        for (const assertion of step.assertions) {
          foundValidationTypes.add(assertion.type);
        }
      }
    }

    for (const valType of ALL_VALIDATION_TYPES) {
      it(`covers ValidationType.${valType}`, () => {
        expect(
          foundValidationTypes.has(valType),
          `ValidationType.${valType} not found in any reference plan`,
        ).toBe(true);
      });
    }
  });

  // ── Element Target Coverage ─────────────────────────────

  describe('element target quality', () => {
    it('every element target has at least one locator (INV-EL4)', () => {
      for (const entry of ALL_REFERENCE_PLANS) {
        const plan = entry.factory();
        for (const step of plan.steps) {
          if (step.target.kind === 'element') {
            expect(
              step.target.resolvedLocators.length,
              `${entry.name}, step "${step.description}": element target must have locators`,
            ).toBeGreaterThanOrEqual(1);
          }
          for (const assertion of step.assertions) {
            if (assertion.target.kind === 'element') {
              expect(
                assertion.target.resolvedLocators.length,
                `${entry.name}, assertion in step "${step.description}": target must have locators`,
              ).toBeGreaterThanOrEqual(1);
            }
          }
        }
      }
    });

    it('every element target has elementName and pageOrComponent', () => {
      for (const entry of ALL_REFERENCE_PLANS) {
        const plan = entry.factory();
        for (const step of plan.steps) {
          if (step.target.kind === 'element') {
            expect(step.target.elementName, `${entry.name}: elementName`).toBeTruthy();
            expect(step.target.pageOrComponent, `${entry.name}: pageOrComponent`).toBeTruthy();
          }
        }
      }
    });
  });
});

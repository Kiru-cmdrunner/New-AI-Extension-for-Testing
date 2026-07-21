import { describe, it, expect } from 'vitest';
import {
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_CEILING,
  CONFIDENCE_FLOOR,
  DEFAULT_CONFIDENCE,
  clampConfidence,
  createDefaultConfidence,
  updateTrack,
  updateConfidence,
  quickUpdate,
} from '../src/generation/engine/confidence-engine';

describe('Confidence Engine', () => {

  describe('Constants', () => {
    it('weights sum to 1.0', () => {
      const sum = CONFIDENCE_WEIGHTS.intent + CONFIDENCE_WEIGHTS.workflow +
        CONFIDENCE_WEIGHTS.appFocus + CONFIDENCE_WEIGHTS.uiFocus + CONFIDENCE_WEIGHTS.change;
      expect(sum).toBeCloseTo(1.0, 10);
    });

    it('intent has highest weight (0.35)', () => {
      expect(CONFIDENCE_WEIGHTS.intent).toBe(0.35);
    });

    it('ceiling is 0.95', () => {
      expect(CONFIDENCE_CEILING).toBe(0.95);
    });

    it('floor is 0.05', () => {
      expect(CONFIDENCE_FLOOR).toBe(0.05);
    });

    it('weights are frozen', () => {
      expect(Object.isFrozen(CONFIDENCE_WEIGHTS)).toBe(true);
    });
  });

  describe('clampConfidence', () => {
    it('clamps above ceiling to 0.95', () => {
      expect(clampConfidence(1.5)).toBe(0.95);
    });

    it('clamps below floor to 0.05', () => {
      expect(clampConfidence(-0.5)).toBe(0.05);
    });

    it('preserves values within bounds', () => {
      expect(clampConfidence(0.5)).toBe(0.5);
    });

    it('preserves exact ceiling', () => {
      expect(clampConfidence(0.95)).toBe(0.95);
    });

    it('preserves exact floor', () => {
      expect(clampConfidence(0.05)).toBe(0.05);
    });
  });

  describe('createDefaultConfidence', () => {
    it('returns all tracks at DEFAULT_CONFIDENCE', () => {
      const c = createDefaultConfidence();
      expect(c.intent).toBe(DEFAULT_CONFIDENCE);
      expect(c.workflow).toBe(DEFAULT_CONFIDENCE);
      expect(c.appFocus).toBe(DEFAULT_CONFIDENCE);
      expect(c.uiFocus).toBe(DEFAULT_CONFIDENCE);
      expect(c.change).toBe(DEFAULT_CONFIDENCE);
      expect(c.composite).toBe(DEFAULT_CONFIDENCE);
    });

    it('composite is within P5 bounds', () => {
      const c = createDefaultConfidence();
      expect(c.composite).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
      expect(c.composite).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    });
  });

  describe('updateTrack', () => {
    it('increases confidence when evidence supports', () => {
      const current = 0.3;
      const updated = updateTrack(current, 0.8, true);
      expect(updated).toBeGreaterThan(current);
    });

    it('decreases confidence when evidence contradicts', () => {
      const current = 0.7;
      const updated = updateTrack(current, 0.8, false);
      expect(updated).toBeLessThan(current);
    });

    it('never exceeds ceiling (0.95)', () => {
      const updated = updateTrack(0.9, 1.0, true);
      expect(updated).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    });

    it('never goes below floor (0.05)', () => {
      const updated = updateTrack(0.1, 1.0, false);
      expect(updated).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
    });

    it('has diminishing returns near ceiling', () => {
      const low = updateTrack(0.3, 0.8, true);
      const high = updateTrack(0.9, 0.8, true);
      // Delta from 0.3 should be larger than delta from 0.9
      expect(low - 0.3).toBeGreaterThan(high - 0.9);
    });

    it('has sharper decline (growth < decline at same level)', () => {
      const growth = updateTrack(0.5, 0.8, true) - 0.5;
      const decline = 0.5 - updateTrack(0.5, 0.8, false);
      // Decline should be steeper than growth
      expect(decline).toBeGreaterThan(growth);
    });

    it('zero evidence strength has no effect', () => {
      const updated = updateTrack(0.5, 0, true);
      expect(updated).toBeCloseTo(0.5, 10);
    });
  });

  describe('updateConfidence', () => {
    it('updates all 5 tracks', () => {
      const prev = createDefaultConfidence();
      const result = updateConfidence({
        previous: prev,
        aiConfidence: 0.8,
        evidenceSupportsIntent: true,
        workflowFit: 0.7,
        actionFitsWorkflow: true,
        elementMatchesApp: 0.6,
        elementMatchesUI: 0.6,
        changeIsExpected: 0.5,
        changeMatchesExpected: true,
      });

      expect(result.intent).not.toBe(prev.intent);
      expect(result.workflow).not.toBe(prev.workflow);
      expect(result.composite).not.toBe(prev.composite);
    });

    it('composite is weighted sum of tracks', () => {
      const prev = createDefaultConfidence();
      const result = updateConfidence({
        previous: prev,
        aiConfidence: 0.8,
        evidenceSupportsIntent: true,
        workflowFit: 0.7,
        actionFitsWorkflow: true,
        elementMatchesApp: 0.6,
        elementMatchesUI: 0.6,
        changeIsExpected: 0.5,
        changeMatchesExpected: true,
      });

      const expectedComposite = clampConfidence(
        result.intent * CONFIDENCE_WEIGHTS.intent +
        result.workflow * CONFIDENCE_WEIGHTS.workflow +
        result.appFocus * CONFIDENCE_WEIGHTS.appFocus +
        result.uiFocus * CONFIDENCE_WEIGHTS.uiFocus +
        result.change * CONFIDENCE_WEIGHTS.change,
      );
      expect(result.composite).toBeCloseTo(expectedComposite, 10);
    });

    it('respects P5 bounds on all tracks', () => {
      const prev = createDefaultConfidence();
      const result = updateConfidence({
        previous: prev,
        aiConfidence: 1.0,
        evidenceSupportsIntent: true,
        workflowFit: 1.0,
        actionFitsWorkflow: true,
        elementMatchesApp: 1.0,
        elementMatchesUI: 1.0,
        changeIsExpected: 1.0,
        changeMatchesExpected: true,
      });

      expect(result.intent).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(result.workflow).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(result.appFocus).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(result.uiFocus).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(result.change).toBeLessThanOrEqual(CONFIDENCE_CEILING);
      expect(result.composite).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    });
  });

  describe('quickUpdate', () => {
    it('updates confidence with simplified input', () => {
      const prev = createDefaultConfidence();
      const result = quickUpdate(prev, 0.8, true);
      expect(result.intent).toBeGreaterThan(prev.intent);
      expect(result.composite).toBeGreaterThan(prev.composite);
    });

    it('decreases confidence when not supporting', () => {
      const prev = createDefaultConfidence();
      prev.intent = 0.7;
      const result = quickUpdate(prev, 0.8, false);
      expect(result.intent).toBeLessThan(prev.intent);
    });

    it('is consistent — same inputs give same outputs', () => {
      const prev = createDefaultConfidence();
      const r1 = quickUpdate(prev, 0.8, true);
      const r2 = quickUpdate(prev, 0.8, true);
      expect(r1).toEqual(r2);
    });
  });

  describe('Long-term convergence', () => {
    it('converges toward ceiling with repeated supporting evidence', () => {
      let c = createDefaultConfidence();
      for (let i = 0; i < 100; i++) {
        c = quickUpdate(c, 0.9, true);
      }
      // Should be very close to ceiling
      expect(c.composite).toBeGreaterThan(0.8);
      expect(c.composite).toBeLessThanOrEqual(CONFIDENCE_CEILING);
    });

    it('converges toward floor with repeated contradicting evidence', () => {
      let c = createDefaultConfidence();
      c.intent = 0.8;
      for (let i = 0; i < 100; i++) {
        c = quickUpdate(c, 0.9, false);
      }
      expect(c.intent).toBeLessThan(0.15);
      expect(c.intent).toBeGreaterThanOrEqual(CONFIDENCE_FLOOR);
    });
  });
});

/**
 * R2 Slider Detection — Regression Gate Tests
 *
 * Gates 7 (custom slider detection) + Gate 8 (end-to-end replay).
 * Permanent test suite verifying the R2 slider capability.
 */

import { describe, it, expect } from 'vitest';
import { isSlider, isSliderHandleClass } from '../src/definitions/patterns';
import { build as buildIRPlan } from '../src/generation/ir-bridge';
import type { IRBridgeInput } from '../src/generation/ir-bridge-input';
import { renderTestFile } from '../src/adapters/playwright/test-function-renderer';
import type { ComponentInteraction } from '../src/shared/component-types';
import { makeComponentInteraction } from './golden-master/corpus';

// ── Gate 7: Custom Slider Detection ────────────────────────────────────

describe('R2 Gate 7: Custom Slider Detection', () => {
  describe('isSlider() with CSS class patterns', () => {
    it('returns true for ui-slider-handle class', () => {
      expect(isSlider('DIV', null, null, 'ui-slider-handle')).toBe(true);
    });

    it('returns true for noUi-handle class', () => {
      expect(isSlider('DIV', null, null, 'noUi-handle')).toBe(true);
    });

    it('returns true for slider-thumb class', () => {
      expect(isSlider('DIV', null, null, 'slider-thumb')).toBe(true);
    });

    it('returns true for range-handle class', () => {
      expect(isSlider('DIV', null, null, 'range-handle')).toBe(true);
    });

    it('returns true for ancestor track class ui-slider', () => {
      expect(isSlider('DIV', null, null, null, ['ui-slider'])).toBe(true);
    });

    it('returns true for ancestor track class slider-track', () => {
      expect(isSlider('DIV', null, null, null, ['slider-track', 'container'])).toBe(true);
    });

    it('returns false for non-slider elements', () => {
      expect(isSlider('DIV', null, null, 'button')).toBe(false);
      expect(isSlider('DIV', null, null, 'slider-handler-service')).toBe(false);
      expect(isSlider('DIV', null, null, null, [])).toBe(false);
    });

    it('preserves existing native detection', () => {
      expect(isSlider('INPUT', 'range', null)).toBe(true);
      expect(isSlider('INPUT', 'range', null, null, null)).toBe(true);
    });

    it('preserves existing ARIA detection', () => {
      expect(isSlider('DIV', null, 'slider')).toBe(true);
      expect(isSlider('DIV', null, 'slider', null, null)).toBe(true);
    });
  });

  describe('isSliderHandleClass() for DragDrop exclusion', () => {
    it('returns true for known slider handle classes', () => {
      expect(isSliderHandleClass('ui-slider-handle')).toBe(true);
      expect(isSliderHandleClass('noUi-handle')).toBe(true);
      expect(isSliderHandleClass('slider-thumb')).toBe(true);
    });

    it('returns false for non-handle classes', () => {
      expect(isSliderHandleClass('button')).toBe(false);
      expect(isSliderHandleClass(null)).toBe(false);
      expect(isSliderHandleClass(undefined)).toBe(false);
    });
  });
});

// ── Gate 8: End-to-End Slider Replay ───────────────────────────────────

function buildPlan(interactions: ComponentInteraction[]) {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' },
    testCaseName: 'Slider Gate Test',
  };
  return buildIRPlan(input);
}

describe('R2 Gate 8: End-to-End Slider Replay', () => {
  it('NativeSlider subtype → FILL + toHaveValue()', () => {
    const ci = makeComponentInteraction('Slider', {
      interactionSubtype: 'NativeSlider',
      metadata: { sliderValue: '75', min: '0', max: '100', targetName: 'Volume' },
    });
    const plan = buildPlan([ci]);

    expect(plan.steps[0].action).toBe('fill');
    expect(plan.steps[0].input).toBe('75');

    const valAssert = plan.steps[0].assertions?.find(a => a.property === 'value');
    expect(valAssert).toBeDefined();
    expect(valAssert!.comparison).toBe('equals');
    expect(valAssert!.expectedValue).toBe('75');

    const code = renderTestFile(plan);
    expect(code).toContain("toHaveValue('75')");
  });

  it('AriaSlider subtype → FILL + toHaveAttribute(aria-valuenow)', () => {
    const ci = makeComponentInteraction('Slider', {
      interactionSubtype: 'AriaSlider',
      metadata: { sliderValue: '60', min: '0', max: '100', targetName: 'Volume' },
    });
    const plan = buildPlan([ci]);

    expect(plan.steps[0].action).toBe('fill');
    expect(plan.steps[0].input).toBe('60');

    const valAssert = plan.steps[0].assertions?.find(a => a.property === 'aria-valuenow');
    expect(valAssert).toBeDefined();
    expect(valAssert!.expectedValue).toBe('60');

    const code = renderTestFile(plan);
    expect(code).toContain("toHaveAttribute('aria-valuenow', '60')");
  });

  it('RangeSlider subtype → FILL + toHaveAttribute(aria-valuenow)', () => {
    const ci = makeComponentInteraction('Slider', {
      interactionSubtype: 'RangeSlider',
      metadata: { sliderValue: '30', min: '0', max: '100', targetName: 'Price' },
    });
    const plan = buildPlan([ci]);

    expect(plan.steps[0].action).toBe('fill');
    expect(plan.steps[0].input).toBe('30');

    const valAssert = plan.steps[0].assertions?.find(a => a.property === 'aria-valuenow');
    expect(valAssert).toBeDefined();

    const code = renderTestFile(plan);
    expect(code).toContain("toHaveAttribute('aria-valuenow', '30')");
  });

  it('CustomSlider subtype → FILL + toHaveAttribute(aria-valuenow)', () => {
    const ci = makeComponentInteraction('Slider', {
      interactionSubtype: 'CustomSlider',
      metadata: { sliderValue: '42', min: '0', max: '100', targetName: 'Price' },
    });
    const plan = buildPlan([ci]);

    expect(plan.steps[0].action).toBe('fill');
    expect(plan.steps[0].input).toBe('42');

    const valAssert = plan.steps[0].assertions?.find(a => a.property === 'aria-valuenow');
    expect(valAssert).toBeDefined();

    const code = renderTestFile(plan);
    expect(code).toContain("toHaveAttribute('aria-valuenow', '42')");
  });

  it('Slider WITHOUT subtype → FILL + toHaveValue() (backward compat)', () => {
    const ci = makeComponentInteraction('Slider', {
      metadata: { sliderValue: '50', min: '0', max: '100', targetName: 'Volume' },
    });
    const plan = buildPlan([ci]);

    expect(plan.steps[0].action).toBe('fill');
    expect(plan.steps[0].input).toBe('50');

    const code = renderTestFile(plan);
    expect(code).toContain("toHaveValue('50')");
  });
});

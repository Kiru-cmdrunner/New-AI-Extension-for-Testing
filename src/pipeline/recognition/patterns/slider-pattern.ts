/**
 * Slider Pattern — Phase 4 (revised)
 *
 * working-better: isSlider() = tag=INPUT+type=range, OR role=slider
 */

import type { PatternDefinition } from '../../../types/foundation';

export const SLIDER_PATTERN: PatternDefinition = {
  id: 'slider-drag-v1',
  verb: 'selectOption',
  componentType: 'Slider',
  priority: 120,
  confidenceThreshold: 0.6,
  description: 'User drags a slider/range control',
  conditions: [
    {
      signalType: 'ariaRole',
      operator: 'equals',
      expected: 'slider',
      weight: 2,
      description: 'Role=slider, or native INPUT[range]',
      anyOf: [
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'inputType:range' },
      ],
    },
    {
      signalType: 'valueTransition',
      operator: 'exists',
      expected: null,
      weight: 3,
      description: 'Slider value changed',
    },
  ],
};

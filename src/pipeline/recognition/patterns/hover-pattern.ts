/**
 * Hover Pattern — Phase 4 (revised)
 *
 * working-better: mouseenter on interactive element.
 * Confidence: aria-expanded(+100), overlay-role+dwell>=500ms(+70),
 * haspopup+dwell>=500ms(+60), sustained-dwell>=3s(+50), threshold 50.
 *
 * In our declarative system, the hover pattern matches mouseenter on
 * elements that have popup/overlay evidence. The dwell-time and confidence
 * accumulation will be handled by the Lifecycle Engine (Phase 5) which
 * can process multi-event evidence over time.
 *
 * For now, we match mouseenter + aria-haspopup as the primary signal.
 * This is a LOWER confidence than working-better's accumulated model,
 * which is acceptable — false positives are more costly than false negatives
 * for hover interactions.
 */

import type { PatternDefinition } from '../../../types/foundation';

export const HOVER_PATTERN: PatternDefinition = {
  id: 'hover-v1',
  verb: 'hover',
  componentType: 'Tooltip',
  priority: 90,
  confidenceThreshold: 0.5,
  description: 'User hovers over an element with tooltip/popover trigger',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'mouseenter',
      weight: 1,
      description: 'Must have a mouseenter event',
    },
    {
      signalType: 'ariaAttribute',
      operator: 'contains',
      expected: 'haspopup',
      weight: 2,
      description: 'Element has aria-haspopup (triggers popup on hover)',
      anyOf: [
        { signalType: 'ariaAttribute', operator: 'contains', expected: 'expanded:true' },
        { signalType: 'eventSequence', operator: 'contains', expected: 'overlayOpen' },
      ],
    },
  ],
};

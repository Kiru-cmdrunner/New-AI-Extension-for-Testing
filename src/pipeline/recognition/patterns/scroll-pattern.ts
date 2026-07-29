/**
 * Scroll Pattern — Phase 4
 *
 * Matches scroll interactions with non-zero delta.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { PatternDefinition } from '../../../types/foundation';

export const SCROLL_PATTERN: PatternDefinition = {
  id: 'scroll-v1',
  verb: 'scroll',
  componentType: 'Generic',
  priority: 80,
  confidenceThreshold: 0.4,
  description: 'User scrolls the page or a scrollable container',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'scroll',
      weight: 1,
      description: 'Must be a scroll event',
    },
  ],
};

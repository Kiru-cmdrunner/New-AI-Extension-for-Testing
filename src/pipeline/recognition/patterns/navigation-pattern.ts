/**
 * Navigation Pattern — Phase 4
 *
 * Matches page navigation events (URL changes, tab opens/closes).
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { PatternDefinition } from '../../../types/foundation';

export const NAVIGATION_PATTERN: PatternDefinition = {
  id: 'navigation-v1',
  verb: 'navigate',
  componentType: 'NavigationBar',
  priority: 100,
  confidenceThreshold: 0.7,
  description: 'User navigates to a new page or URL',
  conditions: [
    {
      signalType: 'eventSequence',
      operator: 'contains',
      expected: 'navigation',
      weight: 2,
      description: 'Must be a navigation event',
    },
  ],
};

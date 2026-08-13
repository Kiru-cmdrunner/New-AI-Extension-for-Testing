/**
 * M9.4 - Page Content Signal Extractor
 *
 * Converts a PageContentSnapshot into categorized signal components:
 * observed entities, counters, collections, notifications.
 *
 * Also produces a PageContentSignal for the SignalSet.
 *
 * Architecture: .drytis/specs/m9-4-page-content-observer.md
 */

import type { SignalSet } from '../types';
import type { PageContentSnapshot } from './page-content-types';
import type { PageContentSignal } from './page-content-types';

/**
 * Extract categorized observations from a snapshot.
 */
export function extractFromSnapshot(
  snapshot: PageContentSnapshot,
  interactionId: string,
): PageContentSignal {
  const observedEntities = snapshot.items.filter((i) => i.kind === 'entity');
  const observedCounters = snapshot.items.filter((i) => i.kind === 'counter');
  const observedCollections = snapshot.items.filter((i) => i.kind === 'collection');
  const observedNotifications = snapshot.items.filter((i) => i.kind === 'notification');

  return {
    type: 'page-content',
    source: 'page-content',
    interactionId,
    confidence: 0.7,
    snapshot,
    observedEntities,
    observedCounters,
    observedCollections,
    observedNotifications,
  };
}

/**
 * Merge a page-content signal into an existing SignalSet.
 * This is called by the signal coordinator when processing an interaction
 * that includes a page-content snapshot (e.g., the int-19 gap interaction).
 */
export function mergePageContentSignal(
  signalSet: SignalSet,
  pageContent: PageContentSignal,
): SignalSet {
  return {
    ...signalSet,
    pageContent: pageContent,
  };
}

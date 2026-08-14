/**
 * M9.12 D2 — Page Content Signal Extractor (from behavioral evidence)
 *
 * Derives PageContentSignal data from the behavioral evidence captured
 * by M1–M8.  This bridges the gap: the PageContentObserver (M9.4)
 * requires a live DOM scan, which the post-hoc pipeline doesn't have.
 * Instead, we synthesize page-content observations from:
 *
 *   - newSurfaces[]      → status badges, notifications, surface counters
 *   - removedSurfaces[]  → disappeared notifications
 *
 * FIX (post-audit): domChanges[]-derived counters and collections were
 * REMOVED — they duplicate what CounterSignalExtractor and
 * ListSignalExtractor already produce from the same domChanges[] array,
 * causing double-recorded counters and corrupted collection counts.
 * Only newSurfaces[]-derived observations remain here, since no other
 * extractor reads newSurfaces[].
 *
 * Architecture: .drytis/specs/m9-12-production-wiring.md (D2 fix)
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { Signal, SignalExtractor } from '../types';
import type { PageContentSignal } from '../page-content/page-content-types';
import type { ObservedItem } from '../page-content/page-content-types';

/** ARIA roles that indicate a status badge or notification. */
const STATUS_BADGE_ROLES = new Set(['status', 'alert', 'log']);

/** Tags that indicate a counter/badge element. */
const COUNTER_TAGS = new Set(['BADGE', 'COUNTER']);

/**
 * Derive observed items from behavioral evidence surfaces.
 *
 * Only processes newSurfaces[] — domChanges[] are intentionally NOT
 * read here because CounterSignalExtractor and ListSignalExtractor
 * already handle those, and re-deriving them causes duplication.
 *
 * Called by the PageContentEvidenceExtractor for each interaction.
 */
function deriveObservedItems(interaction: ComponentInteraction): ObservedItem[] {
  const items: ObservedItem[] = [];
  const evidence = interaction.behavioralEvidence;
  if (!evidence) return items;

  const app = evidence.applicationEvidence;

  // ── New surfaces → status badges, surface-level counters, entities ──
  for (const surface of app.newSurfaces) {
    const role = surface.ariaRole;
    const tag = surface.tagName?.toUpperCase() ?? '';
    const text = surface.accessibleName ?? '';
    const path = surface.path;

    // Status badge / notification — unique contribution of this extractor.
    // No other extractor reads newSurfaces[].
    if (role && STATUS_BADGE_ROLES.has(role)) {
      items.push({
        kind: 'status-badge',
        matchedSelector: 'aria-role',
        text,
        numericValue: null,
        entityId: null,
        entityType: null,
        domPath: path,
        attributes: { 'aria-role': role },
        visible: true,
      });
    }

    // Surface-level counters (explicit BADGE/COUNTER tags that appeared).
    // These are absolute-value observations from new surfaces, NOT deltas
    // from domChanges[] — so they don't duplicate CounterSignalExtractor.
    if (COUNTER_TAGS.has(tag)) {
      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) {
        items.push({
          kind: 'counter',
          matchedSelector: 'surface-tag',
          text,
          numericValue: num,
          entityId: null,
          entityType: null,
          domPath: path,
          attributes: { source: 'surface' },
          visible: true,
        });
      }
    }
  }

  // NOTE: domChanges[] are NOT processed here for counters/collections.
  // CounterSignalExtractor and ListSignalExtractor already read
  // domChanges[] via SignalExtractionCoordinator, producing counter-change
  // and list-change signals that feed into the same trackers. Re-deriving
  // them here would cause:
  //   - Double-recorded counter values (same elementPath, two record() calls)
  //   - Corrupted collection counts (update() applies delta, then setCount()
  //     overwrites with churn count)

  return items;
}

/**
 * Signal extractor that produces PageContentSignal from behavioral evidence.
 *
 * This bridges M9.4 (PageContentObserver) into the production pipeline by
 * deriving observed items from evidence surfaces — without requiring a
 * live DOM scan. Only produces status-badge and surface-counter
 * observations (unique contributions not duplicated by other extractors).
 */
export class PageContentEvidenceExtractor implements SignalExtractor {
  readonly name = 'PageContentEvidenceExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const items = deriveObservedItems(interaction);
    if (items.length === 0) return [];

    const observedEntities = items.filter((i) => i.kind === 'entity');
    const observedCounters = items.filter((i) => i.kind === 'counter');
    const observedCollections = items.filter((i) => i.kind === 'collection');
    const observedNotifications = items.filter((i) => i.kind === 'notification');
    const observedStatusBadges = items.filter((i) => i.kind === 'status-badge');

    const signal: PageContentSignal = {
      type: 'page-content',
      source: 'page-content',
      interactionId: interaction.interactionId,
      confidence: 0.7,
      snapshot: {
        viewId: null,
        url: '',
        scannedAt: Date.now(),
        items,
        itemsOverflow: 0,
        scanDurationMs: 0,
      },
      observedEntities,
      observedCounters,
      observedCollections,
      observedNotifications,
      observedStatusBadges,
    };

    return [signal as unknown as Signal];
  }
}

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
 *   - resultingState     → Phase 1's post-settlement semantic snapshot
 *                          (entities/counters/collections/notifications/
 *                          status-badges scanned from the live DOM)
 *
 * FIX (post-audit): domChanges[]-derived counters and collections were
 * REMOVED — they duplicate what CounterSignalExtractor and
 * ListSignalExtractor already produce from the same domChanges[] array,
 * causing double-recorded counters and corrupted collection counts.
 * Only newSurfaces[]-derived observations remain here, since no other
 * extractor reads newSurfaces[].
 *
 * Phase 2 (resulting application state): resultingState.items are merged
 * with newSurfaces-derived items under the dedup key `kind + ':' + domPath`
 * — the SNAPSHOT item wins collisions (richer: real selector, attributes,
 * numeric parse). Both key halves use dom-observer's getElementPath output,
 * so surface paths and snapshot paths collide exactly when they denote the
 * same region. Different kinds at the same path are distinct observations
 * and are both kept.
 *
 * Provenance: per-item source remains distinguishable via matchedSelector —
 * newSurfaces items carry 'aria-role' / 'surface-tag'; snapshot items carry
 * the real CSS selector string that matched.
 *
 * NOTE: the merged items array may exceed the observer's MAX_ITEMS bound
 * (50) in the union — harmless by design; StateBuilder and OutcomeDeterminer
 * consume the kind-filtered observed* arrays, never items.length.
 *
 * Snapshot metadata follows the winning source: when resultingState items
 * contributed (snapshot.items.length > 0), the REAL snapshot metadata
 * (url/viewId/scannedAt/itemsOverflow/scanDurationMs) is used — this is
 * also StateBuilder's discriminator for the 'content-observed' entity
 * source (real url !== '' vs synthetic ''). Otherwise the synthetic
 * {url:'', scannedAt: Date.now()} values are retained (pre-Phase-2 shape).
 *
 * Architecture: .drytis/specs/m9-12-production-wiring.md (D2 fix),
 * .drytis/specs/resulting-application-state.md (Phase 2)
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { Signal, SignalExtractor } from '../types';
import type { PageContentSignal } from '../page-content/page-content-types';
import type { ObservedItem } from '../page-content/page-content-types';
import type { WireObservedItem, WirePageContentSnapshot } from '../../shared/page-content-wire';

/** ARIA roles that indicate a status badge or notification. */
const STATUS_BADGE_ROLES = new Set(['status', 'alert', 'log']);

/** Tags that indicate a counter/badge element. */
const COUNTER_TAGS = new Set(['BADGE', 'COUNTER']);

/**
 * Pure wire→understanding copy. WireObservedItem is the structural twin of
 * ObservedItem (kind unions identical up to the wire-side 'entity-title'
 * member, which flows through the same status-badge pipeline today).
 */
function wireToObservedItem(item: WireObservedItem): ObservedItem {
  return {
    kind: item.kind as ObservedItem['kind'],
    matchedSelector: item.matchedSelector,
    text: item.text,
    numericValue: item.numericValue,
    entityId: item.entityId,
    entityType: item.entityType,
    domPath: item.domPath,
    attributes: { ...item.attributes },
    visible: item.visible,
  };
}

/** Merge dedup key: kind + ':' + domPath. */
function itemKey(kind: string, domPath: string): string {
  return `${kind}:${domPath}`;
}

/**
 * Derive observed items from behavioral evidence.
 *
 * Sources:
 *   - resultingState.items (Phase 1 snapshot — richest, scanned from the
 *     live DOM at consequence settlement) — merged FIRST so snapshot items
 *     win kind+domPath collisions.
 *   - newSurfaces[] — status badges + surface counters (today's behavior).
 *
 * domChanges[] are intentionally NOT read (see header).
 *
 * Returns the merged items and the raw resultingState snapshot (null when
 * absent) so `extract` can apply the winning source's metadata.
 */
function deriveObservedItems(
  interaction: ComponentInteraction,
): { items: ObservedItem[]; snapshot: WirePageContentSnapshot | null } {
  const evidence = interaction.behavioralEvidence;
  if (!evidence) return { items: [], snapshot: null };

  const app = evidence.applicationEvidence;
  const snapshot: WirePageContentSnapshot | null =
    (app as { resultingState?: WirePageContentSnapshot }).resultingState ?? null;

  const items: ObservedItem[] = [];
  const seen = new Set<string>();

  // Snapshot items first — they win collisions on kind+domPath (richer:
  // real selector, attributes, numeric parse).
  if (snapshot && snapshot.items.length > 0) {
    for (const wireItem of snapshot.items) {
      const item = wireToObservedItem(wireItem);
      const key = itemKey(item.kind, item.domPath);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  // ── New surfaces → status badges, surface-level counters ──
  for (const surface of app.newSurfaces) {
    const role = surface.ariaRole;
    const tag = surface.tagName?.toUpperCase() ?? '';
    const text = surface.accessibleName ?? '';
    const path = surface.path;

    // Status badge / notification — unique contribution of this extractor.
    // No other extractor reads newSurfaces[].
    if (role && STATUS_BADGE_ROLES.has(role)) {
      const key = itemKey('status-badge', path);
      if (!seen.has(key)) {
        seen.add(key);
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
    }

    // Surface-level counters (explicit BADGE/COUNTER tags that appeared).
    // These are absolute-value observations from new surfaces, NOT deltas
    // from domChanges[] — so they don't duplicate CounterSignalExtractor.
    if (COUNTER_TAGS.has(tag)) {
      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) {
        const key = itemKey('counter', path);
        if (!seen.has(key)) {
          seen.add(key);
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
  }

  // NOTE: domChanges[] are NOT processed here for counters/collections.
  // CounterSignalExtractor and ListSignalExtractor already read
  // domChanges[] via SignalExtractionCoordinator, producing counter-change
  // and list-change signals that feed into the same trackers. Re-deriving
  // them here would cause:
  //   - Double-recorded counter values (same elementPath, two record() calls)
  //   - Corrupted collection counts (update() applies delta, then setCount()
  //     overwrites with churn count)

  return { items, snapshot };
}

/**
 * Signal extractor that produces PageContentSignal from behavioral evidence.
 *
 * This bridges M9.4 (PageContentObserver) into the production pipeline by
 * deriving observed items from evidence surfaces and — since Phase 2 —
 * from the resultingState snapshot captured at consequence settlement.
 */
export class PageContentEvidenceExtractor implements SignalExtractor {
  readonly name = 'PageContentEvidenceExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const { items, snapshot } = deriveObservedItems(interaction);
    if (items.length === 0) return [];

    const observedEntities = items.filter((i) => i.kind === 'entity');
    const observedCounters = items.filter((i) => i.kind === 'counter');
    const observedCollections = items.filter((i) => i.kind === 'collection');
    const observedNotifications = items.filter((i) => i.kind === 'notification');
    const observedStatusBadges = items.filter((i) => i.kind === 'status-badge');

    // Metadata follows the winning source: the REAL snapshot values when
    // snapshot items contributed, otherwise the synthetic pre-Phase-2
    // values. (url !== '' doubles as StateBuilder's 'content-observed'
    // discriminator — see state-builder processPageContent.)
    const snapshotWon = snapshot !== null && snapshot.items.length > 0;

    const signal: PageContentSignal = {
      type: 'page-content',
      source: 'page-content',
      interactionId: interaction.interactionId,
      confidence: 0.7,
      snapshot: snapshotWon
        ? {
            viewId: snapshot.viewId,
            url: snapshot.url,
            scannedAt: snapshot.scannedAt,
            items,
            itemsOverflow: snapshot.itemsOverflow,
            scanDurationMs: snapshot.scanDurationMs,
          }
        : {
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

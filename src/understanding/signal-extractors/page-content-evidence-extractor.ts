/**
 * M9.12 D2 — Page Content Signal Extractor (from behavioral evidence)
 *
 * Derives PageContentSignal data from the behavioral evidence captured
 * by M1–M8.  This bridges the gap: the PageContentObserver (M9.4)
 * requires a live DOM scan, which the post-hoc pipeline doesn't have.
 * Instead, we synthesize page-content observations from:
 *
 *   - newSurfaces[]      → status badges, notifications, entities
 *   - removedSurfaces[]  → disappeared notifications
 *   - domChanges[]       → counter changes, collection changes
 *
 * This is NOT a replacement for a live DOM scan — it extracts only
 * what was captured in evidence.  A future version may add a content
 * script scan at recording time for richer page-content data.
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
 * Derive observed items from behavioral evidence surfaces and DOM changes.
 *
 * This is called by the PageContentEvidenceExtractor for each interaction.
 */
function deriveObservedItems(interaction: ComponentInteraction): ObservedItem[] {
  const items: ObservedItem[] = [];
  const evidence = interaction.behavioralEvidence;
  if (!evidence) return items;

  const app = evidence.applicationEvidence;

  // ── New surfaces → status badges, notifications, counters ──
  for (const surface of app.newSurfaces) {
    const role = surface.ariaRole;
    const tag = surface.tagName?.toUpperCase() ?? '';
    const text = surface.accessibleName ?? '';
    const path = surface.path;

    // Status badge / notification
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

    // Counter (explicit counter tags or data-count attributes)
    if (COUNTER_TAGS.has(tag)) {
      const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
      if (!isNaN(num)) {
        items.push({
          kind: 'counter',
          matchedSelector: 'tag-name',
          text,
          numericValue: num,
          entityId: null,
          entityType: null,
          domPath: path,
          attributes: {},
          visible: true,
        });
      }
    }
  }

  // ── DOM changes → counters, collections ──
  for (const domChange of app.domChanges) {
    // Collection changes (childList mutations on list containers)
    if (domChange.types.includes('childList')) {
      // D8: detect collections from BOTH net changes AND full refreshes.
      // Previously, netChange === 0 (N adds + N removes) was silently dropped,
      // making list refreshes invisible. Now we detect any childList activity.
      const totalItems = domChange.addedNodesCount + domChange.removedNodesCount;
      if (totalItems > 0) {
        const netChange = domChange.addedNodesCount - domChange.removedNodesCount;
        items.push({
          kind: 'collection',
          matchedSelector: 'dom-change',
          text: `${totalItems} items changed`,
          numericValue: totalItems,
          entityId: null,
          entityType: null,
          domPath: domChange.targetPath,
          attributes: {
            tag: domChange.targetTag,
            netChange: String(netChange),
          },
          visible: true,
        });
      }
    }

    // Counter changes (characterData on numeric elements)
    if (domChange.types.includes('characterData') && domChange.characterDataDelta) {
      const { old: oldVal, new: newVal } = domChange.characterDataDelta;
      if (oldVal && newVal) {
        const oldNum = parseInt(oldVal.trim(), 10);
        const newNum = parseInt(newVal.trim(), 10);
        if (!isNaN(oldNum) && !isNaN(newNum) && oldVal.trim().length <= 8 && newVal.trim().length <= 8) {
          items.push({
            kind: 'counter',
            matchedSelector: 'dom-change',
            text: `${oldNum} → ${newNum}`,
            numericValue: newNum,
            entityId: null,
            entityType: null,
            domPath: domChange.targetPath,
            attributes: {},
            visible: true,
          });
        }
      }
    }

    // Attribute-based counters (e.g., data-count changing, aria-valuenow)
    if (domChange.types.includes('attributes')) {
      for (const attrName of domChange.changedAttributes) {
        const delta = domChange.attributeDeltas[attrName];
        if (delta && delta.new) {
          const num = parseInt(delta.new, 10);
          // D7: extended to include aria-valuenow, aria-valuetext, data-quantity, data-value, data-progress
          if (!isNaN(num) && /count|total|num|badge|value|quantity|progress/i.test(attrName)) {
            items.push({
              kind: 'counter',
              matchedSelector: 'dom-change',
              text: `${attrName}=${num}`,
              numericValue: num,
              entityId: null,
              entityType: null,
              domPath: domChange.targetPath,
              attributes: { attribute: attrName },
              visible: true,
            });
          }
        }
      }
    }
  }

  return items;
}

/**
 * Signal extractor that produces PageContentSignal from behavioral evidence.
 *
 * This bridges M9.4 (PageContentObserver) into the production pipeline by
 * deriving observed items from evidence surfaces and DOM changes — without
 * requiring a live DOM scan.
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

/**
 * D2/D7/D8 Fix — Cross-Extractor Duplication Regression Tests
 *
 * Verifies:
 *   1. PageContentEvidenceExtractor no longer derives counters or collections
 *      from domChanges (that work is done by CounterSignalExtractor /
 *      ListSignalExtractor).
 *   2. An interaction cannot update the same counter or collection twice.
 *   3. Collection counts remain semantically correct for add/remove/refresh
 *      scenarios (no double-counting).
 *
 * Architecture: D2/D7/D8 defect fix regression tests.
 */

import { describe, it, expect } from 'vitest';
import { PageContentEvidenceExtractor } from '../../src/understanding/signal-extractors/page-content-evidence-extractor';
import { StateBuilder } from '../../src/understanding/state-builder/state-builder';
import type { SignalSet } from '../../src/understanding/types';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { PageContentSignal } from '../../src/understanding/page-content/page-content-types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeInteractionWithDomChanges(
  domChanges: unknown[],
): ComponentInteraction {
  return {
    interactionId: 'int-test',
    type: 'click' as any,
    trigger: {} as any,
    triggerEvent: {} as any,
    memberEvents: [],
    startTime: 0,
    endTime: 1,
    endState: 'completed',
    metadata: {},
    behavioralEvidence: {
      applicationEvidence: {
        newSurfaces: [],
        removedSurfaces: [],
        domChanges: domChanges as any,
      },
    } as any,
  } as unknown as ComponentInteraction;
}

/** Build a minimal PageContentSignal with the given observed items. */
function makePageContentSignal(overrides: {
  observedCounters?: PageContentSignal['observedCounters'];
  observedCollections?: PageContentSignal['observedCollections'];
  observedStatusBadges?: PageContentSignal['observedStatusBadges'];
  observedNotifications?: PageContentSignal['observedNotifications'];
  observedEntities?: PageContentSignal['observedEntities'];
}): PageContentSignal {
  return {
    type: 'page-content',
    source: 'page-content',
    interactionId: 'int-test',
    confidence: 0.7,
    snapshot: {
      url: '',
      viewId: null,
      items: [],
      itemsOverflow: 0,
      scannedAt: 0,
      scanDurationMs: 0,
    },
    observedEntities: overrides.observedEntities ?? [],
    observedCounters: overrides.observedCounters ?? [],
    observedCollections: overrides.observedCollections ?? [],
    observedNotifications: overrides.observedNotifications ?? [],
    observedStatusBadges: overrides.observedStatusBadges ?? [],
  } as PageContentSignal;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('D2/D7/D8 Fix — Cross-Extractor Duplication', () => {
  describe('PageContentEvidenceExtractor no longer derives counters/collections from domChanges', () => {
    const extractor = new PageContentEvidenceExtractor();

    it('produces no signals from characterData mutations (counters)', () => {
      const interaction = makeInteractionWithDomChanges([
        {
          type: 'characterData',
          targetPath: 'div.cart-count',
          targetSnapshot: {
            tag: 'span',
            role: 'generic',
            text: '3',
            ariaLabel: '',
            attributes: {},
          },
          characterDataDelta: '3',
          attributeDeltas: {},
        },
      ]);

      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('produces no signals from childList mutations (collections)', () => {
      const interaction = makeInteractionWithDomChanges([
        {
          type: 'childList',
          targetPath: 'div.cart-items',
          childListSummary: {
            addedCount: 2,
            removedCount: 0,
            added: [],
            removed: [],
          },
          attributeDeltas: {},
        },
      ]);

      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('produces no signals from attribute mutations (data-count)', () => {
      const interaction = makeInteractionWithDomChanges([
        {
          type: 'attributes',
          targetPath: 'div.cart-badge',
          targetSnapshot: {
            tag: 'span',
            role: 'generic',
            text: '3',
            ariaLabel: '',
            attributes: { 'data-count': '3' },
          },
          attributeDeltas: {
            'data-count': { old: '2', new: '3' },
          },
        },
      ]);

      const signals = extractor.extract(interaction);
      expect(signals).toHaveLength(0);
    });

    it('still produces status-badge signals from newSurfaces (unique contribution)', () => {
      const interaction = {
        interactionId: 'int-badge',
        type: 'click',
        trigger: {},
        triggerEvent: {},
        memberEvents: [],
        startTime: 0,
        endTime: 1,
        endState: 'completed',
        metadata: {},
        behavioralEvidence: {
          applicationEvidence: {
            newSurfaces: [
              {
                path: 'div.status',
                ariaRole: 'status',
                tagName: 'div',
                accessibleName: 'Item saved successfully',
              },
            ],
            removedSurfaces: [],
            domChanges: [],
          },
        },
      } as unknown as ComponentInteraction;

      const signals = extractor.extract(interaction);
      expect(signals.length).toBeGreaterThan(0);
    });
  });

  describe('Single interaction cannot double-update the same counter/collection', () => {
    it('StateBuilder dedup guard prevents same counter being processed twice', () => {
      const builder = new StateBuilder();
      const domPath = 'span#cart-count';

      // Simulate signals where both CounterSignalExtractor and
      // PageContentEvidenceExtractor produce a counter for the same dom path.
      const signals: SignalSet = {
        interactionId: 'int-dedup-1',
        viewChanges: [],
        apiOperations: [],
        counterChanges: [
          {
            type: 'counter-change',
            source: 'dom-mutation',
            interactionId: 'int-dedup-1',
            confidence: 1,
            elementPath: domPath,
            oldValue: '2',
            newValue: '3',
            numericDelta: 1,
            label: 'Cart',
          },
        ],
        listChanges: [],
        inputChanges: [],
        notifications: [],
        pageContent: makePageContentSignal({
          observedCounters: [
            {
              kind: 'counter',
              matchedSelector: 'span#cart-count',
              text: '3',
              numericValue: 3,
              entityId: null,
              entityType: null,
              domPath: domPath, // SAME path as counterChanges
              attributes: {},
              visible: true,
            },
          ],
        }) as any,
      };

      const result = builder.processSignals(signals);

      // Counter should only appear once in the state
      expect(result.after.counters.size).toBe(1);

      // The counter ID is counter:${elementPath}
      const counter = result.after.counters.get(`counter:${domPath}`);
      expect(counter).toBeDefined();

      // Counter values should have exactly one entry — no duplicate
      expect(counter!.values.length).toBe(1);
      expect(counter!.values[0].value).toBe('3');
    });

    it('StateBuilder dedup guard prevents same collection being processed twice', () => {
      const builder = new StateBuilder();
      const containerPath = 'div.search-results';

      const signals: SignalSet = {
        interactionId: 'int-dedup-2',
        viewChanges: [],
        apiOperations: [],
        counterChanges: [],
        listChanges: [
          {
            type: 'list-change',
            source: 'dom-mutation',
            interactionId: 'int-dedup-2',
            confidence: 1,
            containerPath: containerPath,
            containerTag: 'div',
            addedCount: 2,
            removedCount: 0,
            netChange: 2,
          },
        ],
        inputChanges: [],
        notifications: [],
        pageContent: makePageContentSignal({
          observedCollections: [
            {
              kind: 'collection',
              matchedSelector: 'div.search-results',
              text: '',
              numericValue: 2,
              entityId: null,
              entityType: null,
              domPath: containerPath, // SAME path as listChanges
              attributes: {},
              visible: true,
            },
          ],
        }) as any,
      };

      const result = builder.processSignals(signals);

      // Collection should only appear once
      expect(result.after.collections.size).toBe(1);
    });
  });

  describe('Collection counts remain semantically correct for add/remove/refresh', () => {
    it('refresh scenario: 1 add + 1 remove does not inflate collection count', () => {
      const builder = new StateBuilder();
      const containerPath = 'div.cart-items';

      // First interaction: initial 2 items in collection
      const signals1: SignalSet = {
        interactionId: 'int-cart-1',
        viewChanges: [],
        apiOperations: [],
        counterChanges: [],
        listChanges: [
          {
            type: 'list-change',
            source: 'dom-mutation',
            interactionId: 'int-cart-1',
            confidence: 1,
            containerPath: containerPath,
            containerTag: 'div',
            addedCount: 2,
            removedCount: 0,
            netChange: 2,
          },
        ],
        inputChanges: [],
        notifications: [],
        pageContent: null,
      };

      builder.processSignals(signals1);

      // Second interaction: refresh — 1 add + 1 remove (net zero change)
      // The collection count should remain 2, not become 3 or 4.
      const signals2: SignalSet = {
        interactionId: 'int-cart-2',
        viewChanges: [],
        apiOperations: [],
        counterChanges: [],
        listChanges: [
          {
            type: 'list-change',
            source: 'dom-mutation',
            interactionId: 'int-cart-2',
            confidence: 1,
            containerPath: containerPath,
            containerTag: 'div',
            addedCount: 1,
            removedCount: 1,
            netChange: 0,
          },
        ],
        inputChanges: [],
        notifications: [],
        pageContent: null,
      };

      const result2 = builder.processSignals(signals2);

      const collection = result2.after.collections.get(`collection:${containerPath}`);
      expect(collection).toBeDefined();
      expect(collection!.count).toBe(2); // NOT inflated — 2 + 1 - 1 = 2
    });
  });
});

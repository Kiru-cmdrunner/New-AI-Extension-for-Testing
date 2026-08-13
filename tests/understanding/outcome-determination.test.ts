/**
 * M9.3 - Outcome Determination + Action/Outcome Relationships
 * Focused tests.
 *
 * Covers:
 *  - Success outcome from corroborating signals
 *  - Failure outcome from API error
 *  - Ambiguous outcome from conflicting signals
 *  - Incomplete outcome from empty SignalSet
 *  - Confidence scoring and levels
 *  - Supporting evidence provenance
 *  - Resulting entity tracking
 *  - Amazon workflow validation
 *  - RelationshipTracker queries
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OutcomeDeterminer } from '../../src/understanding/outcome/outcome-determiner';
import { RelationshipTracker } from '../../src/understanding/outcome/relationship-tracker';
import type { OutcomeDeterminerInput } from '../../src/understanding/outcome/outcome-types';
import type { SignalSet } from '../../src/understanding/types';
import type { StateTransition } from '../../src/understanding/state-builder/types';
import type { InteractionType } from '../../src/shared/component-types';

// -- Fixtures --

function makeSignalSet(interactionId: string, overrides: Partial<SignalSet> = {}): SignalSet {
  return {
    interactionId,
    viewChanges: [],
    apiOperations: [],
    notifications: [],
    counterChanges: [],
    listChanges: [],
    inputChanges: [],
    pageContent: null,
    ...overrides,
  };
}

function makeInput(
  interactionId: string,
  actionType: InteractionType,
  actionTarget: string,
  signals: SignalSet,
  transition: StateTransition | null = null,
): OutcomeDeterminerInput {
  return { interactionId, actionType, actionTarget, signals, transition };
}

function makeTransition(iid: string, changes: string[]): StateTransition {
  const emptyState = {
    currentView: null,
    currentUrl: null,
    entities: new Map(),
    collections: new Map(),
    counters: new Map(),
    notifications: [],
    lastInteractionId: null,
    interactionCount: 0,
  };
  return {
    interactionId: iid,
    before: emptyState,
    after: { ...emptyState, lastInteractionId: iid, interactionCount: 1 },
    changes,
  };
}

const SEARCH_VIEW = { id: 'search-results', label: 'Search Results', detectedFrom: 'url-pattern' as const, confidence: 0.9 };
const CART_CONFIRM_VIEW = { id: 'cart-confirmation', label: 'Cart Confirmation', detectedFrom: 'url-pattern' as const, confidence: 0.9 };

// -- Success outcomes --

describe('M9.3 OutcomeDeterminer - success outcomes', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('determines success from API success + notification', () => {
    const signals = makeSignalSet('int-20', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-20',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/cart/add',
          outcomeHint: null,
        },
      ],
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-20',
          confidence: 0.8,
          text: 'Added to Cart',
          severity: 'success',
          kind: 'appeared',
          elementPath: 'div#confirm',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-20', 'Click', 'Add to Cart', signals),
    );

    expect(result.outcome).toBe('success');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.confidenceLevel).not.toBe('inconclusive');
    expect(result.supportingEvidence.length).toBe(2);
  });

  it('determines success from cart counter increment + view change', () => {
    const signals = makeSignalSet('int-20', {
      counterChanges: [
        {
          type: 'counter-change',
          source: 'dom-mutation',
          interactionId: 'int-20',
          confidence: 0.8,
          elementPath: '#nav-cart-count',
          oldValue: '0',
          newValue: '1',
          numericDelta: 1,
          label: null,
        },
      ],
      viewChanges: [
        {
          type: 'view-change',
          source: 'navigation-url',
          interactionId: 'int-20',
          confidence: 0.9,
          fromView: SEARCH_VIEW,
          toView: CART_CONFIRM_VIEW,
          fromUrl: 'https://example.com/s?k=vivo',
          toUrl: 'https://example.com/cart/add-to-cart/',
          navigationType: 'full-reload',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-20', 'Click', 'Add to Cart', signals),
    );

    expect(result.outcome).toBe('success');
    expect(result.confidence).toBeGreaterThanOrEqual(0.4);
    expect(result.supportingEvidence.length).toBe(2);
  });

  it('determines success from list growth', () => {
    const signals = makeSignalSet('int-15', {
      listChanges: [
        {
          type: 'list-change',
          source: 'dom-mutation',
          interactionId: 'int-15',
          confidence: 0.7,
          containerPath: 'div.results',
          containerTag: 'div',
          addedCount: 10,
          removedCount: 0,
          netChange: 10,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-15', 'Click', 'Load More', signals),
    );

    expect(result.outcome).toBe('success');
    expect(result.supportingEvidence.length).toBe(1);
  });

  it('records action type and target in the outcome', () => {
    const result = determiner.determine(
      makeInput('int-5', 'Click', 'Submit Button', makeSignalSet('int-5')),
    );

    expect(result.actionType).toBe('Click');
    expect(result.actionTarget).toBe('Submit Button');
    expect(result.interactionId).toBe('int-5');
  });
});

// -- Failure outcomes --

describe('M9.3 OutcomeDeterminer - failure outcomes', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('determines failure from API error', () => {
    const signals = makeSignalSet('int-10', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-10',
          confidence: 0.8,
          operation: 'submit-form',
          method: 'POST',
          status: 500,
          succeeded: false,
          url: 'https://example.com/api/submit',
          outcomeHint: null,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-10', 'Click', 'Submit', signals),
    );

    expect(result.outcome).toBe('failure');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    expect(result.supportingEvidence[0].result).toBe('failure');
  });

  it('determines failure from error notification', () => {
    const signals = makeSignalSet('int-10', {
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-10',
          confidence: 0.8,
          text: 'Something went wrong',
          severity: 'error',
          kind: 'appeared',
          elementPath: 'div#error',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-10', 'Click', 'Submit', signals),
    );

    expect(result.outcome).toBe('failure');
    expect(result.supportingEvidence.length).toBe(1);
  });

  it('determines failure from counter decrease on add-type action', () => {
    const signals = makeSignalSet('int-10', {
      counterChanges: [
        {
          type: 'counter-change',
          source: 'dom-mutation',
          interactionId: 'int-10',
          confidence: 0.8,
          elementPath: '#cart-count',
          oldValue: '5',
          newValue: '3',
          numericDelta: -2,
          label: null,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-10', 'Click', 'Add to Cart', signals),
    );

    expect(result.outcome).toBe('failure');
  });
});

// -- Ambiguous outcomes --

describe('M9.3 OutcomeDeterminer - ambiguous outcomes', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('produces ambiguous when success and failure signals both present and balanced', () => {
    const signals = makeSignalSet('int-15', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-15',
          confidence: 0.8,
          operation: 'submit-form',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/api/submit',
          outcomeHint: null,
        },
      ],
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-15',
          confidence: 0.8,
          text: 'Validation failed',
          severity: 'error',
          kind: 'appeared',
          elementPath: 'div#error',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-15', 'Click', 'Submit', signals),
    );

    // API success (0.4) vs error notification (0.4) -> both present, ratio = 1.0 > 0.3
    expect(result.outcome).toBe('ambiguous');
    expect(result.supportingEvidence.length).toBe(2);
  });

  it('does NOT produce ambiguous when one side is much weaker', () => {
    const signals = makeSignalSet('int-15', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-15',
          confidence: 0.8,
          operation: 'submit-form',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/api/submit',
          outcomeHint: null,
        },
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-15',
          confidence: 0.8,
          operation: 'submit-form',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/api/submit2',
          outcomeHint: null,
        },
      ],
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-15',
          confidence: 0.8,
          text: 'Warning: review later',
          severity: 'warning',
          kind: 'appeared',
          elementPath: 'div#warn',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-15', 'Click', 'Submit', signals),
    );

    // Success 0.8 vs failure 0.15 -> ratio 0.19 < 0.3 -> not ambiguous
    expect(result.outcome).toBe('success');
  });
});

// -- Incomplete outcomes --

describe('M9.3 OutcomeDeterminer - incomplete outcomes', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('determines incomplete when no signals and no transition', () => {
    const result = determiner.determine(
      makeInput('int-19', 'Click', 'Add to Cart', makeSignalSet('int-19')),
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.confidence).toBe(0);
    expect(result.confidenceLevel).toBe('inconclusive');
    expect(result.supportingEvidence.length).toBe(0);
  });

  it('determines incomplete when no signals and empty transition', () => {
    const result = determiner.determine(
      makeInput('int-19', 'Click', 'Add to Cart', makeSignalSet('int-19'), makeTransition('int-19', [])),
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.confidence).toBe(0);
  });

  it('never claims success when evidence is incomplete', () => {
    const result = determiner.determine(
      makeInput('int-19', 'Click', 'Add to Cart', makeSignalSet('int-19')),
    );

    expect(result.outcome).not.toBe('success');
  });
});

// -- Confidence levels --

describe('M9.3 OutcomeDeterminer - confidence levels', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('reaches confirmed with strong corroboration', () => {
    const signals = makeSignalSet('int-20', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-20',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/cart/add',
          outcomeHint: null,
        },
      ],
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-20',
          confidence: 0.8,
          text: 'Added to Cart',
          severity: 'success',
          kind: 'appeared',
          elementPath: 'div#confirm',
        },
      ],
      counterChanges: [
        {
          type: 'counter-change',
          source: 'dom-mutation',
          interactionId: 'int-20',
          confidence: 0.8,
          elementPath: '#cart-count',
          oldValue: '0',
          newValue: '1',
          numericDelta: 1,
          label: null,
        },
      ],
      viewChanges: [
        {
          type: 'view-change',
          source: 'navigation-url',
          interactionId: 'int-20',
          confidence: 0.9,
          fromView: SEARCH_VIEW,
          toView: CART_CONFIRM_VIEW,
          fromUrl: 'https://example.com/dp/B0XYZ12345',
          toUrl: 'https://example.com/cart/add-to-cart/',
          navigationType: 'full-reload',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-20', 'Click', 'Add to Cart', signals),
    );

    // 0.4 (api) + 0.3 (notif) + 0.2 (counter) + 0.25 (view) = 1.15 capped to 1.0
    expect(result.outcome).toBe('success');
    expect(result.confidence).toBe(1.0);
    expect(result.confidenceLevel).toBe('confirmed');
  });

  it('a single API success alone reaches possible but not likely', () => {
    const signals = makeSignalSet('int-10', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-10',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/cart/add',
          outcomeHint: null,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-10', 'Click', 'Add to Cart', signals),
    );

    expect(result.confidence).toBe(0.4);
    // 0.4 is below the 0.5 threshold for 'possible'
    expect(result.confidenceLevel).toBe('inconclusive');
  });
});

// -- Resulting entities tracking --

describe('M9.3 OutcomeDeterminer - resulting entities', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('tracks new entities from the state transition', () => {
    const beforeState = {
      currentView: null,
      currentUrl: null,
      entities: new Map(),
      collections: new Map(),
      counters: new Map(),
      notifications: [],
      lastInteractionId: null,
      interactionCount: 0,
    };
    const afterState = {
      ...beforeState,
      entities: new Map([
        ['product:B0XYZ12345', {
          id: 'product:B0XYZ12345',
          type: 'product' as const,
          attributes: { asin: 'B0XYZ12345' },
          source: 'view-derived' as const,
          firstSeenAt: 'int-17',
          lastUpdated: 'int-17',
        }],
      ]),
      lastInteractionId: 'int-17',
      interactionCount: 1,
    };

    const transition: StateTransition = {
      interactionId: 'int-17',
      before: beforeState,
      after: afterState,
      changes: ['product entity: B0XYZ12345'],
    };

    const result = determiner.determine(
      makeInput('int-17', 'Click', 'Product Link', makeSignalSet('int-17'), transition),
    );

    expect(result.resultingEntities).toContain('product:B0XYZ12345');
    expect(result.stateChanges).toContain('product entity: B0XYZ12345');
  });

  it('records state changes from the transition', () => {
    const transition = makeTransition('int-5', ['view -> cart', 'counter: 0 -> 1']);
    const result = determiner.determine(
      makeInput('int-5', 'Click', 'Add', makeSignalSet('int-5'), transition),
    );

    expect(result.stateChanges.length).toBe(2);
    expect(result.stateChanges).toContain('view -> cart');
  });
});

// -- Amazon workflow --

describe('M9.3 OutcomeDeterminer - Amazon workflow', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('Add to cart interaction with full evidence yields confirmed success', () => {
    const signals: SignalSet = makeSignalSet('int-20', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-20',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/cart/add-to-cart/json',
          outcomeHint: null,
        },
      ],
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-20',
          confidence: 0.8,
          text: 'Added to Cart',
          severity: 'success',
          kind: 'appeared',
          elementPath: 'div#sw-atc-confirmation',
        },
      ],
      counterChanges: [
        {
          type: 'counter-change',
          source: 'dom-mutation',
          interactionId: 'int-20',
          confidence: 0.8,
          elementPath: '#nav-cart-count',
          oldValue: '0',
          newValue: '1',
          numericDelta: 1,
          label: null,
        },
      ],
      viewChanges: [
        {
          type: 'view-change',
          source: 'navigation-url',
          interactionId: 'int-20',
          confidence: 0.9,
          fromView: SEARCH_VIEW,
          toView: CART_CONFIRM_VIEW,
          fromUrl: 'https://example.com/dp/B0XYZ12345',
          toUrl: 'https://example.com/cart/add-to-cart/',
          navigationType: 'full-reload',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-20', 'Click', 'Add to Cart', signals),
    );

    expect(result.outcome).toBe('success');
    expect(result.confidenceLevel).toBe('confirmed');
    expect(result.supportingEvidence.length).toBeGreaterThanOrEqual(3);
    // Each piece of evidence has provenance
    for (const ev of result.supportingEvidence) {
      expect(ev.interactionId).toBe('int-20');
    }
  });

  it('int-19 (0ms window) yields incomplete - no false positive', () => {
    const result = determiner.determine(
      makeInput('int-19', 'Click', 'Add to Cart', makeSignalSet('int-19')),
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.confidence).toBe(0);
    expect(result.supportingEvidence.length).toBe(0);
  });

  it('Search interaction with results list growth yields success', () => {
    const signals = makeSignalSet('int-11', {
      viewChanges: [
        {
          type: 'view-change',
          source: 'navigation-url',
          interactionId: 'int-11',
          confidence: 0.9,
          fromView: null,
          toView: SEARCH_VIEW,
          fromUrl: 'https://example.com/',
          toUrl: 'https://example.com/s?k=vivo',
          navigationType: 'full-reload',
        },
      ],
      listChanges: [
        {
          type: 'list-change',
          source: 'dom-mutation',
          interactionId: 'int-11',
          confidence: 0.7,
          containerPath: 'div.s-main-slot',
          containerTag: 'div',
          addedCount: 48,
          removedCount: 0,
          netChange: 48,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-11', 'TextEntry', 'Search', signals),
    );

    expect(result.outcome).toBe('success');
    expect(result.supportingEvidence.length).toBeGreaterThanOrEqual(1);
  });
});

// -- RelationshipTracker --

describe('M9.3 RelationshipTracker', () => {
  let tracker: RelationshipTracker;
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    tracker = new RelationshipTracker();
    determiner = new OutcomeDeterminer();
  });

  it('records and retrieves outcomes', () => {
    const outcome = determiner.determine(
      makeInput('int-1', 'Click', 'Button', makeSignalSet('int-1')),
    );
    tracker.record(outcome);

    expect(tracker.size).toBe(1);
    expect(tracker.get('int-1')).toBeDefined();
    expect(tracker.get('int-1')?.outcome).toBe('incomplete');
  });

  it('filters by outcome category', () => {
    const success = determiner.determine(
      makeInput('int-1', 'Click', 'Add', makeSignalSet('int-1', {
        apiOperations: [{
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-1',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/add',
          outcomeHint: null,
        }],
      })),
    );
    const incomplete = determiner.determine(
      makeInput('int-2', 'Click', 'Button', makeSignalSet('int-2')),
    );
    tracker.record(success);
    tracker.record(incomplete);

    expect(tracker.getByOutcome('success').length).toBe(1);
    expect(tracker.getByOutcome('incomplete').length).toBe(1);
    expect(tracker.getByOutcome('failure').length).toBe(0);
  });

  it('filters by action type', () => {
    tracker.record(determiner.determine(
      makeInput('int-1', 'Click', 'A', makeSignalSet('int-1')),
    ));
    tracker.record(determiner.determine(
      makeInput('int-2', 'TextEntry', 'B', makeSignalSet('int-2')),
    ));

    expect(tracker.getByActionType('Click').length).toBe(1);
    expect(tracker.getByActionType('TextEntry').length).toBe(1);
  });

  it('produces a human-readable chain', () => {
    const outcome = determiner.determine(
      makeInput('int-20', 'Click', 'Add to Cart', makeSignalSet('int-20', {
        apiOperations: [{
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-20',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/add',
          outcomeHint: null,
        }],
      })),
    );
    tracker.record(outcome);

    const chain = tracker.getChain();
    expect(chain.length).toBe(1);
    expect(chain[0]).toContain('Click');
    expect(chain[0]).toContain('Add to Cart');
    expect(chain[0]).toContain('success');
  });

  it('produces summary counts', () => {
    tracker.record(determiner.determine(
      makeInput('int-1', 'Click', 'A', makeSignalSet('int-1', {
        apiOperations: [{
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-1',
          confidence: 0.8,
          operation: 'add-to-cart',
          method: 'POST',
          status: 200,
          succeeded: true,
          url: 'https://example.com/add',
          outcomeHint: null,
        }],
      })),
    ));
    tracker.record(determiner.determine(
      makeInput('int-2', 'Click', 'B', makeSignalSet('int-2')),
    ));

    const summary = tracker.getSummary();
    expect(summary.total).toBe(2);
    expect(summary.success).toBe(1);
    expect(summary.incomplete).toBe(1);
  });

  it('clears all outcomes', () => {
    tracker.record(determiner.determine(
      makeInput('int-1', 'Click', 'A', makeSignalSet('int-1')),
    ));
    tracker.clear();
    expect(tracker.size).toBe(0);
  });
});

// -- Analytics/resource exclusion --

describe('M9.3 OutcomeDeterminer - signal filtering', () => {
  let determiner: OutcomeDeterminer;

  beforeEach(() => {
    determiner = new OutcomeDeterminer();
  });

  it('ignores analytics and resource API operations', () => {
    const signals = makeSignalSet('int-1', {
      apiOperations: [
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-1',
          confidence: 0.8,
          operation: 'analytics',
          method: 'GET',
          status: 200,
          succeeded: true,
          url: 'https://example.com/analytics',
          outcomeHint: null,
        },
        {
          type: 'api-operation',
          source: 'network-url',
          interactionId: 'int-1',
          confidence: 0.8,
          operation: 'resource',
          method: 'GET',
          status: 200,
          succeeded: true,
          url: 'https://example.com/img.png',
          outcomeHint: null,
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-1', 'Click', 'Button', signals),
    );

    expect(result.outcome).toBe('incomplete');
    expect(result.supportingEvidence.length).toBe(0);
  });

  it('ignores notification disappearance for outcome', () => {
    const signals = makeSignalSet('int-1', {
      notifications: [
        {
          type: 'notification',
          source: 'surface',
          interactionId: 'int-1',
          confidence: 0.8,
          text: 'Added to Cart',
          severity: 'success',
          kind: 'disappeared',
          elementPath: 'div#confirm',
        },
      ],
    });

    const result = determiner.determine(
      makeInput('int-1', 'Click', 'Button', signals),
    );

    expect(result.outcome).toBe('incomplete');
  });
});

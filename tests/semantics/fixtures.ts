/**
 * Test data builders — produce synthetic ObservationResults, snapshots,
 * mutations, and contexts for unit testing the effect rules.
 */

import type {
  ObservationResult,
  ElementStateSnapshot,
  MutationRecord2,
} from '../../src/shared/observation-types';
import type { InterpretationContext } from '../../src/semantics/interpretation-context';

let mutIdCounter = 0;

/**
 * Reset the mutation ID counter (call in beforeEach to keep IDs deterministic).
 */
export function resetMutIds(): void {
  mutIdCounter = 0;
}

/**
 * Build a complete ElementStateSnapshot with sensible defaults.
 * Override any field via the overrides object.
 */
export function makeSnapshot(
  overrides: Partial<ElementStateSnapshot> = {},
): ElementStateSnapshot {
  return {
    value: null,
    checked: null,
    className: '',
    disabled: false,
    ariaExpanded: null,
    ariaChecked: null,
    ariaPressed: null,
    textContent: null,
    childCount: 0,
    capturedAt: Date.now(),
    ...overrides,
  };
}

/**
 * Build a single MutationRecord2 with sensible defaults.
 * Override any field via the overrides object.
 */
export function makeMutation(
  overrides: Partial<MutationRecord2> = {},
): MutationRecord2 {
  return {
    id: mutIdCounter++,
    type: 'attributes',
    targetPath: 'body > div',
    targetTag: 'DIV',
    attributeName: null,
    oldValue: null,
    newValue: null,
    addedNodesCount: 0,
    removedNodesCount: 0,
    timestamp: 0,
    windowIds: ['obs-evt-test-001'],
    ...overrides,
  };
}

/**
 * Build a complete ObservationResult with sensible defaults.
 * Override any field via the overrides object.
 */
export function makeResult(
  overrides: Partial<ObservationResult> = {},
): ObservationResult {
  return {
    sourceEventId: 'evt-test-001',
    sourceEventType: 'click',
    windowId: 'obs-evt-test-001',
    openedAt: 1000,
    closedAt: 4000,
    durationMs: 3000,
    endReason: 'completed',
    beforeSnapshot: null,
    finalSnapshot: null,
    mutations: [],
    mutationCount: 0,
    documentWideMutationTotal: 0,
    performanceCondition: null,
    ...overrides,
  };
}

/**
 * Build an InterpretationContext with sensible defaults.
 * Override any field via the overrides object.
 */
export function makeContext(
  overrides: Partial<InterpretationContext> = {},
): InterpretationContext {
  return {
    interactionType: 'Click',
    triggerRole: 'checkbox',
    triggerLabel: 'Test Checkbox',
    triggerCssPath: 'body > div.checkbox',
    ...overrides,
  };
}

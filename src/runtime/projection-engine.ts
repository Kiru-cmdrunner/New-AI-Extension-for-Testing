/**
 * Projection Engine — Disposition-Based Interaction Projection
 *
 * Milestone 4 of the End-to-End Capture Guarantee.
 *
 * Pure function: takes the EvidenceLedger (with final dispositions) and
 * the completed interactions, returns the complete interaction list:
 *
 *   [...completedInteractions] + Unclassified for each ledger entry with
 *   disposition 'unclaimed' or 'pending'.
 *
 * The Projection Engine does NOT reconstruct, match, or recover. It simply
 * projects entries by their final disposition. The runtime already decided
 * what happened to each event — the Projection Engine makes the output
 * visible.
 *
 * INV-PE-1: output = completedInteractions + Unclassified(unclaimed/pending)
 * INV-PE-2: every discrete event is represented (claimed by interaction or Unclassified)
 */

import type { EvidenceLedger, LedgerEntry } from './evidence-ledger';
import type { ComponentInteraction, InteractionType } from '../shared/component-types';

/**
 * Create an Unclassified interaction from a ledger entry.
 * The entry carries enough metadata to produce a meaningful interaction.
 */
function createUnclassifiedFromLedger(
  entry: LedgerEntry,
  interactionCounter: { value: number },
): ComponentInteraction {
  interactionCounter.value++;
  return {
    interactionId: `int-${interactionCounter.value}`,
    type: 'Unclassified' as InteractionType,
    trigger: {
      accessibleName: '',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'UNKNOWN',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: '',
      xPath: '',
      inIframe: false,
      shadowDom: false,
      href: null,
      elementId: '',
    },
    triggerEvent: {
      eventId: entry.eventId,
      eventType: entry.eventType as any,
      timestamp: entry.timestamp,
      captureSeq: entry.captureSeq,
      isTrusted: true,
      target: {
        accessibleName: '',
        ariaRole: null,
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'UNKNOWN',
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: '',
        xPath: '',
        inIframe: false,
        shadowDom: false,
        href: null,
        elementId: '',
      },
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
        tabIndex: null,
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: null,
      clientY: null,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: '',
      pageTitle: '',
    },
    memberEvents: [],
    startTime: entry.timestamp,
    endTime: entry.timestamp,
    endState: 'completed',
    metadata: {
      physicalEventType: entry.eventType,
      recognized: false,
      reason: 'unclaimed-at-projection',
      targetName: '',
      targetTag: 'UNKNOWN',
      targetRole: null,
    },
  };
}

/**
 * Result of projecting interactions from the ledger + completed interactions.
 */
export interface ProjectionResult {
  /** The complete interaction list (completed + Unclassified from unclaimed). */
  interactions: ComponentInteraction[];
  /** The Unclassified interactions generated from unclaimed/pending entries. */
  projectedUnclassified: ComponentInteraction[];
  /** The ledger entries that were projected (unclaimed/pending). */
  projectedEntries: LedgerEntry[];
}

/**
 * Project the complete interaction list from the EvidenceLedger and
 * completed interactions.
 *
 * Algorithm:
 * 1. Start with all completed interactions (as-is).
 * 2. Find all ledger entries with disposition 'unclaimed' or 'pending'.
 * 3. Create an Unclassified interaction for each.
 * 4. Merge into a single list, preserving (pageId, captureSeq) ordering
 *    for projected entries. Completed interactions stay in their original order.
 *
 * @param ledger The EvidenceLedger with final dispositions.
 * @param completedInteractions The interactions already emitted by the runtime.
 * @returns ProjectionResult with the full interaction list.
 */
export function projectInteractions(
  ledger: EvidenceLedger,
  completedInteractions: ComponentInteraction[],
): ProjectionResult {
  // Find all entries that need to be projected as Unclassified
  const unclaimedEntries = ledger.getByDisposition('unclaimed');
  const pendingEntries = ledger.getByDisposition('pending');
  const toProject = [...unclaimedEntries, ...pendingEntries];

  // Deduplicate (an entry could theoretically appear in both lists if
  // getByDisposition has a bug, but it can't — each entry has one disposition)
  const seen = new Set<string>();
  const uniqueEntries = toProject.filter((e) => {
    if (seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });

  // Determine the interaction counter starting point from completed interactions
  let maxCounter = 0;
  for (const interaction of completedInteractions) {
    const match = interaction.interactionId.match(/^int-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxCounter) maxCounter = num;
    }
  }
  const counter = { value: maxCounter };

  // Create Unclassified interactions for each unclaimed/pending entry
  const projectedUnclassified = uniqueEntries.map((entry) =>
    createUnclassifiedFromLedger(entry, counter),
  );

  // Merge: completed interactions + projected Unclassified
  // Completed interactions stay in their original order.
  // Projected Unclassified are appended at the end (they'll be sorted
  // by the caller if needed, or the consumer handles ordering).
  const interactions = [...completedInteractions, ...projectedUnclassified];

  return {
    interactions,
    projectedUnclassified,
    projectedEntries: uniqueEntries,
  };
}

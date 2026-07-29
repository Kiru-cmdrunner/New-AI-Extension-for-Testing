/**
 * Event Grouper — Phase 4
 *
 * Merges related EvidenceBatches into InteractionCandidates.
 *
 * The grouper is the first stage of the recognition pipeline. It looks at
 * the sequence of EvidenceBatches and decides which ones belong together
 * as a single user interaction. For example:
 *
 *   focus → input → input → blur  on the same text field
 *   = one TextEntry interaction
 *
 *   click (dropdown trigger) → click (option)
 *   = one Select interaction
 *
 * Design (synthesized from three reference implementations):
 *
 * - **Same-element grouping**: batches targeting the same element within a
 *   time window (500ms standard, 30s for text-entry/dropdown) are merged.
 * - **Cross-element grouping**: dropdown trigger → option, date picker →
 *   calendar cell. Detected via ARIA semantics (combobox→listbox→option,
 *   aria-haspopup, gridcell).
 * - **Standalone events**: scroll, navigation, contextmenu, dblclick are
 *   never grouped with other events.
 * - **Two clicks on the same element** = two separate interactions.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceBatch, BatchId } from '../../types/evidence';
import type { TargetElementIdentity } from '../../types/element';

// ── Constants ────────────────────────────────────────────────────────────

const STANDARD_GROUP_WINDOW_MS = 500;
const EXTENDED_GROUP_WINDOW_MS = 30_000; // text-entry, dropdown

/** Events that should never be grouped with other events. */
const STANDALONE_EVENTS = new Set([
  'scroll', 'navigation', 'contextmenu', 'dblclick',
]);

/** Events that should never be grouped with other events. */

/**
 * A group of related EvidenceBatches that form one user interaction.
 *
 * The recognition pipeline evaluates each candidate against pattern
 * definitions to determine the interaction verb and component type.
 */
export interface InteractionCandidate {
  /** Batches that make up this interaction, in chronological order. */
  batches: EvidenceBatch[];
  /** ID of the first batch (primary). */
  primaryBatchId: BatchId;
  /** Element identity from the first batch. */
  primaryTarget: TargetElementIdentity;
  /** All event types across all batches, in order. */
  eventSequence: string[];
  /** Earliest timestamp. */
  startedAt: string;
  /** Latest timestamp. */
  endedAt: string;
  /** Whether this candidate spans multiple elements. */
  isMultiElement: boolean;
  /** Whether this candidate contains only standalone events. */
  isStandalone: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Get a stable element key for grouping purposes.
 *
 * Uses the primary locator's value, falling back to tag name.
 * Two batches with the same element key target the same element.
 */
function elementKey(target: TargetElementIdentity): string {
  return target.primaryLocator?.value ?? target.tag;
}

/**
 * Check if an event type is standalone (never grouped).
 */
function isStandaloneEvent(eventType: string): boolean {
  return STANDALONE_EVENTS.has(eventType);
}

/**
 * Determine if two targets are the same element.
 */
function isSameElement(a: TargetElementIdentity, b: TargetElementIdentity): boolean {
  return elementKey(a) === elementKey(b);
}

/**
 * Check if two elements are semantically related (cross-element grouping).
 *
 * This handles:
 * - Dropdown trigger (combobox/listbox/select) → option (role=option)
 * - DatePicker trigger → calendar cell (role=gridcell)
 * - Any element with aria-haspopup → the popup content
 */
function areSemanticallyRelated(
  trigger: TargetElementIdentity,
  candidate: TargetElementIdentity,
): boolean {
  // Dropdown: trigger has combobox/listbox role or aria-haspopup=listbox
  if (
    trigger.ariaRole === 'combobox' ||
    trigger.ariaRole === 'listbox' ||
    trigger.tag === 'SELECT' ||
    trigger.ariaHasPopup === 'listbox'
  ) {
    if (candidate.ariaRole === 'option') return true;
    // OXD-style: option inside a div with combobox class
    if (candidate.tag === 'LI' || candidate.tag === 'DIV') return true;
  }

  // DatePicker: trigger has date input type or aria-haspopup=dialog
  if (
    trigger.inputType?.startsWith('date') ||
    trigger.inputType?.startsWith('time') ||
    trigger.ariaHasPopup === 'dialog'
  ) {
    if (candidate.ariaRole === 'gridcell') return true;
    if (candidate.ariaRole === 'option' && candidate.tag === 'TD') return true;
  }

  // Menu: trigger has aria-haspopup=menu
  if (trigger.ariaHasPopup === 'menu') {
    if (
      candidate.ariaRole === 'menuitem' ||
      candidate.ariaRole === 'menuitemcheckbox' ||
      candidate.ariaRole === 'menuitemradio'
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a batch represents a click event.
 */
function isClickEvent(batch: EvidenceBatch): boolean {
  return batch.eventSequence.includes('click') ||
         batch.eventSequence.includes('mousedown');
}

/**
 * Get the timestamp of a batch as a number.
 */
function batchTime(batch: EvidenceBatch): number {
  return new Date(batch.startedAt).getTime();
}

/**
 * Determine if the extended grouping window applies.
 */
function usesExtendedWindow(target: TargetElementIdentity): boolean {
  // Text-entry elements
  if (
    target.tag === 'TEXTAREA' ||
    target.tag === 'INPUT' ||
    target.ariaRole === 'textbox' ||
    target.isContentEditable
  ) {
    return true;
  }
  // Select/dropdown elements
  if (
    target.tag === 'SELECT' ||
    target.ariaRole === 'combobox' ||
    target.ariaRole === 'listbox'
  ) {
    return true;
  }
  return false;
}

// ── Event Grouper ────────────────────────────────────────────────────────

/**
 * Group EvidenceBatches into InteractionCandidates.
 *
 * Algorithm:
 * 1. Sort batches chronologically.
 * 2. Iterate, maintaining a "current group" buffer.
 * 3. For each batch:
 *    a. If standalone → flush current group, emit batch as standalone candidate.
 *    b. If same element as current group AND within time window → add to group.
 *       BUT: two clicks on the same element = separate interactions.
 *    c. If semantically related to current group's trigger → add to group.
 *    d. Otherwise → flush current group, start new group.
 * 4. Flush remaining group.
 *
 * @param batches EvidenceBatches in any order (will be sorted)
 * @returns InteractionCandidates in chronological order
 */
export function groupBatches(batches: EvidenceBatch[]): InteractionCandidate[] {
  if (batches.length === 0) return [];

  // Sort chronologically by startedAt
  const sorted = [...batches].sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
  );

  const candidates: InteractionCandidate[] = [];
  let currentGroup: EvidenceBatch[] = [];

  function flushGroup() {
    if (currentGroup.length === 0) return;
    candidates.push(makeCandidate(currentGroup));
    currentGroup = [];
  }

  for (let i = 0; i < sorted.length; i++) {
    const batch = sorted[i];

    // Standalone events are never grouped
    if (batch.eventSequence.some((e) => isStandaloneEvent(e))) {
      flushGroup();
      currentGroup = [batch];
      flushGroup();
      continue;
    }

    if (currentGroup.length === 0) {
      currentGroup = [batch];
      continue;
    }

    const trigger = currentGroup[0];
    const triggerTarget = trigger.target;
    const batchTarget = batch.target;

    // Check if this batch belongs in the current group
    const sameElement = isSameElement(triggerTarget, batchTarget);
    const timeDiff = batchTime(batch) - batchTime(trigger);
    const windowMs = usesExtendedWindow(triggerTarget)
      ? EXTENDED_GROUP_WINDOW_MS
      : STANDARD_GROUP_WINDOW_MS;
    const withinWindow = timeDiff <= windowMs;

    if (sameElement && withinWindow) {
      // Two clicks on the same element = separate interactions
      if (isClickEvent(trigger) && isClickEvent(batch)) {
        flushGroup();
        currentGroup = [batch];
        continue;
      }
      // Same element, within window, not double-click → group
      currentGroup.push(batch);
      continue;
    }

    // Cross-element: is this batch semantically related to the trigger?
    if (withinWindow && areSemanticallyRelated(triggerTarget, batchTarget)) {
      currentGroup.push(batch);
      continue;
    }

    // Doesn't belong in current group → flush and start new
    flushGroup();
    currentGroup = [batch];
  }

  flushGroup();

  return candidates;
}

// ── Candidate Factory ────────────────────────────────────────────────────

/**
 * Build an InteractionCandidate from a group of batches.
 */
function makeCandidate(batches: EvidenceBatch[]): InteractionCandidate {
  const primary = batches[0];
  const eventSequence = batches.flatMap((b) => b.eventSequence);
  const isMultiElement = batches.length > 1 &&
    !batches.every((b) => isSameElement(b.target, primary.target));

  return {
    batches,
    primaryBatchId: primary.id,
    primaryTarget: primary.target,
    eventSequence,
    startedAt: batches[0]!.startedAt,
    endedAt: batches[batches.length - 1]!.endedAt,
    isMultiElement,
    isStandalone: batches.length === 1 &&
      batches[0]!.eventSequence.some((e) => isStandaloneEvent(e)),
  };
}

// ── Utility Exports ──────────────────────────────────────────────────────

export { elementKey, isStandaloneEvent, isSameElement, areSemanticallyRelated };

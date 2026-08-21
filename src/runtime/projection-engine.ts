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
import { elementKey } from '../definitions/patterns';

/**
 * Create an Unclassified interaction from a ledger entry.
 * The entry carries diagnostic identity (targetTag, targetName, targetRole)
 * populated at capture time — the result carries real element identity
 * instead of placeholder stubs.
 *
 * D1: when the entry captured the FULL element identity + capture origin
 * (targetIdentity/captureOrigin, present for events appended after D1),
 * the projected twin is built from them so its elementKey matches the
 * recognized interaction's rich key — enabling normalizeWorkflow's
 * same-element subsumption to fold the twin away. Legacy entries (null
 * identity) keep the old diagnostic-only shape.
 */
function createUnclassifiedFromLedger(
  entry: LedgerEntry,
  interactionCounter: { value: number },
): ComponentInteraction {
  interactionCounter.value++;

  // D1: prefer the full captured identity; fall back to diagnostics.
  const id = entry.targetIdentity ?? null;
  const identity = id ? { ...id } : {
    accessibleName: entry.targetName,
    ariaRole: entry.targetRole,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: entry.targetTag,
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
    inputType: null,
    elementId: '',
  };

  // S1': when this card collapsed an adjacent mousedown→click pair, the
  // consumed mousedown becomes a memberEvent so the M4 capture-guarantee
  // check (which counts memberEvents eventIds) sees both physical events
  // represented. The synthetic memberEvent mirrors the triggerEvent shape.
  const pairedMarker = (entry as LedgerEntry & { pairedAtProjection?: boolean })
    .pairedAtProjection === true;
  const pairedMousedownEntry = pairedMarker
    ? [...pairSourceByEventId.entries()].find(
        ([, e]) =>
          entryElementKey(e) === entryElementKey(entry) && e.eventType === 'mousedown',
      )?.[1]
    : undefined;

  const triggerEvt = {
    eventId: entry.eventId,
    eventType: entry.eventType as any,
    timestamp: entry.timestamp,
    captureSeq: entry.captureSeq,
    isTrusted: true,
    target: identity,
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
    // D1: carry the capture origin so downstream consumers (episode
    // builder tab scoping, workflow subsumption) see the same tab as the
    // recognized interaction.
    captureOrigin: entry.captureOrigin
      ? { ...entry.captureOrigin }
      : undefined,
  };

  return {
    interactionId: `int-${interactionCounter.value}`,
    type: 'Unclassified' as InteractionType,
    trigger: identity,
    triggerEvent: triggerEvt,
    memberEvents: pairedMousedownEntry
      ? [
          {
            ...triggerEvt,
            eventId: pairedMousedownEntry.eventId,
            eventType: 'mousedown' as any,
            timestamp: pairedMousedownEntry.timestamp,
            captureSeq: pairedMousedownEntry.captureSeq,
          },
        ]
      : [],
    startTime: entry.timestamp,
    endTime: entry.timestamp,
    endState: 'completed',
    metadata: {
      physicalEventType: entry.eventType,
      recognized: false,
      reason: 'unclaimed-at-projection',
      targetName: entry.targetName,
      targetTag: entry.targetTag,
      targetRole: entry.targetRole,
      // S1': when this card collapsed an adjacent mousedown→click pair,
      // record BOTH physical events for evidence completeness.
      pairedAtProjection: pairedMarker || undefined,
      physicalEvents: pairedMarker
          ? ['mousedown', 'click']
          : undefined,
      // D1: propagate the origin into metadata as well — sw-integration
      // stamps interaction.metadata.captureOrigin for recognized
      // interactions, and affinity comparisons read both places.
      captureOrigin: entry.captureOrigin
        ? { ...entry.captureOrigin }
        : undefined,
    },
  };
}

/**
 * S1' (RCA2 2026-08-20): Pair adjacent mousedown→click entries on the same
 * element into ONE projected Unclassified card.
 *
 * Structural rule — NO timing constants:
 *   • same pageId
 *   • mousedown entry IMMEDIATELY followed by a click entry in captureSeq
 *     order (no intervening projected entry — adjacency is exact)
 *   • identical elementKey (D1 targetIdentity when present, else diagnostic
 *     identity: tag+name+role)
 *
 * mousedown and click on the same element are one physical press-and-release;
 * when neither is claimed by a definition, projecting two cards is timeline
 * noise. contextmenu/keydown/dragstart/drop never pair (different acts).
 * Ledger dispositions are NOT rewritten — only projected output changes.
 *
 * The consumed mousedown entry is returned so the paired card can carry it in
 * memberEvents — the M4 capture-guarantee check counts memberEvents eventIds,
 * so the paired card must structurally represent BOTH physical events.
 */
function pairPhysicalPress(entries: LedgerEntry[]): {
  collapsed: LedgerEntry[];
  pairedEventIds: Set<string>;
} {
  const collapsed: LedgerEntry[] = [];
  const pairedEventIds = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    const cur = entries[i];
    const next = entries[i + 1];

    if (
      next &&
      cur.eventType === 'mousedown' &&
      next.eventType === 'click' &&
      cur.pageId === next.pageId &&
      entryElementKey(cur) === entryElementKey(next)
    ) {
      // Collapse both entries into the click entry (release wins — it's the
      // semantic act). The consumed mousedown is recorded so the card can
      // represent it in memberEvents (M4 capture guarantee).
      collapsed.push({ ...next, pairedAtProjection: true } as LedgerEntry);
      pairedEventIds.add(cur.eventId);
      pairSourceByEventId.set(cur.eventId, cur);
      i++; // skip the consumed click entry
    } else {
      collapsed.push(cur);
    }
  }
  return { collapsed, pairedEventIds };
}

/**
 * Map from a consumed (paired-away) mousedown eventId → its ledger entry, so
 * the paired card's builder can attach it as a memberEvent. Cleared at the
 * start of every projectInteractions call (no cross-run leakage).
 */
const pairSourceByEventId = new Map<string, LedgerEntry>();

/** Element identity key for a ledger entry (D1 identity preferred). */
function entryElementKey(entry: LedgerEntry): string {
  if (entry.targetIdentity) {
    return elementKey(entry.targetIdentity);
  }
  // Diagnostic-only entries: best available structural identity.
  const name = entry.targetName ?? '';
  return `tag:${entry.targetTag}|name:${name}|role:${entry.targetRole ?? ''}`;
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
  /**
   * S1': eventIds whose physical press (mousedown) was collapsed into the
   * following adjacent click's single projected card. These entries ARE
   * represented — inside the card's metadata.physicalEvents — so the
   * capture-guarantee (every discrete event represented) still holds.
   */
  pairedEventIds: Set<string>;
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
  // Partition interactions: only COMPLETED interactions represent
  // successful user actions that should appear in the final output.
  // Interrupted/abandoned lifecycles started but didn't produce a
  // meaningful result — their events surface as Unclassified instead.
  const completedOnly = completedInteractions.filter(
    (i) => i.endState === 'completed',
  );

  // Build set of eventIds covered by completed interactions.
  const coveredEventIds = new Set<string>();
  for (const interaction of completedOnly) {
    if (interaction.triggerEvent?.eventId) {
      coveredEventIds.add(interaction.triggerEvent.eventId);
    }
    for (const ev of interaction.memberEvents ?? []) {
      coveredEventIds.add(ev.eventId);
    }
  }

  // Find all entries that need to be projected as Unclassified
  const unclaimedEntries = ledger.getByDisposition('unclaimed');
  const pendingEntries = ledger.getByDisposition('pending');
  const toProject = [...unclaimedEntries, ...pendingEntries].filter(
    (e) => !coveredEventIds.has(e.eventId),
  );

  // Deduplicate (an entry could theoretically appear in both lists if
  // getByDisposition has a bug, but it can't — each entry has one disposition)
  const seen = new Set<string>();
  const uniqueEntries = toProject.filter((e) => {
    if (seen.has(e.eventId)) return false;
    seen.add(e.eventId);
    return true;
  });

  // S1': collapse adjacent mousedown→click pairs on the same element into a
  // single projected card (structural adjacency, no timing rule).
  // pairSourceByEventId is module-scoped for builder access; clear it each
  // run so no stale source entries leak across projections.
  pairSourceByEventId.clear();
  const { collapsed: pairedEntries, pairedEventIds } = pairPhysicalPress(uniqueEntries);

  // Determine the interaction counter starting point from completed interactions
  let maxCounter = 0;
  for (const interaction of completedOnly) {
    const match = interaction.interactionId.match(/^int-(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxCounter) maxCounter = num;
    }
  }
  const counter = { value: maxCounter };

  // Create Unclassified interactions for each unclaimed/pending entry
  const projectedUnclassified = pairedEntries.map((entry) =>
    createUnclassifiedFromLedger(entry, counter),
  );

  // Merge: completed interactions + projected Unclassified
  const interactions = [...completedOnly, ...projectedUnclassified];

  return {
    interactions,
    projectedUnclassified,
    projectedEntries: uniqueEntries,
    /** S1': eventIds collapsed into another card's physicalEvents record. */
    pairedEventIds,
  };
}

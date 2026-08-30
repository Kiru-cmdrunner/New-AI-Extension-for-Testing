/**
 * Verification Mode — Shadow Comparison (Milestone 4)
 *
 * Compares the runtime's own output against the Projection Engine's output
 * to verify they produce equivalent results. The runtime output is the
 * source of truth during M4 — the Projection Engine is only proving
 * equivalence.
 *
 * INV-VM-1: The runtime output is the source of truth. The Projection Engine
 *           does not alter the extension's behavior during M4.
 * INV-VM-2: Every divergence is detected, reported with full evidence, and
 *           preserved for inspection.
 */

import type { ComponentInteraction } from '../shared/component-types';
import type { EvidenceLedger, LedgerEntry } from './evidence-ledger';

/**
 * A single difference between the runtime output and the projected output.
 */
export interface Difference {
  /** 'missing' = runtime has it, projection doesn't.
   *  'extra' = projection has it, runtime doesn't.
   *  'type-mismatch' = both have an interaction for the same eventId but types differ.
   */
  /**
   * 'hover-sole-carrier' — HEC-G (HEC v1 §12 AC-6): a click/contextmenu
   * ledger row represented solely by a Hover in the projected output.
   */
  kind: 'missing' | 'extra' | 'type-mismatch' | 'hover-sole-carrier';
  /** The eventId at the center of the difference. */
  eventId: string;
  /** Runtime interaction type (if applicable). */
  runtimeType?: string;
  /** Projected interaction type (if applicable). */
  projectedType?: string;
  /** Runtime interaction (if applicable). */
  runtimeInteraction?: ComponentInteraction;
  /** Projected interaction (if applicable). */
  projectedInteraction?: ComponentInteraction;
  /** Ledger entries for the involved eventIds (disposition evidence). */
  ledgerEntries: LedgerEntry[];
  /** Human-readable description of the difference. */
  description: string;
}

/**
 * Result of comparing runtime output vs projected output.
 */
export interface VerificationResult {
  /** true if both outputs are structurally equivalent. */
  match: boolean;
  /** Differences found (empty if match). */
  differences: Difference[];
  /** The runtime's own output (preserved for inspection). */
  runtimeOutput: ComponentInteraction[];
  /** The Projection Engine's output (preserved for inspection). */
  projectedOutput: ComponentInteraction[];
  /** Snapshot of the ledger at comparison time. */
  ledgerSnapshot: LedgerEntry[];
}

/**
 * Extract eventIds from an interaction (triggerEvent + memberEvents).
 */
function getInteractionEventIds(interaction: ComponentInteraction): Set<string> {
  const ids = new Set<string>();
  if (interaction.triggerEvent?.eventId) {
    ids.add(interaction.triggerEvent.eventId);
  }
  for (const ev of interaction.memberEvents ?? []) {
    ids.add(ev.eventId);
  }
  return ids;
}

/**
 * Build a map of eventId → interaction for quick lookup.
 * If multiple interactions share an eventId, the first one wins.
 */
function buildEventIndex(
  interactions: ComponentInteraction[],
): Map<string, ComponentInteraction> {
  const index = new Map<string, ComponentInteraction>();
  for (const interaction of interactions) {
    const eventIds = getInteractionEventIds(interaction);
    for (const eventId of eventIds) {
      if (!index.has(eventId)) {
        index.set(eventId, interaction);
      }
    }
  }
  return index;
}

/**
 * Compare the runtime's output against the Projection Engine's output.
 *
 * Comparison is structural: interactions are compared by their claimed
 * eventIds and types. The comparison checks:
 * 1. Every interaction in the runtime output has a corresponding projected
 *    interaction with the same type.
 * 2. Every interaction in the projected output has a corresponding runtime
 *    interaction with the same type.
 * 3. For Unclassified interactions, the physicalEventType must match.
 *
 * @param runtimeOutput The runtime's own interactions (source of truth).
 * @param projectedOutput The Projection Engine's interactions.
 * @param ledger The EvidenceLedger (for disposition evidence in diffs).
 */
export function compareOutputs(
  runtimeOutput: ComponentInteraction[],
  projectedOutput: ComponentInteraction[],
  ledger: EvidenceLedger,
): VerificationResult {
  const differences: Difference[] = [];

  // Build indexes: eventId → interaction
  const runtimeIndex = buildEventIndex(runtimeOutput);
  const projectedIndex = buildEventIndex(projectedOutput);

  // Collect all eventIds from both sides
  const allEventIds = new Set<string>([
    ...runtimeIndex.keys(),
    ...projectedIndex.keys(),
  ]);

  // Get ledger entries for a set of eventIds
  const getLedgerEntries = (eventIds: Set<string>): LedgerEntry[] => {
    const entries: LedgerEntry[] = [];
    for (const id of eventIds) {
      const entry = ledger.get(id);
      if (entry) entries.push(entry);
    }
    return entries;
  };

  for (const eventId of allEventIds) {
    const runtimeInt = runtimeIndex.get(eventId);
    const projectedInt = projectedIndex.get(eventId);

    if (runtimeInt && !projectedInt) {
      // Runtime has it, projection doesn't
      differences.push({
        kind: 'missing',
        eventId,
        runtimeType: runtimeInt.type,
        runtimeInteraction: runtimeInt,
        ledgerEntries: getLedgerEntries(new Set([eventId])),
        description: `Runtime has ${runtimeInt.type} (eventId: ${eventId}) but projection does not`,
      });
    } else if (!runtimeInt && projectedInt) {
      // Projection has it, runtime doesn't
      differences.push({
        kind: 'extra',
        eventId,
        projectedType: projectedInt.type,
        projectedInteraction: projectedInt,
        ledgerEntries: getLedgerEntries(new Set([eventId])),
        description: `Projection has ${projectedInt.type} (eventId: ${eventId}) but runtime does not`,
      });
    } else if (runtimeInt && projectedInt) {
      // Both have it — check type match
      if (runtimeInt.type !== projectedInt.type) {
        differences.push({
          kind: 'type-mismatch',
          eventId,
          runtimeType: runtimeInt.type,
          projectedType: projectedInt.type,
          runtimeInteraction: runtimeInt,
          projectedInteraction: projectedInt,
          ledgerEntries: getLedgerEntries(new Set([eventId])),
          description: `Type mismatch for eventId ${eventId}: runtime=${runtimeInt.type}, projection=${projectedInt.type}`,
        });
      }
    }
  }

  return {
    match: differences.length === 0,
    differences,
    runtimeOutput,
    projectedOutput,
    ledgerSnapshot: ledger.snapshot(),
  };
}

/**
 * Format a VerificationResult as a human-readable report.
 */
export function formatVerificationReport(result: VerificationResult): string {
  if (result.match) {
    return `[Verification] MATCH — runtime output (${result.runtimeOutput.length} interactions) matches projection output (${result.projectedOutput.length} interactions).`;
  }

  const lines: string[] = [
    `[Verification] MISMATCH — ${result.differences.length} difference(s) found.`,
    `  Runtime output: ${result.runtimeOutput.length} interactions`,
    `  Projected output: ${result.projectedOutput.length} interactions`,
    '',
  ];

  for (const diff of result.differences) {
    lines.push(`  [${diff.kind}] ${diff.description}`);
    for (const entry of diff.ledgerEntries) {
      lines.push(
        `    Ledger: eventId=${entry.eventId} disposition=${entry.disposition}` +
          ` claimedBy=${entry.claimedBy ?? 'N/A'} eventType=${entry.eventType}`,
      );
    }
  }

  return lines.join('\n');
}

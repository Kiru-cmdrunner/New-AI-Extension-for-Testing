/**
 * Execution IR Staleness — execution-ir-design.md §3
 *
 * Staleness detection for cached IR artifacts. Determines whether the cached
 * IR is still valid or should be regenerated because its inputs changed.
 *
 * The IR exists in one of three states relative to a specific ATC version:
 *   Missing → no IR exists
 *   Fresh   → IR matches current inputs
 *   Stale   → inputs changed since generation
 *
 * Detection is O(k) where k = number of elements referenced by the ATC version
 * (typically 5–20). One timestamp comparison per element. No diff computation.
 */

import type { Element } from '../entities/element';
import type { ExecutionIRArtifact, ExecutionIRPlan, IRStep } from './types';

// ── Staleness Types ───────────────────────────────────────

export type IRStalenessStatus = 'missing' | 'fresh' | 'stale';

export interface IRStalenessReport {
  readonly status: IRStalenessStatus;
  /** Present only when status = 'stale'. Lists what changed. */
  readonly reasons?: StalenessReason[];
}

export interface StalenessReason {
  readonly type: 'element_changed' | 'generator_upgraded';
  readonly description: string;
  readonly elementId?: string;
  readonly elementName?: string;
}

// ── Staleness Detection ───────────────────────────────────

/**
 * Check whether a cached IR artifact is stale.
 *
 * Staleness is triggered by:
 *   - Hard: any referenced Element's updatedAt > artifact.generatedAt
 *   - Soft: currentGeneratorVersion != artifact.generatorVersion
 *
 * NOT triggered by:
 *   - New ATC version created (new version has its own missing IR)
 *   - ATC metadata-only update (title, tags, description)
 *   - Element not referenced by this ATC version changed
 *
 * @param artifact          The cached IR artifact, or undefined if none exists.
 * @param referencedElements All elements referenced by the ATC version's steps.
 * @param currentGeneratorVersion The current generator version string.
 * @returns Staleness report with status and reasons.
 */
export function checkStaleness(
  artifact: ExecutionIRArtifact | undefined,
  referencedElements: Element[],
  currentGeneratorVersion: string,
): IRStalenessReport {
  if (!artifact) {
    return { status: 'missing' };
  }

  const reasons: StalenessReason[] = [];

  // Hard staleness: any referenced element changed after IR generation.
  for (const element of referencedElements) {
    if (element.updatedAt > artifact.generatedAt) {
      reasons.push({
        type: 'element_changed',
        description: `Element "${element.logicalName}" was updated after IR generation`,
        elementId: element.id,
        elementName: element.logicalName,
      });
    }
  }

  // Soft staleness: generator version mismatch.
  if (currentGeneratorVersion !== artifact.generatorVersion) {
    reasons.push({
      type: 'generator_upgraded',
      description: `IR generated with ${artifact.generatorVersion}, current is ${currentGeneratorVersion}`,
    });
  }

  if (reasons.length > 0) {
    return { status: 'stale', reasons };
  }

  return { status: 'fresh' };
}

// ── Locator Change Detection (INV-IR5) ────────────────────

export interface LocatorDiff {
  readonly elementId: string;
  readonly elementName: string;
  readonly stepDescription: string;
  readonly oldLocators: Array<{ type: string; value: string; priority: number }>;
  readonly newLocators: Array<{ type: string; value: string; priority: number }>;
}

/**
 * Compare old and new IR plans to detect locator changes (INV-IR5).
 * Returns the elements whose resolved locators changed between generations.
 *
 * The diff is surfaced to the user as a transient notification at regeneration
 * time. It is NOT stored as a historical record — after the comparison, the
 * old artifact is discarded and the new one is cached.
 *
 * @param oldPlan The previous IR plan (from the cached artifact).
 * @param newPlan The newly generated IR plan.
 * @returns Array of elements whose locators changed. Empty if no changes.
 */
export function detectLocatorChanges(
  oldPlan: ExecutionIRPlan,
  newPlan: ExecutionIRPlan,
): LocatorDiff[] {
  const diffs: LocatorDiff[] = [];
  const seenElementIds = new Set<string>();

  // Build a lookup of new-step locators by elementId.
  const newLocatorsByElement = buildLocatorMap(newPlan.steps);
  const oldLocatorsByElement = buildLocatorMap(oldPlan.steps);

  for (const [elementId, oldEntry] of oldLocatorsByElement) {
    const newEntry = newLocatorsByElement.get(elementId);

    if (newEntry && !locatorsEqual(oldEntry.locators, newEntry.locators)) {
      if (!seenElementIds.has(elementId)) {
        diffs.push({
          elementId,
          elementName: newEntry.elementName,
          stepDescription: newEntry.stepDescription,
          oldLocators: oldEntry.locators,
          newLocators: newEntry.locators,
        });
        seenElementIds.add(elementId);
      }
    }
  }

  return diffs;
}

// ── Helpers ───────────────────────────────────────────────

interface LocatorMapEntry {
  elementName: string;
  stepDescription: string;
  locators: Array<{ type: string; value: string; priority: number }>;
}

function buildLocatorMap(steps: IRStep[]): Map<string, LocatorMapEntry> {
  const map = new Map<string, LocatorMapEntry>();

  for (const step of steps) {
    if (step.target.kind === 'element') {
      const locators = step.target.resolvedLocators.map(l => ({
        type: l.type,
        value: l.value,
        priority: l.priority,
      }));
      // Store the first occurrence (earliest step order).
      if (!map.has(step.target.elementId)) {
        map.set(step.target.elementId, {
          elementName: step.target.elementName,
          stepDescription: step.description,
          locators,
        });
      }
    }
  }

  return map;
}

function locatorsEqual(
  a: Array<{ type: string; value: string; priority: number }>,
  b: Array<{ type: string; value: string; priority: number }>,
): boolean {
  if (a.length !== b.length) return false;
  // Compare in priority order (locators are already sorted by priority at generation).
  for (let i = 0; i < a.length; i++) {
    if (a[i].type !== b[i].type || a[i].value !== b[i].value || a[i].priority !== b[i].priority) {
      return false;
    }
  }
  return true;
}

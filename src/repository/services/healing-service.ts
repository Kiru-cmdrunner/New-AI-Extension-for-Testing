/**
 * Healing Service — orchestrates cross-session element healing.
 *
 * Flow:
 *   1. Load stored Elements from Repository (scoped to project)
 *   2. Extract UiElements from the recording session's domain entities
 *   3. Match fresh UiElements against stored Elements (ElementMatchingService)
 *   4. For each match, resolve fresh locators and compare with stored
 *   5. If locators differ, heal the Element via healElement()
 *   6. Persist healed Elements via ElementRepository
 *
 * Called from the pipeline runner after session persistence (non-fatal).
 */

import { matchElements, type ElementMatchResult } from './element-matching-service';
import { healElement, type Element, type HealContext } from '../../domain/entities/element';
import type { CreateElementInput } from '../../domain/entities/element';
import {
  extractCandidatesFromIdentity,
  rankLocatorCandidates,
  type RankedLocator,
} from '../../domain/locator-ranking';
import type { UiElement } from '../../domain/entities/ui-element';
import type { ElementIdentity } from '../../shared/types';
import type { DexieUnitOfWorkFactory } from '../v2';

// ── Types ────────────────────────────────────────────────────

/** Result of a healing operation. */
export interface HealingResult {
  /** Number of elements examined (matched). */
  readonly examined: number;
  /** Number of elements healed (locators changed). */
  readonly healed: number;
  /** Number of new elements created (unmatched fresh elements). */
  readonly created: number;
  /** Details of each heal operation. */
  readonly details: HealingDetail[];
}

interface HealingDetail {
  readonly elementId: string;
  readonly logicalName: string;
  readonly action: 'healed' | 'unchanged' | 'created';
  readonly reason?: string;
}

// ── Healing Service ──────────────────────────────────────────

/**
 * Heal stored Elements using fresh evidence from a new recording session.
 *
 * @param projectId The project to scope element queries.
 * @param freshElements UiElements from the new recording session.
 * @param sessionId The recording session ID (for provenance).
 * @param uowFactory Unit of Work factory for Repository access.
 * @returns Healing result summary.
 */
export async function healFromRecording(
  projectId: string,
  freshElements: readonly UiElement[],
  sessionId: string,
  uowFactory: DexieUnitOfWorkFactory,
): Promise<HealingResult> {
  if (freshElements.length === 0) {
    return { examined: 0, healed: 0, created: 0, details: [] };
  }

  const uow = uowFactory.create();
  const result = await uow.execute(async (repos) => {
    // 1. Load stored elements for this project
    const storedElements = await repos.elements.getByProject(projectId);

    // 2. Match fresh elements against stored
    const matchResult = matchElements(freshElements, storedElements);

    const details: HealingDetail[] = [];
    let healedCount = 0;

    // 3. Heal matched elements where locators have changed
    for (const match of matchResult.matches) {
      const freshLocators = resolveFreshLocators(match.freshUiElement.identity);
      const storedLocators = match.storedElement.locatorStrategies;

      // Compare: if any locator type has a different value, it's stale
      const hasChanges = detectLocatorChanges(storedLocators, freshLocators);

      if (hasChanges) {
        const healContext: HealContext = {
          sourceSessionId: sessionId,
          reason: 'css-shifted',
          proposedBy: 'cross-session-matching',
        };

        // Convert RankedLocator[] to CreateLocatorStrategyInput[]
        const newStrategies = freshLocators.map((r) => ({
          type: r.type,
          value: r.value,
          priority: r.priority,
          confidence: r.confidence,
        }));

        const healed = healElement(match.storedElement, {
          newStrategies,
          context: healContext,
        });

        // Use repository update(id, changes) — pass healed fields
        await repos.elements.update(healed.id, {
          locatorStrategies: healed.locatorStrategies.map((s) => ({
            type: s.type,
            value: s.value,
            priority: s.priority,
            confidence: s.confidence,
          })),
          status: healed.status,
          healHistory: healed.healHistory,
          lastHealedAt: healed.lastHealedAt,
        });
        healedCount++;

        details.push({
          elementId: healed.id,
          logicalName: healed.logicalName,
          action: 'healed',
          reason: 'locator-changed',
        });
      } else {
        details.push({
          elementId: match.storedElement.id,
          logicalName: match.storedElement.logicalName,
          action: 'unchanged',
        });
      }
    }

    // 4. Create new elements for unmatched fresh elements
    let createdCount = 0;
    for (const fresh of matchResult.unmatched) {
      const locators = resolveFreshLocators(fresh.identity);
      if (locators.length === 0) continue; // Skip elements with no valid locators

      const createInput: CreateElementInput = {
        projectId,
        logicalName: fresh.identity.accessibleName || `Element ${fresh.elementId}`,
        pageOrComponent: fresh.sourceUrl,
        locatorStrategies: locators.map((r) => ({
          type: r.type,
          value: r.value,
          priority: r.priority,
          confidence: r.confidence,
        })),
      };

      const newElement = await repos.elements.create(createInput);
      createdCount++;

      details.push({
        elementId: newElement.id,
        logicalName: newElement.logicalName,
        action: 'created',
      });
    }

    return {
      examined: matchResult.matches.length,
      healed: healedCount,
      created: createdCount,
      details,
    } as HealingResult;
  });

  return result;
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Resolve fresh locators from an ElementIdentity using the shared ranking.
 */
function resolveFreshLocators(identity: ElementIdentity): RankedLocator[] {
  const candidates = extractCandidatesFromIdentity(identity);
  return rankLocatorCandidates(candidates);
}

/**
 * Detect if any locator type has a different value between stored and fresh.
 * Returns true if at least one locator type has changed.
 */
function detectLocatorChanges(
  stored: readonly Element['locatorStrategies'],
  fresh: readonly RankedLocator[],
): boolean {
  // Check if any fresh locator type has a different value than the stored one
  for (const freshLocator of fresh) {
    const storedMatch = stored.find((s) => s.type === freshLocator.type);
    if (storedMatch && storedMatch.value !== freshLocator.value) {
      return true; // Same type, different value = changed
    }
  }

  // Check if fresh has locator types that stored doesn't have
  for (const freshLocator of fresh) {
    if (!stored.find((s) => s.type === freshLocator.type)) {
      return true; // New locator type added
    }
  }

  return false;
}

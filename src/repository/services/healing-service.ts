/**
 * Healing Service — element locator healing.
 *
 * Two layers:
 *
 * 1. **healElementAndPersist()** — source-agnostic core.
 *    Loads a stored Element, applies healElement() with the provided locator
 *    strategies, and persists the result. Does NOT know where the locators
 *    came from (recording, execution-time DOM inspection, AI suggestion, etc.).
 *    This is the single extension point for Phase 12's execution-time healing.
 *
 * 2. **healFromRecording()** — recording-specific orchestrator.
 *    Discovers candidates by batch-matching fresh UiElements against stored
 *    Elements (ElementMatchingService), resolves locators from ElementIdentity,
 *    delegates each heal to the shared core, and creates new Elements for
 *    unmatched items. Only this function knows about recording sessions.
 */

import { matchElements } from './element-matching-service';
import { healElement, type Element, type HealContext } from '../../domain/entities/element';
import type { CreateElementInput, UpdateElementInput } from '../../domain/entities/element';
import type { ElementRepository } from '../v2/interfaces/element-repository';
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

/**
 * Input for the source-agnostic healing core.
 * Both the recording flow and the execution flow produce this shape.
 */
export interface HealElementInput {
  /** The stored Element to heal. */
  readonly elementId: string;
  /** Fresh locator strategies from any source (recording, DOM inspection, etc.). */
  readonly newStrategies: RankedLocator[];
  /** Healing provenance — who, why, from which session/run. */
  readonly context: HealContext;
}

// ── Source-Agnostic Core ─────────────────────────────────────

/**
 * Apply a heal to a single Element and persist the result.
 *
 * This is the **shared extension point** — Phase 12's execution-time healing
 * calls this with locators discovered from live DOM inspection, while the
 * recording flow calls it with locators resolved from ElementIdentity.
 *
 * The function:
 *   1. Loads the Element from the Repository
 *   2. Calls healElement() (additive merge, appends HealEvent)
 *   3. Persists via ElementRepository.update()
 *
 * @param input.elementId     The stored Element's ID
 * @param input.newStrategies Fresh locators from any source
 * @param input.context       Provenance (sessionId, reason, proposedBy)
 * @param elements            The ElementRepository (from any UnitOfWork)
 * @returns                   The healed Element, or undefined if not found
 *
 * @throws ValueObjectError if newStrategies is empty (from healElement)
 * @throws MissingFieldError if context.sourceSessionId is empty (from healElement)
 */
export async function healElementAndPersist(
  input: HealElementInput,
  elements: ElementRepository,
): Promise<Element | undefined> {
  const existing = await elements.getById(input.elementId);
  if (!existing) return undefined;

  const healed = healElement(existing, {
    newStrategies: input.newStrategies.map((r) => ({
      type: r.type,
      value: r.value,
      priority: r.priority,
      confidence: r.confidence,
    })),
    context: input.context,
  });

  const changes: UpdateElementInput = {
    locatorStrategies: healed.locatorStrategies.map((s) => ({
      type: s.type,
      value: s.value,
      priority: s.priority,
      confidence: s.confidence,
    })),
    status: healed.status,
    healHistory: healed.healHistory,
    lastHealedAt: healed.lastHealedAt,
  };

  await elements.update(healed.id, changes);
  return healed;
}

// ── Recording-Specific Orchestrator ──────────────────────────

/**
 * Heal stored Elements using fresh evidence from a new recording session.
 *
 * Recording-specific responsibilities:
 *   - Batch-match fresh UiElements against stored Elements
 *   - Resolve locators from ElementIdentity (extractCandidatesFromIdentity)
 *   - Detect which matched elements have changed locators
 *   - Delegate each heal to healElementAndPersist()
 *   - Create new Elements for unmatched items
 *
 * @param projectId     The project to scope element queries.
 * @param freshElements UiElements from the new recording session.
 * @param sessionId     The recording session ID (for provenance).
 * @param uowFactory    Unit of Work factory for Repository access.
 * @returns             Healing result summary.
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
        const healed = await healElementAndPersist(
          {
            elementId: match.storedElement.id,
            newStrategies: freshLocators,
            context: {
              sourceSessionId: sessionId,
              reason: 'css-shifted',
              proposedBy: 'cross-session-matching',
            },
          },
          repos.elements,
        );

        if (healed) {
          healedCount++;
          details.push({
            elementId: healed.id,
            logicalName: healed.logicalName,
            action: 'healed',
            reason: 'locator-changed',
          });
        }
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

// ── Recording-Specific Helpers ───────────────────────────────

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
  stored: Element['locatorStrategies'],
  fresh: readonly RankedLocator[],
): boolean {
  // 6B fix: compare by (type, value) SET membership, not type-only first-match.
  // The old pairwise find-by-type assumed at most ONE locator per type — but a
  // ranked set legitimately contains multiple same-type strategies (6B class
  // tier: CSS '[class~="x"]' + CSS 'button.x'; pre-existing dual
  // ACCESSIBLE_NAME ariaLabel/accessibleName). Type-only matching compared
  // fresh's second CSS against stored's first and flagged identical sets as
  // changed, healing every element on every session. A real change is a
  // (type,value) present on one side and absent on the other.
  const keyOf = (s: { type: string; value: string }): string => `${s.type}::${s.value}`;
  const storedKeys = new Set(stored.map(keyOf));
  const freshKeys = new Set(fresh.map(keyOf));

  for (const key of freshKeys) {
    if (!storedKeys.has(key)) return true; // new or changed locator
  }
  for (const key of storedKeys) {
    if (!freshKeys.has(key)) return true; // stored locator no longer fresh-ranked
  }

  return false;
}

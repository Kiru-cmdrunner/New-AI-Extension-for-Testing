/**
 * Session Element Harvest (D3) — assign session-scoped element IDs and build
 * UiElements from a recording's production interactions.
 *
 * Why this exists: the recorder-era design intended the background to assign
 * `elem-NNNN` element IDs to captured identities, but the assignment was
 * never implemented — `identity-extractor` writes `elementId: ''` and
 * `ElementIdGenerator` had zero importers. Consequences (fixed here):
 *   - `healFromRecording()` had no production caller and no non-empty-ID
 *     fresh elements, so the Repository `elements` table stayed empty.
 *   - IR steps carried `elementId: ''`, so runtime healing could never match
 *     and OR-1 merged distinct consecutive clicks.
 *
 * Pure module — no chrome.* APIs, fully unit-testable.
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';
import { createUiElement, type UiElement } from '../../domain/entities/ui-element';
import { ElementIdGenerator } from '../../recorder/element-id-generator';

/**
 * Stable identity key for a captured element identity.
 *
 * Priority: business IDs (testId/dataCy/dataQa/stableId) when present —
 * these survive markup restyling. Otherwise the durable structural pair
 * (cssSelector + xPath). `elementId` itself is deliberately excluded: the
 * key is used BEFORE assignment (and identities captured today always
 * carry '').
 *
 * Note: this is a session-scoped dedupe key, NOT the cross-session element
 * matcher (that is ElementMatchingService, which scores accessibleName/role/
 * ancestors with a 0.70 threshold — deliberately fuzzier).
 */
export function elementIdentityKey(identity: ElementIdentity): string {
  const business = identity.testId ?? identity.dataCy ?? identity.dataQa ?? identity.stableId;
  if (business) return `id:${business}`;
  return `css:${identity.cssSelector}|xp:${identity.xPath}`;
}

/** Result of harvesting a session's interactions. */
export interface HarvestedElements {
  /** Distinct fresh elements (one per identity key), first-seen order. */
  readonly freshElements: readonly UiElement[];
  /** identity-key → assigned session element ID (elem-NNNN). */
  readonly idByKey: ReadonlyMap<string, string>;
}

/**
 * Harvest the distinct elements referenced by a session's interactions.
 *
 * Dedupes by identity key, assigns sequential `elem-NNNN` IDs via the
 * recorder-era ElementIdGenerator (first-seen order), and assembles
 * UiElements (sourceUrl = recording start URL; domTreePath derived from the
 * cssSelector as the honest structural path available at this layer).
 */
export function harvestSessionElements(
  interactions: readonly ComponentInteraction[],
  startUrl: string,
): HarvestedElements {
  const generator = new ElementIdGenerator();
  const idByKey = new Map<string, string>();
  const freshElements: UiElement[] = [];

  for (const interaction of interactions) {
    const identity = interaction.trigger;
    const key = elementIdentityKey(identity);
    if (idByKey.has(key)) continue; // already harvested this element

    const elementId = generator.next();
    idByKey.set(key, elementId);

    try {
      freshElements.push(
        createUiElement({
          elementId,
          identity,
          sourceUrl: startUrl,
          domTreePath: identity.cssSelector,
        }),
      );
    } catch {
      // createUiElement throws on empty required fields — a malformed
      // identity must never break the recording session. Drop it and keep
      // the ID assigned (order stability for the rest).
    }
  }

  return { freshElements, idByKey };
}

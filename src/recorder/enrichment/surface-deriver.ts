/**
 * Surface Deriver — groups UiElements by sourceUrl to produce page-level views.
 *
 * Pure function: reads UiElement.sourceUrl, groups by URL. Each group becomes
 * an ApplicationSurface listing the elements and components on that page.
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §6
 */

import type { UiElement } from '../../domain/entities/ui-element';
import type { ApplicationSurface } from '../../domain/entities/application-knowledge';

/**
 * Derive ApplicationSurfaces by grouping elements by their sourceUrl.
 *
 * @param elements   All UiElements to group.
 * @param components Optional: component groupings for component-to-surface mapping.
 * @returns ApplicationSurface[] ordered by URL (stable ordering).
 */
export function deriveSurfaces(
  elements: UiElement[],
  components?: ReadonlyArray<{ groupingId: string; rootElementId: string }>,
): ApplicationSurface[] {
  const urlToElementIds = new Map<string, string[]>();
  const urlToComponentIds = new Map<string, Set<string>>();

  // Group elements by URL
  for (const el of elements) {
    const url = el.sourceUrl;
    const list = urlToElementIds.get(url);
    if (list) {
      list.push(el.elementId);
    } else {
      urlToElementIds.set(url, [el.elementId]);
    }

    // Track which components belong to this surface
    if (el.componentId) {
      let compSet = urlToComponentIds.get(url);
      if (!compSet) {
        compSet = new Set<string>();
        urlToComponentIds.set(url, compSet);
      }
      compSet.add(el.componentId);
    }
  }

  // Also map components via their root element's URL
  if (components) {
    const elementUrlMap = new Map(elements.map((e) => [e.elementId, e.sourceUrl]));
    for (const comp of components) {
      const url = elementUrlMap.get(comp.rootElementId);
      if (url) {
        let compSet = urlToComponentIds.get(url);
        if (!compSet) {
          compSet = new Set<string>();
          urlToComponentIds.set(url, compSet);
        }
        compSet.add(comp.groupingId);
      }
    }
  }

  // Build surfaces, sorted by URL for stable ordering
  const urls = Array.from(urlToElementIds.keys()).sort();
  return urls.map((url) => ({
    url,
    elementIds: urlToElementIds.get(url)!,
    componentIds: Array.from(urlToComponentIds.get(url) ?? []),
  }));
}

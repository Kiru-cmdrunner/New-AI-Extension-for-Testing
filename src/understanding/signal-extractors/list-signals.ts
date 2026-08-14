/**
 * List Signal Extractor — extracts list-change signals from
 * DomChangeSummary childList mutations.
 *
 * Identifies list-like containers (elements with role=list, ul, ol,
 * table/tbody, or data-testid patterns) and reports net size changes
 * from added/removed child node counts.
 *
 * D8: extended to also detect
 * - class/path-based custom grids (div.data-grid, div.results, etc.)
 * - attribute-based collection changes (aria-rowcount, aria-colcount,
 *   aria-setsize mutations on ARIA grids)
 *
 * M9.2 / D8
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, ListChangeSignal } from '../types';

/** Tags and roles that indicate list-like containers. */
const LIST_TAGS = new Set(['UL', 'OL', 'TBODY', 'TABLE', 'SELECT', 'DATALIST']);
const LIST_ROLES = new Set(['list', 'listbox', 'tree', 'treegrid', 'grid', 'table', 'rowgroup']);

/** Attribute names that indicate ARIA grid collection containers. D8. */
const GRID_ATTR_HINTS = /^(?:aria-rowcount|aria-colcount|aria-setsize)$/i;
/** Class/path patterns that indicate custom grid containers. D8. */
const GRID_PATH_HINTS =
  /(?:^|[.\s>#\[])(?:[a-z-]*grid[a-z-]*|results?-?(?:container|list|wrapper)?|items?-?(?:container|list|wrapper)?|rows?-?(?:container|list)?|data-table|virtual-list)(?:[.\s>#\[]|$)/i;

function isListContainer(tag: string, path: string): boolean {
  const upperTag = tag.toUpperCase();

  // Check tag
  if (LIST_TAGS.has(upperTag)) return true;

  // Check for ARIA roles matching list-like containers
  const roleMatch = path.match(/\[role=([^\]]+)\]/i);
  if (roleMatch && LIST_ROLES.has(roleMatch[1].toLowerCase())) return true;

  // Check for common list-related data-testid patterns
  if (/data-testid=["']?[^"']*list|results?|items?|grid/i.test(path)) return true;

  // D8: class-based custom grid/table containers (e.g. div.data-grid)
  if (GRID_PATH_HINTS.test(path)) return true;

  return false;
}

export class ListSignalExtractor implements SignalExtractor {
  readonly name = 'ListSignalExtractor';

  extract(interaction: ComponentInteraction): Signal[] {
    const evidence = interaction.behavioralEvidence;
    if (!evidence) return [];

    const domChanges = evidence.applicationEvidence.domChanges;
    if (!domChanges || domChanges.length === 0) return [];

    const signals: ListChangeSignal[] = [];

    for (const change of domChanges) {
      // Only childList mutations with actual node changes
      if (change.types.includes('childList')) {
        if (change.addedNodesCount === 0 && change.removedNodesCount === 0) continue;

        // Only for list-like containers (tag, path role/testid, or D8 class hints)
        if (!isListContainer(change.targetTag, change.targetPath)) continue;

        signals.push({
          type: 'list-change',
          interactionId: interaction.interactionId,
          source: 'dom-mutation',
          confidence: 0.7,
          containerPath: change.targetPath,
          containerTag: change.targetTag,
          addedCount: change.addedNodesCount,
          removedCount: change.removedNodesCount,
          netChange: change.addedNodesCount - change.removedNodesCount,
        });
      }

      // D8: attribute-based collection detection — ARIA grids that expose
      // their size via aria-rowcount / aria-colcount / aria-setsize instead
      // of (or in addition to) childList mutations.
      if (change.types.includes('attributes')) {
        for (const attrName of change.changedAttributes) {
          if (!GRID_ATTR_HINTS.test(attrName)) continue;
          const delta = change.attributeDeltas[attrName];
          if (!delta || !delta.old || !delta.new) continue;

          const oldNum = parseInt(delta.old, 10);
          const newNum = parseInt(delta.new, 10);
          if (isNaN(oldNum) || isNaN(newNum)) continue;

          const net = newNum - oldNum;
          if (net === 0) continue;

          signals.push({
            type: 'list-change',
            interactionId: interaction.interactionId,
            source: 'dom-mutation',
            confidence: 0.8,
            containerPath: change.targetPath,
            containerTag: change.targetTag,
            addedCount: Math.max(0, net),
            removedCount: Math.max(0, -net),
            netChange: net,
          });
        }
      }
    }

    return signals;
  }
}

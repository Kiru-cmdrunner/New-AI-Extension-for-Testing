/**
 * List Signal Extractor — extracts list-change signals from
 * DomChangeSummary childList mutations.
 *
 * Identifies list-like containers (elements with role=list, ul, ol,
 * table/tbody, or data-testid patterns) and reports net size changes
 * from added/removed child node counts.
 *
 * M9.2
 */

import type { ComponentInteraction } from '../../shared/component-types';
import type { SignalExtractor, Signal, ListChangeSignal } from '../types';

/** Tags and roles that indicate list-like containers. */
const LIST_TAGS = new Set(['UL', 'OL', 'TBODY', 'TABLE', 'SELECT', 'DATALIST']);
const LIST_ROLES = new Set(['list', 'listbox', 'tree', 'treegrid', 'grid', 'table', 'rowgroup']);

function isListContainer(tag: string, path: string): boolean {
  const upperTag = tag.toUpperCase();

  // Check tag
  if (LIST_TAGS.has(upperTag)) return true;

  // Check for ARIA roles matching list-like containers
  const roleMatch = path.match(/\[role=([^\]]+)\]/i);
  if (roleMatch && LIST_ROLES.has(roleMatch[1].toLowerCase())) return true;

  // Check for common list-related data-testid patterns
  if (/data-testid=["']?[^"']*list|results?|items?|grid/i.test(path)) return true;

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
      if (!change.types.includes('childList')) continue;
      if (change.addedNodesCount === 0 && change.removedNodesCount === 0) continue;

      // Only for list-like containers
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

    return signals;
  }
}

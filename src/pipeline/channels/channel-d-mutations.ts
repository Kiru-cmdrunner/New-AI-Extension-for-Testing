/**
 * Channel D — Runtime Mutations
 *
 * Collects evidence about DOM mutations that occur after an interaction:
 * surfaces appearing/disappearing (modals, dropdowns, popovers), child
 * list changes, attribute changes, and visibility changes.
 *
 * Provenance: This logic is extracted from the existing recorder's
 * surface detection system in deterministic-recorder.ts:
 * - detectSurface() and surface classification logic
 * - MutationObserver setup for post-click surface detection
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from '../../types/foundation';
import type { SurfaceInfo, TargetSurfaceType } from '../../types/element';
import type { EvidenceChannel, ChannelCollectInput } from './evidence-channel';

// ── Surface Detection ────────────────────────────────────────────────────

/**
 * Class-name patterns that indicate surface types.
 * Used when ARIA role is absent.
 */
const SURFACE_PATTERNS: Array<{ pattern: RegExp; type: TargetSurfaceType }> = [
  // Modal / Dialog
  { pattern: /modal|dialog|MuiDialog|ant-modal/i, type: 'modal' },
  // Drawer / Side panel
  { pattern: /drawer|sidebar|panel-right|offcanvas|MuiDrawer|ant-drawer/i, type: 'drawer' },
  // Popover
  { pattern: /popover|popup|dropdown-menu|menu-dropdown/i, type: 'popover' },
  // Tooltip
  { pattern: /tooltip|MuiTooltip|ant-tooltip/i, type: 'tooltip' },
  // Dropdown
  { pattern: /dropdown|listbox|menu-list|combobox-list|MuiMenu|ant-dropdown/i, type: 'dropdown' },
];

/**
 * ARIA roles that map to surface types.
 */
const SURFACE_ROLES: Record<string, TargetSurfaceType> = {
  dialog: 'dialog',
  alertdialog: 'dialog',
  menu: 'menu',
  listbox: 'dropdown',
  tooltip: 'tooltip',
  tree: 'dropdown',
  grid: 'dropdown',
};

/**
 * Detect if a newly appeared element is a surface (modal, dropdown, etc.).
 *
 * Returns a SurfaceInfo if the element is a surface, null otherwise.
 */
export function detectSurface(el: Element, direction: 'appeared' | 'disappeared', timestamp: string): SurfaceInfo | null {
  const role = el.getAttribute('role');

  // 1. ARIA role check
  if (role) {
    const surfaceType = SURFACE_ROLES[role];
    if (surfaceType) {
      return {
        type: surfaceType,
        role,
        accessibleName: getAccessibleNameForSurface(el),
        direction,
        detectedAt: timestamp,
      };
    }
  }

  // 2. Tag name check
  const tag = el.tagName.toLowerCase();
  if (tag === 'dialog') {
    return {
      type: 'dialog',
      role: 'dialog',
      accessibleName: getAccessibleNameForSurface(el),
      direction,
      detectedAt: timestamp,
    };
  }

  // 3. Class-name pattern matching
  const className = el instanceof HTMLElement ? el.className : '';
  if (className && typeof className === 'string') {
    for (const { pattern, type } of SURFACE_PATTERNS) {
      if (pattern.test(className)) {
        return {
          type,
          role,
          accessibleName: getAccessibleNameForSurface(el),
          direction,
          detectedAt: timestamp,
        };
      }
    }
  }

  return null;
}

/**
 * Get accessible name for a surface element.
 */
function getAccessibleNameForSurface(el: Element): string | null {
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel;
  const ariaLabelledby = el.getAttribute('aria-labelledby');
  if (ariaLabelledby) {
    const ref = document.getElementById(ariaLabelledby);
    if (ref) return ref.textContent?.trim() || null;
  }
  if (el instanceof HTMLElement) {
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6');
    if (heading) return heading.textContent?.trim() || null;
  }
  return null;
}

// ── Mutation Summary ─────────────────────────────────────────────────────

/**
 * Summary of DOM mutations observed after an interaction.
 */
export interface MutationSummary {
  addedNodes: number;
  removedNodes: number;
  attributeChanges: number;
  /** Classes of added elements (for surface detection). */
  addedClasses: string[];
  /** Whether any added element is a surface. */
  hasSurface: boolean;
}

/**
 * Summarize a MutationRecord[] into a compact evidence value.
 */
export function summarizeMutations(mutations: MutationRecord[]): MutationSummary {
  let addedNodes = 0;
  let removedNodes = 0;
  let attributeChanges = 0;
  const addedClasses: string[] = [];

  for (const mutation of mutations) {
    addedNodes += mutation.addedNodes.length;
    removedNodes += mutation.removedNodes.length;
    if (mutation.type === 'attributes') attributeChanges++;

    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) {
        if (node.className && typeof node.className === 'string') {
          addedClasses.push(...node.className.split(/\s+/).filter(Boolean));
        }
      }
    }
  }

  return {
    addedNodes,
    removedNodes,
    attributeChanges,
    addedClasses,
    hasSurface: addedClasses.some(c =>
      /modal|dialog|popover|tooltip|drawer|dropdown|menu/i.test(c)
    ),
  };
}

// ── Channel D Implementation ─────────────────────────────────────────────

export const ChannelD: EvidenceChannel = {
  channelId: 'D',
  name: 'Runtime Mutations',

  collect(input: ChannelCollectInput): EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    const { target, timestamp, surfaces } = input;

    try {
      // Surface appearance/disappearance (provided by EventTap or pre-detected)
      if (surfaces && surfaces.length > 0) {
        for (const surface of surfaces) {
          records.push({
            channelId: 'D',
            signalType: surface.direction === 'appeared' ? 'surfaceAppearance' : 'surfaceDisappearance',
            timestamp,
            value: surface,
            confidence: 0.9,
          });
        }
      }

      // Surface detection from target element itself (e.g., target has aria-haspopup)
      const hasPopup = target.getAttribute('aria-haspopup');
      const expanded = target.getAttribute('aria-expanded');
      if (hasPopup && expanded === 'true') {
        // The target likely triggered a surface — record as a probable surface signal
        records.push({
          channelId: 'D',
          signalType: 'surfaceAppearance',
          timestamp,
          value: {
            triggerType: hasPopup,
            expanded: true,
          },
          confidence: 0.7, // inferred, not directly observed
        });
      }

      // Surface disappearance: aria-expanded changed to false
      if (hasPopup && expanded === 'false') {
        records.push({
          channelId: 'D',
          signalType: 'surfaceDisappearance',
          timestamp,
          value: {
            triggerType: hasPopup,
            expanded: false,
          },
          confidence: 0.7,
        });
      }

      // Child list indicator (target has children that may have changed)
      if (target.children.length > 0) {
        records.push({
          channelId: 'D',
          signalType: 'childListChange',
          timestamp,
          value: { childCount: target.children.length },
          confidence: 0.5, // just an indicator, not a confirmed mutation
        });
      }
    } catch {
      // Non-fatal
    }

    return records;
  },
};

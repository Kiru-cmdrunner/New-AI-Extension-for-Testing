/**
 * M9.4 - Page Content Observer Types
 *
 * Types for semantic page-content snapshots. These capture the
 * *rendered content state* of a page/view that cannot be derived from
 * M1-M8 evidence streams (TargetEvidence, DomChangeSummary, etc.).
 *
 * Architecture: .drytis/specs/m9-4-page-content-observer.md
 */

import type { Signal } from '../types';

// -- Semantic Item Types --

/**
 * The semantic category of an observed page element.
 */
export type SemanticItemKind =
  | 'counter'
  | 'notification'
  | 'collection'
  | 'entity'
  | 'status-badge'
  | 'entity-title';

// -- Observed Item --

/**
 * A single semantically-relevant element observed in the page content.
 */
export interface ObservedItem {
  /** Semantic kind of this observation. */
  kind: SemanticItemKind;
  /** CSS selector that matched this element. */
  matchedSelector: string;
  /** Extracted text content (trimmed, capped at 200 chars). */
  text: string;
  /** Extracted numeric value (for counters, collection counts). */
  numericValue: number | null;
  /** Entity ID if extractable from data attributes or text. */
  entityId: string | null;
  /** Entity type if this observation represents an entity. */
  entityType: string | null;
  /** DOM path (for dedup and provenance). */
  domPath: string;
  /** Additional attributes extracted from the element. */
  attributes: Record<string, string>;
  /** Whether the element was visible at scan time. */
  visible: boolean;
}

// -- Page Content Snapshot --

/**
 * A semantic snapshot of the rendered page content at a point in time.
 * Captured once per pageshow or view-change event.
 */
export interface PageContentSnapshot {
  /** URL of the page when the snapshot was taken. */
  url: string;
  /** View ID if identifiable from URL or content signature. */
  viewId: string | null;
  /** All semantic items observed in this scan (bounded at 50). */
  items: ObservedItem[];
  /** Number of items dropped due to the 50-element cap. */
  itemsOverflow: number;
  /** Timestamp (performance.now()) when the scan started. */
  scannedAt: number;
  /** Duration of the scan in ms. */
  scanDurationMs: number;
}

// -- Page Content Signal --

/**
 * Signal carrying page-content observations for signal extraction.
 * Source: 'page-content' (one of the SignalSource values).
 */
export interface PageContentSignal extends Signal {
  type: 'page-content';
  source: 'page-content';
  /** The full content snapshot. */
  snapshot: PageContentSnapshot;
  /** Extracted entity observations from the snapshot. */
  observedEntities: ObservedItem[];
  /** Extracted counter observations from the snapshot. */
  observedCounters: ObservedItem[];
  /** Extracted collection observations from the snapshot. */
  observedCollections: ObservedItem[];
  /** Extracted notification observations from the snapshot. */
  observedNotifications: ObservedItem[];
  /** Extracted status-badge observations (M9.9 lifecycle states). */
  observedStatusBadges: ObservedItem[];
}

// -- Selector Config --

/**
 * Configuration entry: maps a CSS selector to a semantic meaning.
 */
export interface SemanticSelector {
  /** CSS selector string. */
  selector: string;
  /** Semantic kind of the matched elements. */
  kind: SemanticItemKind;
  /** Entity type if this selector represents entities. */
  entityType?: string;
  /** Whether to extract a numeric value from the element text. */
  extractNumeric?: boolean;
  /** Attribute name to use as entity ID (e.g., 'data-asin', 'data-product-id'). */
  idAttribute?: string;
  /** Additional attributes to extract from the element. */
  extractAttributes?: string[];
}

/**
 * A registry of semantic selectors for a domain or generic usage.
 */
export interface PageContentConfig {
  /** Unique name for this config. */
  name: string;
  /** Selectors to apply during a scan. */
  selectors: SemanticSelector[];
}

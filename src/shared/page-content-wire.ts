/**
 * Resulting Application State (Phase 1) — wire types.
 *
 * Structural duplicate of the understanding-side page-content snapshot types
 * (src/understanding/page-content/page-content-types.ts), declared here with
 * ZERO imports so src/shared can carry the shape without importing from
 * src/understanding (shared must never depend on understanding — the tap
 * layer and the service worker both read from shared).
 *
 * The tap layer converts PageContentSnapshot → WirePageContentSnapshot with a
 * pure field copy (see src/tap/page-content-dom-adapter.ts) before attaching
 * it to ApplicationEvidence.
 *
 * Bounds (inherited from M9.4 PageContentObserver, INV-CS4):
 *   items.length <= 50, text <= 200 chars, attributes <= 30 entries.
 *
 * Architecture: .drytis/specs/resulting-application-state.md
 */

/**
 * One semantically-relevant item observed in the rendered page content.
 * Wire twin of `ObservedItem`.
 */
export interface WireObservedItem {
  kind: 'counter' | 'notification' | 'collection' | 'entity' | 'status-badge' | 'entity-title';
  matchedSelector: string;
  /** ≤200 chars, whitespace-normalized. */
  text: string;
  numericValue: number | null;
  entityId: string | null;
  entityType: string | null;
  domPath: string;
  /** ≤30 entries; only attributes named by the matching selector config. */
  attributes: Record<string, string>;
  visible: boolean;
}

/**
 * Bounded semantic snapshot of the rendered page content at consequence
 * settlement (Click windows) or destination-page stabilization (post-nav
 * windows). Wire twin of `PageContentSnapshot`.
 *
 * INV-CS1: belongs to exactly ONE window's evidence — never merged across
 * Click and Navigation interactions.
 */
export interface WirePageContentSnapshot {
  url: string;
  viewId: string | null;
  items: WireObservedItem[];
  /** Count of items dropped because the 50-item cap was hit. */
  itemsOverflow: number;
  scannedAt: number;
  scanDurationMs: number;
}

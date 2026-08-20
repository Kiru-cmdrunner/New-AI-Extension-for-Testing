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
  /**
   * Phase 2b: observer-verified DOM uniqueness of the item's allowlisted
   * attribute selector at capture time. TRUE only when the observer ran
   * querySelectorAll(`[attr="value"]`) over the settled snapshot DOM and
   * found EXACTLY one match. Optional for legacy-snapshot compatibility
   * (snapshots recorded before Phase 2b lack the flag → treated as
   * UNVERIFIED → id-less items stay skipped exactly as before).
   */
  uniqueInSnapshot?: boolean;
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

// ── Phase 2b: verified counter-locator allowlist ──────────────────────────

/**
 * Attribute names whose value may serve as a replay locator for id-less
 * items when the observer has VERIFIED the resulting selector is unique in
 * the snapshot DOM (Phase 2b). Deliberately narrow:
 *   - aria-label / data-count are user- or app-stable identity surfaces;
 *   - the alternate test-ID family (data-auto-id / data-test-id / data-test)
 *     is the same family Phase 2a capture and the 2c entity locator trust;
 *   - data-testid stays out (the default configs never extract it for
 *     counter entries — only the a-slice collection entry does, and
 *     collections derive via the container's #id, not attributes).
 * Entity identity attributes (data-sku, data-asin, …) are NOT here — they
 * are entity-identity, handled by the entity locator branch (2c), and
 * value-bearing entity attrs must not become counter coordinates.
 * Excluded on purpose: class fragments, matchedSelector, synthesized
 * nth-child chains (INV-GEN-4), text content, bare role.
 */
export const VERIFIED_ATTR_ALLOWLIST: readonly string[] = [
  'aria-label',
  'data-count',
  'data-auto-id',
  'data-test-id',
  'data-test',
];

/**
 * Whether `name` is a Phase-2b verifiable attribute. Shared by the
 * observer (stamps uniqueInSnapshot) and the derivation (emits locators
 * only for verified + allowlisted attributes).
 */
export function isVerifiedAttrAllowed(name: string): boolean {
  return VERIFIED_ATTR_ALLOWLIST.includes(name);
}

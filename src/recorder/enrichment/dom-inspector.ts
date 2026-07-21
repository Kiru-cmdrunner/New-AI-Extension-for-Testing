/**
 * DOM Inspector — abstraction over browser DOM access for the enrichment pass.
 *
 * The enrichment logic is pure computation over `DomElementInfo` snapshots.
 * This interface decouples that logic from the browser environment, making it
 * testable without a real DOM (tests provide a fixture adapter).
 *
 * Reference: .drytis/specs/ui-knowledge-model-phase5.md §3
 */

/**
 * A read-only snapshot of a DOM element's relevant properties.
 * This is the data structure the enrichment pass works with.
 */
export interface DomElementInfo {
  /** The element's session ID (matches UiElement.elementId). */
  readonly elementId: string;
  /** All DOM attributes as a key→value map. */
  readonly attributes: Readonly<Record<string, string>>;
  /** Text content of the element, if any. */
  readonly textContent: string | null;
  /** Accessible name (from aria-label, aria-labelledby, label, etc.). */
  readonly accessibleName: string | null;
  /** Child elements, recursively. */
  readonly children: DomElementInfo[];
}

/**
 * Read-only DOM access for the enrichment pass.
 *
 * Implementations:
 *   - Browser adapter (production): queries document.querySelector
 *   - Fixture adapter (tests): queries a static fixture
 *
 * The enrichment pass NEVER calls document.* directly — it goes through
 * this interface.
 */
export interface DomInspector {
  /**
   * Look up a single element by its session ID.
   * @returns element info, or null if not found in the DOM.
   */
  querySelector(elementId: string): DomElementInfo | null;

  /**
   * Query child elements within a parent, matching a CSS-like selector.
   * @returns array of matching child elements (empty if none).
   */
  querySelectorAll(parentId: string, selector: string): DomElementInfo[];
}

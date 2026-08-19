/**
 * Resulting Application State (Phase 1) — browser DOM adapter.
 *
 * Connects the M9.4 PageContentObserver (src/understanding/page-content/) to
 * the LIVE page document inside the tap layer. The observer is a pure,
 * stateless scanner; this adapter is the only production implementer of its
 * DOMAdapter interface (test mocks live in tests/understanding/).
 *
 * Two responsibilities:
 *   1. Adapt the live Document to the observer's DOMAdapter/ElementLike.
 *      getPath() MUST delegate to dom-observer's getElementPath so snapshot
 *      domPaths are string-identical to the paths CounterSignal/ListSignal
 *      extractors produce — StateBuilder's double-record skip-guards
 *      (counterPaths/collectionPaths) join on exact string equality.
 *   2. Convert PageContentSnapshot → WirePageContentSnapshot (pure field
 *      copy) so the tap layer can attach it to ApplicationEvidence without
 *      exporting understanding types through shared.
 *
 * Architecture: .drytis/specs/resulting-application-state.md
 */

import type { DOMAdapter, ElementLike } from '../understanding/page-content/page-content-observer';
import type {
  ObservedItem,
  PageContentSnapshot,
} from '../understanding/page-content/page-content-types';
import { getElementPath } from './dom-observer';
import type {
  WireObservedItem,
  WirePageContentSnapshot,
} from '../shared/page-content-wire';

/**
 * Wrap a live Element in the observer's ElementLike interface.
 */
class LiveElementLike implements ElementLike {
  constructor(private readonly el: Element) {}

  get tagName(): string {
    return this.el.tagName;
  }

  get textContent(): string | null {
    return this.el.textContent;
  }

  getAttribute(name: string): string | null {
    return this.el.getAttribute(name);
  }

  /**
   * Visibility consistent with dom-observer semantics: computed
   * display/visibility/opacity plus the hidden and aria-hidden attributes.
   * Deliberately NO getBoundingClientRect — dom-observer's visibility
   * detection (visibilityChanges / reveal detection) is style-based only,
   * and rect dimensions are unreliable both in test environments and for
   * legitimately-rendered off-screen content (carousels, scrollers).
   * Bounded best-effort — an element that throws is treated as not
   * visible rather than failing the scan.
   */
  isVisible(): boolean {
    try {
      if (this.el.hasAttribute('hidden')) return false;
      if (this.el.getAttribute('aria-hidden') === 'true') return false;
      const style = window.getComputedStyle(this.el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (style.opacity === '0') return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * String-identical to the paths produced by the DOMObserver pipeline —
   * load-bearing for StateBuilder's dedup skip-guards (see file header).
   */
  getPath(): string {
    return getElementPath(this.el);
  }

  /** Live children for collection count extraction. */
  get children(): ElementLike[] {
    return Array.from(this.el.children).map((c) => new LiveElementLike(c));
  }
}

/**
 * Production DOMAdapter over the live document.
 */
export class BrowserPageContentAdapter implements DOMAdapter {
  constructor(private readonly doc: Document) {}

  querySelectorAll(selector: string): ElementLike[] {
    try {
      return Array.from(this.doc.querySelectorAll(selector)).map(
        (el) => new LiveElementLike(el),
      );
    } catch {
      return [];
    }
  }

  querySelector(selector: string): ElementLike | null {
    try {
      const el = this.doc.querySelector(selector);
      return el ? new LiveElementLike(el) : null;
    } catch {
      return null;
    }
  }

  get url(): string {
    return this.doc.defaultView?.location.href ?? '';
  }
}

/**
 * Pure field copy: understanding PageContentSnapshot → shared wire snapshot.
 * Structurally identical shapes; this exists only to keep the dependency
 * boundary clean (shared must not import understanding).
 */
export function toWireSnapshot(snapshot: PageContentSnapshot): WirePageContentSnapshot {
  return {
    url: snapshot.url,
    viewId: snapshot.viewId,
    items: snapshot.items.map(toWireItem),
    itemsOverflow: snapshot.itemsOverflow,
    scannedAt: snapshot.scannedAt,
    scanDurationMs: snapshot.scanDurationMs,
  };
}

function toWireItem(item: ObservedItem): WireObservedItem {
  return {
    kind: item.kind,
    matchedSelector: item.matchedSelector,
    text: item.text,
    numericValue: item.numericValue,
    entityId: item.entityId,
    entityType: item.entityType,
    domPath: item.domPath,
    attributes: { ...item.attributes },
    visible: item.visible,
  };
}

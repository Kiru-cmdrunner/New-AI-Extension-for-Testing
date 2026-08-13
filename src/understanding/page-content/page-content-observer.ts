/**
 * M9.4 - Page Content Observer
 *
 * Scans the rendered DOM for semantically-relevant content that M1-M8
 * evidence streams cannot capture (destination page state after full-page
 * reload, counters/collections visible only in rendered content).
 *
 * This is a SEMANTIC SNAPSHOT SCANNER, not a generic DOM recorder.
 * It scans once per pageshow/view-change event and is strictly bounded.
 *
 * Architecture: .drytis/specs/m9-4-page-content-observer.md
 */

import type {
  PageContentSnapshot,
  ObservedItem,
  SemanticItemKind,
} from './page-content-types';
import type { PageContentConfig, SemanticSelector } from './page-content-types';

// -- Bounds --

const MAX_ITEMS = 50;
const MAX_TEXT_LENGTH = 200;
const MAX_ATTRIBUTES = 30;
const MIN_TEXT_LENGTH = 2;

// Tags that never carry semantic meaning for application-state tracking
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META',
  'HEAD', 'TITLE', 'BASE', 'NOSCRIPT', 'BR', 'HR',
]);

/**
 * DOM abstraction interface so the observer can be tested with a mock.
 * In production this is the real document.
 */
export interface DOMAdapter {
  querySelectorAll(selector: string): ElementLike[];
  querySelector(selector: string): ElementLike | null;
  get url(): string;
}

/**
 * Minimal element interface for the observer.
 */
export interface ElementLike {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  isVisible(): boolean;
  getPath(): string;
  children?: ElementLike[];
}

/**
 * Result of a page content scan.
 */
export interface ScanResult {
  snapshot: PageContentSnapshot;
  matchedSelectors: number;
}

export class PageContentObserver {
  private readonly config: PageContentConfig;
  private readonly dom: DOMAdapter;

  constructor(config: PageContentConfig, dom: DOMAdapter) {
    this.config = config;
    this.dom = dom;
  }

  /**
   * Scan the page for semantic content.
   * Returns a bounded snapshot or null if nothing semantic was found.
   */
  scan(viewId: string | null): PageContentSnapshot | null {
    const scanStart =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const items: ObservedItem[] = [];
    let overflow = 0;
    const seenPaths = new Set<string>();
    let matchedSelectors = 0;

    for (const selConfig of this.config.selectors) {
      if (items.length >= MAX_ITEMS) {
        overflow += this.countRemaining(selConfig);
        continue;
      }

      let elements: ElementLike[];
      try {
        elements = this.dom.querySelectorAll(selConfig.selector);
      } catch {
        // Invalid selector, skip
        continue;
      }

      if (elements.length > 0) {
        matchedSelectors++;
      }

      for (const el of elements) {
        if (items.length >= MAX_ITEMS) {
          overflow++;
          continue;
        }

        // Skip non-semantic tags
        if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;

        // Skip hidden elements
        if (!el.isVisible()) continue;

        const path = el.getPath();
        if (seenPaths.has(path)) continue; // dedup: first match wins
        seenPaths.add(path);

        const text = this.extractText(el);
        if (!selConfig.extractNumeric && text.length < MIN_TEXT_LENGTH) continue;

        const item = this.buildItem(el, selConfig, text, path);
        if (item) {
          items.push(item);
        }
      }
    }

    const scanEnd =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (items.length === 0) return null;

    return {
      url: this.dom.url,
      viewId,
      items,
      itemsOverflow: overflow,
      scannedAt: scanStart,
      scanDurationMs: Math.round(scanEnd - scanStart),
    };
  }

  /**
   * Extract clean text content from an element.
   */
  private extractText(el: ElementLike): string {
    const raw = el.textContent ?? '';
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    return trimmed.length > MAX_TEXT_LENGTH
      ? trimmed.substring(0, MAX_TEXT_LENGTH)
      : trimmed;
  }

  /**
   * Extract numeric value from text.
   */
  private extractNumeric(text: string): number | null {
    // Try to parse a number from the text (handles "3 items", "$5.00", "(2)")
    const match = text.match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
  }

  /**
   * Extract a numeric count from a collection element.
   * For <ul>/<ol> or [role="list"], count child elements.
   * Otherwise try text.
   */
  private extractCollectionCount(el: ElementLike, text: string): number | null {
    // If the element has children, count them
    if (el.children && el.children.length > 0) {
      return el.children.length;
    }
    // Fall back to text
    return this.extractNumeric(text);
  }

  /**
   * Build an ObservedItem from a matched element.
   */
  private buildItem(
    el: ElementLike,
    selConfig: SemanticSelector,
    text: string,
    path: string,
  ): ObservedItem | null {
    // Extract attributes
    const attributes: Record<string, string> = {};
    if (selConfig.extractAttributes) {
      let attrCount = 0;
      for (const attrName of selConfig.extractAttributes) {
        if (attrCount >= MAX_ATTRIBUTES) break;
        const val = el.getAttribute(attrName);
        if (val !== null) {
          attributes[attrName] = val;
          attrCount++;
        }
      }
    }

    // Extract entity ID
    let entityId: string | null = null;
    if (selConfig.idAttribute) {
      entityId = el.getAttribute(selConfig.idAttribute);
    }

    // Extract numeric value
    let numericValue: number | null = null;
    if (selConfig.extractNumeric) {
      if (selConfig.kind === 'collection') {
        numericValue = this.extractCollectionCount(el, text);
      } else {
        numericValue = this.extractNumeric(text);
      }
    }

    // Resolve entity type
    let entityType: string | null = null;
    if (selConfig.entityType) {
      entityType = selConfig.entityType;
    } else if (selConfig.kind === 'entity' && entityId) {
      entityType = 'unknown';
    }

    return {
      kind: selConfig.kind as SemanticItemKind,
      matchedSelector: selConfig.selector,
      text,
      numericValue,
      entityId,
      entityType,
      domPath: path,
      attributes,
      visible: true,
    };
  }

  /**
   * Count how many elements remain for overflow accounting.
   */
  private countRemaining(selConfig: SemanticSelector): number {
    try {
      return this.dom.querySelectorAll(selConfig.selector).length;
    } catch {
      return 0;
    }
  }
}

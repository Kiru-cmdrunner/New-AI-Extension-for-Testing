/**
 * Channel B — DOM Structure
 *
 * Collects tag name, CSS classes, element hierarchy, text content,
 * and resolved locators for the target element.
 *
 * Provenance: This logic is extracted from the existing recorder's
 * `extractIdentity()` function (lines 670-714) and helper functions
 * `generateCssSelector()`, `generateXPath()`, `captureAncestorRoles()`.
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type { EvidenceRecord } from '../../types/foundation';
import type { ResolvedLocator, LocatorKind } from '../../types/element';
import type { EvidenceChannel, ChannelCollectInput } from './evidence-channel';

// ── Helper: generate CSS selector ────────────────────────────────────────

/**
 * Generate a CSS selector for the given element.
 *
 * Strategy (in priority order):
 *   1. #id (if unique on the page)
 *   2. [data-testid="..."]
 *   3. [data-cy="..."]
 *   4. [data-qa="..."]
 *   5. tag.class1.class2 (first unique combination)
 *   6. nth-child chain up to 10 levels deep
 *
 * This is the same algorithm as generateCssSelector() in the existing recorder.
 */
export function generateCssSelector(el: Element): string {
  // CSS.escape polyfill for environments where it's unavailable (e.g. JSDOM)
  const cssEscape = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape : (s: string) => s;

  // 1. ID
  if (el.id) {
    try {
      const found = document.getElementById(el.id);
      if (found === el) return `#${cssEscape(el.id)}`;
    } catch { /* getElementById may fail */ }
  }

  // 2-3. Test attributes
  for (const [attr] of [
    ['data-testid'],
    ['data-cy'],
    ['data-qa'],
    ['data-test'],
  ] as const) {
    const value = el.getAttribute(attr);
    if (value) {
      return `[${attr}="${cssEscape(value)}"]`;
    }
  }

  // 4. Class-based selector
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLElement && el.className) {
    const classes = el.className.trim().split(/\s+/).filter(Boolean);
    if (classes.length > 0) {
      const selector = `${tag}.${classes.map(c => cssEscape(c)).join('.')}`;
      try {
        const matches = document.querySelectorAll(selector);
        if (matches.length === 1) return selector;
      } catch { /* CSS.escape may fail for unusual class names */ }
    }
    // Try tag + first class (even if not unique)
    if (classes.length > 0) {
      return `${tag}.${cssEscape(classes[0])}`;
    }
  }

  // 5. nth-child chain
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.documentElement && depth < 10) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;

    let index = 1;
    let sibling: Element | null = current.previousElementSibling;
    while (sibling) {
      index++;
      sibling = sibling.previousElementSibling;
    }

    const currentTag = current.tagName.toLowerCase();
    parts.unshift(`${currentTag}:nth-child(${index})`);
    current = parent;
    depth++;
  }

  if (parts.length === 0) return el.tagName.toLowerCase();
  return parts.join(' > ');
}

// ── Helper: generate XPath ───────────────────────────────────────────────

/**
 * Generate an XPath expression for the given element.
 *
 * Uses nth-of-type positioning up to 10 levels deep.
 */
export function generateXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;

  while (current && current.nodeType === 1 && depth < 10) {
    let index = 1;
    let sibling: Element | null = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current!.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tag = current.tagName.toLowerCase();
    parts.unshift(`${tag}[${index}]`);
    current = current.parentElement;
    depth++;
  }

  return '/' + parts.join('/');
}

// ── Helper: resolve locators ─────────────────────────────────────────────

/**
 * Resolve all available locators for the target element.
 *
 * Returns locators ordered by confidence (highest first).
 * This consolidates the scattered locator logic from extractIdentity().
 */
export function resolveLocators(el: Element): ResolvedLocator[] {
  const locators: ResolvedLocator[] = [];

  // Test attributes (highest priority, observed)
  const testAttrs: Array<[string, LocatorKind]> = [
    ['data-testid', 'testId'],
    ['data-cy', 'dataCy'],
    ['data-qa', 'dataQa'],
    ['data-test', 'dataTest'],
    ['data-automation-id', 'dataAutomationId'],
  ];
  for (const [attr, kind] of testAttrs) {
    const value = el.getAttribute(attr);
    if (value) {
      locators.push({ kind, value, confidence: 0.95, source: 'observed' });
    }
  }

  // ARIA label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    locators.push({ kind: 'ariaLabel', value: ariaLabel, confidence: 0.85, source: 'observed' });
  }

  // DOM id
  if (el.id) {
    locators.push({ kind: 'id', value: el.id, confidence: 0.9, source: 'observed' });
  }

  // name attribute
  const nameAttr = el.getAttribute('name');
  if (nameAttr) {
    locators.push({ kind: 'name', value: nameAttr, confidence: 0.7, source: 'observed' });
  }

  // placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) {
    locators.push({ kind: 'placeholder', value: placeholder, confidence: 0.6, source: 'observed' });
  }

  // text content
  if (el instanceof HTMLElement) {
    const text = el.innerText?.trim();
    if (text && text.length <= 50) {
      locators.push({ kind: 'text', value: text, confidence: 0.5, source: 'observed' });
    }
  }

  // CSS selector (computed, lower confidence)
  const css = generateCssSelector(el);
  if (css) {
    locators.push({ kind: 'css', value: css, confidence: 0.4, source: 'computed' });
  }

  // XPath (computed, lowest confidence)
  const xpath = generateXPath(el);
  if (xpath) {
    locators.push({ kind: 'xpath', value: xpath, confidence: 0.3, source: 'computed' });
  }

  // Sort by confidence descending so primaryLocator = locators[0] is always best
  locators.sort((a, b) => b.confidence - a.confidence);

  return locators;
}

// ── Helper: capture ancestor chain ───────────────────────────────────────

/**
 * Capture the ancestor chain from the target element upward.
 *
 * Each entry is "tag" or "tag[role=role]" if the ancestor has an ARIA role.
 * Walks up to 10 ancestors. Used for structural hierarchy evidence.
 */
export function captureAncestorChain(el: Element): string[] {
  const chain: string[] = [];
  let current: Element | null = el.parentElement;
  const MAX_DEPTH = 10;
  let depth = 0;
  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    if (role) {
      chain.push(`${tag}[role=${role}]`);
    } else {
      chain.push(tag);
    }
    current = current.parentElement;
    depth++;
  }
  return chain;
}

/**
 * Capture CSS classes from the target element's ancestors (up to 10 levels).
 *
 * Returns a flat array of all CSS class strings found on ancestors,
 * combined into a single space-delimited string for efficient regex matching.
 *
 * This is critical for framework wrapper detection — e.g., OXD wraps
 * checkboxes in a div.oxd-checkbox-wrapper, MUI wraps selects in
 * .MuiSelect-root, AntD uses .ant-checkbox-wrapper.
 *
 * Decision: [ADOPTED] from v10.9.0 dom-context-extractor.ts
 */
export function captureAncestorClasses(el: Element): string {
  const classes: string[] = [];
  let current: Element | null = el.parentElement;
  const MAX_DEPTH = 10;
  let depth = 0;
  while (current && current !== document.documentElement && depth < MAX_DEPTH) {
    if (current instanceof HTMLElement && current.className) {
      classes.push(current.className);
    }
    current = current.parentElement;
    depth++;
  }
  return classes.join(' ');
}

// ── Channel B Implementation ─────────────────────────────────────────────

export const ChannelB: EvidenceChannel = {
  channelId: 'B',
  name: 'DOM Structure',

  collect(input: ChannelCollectInput): EvidenceRecord[] {
    const records: EvidenceRecord[] = [];
    const { target, timestamp } = input;

    try {
      // Tag name
      records.push({
        channelId: 'B',
        signalType: 'tag',
        timestamp,
        value: target.tagName,
        confidence: 1.0,
      });

      // CSS classes
      if (target instanceof HTMLElement && target.className) {
        const classes = target.className.trim().split(/\s+/).filter(Boolean);
        if (classes.length > 0) {
          records.push({
            channelId: 'B',
            signalType: 'cssClass',
            timestamp,
            value: classes,
            confidence: 1.0,
          });
        }
      }

      // Text content (textContent works in JSDOM, innerText in real browsers)
      if (target instanceof HTMLElement) {
        const text = target.textContent?.trim() || target.innerText?.trim();
        if (text) {
          records.push({
            channelId: 'B',
            signalType: 'text',
            timestamp,
            value: text.length > 200 ? text.substring(0, 200) + '...' : text,
            confidence: 1.0,
          });
        }
      }

      // Ancestor hierarchy
      const ancestors = captureAncestorChain(target);
      if (ancestors.length > 0) {
        records.push({
          channelId: 'B',
          signalType: 'hierarchy',
          timestamp,
          value: ancestors,
          confidence: 1.0,
        });
      }

      // Ancestor CSS classes (for framework wrapper detection)
      const ancestorClasses = captureAncestorClasses(target);
      if (ancestorClasses) {
        records.push({
          channelId: 'B',
          signalType: 'cssClass',
          timestamp,
          value: ancestorClasses,
          confidence: 1.0,
        });
      }

      // Resolved locators (primary signal for execution IR)
      const locators = resolveLocators(target);
      if (locators.length > 0) {
        records.push({
          channelId: 'B',
          signalType: 'ariaAttribute', // reuse ariaAttribute signal for locators
          timestamp,
          value: locators.map(l => ({ kind: l.kind, value: l.value, confidence: l.confidence })),
          confidence: 1.0,
        });
      }
    } catch {
      // Non-fatal
    }

    return records;
  },
};

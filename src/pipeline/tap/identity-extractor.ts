/**
 * Identity Extractor — Phase 3
 *
 * Extracts a complete TargetElementIdentity (Phase 1 type) from a live DOM element.
 * This is the target architecture's replacement for the existing extractIdentity()
 * in deterministic-recorder.ts. It produces the new structured types directly,
 * eliminating the need for the Phase 2 adapter.
 *
 * Provenance: Synthesized from three reference implementations:
 * - working-better/src/tap/identity-extractor.ts (standalone module pattern)
 * - integration/src/recorder/deterministic-recorder.ts extractIdentity() (comprehensive fields)
 * - Phase 2 channel-b-dom-structure.ts resolveLocators() (structured locator model)
 *
 * Architecture reference: .drytis/architecture-evolution-blueprint.md
 */

import type {
  ResolvedLocator,
  FrameContext,
  TargetElementIdentity,
} from '../../types/element';
import type { LocatorKind } from '../../types/element';
import { resolveLocators, captureAncestorChain, generateCssSelector } from '../channels/channel-b-dom-structure';
import { getAriaRole, computeAccessibleName } from '../channels/channel-a-accessibility';

// ── Shadow DOM Detection ─────────────────────────────────────────────────

export function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot;
}

// ── Iframe Context ───────────────────────────────────────────────────────

export function extractFrameContext(): FrameContext | null {
  if (window === window.top) return null;

  const url = window.location.href;
  let name: string | null = null;
  let frameElementId: string | null = null;
  let frameSelector: string | null = null;
  let depth = 1;

  try {
    const parentDoc = window.parent.document;
    const frames = Array.from(parentDoc.querySelectorAll('iframe'));
    for (const frame of frames) {
      try {
        if (frame.contentWindow === window) {
          name = frame.name || null;
          frameElementId = frame.id || null;
          frameSelector = generateCssSelector(frame);
          break;
        }
      } catch { /* cross-origin */ }
    }
  } catch { /* cross-origin parent */ }

  // Calculate depth
  let w: Window = window;
  try {
    while (w.parent && w.parent !== w) {
      depth++;
      w = w.parent;
    }
  } catch { /* cross-origin ancestor */ }

  return { url, name, frameElementId, frameSelector, depth };
}

// ── Main Extraction ──────────────────────────────────────────────────────

/**
 * Extract a complete TargetElementIdentity from a live DOM element.
 *
 * This function snapshots the element's identity at capture time.
 * The result is immutable — it will not change even if the DOM mutates later.
 *
 * The identity includes:
 * - Tag name, accessible name, ARIA role
 * - ARIA state attributes (expanded, hasPopup, checked, selected, pressed)
 * - Semantic attributes (inputType, contentEditable)
 * - Structured locators (ordered by confidence)
 * - Frame and Shadow DOM context
 */
export function extractTargetIdentity(el: Element): TargetElementIdentity {
  const locators = resolveLocators(el);
  const frameContext = extractFrameContext();
  const inIframe = window !== window.top;

  // ARIA state attributes
  const ariaExpanded = getAriaAttributeBoolean(el, 'aria-expanded');
  const ariaHasPopup = el.getAttribute('aria-haspopup');
  const ariaChecked = getAriaAttributeBoolean(el, 'aria-checked');
  const ariaSelected = getAriaAttributeBoolean(el, 'aria-selected');
  const ariaPressed = getAriaAttributeBoolean(el, 'aria-pressed');

  // Semantic attributes
  const inputType = el instanceof HTMLInputElement ? (el.type || 'text') : null;
  const isContentEditable =
    (el instanceof HTMLElement && el.isContentEditable) ||
    el.getAttribute('contenteditable') === 'true';

  // Primary locator (highest confidence)
  const primaryLocator: ResolvedLocator = locators[0] ?? {
    kind: 'css' as LocatorKind,
    value: generateCssSelector(el),
    confidence: 0.1,
    source: 'computed',
  };

  return {
    tag: el.tagName,
    accessibleName: computeAccessibleName(el),
    ariaRole: getAriaRole(el),
    ariaExpanded,
    ariaHasPopup,
    ariaChecked,
    ariaSelected,
    ariaPressed,
    inputType,
    isContentEditable,
    locators,
    primaryLocator,
    inShadowDom: isInShadowDom(el),
    inIframe,
    frameContext,
  };
}

// ── Helper: ARIA boolean attribute ───────────────────────────────────────

function getAriaAttributeBoolean(el: Element, attr: string): boolean | null {
  const value = el.getAttribute(attr);
  if (value === null) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

// ── Value Capture ────────────────────────────────────────────────────────

/**
 * Capture the current value of an element.
 *
 * Priority:
 *   1. <select> → selected option text
 *   2. <input>/<textarea> → .value
 *   3. aria-valuetext (custom sliders, spinbuttons)
 *   4. aria-valuenow (raw numeric value)
 *   5. contenteditable → innerText
 *   6. aria-selected descendant
 *   7. aria-activedescendant descendant
 *   8. undefined (no value)
 */
export function captureValue(el: Element): string | undefined {
  if (el instanceof HTMLSelectElement) {
    const option = el.options[el.selectedIndex];
    if (option) return option.text?.trim() || option.textContent?.trim() || option.value || '';
    return '';
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value ?? '';
  }
  const ariaValueText = el.getAttribute('aria-valuetext');
  if (ariaValueText !== null) return ariaValueText;
  const ariaValueNow = el.getAttribute('aria-valuenow');
  if (ariaValueNow !== null) return ariaValueNow;
  if (el instanceof HTMLElement && el.isContentEditable) {
    return el.innerText?.trim() || el.textContent?.trim() || '';
  }
  const selected = el.querySelector('[aria-selected="true"]');
  if (selected) return selected.textContent?.trim() || selected.getAttribute('aria-label') || '';
  const descendantId = el.getAttribute('aria-activedescendant');
  if (descendantId) {
    const option = document.getElementById(descendantId);
    if (option) return option.textContent?.trim() || option.getAttribute('aria-label') || '';
  }
  return undefined;
}

/**
 * Capture the current checked state of an element.
 *
 * Priority:
 *   1. Native checkbox/radio → .checked
 *   2. aria-checked attribute
 *   3. aria-pressed attribute
 *   4. CSS-class-based fallback (MUI, AntD, Bootstrap patterns)
 */
export function captureCheckedState(el: Element): boolean | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
  }
  const ariaChecked = el.getAttribute('aria-checked');
  if (ariaChecked !== null) return ariaChecked === 'true';
  const ariaPressed = el.getAttribute('aria-pressed');
  if (ariaPressed !== null) return ariaPressed === 'true';

  // CSS-class-based fallback
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (cls) {
    if (
      cls.includes('mui-checked') ||
      cls.includes('ant-checkbox-checked') ||
      cls.includes('ant-radio-checked') ||
      cls.includes('ant-switch-checked') ||
      cls.includes('checked')
    ) {
      if (cls.includes('unchecked') || cls.includes('not-checked')) return false;
      return true;
    }
  }

  // Descendant-based fallback: the element itself has no detectable checked
  // state, but it may wrap a native checkbox or an ARIA-checked child.
  // Amazon renders filter toggles as <a> wrapping <input type="checkbox">
  // or <i class="a-icon-checkbox">. Walk descendants to find the signal.
  const descendantChecked = findDescendantCheckedStatePipeline(el, 3);
  if (descendantChecked !== undefined) return descendantChecked;

  return undefined;
}

/**
 * Walk descendants (max depth) to find a checked-state signal.
 * Returns the checked state if found, undefined otherwise.
 */
function findDescendantCheckedStatePipeline(el: Element, maxDepth: number): boolean | undefined {
  if (maxDepth <= 0) return undefined;
  const children = el.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // Native checkbox/radio
    if (child instanceof HTMLInputElement) {
      if (child.type === 'checkbox' || child.type === 'radio') return child.checked;
    }
    // aria-checked on child
    const childAriaChecked = child.getAttribute('aria-checked');
    if (childAriaChecked !== null) return childAriaChecked === 'true';
    // CSS class with "checkbox" or "checked" (e.g., Amazon's a-icon-checkbox)
    const childCls = (child.getAttribute('class') || '').toLowerCase();
    if (childCls.includes('checkbox') || childCls.includes('checked')) {
      if (childCls.includes('unchecked') || childCls.includes('not-checked')) return false;
      return true;
    }
    // Recurse
    const deeper = findDescendantCheckedStatePipeline(child, maxDepth - 1);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

// ── DOM Context Extraction ───────────────────────────────────────────────

/**
 * Extract ancestor context for the target element.
 */
export function extractAncestorChain(el: Element): string[] {
  return captureAncestorChain(el);
}

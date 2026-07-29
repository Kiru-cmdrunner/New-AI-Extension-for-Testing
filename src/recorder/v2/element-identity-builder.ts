/**
 * Stage 2 — Element Identity Builder
 *
 * Maps a ControlNode + DOM element → ElementIdentity (the existing format
 * consumed by the service worker's classification pipeline).
 *
 * This bridges the control-centric model to the existing downstream pipeline.
 * The critical difference from deterministic-recorder.ts's extractIdentity():
 * this builder uses the Control Model's resolved target, not the raw DOM event
 * target. This is what fixes the Nationality→Blood Type bug.
 */

import type { ControlNode } from './types';
import type { ElementIdentity, IframeContext } from '../../shared/types';

// ─── CSS Selector Generation ────────────────────────────────────────────────

function cssEscape(id: string): string {
  return (window as any).CSS?.escape?.(id) || id.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function generateCssSelector(el: Element): string {
  const id = el.id;
  if (id) return `#${cssEscape(id)}`;
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.documentElement && depth < 5) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings: Element[] = Array.from(parent.children).filter(
      s => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(current) + 1})`);
    current = parent;
    depth++;
  }
  return parts.join(' > ');
}

function generateXPath(el: Element): string {
  const id = el.id;
  if (id) return `//${el.tagName.toLowerCase()}[@id='${id}']`;
  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.documentElement && depth < 10) {
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings: Element[] = Array.from(parent.children).filter(
      s => s.tagName === current!.tagName,
    );
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}[${siblings.indexOf(current) + 1}]`);
    current = parent;
    depth++;
  }
  return '//' + parts.join('/');
}

// ─── Iframe Detection ──────────────────────────────────────────────────────

function extractIframeContext(): { inIframe: boolean; ctx?: IframeContext } {
  if (window.top === window.self) return { inIframe: false };

  // Inside an iframe — gather context
  const frameSrc = window.location.href;
  let frameName: string | null = null;
  let frameId: string | null = null;
  let frameSelector: string | null = null;
  let frameXPath: string | null = null;
  let frameIndex: number | null = null;

  try {
    // These may throw for cross-origin iframes
    const iframeElements = window.top.document.querySelectorAll('iframe');
    for (let i = 0; i < iframeElements.length; i++) {
      const iframe = iframeElements[i];
      if (iframe.contentWindow === window) {
        frameName = iframe.name || null;
        frameId = iframe.id || null;
        frameIndex = i;
        frameSelector = generateCssSelector(iframe);
        frameXPath = generateXPath(iframe);
        break;
      }
    }
  } catch {
    // Cross-origin — can't access parent DOM
  }

  let depth = 0;
  let w: Window | null = window.parent;
  while (w && w !== w.parent) { depth++; w = w.parent; }
  depth++; // account for top-level

  return {
    inIframe: true,
    ctx: {
      frameSrc,
      frameName,
      frameId,
      frameSelector,
      frameXPath,
      frameIndex,
      frameDepth: depth,
    },
  };
}

function isInShadowDom(el: Element): boolean {
  const root = el.getRootNode();
  // Duck-type check for ShadowRoot (cross-realm safe)
  return !!root && typeof (root as any).host !== 'undefined' && root !== document;
}

// ─── Identity Builder ──────────────────────────────────────────────────────

/**
 * Build an ElementIdentity from a resolved ControlNode and its DOM element.
 *
 * The accessible name and role come from the Control Model's resolution
 * (which is correct — Nationality resolves to "Nationality" not "Blood Type").
 * The rest (cssSelector, xPath, etc.) comes from the DOM element directly.
 *
 * @param ctrl - The resolved ControlNode (correct target)
 * @param el - The DOM element the ControlNode points to (ctrl.elementRef.deref())
 */
export function buildElementIdentity(ctrl: ControlNode, el: Element): ElementIdentity {
  const iframeInfo = extractIframeContext();
  const placeholder = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder');
  // Use duck-type check for className (JSDOM vs Chrome HTMLElement differ)
  const className = typeof (el as any).className === 'string'
    ? (el as any).className || null
    : null;

  const identity: ElementIdentity = {
    accessibleName: ctrl.name,
    ariaRole: ctrl.role,
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: placeholder ?? null,
    tag: el.tagName,
    className,
    name: el.getAttribute('name'),
    stableId: el.id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe: iframeInfo.inIframe,
    shadowDom: isInShadowDom(el),
    elementId: '',
  };

  if (iframeInfo.inIframe && iframeInfo.ctx) {
    identity.iframeContext = iframeInfo.ctx;
  }

  // Synthetic elementId (same priority as deterministic-recorder.ts)
  identity.elementId =
    identity.stableId ||
    identity.testId ||
    identity.dataCy ||
    identity.dataQa ||
    identity.name ||
    identity.cssSelector ||
    `${identity.tag}::${identity.accessibleName}`;

  return identity;
}

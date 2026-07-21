/**
 * Hover Content Script — captures intentional Hover interactions per the
 * permanently frozen C3.1 Hover Recording Product Strategy.
 *
 * Implements the 6-gate decision tree (C3.1 §3.1):
 *   Gate 1: Genuine user event (isTrusted)
 *   Gate 2: Not owned by another interaction (data-cmdrunner-handled)
 *   Gate 3: Hover-responsive target (event handler, :hover CSS, ARIA disclosure)
 *   Gate 4: Intentional pause (dwell ≥ DWELL_THRESHOLD)
 *   Gate 5: Observable application behavior (non-cosmetic DOM mutation)
 *   Gate 6: Optional follow-up interaction confidence boost
 *
 * Product Rules (C3.1 — implementation-independent, permanent):
 *   - Record only when the user intentionally pauses over an element
 *   - Hover must produce observable application behavior (not cosmetic)
 *   - Cosmetic changes (cursor, color, text-decoration) are insufficient
 *
 * Implementation Details (C3.1 — may evolve without changing product rules):
 *   - DWELL_THRESHOLD = 500ms (C3.1 §3.2 implementation detail)
 *   - Observable behavior detected via MutationObserver + CSS analysis (C3.1 §3.3)
 *
 * This file is SELF-CONTAINED — content scripts run in an isolated world
 * and cannot import modules. All helpers are inlined.
 *
 * Pattern follows click-content-script.ts and text-entry-content-script.ts:
 *   - Capture phase event listener
 *   - Identity extraction at commit time (immutable)
 *   - Immediate commit via sendMessage
 *   - Async checkRecording() fallback for MV3 timing gaps
 */

// ═══════════════════════════════════════════════════════════════

// ── Recording State ────────────────────────────────────────

/**
 * Recording state flag, synced from chrome.storage.
 * Uses async fallback check to avoid MV3 timing gaps where
 * onChanged hasn't propagated to the content script's isolated world.
 */
let isRecording = false;

// Guard: chrome API is only available in the extension content script context.
// In test environments, these are no-ops.
if (typeof chrome !== 'undefined' && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const uiState = changes['ui_state'];
    if (uiState && uiState.newValue) {
      isRecording = uiState.newValue.recordingState === 'recording';
    }
  });

  // Sync initial state on script load
  chrome.storage.local.get('ui_state').then((result) => {
    if (result['ui_state']) {
      isRecording = result['ui_state'].recordingState === 'recording';
    }
  }).catch(() => {});
}

/**
 * Check if recording is active with async fallback.
 */
async function checkRecording(): Promise<boolean> {
  if (isRecording) return true;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get('ui_state');
      if (result['ui_state']) {
        isRecording = result['ui_state'].recordingState === 'recording';
      }
    }
  } catch {
    // ignore
  }
  return isRecording;
}

// ── Implementation Detail: Dwell Threshold ────────────────

/**
 * DWELL_THRESHOLD (C3.1 §3.2 — implementation detail).
 *
 * The product rule is "intentional pause." The current implementation
 * detects this with a 500ms dwell threshold. This value may evolve
 * based on future validation without changing the product rule.
 *
 * 500ms rationale (implementation-level):
 *   - Human reaction time to visual stimuli is ~250ms
 *   - Mouse travel between elements rarely pauses > 200-300ms
 *   - Aligns with standard CSS :hover transition durations
 */
const DWELL_THRESHOLD = 500;

// ── Cosmetic Property Exclusion ───────────────────────────

/**
 * CSS properties that are purely cosmetic — their changes do NOT
 * constitute observable application behavior.
 *
 * C3.1 §3.3 Product Rule (permanent): "Purely cosmetic visual changes
 * (cursor changes, color changes, hover highlighting, text-decoration
 * changes) are explicitly documented as insufficient evidence."
 *
 * If the ONLY property that changed during dwell is in this set,
 * the hover is NOT qualified (Gate 5 fails).
 */
const COSMETIC_CSS_PROPERTIES = new Set([
  'background-color',
  'background',
  'background-image',
  'color',
  'border-color',
  'border',
  'outline',
  'outline-color',
  'cursor',
  'text-decoration',
  'text-decoration-color',
  'text-shadow',
  'box-shadow',
  'filter',
  'transform',
  'transition',
  'animation',
  'animation-name',
  'font-style',
  'font-weight',
]);

// ── Visibility Transition Detection (Gate 5, C3.3) ────────

/**
 * CSS properties whose transitions indicate meaningful content reveal.
 *
 * This set is the authoritative reference for which computed styles are
 * tracked in visibility snapshots and checked by isInvisible()/isVisible().
 * The ElementVisibilityState interface captures exactly these properties.
 *
 * If you add a property here, you must also:
 *   1. Add a field to ElementVisibilityState
 *   2. Capture it in captureElementVisibility()
 *   3. Add a check to isInvisible() if it can hide content
 *
 * C3.1 §3.3 Product Rule: "Hover must produce observable application
 * behavior — the application reveals new interactive content (menus,
 * tooltips, panels, action buttons) that changes what the user can do next."
 *
 * This set is deliberately small and precise. Only properties that
 * physically remove content from (or restore content to) the rendered
 * output are included. All other CSS property changes (background-color,
 * cursor, text-decoration, box-shadow, transform, etc.) are handled by
 * the COSMETIC_CSS_PROPERTIES exclusion set.
 */
const VISIBILITY_PROPERTIES = new Set([
  'display',
  'visibility',
  'opacity',
]);

/**
 * The observed scope for visibility transition detection.
 *
 * C3.3 §2: CSS `:hover` mega-menu patterns universally place the submenu
 * as a sibling of the hover target inside a common parent container.
 * Observing the target's parent subtree captures sibling submenus,
 * tooltips, and panels that are revealed by the hover.
 *
 * The hover target itself (e.g., `<a>`) typically has zero children,
 * so observing only the target subtree would miss the sibling content.
 */
const VISIBILITY_OBSERVE_SCOPE: 'parentElement' = 'parentElement';

/**
 * Per-element visibility state captured at a point in time.
 *
 * Used to compare before/after snapshots for transition detection.
 */
interface ElementVisibilityState {
  /** computed style display value */
  display: string;
  /** computed style visibility value */
  visibility: string;
  /** computed style opacity value */
  opacity: string;
  /** true if bounding rect has non-zero width AND height */
  hasSize: boolean;
}

/**
 * A snapshot of visibility states for a subtree, indexed by DOM position.
 *
 * The array follows pre-order traversal order: root element first, then
 * descendants in querySelectorAll('*') order. Both the pre-hover baseline
 * (from a DOM clone) and the live comparison snapshot use the same order,
 * so index i in the baseline corresponds to the same DOM position in the
 * live snapshot.
 *
 * Using positional arrays instead of Map<Element, ...> is required because
 * the pre-hover baseline is taken from a DOM clone — clone elements are
 * different object instances than live DOM elements, so Map keys by
 * reference would not match.
 */
interface VisibilitySnapshot {
  /** Visibility states in pre-order traversal order */
  states: ElementVisibilityState[];
}

/**
 * Check if an element's visibility state qualifies as "invisible".
 *
 * An element is invisible if ANY of these primary signals are true:
 *   - display is 'none' (removed from rendering)
 *   - visibility is 'hidden' (rendered but not visible)
 *   - opacity is '0' (fully transparent)
 *
 * Note: hasSize (bounding rect dimensions) is captured for diagnostic
 * purposes but is NOT used as a primary invisibility signal. In
 * headless/test environments (JSDOM), getBoundingClientRect always
 * returns zero dimensions — relying on it would mark every element
 * as invisible. In production browsers, the three CSS properties above
 * are the authoritative signals for content visibility transitions.
 *
 * @returns true if the element is in a "hidden" state
 */
function isInvisible(state: ElementVisibilityState): boolean {
  if (state.display === 'none') return true;
  if (state.visibility === 'hidden') return true;
  if (state.opacity === '0') return true;
  return false;
}

/**
 * Check if an element's visibility state qualifies as "visible".
 *
 * An element is visible if NONE of the invisibility conditions apply:
 *   - display is not 'none'
 *   - visibility is not 'hidden'
 *   - opacity is not '0'
 */
function isVisible(state: ElementVisibilityState): boolean {
  return !isInvisible(state);
}

/**
 * Capture the computed visibility state of a single element.
 *
 * Uses window.getComputedStyle() which always returns resolved values
 * regardless of stylesheet origin — critical for cross-origin stylesheets
 * where sheet.cssRules throws SecurityError.
 */
function captureElementVisibility(el: Element): ElementVisibilityState {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return {
    display: cs.display,
    visibility: cs.visibility,
    opacity: cs.opacity,
    hasSize: rect.width > 0 && rect.height > 0,
  };
}

/**
 * Take a visibility snapshot of an element's entire subtree.
 *
 * Captures visibility state for the root and all descendants in pre-order
 * traversal order. The same traversal is used for both the pre-hover
 * baseline (from a clone) and the live comparison, ensuring index alignment.
 *
 * @param root The element whose subtree to snapshot (typically target.parentElement)
 * @returns A VisibilitySnapshot with states in DOM order
 */
function takeVisibilitySnapshot(root: Element): VisibilitySnapshot {
  const states: ElementVisibilityState[] = [];

  // Include the root itself
  states.push(captureElementVisibility(root));

  // Include all descendants
  const descendants = root.querySelectorAll('*');
  for (let i = 0; i < descendants.length; i++) {
    states.push(captureElementVisibility(descendants[i]));
  }

  return { states };
}

/**
 * Result of a visibility transition comparison.
 *
 * qualified=true means at least one element transitioned from
 * invisible to visible — observable application behavior detected.
 */
interface VisibilityTransitionResult {
  /** true if a hidden→visible transition was found */
  qualified: boolean;
  /** number of elements that transitioned (diagnostic) */
  transitionCount: number;
}

/**
 * Compare a baseline snapshot against the current DOM state.
 *
 * C3.3 Gate 5 Mechanism 2: Determines whether any element in the observed
 * subtree transitioned from an invisible state to a visible state between
 * the pre-hover baseline snapshot and the current live state at dwell
 * timer fire.
 *
 * Only transitions on VISIBILITY_PROPERTIES (display, visibility, opacity)
 * qualify. Cosmetic property changes (background-color, cursor,
 * text-decoration, etc.) are inherently ignored because they don't affect
 * the element's visibility state.
 *
 * The baseline and current snapshots must be taken from the same root
 * element using the same traversal order, so index i in baseline corresponds
 * to the same DOM position in the current snapshot.
 *
 * @param baseline The pre-hover snapshot (from DOM clone)
 * @param root The live root element to take current snapshot from
 * @returns qualified=true if any element transitioned invisible→visible
 */
function detectVisibilityTransition(
  baseline: VisibilitySnapshot,
  root: Element,
): VisibilityTransitionResult {
  const current = takeVisibilitySnapshot(root);
  let transitionCount = 0;

  for (let i = 0; i < baseline.states.length && i < current.states.length; i++) {
    if (isInvisible(baseline.states[i]) && isVisible(current.states[i])) {
      transitionCount++;
    }
  }

  return {
    qualified: transitionCount > 0,
    transitionCount,
  };
}

/**
 * Factory for a visibility transition detector.
 *
 * Follows the same pattern as createObservableObserver: returns an object
 * with methods the caller uses. Gate 5 consumes only the boolean result,
 * not this object — preserving the abstraction boundary.
 *
 * @returns An object with a compare(baseline, root) method
 */
function createVisibilityTransitionDetector(): {
  compare: (baseline: VisibilitySnapshot, root: Element) => boolean;
} {
  return {
    compare(baseline: VisibilitySnapshot, root: Element): boolean {
      return detectVisibilityTransition(baseline, root).qualified;
    },
  };
}

/**
 * Maximum number of ancestor levels to walk up when searching for a clone
 * scope that contains invisible elements.
 *
 * C3.3 §2: CSS :hover mega-menu patterns place the submenu as a sibling of
 * the hover target inside a common parent container. The CSS rules that hide
 * the submenu often reference ancestors beyond the immediate parent (e.g.,
 * `.mainNav > ul > li.parent:hover ul.submenu { display: none; }`).
 *
 * Cloning only the immediate parent breaks the ancestor chain, causing the
 * CSS rule to stop matching and the submenu to appear visible in the clone
 * (producing a false baseline with no invisible elements).
 *
 * Walking up restores the ancestor chain so the CSS rule matches and the
 * submenu correctly appears invisible in the clone.
 *
 * MAX_LEVELS bounds the walk to prevent cloning excessively large subtrees.
 * Testing on real-world sites (Adani One, generic mega menus, tooltips,
 * sibling selectors) showed the effective scope is typically found within
 * 1-3 levels. MAX_LEVELS=4 provides a safety margin.
 *
 * Performance: each level that doesn't find invisible elements adds ~0.2ms
 * (small subtree clone + quick invisible check). Only the successful level
 * reads full getComputedStyle on all descendants.
 */
const MAX_WALKUP_LEVELS = 4;

/**
 * Result of a walk-up pre-hover snapshot.
 *
 * Contains the baseline visibility snapshot AND the effective scope element
 * that the snapshot was taken from. The effective scope is the ancestor whose
 * clone contained invisible elements — it may be wider than target.parentElement
 * to preserve CSS ancestor-chain context.
 */
interface PreHoverSnapshotResult {
  /** The pre-hover baseline visibility snapshot (from clone) */
  baseline: VisibilitySnapshot;
  /** The element the baseline was taken from (used for live comparison at dwell fire) */
  effectiveScope: Element;
  /** Number of ancestor levels walked to find the effective scope */
  levelsWalked: number;
}

/**
 * Take a pre-hover visibility snapshot using DOM cloning with incremental
 * ancestor walk-up.
 *
 * C3.3 Gate 5 Mechanism 2 — Pre-Hover Baseline (Incremental Walk-Up Clone):
 *
 * The browser applies CSS :hover during hit-testing, BEFORE any mouse event
 * is dispatched. Calling takeVisibilitySnapshot() directly on the live DOM at
 * mouseenter captures the POST-hover state, making transition detection
 * impossible.
 *
 * This function solves the timing problem by cloning the root element into
 * an off-screen container. The clone is not under the cursor, so :hover does
 * not apply to it, and getComputedStyle() produces the exact pre-hover
 * visibility state.
 *
 * ── Walk-Up Logic ──
 *
 * Cloning a narrow subtree (e.g., just target.parentElement) breaks CSS
 * context-dependent selectors. If the CSS rule that hides the submenu
 * references an ancestor beyond the clone root (e.g.,
 * `.mainNav > ul > li:hover ul.submenu { display: none; }`), the rule
 * stops matching in the clone and the submenu appears visible — producing
 * a false baseline with no invisible elements.
 *
 * To solve this, we walk UP from the target's parent, cloning at each
 * ancestor level. At each level, we check if the clone contains any
 * invisible elements. The first ancestor whose clone shows invisible
 * elements becomes the effective scope.
 *
 * Wider clones include more ancestors, so CSS selectors referencing those
 * ancestors match correctly in the clone. The submenu appears as
 * display:none (pre-hover state), and at dwell timer fire the live DOM
 * (hovered) shows display:block — producing a detectable transition.
 *
 * If no ancestor within MAX_WALKUP_LEVELS produces a clone with invisible
 * elements, we fall back to the widest level tested (the last ancestor).
 * This handles cases where there are genuinely no hidden elements to find
 * (e.g., cosmetic-only hovers that don't change visibility).
 *
 * ── Implementation Assumptions ──
 *
 * A1. Clone represents pre-hover state: The off-screen container
 *     (position:absolute; left:-9999px) is not under the cursor, so the
 *     browser does not apply :hover to the clone or its ancestors.
 *
 * A2. Walk-up preserves CSS context: Cloning from a wider ancestor includes
 *     the elements that CSS selectors reference, so the cascade resolves
 *     correctly in the clone.
 *
 * A3. Traversal order alignment: Both the clone baseline and the live
 *     comparison snapshot use querySelectorAll('*'), which returns elements
 *     in document order (pre-order DFS). Index i in the baseline array
 *     corresponds to the same DOM position in the current snapshot, as long
 *     as no elements were added or removed between baseline capture and
 *     comparison.
 *
 * A4. Inline styles preserved in clone: cloneNode(true) copies the style
 *     attribute faithfully, so inline display:none/visibility:hidden/
 *     opacity:0 are captured correctly in the baseline.
 *
 * A5. No visibility:hidden on container: The off-screen container must NOT
 *     use visibility:hidden — it would cascade to all descendants.
 *
 * A6. Determinism: Given the same DOM structure and stylesheets, the clone
 *     always produces identical computed styles.
 *
 * @param targetParent The target element's parentElement (starting point for walk-up)
 * @returns Baseline snapshot + effective scope element, or null on failure
 */
function takePreHoverSnapshotWithWalkUp(
  targetParent: Element,
): PreHoverSnapshotResult | null {
  let currentAncestor: Element | null = targetParent;
  let lastScope: Element = targetParent;
  let lastBaseline: VisibilitySnapshot | null = null;
  let levelsWalked = 0;

  for (let level = 0; level < MAX_WALKUP_LEVELS && currentAncestor; level++) {
    // Clone this ancestor subtree into off-screen container
    const clone = currentAncestor.cloneNode(true) as Element;

    const container = document.createElement('div');
    container.setAttribute('data-cmdrunner-clone', '');
    container.style.cssText =
      'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;' +
      'overflow:hidden;pointer-events:none;';

    container.appendChild(clone);
    document.body.appendChild(container);

    // Take visibility snapshot from the clone (pre-hover state)
    const baseline = takeVisibilitySnapshot(clone);

    // Immediately remove the clone container
    container.remove();

    // Check if this clone has any invisible elements
    const hasInvisible = baseline.states.some((s) => isInvisible(s));

    lastScope = currentAncestor;
    lastBaseline = baseline;
    levelsWalked = level;

    if (hasInvisible) {
      // Found the effective scope — clone has invisible elements that
      // might transition to visible on hover
      return { baseline, effectiveScope: currentAncestor, levelsWalked: level };
    }

    // Walk up to parent
    currentAncestor = currentAncestor.parentElement;
  }

  // No ancestor produced a clone with invisible elements.
  // Return the widest baseline tested (last ancestor walked).
  // The transition detection will find 0 transitions, causing Gate 5
  // Mechanism 2 to fail — which is correct for elements with no hidden
  // content (cosmetic-only hovers).
  if (lastBaseline) {
    return {
      baseline: lastBaseline,
      effectiveScope: lastScope,
      levelsWalked: levelsWalked,
    };
  }

  return null;
}

// ── Hover-Responsive Detection (Gate 3) ───────────────────

/**
 * Selector for elements that are likely to have hover behavior.
 *
 * Gate 3 checks whether the target has hover-responsive characteristics:
 *   - Event handlers for mouseenter/mouseover
 *   - ARIA disclosure attributes (aria-haspopup)
 *   - Explicit hover-related CSS rules (non-cosmetic)
 *
 * This is a lightweight pre-filter — the real qualification happens
 * in Gate 5 (observable behavior detection via MutationObserver).
 */
function isHoverResponsive(el: Element): boolean {
  // Check ARIA disclosure attributes
  if (el.getAttribute('aria-haspopup')) return true;

  // Check for explicit event handlers (heuristic — can't read all listeners)
  const htmlEl = el as HTMLElement;
  if (htmlEl.onmouseenter || htmlEl.onmouseover) return true;

  // Check inline onclick (common pattern for menus)
  if (htmlEl.getAttribute('onclick')) return true;

  // Check :hover CSS rules that modify non-cosmetic properties
  if (hasNonCosmeticHoverRule(el)) return true;

  // Check for common hover-menu class patterns
  const className = el.className;
  if (typeof className === 'string') {
    const lowerClass = className.toLowerCase();
    if (lowerClass.includes('dropdown') ||
        lowerClass.includes('menu') ||
        lowerClass.includes('tooltip') ||
        lowerClass.includes('popover') ||
        lowerClass.includes('hover')) {
      return true;
    }
  }

  // Check for data attributes suggesting hover behavior
  if (el.hasAttribute('data-toggle') || el.hasAttribute('data-bs-toggle')) return true;

  // Elements with role="menuitem" or nested in a menu are hover-responsive
  const role = el.getAttribute('role');
  if (role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox') {
    return true;
  }

  // Anchor elements in navigation contexts (mega-menus)
  if (el.tagName === 'A' && el.closest('nav, [role="navigation"]')) {
    return true;
  }

  // Summary elements (disclosure widgets) have native hover behavior
  if (el.tagName === 'SUMMARY') return true;

  return false;
}

/**
 * Check if the element has a :hover CSS rule that modifies non-cosmetic properties.
 *
 * Walks the document's CSS rules looking for :hover selectors that match
 * this element and modify display/visibility/opacity/height.
 */
function hasNonCosmeticHoverRule(el: Element): boolean {
  try {
    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules;
        for (let i = 0; i < rules.length; i++) {
          const rule = rules[i] as CSSStyleRule;
          if (!rule.selectorText || !rule.selectorText.includes(':hover')) continue;

          // Check if this :hover rule could apply to our element
          const baseSelector = rule.selectorText.replace(/:hover/g, '');
          try {
            if (!el.matches(baseSelector)) continue;
          } catch {
            continue;
          }

          // Check if the rule modifies non-cosmetic properties
          const style = rule.style;
          for (let p = 0; p < style.length; p++) {
            const prop = style[p];
            if (!COSMETIC_CSS_PROPERTIES.has(prop)) {
              return true;
            }
          }
        }
      } catch {
        // Cross-origin stylesheet — skip
      }
    }
  } catch {
    // SecurityError or other — treat as no hover rule found
  }
  return false;
}

// ── Observable Behavior Detection (Gate 5) ────────────────

/**
 * Track non-cosmetic changes observed by the MutationObserver.
 *
 * C3.1 §3.3 Product Rule: "Hover must produce observable application
 * behavior (new interactive content revealed)."
 *
 * Implementation detail: detected via MutationObserver watching for:
 *   1. childList changes (elements added/removed)
 *   2. attribute changes to display/visibility/opacity
 *
 * Cosmetic attribute changes (style with only cosmetic properties)
 * do NOT qualify.
 */
function createObservableObserver(
  onObservableChange: () => void,
): MutationObserver | null {
  if (typeof MutationObserver === 'undefined') return null;

  let qualified = false;

  const observer = new MutationObserver((mutations) => {
    if (qualified) return; // Already decided — don't re-check

    for (const mutation of mutations) {
      // childList changes = elements added/removed = observable behavior
      if (mutation.type === 'childList') {
        if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
          qualified = true;
          onObservableChange();
          return;
        }
      }

      // Attribute changes — check if non-cosmetic
      if (mutation.type === 'attributes') {
        const attrName = mutation.attributeName;

        // style attribute changes — check individual properties
        if (attrName === 'style') {
          // Extract the individual CSS properties from the style attribute
          const target = mutation.target as HTMLElement;
          if (hasNonCosmeticInlineStyleChange(target)) {
            qualified = true;
            onObservableChange();
            return;
          }
          continue;
        }

        // class changes — could trigger CSS that reveals content.
        // We accept class changes as potentially observable since they
        // often trigger display/visibility changes via CSS class rules.
        if (attrName === 'class') {
          qualified = true;
          onObservableChange();
          return;
        }

        // Direct display/visibility/hidden attribute changes
        if (attrName === 'hidden' || attrName === 'aria-hidden' ||
            attrName === 'aria-expanded') {
          qualified = true;
          onObservableChange();
          return;
        }
      }
    }
  });

  return observer;
}

/**
 * Check if an inline style change includes non-cosmetic property changes.
 *
 * Reads the element's style.cssText to extract individual properties and
 * checks each against the COSMETIC_CSS_PROPERTIES exclusion set.
 *
 * C3.1 §3.3 Product Rule: "Purely cosmetic visual changes do NOT constitute
 * sufficient evidence of a meaningful hover interaction."
 *
 * If ALL changed properties are in the cosmetic set, the change does NOT
 * qualify as observable behavior. If ANY changed property is non-cosmetic
 * (display, visibility, opacity, height, width, max-height, overflow, etc.),
 * it qualifies.
 */
function hasNonCosmeticInlineStyleChange(el: HTMLElement): boolean {
  const style = el.style;
  if (!style || style.length === 0) return false;

  // Collect all property names from the inline style
  const props: string[] = [];
  for (let i = 0; i < style.length; i++) {
    props.push(style[i]);
  }

  // If every property is cosmetic, the change is cosmetic-only → reject
  const allCosmetic = props.every((prop) => COSMETIC_CSS_PROPERTIES.has(prop));
  if (allCosmetic) return false;

  // At least one property is non-cosmetic → qualifies as observable
  // Verify the non-cosmetic property has a meaningful value (not empty/none/0)
  for (const prop of props) {
    if (COSMETIC_CSS_PROPERTIES.has(prop)) continue;
    const value = style.getPropertyValue(prop);
    if (value && value.trim() && value.trim() !== 'none' && value.trim() !== '0') {
      return true;
    }
  }

  return false;
}

// ── Ownership Check (Gate 2) ──────────────────────────────

/**
 * Check if another interaction has already claimed this element.
 *
 * C3.1 §6.2: "Hover respects ownership (Gate 2) — if present, the hover
 * is discarded."
 *
 * Hover does NOT claim ownership — it is transient. It does NOT set
 * data-cmdrunner-handled on any element.
 */
function isOwnedByAnother(target: Element): boolean {
  return !!target.closest('[data-cmdrunner-handled]');
}

// ── Identity Extraction ───────────────────────────────────

/**
 * Extract element identity at hover commit time.
 * Mirrors RawElementIdentity in types.ts.
 * Uses the same extraction pattern as click-content-script.ts.
 */
interface HoverIdentity {
  accessibleName: string;
  ariaRole: string | null;
  ariaLabel: string | null;
  ariaLabelledBy: string | null;
  placeholder: string | null;
  tag: string;
  name: string | null;
  stableId: string | null;
  testId: string | null;
  dataCy: string | null;
  dataQa: string | null;
  cssSelector: string;
  xPath: string;
  inIframe: boolean;
  shadowDom: boolean;
  iframeContext?: {
    frameSrc: string | null;
    frameName: string | null;
    frameId: string | null;
    frameIndex: number | null;
    frameSelector: string | null;
  } | null;
}

function extractIdentity(el: Element): HoverIdentity {
  const iframeCtx = extractIframeContext();
  return {
    accessibleName: computeAccessibleName(el),
    ariaRole: getImplicitRole(el),
    ariaLabel: el.getAttribute('aria-label'),
    ariaLabelledBy: el.getAttribute('aria-labelledby'),
    placeholder: el.getAttribute('placeholder'),
    tag: el.tagName,
    className: el.className || null,
    name: el.getAttribute('name'),
    stableId: el.id || null,
    testId: el.getAttribute('data-testid'),
    dataCy: el.getAttribute('data-cy'),
    dataQa: el.getAttribute('data-qa'),
    cssSelector: generateCssSelector(el),
    xPath: generateXPath(el),
    inIframe: iframeCtx !== null,
    shadowDom: el.getRootNode() instanceof ShadowRoot,
    iframeContext: iframeCtx,
  };
}

/**
 * Extract iframe context if running inside an iframe.
 * Mirrors click-content-script.ts extractIframeContext().
 */
function extractIframeContext(): {
  frameSrc: string | null;
  frameName: string | null;
  frameId: string | null;
  frameIndex: number | null;
  frameSelector: string | null;
} | null {
  if (window === window.top) return null;

  try {
    const frameElement = window.frameElement as HTMLIFrameElement | null;
    return {
      frameSrc: window.location?.href || null,
      frameName: window.name || null,
      frameId: frameElement?.id || null,
      frameIndex: frameElement ? Array.from(parent.document.querySelectorAll('iframe')).indexOf(frameElement) : null,
      frameSelector: frameElement ? generateCssSelector(frameElement) : null,
    };
  } catch {
    // Cross-origin parent — can't access frameElement
    return {
      frameSrc: window.location?.href || null,
      frameName: window.name || null,
      frameId: null,
      frameIndex: null,
      frameSelector: null,
    };
  }
}

// ── Accessible Name Computation ───────────────────────────

function computeAccessibleName(el: Element): string {
  // a. aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return truncate(ariaLabel.trim(), 200);

  // b. aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/).filter(Boolean);
    const texts: string[] = [];
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) {
        const text = target.textContent?.trim();
        if (text) texts.push(text);
      }
    }
    if (texts.length > 0) return truncate(texts.join(' '), 200);
  }

  // c. innerText (rendered text)
  if (el instanceof HTMLElement) {
    const inner = el.innerText?.trim();
    if (inner) return truncate(inner, 200);
  }

  // d. textContent
  const textContent = el.textContent?.trim();
  if (textContent) return truncate(textContent, 200);

  // e. Associated <label for> (for form elements)
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`);
    if (label) {
      const labelText = label.textContent?.trim();
      if (labelText) return truncate(labelText, 200);
    }
  }

  // f. placeholder
  const placeholder = el.getAttribute('placeholder');
  if (placeholder && placeholder.trim()) return truncate(placeholder.trim(), 200);

  // g. value (for form elements)
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    if (el.value && el.value.trim()) return truncate(el.value.trim(), 200);
  }

  // h. alt (for images)
  const alt = el.getAttribute('alt');
  if (alt && alt.trim()) return truncate(alt.trim(), 200);

  // i. title
  const title = el.getAttribute('title');
  if (title && title.trim()) return truncate(title.trim(), 200);

  return '';
}

// ── Role Mapping ──────────────────────────────────────────

function getImplicitRole(el: Element): string | null {
  const explicitRole = el.getAttribute('role');
  if (explicitRole && explicitRole.trim()) return explicitRole.trim();

  const tag = el.tagName;
  const TAG_ROLE_MAP: Record<string, string> = {
    A: 'link', BUTTON: 'button', NAV: 'navigation', MAIN: 'main',
    HEADER: 'banner', FOOTER: 'contentinfo', ASIDE: 'complementary',
    ARTICLE: 'article', SECTION: 'region', FORM: 'form', SEARCH: 'search',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
    H5: 'heading', H6: 'heading', UL: 'list', OL: 'list', LI: 'listitem',
    TABLE: 'table', TR: 'row', TH: 'columnheader', TD: 'cell',
    DETAILS: 'group', DIALOG: 'dialog', IMG: 'img', FIGURE: 'figure',
    FIGCAPTION: 'caption', SELECT: 'listbox', OPTION: 'option',
    TEXTAREA: 'textbox', SUMMARY: 'button',
  };
  return TAG_ROLE_MAP[tag] || null;
}

// ── CSS Selector & XPath Generation ───────────────────────

function generateCssSelector(el: Element): string {
  const id = el.id;
  if (id) return `#${cssEscape(id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && current !== document.documentElement && depth < 5) {
    const tag = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
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
    const parent = current.parentElement;
    if (!parent) { parts.unshift(tag); break; }
    const siblings = Array.from(parent.children).filter((s) => s.tagName === current!.tagName);
    if (siblings.length === 1) parts.unshift(tag);
    else parts.unshift(`${tag}[${siblings.indexOf(current) + 1}]`);
    current = parent;
    depth++;
  }
  return '//' + parts.join('/');
}

// ── Hover Tracking State ──────────────────────────────────

/**
 * Per-element hover tracking state.
 * Tracks the dwell timer and MutationObserver for a single hover candidate.
 */
interface HoverCandidate {
  element: Element;
  enterTime: number;
  dwellTimer: ReturnType<typeof setTimeout> | null;
  mutationObserver: MutationObserver | null;
  /** C3.3: Baseline visibility snapshot taken at mouseenter (pre-hover state) */
  baselineVisibility: VisibilitySnapshot | null;
  /**
   * C3.3: The effective scope element for live comparison at dwell fire.
   *
   * Set by takePreHoverSnapshotWithWalkUp(). May be wider than
   * target.parentElement — the walk-up clone finds the nearest ancestor
   * whose clone contains invisible elements, preserving CSS ancestor-chain
   * context for context-dependent selectors (e.g., Adani One mega-menus
   * where the hiding selector references `.mainNav > ul > li`).
   */
  effectiveVisibilityRoot: Element | null;
  /** Number of ancestor levels walked to find effective scope. */
  walkUpLevels: number;
  qualified: boolean;       // Gate 5 passed (observable behavior detected)
  /** Which mechanism qualified the hover. */
  qualifiedBy: 'mutation-observer' | 'visibility-transition' | null;
  committed: boolean;       // Already sent HOVER_CAPTURED
}

/**
 * Active hover candidate. Only one at a time (mouseenter/mouseleave
 * semantics ensure this).
 */
let activeCandidate: HoverCandidate | null = null;

/**
 * Debounce map: prevent re-recording the same element hover within
 * a short window. Per C3.1 §3.5, nested element traversal should not
 * cause duplicate hover events.
 */
const recentHovers = new Map<string, number>();
const RECENT_HOVER_SUPPRESS_MS = 2000;

// ── Hover Commit ──────────────────────────────────────────

/**
 * Commit a hover — send HOVER_CAPTURED to the background.
 *
 * C3.1: The hover interaction exists at the moment this message is sent.
 * Identity is extracted NOW (at commit), not at mouseenter — this ensures
 * we capture the element state after the observable behavior occurred.
 */
function commitHover(el: Element): void {
  if (!activeCandidate || activeCandidate.committed) return;
  activeCandidate.committed = true;

  const identity = extractIdentity(el);


  // Record recent hover for debounce
  const key = [identity.tag, identity.stableId || '', identity.cssSelector].join('|');
  recentHovers.set(key, Date.now());

  // Cleanup active candidate timers/observers
  cleanupCandidate();

  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.sendMessage({
      type: 'HOVER_CAPTURED',
      payload: identity,
    }).catch((err: unknown) => {
      console.error('[CmdRunner] HOVER_CAPTURED sendMessage failed:', err);
    });
  }
}

/**
 * Clean up the active hover candidate (timers, observers).
 */
function cleanupCandidate(): void {
  if (!activeCandidate) return;

  if (activeCandidate.dwellTimer) {
    clearTimeout(activeCandidate.dwellTimer);
    activeCandidate.dwellTimer = null;
  }
  if (activeCandidate.mutationObserver) {
    activeCandidate.mutationObserver.disconnect();
    activeCandidate.mutationObserver = null;
  }
  activeCandidate = null;
}

// ── Hover Handlers (6-Gate Decision Tree) ─────────────────

/**
 * Resolve the hover target from the event.
 *
 * Unlike click (which resolves to the nearest interactive ancestor),
 * hover targets ARE the element the user is hovering — including
 * containers (nav, li, div) that have hover behavior.
 *
 * We do resolve up to the nearest hover-responsive ancestor if the
 * raw target isn't hover-responsive itself (common in nested menus
 * where the child span doesn't have the handler but the parent li does).
 */
function resolveHoverTarget(event: MouseEvent): Element | null {
  const rawTarget = event.target;
  if (!rawTarget || !(rawTarget instanceof Element)) return null;

  // If the raw target is hover-responsive, use it
  if (isHoverResponsive(rawTarget)) return rawTarget;

  // Walk up to find nearest hover-responsive ancestor
  // (composedPath crosses Shadow DOM boundaries)
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof Element && isHoverResponsive(node)) {
      return node;
    }
  }

  // Fallback: parentElement walk
  let current: Element | null = rawTarget;
  while (current) {
    if (isHoverResponsive(current)) return current;
    current = current.parentElement;
  }

  // No hover-responsive element found
  return null;
}

/**
 * Mouseenter handler — initiates the Hover decision tree.
 *
 * C3.1 §3.1: All gates must pass for a hover to be recorded.
 * Gates 1-3 are checked immediately on mouseenter.
 * Gate 4 (dwell) requires a timer.
 * Gate 5 (observable behavior) requires MutationObserver.
 * Gate 6 (follow-up interaction) is optional — confidence boost only.
 *
 * C3.1 §3.5: Use mouseenter/mouseleave (not mouseover/mouseout).
 * mouseenter fires once when the pointer enters the element boundary
 * and does not re-fire for child elements. This naturally debounces
 * nested element traversal.
 */
async function handleMouseEnter(event: MouseEvent): Promise<void> {

  // ── GATE 1: Is it genuine? ──
  if (!event.isTrusted) {
    return;
  }

  // Recording must be active (async fallback for MV3 timing gaps)
  const recording = await checkRecording();
  if (!recording) {
    return;
  }

  // Clean up any previous hover candidate
  if (activeCandidate) {
    // If the previous candidate hasn't committed yet, it failed Gate 4 (dwell)
    cleanupCandidate();
  }

  // ── Resolve hover target ──
  const target = resolveHoverTarget(event);
  if (!target) {
    return;
  }

  // ── GATE 2: Does another interaction own it? ──
  if (isOwnedByAnother(target)) {
    return;
  }

  // ── GATE 3: Is the target hover-responsive? ──
  // resolveHoverTarget already checked this, but be explicit
  if (!isHoverResponsive(target)) {
    return;
  }

  // ── Debounce check: recent hover on same element? ──
  const tempIdentity = extractIdentity(target);
  const tempKey = [tempIdentity.tag, tempIdentity.stableId || '', tempIdentity.cssSelector].join('|');
  const lastHoverTime = recentHovers.get(tempKey);
  if (lastHoverTime && (Date.now() - lastHoverTime) < RECENT_HOVER_SUPPRESS_MS) {
    return;
  }

  // ── Start hover candidate tracking ──
  // Gates 4 and 5 will be evaluated asynchronously.
  const candidate: HoverCandidate = {
    element: target,
    enterTime: Date.now(),
    dwellTimer: null,
    mutationObserver: null,
    baselineVisibility: null,
    effectiveVisibilityRoot: null,
    walkUpLevels: 0,
    qualified: false,
    qualifiedBy: null,
    committed: false,
  };
  activeCandidate = candidate;

  // ── GATE 4: Intentional pause (dwell ≥ DWELL_THRESHOLD) ──
  // Implementation detail (C3.1 §3.2): 500ms dwell threshold.
  candidate.dwellTimer = setTimeout(() => {
    if (!activeCandidate || activeCandidate !== candidate) {
      return;
    }


    // Dwell threshold met — now check Gate 5.

    // ── GATE 5: Observable application behavior ──
    //
    // Two independent evidence mechanisms (OR logic):
    //
    // Mechanism 1 (existing): MutationObserver
    //   If it fired during dwell, candidate.qualified is already true.
    //
    // Mechanism 2 (C3.3): Visibility Transition Detection
    //   Compare current visibility state against baseline snapshot.
    //   Catches CSS-only :hover reveals that produce zero DOM mutations.
    //
    // Gate 5 consumes only candidate.qualified — no coupling to either mechanism.

    // Mechanism 1 check: MutationObserver already qualified?
    if (candidate.qualified) {
      // MutationObserver detected observable behavior during dwell
      if (!candidate.qualifiedBy) candidate.qualifiedBy = 'mutation-observer';
      commitHover(candidate.element);
      return;
    }

    // Mechanism 2 check: Visibility Transition Detection
    if (candidate.baselineVisibility && candidate.effectiveVisibilityRoot) {
      const detector = createVisibilityTransitionDetector();
      const qualified = detector.compare(
        candidate.baselineVisibility,
        candidate.effectiveVisibilityRoot,
      );
      if (qualified) {
        candidate.qualified = true;
        candidate.qualifiedBy = 'visibility-transition';
        commitHover(candidate.element);
        return;
      }
    }

    // Neither mechanism detected observable behavior.
    // Gate 5 fails — the hover did not produce meaningful application behavior.
    // Per C3.1: "When uncertain, do not record."
    cleanupCandidate();
  }, DWELL_THRESHOLD);

  // ── Attach MutationObserver for Gate 5 (Mechanism 1) ──
  // C3.1 R1 intent: don't attach observers globally on page load (performance).
  // The observer is attached here on mouseenter (only when the user is actively
  // hovering a specific element), and detached on mouseleave or after dwell.
  // It must watch DURING the dwell period — not after the threshold — because
  // hover-revealed content (menus, tooltips) appears during this window.
  // Attaching after the threshold would miss the very mutations we need to detect.
  const __originalObserverCallback = () => {
    candidate.qualified = true;
    if (!candidate.qualifiedBy) candidate.qualifiedBy = 'mutation-observer';
  };

  const __diagObserverCallback = () => {
    __originalObserverCallback();
  };

  const observer = createObservableObserver(__diagObserverCallback);

  if (observer) {
    candidate.mutationObserver = observer;
    observer.observe(target, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden', 'aria-expanded'],
    });
  } else {
  }

  // ── Take baseline visibility snapshot for Gate 5 (Mechanism 2) ──
  // C3.3: Captures the PRE-HOVER visibility state using Incremental Walk-Up
  // Clone. The browser applies CSS :hover BEFORE the mouseenter event fires,
  // so we cannot read the pre-hover state from the live DOM.
  //
  // The walk-up clone approach:
  //   1. Clone target.parentElement subtree to off-screen container (:hover
  //      does not apply to off-screen elements).
  //   2. Check if the clone contains invisible elements. If yes, this level
  //      is the effective scope.
  //   3. If no invisible elements found, walk up one level (clone
  //      target.parentElement.parentElement, etc.) and repeat.
  //   4. Stop at first level with invisible elements, or at MAX_WALKUP_LEVELS.
  //
  // This preserves CSS ancestor-chain context for compound selectors (e.g.,
  // Adani One's `.PrimaryMenu_mainNav > ul > li:hover ul.submenu { display: block; }`).
  // The walking ancestor becomes the effective scope for both baseline capture
  // and live comparison at dwell fire.
  const targetParent = target.parentElement || target;
  const preHoverResult = takePreHoverSnapshotWithWalkUp(targetParent);
  if (preHoverResult) {
    candidate.baselineVisibility = preHoverResult.baseline;
    candidate.effectiveVisibilityRoot = preHoverResult.effectiveScope;
    candidate.walkUpLevels = preHoverResult.levelsWalked;
  }
}

/**
 * Mouseleave handler — cancels pending hover if user leaves before threshold.
 *
 * C3.1 §3.5: "Cancel pending hover on rapid exit."
 * If the pointer leaves the element before the dwell threshold is reached,
 * the pending hover is cancelled. No interaction is recorded.
 */
function handleMouseLeave(event: MouseEvent): void {
  if (!event.isTrusted) return;

  // Only cancel if this mouseleave is for our active candidate's element
  if (!activeCandidate) return;

  const candidate = activeCandidate;

  // Check if the mouse left the tracked element
  // (event.target is the element being left, event.relatedTarget is where
  // the mouse is going — null means left the window)
  const leavingTarget = event.target;
  if (candidate.element === leavingTarget ||
      (leavingTarget instanceof Element && candidate.element.contains(leavingTarget))) {
    // Check if committed already (qualified hover already sent)
    if (candidate.committed) {
      cleanupCandidate();
      return;
    }

    // Not committed yet — cancel the pending hover
    cleanupCandidate();
  }
}

// ── Periodic cleanup of recent hovers map ─────────────────

// Clean up the recent hovers map periodically to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, time] of recentHovers.entries()) {
    if (now - time > RECENT_HOVER_SUPPRESS_MS * 5) {
      recentHovers.delete(key);
    }
  }
}, 10000);

// ── Event Listeners ───────────────────────────────────────

// Capture phase: fires BEFORE application handlers — no interference risk.
// C3.1 §3.5: Use mouseenter/mouseleave (not mouseover/mouseout).
document.addEventListener('mouseenter', handleMouseEnter, true);
document.addEventListener('mouseleave', handleMouseLeave, true);

// ── Utilities ─────────────────────────────────────────────

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) : str;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (m) => `\\${m}`);
}

// ── Exported functions for testing ────────────────────────

// These are exported via the global scope for unit testing.
// In production, this file runs as a content script with no exports.
//
// Test access is via (globalThis as any).__hoverContentScript or similar.
// The test file imports this module and accesses these functions.
//
// For content scripts, the functions below are available for testing
// when the module is imported in a test context (not as a content script).

// Testing exports — only accessible when imported as a module (test context).
// When running as a content script, these are ignored.
export const __testing = {
  DWELL_THRESHOLD,
  COSMETIC_CSS_PROPERTIES,
  VISIBILITY_PROPERTIES,
  isHoverResponsive,
  hasNonCosmeticHoverRule,
  hasNonCosmeticInlineStyleChange,
  isOwnedByAnother,
  extractIdentity,
  computeAccessibleName,
  resolveHoverTarget,
  takeVisibilitySnapshot,
  takePreHoverSnapshotWithWalkUp,
  createVisibilityTransitionDetector,
  detectVisibilityTransition,
  RECENT_HOVER_SUPPRESS_MS,
  MAX_WALKUP_LEVELS,
};

/**
 * Capture-Time Click Qualification — facts + pure verdict (v1.2 Step 1)
 *
 * Spec: .drytis/specs/click-capture-qualification-v1.md
 *
 * MODEL (§1): trusted physical click → capture immutable facts → determine
 * ONLY provable invalidity → qualified Click / Unclassified(cause).
 *
 * This module implements the CLOCK-1 half: every fact here is a
 * dispatch-instant DOM fact. No response facts, no timing, no site
 * vocabulary, no listener registries (§3.3). The verdict is a PURE
 * function of the fact vector (§4.1) computed once at the EventTap
 * capture-phase instant and frozen (§10.3, §10.5).
 *
 * STEP 1 (INERT): nothing consumes this verdict for typing. The vector is
 * recorded on DomContext (additive) and persisted on the ledger row so the
 * Step-2 wiring change (universal pre-gate + gate-authority deletion) has
 * ground truth to read. Contract pin: tests/tap/click-qualification-*
 * and the no-consumer pin in tests/runtime/.
 *
 * R-2/R-3/R-4/R-5 audit amendments are enforced HERE, not in the legacy
 * isDisabled() helper (which stays untouched for DomContext.disabled —
 * its over-approximation is a recorded fact with existing consumers).
 */

import type {
  ClickInvalidityCause,
  ClickQualification,
  ClickQualificationFacts,
} from '../shared/component-types';
export type {
  ClickInvalidityCause,
  ClickQualification,
  ClickQualificationFacts,
} from '../shared/component-types';
import { isInteractiveElement } from '../definitions/patterns';

// ── Platform tag sets (spec §2) ────────────────────────────────────────

/**
 * Natively-disableable tags: only these carry platform-enforced `disabled`
 * semantics (the browser will not activate them). R-2: a `disabled`
 * attribute on any other tag is an app declaration, not a platform fact.
 */
const NATIVELY_DISABLEABLE_TAGS = new Set([
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'OPTGROUP', 'FIELDSET',
]);

/**
 * Form-associated controls: the set fieldset[disabled] actually disables
 * (per the HTML spec, form controls associated with the fieldset).
 * R-3: plain elements inside a disabled fieldset keep their platform
 * behavior — deliberately NOT guessed as disabled.
 */
const FORM_ASSOCIATED_TAGS = new Set([
  'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'FIELDSET',
]);

/** Raw hit elements treated as page canvas (empty/background click, §5). */
const CANVAS_TAGS = new Set(['BODY', 'HTML']);

// ── Hit-test probe (injectable seam, spec §11) ─────────────────────────

/**
 * The elementFromPoint seam. jsdom does not implement elementFromPoint —
 * unit tests inject a stub; production wires the real probe. Returning
 * null means "probe ran, point not resolvable" (inconclusive); throwing
 * is caught and treated as inconclusive. NEVER fabricates a miss.
 */
export type HitTestProbe = (clientX: number, clientY: number) => Element | null;

/**
 * The production probe: document.elementFromPoint at the dispatch instant.
 * Cross-frame points return the <iframe> element (spec §12 limit — recorded
 * honestly, membership in the raw path decides, never guessed).
 */
export const defaultHitTestProbe: HitTestProbe | null =
  typeof document !== 'undefined' && typeof document.elementFromPoint === 'function'
    ? (x, y) => document.elementFromPoint(x, y)
    : null;

// ── Predicate helpers (R-2/R-3/R-4/R-5 exact forms) ────────────────────

/** R-2: platform-enforced disabled — native tag AND the attribute present. */
function isDisabledNative(el: Element): boolean {
  return (
    NATIVELY_DISABLEABLE_TAGS.has(el.tagName) &&
    el.hasAttribute('disabled')
  );
}

/** R-2: app-declared disabled — the attribute on a NON-native tag. */
function isDisabledAttrNonNative(el: Element): boolean {
  return (
    !NATIVELY_DISABLEABLE_TAGS.has(el.tagName) &&
    el.hasAttribute('disabled')
  );
}

/**
 * R-3: form-associated control inside a DISABLED fieldset, EXCLUDING the
 * first legend's descendants (the legend exemption — controls inside the
 * first legend of a disabled fieldset remain enabled per HTML spec).
 */
function isFieldsetDisabled(el: Element): boolean {
  if (!FORM_ASSOCIATED_TAGS.has(el.tagName)) return false;
  const fieldset = el.closest('fieldset[disabled]');
  if (!fieldset) return false;
  const legend = fieldset.querySelector('legend');
  if (legend && legend.contains(el)) return false;
  return true;
}

/** Defensive tier: inert subtree (self or ancestor). */
function isInertSubtree(el: Element): boolean {
  return el.closest('[inert]') != null;
}

/** App-declared: aria-disabled="true" on the resolved target. */
function isAriaDisabled(el: Element): boolean {
  return el.getAttribute('aria-disabled') === 'true';
}

/** R-4: computed pointer-events none on the RESOLVED target (recorded fact; joint-gated cause). */
function isPointerEventsNone(el: Element): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return false;
  }
  try {
    return window.getComputedStyle(el).pointerEvents === 'none';
  } catch {
    return false;
  }
}

/** R-5: resolved target rect empty AND a lift occurred. */
function isZeroSizeLifted(resolved: Element, lifted: boolean): boolean {
  if (!lifted) return false;
  try {
    const r = resolved.getBoundingClientRect();
    return r.width === 0 && r.height === 0;
  } catch {
    return false;
  }
}

/**
 * The hit-test membership check (spec §3.1 hitTest): is the probe's
 * topmost element part of the RAW element's composed path?
 *
 * - identical element → hit (miss=false)
 * - an ancestor in the raw composed path → hit (miss=false) — elementFromPoint
 *   legitimately returns an ancestor when intervening descendants are
 *   pointer-events:none; the click still operated within the raw subtree.
 * - the shadow HOST of the raw element → hit (bounded shadow-host walk,
 *   spec §12: elementFromPoint cannot see inside shadow trees)
 * - anything else → miss (the only universal misattribution proof)
 * - probe unavailable or unresolvable → miss=null (inconclusive, never fires)
 */
function computeHitTest(
  raw: Element,
  probe: HitTestProbe | null | undefined,
  clientX: number | null,
  clientY: number | null,
  path?: EventTarget[],
): { checked: boolean; miss: boolean | null } {
  if (!probe || clientX == null || clientY == null) {
    return { checked: false, miss: null };
  }
  let topmost: Element | null;
  try {
    topmost = probe(clientX, clientY);
  } catch {
    return { checked: true, miss: null };
  }
  if (!topmost) return { checked: true, miss: null };
  if (topmost === raw) return { checked: true, miss: false };
  if (containsViaComposedPath(topmost, path)) return { checked: true, miss: false };
  if (isShadowHostOf(raw, topmost, 16)) return { checked: true, miss: false };
  // Symmetric ancestor case: the RAW is inside the probe's element (the
  // probe returned an outer wrapper) — still the same click point subtree.
  if (topmost.contains(raw)) return { checked: true, miss: false };
  return { checked: true, miss: true };
}

/** Does the raw element's composed path (from its dispatch event, when available) contain `candidate`? */
function containsViaComposedPath(candidate: Element, path?: EventTarget[]): boolean {
  try {
    const composed = path ?? [];
    return composed.some((el) => el === candidate);
  } catch {
    return false;
  }
}

/** Bounded walk: is `candidate` the shadow host of (an ancestor host of) raw? */
function isShadowHostOf(raw: Element, candidate: Element, maxHops: number): boolean {
  let node: Node | null = raw;
  for (let i = 0; i < maxHops && node; i++) {
    const root = node.getRootNode();
    if (root instanceof ShadowRoot && root.host === candidate) return true;
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

// ── Lift-strategy audit (spec §3.2) ────────────────────────────────────

/**
 * Re-derive which resolveTarget strategy produced the resolved element, by
 * replaying the documented strategy order against the raw element's
 * composed path / parent chain (identity-extractor.ts §"Strategy").
 * This is a FACT ABOUT THE LIFT, not a re-resolution: the resolved element
 * is given; we only name the strategy that would have produced it.
 *
 *   path   — strategies 1/1b: an interactive ancestor found via composedPath
 *            scan or parent walk
 *   cursor — strategy 2: a cursor:pointer / onclick ancestor in the path
 *   raw    — strategy 3: the raw element itself (no lift)
 */
function deriveLiftStrategy(raw: Element, resolved: Element, path?: EventTarget[]): 'path' | 'parent' | 'cursor' | 'raw' {
  if (resolved === raw) return 'raw';
  const composed = path ?? [];
  if (ancestorChainHas(raw, resolved, 'interactive', composed)) return 'path';
  if (ancestorChainHas(raw, resolved, 'cursor', composed)) return 'cursor';
  // Ancestor but neither interactive nor cursor-matched (defensive label;
  // resolveTarget only ever returns raw/path/cursor outcomes).
  return ancestorChainContains(raw, resolved, composed) ? 'parent' : 'path';
}

/** Is `resolved` an ancestor of `raw` (composed), and does it match `mode`? */
function ancestorChainHas(
  raw: Element,
  resolved: Element,
  mode: 'interactive' | 'cursor',
  composed: EventTarget[],
): boolean {
  try {
    const path: Element[] = [];
    for (const el of composed) if (el instanceof Element) path.push(el);
    let cur: Element | null = raw;
    while (cur) {
      if (!path.includes(cur)) path.push(cur);
      cur = cur.parentElement;
    }
    for (const el of path) {
      if (el !== resolved) continue;
      if (mode === 'interactive') return true; // matched at/below the strategy-1 tier
      if (mode === 'cursor') return isCursorPointer(el);
    }
  } catch {
    /* fallthrough */
  }
  return false;
}

function ancestorChainContains(raw: Element, resolved: Element, composed: EventTarget[]): boolean {
  try {
    if (composed.some((el) => el === resolved)) return true;
    let cur: Element | null = raw;
    while (cur) {
      if (cur === resolved) return true;
      cur = cur.parentElement;
    }
  } catch {
    /* fallthrough */
  }
  return false;
}

function isCursorPointer(el: Element): boolean {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return false;
  }
  try {
    return window.getComputedStyle(el).cursor === 'pointer';
  } catch {
    return false;
  }
}

// ── Fact capture (§3) ──────────────────────────────────────────────────

export interface CapturedClickQualification extends ClickQualification {
  /** DOMContext-attachable shape (identical to ClickQualification — frozen). */
}

/**
 * Capture the full qualification fact vector for a trusted click-family
 * event at the dispatch instant.
 *
 * @param event      the raw trusted event (click or contextmenu) — used for
 *                   type scoping and clientX/clientY
 * @param resolved   the element resolveTarget returned (identity authority)
 * @param raw        the RAW hit element (event.target / composedPath()[0])
 *                   — threaded once by the EventTap BEFORE resolveTarget
 *                   consumes it (spec §3 capture-mechanics note)
 * @param probe      injectable elementFromPoint seam (undefined ⇒ honest
 *                   absence: checked=false)
 * @returns the frozen verdict record, or null when the event is not
 *          click-family (scope rule §8.5)
 */
export function captureClickQualification(
  event: Event,
  resolved: Element,
  probe: HitTestProbe | null | undefined,
  raw?: Element,
): CapturedClickQualification | null {
  if (event.type !== 'click' && event.type !== 'contextmenu') return null;

  const rawEl = raw ?? (event.target instanceof Element ? event.target : null);
  if (!rawEl) return null;

  // Composed path captured ONCE from the dispatch event (Element has no
  // composedPath; the event does). Frozen dispatch instant — reuse below.
  let path: EventTarget[] = [];
  try {
    path = event.composedPath ? event.composedPath() : [];
  } catch {
    path = [];
  }

  const mouse = event as MouseEvent;
  const lifted = resolved !== rawEl;
  const liftStrategy = deriveLiftStrategy(rawEl, resolved, path);
  const hitTest = computeHitTest(rawEl, probe, mouse.clientX ?? null, mouse.clientY ?? null, path);

  const facts: ClickQualificationFacts = {
    disabledNative: isDisabledNative(resolved),
    disabledAttrNonNative: isDisabledAttrNonNative(resolved),
    fieldsetDisabled: isFieldsetDisabled(resolved),
    ariaDisabled: isAriaDisabled(resolved),
    inertSubtree: isInertSubtree(resolved),
    pointerEventsNone: isPointerEventsNone(resolved),
    zeroSizeLifted: isZeroSizeLifted(resolved, lifted),
    hitTest,
    hitTarget: {
      kind: CANVAS_TAGS.has(rawEl.tagName) ? 'canvas' : 'element',
      rawTag: rawEl.tagName,
      lifted,
      liftStrategy,
      rawInteractiveShaped: isInteractiveElement(
        rawEl.tagName,
        rawEl.getAttribute('role'),
        rawEl.getAttribute('class'),
        tabIndexOf(rawEl),
      ),
    },
  };

  return qualifyClick(facts);
}

function tabIndexOf(el: Element): number | null {
  if (!(el instanceof HTMLElement)) return null;
  const t = el.tabIndex;
  return Number.isFinite(t) ? t : null;
}

// ── The pure verdict (§4.1) ────────────────────────────────────────────

/**
 * Determine ONLY provable invalidity. Pure, deterministic, side-effect
 * free; never mutates the input (§10.3, §10.4). Returns a FROZEN record.
 *
 * Causes are ordered: universal misattribution proof first, then the
 * joint-gate annotations it enables, then platform/app declarations.
 */
export function qualifyClick(facts: ClickQualificationFacts): ClickQualification {
  const causes: ClickInvalidityCause[] = [];

  // Platform-enforced tier
  if (facts.disabledNative) causes.push('disabled-native');
  if (facts.fieldsetDisabled) causes.push('fieldset-disabled');
  if (facts.inertSubtree) causes.push('inert-subtree');

  // The universal misattribution proof + its joint-gated annotations
  const missProven = facts.hitTest.checked && facts.hitTest.miss === true;
  if (missProven) causes.push('hit-test-miss');
  if (missProven && facts.pointerEventsNone && facts.hitTarget.lifted) {
    causes.push('pointer-events-none');
  }
  if (missProven && facts.zeroSizeLifted) {
    causes.push('zero-size-lifted');
  }

  // App-declared tier
  if (facts.ariaDisabled) causes.push('aria-disabled');
  if (facts.disabledAttrNonNative) causes.push('disabled-attr-non-native');

  const verdict = causes.length > 0 ? 'provably-invalid' : 'qualified';

  // Insufficiency (§4.1): honesty marker on QUALIFIED clicks only.
  const insufficient =
    verdict === 'qualified' &&
    (facts.hitTarget.kind === 'canvas' ||
      (facts.hitTarget.lifted && !facts.hitTarget.rawInteractiveShaped) ||
      facts.zeroSizeLifted);

  const result: ClickQualification = {
    verdict,
    causes,
    insufficient,
    facts,
  };
  // Immutable from the capture instant (§10.3): freeze the record and all
  // nested fact objects. A frozen top-level object alone would leave the
  // vector shallow-mutable.
  Object.freeze(result.facts.hitTest);
  Object.freeze(result.facts.hitTarget);
  Object.freeze(result.facts);
  Object.freeze(result.causes);
  return Object.freeze(result);
}

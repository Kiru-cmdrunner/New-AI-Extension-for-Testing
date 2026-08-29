/**
 * B7-P3 — surface-join: identity-form ↔ DOM-path-form surface matching.
 *
 * Real capture produces TWO locator grammars for the same DOM (verified
 * against live Chrome dumps):
 *   - SurfaceChange.path / DomChangeSummary.targetPath — DOM-path form:
 *     `body > div > div#mega-products`; segments are `tag` or `tag#id`
 *     only (getElementPath, dom-observer.ts).
 *   - ElementIdentity — cssSelector: `#id` when the element has an id,
 *     else a ≤5-deep chain `tag > tag:nth-of-type(n) > ...` starting at
 *     the element itself (generateCssSelector); xPath analogous; plus a
 *     stableId field.
 *
 * The join bridges the two WITHOUT vocabulary assumptions:
 *   - id-exact: a DOM id is per-document unique — agreement between a
 *     recorded fact id and the consumer's OWN id is an exact match.
 *   - chain-degraded: the consumer's css chain names an ancestor id that
 *     appears in the fact path, or ≥2 aligned pure-tag segments; the
 *     match is real but the grammar bridging is imperfect — labeled
 *     degraded, never silent.
 *   - NEVER tag-only single-segment: `div` vs `div` proves nothing.
 *
 * Bounded: no cross-window identity claims, no live DOM, no timing, no
 * vocabulary regex. Pure functions over recorded data only.
 */

/** Recorded surface fact in DOM-path form. */
export interface SurfaceFactPath {
  /** DOM-path form (`body > div > div#id`). */
  path: string | null | undefined;
  /** ARIA role recorded with the surface (unused by the join today; kept
   *  for the role-aware phase 2 exact join). */
  ariaRole?: string | null;
}

/** Consumer-side recorded identity (ElementIdentity subset). */
export interface ConsumerIdentity {
  stableId?: string | null;
  cssSelector?: string | null;
  xPath?: string | null;
  tag?: string | null;
}

/** Result of one join attempt. */
export interface SurfaceJoinResult {
  joined: boolean;
  /** True when the join relied on grammar bridging (chain containment),
   *  false for id-exact agreement. */
  degraded: boolean;
}

/** Normalize a locator string: trim, collapse runs of spaces around `>`. */
export function normalizePath(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .split('>')
    .map((seg) => seg.trim())
    .filter((seg) => seg.length > 0)
    .join(' > ');
}

/** Split either grammar into segments (`body`, `div#mega-products`, `li:nth-of-type(2)`). */
export function pathSegments(raw: string | null | undefined): string[] {
  const n = normalizePath(raw);
  if (!n) return [];
  return n.split(' > ');
}

/** Extract the DOM id from a segment (`div#mega` → `mega`; else null). */
function segmentId(segment: string): string | null {
  const hash = segment.indexOf('#');
  if (hash === -1) return null;
  const id = segment.slice(hash + 1);
  return id.length > 0 ? id : null;
}

/** Strip `:nth-of-type(n)` and `#id` from a segment → bare tag. */
function bareTag(segment: string): string {
  let s = segment;
  const colon = s.indexOf(':');
  if (colon !== -1) s = s.slice(0, colon);
  const hash = s.indexOf('#');
  if (hash !== -1) s = s.slice(0, hash);
  return s;
}

/**
 * The consumer's OWN DOM id — from stableId, an `#id`-only cssSelector,
 * or an id-bearing first xPath segment. Multi-segment css chains do NOT
 * contribute (the chain starts at the ELEMENT, so a leading `div#x` is an
 * ancestor's id only when the chain is exactly `#x`... it never is; the
 * single-segment `#x` form is the only css spelling of the own id).
 */
export function domIdOfIdentity(identity: ConsumerIdentity | null | undefined): string | null {
  if (!identity) return null;
  if (typeof identity.stableId === 'string' && identity.stableId) return identity.stableId;
  const css = typeof identity.cssSelector === 'string' ? identity.cssSelector.trim() : '';
  if (css.startsWith('#') && !css.includes(' ')) {
    const id = css.slice(1);
    if (id && !id.includes('#')) return id;
  }
  const xp = typeof identity.xPath === 'string' ? identity.xPath.trim() : '';
  if (xp.startsWith('//')) {
    // Own id from xPath ONLY in the single-segment form
    // (`//div[@id='x']`): in a multi-segment xPath the id-bearing FIRST
    // segment is an ANCESTOR of the element (the element is the last).
    const single = /^([A-Za-z][\w-]*)\[@id=['"]([^'"]+)['"]\]$/.exec(xp.slice(2));
    if (single) return single[2];
  }
  return null;
}

/** Ids named ANYWHERE in the consumer's recorded chains (own + ancestors). */
function chainIdsOfIdentity(identity: ConsumerIdentity): Set<string> {
  const ids = new Set<string>();
  const own = domIdOfIdentity(identity);
  if (own) ids.add(own);
  for (const seg of pathSegments(identity.cssSelector)) {
    const id = segmentId(seg);
    if (id) ids.add(id);
  }
  // xPath ancestor ids: every [@id='...'] predicate anywhere in the path.
  if (typeof identity.xPath === 'string') {
    const re = /\[@id=['"]([^'"]+)['"]\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(identity.xPath)) !== null) ids.add(m[1]);
  }
  return ids;
}

/** Consumer's root-anchored xPath tag list (predicates stripped). */
function chainTagsFromXPath(identity: ConsumerIdentity): string[] {
  const xp = typeof identity.xPath === 'string' ? identity.xPath : '';
  if (!xp.startsWith('//') && !xp.startsWith('/')) return [];
  return xp
    .replace(/^\/+/, '')
    .split('/')
    .map((s) => {
      const m = /^([A-Za-z][\w-]*)/.exec(s);
      return m ? m[1] : '';
    })
    .filter((t) => t.length > 0);
}

/** Tag-only alignment floor: fewer aligned segments than this never joins. */
export const MIN_ALIGNED_TAG_SEGMENTS = 2;

/**
 * Does a recorded surface fact (DOM-path form) join the consumer's
 * recorded identity (identity form)?
 *
 * Join order (strongest first, short-circuit):
 *   1. id-exact — consumer's own id equals ANY id in the fact path
 *      (terminal or mid-path: clicking the revealing container, or a
 *      child whose chain names the container id).
 *   2. chain-degraded — an ancestor id named in the consumer's chain
 *      appears in the fact path.
 *   3. tag-floor-degraded — no ids anywhere: ≥2 aligned tag segments
 *      between the fact path and the consumer chain.
 */
export function joinsRecordedSurface(
  fact: SurfaceFactPath | null | undefined,
  identity: ConsumerIdentity | null | undefined,
): SurfaceJoinResult {
  const no: SurfaceJoinResult = { joined: false, degraded: false };
  if (!fact || !identity) return no;
  const factSegs = pathSegments(fact.path);
  if (factSegs.length === 0) return no;

  const factIds = new Set<string>();
  for (const seg of factSegs) {
    const id = segmentId(seg);
    if (id) factIds.add(id);
  }

  const ownId = domIdOfIdentity(identity);

  // 1. id-exact.
  if (ownId && factIds.has(ownId)) return { joined: true, degraded: false };

  // 2. chain-degraded (ancestor id shared).
  const chainIds = chainIdsOfIdentity(identity);
  for (const id of chainIds) {
    if (id !== ownId && factIds.has(id)) return { joined: true, degraded: true };
  }

  // 3. tag-chain containment (no id agreement): the fact's tag chain
  //    appears as a CONTIGUOUS subchain of the consumer's root-anchored
  //    xPath chain, AND the fact carries at least one DOM id — the id
  //    anchors the fact to ONE subtree, so tag alignment through it is
  //    positional evidence, not shape coincidence. Without any id the
  //    collision space is every same-shaped subtree in the document —
  //    too broad to claim honestly (documented boundary; exact joins
  //    deferred to the phase-2 child-identity snapshot per spec §5.3.2).
  //    Labeled degraded.
  const factTags = factSegs.map(bareTag);
  const factHasId = factIds.size > 0;
  if (factHasId && factTags.length >= MIN_ALIGNED_TAG_SEGMENTS) {
    const chain = chainTagsFromXPath(identity);
    for (let j = 0; j + factTags.length <= chain.length; j++) {
      let eq = true;
      for (let k = 0; k < factTags.length; k++) {
        if (chain[j + k] !== factTags[k]) { eq = false; break; }
      }
      if (eq) return { joined: true, degraded: true };
    }
  }

  return no;
}

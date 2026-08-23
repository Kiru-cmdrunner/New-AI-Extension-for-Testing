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
import { isVerifiedAttrAllowed } from '../../shared/page-content-wire';
import type { DomChangeSummary } from '../../shared/behavioral-evidence-types';
import {
  classifyChangedSummaries,
  isNonCounterShapedText,
  type SeedCandidate,
  type SeedCandidateKind,
} from './changed-element-seed';

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

// Phase 6D.1 W2: mirrors of the classifier's noise vocabulary for the
// text-swap resolution path (single source of truth stays the classifier;
// these local twins exist so the observer does not import private helpers).
const EDITABLE_SEED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isPunctuationOnlySeedText(text: string): boolean {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length === 0;
}

function isTransientSeedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;
  if (trimmed.length > 24) return false;
  return /^(loading|loadin|spinner|skeleton|placeholder|please wait|fetching|updating|processing)[.…]*$/i.test(trimmed)
    || /^(loading|loadin|spinner|skeleton|placeholder|fetching|updating|processing)\b/i.test(trimmed)
    || /^please wait/i.test(trimmed);
}

/**
 * Phase 6A: matchedSelector sentinel for seed-derived items. Downstream
 * consumers (assertion derivation, clone fidelity) treat this like any
 * selector-family string — it identifies the PROVENANCE (change-seeded),
 * not a CSS selector that was matched.
 */
const SEED_SENTINEL = 'changed-element-seed';

/** Attribute probe order for seed items (verified-attr allowlist first). */
const SEED_ATTRIBUTE_PROBE = [
  'aria-label', 'aria-valuenow', 'role', 'data-count',
  'data-auto-id', 'data-test-id', 'data-test', 'data-testid',
  // data-* identity probe (entity kinds) — first present wins, bounded.
  // Exactly the entity idAttribute family from the config's entity
  // selectors (data-asin is the selector's own); NO new attribute names.
  'data-asin', 'data-product-id', 'data-item-id', 'data-sku',
  'data-order-id', 'data-order-number',
] as const;

/**
 * Identity attributes a child must carry to seed as an entity via the
 * bounded child walk — same config vocabulary as SEED_ATTRIBUTE_PROBE's
 * identity tail (no new names).
 */
const SEED_IDENTITY_ATTRS = [
  'data-asin', 'data-product-id', 'data-item-id', 'data-sku',
  'data-order-id', 'data-order-number',
] as const;

/** Bounded child walk: at most this many children resolve per candidate. */
const MAX_SEED_CHILDREN = 8;

/** Container tags whose added children are collection members. */
const LIST_TAGS = new Set(['UL', 'OL', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'MENU', 'DL']);

/** Parse the first integer in text (same semantics as extractNumeric). */
function extractSeedNumeric(text: string): number | null {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

/**
 * Pick the final item kind from candidate kinds using element facts.
 * Priority: explicit role wins; then the classification's own priority
 * (a non-numeric display change is badge/notification, never counter even
 * when the text contains a digit — dates like "Sat, 22 Aug" must not
 * become counters); then declared candidates.
 */
function pickSeedKind(
  candidates: SeedCandidateKind[],
  facts: {
    role: string | null;
    ariaLabel: string | null;
    numeric: number | null;
    hasIdentityCoordinate: boolean;
    counterShapeVerified: boolean;
  },
): SemanticItemKind | null {
  if (facts.role === 'alert' || facts.role === 'status') return 'notification';
  // Counter wins when classification verified the counter SHAPE (isNumericDelta:
  // "5", "5 items", "$5.00"; never dates/durations) AND the element's own text
  // parses a number, or the element is unlabeled (bare counters). A display
  // string WITH an aria-label stays a badge (dates/fare strings).
  // 6D.1 W2: for TEXT-SWAP candidates classification could NOT verify the
  // shape (the classifier never read the text — purity), so a counter claim
  // requires digit verification on the live text (numeric != null). The
  // unlabeled bare-counter arm stays reserved for shape-verified candidates.
  if (candidates.includes('counter')) {
    if (
      facts.counterShapeVerified
        ? (facts.numeric != null || facts.ariaLabel == null)
        : facts.numeric != null
    ) {
      return 'counter';
    }
  }
  // Identity-coordinate gate (contract rung 7): text-shape candidates
  // (notification/status-badge from a bare display-text change) require an
  // addressable coordinate — ARIA role, aria-label, own #id, or an
  // allowlisted identity/test attribute. Unlabeled class-only changes SKIP
  // (honesty: skip ≠ loss; the element stays in raw domChanges evidence).
  const textShaped = candidates.includes('notification') || candidates.includes('status-badge');
  if (textShaped && !facts.hasIdentityCoordinate) return null;
  // aria-labeled display text → badge semantics; unlabeled-but-identified
  // (own #id / test attr, no role) → notification.
  if (candidates.includes('status-badge') && facts.ariaLabel != null) {
    return 'status-badge';
  }
  if (candidates.includes('notification')) return 'notification';
  if (candidates.includes('status-badge')) return 'status-badge';
  if (candidates.includes('entity')) return 'entity';
  if (candidates.includes('collection')) return 'collection';
  return null;
}

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
 * Phase 6A: optional structural resolver for seeded scans. Production
 * adapters implement this; legacy mock adapters do not (seed pass skips).
 */
export interface PathResolver {
  resolvePath(
    path: string,
  ): { element: ElementLike; siblings: ElementLike[] } | null;
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
  scan(
    viewId: string | null,
    seeds?: DomChangeSummary[],
  ): PageContentSnapshot | null {
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
        // Dedup key: entityId for entity-kind items when present (sibling
        // list items share the same grouping path — "ul > li" — but are
        // distinct entities; entityId is identity). Path for everything
        // else (region-level dedup, first match wins per element region).
        const entityIdAttr = selConfig.idAttribute
          ? el.getAttribute(selConfig.idAttribute)
          : null;
        const dedupKey =
          selConfig.kind === 'entity' && entityIdAttr
            ? `entity:${entityIdAttr}`
            : path;
        if (seenPaths.has(dedupKey)) continue; // dedup: first match wins
        seenPaths.add(dedupKey);

        const text = this.extractText(el);
        if (!selConfig.extractNumeric && text.length < MIN_TEXT_LENGTH) continue;

        const item = this.buildItem(el, selConfig, text, path);
        if (item) {
          items.push(item);
        }
      }
    }

    // ── Phase 6A seed pass ────────────────────────────────────────────
    // Runs AFTER the selector pass and only adds items for paths the
    // selector pass did not cover — selector-matched snapshots stay
    // byte-identical. Seeds are classified change summaries (behavioral
    // evidence), resolved STRUCTURALLY against the live DOM. Adapters
    // without resolvePath (legacy mocks) skip the pass entirely.
    if (seeds && seeds.length > 0) {
      const resolver = this.dom as DOMAdapter & Partial<PathResolver>;
      if (typeof resolver.resolvePath === 'function') {
        const candidates = classifyChangedSummaries(seeds);
        let seeded = 0;
        for (const candidate of candidates) {
          if (items.length >= MAX_ITEMS) {
            overflow += candidates.length - seeded;
            break;
          }
          let seededAny = false;
          if (candidate.resolveViaChildren) {
            seededAny = this.buildSeedItemsViaChildren(candidate, seenPaths, items);
          } else {
            const item = this.buildSeedItem(candidate, seenPaths);
            if (item) {
              items.push(item);
              seededAny = true;
            }
          }
          if (seededAny) seeded++;
        }
        // Seeds the classifier dropped for its own cap (beyond
        // MAX_CHANGED_ELEMENT_SEEDS) or its noise gates are NOT counted as
        // overflow — overflow means "semantic items dropped for BOUNDS",
        // and noise-gated seeds never produced items to drop.
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
      // Phase 2b: capture-time uniqueness stamp for id-less replay
      // locators. Only allowlisted attributes are candidates; entities are
      // excluded (their identity attribute is already a precise coordinate
      // via the 2c entity locator branch). Stamped ONLY when the selector
      // verifiably matched exactly one element in the snapshot DOM.
      uniqueInSnapshot: this.uniqueAttrSelector(selConfig, el, attributes),
    };
  }

  /**
   * Phase 2b: verify that the item's FIRST allowlisted attribute (in
   * capture order) yields a single-element replay selector in the CURRENT
   * snapshot DOM.
   *
   * Returns true only when ALL hold:
   *   1. the kind is counter / status-badge / notification (id-less kinds);
   *   2. the item carries at least one allowlisted attribute with a
   *      non-empty value — only the FIRST such attribute (attribute
   *      insertion order, i.e. the selector config's extractAttributes
   *      order) is the verification candidate;
   *   3. querySelectorAll('[attr="value"]') returns EXACTLY one element,
   *      and that element is the item itself.
   *
   * The single-candidate rule keeps the observer and the derivation
   * byte-identical in WHICH attribute they choose (the derivation re-derives
   * the same first-allowlisted attribute from the captured attributes map —
   * it has no DOM to re-verify against). A shared first attribute never
   * falls through to a later, possibly-unique one: conservative by design.
   *
   * Absent/undefined ⇒ no allowlisted candidate existed. false ⇒ the
   * candidate selector is NOT unique. Either way the derivation keeps the
   * id-less skip policy (tier 'none') — this stamp can only ENABLE
   * locators, never weaken the default.
   */
  /**
   * Phase 6A: build an ObservedItem from a classified seed candidate by
   * resolving it STRUCTURALLY against the live DOM. Kind comes from the
   * change shape (classification) refined by element facts (aria role /
   * aria-label). Content anchoring picks the changed sibling among
   * structurally identical ones via characterDataDelta.new. Nothing here
   * queries the DOM by pattern — the only querySelectorAll is the Phase-2b
   * uniqueInSnapshot verification stamp, reused as-is.
   */
  /**
   * Phase 6A: build items for a resolveViaChildren candidate — the summary's
   * targetPath is the PARENT OF THE ADDED LIST (e.g. a <ul> appended to
   * <body> yields a childList summary targeting body), and the ADDED CHILD
   * carries the semantics. The direct added child that is itself a list
   * (UL/OL/TABLE…) seeds as the COLLECTION (numericValue = its own child
   * count, mirroring extractCollectionCount), and ITS children with a
   * config-vocabulary identity attribute seed as ENTITIES. Bounded by
   * MAX_SEED_CHILDREN and MAX_ITEMS. Structural walk only — no selectors.
   * Returns true when any item was emitted.
   */
  private buildSeedItemsViaChildren(
    candidate: SeedCandidate,
    seenPaths: Set<string>,
    items: ObservedItem[],
  ): boolean {
    const resolver = this.dom as DOMAdapter & Partial<PathResolver>;
    if (typeof resolver.resolvePath !== 'function') return false;

    const resolved = resolver.resolvePath(candidate.summary.targetPath);
    if (!resolved) return false;
    const parent = resolved.element;
    if (!parent.isVisible()) return false;
    const children = parent.children ?? [];
    if (children.length === 0) return false;

    let emitted = false;

    for (let i = 0; i < Math.min(children.length, MAX_SEED_CHILDREN); i++) {
      if (items.length >= MAX_ITEMS) break;
      const child = children[i];
      if (!child.isVisible()) continue;
      const tag = child.tagName.toUpperCase();
      const isList = LIST_TAGS.has(tag);
      // Identity children (config vocabulary) seed as entities directly.
      const identity = SEED_IDENTITY_ATTRS.find(
        (name) => (child.getAttribute(name) ?? '') !== '',
      );
      if (identity) {
        const path = child.getPath();
        const id = child.getAttribute(identity);
        // Dedup vs the selector pass: EXACT same key it uses — sibling
        // entities share one grouping path ('ul > li'); identity is the
        // 'entity:ID' key already sitting in seenPaths.
        const entityKey = `entity:${id}`;
        if (!seenPaths.has(path) && !seenPaths.has(entityKey)) {
          const item = this.assembleSeedItem(child, path, candidate, {
            kindOverride: 'entity',
            entityId: id,
          });
          if (item) {
            items.push(item);
            seenPaths.add(path);
            seenPaths.add(entityKey);
            emitted = true;
          }
        }
        continue;
      }
      // A list child seeds as a collection on ITSELF — its own children
      // are the collection's members (extractCollectionCount semantics).
      if (isList) {
        const path = child.getPath();
        if (!seenPaths.has(path)) {
          const memberCount = child.children?.length ?? 0;
          if (memberCount > 0) {
            const item = this.assembleSeedItem(child, path, candidate, {
              kindOverride: 'collection',
              numericValue: memberCount,
            });
            if (item) {
              items.push(item);
              seenPaths.add(path);
              emitted = true;
            }
            // Members with identity attributes seed as entities too.
            const members = child.children ?? [];
            for (let m = 0; m < Math.min(members.length, MAX_SEED_CHILDREN); m++) {
              if (items.length >= MAX_ITEMS) break;
              const member = members[m];
              if (!member.isVisible()) continue;
              const memberIdentity = SEED_IDENTITY_ATTRS.find(
                (name) => (member.getAttribute(name) ?? '') !== '',
              );
              if (!memberIdentity) continue;
              const memberPath = member.getPath();
              const memberId = member.getAttribute(memberIdentity);
              const memberKey = `entity:${memberId}`;
              if (seenPaths.has(memberPath) || seenPaths.has(memberKey)) continue;
              const memberItem = this.assembleSeedItem(member, memberPath, candidate, {
                kindOverride: 'entity',
                entityId: memberId,
              });
              if (memberItem) {
                items.push(memberItem);
                seenPaths.add(memberPath);
                seenPaths.add(memberKey);
                emitted = true;
              }
            }
          }
        }
      }
    }

    return emitted;
  }

  /**
   * Shared assembly for seeded items — attribute probing, kind stamping,
   * uniqueness stamp. Caller owns path-dedup and cap checks.
   */
  private assembleSeedItem(
    el: ElementLike,
    path: string,
    candidate: SeedCandidate,
    opts: { kindOverride?: SeedCandidateKind; numericValue?: number | null; entityId?: string | null },
  ): ObservedItem | null {
    const kind = opts.kindOverride ?? null;
    if (!kind) return null;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return null;

    const text = this.extractText(el);
    const attributes: Record<string, string> = {};
    let attrCount = 0;
    for (const name of SEED_ATTRIBUTE_PROBE) {
      if (attrCount >= MAX_ATTRIBUTES) break;
      const val = el.getAttribute(name);
      if (val !== null) {
        attributes[name] = val;
        attrCount++;
      }
    }

    const item: ObservedItem = {
      kind,
      matchedSelector: SEED_SENTINEL,
      text,
      numericValue:
        opts.numericValue !== undefined
          ? opts.numericValue
          : kind === 'counter'
            ? extractSeedNumeric(text)
            : null,
      entityId: opts.entityId ?? null,
      entityType: kind === 'entity' && opts.entityId ? 'unknown' : null,
      domPath: path,
      attributes,
      visible: true,
      uniqueInSnapshot: this.seedUniqueAttrSelector(kind, el, attributes, path),
    };
    void candidate;
    return item;
  }

  private buildSeedItem(
    candidate: SeedCandidate,
    seenPaths: Set<string>,
  ): ObservedItem | null {
    const resolver = this.dom as DOMAdapter & Partial<PathResolver>;
    if (typeof resolver.resolvePath !== 'function') return null;

    const resolved = resolver.resolvePath(candidate.summary.targetPath);
    if (!resolved) return null;

    // Phase 6D.1 W2: text-swap candidates (1/1 childList on the parent,
    // from `parent.textContent = …`) have NO characterDataDelta to anchor
    // on. The structural proof that the swap was TEXT-only: the element
    // has no element children at scan time (a parent that still carries
    // element children was element churn, not a text swap — honest skip).
    // Editable controls are excluded exactly as the characterData path
    // does (their values belong to the tap, not page-content), and the
    // transient/punctuation noise vocabulary applies to the live text.
    if (candidate.resolveViaTextSwap) {
      const el = resolved.element;
      if (el.children && el.children.length > 0) return null;
      const tag = el.tagName.toUpperCase();
      if (EDITABLE_SEED_TAGS.has(tag)) return null;
      const text = (el.textContent ?? '').trim();
      if (text.length === 0) return null;
      if (isPunctuationOnlySeedText(text)) return null;
      if (isTransientSeedText(text)) return null;
      // Date/duration exclusion parity (reviewer WARN): classification-side
      // counter verification runs isNumericDelta, which rejects "22 Aug" /
      // "02h 30m" shapes. The counterShapeVerified arm below then requires
      // a digit on the live text — apply the SAME shape exclusion here so a
      // text-swap to a date-shaped string cannot claim the counter kind.
      if (isNonCounterShapedText(text)) {
        return null;
      }
    }

    // Content anchor: the resolved element must actually show the change's
    // NEW text at scan time (settlement). Among structurally identical
    // siblings this picks the changed one; for a single candidate it
    // verifies the seed is not stale. A delta whose new text is nowhere in
    // the candidates is an honest skip — never seed a wrong element.
    let el = resolved.element;
    const anchor = candidate.summary.characterDataDelta?.new;
    if (anchor != null) {
      const wanted = anchor.trim();
      const matches = (s: ElementLike) => (s.textContent ?? '').trim() === wanted;
      const hit = matches(el) ? el : resolved.siblings.find(matches);
      if (!hit) return null; // changed text no longer present — honest skip
      el = hit;
    }

    if (!el.isVisible()) return null;
    if (SKIP_TAGS.has(el.tagName.toUpperCase())) return null;

    const path = el.getPath();
    if (seenPaths.has(path)) return null; // selector pass already covered it
    seenPaths.add(path);

    const text = this.extractText(el);
    // Counters legitimately render as a bare digit ("5") — below the
    // selector pass's MIN_TEXT_LENGTH. Allow short text only for the
    // numeric kinds; everything else keeps the standard gate.
    const numeric = extractSeedNumeric(text);
    if (
      text.length < MIN_TEXT_LENGTH &&
      !candidate.candidateKinds.includes('counter')
    ) {
      return null;
    }
    if (candidate.candidateKinds.includes('counter') && text.length === 0) {
      return null;
    }

    // Refine kind by element facts: role alert/status → notification.
    const role = el.getAttribute('role');
    const ariaLabel = el.getAttribute('aria-label');
    // Identity coordinate (rung 7 gate): own #id in the path, explicit ARIA
    // role, aria-label, or an allowlisted identity/test attribute. The text
    // kinds are addressable observations only when one exists.
    const hasIdentityCoordinate =
      /#[\w-]+$/.test(path) ||
      role != null ||
      ariaLabel != null ||
      SEED_ATTRIBUTE_PROBE.some((n) => el.getAttribute(n) !== null);
    const kind = pickSeedKind(candidate.candidateKinds, {
      role,
      ariaLabel,
      numeric,
      hasIdentityCoordinate,
      counterShapeVerified: !candidate.resolveViaTextSwap,
    });
    if (!kind) return null;

    // Attributes: bounded extraction of the verified-attr allowlist +
    // data-* identity (same caps as the selector pass).
    const attributes: Record<string, string> = {};
    let attrCount = 0;
    for (const name of SEED_ATTRIBUTE_PROBE) {
      if (attrCount >= MAX_ATTRIBUTES) break;
      const val = el.getAttribute(name);
      if (val !== null) {
        attributes[name] = val;
        attrCount++;
      }
    }

    let entityId: string | null = null;
    if (kind === 'entity') {
      for (const [name, value] of Object.entries(attributes)) {
        if (/^data-/.test(name) && value) {
          entityId = value;
          break;
        }
      }
    }

    const numericValue =
      kind === 'counter'
        ? extractSeedNumeric(text)
        : kind === 'collection'
          ? (el.children?.length ?? null) || extractSeedNumeric(text)
          : null;

    const item: ObservedItem = {
      kind,
      matchedSelector: SEED_SENTINEL,
      text,
      numericValue,
      entityId,
      entityType: kind === 'entity' && entityId ? 'unknown' : null,
      domPath: path,
      attributes,
      visible: true,
      uniqueInSnapshot: this.seedUniqueAttrSelector(kind, el, attributes, path),
    };
    return item;
  }

  /**
   * Seed variant of the Phase-2b verification stamp — same allowlist, same
   * first-attribute rule, same single-match identity check (shared core:
   * verifiedFirstAttrSelector). Additionally, an element with an OWN #id is
   * uniquely addressable by definition: the stamp is true when the id
   * verifiably resolves to exactly this element (ids are unique per
   * document — the derivation's own-#id tier relies on exactly this fact).
   */
  private seedUniqueAttrSelector(
    kind: SemanticItemKind,
    el: ElementLike,
    attributes: Record<string, string>,
    domPath: string,
  ): boolean | undefined {
    if (kind === 'entity' || kind === 'collection') return undefined;
    const attrStamp = this.verifiedFirstAttrSelector(el, attributes);
    if (attrStamp !== undefined) return attrStamp;
    // Own-#id fallback: last domPath segment carries #id when the element
    // has one. Verify structurally (same mechanism as the attr stamp).
    const last = domPath.split('>').pop()?.trim() ?? '';
    const m = last.match(/^[a-zA-Z][\w-]*#([\w-]+)$/);
    if (!m) return undefined;
    let matches: ElementLike[];
    try {
      matches = this.dom.querySelectorAll(`#${m[1]}`);
    } catch {
      return undefined;
    }
    if (matches.length !== 1) return false;
    return matches[0].getPath() === el.getPath();
  }

  /**
   * Phase 2b / Phase 6A shared verification core: the FIRST allowlisted
   * attribute with a non-empty value is the candidate; build its exact
   * [attr="value"] selector and require querySelectorAll to resolve to
   * EXACTLY one element that IS this element (path equality).
   * undefined ⇒ no allowlisted candidate existed (caller may fall back);
   * false ⇒ candidate exists but is not a unique address;
   * true ⇒ the candidate verifiably addresses exactly this element.
   * The single-candidate rule keeps the observer and the derivation
   * byte-identical in WHICH attribute they choose (the derivation re-derives
   * the same first-allowlisted attribute from the captured attributes map —
   * it has no DOM to re-verify against). A shared first attribute never
   * falls through to a later, possibly-unique one: conservative by design.
   */
  private verifiedFirstAttrSelector(
    el: ElementLike,
    attributes: Record<string, string>,
  ): boolean | undefined {
    let candidate: [string, string] | null = null;
    for (const [name, value] of Object.entries(attributes)) {
      if (isVerifiedAttrAllowed(name) && value && value.length > 0) {
        candidate = [name, value];
        break;
      }
    }
    if (!candidate) return undefined;
    const [name, value] = candidate;
    const selector = `[${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
    let matches: ElementLike[];
    try {
      matches = this.dom.querySelectorAll(selector);
    } catch {
      return undefined;
    }
    if (matches.length !== 1) return false;
    return matches[0].getPath() === el.getPath();
  }

  private uniqueAttrSelector(
    selConfig: SemanticSelector,
    el: ElementLike,
    attributes: Record<string, string>,
  ): boolean | undefined {
    if (selConfig.kind === 'entity' || selConfig.kind === 'collection') return undefined;
    // Phase 6A reconciliation: same allowlist, same first-attribute rule,
    // same single-match identity check as the seed stamp — one shared core
    // (verifiedFirstAttrSelector) instead of two hand-maintained copies.
    return this.verifiedFirstAttrSelector(el, attributes);
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

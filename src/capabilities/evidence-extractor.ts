/**
 * Evidence Extractor — transforms raw recording data into structured
 * evidence for capability rules.
 *
 * Input:  ComponentInteraction + its SemanticEffects + adjacent interactions
 *         in the recording sequence.
 * Output: ExtractedEvidence — a single immutable object containing all
 *         signals a rule needs to evaluate.
 *
 * The extractor is the ONLY code that touches ComponentInteraction internals
 * for the capability engine. Rules consume ExtractedEvidence, not raw
 * interactions. This keeps rules decoupled and independently testable.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 1)
 */

import type { ComponentInteraction, InteractionType } from '../shared/component-types';
import type { SemanticEffect } from '../semantics/effect-types';
import type { KeywordMatch } from './keyword-dictionary';
import { matchKeywords } from './keyword-dictionary';

// ── Physical Evidence ─────────────────────────────────────────────────

/**
 * Evidence derived from the physical interaction (ComponentInteraction).
 * Framework-agnostic: tag, role, type, label — durable DOM properties.
 */
export interface PhysicalEvidence {
  /** The ComponentInteraction type (Click, Checkbox, TextEntry, etc.). */
  interactionType: InteractionType;
  /** Trigger element tag name (BUTTON, A, INPUT, etc.). */
  tag: string;
  /** ARIA role of the trigger element, null if none. */
  ariaRole: string | null;
  /** Accessible name of the trigger element. */
  accessibleName: string;
  /** href if the element is a link, null otherwise. */
  href: string | null;
  /** Whether the element has a role='checkbox' or tag is INPUT[type=checkbox/radio]. */
  isCheckboxLike: boolean;
  /** Whether the element has a role='slider', tag is INPUT[type=range], or role='spinbutton'. */
  isSliderLike: boolean;
  /**
   * Whether the user actually adjusted the value on a Slider/spinbutton/color input.
   * From interaction.metadata.userAdjusted. False for focus-traversal-only events.
   */
  userAdjusted: boolean;
  /** Whether the element has type='submit' (INPUT or BUTTON). */
  isSubmitType: boolean;
  /** Whether the element is a file input (INPUT[type=file]). */
  isFileInput: boolean;
  /** Ancestor roles (up to 10 levels). */
  ancestorRoles: string[];
  /** Ancestor classes (up to 10 levels). */
  ancestorClasses: string[];
}

// ── Behavioral Evidence ───────────────────────────────────────────────

/**
 * Evidence derived from M2 SemanticEffects.
 * Describes what the interaction DID to the DOM, not what the user clicked.
 */
export interface BehavioralEvidence {
  /** All semantic effects produced for this interaction. */
  effects: SemanticEffect[];
  /** Whether any state-toggle effect was produced (aria-checked, checked, aria-pressed). */
  hasStateToggle: boolean;
  /** Whether any expand-collapse effect was produced. */
  hasExpandCollapse: boolean;
  /** Whether any enable-disable effect was produced. */
  hasEnableDisable: boolean;
  /** Whether any content-change effect was produced. */
  hasContentChange: boolean;
  /** Whether any visibility-change effect was produced. */
  hasVisibilityChange: boolean;
  /**
   * Whether the content-change or visibility-change effect targets a DIFFERENT
   * element than the trigger. This is the key discriminator for FilterSelection
   * vs ToggleControl: if the effect is on another element, the control is
   * affecting something else (filtering results, toggling a dependent panel).
   */
  hasRemoteEffect: boolean;
  /** Whether any effect has direct-property confidence basis (noise-immune). */
  hasDirectPropertyEvidence: boolean;
  /** netNodeDelta from content-change effects (null if no content-change, or sum across multiple). */
  netNodeDelta: number | null;
}

// ── Sequence Context ──────────────────────────────────────────────────

/**
 * Evidence derived from adjacent interactions in the recording sequence.
 * Provides 1-back and 1-forward context.
 */
export interface SequenceContext {
  /** Interaction type of the immediately preceding interaction, null if first. */
  previousInteractionType: InteractionType | null;
  /** Whether the preceding interaction was on the same page (same pageUrl). */
  precededBySamePage: boolean;
  /** Whether the preceding interaction was a TextEntry on the same form element. */
  precededByTextEntryOnSameForm: boolean;
  /** Whether a URL/page change occurred between this interaction and the next. */
  urlChangedAfter: boolean;
  /** URL of this interaction's page. */
  pageUrl: string;
  /** Page title at this interaction. */
  pageTitle: string;
  /** Whether the page URL/title changed compared to the previous interaction. */
  urlChanged: boolean;
  /** The URL of the NEXT interaction (if urlChangedAfter), null if no next or same URL. */
  nextUrl: string | null;
  /**
   * Whether the next URL (after navigation) contains an item-specific path segment.
   * True if URL has patterns like /dp/, /product/, /item/, /detail/, /p/, or
   * contains a UUID-like or long alphanumeric ID segment. Framework-agnostic:
   * operates on URL structure, not HTML.
   */
  hasNextItemSpecificUrl: boolean;
  /** Whether the preceding interaction was a Search or FilterSelection (list context). */
  precededByListContext: boolean;
  /**
   * Whether the URL PATH changed after this interaction (ignoring query params).
   * Filters and sorts on server-rendered apps change query params (?brand=sony)
   * without changing the path (/s). This distinguishes "same page, different
   * results" from "navigated to a different page."
   */
  urlPathChangedAfter: boolean;
  /**
   * Whether any preceding interaction on the same page was a form-interaction
   * type (TextEntry, Dropdown, Checkbox, Slider). Used by SubmitForm to detect
   * form submissions preceded by any form input, not just TextEntry.
   */
  precededByFormInteraction: boolean;
  /**
   * Whether the trigger element's own href (if it's a link) contains an
   * item-specific URL pattern. This lets OpenDetail fire even when
   * urlChangedAfter isn't available (e.g., last interaction or user
   * navigated back).
   */
  triggerHasItemSpecificHref: boolean;
}

// ── Keyword Evidence ──────────────────────────────────────────────────

/**
 * Evidence derived from the keyword dictionary.
 */
export interface KeywordEvidence {
  /** All keyword matches for this interaction. */
  matches: KeywordMatch[];
  /** Whether any keyword matched at all. */
  hasAnyMatch: boolean;
}

// ── Extracted Evidence (Composite) ────────────────────────────────────

/**
 * The complete evidence package for one interaction.
 * This is what CapabilityRule.evaluate() receives.
 *
 * Immutable by contract — rules must not mutate.
 */
export interface ExtractedEvidence {
  /** The interaction ID being evaluated. */
  interactionId: string;
  /** Physical evidence from the ComponentInteraction. */
  physical: PhysicalEvidence;
  /** Behavioral evidence from M2 SemanticEffects. */
  behavioral: BehavioralEvidence;
  /** Sequence context from adjacent interactions. */
  sequence: SequenceContext;
  /** Keyword matches. */
  keywords: KeywordEvidence;
}

// ── Extractor Functions ───────────────────────────────────────────────

/**
 * Extract keyword-relevant text signals from an interaction.
 * Combines accessible name, placeholder, ancestor roles/classes into
 * a flat array for the keyword matcher.
 */
function collectTextSignals(interaction: ComponentInteraction): string[] {
  const texts: string[] = [];
  const t = interaction.trigger;

  if (t.accessibleName) texts.push(t.accessibleName);
  if (t.ariaLabel) texts.push(t.ariaLabel);
  if (t.placeholder) texts.push(t.placeholder);
  if (t.className) texts.push(t.className);

  // Ancestor text signals
  const ctx = interaction.triggerEvent?.domContext;
  if (ctx) {
    if (ctx.ancestorRoles?.length) texts.push(...ctx.ancestorRoles);
    if (ctx.ancestorClasses?.length) texts.push(...ctx.ancestorClasses);
  }

  return texts;
}

/**
 * Extract behavioral evidence from SemanticEffects.
 */
function extractBehavioral(
  effects: SemanticEffect[],
  triggerCssPath: string,
): BehavioralEvidence {
  const categories = new Set(effects.map((e) => e.category));

  // Check for remote effects: content-change or visibility-change on a
  // DIFFERENT element than the trigger.
  const remoteEffect = effects.some(
    (e) =>
      (e.category === 'content-change' || e.category === 'visibility-change') &&
      e.affectedTarget.cssPath !== triggerCssPath,
  );

  // Check for direct-property confidence basis
  const directProperty = effects.some((e) => e.confidenceBasis === 'direct-property');

  // Aggregate netNodeDelta from content-change effects
  let netNodeDelta: number | null = null;
  for (const e of effects) {
    if (e.category === 'content-change' && e.netNodeDelta != null) {
      if (netNodeDelta === null) netNodeDelta = 0;
      netNodeDelta += e.netNodeDelta;
    }
  }

  return {
    effects,
    hasStateToggle: categories.has('state-toggle'),
    hasExpandCollapse: categories.has('expand-collapse'),
    hasEnableDisable: categories.has('enable-disable'),
    hasContentChange: categories.has('content-change'),
    hasVisibilityChange: categories.has('visibility-change'),
    hasRemoteEffect: remoteEffect,
    hasDirectPropertyEvidence: directProperty,
    netNodeDelta,
  };
}

/**
 * Check if a URL path contains item-specific identifiers.
 * Framework-agnostic patterns: common product/item path segments,
 * UUID-like strings, long alphanumeric IDs.
 */
function hasItemSpecificUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname;

    // Common product/detail path prefixes (framework-agnostic)
    const itemPrefixes = ['/dp/', '/product/', '/item/', '/detail/', '/products/', '/p/', '/listing/', '/listings/'];
    if (itemPrefixes.some((p) => path.includes(p))) return true;

    // Check path segments for item-ID-like patterns
    const segments = path.split('/').filter((s) => s.length > 0);
    for (const seg of segments) {
      // ASIN-like (10-char alphanumeric uppercase)
      if (/^[A-Z0-9]{10}$/.test(seg)) return true;
      // UUID-like
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
      // Long slug ending with ID (e.g., 'red-shoes-prod12345')
      if (seg.length > 8 && /[-_](?:prod|sku|id)\d+/i.test(seg)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Compare two URLs by path only (ignoring query params and hash).
 * Returns true if the pathname differs.
 */
function urlPathsDiffer(url1: string, url2: string): boolean {
  try {
    const u1 = new URL(url1);
    const u2 = new URL(url2);
    return u1.pathname !== u2.pathname || u1.hostname !== u2.hostname;
  } catch {
    // If either URL is invalid, fall back to string comparison of the path
    // up to the first ? or #
    const p1 = url1.split('?')[0].split('#')[0];
    const p2 = url2.split('?')[0].split('#')[0];
    return p1 !== p2;
  }
}

/**
 * Extract sequence context from the interaction array.
 */
function extractSequence(
  interactions: ComponentInteraction[],
  index: number,
): SequenceContext {
  const current = interactions[index];
  const previous = index > 0 ? interactions[index - 1] : null;
  const next = index < interactions.length - 1 ? interactions[index + 1] : null;

  const currentUrl = current.triggerEvent?.pageUrl ?? '';
  const currentTitle = current.triggerEvent?.pageTitle ?? '';

  const previousType = previous?.type ?? null;
  const previousUrl = previous?.triggerEvent?.pageUrl ?? '';
  const precededBySamePage = previous != null && previousUrl === currentUrl;

  // Same-form detection: previous was TextEntry on the same page
  const precededByTextEntryOnSameForm =
    previous != null &&
    previous.type === 'TextEntry' &&
    previousUrl === currentUrl;

  // URL change after this interaction
  const nextUrl = next?.triggerEvent?.pageUrl ?? '';
  const urlChangedAfter = next != null && nextUrl !== currentUrl;
  const urlPathChangedAfter = urlChangedAfter && urlPathsDiffer(currentUrl, nextUrl);
  const hasNextItemSpecificUrl = urlChangedAfter && hasItemSpecificUrl(nextUrl);

  // URL changed compared to previous
  const urlChanged = previous != null && previousUrl !== currentUrl;

  // List context: preceded by Search or FilterSelection-type interaction
  const precededByListContext =
    previous != null &&
    (previous.type === 'TextEntry' || previous.type === 'Dropdown' || previous.type === 'Checkbox');

  // Form interaction context: any preceding interaction on the same page
  // that is a form input (TextEntry, Dropdown, Checkbox, Slider).
  // SubmitForm uses this to detect form submissions preceded by any input,
  // not just TextEntry (e.g., Avis Ford Make/Model/Condition dropdowns).
  const FORM_INTERACTION_TYPES = new Set(['TextEntry', 'Dropdown', 'Checkbox', 'Slider']);
  let precededByFormInteraction = false;
  if (previous != null && previousUrl === currentUrl) {
    // Scan backward on the same page for any form interaction
    for (let i = index - 1; i >= 0; i--) {
      const prevInteract = interactions[i];
      const prevInteractUrl = prevInteract.triggerEvent?.pageUrl ?? '';
      if (prevInteractUrl !== currentUrl) break; // different page
      if (FORM_INTERACTION_TYPES.has(prevInteract.type)) {
        precededByFormInteraction = true;
        break;
      }
    }
  }

  // Trigger's own href: if the trigger is a link with an item-specific href,
  // OpenDetail can claim even without urlChangedAfter.
  const triggerHref = current.trigger?.href ?? null;
  const triggerHasItemSpecificHref =
    triggerHref != null && hasItemSpecificUrl(triggerHref);

  return {
    previousInteractionType: previousType,
    precededBySamePage,
    precededByTextEntryOnSameForm,
    urlChangedAfter,
    pageUrl: currentUrl,
    pageTitle: currentTitle,
    urlChanged,
    nextUrl: urlChangedAfter ? nextUrl : null,
    hasNextItemSpecificUrl,
    precededByListContext,
    urlPathChangedAfter,
    precededByFormInteraction,
    triggerHasItemSpecificHref,
  };
}

// ── Main Extractor ────────────────────────────────────────────────────

/**
 * Extract complete evidence for one interaction.
 *
 * @param interaction - The ComponentInteraction to extract from.
 * @param effects - The SemanticEffects attached to this interaction (M2 output).
 * @param interactions - The full recording sequence (for sequence context).
 * @param index - The index of this interaction in the sequence.
 * @returns Complete ExtractedEvidence for capability rule evaluation.
 */
export function extractEvidence(
  interaction: ComponentInteraction,
  effects: SemanticEffect[],
  interactions: ComponentInteraction[],
  index: number,
): ExtractedEvidence {
  const trigger = interaction.trigger;

  // Physical evidence
  const inputType = interaction.triggerEvent?.domContext?.inputType ?? null;
  const isCheckboxLike =
    trigger.ariaRole === 'checkbox' ||
    trigger.tag === 'INPUT' && (inputType === 'checkbox' || inputType === 'radio');

  const isSliderLike =
    trigger.ariaRole === 'slider' ||
    trigger.ariaRole === 'spinbutton' ||
    (trigger.tag === 'INPUT' && inputType === 'range');

  // userAdjusted: only true when metadata says the user actually changed a value
  const userAdjusted = interaction.metadata?.userAdjusted === true;

  const isSubmitType =
    inputType === 'submit' ||
    (trigger.tag === 'BUTTON' &&
     trigger.accessibleName?.toLowerCase().includes('submit'));

  const isFileInput = trigger.tag === 'INPUT' && inputType === 'file';

  const physical: PhysicalEvidence = {
    interactionType: interaction.type,
    tag: trigger.tag,
    ariaRole: trigger.ariaRole,
    accessibleName: trigger.accessibleName,
    href: trigger.href ?? null,
    isCheckboxLike,
    isSliderLike,
    userAdjusted,
    isSubmitType,
    isFileInput,
    ancestorRoles: interaction.triggerEvent?.domContext?.ancestorRoles ?? [],
    ancestorClasses: interaction.triggerEvent?.domContext?.ancestorClasses ?? [],
  };

  // Behavioral evidence
  const triggerCssPath = trigger.cssSelector ?? '';
  const behavioral = extractBehavioral(effects, triggerCssPath);

  // Sequence context
  const sequence = extractSequence(interactions, index);

  // Keyword evidence
  const textSignals = collectTextSignals(interaction);
  const keywordMatches = matchKeywords(textSignals);
  const keywords: KeywordEvidence = {
    matches: keywordMatches,
    hasAnyMatch: keywordMatches.length > 0,
  };

  return {
    interactionId: interaction.interactionId,
    physical,
    behavioral,
    sequence,
    keywords,
  };
}

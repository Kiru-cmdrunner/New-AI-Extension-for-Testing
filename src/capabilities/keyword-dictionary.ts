/**
 * Keyword Dictionary — V1 extensible data file.
 *
 * Keywords are ONE supporting signal among several. A keyword match alone
 * NEVER classifies above LOW. Keywords are filtered by the consistency check:
 * if required behavioral signals are absent, keywords are ignored entirely.
 *
 * The dictionary is organized by capability category. Each entry defines
 * a list of patterns to match against the trigger element's accessible name,
 * label, placeholder, ancestor roles/classes, and other text signals.
 *
 * Language-independence: the V1 dictionary is English-oriented. Applications
 * can extend it (future: localization). Keywords are a supporting signal,
 * not a required signal, so missing keywords never prevent classification.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (§8)
 */

import type { CapabilityType } from './capability-types';

// ── Dictionary Entry ──────────────────────────────────────────────────

/**
 * A keyword group for one capability category.
 * Patterns are matched case-insensitively against text signals.
 */
export interface KeywordGroup {
  /** The capability this keyword group supports. */
  capability: CapabilityType;
  /** Keyword patterns that indicate this capability (case-insensitive substring match). */
  keywords: string[];
}

// ── V1 Dictionary ─────────────────────────────────────────────────────

/**
 * The V1 keyword dictionary. Six categories covering the most common
 * UI interaction patterns.
 *
 * This is a data file — extend by adding entries, not by changing logic.
 * Keywords are deliberately common-sense terms a user would see in a UI:
 * button labels, link text, placeholder text, section headings.
 */
export const KEYWORD_DICTIONARY: readonly KeywordGroup[] = [
  {
    capability: 'FilterSelection',
    keywords: [
      'filter', 'refine', 'narrow', 'brand', 'category',
      'department', 'condition', 'eligibility', 'show only',
    ],
  },
  {
    capability: 'SortSelection',
    keywords: [
      'sort', 'order', 'arrange', 'price: low', 'price: high',
      'newest', 'relevance', 'a-z', 'z-a', 'ascending', 'descending',
      'name: a', 'name: z', 'rating',
    ],
  },
  {
    capability: 'Search',
    keywords: [
      'search', 'find', 'lookup', 'query', 'go',
    ],
  },
  {
    capability: 'Navigate',
    keywords: [
      'home', 'back', 'next', 'continue', 'menu',
      'dashboard', 'profile', 'account', 'settings',
    ],
  },
  {
    capability: 'SubmitForm',
    keywords: [
      'submit', 'sign in', 'login', 'log in', 'register', 'sign up',
      'save', 'apply', 'send', 'confirm', 'book', 'checkout', 'place order',
      'search', 'find',
    ],
  },
  {
    capability: 'Paginate',
    keywords: [
      'next page', 'previous page', 'prev page', 'load more',
      'show more', 'page 2', 'page 3', '›', '‹', '«', '»',
    ],
  },
  {
    capability: 'SelectOption',
    keywords: [
      'select', 'choose', 'pick', 'option', 'make', 'model',
      'year', 'quantity', 'size', 'color', 'language', 'country', 'timezone',
    ],
  },
  {
    capability: 'AdjustValue',
    keywords: [
      'price', 'range', 'quantity', 'volume', 'brightness',
      'opacity', 'zoom', 'scale', 'font size', 'slider',
    ],
  },
] as const;

// ── Matcher ───────────────────────────────────────────────────────────

/**
 * Result of a keyword match for a single capability.
 */
export interface KeywordMatch {
  /** The capability the matched keywords support. */
  capability: CapabilityType;
  /** The specific keywords that matched. */
  matched: string[];
}

/**
 * Match text signals against the keyword dictionary.
 *
 * Searches all text fields case-insensitively. Returns matches grouped
 * by capability — one entry per capability that had at least one hit.
 *
 * @param texts - Text signals to search (label, placeholder, ancestor text, etc.)
 * @returns Array of KeywordMatch, one per capability with ≥1 hit.
 */
export function matchKeywords(texts: string[]): KeywordMatch[] {
  // Join all texts into one lowercase haystack for efficient searching
  const haystack = texts
    .filter((t) => t != null && t.length > 0)
    .join(' ')
    .toLowerCase();

  if (haystack.length === 0) return [];

  const results: KeywordMatch[] = [];

  for (const group of KEYWORD_DICTIONARY) {
    const matched = group.keywords.filter((kw) => haystack.includes(kw.toLowerCase()));
    if (matched.length > 0) {
      results.push({ capability: group.capability, matched });
    }
  }

  return results;
}

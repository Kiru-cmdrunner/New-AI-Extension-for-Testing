/**
 * M9.7 — Intent Vocabulary
 *
 * Built-in vocabulary mapping element identity → intent labels.
 * Used by IntentLabeler for template-based resolution.
 *
 * Architecture: .drytis/specs/m9-7-deterministic-semantic-enrichment.md
 */

/**
 * A single vocabulary entry.
 */
export interface IntentVocabEntry {
  /** Canonical intent label (e.g., "Add to cart"). */
  intent: string;
  /** Matching patterns against element label, tag, input type, class. */
  matchers: IntentMatcher[];
  /** Base confidence when matched (0–1). */
  baseConfidence: number;
}

export interface IntentMatcher {
  /** Which field to match against. */
  field: 'label' | 'className' | 'tag' | 'inputType' | 'href';
  /** Regex pattern. Case-insensitive. */
  pattern: string;
}

// ── E-commerce Vocabulary ──────────────────────────────────────────────

export const ECOMMERCE_INTENT_VOCABULARY: IntentVocabEntry[] = [
  {
    intent: 'Add to cart',
    matchers: [
      { field: 'label', pattern: 'add\\s*(to)?\\s*cart' },
      { field: 'label', pattern: '\\badd\\b.*\\bcart\\b' },
      { field: 'className', pattern: '\\b(add|cart)\\b' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Remove from cart',
    matchers: [
      { field: 'label', pattern: 'remove\\s*(from)?\\s*cart' },
      { field: 'label', pattern: '\\bremove\\b.*\\bcart\\b' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Proceed to checkout',
    matchers: [
      { field: 'label', pattern: 'checkout' },
      { field: 'label', pattern: 'proceed\\s*to\\s*(checkout|payment)' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Search products',
    matchers: [
      { field: 'label', pattern: 'search' },
      { field: 'className', pattern: '\\bsearch\\b' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Apply coupon',
    matchers: [
      { field: 'label', pattern: '(apply|redeem)\\s*(coupon|code|promo)' },
      { field: 'label', pattern: 'coupon' },
    ],
    baseConfidence: 0.75,
  },
];

// ── Authentication Vocabulary ──────────────────────────────────────────

export const AUTHENTICATION_INTENT_VOCABULARY: IntentVocabEntry[] = [
  {
    intent: 'Sign in',
    matchers: [
      { field: 'label', pattern: '(sign|log)\\s*in' },
      { field: 'label', pattern: 'login' },
    ],
    baseConfidence: 0.9,
  },
  {
    intent: 'Sign out',
    matchers: [
      { field: 'label', pattern: '(sign|log)\\s*out' },
      { field: 'label', pattern: 'logout' },
    ],
    baseConfidence: 0.9,
  },
  {
    intent: 'Register',
    matchers: [
      { field: 'label', pattern: '(sign\\s*up|register|create\\s*account)' },
    ],
    baseConfidence: 0.85,
  },
  {
    intent: 'Reset password',
    matchers: [
      { field: 'label', pattern: '(forgot|reset)\\s*(password|pwd)' },
    ],
    baseConfidence: 0.85,
  },
];

// ── General Vocabulary ─────────────────────────────────────────────────

export const GENERAL_INTENT_VOCABULARY: IntentVocabEntry[] = [
  {
    intent: 'Submit form',
    matchers: [
      { field: 'label', pattern: '(submit|save|continue|next)' },
    ],
    baseConfidence: 0.5,
  },
  {
    intent: 'Cancel',
    matchers: [
      { field: 'label', pattern: '\\b(cancel|close|dismiss)\\b' },
    ],
    baseConfidence: 0.7,
  },
  {
    intent: 'Delete',
    matchers: [
      { field: 'label', pattern: '\\b(delete|remove|trash)\\b' },
    ],
    baseConfidence: 0.7,
  },
  {
    intent: 'Edit',
    matchers: [
      { field: 'label', pattern: '\\b(edit|modify|update)\\b' },
    ],
    baseConfidence: 0.7,
  },
  {
    intent: 'Filter',
    matchers: [
      { field: 'label', pattern: '\\b(filter|refine|narrow)\\b' },
      { field: 'className', pattern: '\\bfilter\\b' },
    ],
    baseConfidence: 0.65,
  },
  {
    intent: 'Sort',
    matchers: [
      { field: 'label', pattern: '\\b(sort|order\\s*by)\\b' },
    ],
    baseConfidence: 0.65,
  },
  {
    intent: 'Navigate',
    matchers: [
      { field: 'tag', pattern: '^a$' },
    ],
    baseConfidence: 0.4,
  },
  {
    intent: 'Search',
    matchers: [
      { field: 'inputType', pattern: 'search' },
      { field: 'label', pattern: 'search' },
    ],
    baseConfidence: 0.8,
  },
  {
    intent: 'Expand/collapse',
    matchers: [
      { field: 'label', pattern: '(expand|collapse|show\\s*more|show\\s*less)' },
      { field: 'className', pattern: '(accordion|collaps|expand)' },
    ],
    baseConfidence: 0.6,
  },
  {
    intent: 'Toggle',
    matchers: [
      { field: 'className', pattern: '(toggle|switch)' },
    ],
    baseConfidence: 0.6,
  },
  {
    intent: 'Refresh data',
    matchers: [
      { field: 'label', pattern: '(refresh|reload)' },
    ],
    baseConfidence: 0.6,
  },
];

/**
 * Get all vocabulary entries from all domains + general.
 */
export function getAllVocabEntries(): IntentVocabEntry[] {
  return [
    ...ECOMMERCE_INTENT_VOCABULARY,
    ...AUTHENTICATION_INTENT_VOCABULARY,
    ...GENERAL_INTENT_VOCABULARY,
  ];
}

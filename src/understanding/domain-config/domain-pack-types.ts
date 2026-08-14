/**
 * M9.11 — Domain Configuration Pack Types
 *
 * A DomainPack is a single JSON-serializable object that carries ALL
 * domain-specific configuration for one application domain. Installing
 * a pack registers its data into the individual registries without
 * modifying any core algorithm.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { DomainSignature } from '../enrichment/domain-signatures';
import type { EntityTypeDetectionRule } from '../state-builder/entity-type-registry';
import type { IntentVocabEntry } from '../enrichment/intent-vocabulary';
import type { SemanticSelector } from '../page-content/page-content-types';

// ── Sub-spec types for view and network patterns ───────────────────────

/**
 * A view-detection pattern, identical in shape to the ViewRegistry's
 * internal pattern but expressed as data for a domain pack.
 */
export interface ViewPatternSpec {
  /** Regex string tested against the URL. */
  pattern: string;
  /** Canonical view label (e.g., 'leave-list', 'issue-detail'). */
  label: string;
  /** Stable view ID (e.g., 'leave-list'). */
  viewId: string;
}

/**
 * A network/API classification pattern for a domain.
 */
export interface NetworkPatternSpec {
  /** Operation label (e.g., 'apply-leave', 'merge-pr'). */
  operation: string;
  /** Regex string tested against the request URL. */
  pattern: string;
}

/**
 * A state-vocabulary entry for a domain's lifecycle states.
 */
export interface StateVocabEntry {
  /** Raw text patterns that map to this canonical state. */
  keywords: string[];
  /** Canonical state label (e.g., 'pending', 'approved'). */
  canonical: string;
}

/**
 * The aggregated domain configuration.
 */
export interface DomainPack {
  /** Unique pack identifier (e.g., 'hr', 'devtools'). */
  id: string;
  /** Human-readable domain name. */
  label: string;
  /** Domain classification type for semantic enrichment. */
  domainType?: string;

  /** Classification evidence signatures. */
  signatures?: DomainSignature[];
  /** Entity-type detection rules. */
  entityTypes?: EntityTypeDetectionRule[];
  /** Lifecycle state vocabulary. */
  stateVocabulary?: StateVocabEntry[];
  /** Page/view detection patterns. */
  viewPatterns?: ViewPatternSpec[];
  /** Intent vocabulary entries. */
  intentVocabulary?: IntentVocabEntry[];
  /** Network/API classification patterns. */
  networkPatterns?: NetworkPatternSpec[];
  /** View IDs that indicate successful outcome confirmation. */
  confirmationViews?: string[];
  /** Semantic page-content selectors. */
  pageContentSelectors?: SemanticSelector[];
}

/**
 * M9.11 — Domain Pack Registry
 *
 * Central registry that aggregates all sub-registries. Installing a
 * DomainPack pushes its data into the individual registries without
 * modifying any core algorithm.
 *
 * Architecture: .drytis/specs/m9-11-multi-domain-config.md
 */

import type { DomainPack } from './domain-pack-types';
import { StateVocabularyRegistry } from './state-vocabulary-registry';
import { IntentVocabularyRegistry } from './intent-vocabulary-registry';
import { NetworkPatternRegistry } from './network-pattern-registry';

/**
 * Aggregates all extensible registries for multi-domain support.
 *
 * Each sub-registry is independent and can be used standalone.
 * DomainPackRegistry.install() is the convenience method that pushes
 * all data from a DomainPack into the right sub-registries.
 */
export class DomainPackRegistry {
  /** Lifecycle state vocabulary (M9.9). */
  readonly stateVocabulary = new StateVocabularyRegistry();
  /** Intent vocabulary (M9.7). */
  readonly intentVocabulary = new IntentVocabularyRegistry();
  /** Network/API patterns (M9.1). */
  readonly networkPatterns = new NetworkPatternRegistry();

  private installedPacks: Map<string, DomainPack> = new Map();

  /**
   * Collection of confirmation-view sets from all installed packs.
   * Key = packId, Value = Set of view IDs.
   */
  private confirmationViewSets: Map<string, Set<string>> = new Map();

  /**
   * Entity-type detection rules from all installed packs.
   */
  private entityTypeRules: import('../state-builder/entity-type-registry').EntityTypeDetectionRule[] = [];

  /**
   * View patterns from all installed packs.
   */
  private viewPatterns: import('./domain-pack-types').ViewPatternSpec[] = [];

  /**
   * Page-content selectors from all installed packs.
   */
  private pageContentSelectors: import('../page-content/page-content-types').SemanticSelector[] = [];

  /**
   * Domain signatures from all installed packs.
   */
  private signatures: import('../enrichment/domain-signatures').DomainSignature[] = [];

  /**
   * Install a domain pack. All data flows into the appropriate registries.
   */
  install(pack: DomainPack): void {
    // Idempotent: uninstall first if already installed
    if (this.installedPacks.has(pack.id)) {
      this.uninstall(pack.id);
    }

    this.installedPacks.set(pack.id, pack);

    if (pack.stateVocabulary) {
      this.stateVocabulary.registerAll(pack.stateVocabulary);
    }
    if (pack.intentVocabulary) {
      this.intentVocabulary.register(pack.intentVocabulary);
    }
    if (pack.networkPatterns) {
      this.networkPatterns.register(pack.networkPatterns);
    }
    if (pack.confirmationViews) {
      this.confirmationViewSets.set(pack.id, new Set(pack.confirmationViews));
    }
    if (pack.entityTypes) {
      this.entityTypeRules = [...this.entityTypeRules, ...pack.entityTypes];
    }
    if (pack.viewPatterns) {
      this.viewPatterns = [...this.viewPatterns, ...pack.viewPatterns];
    }
    if (pack.pageContentSelectors) {
      this.pageContentSelectors = [...this.pageContentSelectors, ...pack.pageContentSelectors];
    }
    if (pack.signatures) {
      this.signatures = [...this.signatures, ...pack.signatures];
    }
  }

  /**
   * Uninstall a domain pack. Removes its contributions from all registries.
   */
  uninstall(packId: string): void {
    const pack = this.installedPacks.get(packId);
    if (!pack) return;

    this.installedPacks.delete(packId);

    // Rebuild all registries from remaining packs
    this.stateVocabulary.clear();
    this.intentVocabulary.clear();
    this.networkPatterns.clear();
    this.confirmationViewSets.clear();
    this.entityTypeRules = [];
    this.viewPatterns = [];
    this.pageContentSelectors = [];
    this.signatures = [];

    for (const remaining of this.installedPacks.values()) {
      if (remaining.stateVocabulary) this.stateVocabulary.registerAll(remaining.stateVocabulary);
      if (remaining.intentVocabulary) this.intentVocabulary.register(remaining.intentVocabulary);
      if (remaining.networkPatterns) this.networkPatterns.register(remaining.networkPatterns);
      if (remaining.confirmationViews) this.confirmationViewSets.set(remaining.id, new Set(remaining.confirmationViews));
      if (remaining.entityTypes) this.entityTypeRules = [...this.entityTypeRules, ...remaining.entityTypes];
      if (remaining.viewPatterns) this.viewPatterns = [...this.viewPatterns, ...remaining.viewPatterns];
      if (remaining.pageContentSelectors) this.pageContentSelectors = [...this.pageContentSelectors, ...remaining.pageContentSelectors];
      if (remaining.signatures) this.signatures = [...this.signatures, ...remaining.signatures];
    }
  }

  /**
   * Get all installed pack IDs.
   */
  getInstalledPackIds(): string[] {
    return [...this.installedPacks.keys()];
  }

  /**
   * Check if a view ID is a confirmation view in any installed pack.
   */
  isConfirmationView(viewId: string): boolean {
    for (const viewSet of this.confirmationViewSets.values()) {
      if (viewSet.has(viewId)) return true;
    }
    return false;
  }

  /**
   * Get all entity-type rules from installed packs.
   */
  getEntityTypeRules(): import('../state-builder/entity-type-registry').EntityTypeDetectionRule[] {
    return this.entityTypeRules;
  }

  /**
   * Get all view patterns from installed packs.
   */
  getViewPatterns(): import('./domain-pack-types').ViewPatternSpec[] {
    return this.viewPatterns;
  }

  /**
   * Get all page-content selectors from installed packs.
   */
  getPageContentSelectors(): import('../page-content/page-content-types').SemanticSelector[] {
    return this.pageContentSelectors;
  }

  /**
   * Get all domain signatures from installed packs.
   */
  getSignatures(): import('../enrichment/domain-signatures').DomainSignature[] {
    return this.signatures;
  }

  /**
   * Clear everything.
   */
  clear(): void {
    this.installedPacks.clear();
    this.stateVocabulary.clear();
    this.intentVocabulary.clear();
    this.networkPatterns.clear();
    this.confirmationViewSets.clear();
    this.entityTypeRules = [];
    this.viewPatterns = [];
    this.pageContentSelectors = [];
    this.signatures = [];
  }
}

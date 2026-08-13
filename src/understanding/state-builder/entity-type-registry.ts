/**
 * M9.8 — Entity Type Registry
 *
 * Configurable mapping from detection evidence to entity type strings.
 * Replaces the hard-coded 8-value EntityType union as the mechanism for
 * typing entities in domain-independent applications.
 *
 * Design:
 *   - The 8 legacy types (product, cart-item, search-query, order, user,
 *     filter, page-content, unknown) are preserved by StateBuilder's
 *     hard-coded derivation logic — untouched, unchanged.
 *   - New domains register rules mapping their evidence to new types.
 *   - Resolution priority: hard-coded M9.2 logic → registry rules → 'unknown'.
 *
 * Architecture: .drytis/specs/m9-8-entity-type-generalization.md
 */

// ── Rule Types ─────────────────────────────────────────────────────────

/**
 * A rule mapping detection evidence to an entity type.
 * All matchers are optional; a rule matches if ALL specified matchers match.
 */
export interface EntityTypeDetectionRule {
  /** The entity type this rule produces. */
  entityType: string;
  /** Match when the M9.4 page-content observer reported this entity kind. */
  pageContentKind?: string;
  /** Match when the current view ID equals this value. */
  viewId?: string;
  /** Regex (string form) matched against the URL. */
  urlPattern?: string;
  /** Match when the M9.1 network signal extractor classified this operation. */
  apiOperation?: string;
  /** Match when the element has this data-* attribute with the given value. */
  dataAttribute?: { name: string; value?: string };
}

/**
 * Registry of entity type detection rules.
 */
export class EntityTypeRegistry {
  private rules: EntityTypeDetectionRule[] = [];

  /**
   * Register a rule (or an array of rules).
   */
  register(rules: EntityTypeDetectionRule | EntityTypeDetectionRule[]): this {
    const list = Array.isArray(rules) ? rules : [rules];
    this.rules.push(...list);
    return this;
  }

  /**
   * Get all registered rules.
   */
  getAll(): EntityTypeDetectionRule[] {
    return [...this.rules];
  }

  /**
   * Clear all rules (test helper).
   */
  clear(): void {
    this.rules = [];
  }

  /**
   * Resolve the entity type for a page-content observation.
   * First rule (registration order) whose matchers all match wins.
   */
  resolveFromPageContent(
    kind: string | undefined | null,
    _entityId: string | undefined | null,
  ): string | null {
    if (!kind) return null;
    for (const rule of this.rules) {
      if (!rule.pageContentKind || rule.pageContentKind !== kind) continue;
      if (rule.viewId || rule.urlPattern || rule.apiOperation) continue;
      if (rule.dataAttribute) continue;
      return rule.entityType;
    }
    return null;
  }

  /**
   * Resolve the entity type from a view change.
   */
  resolveFromView(
    viewId: string,
    url: string,
  ): { type: string; id: string | null } | null {
    for (const rule of this.rules) {
      if (!rule.viewId || rule.viewId !== viewId) continue;
      if (rule.urlPattern) {
        const match = url.match(new RegExp(rule.urlPattern));
        if (!match) continue;
        const id = match[1] ?? null;
        return { type: rule.entityType, id };
      }
      return { type: rule.entityType, id: null };
    }
    return null;
  }

  /**
   * Resolve the entity type from an API operation.
   */
  resolveFromApiOperation(
    operation: string,
    interactionId: string,
  ): { type: string; id: string } | null {
    for (const rule of this.rules) {
      if (!rule.apiOperation || rule.apiOperation !== operation) continue;
      if (rule.viewId || rule.urlPattern || rule.pageContentKind) continue;
      return {
        type: rule.entityType,
        id: `${rule.entityType}:${interactionId}`,
      };
    }
    return null;
  }
}

// ── Built-in Seed Types ────────────────────────────────────────────────

/**
 * Seed rules for common non-e-commerce domains. These extend the 8 legacy
 * types with enterprise, HR, and developer-tools entity types.
 */
export const ENTITY_TYPE_SEEDS: EntityTypeDetectionRule[] = [
  // -- HR (OrangeHRM-style) --
  { entityType: 'employee', pageContentKind: 'employee' },
  { entityType: 'leave-request', pageContentKind: 'leave-request' },
  { entityType: 'candidate', pageContentKind: 'candidate' },
  { entityType: 'leave-request', viewId: 'leave-detail', urlPattern: '/leave/(\\d+)' },

  // -- Developer tools (GitHub-style) --
  { entityType: 'issue', viewId: 'issue-detail', urlPattern: '/issues/(\\d+)' },
  { entityType: 'pull-request', viewId: 'pr-detail', urlPattern: '/pull/(\\d+)' },
  { entityType: 'commit', pageContentKind: 'commit' },
  { entityType: 'comment', pageContentKind: 'comment' },
  // -- CI (GitHub-style) --
  { entityType: 'build', pageContentKind: 'build' },
];

/**
 * Create a registry seeded with the built-in type rules.
 */
export function createEntityTypeRegistry(
  seed: boolean = true,
): EntityTypeRegistry {
  const registry = new EntityTypeRegistry();
  if (seed) {
    registry.register([...ENTITY_TYPE_SEEDS]);
  }
  return registry;
}

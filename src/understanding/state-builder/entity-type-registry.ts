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
  /**
   * Match when an input field name matches this substring (case-insensitive).
   * Used by D6 form-field entity creation. Multiple patterns are OR'd.
   */
  fieldPatterns?: string[];
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

  /**
   * Resolve the entity type from a form field name (D6).
   * Returns the entity type if a field-pattern rule matches, null otherwise.
   *
   * D6 fix: uses semantic word-boundary matching instead of bare substring
   * matching. A field named "hostname" must NOT match the "name" pattern,
   * and "filename" must NOT match the "name" pattern. Matching is based on
   * whether the pattern appears as a complete word/segment in the field name,
   * separated by non-alphanumeric boundaries (hyphens, underscores, dots,
   * camelCase transitions, start/end of string).
   */
  resolveFromFormField(fieldName: string): string | null {
    if (!fieldName) return null;
    // Tokenize the ORIGINAL field name (preserves camelCase boundaries).
    const tokens = tokenizeFieldName(fieldName);
    const lower = fieldName.toLowerCase();
    for (const rule of this.rules) {
      if (!rule.fieldPatterns || rule.fieldPatterns.length === 0) continue;
      for (const pattern of rule.fieldPatterns) {
        if (fieldPatternMatches(pattern.toLowerCase(), lower, tokens)) {
          return rule.entityType;
        }
      }
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
 * Built-in form-field entity rules (D6).
 * Maps recognizable form-field names to entity types for domains
 * where entity creation was previously limited to search/query fields.
 */
export const FORM_FIELD_SEEDS: EntityTypeDetectionRule[] = [
  // -- HR (OrangeHRM-style) --
  {
    entityType: 'employee',
    fieldPatterns: [
      'employee', 'employeename', 'employee-name',
      'empname', 'emp-name',
      'firstname', 'first-name', 'lastname', 'last-name',
      'fullname', 'full-name',
    ],
  },
  {
    entityType: 'leave-request',
    fieldPatterns: [
      'leavetype', 'leave-type',
      'leavetype-id', 'leave-balance', 'leaveperiod', 'leave-period',
    ],
  },
  {
    entityType: 'candidate',
    fieldPatterns: ['candidate', 'applicant', 'applicantname', 'applicant-name'],
  },
  // -- Authentication --
  {
    entityType: 'user',
    fieldPatterns: ['username', 'user-name', 'email', 'password', 'login', 'signin'],
  },
  // -- Developer tools (GitHub-style) --
  {
    entityType: 'issue',
    fieldPatterns: [
      'issuetitle', 'issue-title',
      'issuebody', 'issue-body', 'issuesummary', 'issue-summary',
    ],
  },
  {
    entityType: 'pull-request',
    fieldPatterns: [
      'prtitle', 'pr-title', 'pulltitle',
      'pull-request-title', 'prdescription', 'pr-description',
      'reviewtitle', 'review-title',
    ],
  },
  // -- Generic form fields --
  {
    entityType: 'form-entry',
    fieldPatterns: ['title', 'name', 'description', 'comment', 'message', 'note'],
  },
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
    registry.register([...FORM_FIELD_SEEDS]);
  }
  return registry;
}

// ── D6 Fix: Semantic Field-Name Matching ────────────────────────────────

/**
 * Split a field name into semantic tokens.
 *
 * Recognizes these separators:
 *   - Hyphens, underscores, dots: "emp-name" → ["emp", "name"]
 *   - camelCase transitions: "firstName" → ["first", "name"]
 *   - Numbers: "field2name" → ["field", "name"]
 *
 * This avoids the old bug where `hostname`.includes('name') was true —
 * "hostname" tokenizes to ["hostname"], which does not contain "name" as a
 * standalone token.
 *
 * @returns Array of {token, fromSeparator} pairs. `fromSeparator` is true
 *   when the token boundary was an explicit separator (hyphen, underscore,
 *   dot, space), and false when it came from camelCase splitting alone.
 *   This distinction matters: `className` → [{token:"class",fromSeparator:false},
 *   {token:"name",fromSeparator:false}] — "name" here is a camelCase artifact,
 *   not a standalone word. But `emp-name` → [{token:"emp",fromSeparator:true},
 *   {token:"name",fromSeparator:true}] — "name" is an explicit word.
 */
export interface Token {
  token: string;
  fromSeparator: boolean;
}

export function tokenizeFieldName(name: string): Token[] {
  // First split on explicit separators (hyphens, underscores, dots, spaces)
  const parts = name.split(/[-_.\s]+/).filter(Boolean);
  const result: Token[] = [];
  for (const part of parts) {
    // Then split camelCase within each separator-delimited segment
    const camelParts = part
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean);
    // If camelCase split produced multiple parts, the camelCase-derived tokens
    // have fromSeparator=false (they weren't explicitly separated).
    // If only one part (no camelCase split), the token inherits the
    // separator status of its parent segment (which came from explicit
    // separator splitting, so fromSeparator=true only if the original name
    // had explicit separators — but if it was a single word, false).
    const hadCamelSplit = camelParts.length > 1;
    camelParts.forEach((cp) => {
      result.push({
        token: cp.toLowerCase(),
        fromSeparator: hadCamelSplit ? false : name !== part,
      });
    });
  }
  return result;
}

/**
 * Check if a field pattern matches a field name semantically.
 *
 * A match occurs if:
 *   1. The pattern is a complete token (word-boundary match), OR
 *   2. The field name is exactly equal to the pattern (exact match), OR
 *   3. The pattern itself is multi-token (e.g. "leave-type") and the field
 *      name contains all those tokens in sequence.
 *
 * Critically, `fieldPatternMatches('name', 'hostname', ['hostname'])` is false
 * because "name" is not a standalone token in "hostname".
 *
 * For camelCase compounds like `className`, the "name" part is a camelCase
 * artifact, not a standalone word — so it should NOT match the `name` pattern.
 * Only explicitly-separated names (e.g. `emp-name`, `last_name`) match.
 */
export function fieldPatternMatches(
  pattern: string,
  fieldName: string,
  tokens: Token[],
): boolean {
  // Exact match — always valid
  if (fieldName === pattern) return true;

  const patternTokens = pattern.split(/[-_.\s]+/).filter(Boolean);

  // Single-token pattern
  if (patternTokens.length === 1) {
    const pt = patternTokens[0];
    const tokenStrings = tokens.map((t) => t.token);

    // 1. Any token exactly matches the pattern
    //    (e.g., "name" matches token "name" in "emp-name")
    if (tokenStrings.includes(pt)) {
      // But for camelCase compounds (className → ["class", "name"]),
      // "name" is a camelCase artifact — reject unless the field is
      // explicitly separated (fromSeparator=true) or single-token.
      const matchingToken = tokens.find((t) => t.token === pt)!;
      if (matchingToken.fromSeparator || tokens.length === 1) {
        return true;
      }
      // camelCase artifact — don't match single-token pattern on it
    }

    // 2. Concatenated tokens match the pattern
    //    (e.g., "fullname" matches ["full", "name"] joined → "fullname")
    if (tokenStrings.length > 1 && tokenStrings.join('') === pt) {
      return true;
    }

    return false;
  }

  // Multi-token pattern: check if all pattern tokens appear in the field tokens
  if (patternTokens.length > 1) {
    // Token-subset match: every pattern token must be present in field tokens
    const tokenStrings = tokens.map((t) => t.token);
    return patternTokens.every((pt) => tokenStrings.includes(pt));
  }

  return false;
}

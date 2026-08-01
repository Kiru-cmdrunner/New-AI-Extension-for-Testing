/**
 * Element Entity — domain-schema.md §3.4
 *
 * A first-class logical UI element within a Project. Each Element represents
 * a business-meaningful UI component identified by a stable ID and resolved
 * to one or more locator strategies.
 *
 * Invariants:
 *   INV-EL1: Belongs to exactly one Project
 *   INV-EL2: Referenced by steps via stable ID, never by name or selector
 *   INV-EL3: Delete blocked if referenced by any step or validation
 *   INV-EL4: locatorStrategies is always a non-empty array
 *   INV-EL5: id is immutable and never reused
 */

import { ElementStatus, LocatorStrategyType } from '../enums';
import { MissingFieldError, ValueObjectError } from '../errors/invariant-errors';

// ── LocatorStrategy (value object) ────────────────────────

/** A ranked strategy for locating the element at execution time. */
export interface LocatorStrategy {
  readonly type: LocatorStrategyType;
  readonly value: string;
  /** Rank order (1 = highest priority, tried first). */
  readonly priority: number;
  /**
   * Confidence score (0.0–1.0).
   * V1: 1.0 for manually created, null for AI-suggested.
   * Future: computed from observed success rates.
   */
  readonly confidence: number | null;
}

/** Input for creating a LocatorStrategy. */
export interface CreateLocatorStrategyInput {
  type: LocatorStrategyType;
  value: string;
  priority: number;
  confidence?: number | null;
}

/**
 * Create a validated LocatorStrategy value object.
 *
 * @throws ValueObjectError if type/value/priority are invalid
 */
export function createLocatorStrategy(input: CreateLocatorStrategyInput): LocatorStrategy {
  if (!input.type) {
    throw new ValueObjectError('LocatorStrategy', 'type is required');
  }
  if (!input.value || !input.value.trim()) {
    throw new ValueObjectError('LocatorStrategy', 'value is required');
  }
  if (!Number.isInteger(input.priority) || input.priority < 1) {
    throw new ValueObjectError(
      'LocatorStrategy',
      `priority must be a positive integer (got ${input.priority})`,
    );
  }

  return {
    type: input.type,
    value: input.value.trim(),
    priority: input.priority,
    confidence: input.confidence ?? null,
  };
}

// ── ElementIdentityRecord (R4: durable semantic identity) ──

/**
 * Stable semantic identity for an Element — used by ElementMatchingService
 * for cross-session reconciliation and healing. Populated at creation time
 * from ElementIdentity. All fields are nullable for backward compatibility
 * with pre-R4 Elements (identity === null).
 *
 * Design: .drytis/specs/r4-element-identity-matching-foundation.md §4
 *
 * This is NOT a locator — it describes "what this element IS" semantically,
 * not "how to physically find it." Locators live in locatorStrategies[].
 */
export interface ElementIdentityRecord {
  /** Accessible name at capture time (frozen; NOT the editable logicalName). */
  readonly accessibleName: string | null;
  /** ARIA role (explicit or implicit). */
  readonly ariaRole: string | null;
  /** HTML tag name. */
  readonly tag: string | null;
  /** HTML `name` attribute — backend-facing form field identifier. */
  readonly name: string | null;
  /** `aria-label` attribute — explicit per-element label. */
  readonly ariaLabel: string | null;
  /** Up to 10 ancestor role strings from recording-time DomContext. */
  readonly ancestorRoles: readonly string[] | null;
  /** `data-testid` attribute value. */
  readonly testId: string | null;
  /** `data-cy` attribute value. */
  readonly dataCy: string | null;
  /** `data-qa` attribute value. */
  readonly dataQa: string | null;
}

// ── Element (aggregate root) ──────────────────────────────

/** Element entity — a logical UI element with ranked locator strategies. */
export interface Element {
  readonly id: string;
  readonly projectId: string;
  readonly logicalName: string;
  readonly description: string;
  /** Scope — which page or reusable component this element belongs to. */
  readonly pageOrComponent: string;
  readonly locatorStrategies: LocatorStrategy[];
  readonly status: ElementStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When a self-heal last updated the locators. Null if never healed. */
  readonly lastHealedAt: string | null;
  /** History of heal events. Empty if never healed. */
  readonly healHistory: HealEvent[];

  // ── R4: Durable semantic identity (null for pre-R4 Elements) ──
  /**
   * Frozen semantic identity captured at recording time. Used by
   * ElementMatchingService for cross-session matching. Separated from
   * logicalName (which is user-editable) to prevent UI renames from
   * breaking matching. Null for Elements created before R4.
   */
  readonly identity: ElementIdentityRecord | null;
}

/** Input for creating a new Element. */
export interface CreateElementInput {
  projectId: string;
  logicalName: string;
  description?: string;
  pageOrComponent?: string;
  locatorStrategies: CreateLocatorStrategyInput[];
  /** R4: Durable semantic identity. Omitted for pre-R4 compatibility. */
  identity?: ElementIdentityRecord | null;
}

/** Update input — only metadata fields change; locatorStrategies has its own update path. */
export interface UpdateElementInput {
  logicalName?: string;
  description?: string;
  pageOrComponent?: string;
  status?: ElementStatus;
  locatorStrategies?: CreateLocatorStrategyInput[];
  /** Heal history entries (append-only). */
  healHistory?: HealEvent[];
  /** Last healed timestamp. */
  lastHealedAt?: string | null;
  /** R4: Updated identity from fresh observation during healing. */
  identity?: ElementIdentityRecord | null;
}

/** [future] A self-healing event record. Schema-ready; not used in V1 logic. */
export interface HealEvent {
  readonly healedAt: string;
  readonly runId: string;
  readonly reason: string;
  readonly proposedBy: string;
  readonly oldStrategies: LocatorStrategy[];
  readonly newStrategies: LocatorStrategy[];
}

// ── Healing (Phase 11) ─────────────────────────────────────

/** Context for a healing operation. */
export interface HealContext {
  /** Session ID that provided the fresh evidence. */
  readonly sourceSessionId: string;
  /** Why healing was triggered. */
  readonly reason: string;
  /** Who/what proposed the heal. */
  readonly proposedBy: string;
}

/** Input for healing an Element with fresh locator strategies. */
export interface HealElementInput {
  /** The fresh locator strategies from a new recording or live DOM. */
  readonly newStrategies: CreateLocatorStrategyInput[];
  /** Context about the healing operation. */
  readonly context: HealContext;
  /**
   * R4: Fresh semantic identity from the observation that triggered healing.
   * When provided, non-null fields overwrite the stored identity; null fields
   * are preserved from the stored identity (don't lose information).
   */
  readonly updatedIdentity?: ElementIdentityRecord | null;
}

/**
 * Check if two locator strategies are equal (same type + value).
 */
function strategiesEqual(a: LocatorStrategy, b: LocatorStrategy): boolean {
  return a.type === b.type && a.value === b.value;
}

/**
 * R4: Merge a fresh identity record into a stored identity.
 *
 * Non-null fields from `fresh` overwrite the corresponding stored field.
 * Null fields on `fresh` are preserved from `stored` (don't lose
 * information just because the recorder didn't capture it this time).
 *
 * If `stored` is null (pre-R4 Element), the fresh identity becomes the
 * new identity (may still be null if fresh is also null).
 */
function mergeIdentity(
  stored: ElementIdentityRecord | null,
  fresh: ElementIdentityRecord | null,
): ElementIdentityRecord | null {
  if (!fresh) return stored;
  if (!stored) return fresh;
  return {
    accessibleName: fresh.accessibleName ?? stored.accessibleName,
    ariaRole: fresh.ariaRole ?? stored.ariaRole,
    tag: fresh.tag ?? stored.tag,
    name: fresh.name ?? stored.name,
    ariaLabel: fresh.ariaLabel ?? stored.ariaLabel,
    ancestorRoles: fresh.ancestorRoles ?? stored.ancestorRoles,
    testId: fresh.testId ?? stored.testId,
    dataCy: fresh.dataCy ?? stored.dataCy,
    dataQa: fresh.dataQa ?? stored.dataQa,
  };
}

/**
 * Heal an Element by merging fresh locator strategies into the existing set.
 *
 * Healing is **additive** — new strategies are merged alongside existing ones,
 * never removing strategies that might still work. If a strategy type has a
 * new value, the old value is preserved in the HealEvent record and the new
 * value takes its place in the active strategies.
 *
 * Status transitions:
 *   - STALE → ACTIVE (healed successfully)
 *   - BROKEN → ACTIVE (healed successfully)
 *   - ACTIVE → ACTIVE (locators updated proactively)
 *
 * The healHistory is append-only — every heal adds a new HealEvent.
 *
 * @param existing The current Element from the Repository.
 * @param input Fresh locator strategies + healing context.
 * @returns A new Element with merged strategies, appended heal event, and updated timestamps.
 *
 * @throws MissingFieldError if sourceSessionId is empty
 * @throws ValueObjectError if newStrategies is empty
 */
export function healElement(existing: Element, input: HealElementInput): Element {
  if (!input.context.sourceSessionId?.trim()) {
    throw new MissingFieldError('HealContext', 'sourceSessionId');
  }

  if (!input.newStrategies || input.newStrategies.length === 0) {
    throw new ValueObjectError(
      'Element',
      'newStrategies must have at least one strategy for healing',
    );
  }

  // Snapshot old strategies for the heal event
  const oldStrategies = existing.locatorStrategies;

  // Parse new strategies into value objects
  const newStrategies = input.newStrategies.map(createLocatorStrategy);

  // Merge: additive — keep all existing strategies, add new ones that don't duplicate
  // If a new strategy has the same type as an existing one but different value,
  // replace the existing one (the old value is preserved in the HealEvent)
  const merged: LocatorStrategy[] = [];
  const usedTypes = new Set<LocatorStrategyType>();

  // First, add new strategies (they take priority)
  let nextPriority = 1;
  for (const ns of newStrategies) {
    // Check if this exact strategy already exists
    const exactMatch = oldStrategies.find((os) => strategiesEqual(os, ns));
    if (exactMatch) {
      // Keep existing (with its priority)
      merged.push({ ...exactMatch, priority: nextPriority++ });
    } else {
      // New strategy — add it
      merged.push({ ...ns, priority: nextPriority++ });
    }
    usedTypes.add(ns.type);
  }

  // Then, add old strategies whose type isn't covered by new ones
  for (const os of oldStrategies) {
    if (!usedTypes.has(os.type)) {
      merged.push({ ...os, priority: nextPriority++ });
    }
  }

  // Validate unique priorities
  const priorities = new Set<number>();
  for (const s of merged) {
    if (priorities.has(s.priority)) {
      throw new ValueObjectError(
        'Element',
        `duplicate locator strategy priority ${s.priority} — priorities must be unique`,
      );
    }
    priorities.add(s.priority);
  }

  const now = new Date().toISOString();

  const healEvent: HealEvent = {
    healedAt: now,
    runId: input.context.sourceSessionId,
    reason: input.context.reason,
    proposedBy: input.context.proposedBy,
    oldStrategies: [...oldStrategies],
    newStrategies: merged,
  };

  // R4: Merge fresh identity into stored identity (field-level merge)
  const mergedIdentity = mergeIdentity(existing.identity, input.updatedIdentity ?? null);

  return {
    ...existing,
    locatorStrategies: merged,
    status: ElementStatus.ACTIVE,
    lastHealedAt: now,
    healHistory: [...existing.healHistory, healEvent],
    identity: mergedIdentity,
    updatedAt: now,
  };
}

/**
 * Create an Element entity with invariant validation.
 *
 * Invariants enforced:
 *   - projectId, logicalName required
 *   - locatorStrategies must be non-empty (INV-EL4)
 *   - priorities must be unique within the element
 *
 * @throws MissingFieldError if projectId or logicalName is empty
 * @throws ValueObjectError if locatorStrategies is empty or priorities are duplicated
 */
export function createElement(input: CreateElementInput): Element {
  if (!input.projectId?.trim()) {
    throw new MissingFieldError('Element', 'projectId');
  }

  const logicalName = input.logicalName?.trim();
  if (!logicalName) {
    throw new MissingFieldError('Element', 'logicalName');
  }

  if (!input.locatorStrategies || input.locatorStrategies.length === 0) {
    throw new ValueObjectError(
      'Element',
      'locatorStrategies must have at least one strategy (INV-EL4)',
    );
  }

  const strategies = input.locatorStrategies.map(createLocatorStrategy);

  // Validate unique priorities
  const priorities = new Set<number>();
  for (const s of strategies) {
    if (priorities.has(s.priority)) {
      throw new ValueObjectError(
        'Element',
        `duplicate locator strategy priority ${s.priority} — priorities must be unique`,
      );
    }
    priorities.add(s.priority);
  }

  const now = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    projectId: input.projectId.trim(),
    logicalName,
    description: input.description?.trim() ?? '',
    pageOrComponent: input.pageOrComponent?.trim() ?? '',
    locatorStrategies: strategies,
    status: ElementStatus.ACTIVE,
    createdAt: now,
    updatedAt: now,
    lastHealedAt: null,
    healHistory: [],
    identity: input.identity ?? null,
  };
}

/**
 * Create an updated Element with new field values.
 */
export function updateElement(existing: Element, input: UpdateElementInput): Element {
  const logicalName =
    input.logicalName !== undefined ? input.logicalName.trim() : existing.logicalName;
  if (!logicalName) {
    throw new MissingFieldError('Element', 'logicalName');
  }

  let locatorStrategies = existing.locatorStrategies;

  if (input.locatorStrategies) {
    if (input.locatorStrategies.length === 0) {
      throw new ValueObjectError(
        'Element',
        'locatorStrategies must have at least one strategy (INV-EL4)',
      );
    }
    locatorStrategies = input.locatorStrategies.map(createLocatorStrategy);

    const priorities = new Set<number>();
    for (const s of locatorStrategies) {
      if (priorities.has(s.priority)) {
        throw new ValueObjectError(
          'Element',
          `duplicate locator strategy priority ${s.priority} — priorities must be unique`,
        );
      }
      priorities.add(s.priority);
    }
  }

  return {
    ...existing,
    logicalName,
    description: input.description !== undefined ? input.description.trim() : existing.description,
    pageOrComponent:
      input.pageOrComponent !== undefined ? input.pageOrComponent.trim() : existing.pageOrComponent,
    status: input.status ?? existing.status,
    locatorStrategies,
    healHistory: input.healHistory ?? existing.healHistory,
    lastHealedAt: input.lastHealedAt ?? existing.lastHealedAt,
    identity: input.identity !== undefined ? input.identity : existing.identity,
    updatedAt: new Date().toISOString(),
  };
}

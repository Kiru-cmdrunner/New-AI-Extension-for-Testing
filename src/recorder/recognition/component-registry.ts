/**
 * Component Registry — session-scoped store for recognized UI components.
 *
 * Manages the lifecycle of ComponentGrouping entities during a recording session.
 * Handles identity resolution (merging multi-tier recognition of the same physical
 * component), evidence accumulation (generic supporting/contradicting evidence ledger),
 * and lifecycle progression (tentative → developing → confirmed | rejected).
 *
 * Design principle: the registry is GENERIC. It knows about ComponentGrouping entities
 * and EvidenceEntry records, but NOT about specific pattern types. All pattern knowledge
 * comes from the PatternDefinition via the orchestrator.
 *
 * Architecture: .drytis/ui-knowledge-model.md §4 (Progressive Recognition)
 * Reference:    .drytis/specs/ui-knowledge-model-phase4.md
 */

import {
  RecognitionSource,
  ComponentLifecycleState,
  ComponentRole,
  PatternType,
} from '../../domain/enums';
import type { ComponentGrouping, ConstituentRef } from '../../domain/entities/component-grouping';
import {
  createComponentGrouping,
  addConstituent,
  addObservedTransition,
  promoteToConfirmed,
  rejectComponent,
} from '../../domain/entities/component-grouping';
import type { RecognitionResult } from './structural-recognizer';

// ── Evidence Model ───────────────────────────────────────

/** How evidence relates to the component hypothesis. */
export type EvidenceDisposition = 'supporting' | 'contradicting' | 'neutral';

/**
 * A single piece of evidence for or against a component hypothesis.
 *
 * The evidence ledger is GENERIC — it does not assume any particular recognition
 * strategy. Match/mismatch is one way to generate entries; AI confidence votes,
 * heuristics, visual layout analysis, and future sources can contribute through
 * the same mechanism.
 */
export interface EvidenceEntry {
  /** Which recognition source produced this evidence. */
  readonly source: RecognitionSource;
  /** Whether this evidence supports, contradicts, or is neutral about the hypothesis. */
  readonly disposition: EvidenceDisposition;
  /** Human-readable description for audit trails. */
  readonly description: string;
  /** When this evidence was recorded (epoch ms). */
  readonly timestamp: number;
}

/** Factory for creating evidence entries. */
export function createEvidence(
  source: RecognitionSource,
  disposition: EvidenceDisposition,
  description: string,
): EvidenceEntry {
  if (!description?.trim()) {
    throw new Error('EvidenceEntry: description is required');
  }
  return {
    source,
    disposition,
    description,
    timestamp: Date.now(),
  };
}

// ── Identity Resolution ──────────────────────────────────

/** Minimum Jaccard similarity for constituent set overlap to indicate same component. */
const OVERLAP_THRESHOLD = 0.34;

/**
 * Compute the Jaccard similarity between two sets of element IDs.
 * J(A, B) = |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const id of a) {
    if (b.has(id)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return intersection / union;
}

/**
 * Extract all element IDs from a ComponentGrouping (root + all constituents).
 */
function componentElementIds(component: ComponentGrouping): Set<string> {
  const ids = new Set<string>();
  ids.add(component.rootElementId);
  for (const c of component.constituents) {
    ids.add(c.elementId);
  }
  return ids;
}

/**
 * Extract all element IDs from a RecognitionResult (root + all constituents).
 */
function resultElementIds(result: RecognitionResult): Set<string> {
  const ids = new Set<string>();
  if (result.rootElementId) ids.add(result.rootElementId);
  for (const c of result.constituents) {
    ids.add(c.elementId);
  }
  return ids;
}

/**
 * Determine if a recognition result refers to an existing component.
 *
 * Identity resolution rules (in priority order):
 *   1. EXACT ROOT MATCH: result.rootElementId === component.rootElementId
 *   2. ROOT-IN-CONSTITUENTS: result root is in component's constituents (or vice versa)
 *   3. CONSTITUENT OVERLAP: Jaccard similarity ≥ 0.34
 *   4. NO MATCH: different component
 *
 * @returns The matching ComponentGrouping, or null if no match.
 */
export function resolveIdentity(
  result: RecognitionResult,
  existingComponents: Iterable<ComponentGrouping>,
): ComponentGrouping | null {
  // Can't resolve if the result has no pattern (null result)
  if (result.patternType === null || !result.rootElementId) {
    return null;
  }

  const resultElements = resultElementIds(result);

  for (const component of existingComponents) {
    if (component.lifecycleState === ComponentLifecycleState.REJECTED) continue;

    const componentElements = componentElementIds(component);

    // 1. Exact root match
    if (result.rootElementId === component.rootElementId) {
      return component;
    }

    // 2. Root in constituents (either direction)
    if (
      componentElements.has(result.rootElementId) ||
      resultElements.has(component.rootElementId)
    ) {
      return component;
    }

    // 3. Constituent overlap
    const similarity = jaccardSimilarity(resultElements, componentElements);
    if (similarity >= OVERLAP_THRESHOLD) {
      return component;
    }
  }

  return null;
}

// ── Merge Logic ──────────────────────────────────────────

/**
 * Merge a new recognition result into an existing component.
 *
 * Rules (Evidence Sovereignty — AP4):
 *   - patternType: structural wins if tiers disagree
 *   - rootElementId: structural root preferred
 *   - constituents: union, structural role wins on conflict
 *   - recognitionSource: upgrade only (structural > behavioral > ai-assisted)
 *   - recognitionConfidence: structural (0.95) is authoritative
 */
export function mergeRecognition(
  existing: ComponentGrouping,
  result: RecognitionResult,
): ComponentGrouping {
  let merged = existing;

  // Source priority: structural > behavioral > ai-assisted
  const sourceRank: Record<RecognitionSource, number> = {
    [RecognitionSource.STRUCTURAL]: 3,
    [RecognitionSource.BEHAVIORAL]: 2,
    [RecognitionSource.AI_ASSISTED]: 1,
  };

  const newSourceRank = sourceRank[result.recognitionSource] ?? 0;
  const existingSourceRank = sourceRank[merged.recognitionSource] ?? 0;

  // Upgrade recognition source (never downgrade)
  if (newSourceRank > existingSourceRank) {
    // Create a new component with upgraded source/confidence
    // We need to use the entity's immutable mutation helpers
    merged = {
      ...merged,
      recognitionSource: result.recognitionSource,
      recognitionConfidence: result.confidence,
    };
  }

  // If structural, override classification
  if (result.recognitionSource === RecognitionSource.STRUCTURAL) {
    merged = {
      ...merged,
      patternType: result.patternType ?? merged.patternType,
      rootElementId: result.rootElementId ?? merged.rootElementId,
      recognitionConfidence: result.confidence,
    };
  }

  // Merge constituents (union, structural wins on role conflict)
  for (const constituent of result.constituents) {
    const existingConstituent = merged.constituents.find(
      (c) => c.elementId === constituent.elementId,
    );

    if (!existingConstituent) {
      // New constituent — add it
      merged = addConstituent(merged, constituent.elementId, constituent.role);
    } else if (
      existingConstituent.role !== constituent.role &&
      result.recognitionSource === RecognitionSource.STRUCTURAL
    ) {
      // Role conflict — structural wins. Replace the role.
      // We do this by creating a new constituents array.
      merged = {
        ...merged,
        constituents: merged.constituents.map((c) =>
          c.elementId === constituent.elementId
            ? { elementId: constituent.elementId, role: constituent.role }
            : c,
        ),
      };
    }
    // If behavioral and conflict → keep existing role (structural authority)
  }

  return merged;
}

// ── Rejection ────────────────────────────────────────────

/** Net contradiction threshold: reject when contradicting - supporting ≥ this value. */
export const CONTRADICTION_THRESHOLD = 3;

/**
 * Evaluate whether a tentative component should be rejected based on accumulated evidence.
 *
 * Algorithm: netContradiction = (contradicting entries) - (supporting entries)
 * If netContradiction >= CONTRADICTION_THRESHOLD → reject.
 *
 * This is the DEFAULT rejection algorithm. The registry exposes the evidence ledger
 * so alternative algorithms can be plugged in without changing the registry.
 */
export function shouldReject(evidence: readonly EvidenceEntry[]): boolean {
  let supporting = 0;
  let contradicting = 0;

  for (const entry of evidence) {
    if (entry.disposition === 'supporting') supporting++;
    else if (entry.disposition === 'contradicting') contradicting++;
  }

  return contradicting - supporting >= CONTRADICTION_THRESHOLD;
}

// ── Component Registry ───────────────────────────────────

/**
 * Session-scoped registry for recognized UI components.
 *
 * Stores ComponentGrouping entities and manages identity resolution, evidence
 * accumulation, lifecycle progression, and tentative rejection.
 */
export class ComponentRegistry {
  private components = new Map<string, ComponentGrouping>();
  private elementIndex = new Map<string, string>(); // elementId → groupingId
  private evidenceLedger = new Map<string, EvidenceEntry[]>();
  private idCounter = 0;

  /** Generate a unique grouping ID. */
  private nextId(): string {
    this.idCounter++;
    return `comp-${String(this.idCounter).padStart(4, '0')}`;
  }

  /**
   * Register a recognition result, creating a new component or merging with an existing one.
   *
   * @param result - The recognition result from either recognizer.
   * @returns The created or updated ComponentGrouping.
   */
  register(result: RecognitionResult): ComponentGrouping {
    // If null result, do nothing
    if (result.patternType === null || !result.rootElementId) {
      throw new Error('ComponentRegistry.register: cannot register a null recognition result');
    }

    // Identity resolution
    const existing = resolveIdentity(result, this.components.values());

    if (existing) {
      // Merge into existing component
      const merged = mergeRecognition(existing, result);
      this.components.set(merged.groupingId, merged);

      // Update element index for any new constituents
      for (const c of merged.constituents) {
        if (!this.elementIndex.has(c.elementId)) {
          this.elementIndex.set(c.elementId, merged.groupingId);
        }
      }

      // Record supporting evidence
      this.addEvidence(
        merged.groupingId,
        createEvidence(
          result.recognitionSource,
          'supporting',
          result.reason ?? `${result.patternType} recognition reinforced by ${result.recognitionSource}`,
        ),
      );

      return merged;
    }

    // Create new component
    const groupingId = this.nextId();
    const constituents: ConstituentRef[] = result.constituents.map((c) => ({
      elementId: c.elementId,
      role: c.role as ComponentRole,
    }));

    const component = createComponentGrouping({
      groupingId,
      patternType: result.patternType as PatternType,
      rootElementId: result.rootElementId,
      constituents,
      recognitionSource: result.recognitionSource,
      recognitionConfidence: result.confidence,
    });

    this.components.set(groupingId, component);

    // Build element index
    this.elementIndex.set(component.rootElementId, groupingId);
    for (const c of component.constituents) {
      this.elementIndex.set(c.elementId, groupingId);
    }

    // Initialize evidence ledger
    this.evidenceLedger.set(groupingId, [
      createEvidence(
        result.recognitionSource,
        'supporting',
        result.reason ?? `${result.patternType} recognized by ${result.recognitionSource}`,
      ),
    ]);

    return component;
  }

  /**
   * Add an evidence entry to a component's ledger.
   */
  addEvidence(groupingId: string, evidence: EvidenceEntry): void {
    const ledger = this.evidenceLedger.get(groupingId);
    if (ledger) {
      ledger.push(evidence);
    }
  }

  /**
   * Get the accumulated evidence for a component.
   */
  getEvidence(groupingId: string): readonly EvidenceEntry[] {
    return this.evidenceLedger.get(groupingId) ?? [];
  }

  /**
   * Add an observed transition to a component and update its lifecycle.
   *
   * @returns The updated component (may have been promoted to developing/confirmed).
   */
  addTransition(groupingId: string, transitionId: string): ComponentGrouping {
    const component = this.components.get(groupingId);
    if (!component) {
      throw new Error(`ComponentRegistry.addTransition: component ${groupingId} not found`);
    }

    let updated = addObservedTransition(component, transitionId);

    // addObservedTransition auto-advances tentative → developing
    this.components.set(groupingId, updated);
    return updated;
  }

  /**
   * Add a constituent to an existing component and index it.
   *
   * Used by the orchestrator for behavioral enrichment: when an interaction
   * occurs on an element that is DOM-related to an existing component but
   * wasn't part of the original structural recognition, the element is added
   * as a constituent so future interactions on it resolve to this component.
   *
   * @returns The updated component.
   */
  addConstituent(groupingId: string, elementId: string, role: ComponentRole): ComponentGrouping {
    const component = this.components.get(groupingId);
    if (!component) {
      throw new Error(`ComponentRegistry.addConstituent: component ${groupingId} not found`);
    }

    // Skip if already a constituent
    if (component.constituents.some((c) => c.elementId === elementId)) {
      return component;
    }

    const updated = addConstituent(component, elementId, role);
    this.components.set(groupingId, updated);
    this.elementIndex.set(elementId, groupingId);
    return updated;
  }

  /**
   * Check whether a component should be promoted to CONFIRMED based on its
   * observed operations matching the pattern's expected lifecycle.
   *
   * @param expectedOperations - The pattern's expectedLifecycle operations.
   * @returns The updated component, or the original if no promotion occurred.
   */
  checkLifecycle(
    groupingId: string,
    expectedOperations: readonly string[],
  ): ComponentGrouping {
    const component = this.components.get(groupingId);
    if (!component) {
      throw new Error(`ComponentRegistry.checkLifecycle: component ${groupingId} not found`);
    }

    // Already confirmed or rejected — no further transitions
    if (
      component.lifecycleState === ComponentLifecycleState.CONFIRMED ||
      component.lifecycleState === ComponentLifecycleState.REJECTED
    ) {
      return component;
    }

    // If no expected lifecycle defined, confirm on first transition
    if (expectedOperations.length === 0) {
      if (component.observedTransitionIds.length > 0) {
        const confirmed = promoteToConfirmed(component);
        this.components.set(groupingId, confirmed);
        return confirmed;
      }
      return component;
    }

    // Check set-containment: are all expected operations observed?
    // We derive observed operations from transition IDs (stored as references).
    // The orchestrator will call this with the actual operation set.
    // For now, we just check that the component has transitions.
    if (component.observedTransitionIds.length > 0) {
      // The actual operation matching is done by the orchestrator, which has
      // access to the transition data. Here we just handle the promotion.
      // The orchestrator calls promoteIfLifecycleComplete separately.
    }

    return component;
  }

  /**
   * Promote a component to CONFIRMED. Called by the orchestrator when
   * the lifecycle check passes.
   */
  promote(groupingId: string): ComponentGrouping {
    const component = this.components.get(groupingId);
    if (!component) {
      throw new Error(`ComponentRegistry.promote: component ${groupingId} not found`);
    }

    const confirmed = promoteToConfirmed(component);
    this.components.set(groupingId, confirmed);

    // Record supporting evidence
    this.addEvidence(
      groupingId,
      createEvidence(
        component.recognitionSource,
        'supporting',
        `Lifecycle complete — component confirmed`,
      ),
    );

    return confirmed;
  }

  /**
   * Reject a component if accumulated contradiction exceeds threshold.
   *
   * @returns true if the component was rejected, false otherwise.
   */
  checkRejection(groupingId: string): boolean {
    const component = this.components.get(groupingId);
    if (!component) return false;

    // Only tentative/developing components can be rejected
    if (
      component.lifecycleState === ComponentLifecycleState.CONFIRMED ||
      component.lifecycleState === ComponentLifecycleState.REJECTED
    ) {
      return false;
    }

    const evidence = this.evidenceLedger.get(groupingId) ?? [];
    if (!shouldReject(evidence)) return false;

    // Reject the component
    const rejected = rejectComponent(component);
    this.components.set(groupingId, rejected);

    // Clear element index entries for constituents
    for (const c of rejected.constituents) {
      if (this.elementIndex.get(c.elementId) === groupingId) {
        this.elementIndex.delete(c.elementId);
      }
    }
    if (this.elementIndex.get(rejected.rootElementId) === groupingId) {
      this.elementIndex.delete(rejected.rootElementId);
    }

    return true;
  }

  /**
   * Manually reject a component (for orchestrator use).
   */
  forceReject(groupingId: string): void {
    const component = this.components.get(groupingId);
    if (!component) return;

    if (component.lifecycleState === ComponentLifecycleState.REJECTED) return;

    const rejected = rejectComponent(component);
    this.components.set(groupingId, rejected);

    for (const c of rejected.constituents) {
      if (this.elementIndex.get(c.elementId) === groupingId) {
        this.elementIndex.delete(c.elementId);
      }
    }
    if (this.elementIndex.get(rejected.rootElementId) === groupingId) {
      this.elementIndex.delete(rejected.rootElementId);
    }
  }

  // ── Read API ─────────────────────────────────────────

  /** Get a component by its grouping ID. */
  getComponent(groupingId: string): ComponentGrouping | undefined {
    return this.components.get(groupingId);
  }

  /** Find a component by any of its constituent element IDs. */
  getByElement(elementId: string): ComponentGrouping | undefined {
    const groupingId = this.elementIndex.get(elementId);
    if (!groupingId) return undefined;
    return this.components.get(groupingId);
  }

  /** Get all components (including rejected ones). */
  getAll(): ComponentGrouping[] {
    return Array.from(this.components.values());
  }

  /** Get all active (non-rejected) components. */
  getActive(): ComponentGrouping[] {
    return this.getAll().filter(
      (c) => c.lifecycleState !== ComponentLifecycleState.REJECTED,
    );
  }

  /** Get all confirmed components. */
  getConfirmed(): ComponentGrouping[] {
    return this.getAll().filter(
      (c) => c.lifecycleState === ComponentLifecycleState.CONFIRMED,
    );
  }

  /** Check if an element belongs to any active component. */
  hasComponent(elementId: string): boolean {
    const groupingId = this.elementIndex.get(elementId);
    if (!groupingId) return false;
    const component = this.components.get(groupingId);
    return component !== undefined && component.lifecycleState !== ComponentLifecycleState.REJECTED;
  }

  /** Clear the registry (for testing). */
  clear(): void {
    this.components.clear();
    this.elementIndex.clear();
    this.evidenceLedger.clear();
    this.idCounter = 0;
  }

  /** Number of active components. */
  get size(): number {
    return this.getActive().length;
  }
}

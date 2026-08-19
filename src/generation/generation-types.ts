/**
 * Generation Layer — Compiler-Owned Input Types
 *
 * These interfaces define the Generation Layer's input boundary. The compiler
 * owns its contracts — it does not import from the Understanding Layer,
 * Capability Model, or any future subsystem.
 *
 * External systems adapt their output to these interfaces at the call site
 * (service worker). The compiler never knows who produced the data.
 *
 * Architectural invariants:
 *   INV-GEN-8:  No imports from src/domain/entities/ (Understanding Layer types)
 *   INV-GEN-9:  The service worker is the sole adapter site
 *   INV-GEN-10: No system awareness (no UnderstandingResult, CapabilityCandidate, etc.)
 *
 * Reference: .drytis/specs/phase-1.3-implementation-plan.md
 * Contract:  See the Generation Layer Contract in the engineering handover.
 */

import type { ComponentInteraction } from '../shared/component-types';

// ── Recording Context ───────────────────────────────────────────────────

/**
 * Recording context captured at session start.
 * Used to set IREnvironment (baseUrl, viewport) and test case metadata.
 */
export interface RecordingContext {
  /** The URL the recording started on. */
  readonly startUrl: string;
  /** The page title at recording start (for test case naming). */
  readonly title: string | null;
  /**
   * Content viewport of the tab at recording start (D9, from
   * chrome.tabs.Tab width/height). Optional: legacy sessions and capture
   * failures fall back to the documented 1280×720 default.
   */
  readonly viewport?: { width: number; height: number };
}

// ── Enrichment ──────────────────────────────────────────────────────────

/**
 * A single assertion the compiler can attach to a step.
 * Framework-neutral — the adapter decides how to render it.
 *
 * This is the compiler's own representation. It does not import
 * InteractionContract, ValidationType, or any domain enum.
 * The adapter maps domain-layer constraint types to these values.
 */
export interface GenerationAssertion {
  readonly kind: 'presence' | 'textMatch' | 'range' | 'length' | 'options';
  readonly property: string;
  readonly comparison: string;
  readonly expectedValue: unknown;
  readonly severity: 'hard' | 'soft';
}

/**
 * Track 3 — a step-scoped assertion derived from resulting-state evidence.
 *
 * Unlike elementAssertions (keyed by the step's OWN target element),
 * step-scoped assertions verify OTHER elements that changed as a
 * consequence of the step: the cart counter, the status badge, the
 * notification that appeared. They attach to the step by sourceEventId,
 * not by element ID, because the observed element is (usually) not the
 * element the step interacted with.
 *
 * The target is carried inline in generation-layer vocabulary. The
 * derivation (adapter side) must only emit locators it is confident are
 * re-findable at replay time (INV-GEN-4: generic selectors, never
 * synthesized nth-child chains).
 */
export interface StepScopedAssertion {
  /**
   * ValidationType grammar value as a plain string ('textMatch',
   * 'presence', …). Plain strings (not the domain enum) keep this file
   * free of domain imports (INV-GEN-8).
   */
  readonly type: string;
  /** ValidationComparison grammar value ('matches', 'isTrue', …). */
  readonly comparison: string;
  /** ValidationSeverity grammar value. Track 3 v1: always 'soft'. */
  readonly severity: 'hard' | 'soft';
  readonly expectedValue: unknown;
  /** Property to extract when type is attribute-based ('text' → null). */
  readonly property: string | null;
  /** CSS locator for the observed element (generic, per INV-GEN-4). */
  readonly targetCss: string;
  /**
   * Human-readable name of the observed element for descriptions and
   * POM naming (e.g. 'Cart counter', 'Order confirmation').
   */
  readonly targetName: string;
  /**
   * Why this assertion was derived — provenance for review tooling.
   * E.g. 'counter' | 'status-badge' | 'notification' | 'entity'.
   */
  readonly derivedFrom: string;
}

/**
 * Semantic enrichment for test generation.
 *
 * OWNED BY the Generation Layer. External systems (Understanding Layer,
 * Capability Model, Repository) adapt their output to this interface.
 * The compiler never imports their types.
 *
 * Every field is optional. When absent, the compiler produces a valid
 * but unenriched plan (INV-GEN-7: graceful degradation).
 *
 * Track 3 will populate this via an adapter in the service worker that
 * transforms UnderstandingResult → GenerationEnrichment.
 */
export interface GenerationEnrichment {
  /**
   * Assertions keyed by element ID. The compiler attaches these to
   * steps that target the corresponding element.
   */
  readonly elementAssertions?: ReadonlyMap<string, GenerationAssertion[]>;

  /**
   * Track 3: assertions keyed by SOURCE EVENT ID (evt-…) — the join key
   * every IR step already carries (step.sourceEventId). Each value
   * verifies elements that CHANGED as a consequence of that step
   * (resulting-state evidence), not the step's own target.
   *
   * Attached by the compiler in deriveAssertions(); all assertions are
   * SOFT in v1 (Option A) — they record without failing the replay.
   */
  readonly stepAssertions?: ReadonlyMap<string, StepScopedAssertion[]>;

  /**
   * Business-meaning labels keyed by interaction ID.
   * Replaces generic descriptions: "Fill 'john@example.com' in field3"
   * → "Fill 'john@example.com' in the Email Address field".
   */
  readonly businessLabels?: ReadonlyMap<string, string>;

  /**
   * Categorization tags derived from the recording workflow.
   * Merged with URL-derived tags in the final ExecutionIRPlan.
   */
  readonly surfaceTags?: readonly string[];
}

// ── Generation Input ────────────────────────────────────────────────────

/**
 * Encapsulated input for the Generation Layer's compileToIR() function.
 *
 * Design principle: additive. Future optional fields (EnvironmentProfile,
 * TestData) can be added without breaking existing callers.
 *
 * The compiler accepts ComponentInteraction[] (the live pipeline's output
 * type) plus optional enrichment. It does NOT accept DetectedInteraction,
 * UnderstandingResult, or SessionEvent[] — those are legacy types or
 * external system outputs.
 */
export interface GenerationInput {
  /**
   * Classified interactions from the 6-layer recording pipeline.
   * Each carries type, trigger element, metadata, member events, and
   * optional capability enrichment (componentType, componentFramework,
   * businessMeaning).
   */
  readonly interactions: ComponentInteraction[];

  /** Recording context — start URL, page title. */
  readonly recordingContext: RecordingContext;

  /** Test case name (for test file naming and report headers). */
  readonly testCaseName: string;

  /**
   * Optional semantic enrichment (Track 3).
   * When absent, the compiler produces a valid but unenriched plan.
   */
  readonly enrichment?: GenerationEnrichment;

  /**
   * D3: identity-key → session element ID (elem-NNNN), from
   * harvestSessionElements(). When present, element steps carry real IDs —
   * enabling repository linkage, runtime healing, and correct OR-1 merging.
   * When absent, behavior is identical to pre-D3 (captured elementId, i.e.
   * ''). Keys are elementIdentityKey(identity) values.
   */
  readonly elementIdByKey?: ReadonlyMap<string, string>;
}

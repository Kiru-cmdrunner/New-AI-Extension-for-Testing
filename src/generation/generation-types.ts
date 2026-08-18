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
}

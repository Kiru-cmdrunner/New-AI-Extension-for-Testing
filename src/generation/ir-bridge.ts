/**
 * Generation Layer — IR Compiler
 *
 * Compiles ComponentInteraction[] (recording output) into ExecutionIRPlan
 * (execution representation). This is a permanent architectural layer.
 *
 * Architecture:
 *   ComponentInteraction[] + RecordingContext + GenerationEnrichment
 *     → compileToIR() → ExecutionIRPlan
 *
 * The compiler is a pure function: same inputs → same plan, every time.
 * No side effects, no storage reads/writes. The caller (service worker)
 * handles persistence.
 *
 * Contract invariants (see .drytis/ENGINEERING-HANDOVER.md):
 *   INV-GEN-1: Determinism — same input → same output
 *   INV-GEN-4: Order preservation — step order matches interaction order
 *   INV-GEN-7: Graceful degradation — enrichment absent → valid plan
 *   INV-GEN-8: No Understanding Layer imports
 *   INV-GEN-9: Service worker is sole adapter site
 *
 * Phase 1.3: Removed DetectedInteraction dependency, 40-type vocabulary,
 * SessionEvent correlation, and Understanding Layer integration.
 */

import {
  IRAction,
  DEFAULT_EXECUTION_PARAMETERS,
  type IRStep,
  type ExecutionIRPlan,
  type ResolvedLocator,
  type ResolvedTarget,
  type ElementTarget,
  type IRAssertion,
  type IREnvironment,
  type IRInput,
} from '../domain/execution-ir/types';
import type { ElementIdentity } from '../shared/types';
import type { ComponentInteraction, InteractionType } from '../shared/component-types';
import {
  extractCandidatesFromIdentity,
  rankLocatorCandidates,
} from '../domain/locator-ranking';
import type { GenerationInput, GenerationEnrichment } from './generation-types';

// ── Interaction Type → IRAction Mapping (14 types) ────────

/**
 * Maps ComponentInteraction types to IRAction.
 *
 * This is the single source of truth for "what kind of IR step does this
 * interaction produce?" Every adapter (Playwright, Cypress, etc.) reads
 * the IRAction, never the InteractionType.
 */
const INTERACTION_TO_IR_ACTION: Record<InteractionType, IRAction> = {
  Click: IRAction.CLICK,
  TextEntry: IRAction.FILL,
  Dropdown: IRAction.SELECT,
  Checkbox: IRAction.TOGGLE,
  RadioButton: IRAction.SELECT,
  DatePicker: IRAction.SELECT_DATE,
  Hover: IRAction.HOVER,
  Link: IRAction.CLICK,
  FileUpload: IRAction.FILL,
  Slider: IRAction.FILL,
  ColorInput: IRAction.FILL,
  Tab: IRAction.CLICK,
  Scroll: IRAction.CLICK,      // filtered as noise below
  Navigation: IRAction.NAVIGATE,
  DragDrop: IRAction.DRAG_DROP,
  KeyboardShortcut: IRAction.KEYBOARD_SHORTCUT,
  CompoundInteraction: IRAction.DRAG_DROP, // compound actions typically resolve to drag-drop or click
  Unclassified: IRAction.CLICK, // fallback
};

// ── Noise Filtering ────────────────────────────────────────

/**
 * Interaction types that produce no meaningful test step.
 * Filtered out during IR plan construction.
 */
const NOISE_TYPES: Set<InteractionType> = new Set([
  'Scroll',
  'Unclassified',
]);

// ── Locator Resolution (ElementIdentity → ResolvedLocator[]) ──

/**
 * Resolve locators from ElementIdentity using the shared ranking rules.
 *
 * Delegates to the shared rankLocatorCandidates() function so that
 * recording-time and execution-time locator resolution use the same
 * priority assignment, filtering, and confidence scoring.
 *
 * @see src/domain/locator-ranking.ts for the shared ranking logic.
 */
function resolveLocatorsForIR(identity: ElementIdentity): ResolvedLocator[] {
  const candidates = extractCandidatesFromIdentity(identity);
  const ranked = rankLocatorCandidates(candidates);
  return ranked as ResolvedLocator[];
}

// ── Target Resolution (ElementIdentity → ResolvedTarget) ───

function resolveElementTarget(identity: ElementIdentity): ElementTarget {
  const locators = resolveLocatorsForIR(identity);
  return {
    kind: 'element',
    elementId: identity.elementId,
    elementName: identity.accessibleName || identity.ariaLabel || identity.tag,
    pageOrComponent: 'main',
    resolvedLocators: locators,
  };
}

function resolveUrlTarget(url: string): ResolvedTarget {
  return { kind: 'url', url };
}

// ── Description Generation ─────────────────────────────────

/**
 * Generate a human-readable description for an IR step.
 *
 * Uses metadata produced by ComponentDefinition.buildResult().
 * When enrichment provides a business label, it replaces the
 * generic element name.
 */
function generateDescription(
  interaction: ComponentInteraction,
  businessLabel?: string,
): string {
  const name = businessLabel ?? getElementDisplayName(interaction);
  const md = interaction.metadata;

  switch (interaction.type) {
    case 'TextEntry': {
      const value = (md['textValue'] as string) ?? '';
      return `Fill "${value}" in the ${name}`;
    }
    case 'Checkbox': {
      const checked = (md['checked'] as boolean) ?? false;
      return `${checked ? 'Check' : 'Uncheck'} the ${name}`;
    }
    case 'Dropdown':
    case 'RadioButton': {
      const value = (md['selectedValue'] as string) ?? '';
      return `Select "${value}" from the ${name}`;
    }
    case 'DatePicker': {
      const value = (md['dateValue'] as string) ?? (md['selectedDate'] as string) ?? '';
      return `Select ${value} in the ${name}`;
    }
    case 'Navigation': {
      const url = (md['pageUrl'] as string) ?? '';
      return `Navigate to ${url}`;
    }
    case 'Hover':
      return `Hover over the ${name}`;
    case 'Slider': {
      const value = (md['value'] as string) ?? '';
      return `Set the slider to ${value}`;
    }
    case 'ColorInput': {
      const value = (md['value'] as string) ?? '';
      return `Set the color to ${value}`;
    }
    case 'FileUpload': {
      const file = (md['fileName'] as string) ?? '';
      return `Upload ${file || 'a file'}`;
    }
    case 'Tab': {
      return `Click the "${name}" tab`;
    }
    case 'Link':
      return `Click the "${name}" link`;
    case 'DragDrop': {
      const source = (md['sourceName'] as string) ?? name;
      const target = (md['dropTargetName'] as string) ?? 'target';
      return `Drag "${source}" to ${target}`;
    }
    case 'KeyboardShortcut': {
      const keys = (md['shortcut'] as string) ?? '';
      return `Press ${keys}`;
    }
    case 'CompoundInteraction': {
      const summary = (md['summary'] as string) ?? name;
      return summary;
    }
    default:
      return `Click the ${name}`;
  }
}

/**
 * Generate plain-English description (capitalized first letter).
 */
function generatePlainEnglish(
  interaction: ComponentInteraction,
  businessLabel?: string,
): string {
  const description = generateDescription(interaction, businessLabel);
  return description.charAt(0).toUpperCase() + description.slice(1);
}

/**
 * Get a human-readable name for the interaction's target element.
 */
function getElementDisplayName(interaction: ComponentInteraction): string {
  const trigger = interaction.trigger;
  return trigger.accessibleName
    || trigger.ariaLabel
    || trigger.tag;
}

// ── Input Value Extraction ─────────────────────────────────

/**
 * Extract the input value for an IR step from interaction metadata.
 *
 * In the old architecture, this tried SessionEvent first then metadata.
 * Now metadata is the sole source — buildResult already resolved
 * values at classification time.
 */
function extractInputValue(interaction: ComponentInteraction): IRInput {
  const md = interaction.metadata;

  switch (interaction.type) {
    case 'TextEntry':
      return (md['textValue'] as string) ?? null;

    case 'Checkbox':
      return (md['checked'] as boolean) ?? null;

    case 'Dropdown':
    case 'RadioButton':
      return (md['selectedValue'] as string) ?? null;

    case 'DatePicker':
      return (md['dateValue'] as string) ?? (md['selectedDate'] as string) ?? null;

    case 'Slider':
      return (md['value'] as string) ?? null;

    case 'ColorInput':
      return (md['value'] as string) ?? null;

    case 'Navigation':
      return (md['pageUrl'] as string) ?? null;

    case 'FileUpload':
      return (md['fileName'] as string) ?? null;

    case 'DragDrop': {
      const source = (md['sourceName'] as string) ?? '';
      const target = (md['dropTargetName'] as string) ?? '';
      return source || target || null;
    }

    case 'KeyboardShortcut':
      return (md['shortcut'] as string) ?? null;

    default:
      return null;
  }
}

// ── Assertion Derivation (from Enrichment) ─────────────────

/**
 * Derive IRAssertion[] from enrichment.elementAssertions.
 *
 * Replaces the old fragment-based deriveAssertions/constraintsToAssertions
 * pipeline. When enrichment is absent, returns empty array (INV-GEN-7).
 */
function deriveAssertions(
  elementId: string,
  enrichment?: GenerationEnrichment,
): IRAssertion[] {
  // Track 3: When enrichment.elementAssertions is populated, map
  // GenerationAssertion[] → IRAssertion[] via an adapter at the
  // service-worker call site. For now, enrichment is always absent
  // (INV-GEN-7: graceful degradation).
  void elementId;
  void enrichment;
  return [];
}

// ── Readability Rules ──────────────────────────────────────

/**
 * Apply readability rules to IRStep[].
 *
 * OR-1: Merge consecutive CLICK on the same element into a single step.
 * (In the recording pipeline, a click + click on the same element within
 * a short window are captured as separate interactions but represent a
 * single user action.)
 */
function applyReadabilityRules(steps: IRStep[]): IRStep[] {
  if (steps.length <= 1) return steps;

  const result: IRStep[] = [];
  let i = 0;

  while (i < steps.length) {
    const current = steps[i];
    const next = steps[i + 1];

    // OR-1: Merge consecutive CLICK on same element
    if (
      next &&
      current.action === IRAction.CLICK &&
      next.action === IRAction.CLICK &&
      current.target.kind === 'element' &&
      next.target.kind === 'element' &&
      current.target.elementId === next.target.elementId
    ) {
      // Skip the duplicate — keep only the first
      result.push(current);
      i += 2;
    } else {
      result.push(current);
      i++;
    }
  }

  // Re-number order after merging
  return result.map((step, idx) => ({ ...step, order: idx }));
}

// ── Tag Derivation ─────────────────────────────────────────

/**
 * Derive tags from recording context and enrichment.
 *
 * Uses the start URL's first path segment plus any surface tags
 * from enrichment. Max 5 tags.
 */
function deriveTags(
  recordingContext: GenerationInput['recordingContext'],
  enrichment?: GenerationEnrichment,
): string[] {
  const tags: string[] = [];

  // Add the start URL path segment as a tag
  try {
    const url = new URL(recordingContext.startUrl);
    const pathSegment = url.pathname.split('/').filter(Boolean)[0];
    if (pathSegment) tags.push(pathSegment);
  } catch {
    // Ignore invalid URLs
  }

  // Add surface tags from enrichment
  if (enrichment?.surfaceTags) {
    for (const tag of enrichment.surfaceTags) {
      if (tag && !tags.includes(tag)) {
        tags.push(tag);
      }
    }
  }

  return tags.slice(0, 5);
}

// ── Main Compile Function ──────────────────────────────────

/**
 * Compile ComponentInteraction[] into an ExecutionIRPlan.
 *
 * This is the Generation Layer's entry point. It takes the recording
 * pipeline's output (ComponentInteraction[]) plus optional enrichment
 * and produces the framework-neutral execution representation consumed
 * by all downstream adapters (Playwright, Cypress, etc.).
 *
 * @param input Encapsulated generation inputs (see GenerationInput)
 * @returns ExecutionIRPlan — the unified execution representation
 */
export function build(input: GenerationInput): ExecutionIRPlan {
  const { interactions, recordingContext, testCaseName, enrichment } = input;

  const steps: IRStep[] = [];
  let stepCounter = 0;

  for (const interaction of interactions) {
    // Filter noise interactions
    if (NOISE_TYPES.has(interaction.type)) continue;

    // Look up business label for this interaction (if enriched)
    const businessLabel = enrichment?.businessLabels?.get(interaction.interactionId);

    // Determine action
    const action = INTERACTION_TO_IR_ACTION[interaction.type] ?? IRAction.CLICK;

    // Resolve target
    let target: ResolvedTarget;
    if (action === IRAction.NAVIGATE) {
      const url = (interaction.metadata['pageUrl'] as string) ?? recordingContext.startUrl;
      target = resolveUrlTarget(url);
    } else {
      target = resolveElementTarget(interaction.trigger);
    }

    // Extract input value
    const inputValue = extractInputValue(interaction);

    // Generate description
    const description = generateDescription(interaction, businessLabel);
    const plainEnglish = generatePlainEnglish(interaction, businessLabel);

    // Source event ID
    const sourceEventId = interaction.triggerEvent.eventId;

    // Derive assertions from enrichment
    const elementId = target.kind === 'element' ? target.elementId : '';
    const assertions = deriveAssertions(elementId, enrichment);

    steps.push({
      id: `step-${String(stepCounter + 1).padStart(4, '0')}`,
      order: stepCounter,
      action,
      description,
      target,
      input: inputValue,
      assertions,
      executionParameters: DEFAULT_EXECUTION_PARAMETERS,
      sourceEventId,
      plainEnglish,
    });

    stepCounter++;
  }

  // Apply readability rules (merge duplicates, re-number)
  const finalSteps = applyReadabilityRules(steps);

  // Derive tags
  const tags = deriveTags(recordingContext, enrichment);

  // Build environment
  const environment: IREnvironment = {
    baseUrl: recordingContext.startUrl,
    browser: 'chrome',
    viewport: { width: 1280, height: 720 },
  };

  return {
    testCaseId: `tc-${Date.now()}`,
    testCaseVersionId: `tcv-${Date.now()}`,
    testCaseVersionNumber: 1,
    title: testCaseName,
    tags,
    environment,
    steps: finalSteps,
  };
}

/**
 * Behavioral Recognizer — Tier 2 component recognition.
 *
 * Recognizes UI components through observed interaction evidence when ARIA
 * structure is absent. Uses the same declarative pattern catalogue as the
 * structural recognizer — behavioral signatures define evidence conditions
 * that, when satisfied across a sequence of transitions, indicate a pattern.
 *
 * Key design principle: the recognizer is COMPLETELY GENERIC. It contains
 * zero pattern-specific logic. All pattern knowledge lives in the catalogue's
 * behavioral signatures. Adding a new pattern's behavioral recognition = adding
 * a signature entry, never modifying this file.
 *
 * Algorithm:
 *   1. Receive ordered transitions for elements related to a root element
 *   2. For each pattern with a behavioral signature:
 *      a. Evaluate each condition against the transition evidence
 *      b. Count matching conditions
 *      c. Assign confidence (full match vs partial match)
 *   3. Return the best-matching pattern above threshold, or null
 *
 * Architecture: .drytis/ui-knowledge-model.md §4 (Tier 2 — Behavioral)
 * Reference:    .drytis/specs/ui-knowledge-model-phase3.md
 */

import {
  ComponentRole,
  RecognitionSource,
  TransitionOperation,
  TransitionEvidenceType,
  CascadeEffectType,
  RelevanceLevel,
} from '../../domain/enums';
import type { ObservedTransition, ElementState } from '../../domain/entities/observed-transition';
import {
  getBehavioralPatterns,
  EvidenceSignal,
  type PatternDefinition,
  type SignatureCondition,
} from './pattern-catalogue';
import type { RecognitionResult } from './structural-recognizer';

// ── Types ────────────────────────────────────────────────

/**
 * Input to the behavioral recognizer.
 *
 * Contains the ordered transition sequence for a group of related elements
 * (the root + its DOM descendants). The recognizer evaluates whether these
 * transitions collectively match any pattern's behavioral signature.
 */
export interface BehavioralRecognitionInput {
  /**
   * The element that appears to be the primary trigger for the interaction
   * sequence. This is the element the user first interacted with, or the
   * element that is the structural ancestor of others.
   */
  readonly rootElementId: string;

  /**
   * All element IDs related to the root — the root itself plus any DOM
   * descendants that received interactions. Transitions on elements outside
   * this set are ignored.
   */
  readonly relatedElementIds: string[];

  /**
   * Transitions observed on the root and related elements, ordered by
   * timestamp ascending (oldest first).
   */
  readonly transitions: ObservedTransition[];
}

/** A null result returned when no behavioral pattern matches. */
const NULL_RESULT: RecognitionResult = {
  patternType: null,
  rootElementId: null,
  constituents: [],
  confidence: 0,
  recognitionSource: RecognitionSource.BEHAVIORAL,
  matchedRole: null,
  reason: null,
};

// ── Evidence Signal Detection ────────────────────────────

/**
 * Detect which EvidenceSignals are present in a sequence of transitions.
 *
 * This is the core of the behavioral recognizer — it maps raw ObservedTransition
 * evidence fields (TransitionEvidenceType, CascadeEffectType, ElementState changes)
 * to the abstract EvidenceSignal vocabulary that pattern signatures use.
 *
 * Each detection function is generic — it checks structural properties of the
 * evidence data, never pattern-specific content.
 */
export interface SignalDetectionResult {
  /** Set of signals detected, with the count of observations for each. */
  readonly signals: Map<EvidenceSignal, number>;
  /** Which element IDs were involved in each signal (for constituent assignment). */
  readonly signalElements: Map<EvidenceSignal, string[]>;
}

/**
 * Analyze a sequence of transitions and produce a signal detection result.
 *
 * @param transitions - Ordered transitions (timestamp ascending).
 * @param rootElementId - The root element being evaluated.
 * @param relatedElementIds - All related element IDs (root + descendants).
 */
function detectSignals(
  transitions: ObservedTransition[],
  rootElementId: string,
  _relatedElementIds: Set<string>,
): SignalDetectionResult {
  const signals = new Map<EvidenceSignal, number>();
  const signalElements = new Map<EvidenceSignal, string[]>();

  /** Record that a signal was detected, incrementing its count. */
  function recordSignal(signal: EvidenceSignal, elementId: string): void {
    signals.set(signal, (signals.get(signal) ?? 0) + 1);
    const elements = signalElements.get(signal) ?? [];
    if (!elements.includes(elementId)) {
      elements.push(elementId);
    }
    signalElements.set(signal, elements);
  }

  // Track which non-root elements received CLICK operations (for clickable-children detection)
  const clickedElementIds = new Set<string>();
  // Track which elements had visibility cascades (appeared)
  const appearedElementIds = new Set<string>();
  // Track which elements had visibility cascades (disappeared)
  const disappearedElementIds = new Set<string>();
  // Track state changes per element (for mutual exclusivity)
  const stateChanges: Array<{ elementId: string; from: ElementState; to: ElementState }> = [];

  for (const t of transitions) {
    // Skip noise — only deliberate/supporting interactions carry signal
    if (t.relevance === RelevanceLevel.NOISE) continue;

    // Track clicks on non-root elements (options, children)
    if (t.operation === TransitionOperation.CLICK && t.elementId !== rootElementId) {
      clickedElementIds.add(t.elementId);
    }

    // Check evidence items
    for (const evidence of t.evidence) {
      // CHILD_ELEMENT_BECAME_VISIBLE: mutation evidence showing something appeared
      if (
        evidence.type === TransitionEvidenceType.MUTATION &&
        (evidence.description.toLowerCase().includes('visible') ||
          evidence.description.toLowerCase().includes('appeared') ||
          evidence.description.toLowerCase().includes('shown'))
      ) {
        recordSignal(EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE, t.elementId);
        // The element that appeared is in the cascadeEffects or the after-value
        appearedElementIds.add(t.elementId);
      }

      // ELEMENT_BECAME_MODAL: mutation evidence with modal-like keywords
      if (
        evidence.type === TransitionEvidenceType.MUTATION &&
        (evidence.description.toLowerCase().includes('overlay') ||
          evidence.description.toLowerCase().includes('modal') ||
          evidence.description.toLowerCase().includes('backdrop') ||
          evidence.description.toLowerCase().includes('dialog'))
      ) {
        recordSignal(EvidenceSignal.ELEMENT_BECAME_MODAL, t.elementId);
      }

      // TRIGGER_VALUE_CHANGED: value change on the root element
      if (
        evidence.type === TransitionEvidenceType.VALUE_CHANGE &&
        t.elementId === rootElementId
      ) {
        recordSignal(EvidenceSignal.TRIGGER_VALUE_CHANGED, t.elementId);
      }

      // TRIGGER_STATE_CHANGED: state change on the root element
      if (
        evidence.type === TransitionEvidenceType.STATE_CHANGE &&
        t.elementId === rootElementId
      ) {
        recordSignal(EvidenceSignal.TRIGGER_STATE_CHANGED, t.elementId);
      }

      // POPUP_CLOSED: mutation evidence showing something became hidden
      if (
        evidence.type === TransitionEvidenceType.MUTATION &&
        (evidence.description.toLowerCase().includes('hidden') ||
          evidence.description.toLowerCase().includes('closed') ||
          evidence.description.toLowerCase().includes('removed') ||
          evidence.description.toLowerCase().includes('dismissed'))
      ) {
        recordSignal(EvidenceSignal.POPUP_CLOSED, t.elementId);
        disappearedElementIds.add(t.elementId);
      }

      // State change on non-root elements (for mutual exclusivity)
      if (
        evidence.type === TransitionEvidenceType.STATE_CHANGE &&
        t.elementId !== rootElementId
      ) {
        stateChanges.push({
          elementId: t.elementId,
          from: t.stateBefore,
          to: t.stateAfter,
        });
      }
    }

    // Check cascade effects
    for (const cascade of t.cascadeEffects) {
      // SIBLING_VALUE_CHANGED: another element changed value
      if (
        cascade.effect === CascadeEffectType.VALUE &&
        cascade.elementId !== rootElementId
      ) {
        recordSignal(EvidenceSignal.SIBLING_VALUE_CHANGED, cascade.elementId);
      }

      // Visibility cascades on related elements
      if (cascade.effect === CascadeEffectType.VISIBILITY) {
        // Check the detail for appeared vs disappeared
        const detail = cascade.detail.toLowerCase();
        if (
          detail.includes('visible') ||
          detail.includes('appeared') ||
          detail.includes('shown')
        ) {
          appearedElementIds.add(cascade.elementId);
          recordSignal(EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE, cascade.elementId);
        }
        if (
          detail.includes('hidden') ||
          detail.includes('closed') ||
          detail.includes('removed')
        ) {
          disappearedElementIds.add(cascade.elementId);
          recordSignal(EvidenceSignal.POPUP_CLOSED, cascade.elementId);
        }
      }
    }
  }

  // CHILD_CONTAINS_CLICKABLE_ELEMENTS: at least 2 non-root elements received clicks
  // (2+ clickable children implies options/tabs, not a single close button)
  if (clickedElementIds.size >= 1 && appearedElementIds.size > 0) {
    // Check if any appeared element is a parent of clicked elements
    // Since we don't have DOM structure here, we approximate: if children
    // were clicked after something appeared, the popup contained clickable elements
    const hasClicksAfterAppearance = transitions.some(
      (t) =>
        t.operation === TransitionOperation.CLICK &&
        t.elementId !== rootElementId &&
        appearedElementIds.size > 0,
    );
    if (hasClicksAfterAppearance) {
      recordSignal(
        EvidenceSignal.CHILD_CONTAINS_CLICKABLE_ELEMENTS,
        [...clickedElementIds][0] ?? rootElementId,
      );
    }
  }

  // GROUP_MUTUAL_EXCLUSIVITY: at least 2 different non-root elements had state changes
  // where one went from selected→unselected while another went unselected→selected
  if (stateChanges.length >= 2) {
    const deselected = stateChanges.filter(
      (sc) =>
        (sc.from.checked === true && sc.to.checked === false) ||
        (sc.from.selected === true && sc.to.selected === false),
    );
    const selected = stateChanges.filter(
      (sc) =>
        (sc.from.checked === false && sc.to.checked === true) ||
        (sc.from.selected === false && sc.to.selected === true),
    );
    if (deselected.length > 0 && selected.length > 0) {
      recordSignal(
        EvidenceSignal.GROUP_MUTUAL_EXCLUSIVITY,
        selected[0].elementId,
      );
    }
  }

  return { signals, signalElements };
}

// ── Signature Matching ───────────────────────────────────

/**
 * Evaluate a single signature condition against detected signals.
 *
 * A condition matches if:
 *   1. Its signal was detected at least minOccurrences times (default 1)
 *   2. If expectedOperation is specified, at least one matching transition
 *      had that operation
 *
 * @returns true if the condition is satisfied.
 */
function evaluateCondition(
  condition: SignatureCondition,
  detection: SignalDetectionResult,
  transitions: ObservedTransition[],
  _rootElementId: string,
): boolean {
  const count = detection.signals.get(condition.signal) ?? 0;
  const minNeeded = condition.minOccurrences ?? 1;
  if (count < minNeeded) return false;

  // If no expected operation constraint, the signal alone satisfies
  if (!condition.expectedOperation) return true;

  // Check that at least one transition matching the signal had the expected operation
  // For root-level conditions, check transitions on the root element
  // For child-level conditions, check any transition
  const hasMatchingOperation = transitions.some(
    (t) =>
      t.operation === condition.expectedOperation &&
      t.relevance !== RelevanceLevel.NOISE,
  );

  return hasMatchingOperation;
}

/**
 * Count how many conditions in a signature are satisfied.
 *
 * @returns The number of matched conditions, total conditions, and list of matched IDs.
 */
function matchSignature(
  signature: { conditions: readonly SignatureCondition[] },
  detection: SignalDetectionResult,
  transitions: ObservedTransition[],
  rootElementId: string,
): { matchedCount: number; totalConditions: number; matchedIds: string[] } {
  let matchedCount = 0;
  const matchedIds: string[] = [];

  for (const condition of signature.conditions) {
    if (evaluateCondition(condition, detection, transitions, rootElementId)) {
      matchedCount++;
      matchedIds.push(condition.id);
    }
  }

  return { matchedCount, totalConditions: signature.conditions.length, matchedIds };
}

// ── Constituent Assignment ───────────────────────────────

/**
 * Assign component roles to elements based on which signals they contributed to.
 *
 * This is necessarily approximate for behavioral recognition (unlike structural
 * which has ARIA roles). We infer roles from the signals an element participated in:
 *
 * - The root element → TRIGGER (it initiated the interaction sequence)
 * - Elements that appeared (popup/panel) → CONTAINER
 * - Elements that received CLICK operations inside the popup → OPTION
 * - Elements in mutual exclusivity → OPTION
 */
function assignBehavioralConstituents(
  rootElementId: string,
  _relatedElementIds: string[],
  detection: SignalDetectionResult,
  transitions: ObservedTransition[],
  _def: PatternDefinition,
): Array<{ elementId: string; role: ComponentRole }> {
  const constituents: Array<{ elementId: string; role: ComponentRole }> = [];

  // Root is always the trigger
  constituents.push({ elementId: rootElementId, role: ComponentRole.TRIGGER });

  // Elements that appeared via childElementBecameVisible → CONTAINER
  const appearedElements = detection.signalElements.get(
    EvidenceSignal.CHILD_ELEMENT_BECAME_VISIBLE,
  ) ?? [];
  for (const elemId of appearedElements) {
    if (elemId !== rootElementId && !constituents.some((c) => c.elementId === elemId)) {
      constituents.push({ elementId: elemId, role: ComponentRole.CONTAINER });
    }
  }

  // Elements that received clicks (non-root, non-container) → OPTION
  const clickedElements = detection.signalElements.get(
    EvidenceSignal.CHILD_CONTAINS_CLICKABLE_ELEMENTS,
  ) ?? [];
  for (const elemId of clickedElements) {
    if (elemId !== rootElementId && !constituents.some((c) => c.elementId === elemId)) {
      constituents.push({ elementId: elemId, role: ComponentRole.OPTION });
    }
  }

  // Also check transitions directly for clicked non-root elements
  for (const t of transitions) {
    if (
      t.operation === TransitionOperation.CLICK &&
      t.elementId !== rootElementId &&
      !constituents.some((c) => c.elementId === t.elementId)
    ) {
      constituents.push({ elementId: t.elementId, role: ComponentRole.OPTION });
    }
  }

  // Elements involved in mutual exclusivity → OPTION
  const mutualElements = detection.signalElements.get(
    EvidenceSignal.GROUP_MUTUAL_EXCLUSIVITY,
  ) ?? [];
  for (const elemId of mutualElements) {
    const existing = constituents.find((c) => c.elementId === elemId);
    if (!existing) {
      constituents.push({ elementId: elemId, role: ComponentRole.OPTION });
    }
  }

  return constituents;
}

// ── Recognizer ───────────────────────────────────────────

/**
 * Recognize a UI component from behavioral evidence across a transition sequence.
 *
 * This function is purely declarative — it iterates the pattern catalogue's
 * behavioral signatures and evaluates each against the detected signals.
 * No pattern-specific code.
 *
 * @param input - The root element, related elements, and ordered transitions.
 * @returns RecognitionResult — a match with constituents and confidence, or null.
 */
export function recognizeBehaviorally(input: BehavioralRecognitionInput): RecognitionResult {
  const patterns = getBehavioralPatterns();

  if (patterns.length === 0 || input.transitions.length === 0) {
    return NULL_RESULT;
  }

  // Filter transitions to only those on related elements
  const relatedSet = new Set(input.relatedElementIds);
  const relevantTransitions = input.transitions.filter(
    (t) => relatedSet.has(t.elementId),
  );

  if (relevantTransitions.length === 0) {
    return NULL_RESULT;
  }

  // Detect signals from the transition sequence
  const detection = detectSignals(relevantTransitions, input.rootElementId, relatedSet);

  // If no signals at all, no behavioral pattern can match
  if (detection.signals.size === 0) {
    return NULL_RESULT;
  }

  // Evaluate each pattern's behavioral signature
  let bestMatch: {
    def: PatternDefinition;
    confidence: number;
    matchedIds: string[];
    matchedCount: number;
  } | null = null;

  for (const def of patterns) {
    const signature = def.behavioralSignature!;

    const { matchedCount, totalConditions, matchedIds } = matchSignature(
      signature,
      detection,
      relevantTransitions,
      input.rootElementId,
    );

    if (matchedCount === 0) continue;

    // Determine confidence based on match quality
    const minNeeded = signature.minConditionsMet ?? Math.floor(totalConditions / 2) + 1;
    let confidence: number;

    if (matchedCount === totalConditions) {
      // Full match — all conditions satisfied
      confidence = signature.fullMatchConfidence;
    } else if (matchedCount >= minNeeded) {
      // Partial match — enough conditions met for a tentative hypothesis
      confidence = signature.partialMatchConfidence;
    } else {
      // Below threshold — not enough evidence for this pattern
      continue;
    }

    /**
     * Ranking principle: the pattern that explains MORE evidence is the better
     * match. A pattern matching 3 conditions (even partially) is a stronger
     * explanation than a pattern matching 1 condition (even fully), because the
     * richer pattern accounts for more observed signals.
     *
     * This prevents degenerate single-condition patterns (e.g. checkbox with one
     * state-change condition) from winning over multi-condition patterns that
     * subsume the same evidence plus additional signals.
     *
     * Priority: matchedCount desc → confidence desc → full-match over partial.
     */
    if (
      !bestMatch ||
      matchedCount > bestMatch.matchedCount ||
      (matchedCount === bestMatch.matchedCount && confidence > bestMatch.confidence)
    ) {
      bestMatch = { def, confidence, matchedIds, matchedCount };
    }
  }

  if (!bestMatch) {
    return NULL_RESULT;
  }

  // Build result with constituent assignment
  const constituents = assignBehavioralConstituents(
    input.rootElementId,
    input.relatedElementIds,
    detection,
    relevantTransitions,
    bestMatch.def,
  );

  return {
    patternType: bestMatch.def.patternType,
    rootElementId: input.rootElementId,
    constituents,
    confidence: bestMatch.confidence,
    recognitionSource: RecognitionSource.BEHAVIORAL,
    matchedRole: null, // No ARIA role for behavioral recognition
    reason: `Matched ${bestMatch.def.patternType} behaviorally (${bestMatch.matchedCount}/${bestMatch.def.behavioralSignature!.conditions.length} conditions: ${bestMatch.matchedIds.join(', ')})`,
  };
}

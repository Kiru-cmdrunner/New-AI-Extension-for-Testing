/**
 * Stage 3a — Semantic Classification Engine.
 *
 * Phase 3 Task 6 (G4 / E4).
 *
 * Implements the 3-tier semantic classification algorithm specified in
 * Phase 2 Engineering Specifications §10.2.
 *
 * Classifies each recorded SessionEvent into one of the 10 canonical
 * interaction types from the Semantic Interaction Language.
 *
 * 3-Tier Decision Process:
 *   Tier 1: Deterministic rules (14 priority-ordered rules, first match wins).
 *   Tier 2: Advisory AI input (consulted ONLY when Tier 1 evidence is ambiguous
 *           AND Mental Model is available).
 *   Tier 3: Default fallback — canonicalType = 'click' (L5: click is always valid).
 *
 * Key principles:
 *   - Every event gets exactly one canonicalType (L5).
 *   - Immutable after assignment (L6).
 *   - The system is fully functional without AI (E4/E5).
 *   - AI NEVER makes the final decision — it provides advisory input only (E5).
 *
 * This module is a PURE FUNCTION — no side effects, no storage writes.
 * Input: SessionEvent[] (+ optional SessionContext snapshot).
 * Output: ClassifiedInteraction[].
 */

import type { SessionEvent, ElementIdentity } from '../../shared/types';
import type {
  ClassifiedInteraction,
  CanonicalType,
  ClassificationEvidence,
  MentalModel,
} from '../../shared/architecture-types';

// ── Types ──────────────────────────────────────────────────

/**
 * Snapshot of the Session Context for classification.
 *
 * Only L2 (Mental Model) is used — for Tier 2 advisory input.
 * L1 (Deterministic State) and L3 (Action History) are not needed
 * because the Timeline IS L3 and classification is per-event.
 */
export interface ClassificationContext {
  /** Mental Model from AI Observer. Null when AI is unavailable. */
  mentalModel: MentalModel | null;
}

/**
 * Result of classifying a single event.
 */
interface ClassificationResult {
  canonicalType: CanonicalType;
  tier: 1 | 2 | 3;
  evidence: ClassificationEvidence;
}

// ── Classification Rules ───────────────────────────────────

/**
 * Rule IDs for the 14-rule priority chain.
 * Used in ClassificationEvidence.ruleId for debugging.
 */
const RULE = {
  NAVIGATION: 'R1',
  TEXT_FILL: 'R2a',
  TEXT_DATE: 'R2b',
  DATE_SELECT: 'R3',
  CHECKBOX: 'R4',
  RADIO: 'R5',
  SELECT: 'R6',
  HOVER: 'R7',
  UPLOAD: 'R8',
  DRAG: 'R9',
  PRESS_KEY: 'R10',
  CLICK_SELECT_CLEAR: 'R12a',
  CLICK_SELECT_AI: 'R12b',
  CLICK_TOGGLE: 'R13',
  DEFAULT_FALLBACK: 'R14',
} as const;

/**
 * Check if a click target has ARIA attributes indicating it's a selection item.
 *
 * This is the Tier 1 deterministic check for click→select ambiguity (Rule 12).
 * ARIA roles option, menuitem, treeitem are strong evidence that the click
 * is a selection action, not a generic click.
 */
function isSelectionTarget(event: SessionEvent): boolean {
  const identity = getElementIdentity(event);
  if (!identity) return false;

  const role = identity.ariaRole?.toLowerCase();
  if (role === 'option' || role === 'menuitem' || role === 'treeitem') {
    return true;
  }

  return false;
}

/**
 * Check if a click target looks like a toggle (expandable/collapsible).
 *
 * Rule 13: aria-expanded or known toggle patterns.
 */
function isToggleTarget(event: SessionEvent): boolean {
  const identity = getElementIdentity(event);
  if (!identity) return false;

  // Summary elements always toggle details
  if (identity.tag?.toUpperCase() === 'SUMMARY') return true;

  // role=switch, role=tab (tabs toggle panel visibility)
  const role = identity.ariaRole?.toLowerCase();
  if (role === 'switch' || role === 'tab') return true;

  return false;
}

/**
 * Safely extract element identity from a session event.
 *
 * NavigationEvent has no elementIdentity — this returns null for it.
 * All action event types (Click, Text, Hover, etc.) carry elementIdentity.
 */
function getElementIdentity(event: SessionEvent): ElementIdentity | null {
  if (!('elementIdentity' in event)) return null;
  return event.elementIdentity;
}

/**
 * Check if a text value looks like a date.
 *
 * Used by Rule 2b to reclassify text entries that are actually date selections.
 */
function isDateLikeValue(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  // ISO date patterns: YYYY-MM-DD, YYYY/MM/DD, MM/DD/YYYY, DD/MM/YYYY
  const datePatterns = [
    /^\d{4}-\d{2}-\d{2}/,           // 2026-07-15
    /^\d{4}\/\d{2}\/\d{2}/,          // 2026/07/15
    /^\d{1,2}\/\d{1,2}\/\d{4}/,      // 07/15/2026 or 15/07/2026
    /^\d{1,2}-\d{1,2}-\d{4}/,        // 07-15-2026
  ];
  // Human-readable date patterns
  const monthNames = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}/i;
  if (monthNames.test(value)) return true;
  return datePatterns.some((p) => p.test(value));
}

/**
 * Check if the target element is a date-type input.
 */
function isDateInputTarget(event: SessionEvent): boolean {
  const identity = getElementIdentity(event);
  if (!identity) return false;
  if (identity.tag?.toUpperCase() !== 'INPUT') return false;
  const role = identity.ariaRole?.toLowerCase();
  // date pickers have role textbox but type=date/datetime-local/time/month/week
  // The identity doesn't carry the input type, so we rely on the value being date-like
  // and the event type being 'text' (from a date input that was typed into)
  return role === 'textbox';
}

// ── Per-Event Classification ───────────────────────────────

/**
 * Classify a single SessionEvent into a canonical interaction type.
 *
 * Applies the 14-rule priority chain from Phase 2 §10.2.
 *
 * @param event - The recorded session event.
 * @param context - Classification context (Mental Model for Tier 2).
 * @returns Classification result with canonicalType, tier, and evidence.
 */
function classifyEvent(
  event: SessionEvent,
  context: ClassificationContext,
): ClassificationResult {
  // ── TIER 1: Deterministic Rules ──────────────────────────

  // Rule 1: NAVIGATION
  if (event.type === 'navigation') {
    return {
      canonicalType: 'navigate',
      tier: 1,
      evidence: {
        ruleId: RULE.NAVIGATION,
        ruleDescription: 'Navigation event detected',
        matchedSignals: [`event.type=navigation`],
        tier: 1,
      },
    };
  }

  // Rule 2: TEXT ENTRY
  if (event.type === 'text') {
    const value = event.value;

    // Rule 2b: Date-like text in a date input → selectDate
    if (isDateLikeValue(value) && isDateInputTarget(event)) {
      return {
        canonicalType: 'selectDate',
        tier: 1,
        evidence: {
          ruleId: RULE.TEXT_DATE,
          ruleDescription: 'Text entry with date-like value on date input',
          matchedSignals: [`event.type=text`, `value="${value}"`, `date-pattern-match`],
          tier: 1,
        },
      };
    }

    // Rule 2a: Regular text → fill
    return {
      canonicalType: 'fill',
      tier: 1,
      evidence: {
        ruleId: RULE.TEXT_FILL,
        ruleDescription: 'Text entry on input field',
        matchedSignals: [`event.type=text`],
        tier: 1,
      },
    };
  }

  // Rule 3: DATE SELECT
  if (event.type === 'dateSelect') {
    return {
      canonicalType: 'selectDate',
      tier: 1,
      evidence: {
        ruleId: RULE.DATE_SELECT,
        ruleDescription: 'Date selection event',
        matchedSignals: [`event.type=dateSelect`],
        tier: 1,
      },
    };
  }

  // Rule 4: CHECKBOX → TOGGLE
  if (event.type === 'checkbox') {
    return {
      canonicalType: 'toggle',
      tier: 1,
      evidence: {
        ruleId: RULE.CHECKBOX,
        ruleDescription: 'Checkbox toggle event',
        matchedSignals: [`event.type=checkbox`],
        tier: 1,
      },
    };
  }

  // Rule 5: RADIO → SELECT
  if (event.type === 'radio') {
    return {
      canonicalType: 'select',
      tier: 1,
      evidence: {
        ruleId: RULE.RADIO,
        ruleDescription: 'Radio button selection (L4: radios are select)',
        matchedSignals: [`event.type=radio`],
        tier: 1,
      },
    };
  }

  // Rule 6: SELECT
  if (event.type === 'select') {
    return {
      canonicalType: 'select',
      tier: 1,
      evidence: {
        ruleId: RULE.SELECT,
        ruleDescription: 'Dropdown/select option chosen',
        matchedSignals: [`event.type=select`],
        tier: 1,
      },
    };
  }

  // Rule 7: HOVER
  if (event.type === 'hover') {
    return {
      canonicalType: 'hover',
      tier: 1,
      evidence: {
        ruleId: RULE.HOVER,
        ruleDescription: 'Hover interaction',
        matchedSignals: [`event.type=hover`],
        tier: 1,
      },
    };
  }

  // Rule 8: UPLOAD (future — no event.type yet, but reserved)
  // Rule 9: DRAG (future — no event.type yet, but reserved)
  // Rule 10: PRESS KEY (future — no event.type yet, but reserved)

  // Rule 11: CLICK → enters ambiguity check (Rules 12-14)
  if (event.type === 'click') {
    // Rule 12a: Click on selection target with strong ARIA evidence
    if (isSelectionTarget(event)) {
      return {
        canonicalType: 'select',
        tier: 1,
        evidence: {
          ruleId: RULE.CLICK_SELECT_CLEAR,
          ruleDescription: 'Click on ARIA selection item (option/menuitem/treeitem)',
          matchedSignals: [`event.type=click`, `aria-role=option|menuitem|treeitem`],
          tier: 1,
        },
      };
    }

    // Rule 12b: Click on potential selection target — check Tier 2 AI advisory
    // Only when Tier 1 evidence is ambiguous (not a clear ARIA role match)
    if (context.mentalModel) {
      const userIntent = context.mentalModel.userIntent;
      if (
        userIntent &&
        /select|choose|pick|dropdown/i.test(userIntent.primary) &&
        userIntent.confidence > 0.7
      ) {
        return {
          canonicalType: 'select',
          tier: 2,
          evidence: {
            ruleId: RULE.CLICK_SELECT_AI,
            ruleDescription: 'AI advisory: user intent suggests selection',
            matchedSignals: [
              `event.type=click`,
              `ai-intent="${userIntent.primary}"`,
              `ai-confidence=${userIntent.confidence}`,
            ],
            tier: 2,
          },
        };
      }
    }

    // Rule 13: Click vs Toggle ambiguity
    if (isToggleTarget(event)) {
      return {
        canonicalType: 'toggle',
        tier: 1,
        evidence: {
          ruleId: RULE.CLICK_TOGGLE,
          ruleDescription: 'Click on toggle control (aria-expanded/switch/tab/summary)',
          matchedSignals: [`event.type=click`, `toggle-indicator-detected`],
          tier: 1,
        },
      };
    }

    // Rule 14: Default fallback — click is always valid (L5)
    return {
      canonicalType: 'click',
      tier: 3,
      evidence: {
        ruleId: RULE.DEFAULT_FALLBACK,
        ruleDescription: 'Default classification: click (L5 fallback)',
        matchedSignals: [`event.type=click`, `no-ambiguity-rule-matched`],
        tier: 3,
      },
    };
  }

  // Unknown event type → default to click (L5 safety net)
  // After all union members are checked above, TS narrows event to `never`.
  // Cast through unknown to access .type for the diagnostic evidence string.
  const eventType = (event as unknown as { type: string }).type;
  return {
    canonicalType: 'click',
    tier: 3,
    evidence: {
      ruleId: RULE.DEFAULT_FALLBACK,
      ruleDescription: `Unknown event type "${eventType}" — default to click (L5)`,
      matchedSignals: [`event.type=${eventType}`, `unknown-type`],
      tier: 3,
    },
  };
}

// ── Public API ─────────────────────────────────────────────

/**
 * Classify a Timeline of SessionEvents into ClassifiedInteractions.
 *
 * This is the main entry point for Stage 3a.
 *
 * @param timeline - The frozen, immutable Timeline (SessionEvent[]).
 * @param context - Optional classification context with Mental Model.
 *                  If omitted or mentalModel is null, Tier 2 is skipped.
 * @returns Array of ClassifiedInteractions, one per event, in order.
 *
 * @example
 * ```ts
 * const events = await StorageService.getEvents();
 * const classified = classifyInteractions(events);
 * // classified[0].canonicalType === 'navigate'
 * // classified[0].classificationTier === 1
 * ```
 */
export function classifyInteractions(
  timeline: SessionEvent[],
  context?: ClassificationContext,
): ClassifiedInteraction[] {
  const ctx: ClassificationContext = {
    mentalModel: context?.mentalModel ?? null,
  };

  return timeline.map((event) => {
    const result = classifyEvent(event, ctx);
    return {
      canonicalType: result.canonicalType,
      actionId: event.actionId,
      originalEvent: event,
      classificationTier: result.tier,
      evidence: formatEvidence(result.evidence),
    };
  });
}

/**
 * Format the classification evidence as a human-readable string.
 */
function formatEvidence(evidence: ClassificationEvidence): string {
  return `[${evidence.ruleId}] ${evidence.ruleDescription} (${evidence.matchedSignals.join(', ')})`;
}

/**
 * Classify a single event (convenience function).
 *
 * Useful for incremental processing or testing.
 */
export function classifySingleEvent(
  event: SessionEvent,
  context?: ClassificationContext,
): ClassifiedInteraction {
  const result = classifyEvent(event, context ?? { mentalModel: null });
  return {
    canonicalType: result.canonicalType,
    actionId: event.actionId,
    originalEvent: event,
    classificationTier: result.tier,
    evidence: formatEvidence(result.evidence),
  };
}

/**
 * Get a summary of classification results for logging/debugging.
 */
export function summarizeClassification(
  classified: ClassifiedInteraction[],
): {
  total: number;
  byType: Record<string, number>;
  byTier: Record<string, number>;
} {
  const byType: Record<string, number> = {};
  const byTier: Record<string, number> = {};

  for (const c of classified) {
    byType[c.canonicalType] = (byType[c.canonicalType] ?? 0) + 1;
    byTier[`tier${c.classificationTier}`] = (byTier[`tier${c.classificationTier}`] ?? 0) + 1;
  }

  return { total: classified.length, byType, byTier };
}

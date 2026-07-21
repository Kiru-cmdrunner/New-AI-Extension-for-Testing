/**
 * Multi-Tier Semantic Classifier — the core intellectual component of Architecture C.
 *
 * Takes an InteractionSnapshot (with optional AI advisory and session context)
 * and returns a ClassifiedInteraction with a canonical type and structured
 * evidence trail.
 *
 * Three-tier rule engine:
 *   Tier 1 (R1–R6):  Strong deterministic evidence (native elements, ARIA roles)
 *   Tier 2 (R7–R14): Behavioral evidence (value changes, state changes, DOM context)
 *   Tier 3 (R15–R16): AI advisory + default fallback
 *
 * First match wins within each tier. Tiers evaluated sequentially.
 * Evidence Sovereignty (AP4): Tier 1/2 always overrides Tier 3.
 *
 * Architecture: .drytis/architecture-c-production.md §6
 * Types: src/shared/evidence-types.ts
 * Constants: src/shared/classifier-constants.ts
 */

import type {
  InteractionSnapshot,
  ClassifyInput,
  ClassifyOutput,
  ClassificationResult,
  AIIntentResult,
} from '../../shared/evidence-types';
import type { ClassificationEvidence } from '../../shared/architecture-types';
import {
  RULE,
  RULE_DESCRIPTIONS,
  DWELL_THRESHOLD,
  AI_CONFIDENCE_THRESHOLD,
  DETERMINISTIC_CONFIDENCE_HIGH,
  TIER_1_MIN_CONFIDENCE,
  CONFIDENCE_MAX,
  FALLBACK_CONFIDENCE,
  TOGGLE_ROLES,
  RADIO_ROLES,
  OPTION_ROLES,
  MENU_ITEM_ROLES,
  TEXT_INPUT_TYPES,
  NATIVE_DATE_INPUT_TYPES,
} from '../../shared/classifier-constants';

// ── Tier 1: Strong Deterministic Evidence ─────────────────
//
// These rules use unambiguous DOM evidence. They are always authoritative.
// If a Tier 1 rule matches, the classification is final — AI cannot override.

/**
 * R1: Navigation event.
 * Trigger: primaryEvent.type === 'navigation'
 */
function rule1_navigate(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'navigation') return null;

  return {
    canonicalType: 'navigate',
    confidence: CONFIDENCE_MAX,
    tier: 1,
    evidence: {
      ruleId: RULE.NAVIGATE,
      ruleDescription: RULE_DESCRIPTIONS[RULE.NAVIGATE],
      matchedSignals: ['primaryEvent.type=navigation'],
      tier: 1,
    },
  };
}

/**
 * R2: Text entry with value change on input/textarea.
 * Trigger: primaryEvent.type === 'blur' (text entry completes on blur)
 *          AND value changed AND element is a text-like input
 *          AND value is NOT date-like (that's R7's domain)
 */
function rule2_textEntry(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'blur') return null;
  if (!snapshot.valueChange) return null;
  if (!snapshot.valueChange.after) return null;

  const tag = snapshot.identity.tag?.toLowerCase();
  if (tag !== 'input' && tag !== 'textarea') return null;

  // textarea always produces text entry
  const inputType = snapshot.valueChange.inputType.toLowerCase();
  const isTextType = tag === 'textarea' || TEXT_INPUT_TYPES.includes(inputType);
  if (!isTextType) return null;

  // If the value is date-like, defer to R7 (date value outcome)
  if (snapshot.valueChange.isDateLike) return null;

  return {
    canonicalType: 'fill',
    confidence: TIER_1_MIN_CONFIDENCE,
    tier: 1,
    evidence: {
      ruleId: RULE.TEXT_ENTRY,
      ruleDescription: RULE_DESCRIPTIONS[RULE.TEXT_ENTRY],
      matchedSignals: [
        `primaryEvent.type=blur`,
        `valueChange.after="${snapshot.valueChange.after}"`,
        `tag=${tag}`,
        `inputType=${inputType}`,
      ],
      tier: 1,
    },
  };
}

/**
 * R3: Native date/time input change.
 * Trigger: primaryEvent.type === 'change' AND element is input with native date type
 */
function rule3_nativeDateInput(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'change') return null;

  const tag = snapshot.identity.tag?.toLowerCase();
  if (tag !== 'input') return null;

  // Check input type from valueChange or identity
  const inputType = snapshot.valueChange?.inputType?.toLowerCase() ?? '';
  if (!NATIVE_DATE_INPUT_TYPES.includes(inputType)) return null;

  return {
    canonicalType: 'selectDate',
    confidence: CONFIDENCE_MAX,
    tier: 1,
    evidence: {
      ruleId: RULE.NATIVE_DATE_INPUT,
      ruleDescription: RULE_DESCRIPTIONS[RULE.NATIVE_DATE_INPUT],
      matchedSignals: [
        `primaryEvent.type=change`,
        `tag=input`,
        `inputType=${inputType}`,
      ],
      tier: 1,
    },
  };
}

/**
 * R4: Native <select> element change.
 * Trigger: primaryEvent.type === 'change' AND element is a <select>
 */
function rule4_nativeSelect(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'change') return null;

  const tag = snapshot.identity.tag?.toLowerCase();
  if (tag !== 'select') return null;

  return {
    canonicalType: 'select',
    confidence: CONFIDENCE_MAX,
    tier: 1,
    evidence: {
      ruleId: RULE.NATIVE_SELECT,
      ruleDescription: RULE_DESCRIPTIONS[RULE.NATIVE_SELECT],
      matchedSignals: [
        `primaryEvent.type=change`,
        `tag=select`,
        `valueChange.after="${snapshot.valueChange?.after ?? ''}"`,
      ],
      tier: 1,
    },
  };
}

/**
 * R5: Checkbox/switch state change with toggle role.
 * Trigger: stateChange exists AND element has checkbox/switch/menuitemcheckbox role
 */
function rule5_checkboxToggle(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (!snapshot.stateChange) return null;

  const role = snapshot.ariaAttributes.role?.toLowerCase() ?? '';
  if (!TOGGLE_ROLES.includes(role)) return null;

  return {
    canonicalType: 'toggle',
    confidence: TIER_1_MIN_CONFIDENCE,
    tier: 1,
    evidence: {
      ruleId: RULE.CHECKBOX_TOGGLE,
      ruleDescription: RULE_DESCRIPTIONS[RULE.CHECKBOX_TOGGLE],
      matchedSignals: [
        `stateChange.${snapshot.stateChange.property}=${snapshot.stateChange.before}→${snapshot.stateChange.after}`,
        `ariaRole=${role}`,
      ],
      tier: 1,
    },
  };
}

/**
 * R6: Radio state change with radio role.
 * Trigger: stateChange exists AND element has radio/menuitemradio role
 */
function rule6_radioSelect(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (!snapshot.stateChange) return null;

  const role = snapshot.ariaAttributes.role?.toLowerCase() ?? '';
  if (!RADIO_ROLES.includes(role)) return null;

  return {
    canonicalType: 'select',
    confidence: TIER_1_MIN_CONFIDENCE,
    tier: 1,
    evidence: {
      ruleId: RULE.RADIO_SELECT,
      ruleDescription: RULE_DESCRIPTIONS[RULE.RADIO_SELECT],
      matchedSignals: [
        `stateChange.${snapshot.stateChange.property}=${snapshot.stateChange.before}→${snapshot.stateChange.after}`,
        `ariaRole=${role}`,
      ],
      tier: 1,
    },
  };
}

// ── Tier 2: Behavioral Evidence ───────────────────────────
//
// These rules use computed behavioral evidence from the snapshot.
// They handle cases where the element lacks clear ARIA roles but its
// behavior reveals its type.

/**
 * R7: Value changed to a date-like format.
 * Trigger: valueChange exists AND valueChange.isDateLike === true
 */
function rule7_dateValueOutcome(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (!snapshot.valueChange) return null;
  if (!snapshot.valueChange.isDateLike) return null;

  return {
    canonicalType: 'selectDate',
    confidence: 0.90,
    tier: 2,
    evidence: {
      ruleId: RULE.DATE_VALUE_OUTCOME,
      ruleDescription: RULE_DESCRIPTIONS[RULE.DATE_VALUE_OUTCOME],
      matchedSignals: [
        `valueChange.after="${snapshot.valueChange.after}"`,
        `isDateLike=true`,
      ],
      tier: 2,
    },
  };
}

/**
 * R8: Click within a calendar/grid ancestor context.
 * Trigger: primaryEvent.type === 'click' AND hasCalendarAncestor
 */
function rule8_dateCalendarContext(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;
  if (!snapshot.ancestorContext.hasCalendarAncestor) return null;

  return {
    canonicalType: 'selectDate',
    confidence: 0.85,
    tier: 2,
    evidence: {
      ruleId: RULE.DATE_CALENDAR_CONTEXT,
      ruleDescription: RULE_DESCRIPTIONS[RULE.DATE_CALENDAR_CONTEXT],
      matchedSignals: [
        `primaryEvent.type=click`,
        `hasCalendarAncestor=true`,
        `ancestorRoles=[${snapshot.ancestorContext.roles.join(',')}]`,
      ],
      tier: 2,
    },
  };
}

/**
 * R9: Click on ARIA option within listbox/combobox.
 * Trigger: primaryEvent.type === 'click' AND role=option/treeitem AND listbox ancestor
 */
function rule9_ariaOptionInListbox(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;

  const role = snapshot.ariaAttributes.role?.toLowerCase() ?? '';
  if (!OPTION_ROLES.includes(role)) return null;
  if (!snapshot.ancestorContext.hasListboxAncestor) return null;

  return {
    canonicalType: 'select',
    confidence: 0.90,
    tier: 2,
    evidence: {
      ruleId: RULE.ARIA_OPTION_IN_LISTBOX,
      ruleDescription: RULE_DESCRIPTIONS[RULE.ARIA_OPTION_IN_LISTBOX],
      matchedSignals: [
        `primaryEvent.type=click`,
        `ariaRole=${role}`,
        `hasListboxAncestor=true`,
      ],
      tier: 2,
    },
  };
}

/**
 * R10: Click on ARIA menuitem within menu.
 * Trigger: primaryEvent.type === 'click' AND role=menuitem AND menu ancestor
 */
function rule10_ariaMenuItemInMenu(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;

  const role = snapshot.ariaAttributes.role?.toLowerCase() ?? '';
  if (!MENU_ITEM_ROLES.includes(role)) return null;
  if (!snapshot.ancestorContext.hasMenuAncestor) return null;

  return {
    canonicalType: 'select',
    confidence: 0.85,
    tier: 2,
    evidence: {
      ruleId: RULE.ARIA_MENUITEM_IN_MENU,
      ruleDescription: RULE_DESCRIPTIONS[RULE.ARIA_MENUITEM_IN_MENU],
      matchedSignals: [
        `primaryEvent.type=click`,
        `ariaRole=${role}`,
        `hasMenuAncestor=true`,
      ],
      tier: 2,
    },
  };
}

/**
 * R11: Segmented control — aria-pressed toggle in a mutually exclusive group.
 * Trigger: primaryEvent.type === 'click' AND stateChange on aria-pressed
 */
function rule11_segmentedControl(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;

  if (!snapshot.stateChange) return null;
  if (snapshot.stateChange.property !== 'aria-pressed') return null;

  return {
    canonicalType: 'select',
    confidence: 0.80,
    tier: 2,
    evidence: {
      ruleId: RULE.SEGMENTED_CONTROL,
      ruleDescription: RULE_DESCRIPTIONS[RULE.SEGMENTED_CONTROL],
      matchedSignals: [
        `primaryEvent.type=click`,
        `stateChange.aria-pressed=${snapshot.stateChange.before}→${snapshot.stateChange.after}`,
      ],
      tier: 2,
    },
  };
}

/**
 * R12: CSS class differential — selection-related class appeared.
 * Trigger: primaryEvent.type === 'click' AND classChange.selectionPattern
 */
function rule12_cssClassDifferential(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;
  if (!snapshot.classChange) return null;
  if (!snapshot.classChange.selectionPattern) return null;

  return {
    canonicalType: 'select',
    confidence: 0.70,
    tier: 2,
    evidence: {
      ruleId: RULE.CSS_CLASS_DIFFERENTIAL,
      ruleDescription: RULE_DESCRIPTIONS[RULE.CSS_CLASS_DIFFERENTIAL],
      matchedSignals: [
        `primaryEvent.type=click`,
        `classChange.added=[${snapshot.classChange.added.join(',')}]`,
        `selectionPattern=true`,
      ],
      tier: 2,
    },
  };
}

/**
 * R13: Toggle indicator — element has aria-expanded, summary, or tab role.
 * Trigger: primaryEvent.type === 'click' AND element has toggle indicator
 */
function rule13_toggleIndicator(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;

  const role = snapshot.ariaAttributes.role?.toLowerCase() ?? '';
  const hasExpanded = snapshot.ariaAttributes.ariaExpanded !== null;
  const isSummary = snapshot.identity.tag?.toLowerCase() === 'summary';
  const isTab = role === 'tab';

  const signals: string[] = [];
  if (hasExpanded) signals.push(`aria-expanded=${snapshot.ariaAttributes.ariaExpanded}`);
  if (isSummary) signals.push('tag=summary');
  if (isTab) signals.push('ariaRole=tab');

  if (signals.length === 0) return null;

  return {
    canonicalType: 'toggle',
    confidence: 0.75,
    tier: 2,
    evidence: {
      ruleId: RULE.TOGGLE_INDICATOR,
      ruleDescription: RULE_DESCRIPTIONS[RULE.TOGGLE_INDICATOR],
      matchedSignals: [
        `primaryEvent.type=click`,
        ...signals,
      ],
      tier: 2,
    },
  };
}

/**
 * R14: Hover — dwell time + observable DOM change.
 * Trigger: primaryEvent.type === 'mouseenter' AND dwellTime ≥ threshold
 *          AND (visibility changes OR childList changes)
 */
function rule14_hoverDwellMutation(snapshot: InteractionSnapshot): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'mouseenter') return null;

  const dwellTime = snapshot.dwellTime ?? 0;
  if (dwellTime < DWELL_THRESHOLD) return null;

  const hasMutation = (snapshot.domMutations?.visibilityChanges ?? 0) > 0 ||
                      (snapshot.domMutations?.childListChanges ?? 0) > 0;
  if (!hasMutation) return null;

  return {
    canonicalType: 'hover',
    confidence: 0.85,
    tier: 2,
    evidence: {
      ruleId: RULE.HOVER_DWELL_MUTATION,
      ruleDescription: RULE_DESCRIPTIONS[RULE.HOVER_DWELL_MUTATION],
      matchedSignals: [
        `primaryEvent.type=mouseenter`,
        `dwellTime=${dwellTime}ms (≥${DWELL_THRESHOLD}ms)`,
        `visibilityChanges=${snapshot.domMutations?.visibilityChanges ?? 0}`,
        `childListChanges=${snapshot.domMutations?.childListChanges ?? 0}`,
      ],
      tier: 2,
    },
  };
}

// ── Tier 3: AI Advisory + Default Fallback ────────────────

/**
 * R15: AI advisory — ambiguous click upgraded by high-confidence AI.
 * Trigger: primaryEvent.type === 'click' AND AI result available
 *          AND AI confidence ≥ threshold
 *          AND no Tier 1/2 rule matched
 */
function rule15_aiAdvisory(
  snapshot: InteractionSnapshot,
  aiResult: AIIntentResult | null | undefined,
): ClassificationResult | null {
  if (snapshot.primaryEvent.type !== 'click') return null;
  if (!aiResult) return null;
  if (aiResult.confidence < AI_CONFIDENCE_THRESHOLD) return null;

  return {
    canonicalType: aiResult.suggestedType,
    confidence: aiResult.confidence,
    tier: 3,
    evidence: {
      ruleId: RULE.AI_ADVISORY,
      ruleDescription: RULE_DESCRIPTIONS[RULE.AI_ADVISORY],
      matchedSignals: [
        `primaryEvent.type=click`,
        `ai.suggestedType=${aiResult.suggestedType}`,
        `ai.confidence=${aiResult.confidence}`,
        `ai.businessName="${aiResult.businessName}"`,
      ],
      tier: 3,
    },
  };
}

/**
 * R16: Default fallback — always matches. Returns 'click' with low confidence.
 */
function rule16_defaultFallback(snapshot: InteractionSnapshot): ClassificationResult {
  const signals: string[] = [
    `primaryEvent.type=${snapshot.primaryEvent.type}`,
    'no-rule-matched',
  ];

  return {
    canonicalType: 'click',
    confidence: FALLBACK_CONFIDENCE,
    tier: 3,
    evidence: {
      ruleId: RULE.DEFAULT_FALLBACK,
      ruleDescription: RULE_DESCRIPTIONS[RULE.DEFAULT_FALLBACK],
      matchedSignals: signals,
      tier: 3,
    },
  };
}

// ── Rule Lists ────────────────────────────────────────────

type RuleFn = (snapshot: InteractionSnapshot, aiResult?: AIIntentResult | null) => ClassificationResult | null;

const tier1Rules: RuleFn[] = [
  rule1_navigate,
  rule2_textEntry,
  rule3_nativeDateInput,
  rule4_nativeSelect,
  rule5_checkboxToggle,
  rule6_radioSelect,
];

const tier2Rules: RuleFn[] = [
  rule7_dateValueOutcome,
  rule8_dateCalendarContext,
  rule9_ariaOptionInListbox,
  rule10_ariaMenuItemInMenu,
  rule11_segmentedControl,
  rule12_cssClassDifferential,
  rule13_toggleIndicator,
  rule14_hoverDwellMutation,
];

// ── Main Classifier Function ──────────────────────────────

/**
 * Classify an InteractionSnapshot into a canonical interaction type.
 *
 * Multi-tier rule engine:
 *   1. Evaluate Tier 1 rules (strong deterministic). First match wins.
 *   2. If no Tier 1 match, evaluate Tier 2 rules (behavioral). First match wins.
 *   3. If no Tier 2 match, evaluate Tier 3 (AI advisory). If AI eligible, use it.
 *   4. If AI not available or below threshold, use default fallback (R16).
 *
 * @param input.snapshot - The interaction snapshot to classify (required)
 * @param input.aiResult - AI advisory result (optional, null when unavailable)
 * @param input.sessionContext - Session context (optional, unused in Phase 1)
 * @returns Classification result with canonical type, confidence, tier, and evidence trail
 */
export function classifySnapshot(input: ClassifyInput): ClassifyOutput {
  const { snapshot, aiResult, sessionContext: _sessionContext } = input;

  // Tier 1: Strong Deterministic Evidence
  for (const rule of tier1Rules) {
    const result = rule(snapshot);
    if (result) {
      return buildOutput(snapshot, result);
    }
  }

  // Tier 2: Behavioral Evidence
  for (const rule of tier2Rules) {
    const result = rule(snapshot);
    if (result) {
      return buildOutput(snapshot, result);
    }
  }

  // Tier 3: AI Advisory
  const aiResult16 = rule15_aiAdvisory(snapshot, aiResult);
  if (aiResult16) {
    return buildOutput(snapshot, aiResult16);
  }

  // Tier 3: Default Fallback (always matches)
  const fallback = rule16_defaultFallback(snapshot);
  return buildOutput(snapshot, fallback);
}

/**
 * Build the ClassifyOutput from a ClassificationResult.
 *
 * Computes the aiEligible flag: true when tier < 3 AND confidence < 0.90.
 * This tells the pipeline whether Phase 2 AI refinement could improve the result.
 */
function buildOutput(
  snapshot: InteractionSnapshot,
  result: ClassificationResult,
): ClassifyOutput {
  const evidence: ClassificationEvidence = {
    ruleId: result.evidence.ruleId,
    ruleDescription: result.evidence.ruleDescription,
    matchedSignals: result.evidence.matchedSignals,
    tier: result.tier,
  };

  return {
    classified: {
      canonicalType: result.canonicalType,
      actionId: snapshot.identity.elementId ?? '',
      originalEvent: {} as never, // populated by the pipeline (Phase 5)
      classificationTier: result.tier,
      evidence,
      // Architecture C extension: reference the source snapshot
      ...({ originalSnapshot: snapshot } as Record<string, unknown>),
    },
    aiEligible: result.tier < 3 && result.confidence < DETERMINISTIC_CONFIDENCE_HIGH,
  };
}

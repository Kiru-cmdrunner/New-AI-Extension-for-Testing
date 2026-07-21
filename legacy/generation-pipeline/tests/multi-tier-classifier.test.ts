/**
 * Unit tests for the Multi-Tier Semantic Classifier.
 *
 * Tests every rule (R1–R16), tier precedence, evidence sovereignty,
 * edge cases, and helper functions. All tests use synthetic
 * InteractionSnapshots — no browser, no DOM, no service worker.
 *
 * Architecture: .drytis/architecture-c-production.md §6
 */

import { describe, it, expect } from 'vitest';
import { classifySnapshot } from '../src/generation/engine/multi-tier-classifier';
import type { InteractionSnapshot, AIIntentResult } from '../src/shared/evidence-types';
import type { ElementIdentity } from '../src/shared/types';
import {
  DWELL_THRESHOLD,
  RULE,
  isDateLikeValue,
  hasSelectionClass,
} from '../src/shared/classifier-constants';

// ── Test Helpers ──────────────────────────────────────────

/** Create a minimal valid ElementIdentity for testing. */
function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test Element',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'div',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    iframeContext: undefined,
    elementId: 'elem-0001',
    ...overrides,
  };
}

/** Create a base InteractionSnapshot with sensible defaults. */
function makeSnapshot(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    identity: makeIdentity(),
    primaryEvent: {
      type: 'click',
      timestamp: '2026-07-17T10:00:00.000Z',
      isTrusted: true,
    },
    secondaryEvents: [],
    ancestorContext: {
      roles: [],
      containerClasses: [],
      hasCalendarAncestor: false,
      hasListboxAncestor: false,
      hasMenuAncestor: false,
      hasDialogAncestor: false,
    },
    ariaAttributes: {
      role: null,
      ariaLabel: null,
      ariaHasPopup: null,
      ariaSelected: null,
      ariaChecked: null,
      ariaPressed: null,
      ariaExpanded: null,
    },
    timestamp: '2026-07-17T10:00:00.000Z',
    ...overrides,
  };
}

/** Create a synthetic AI advisory result. */
function makeAIResult(overrides: Partial<AIIntentResult> = {}): AIIntentResult {
  return {
    suggestedType: 'select',
    businessName: 'Test Element',
    userIntent: 'Select an option',
    confidence: 0.80,
    ...overrides,
  };
}

// ── Tier 1: Strong Deterministic Evidence ─────────────────

describe('Multi-Tier Classifier — Tier 1 (Strong Deterministic)', () => {

  // R1: Navigation
  it('R1: classifies navigation events as navigate', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'navigation', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('navigate');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence).toBeDefined();
    expect(result.classified.evidence.ruleId).toBe(RULE.NAVIGATE);
  });

  // R2: Text entry (blur + value change)
  it('R2: classifies text entry on blur with value change', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'input' }),
      primaryEvent: { type: 'blur', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: 'hello world',
        inputType: 'text',
        isDateLike: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('fill');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.TEXT_ENTRY);
  });

  it('R2: does not classify as text entry when value is date-like (defers to R7)', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'input' }),
      primaryEvent: { type: 'blur', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: '2026-07-18',
        inputType: 'text',
        isDateLike: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    // Should be R7 (date value outcome), not R2 (text entry)
    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.classificationTier).toBe(2);
  });

  // R3: Native date input
  it('R3: classifies native date input change as selectDate', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'input' }),
      primaryEvent: { type: 'change', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: '2026-07-18',
        inputType: 'date',
        isDateLike: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.NATIVE_DATE_INPUT);
  });

  // R4: Native select
  it('R4: classifies native <select> change as select', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'select' }),
      primaryEvent: { type: 'change', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: 'Option 1',
        after: 'Option 2',
        inputType: 'select-one',
        isDateLike: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.NATIVE_SELECT);
  });

  // R5: Checkbox toggle
  it('R5: classifies checkbox state change with checkbox role as toggle', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: 'checkbox',
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: 'true',
        ariaPressed: null,
        ariaExpanded: null,
      },
      stateChange: {
        property: 'checked',
        before: 'false',
        after: 'true',
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('toggle');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.CHECKBOX_TOGGLE);
  });

  // R6: Radio selection
  it('R6: classifies radio state change with radio role as select', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: 'radio',
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: 'true',
        ariaPressed: null,
        ariaExpanded: null,
      },
      stateChange: {
        property: 'aria-checked',
        before: 'false',
        after: 'true',
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.RADIO_SELECT);
  });
});

// ── Tier 2: Behavioral Evidence ───────────────────────────

describe('Multi-Tier Classifier — Tier 2 (Behavioral Evidence)', () => {

  // R7: Date value outcome
  it('R7: classifies date-like value change as selectDate', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: '07/18/2026',
        inputType: 'text',
        isDateLike: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.DATE_VALUE_OUTCOME);
  });

  // R8: Calendar context
  it('R8: classifies click within calendar ancestor as selectDate', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ancestorContext: {
        roles: ['grid'],
        containerClasses: ['calendar'],
        hasCalendarAncestor: true,
        hasListboxAncestor: false,
        hasMenuAncestor: false,
        hasDialogAncestor: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.DATE_CALENDAR_CONTEXT);
  });

  // R9: ARIA option in listbox
  it('R9: classifies click on option in listbox as select', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: 'option',
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: 'true',
        ariaChecked: null,
        ariaPressed: null,
        ariaExpanded: null,
      },
      ancestorContext: {
        roles: ['listbox'],
        containerClasses: [],
        hasCalendarAncestor: false,
        hasListboxAncestor: true,
        hasMenuAncestor: false,
        hasDialogAncestor: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.ARIA_OPTION_IN_LISTBOX);
  });

  // R10: Menu item in menu
  it('R10: classifies click on menuitem in menu as select', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: 'menuitem',
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: null,
        ariaPressed: null,
        ariaExpanded: null,
      },
      ancestorContext: {
        roles: ['menu'],
        containerClasses: [],
        hasCalendarAncestor: false,
        hasListboxAncestor: false,
        hasMenuAncestor: true,
        hasDialogAncestor: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.ARIA_MENUITEM_IN_MENU);
  });

  // R11: Segmented control
  it('R11: classifies aria-pressed state change as select (segmented control)', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      stateChange: {
        property: 'aria-pressed',
        before: 'false',
        after: 'true',
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.SEGMENTED_CONTROL);
  });

  // R12: CSS class differential
  it('R12: classifies click with selection class change as select', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      classChange: {
        added: ['selected', 'highlight'],
        removed: [],
        selectionPattern: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.CSS_CLASS_DIFFERENTIAL);
  });

  // R13: Toggle indicator (aria-expanded)
  it('R13: classifies click on aria-expanded element as toggle', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: null,
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: null,
        ariaPressed: null,
        ariaExpanded: 'true',
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('toggle');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.TOGGLE_INDICATOR);
  });

  // R14: Hover (dwell + mutation)
  it('R14: classifies hover with sufficient dwell time and DOM changes', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'mouseenter', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      dwellTime: DWELL_THRESHOLD + 100, // above threshold
      domMutations: {
        childListChanges: 2,
        attributeChanges: 1,
        visibilityChanges: 1,
        observedWindow: 600,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('hover');
    expect(result.classified.classificationTier).toBe(2);
    expect(result.classified.evidence.ruleId).toBe(RULE.HOVER_DWELL_MUTATION);
  });

  it('R14: does NOT classify as hover when dwell time is below threshold', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'mouseenter', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      dwellTime: DWELL_THRESHOLD - 100, // below threshold
      domMutations: {
        childListChanges: 2,
        attributeChanges: 1,
        visibilityChanges: 1,
        observedWindow: 400,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).not.toBe('hover');
  });
});

// ── Tier 3: AI Advisory + Fallback ────────────────────────

describe('Multi-Tier Classifier — Tier 3 (AI Advisory + Fallback)', () => {

  // R15: AI advisory — high confidence
  it('R15: uses AI advisory when AI confidence ≥ threshold and no T1/T2 match', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      // No ARIA, no state change, no value change, no class change → no T1/T2 match
    });
    const aiResult = makeAIResult({
      suggestedType: 'select',
      confidence: 0.85,
    });
    const result = classifySnapshot({ snapshot, aiResult });

    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(3);
    expect(result.classified.evidence.ruleId).toBe(RULE.AI_ADVISORY);
  });

  // R15: AI below threshold
  it('R15: falls to R16 default when AI confidence < threshold', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
    });
    const aiResult = makeAIResult({
      suggestedType: 'select',
      confidence: 0.50, // below 0.70 threshold
    });
    const result = classifySnapshot({ snapshot, aiResult });

    expect(result.classified.canonicalType).toBe('click');
    expect(result.classified.classificationTier).toBe(3);
    expect(result.classified.evidence.ruleId).toBe(RULE.DEFAULT_FALLBACK);
  });

  // R16: Default fallback (no AI)
  it('R16: returns click fallback when no rules match and no AI', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('click');
    expect(result.classified.classificationTier).toBe(3);
    expect(result.classified.evidence.ruleId).toBe(RULE.DEFAULT_FALLBACK);
  });
});

// ── Tier Precedence ───────────────────────────────────────

describe('Multi-Tier Classifier — Tier Precedence', () => {

  it('Tier 1 wins over Tier 2: checkbox with both state change and class change', () => {
    // Element with checkbox role (T1 R5) AND class change (T2 R12)
    // T1 should fire first
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: 'checkbox',
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: 'true',
        ariaPressed: null,
        ariaExpanded: null,
      },
      stateChange: {
        property: 'checked',
        before: 'false',
        after: 'true',
      },
      classChange: {
        added: ['selected'],
        removed: [],
        selectionPattern: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.classificationTier).toBe(1);
    expect(result.classified.evidence.ruleId).toBe(RULE.CHECKBOX_TOGGLE);
  });

  it('Evidence Sovereignty: Tier 1 select overrides AI saying click', () => {
    // Native <select> change (T1 R4) + AI says click
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'select' }),
      primaryEvent: { type: 'change', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: 'A',
        after: 'B',
        inputType: 'select-one',
        isDateLike: false,
      },
    });
    const aiResult = makeAIResult({
      suggestedType: 'click',
      confidence: 0.90,
    });
    const result = classifySnapshot({ snapshot, aiResult });

    // T1 wins — AI overridden
    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.classificationTier).toBe(1);
  });

  it('Tier 2 wins over Tier 3 AI: calendar context (T2 R8) beats AI saying click', () => {
    // Click in calendar ancestor (T2 R8) + AI says click
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ancestorContext: {
        roles: ['grid'],
        containerClasses: ['calendar'],
        hasCalendarAncestor: true,
        hasListboxAncestor: false,
        hasMenuAncestor: false,
        hasDialogAncestor: false,
      },
    });
    const aiResult = makeAIResult({
      suggestedType: 'click',
      confidence: 0.80,
    });
    const result = classifySnapshot({ snapshot, aiResult });

    // T2 wins — AI overridden
    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.classificationTier).toBe(2);
  });
});

// ── Evidence Trail ────────────────────────────────────────

describe('Multi-Tier Classifier — Evidence Trail', () => {

  it('every Tier 1 result has complete evidence trail', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'navigation', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.evidence.ruleId).toBeDefined();
    expect(result.classified.evidence.ruleId).toBe(RULE.NAVIGATE);
    expect(result.classified.evidence.ruleDescription).toContain('Navigation');
    expect(result.classified.evidence.matchedSignals.length).toBeGreaterThan(0);
    expect(result.classified.evidence.tier).toBe(1);
  });

  it('every Tier 2 result has complete evidence trail', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: '2026-07-18',
        inputType: 'text',
        isDateLike: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.evidence.ruleId).toBe(RULE.DATE_VALUE_OUTCOME);
    expect(result.classified.evidence.ruleDescription).toContain('date');
    expect(result.classified.evidence.matchedSignals.length).toBeGreaterThan(0);
    expect(result.classified.evidence.tier).toBe(2);
  });
});

// ── aiEligible Flag ───────────────────────────────────────

describe('Multi-Tier Classifier — aiEligible Flag', () => {

  it('returns aiEligible=true for low-confidence Tier 2 result', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      classChange: {
        added: ['selected'],
        removed: [],
        selectionPattern: true,
      },
    });
    const result = classifySnapshot({ snapshot });

    // R12 confidence is 0.70, below 0.90 threshold → aiEligible
    expect(result.aiEligible).toBe(true);
  });

  it('returns aiEligible=false for high-confidence Tier 1 result', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'navigation', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
    });
    const result = classifySnapshot({ snapshot });

    // R1 confidence is 0.95, tier 1 → not aiEligible
    expect(result.aiEligible).toBe(false);
  });
});

// ── Helper Function Tests ─────────────────────────────────

describe('Classifier Constants — Helper Functions', () => {

  describe('isDateLikeValue', () => {
    it('detects ISO date format', () => {
      expect(isDateLikeValue('2026-07-18')).toBe(true);
    });

    it('detects US date format', () => {
      expect(isDateLikeValue('07/18/2026')).toBe(true);
    });

    it('rejects non-date strings', () => {
      expect(isDateLikeValue('hello world')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(isDateLikeValue('')).toBe(false);
    });
  });

  describe('hasSelectionClass', () => {
    it('detects "selected" class', () => {
      expect(hasSelectionClass(['selected', 'other'])).toBe(true);
    });

    it('detects "is-active" class', () => {
      expect(hasSelectionClass(['is-active'])).toBe(true);
    });

    it('returns false for non-selection classes', () => {
      expect(hasSelectionClass(['blue', 'large'])).toBe(false);
    });

    it('returns false for empty array', () => {
      expect(hasSelectionClass([])).toBe(false);
    });
  });
});

// ── Edge Cases ────────────────────────────────────────────

describe('Multi-Tier Classifier — Edge Cases', () => {

  it('handles snapshot with minimal fields (no optional evidence)', () => {
    const snapshot = makeSnapshot();
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('click');
    expect(result.classified.classificationTier).toBe(3);
  });

  it('handles snapshot with null ARIA role and no evidence → fallback click', () => {
    const snapshot = makeSnapshot({
      primaryEvent: { type: 'click', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      ariaAttributes: {
        role: null,
        ariaLabel: null,
        ariaHasPopup: null,
        ariaSelected: null,
        ariaChecked: null,
        ariaPressed: null,
        ariaExpanded: null,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('click');
    expect(result.classified.evidence.ruleId).toBe(RULE.DEFAULT_FALLBACK);
  });

  it('handles textarea text entry', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'textarea' }),
      primaryEvent: { type: 'blur', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: 'This is a paragraph.',
        inputType: 'textarea',
        isDateLike: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('fill');
    expect(result.classified.classificationTier).toBe(1);
  });

  it('handles email input entry', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ tag: 'input' }),
      primaryEvent: { type: 'blur', timestamp: '2026-07-17T10:00:00.000Z', isTrusted: true },
      valueChange: {
        before: '',
        after: 'user@example.com',
        inputType: 'email',
        isDateLike: false,
      },
    });
    const result = classifySnapshot({ snapshot });

    expect(result.classified.canonicalType).toBe('fill');
    expect(result.classified.classificationTier).toBe(1);
  });
});

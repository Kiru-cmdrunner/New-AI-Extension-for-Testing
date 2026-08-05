/**
 * Phase 5 — Form and Value Capability Rules Tests
 *
 * Tests for SubmitForm, SelectOption, AdjustValue, and Unclassified fallback.
 * Includes cross-rule conflict tests covering ambiguous cases.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 5)
 */

import { describe, it, expect } from 'vitest';
import { SubmitFormRule } from '../../src/capabilities/rules/submit-form';
import { SelectOptionRule } from '../../src/capabilities/rules/select-option';
import { AdjustValueRule } from '../../src/capabilities/rules/adjust-value';
import { FilterSelectionRule } from '../../src/capabilities/rules/filter-selection';
import { SortSelectionRule } from '../../src/capabilities/rules/sort-selection';
import { ToggleControlRule } from '../../src/capabilities/rules/toggle-control';
import { CapabilityEngine } from '../../src/capabilities/capability-engine';
import type { ExtractedEvidence } from '../../src/capabilities/evidence-extractor';
import type { InteractionType } from '../../src/shared/component-types';
import { makeInteraction } from './phase4-helpers';

// ── Test Evidence Builder ─────────────────────────────────────────────

function makeEvidence(overrides: {
  interactionType?: InteractionType;
  tag?: string;
  ariaRole?: string | null;
  accessibleName?: string;
  isSubmitType?: boolean;
  isSliderLike?: boolean;
  userAdjusted?: boolean;
  isCheckboxLike?: boolean;
  hasContentChange?: boolean;
  hasVisibilityChange?: boolean;
  hasRemoteEffect?: boolean;
  hasStateToggle?: boolean;
  hasExpandCollapse?: boolean;
  netNodeDelta?: number | null;
  keywordMatches?: Array<{ capability: string; matched: string[] }>;
  ancestorRoles?: string[];
  ancestorClasses?: string[];
  urlChangedAfter?: boolean;
  precededByTextEntryOnSameForm?: boolean;
  precededByFormInteraction?: boolean;
  precededByListContext?: boolean;
  hasDirectPropertyEvidence?: boolean;
}): ExtractedEvidence {
  return {
    interactionId: 'int-test-001',
    physical: {
      interactionType: overrides.interactionType ?? 'Click',
      tag: overrides.tag ?? 'BUTTON',
      ariaRole: overrides.ariaRole ?? null,
      accessibleName: overrides.accessibleName ?? 'Test Element',
      href: null,
      isCheckboxLike: overrides.isCheckboxLike ?? false,
      isSliderLike: overrides.isSliderLike ?? false,
      userAdjusted: overrides.userAdjusted ?? false,
      isSubmitType: overrides.isSubmitType ?? false,
      isFileInput: false,
      ancestorRoles: overrides.ancestorRoles ?? [],
      ancestorClasses: overrides.ancestorClasses ?? [],
    },
    behavioral: {
      effects: [],
      hasStateToggle: overrides.hasStateToggle ?? false,
      hasExpandCollapse: overrides.hasExpandCollapse ?? false,
      hasEnableDisable: false,
      hasContentChange: overrides.hasContentChange ?? false,
      hasVisibilityChange: overrides.hasVisibilityChange ?? false,
      hasRemoteEffect: overrides.hasRemoteEffect ?? false,
      hasDirectPropertyEvidence: overrides.hasDirectPropertyEvidence ?? false,
      netNodeDelta: overrides.netNodeDelta ?? null,
    },
    sequence: {
      previousInteractionType: null,
      precededBySamePage: true,
      precededByTextEntryOnSameForm: overrides.precededByTextEntryOnSameForm ?? false,
      urlChangedAfter: overrides.urlChangedAfter ?? false,
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      urlChanged: false,
      nextUrl: null,
      hasNextItemSpecificUrl: false,
      precededByListContext: overrides.precededByListContext ?? false,
      urlPathChangedAfter: false,
      precededByFormInteraction: overrides.precededByFormInteraction ?? overrides.precededByTextEntryOnSameForm ?? false,
      triggerHasItemSpecificHref: false,
    },
    keywords: {
      matches: (overrides.keywordMatches ?? []).map((m) => ({
        capability: m.capability as any,
        matched: m.matched,
      })),
      hasAnyMatch: (overrides.keywordMatches ?? []).length > 0,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────
// SubmitForm Rule
// ────────────────────────────────────────────────────────────────────────

describe('SubmitFormRule', () => {
  const rule = new SubmitFormRule();

  it('Login form: submit keyword + preceded by TextEntry → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Sign In',
      keywordMatches: [{ capability: 'SubmitForm', matched: ['sign in'] }],
      precededByTextEntryOnSameForm: true,
      urlChangedAfter: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('SubmitForm');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(25);
  });

  it('Submit button [type=submit] + preceded by TextEntry + navigation → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'INPUT',
      accessibleName: 'Submit',
      isSubmitType: true,
      precededByTextEntryOnSameForm: true,
      urlChangedAfter: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('high');
  });

  it('Submit keyword + preceded by TextEntry but no navigation → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Save Changes',
      keywordMatches: [{ capability: 'SubmitForm', matched: ['save'] }],
      precededByTextEntryOnSameForm: true,
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('Submit button + preceded by TextEntry + isSubmitType + no keyword → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'INPUT',
      accessibleName: 'Submit',
      isSubmitType: true,
      precededByTextEntryOnSameForm: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    // keyword=0, non-keyword=2 (isSubmitType + precededByTextEntry is not
    // a supporting signal — it's a required gate). Actually: isSubmitType=1,
    // urlChangedAfter=false, contentChange=false → nonKeyword=1 → MEDIUM
    expect(claim!.confidence).toBe('medium');
  });

  it('Submit button without preceding TextEntry → null', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Submit',
      isSubmitType: true,
      precededByTextEntryOnSameForm: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('"Add to Cart" button: no submit keyword, not submit type → null', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Add to Cart',
      precededByTextEntryOnSameForm: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Submit keyword but NOT a Click (e.g., TextEntry) → null', () => {
    const evidence = makeEvidence({
      interactionType: 'TextEntry',
      tag: 'INPUT',
      accessibleName: 'Search',
      keywordMatches: [{ capability: 'SubmitForm', matched: ['search'] }],
      precededByTextEntryOnSameForm: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Checkout button + preceded by TextEntry + keyword "checkout" → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Checkout',
      keywordMatches: [{ capability: 'SubmitForm', matched: ['checkout'] }],
      precededByTextEntryOnSameForm: true,
      urlChangedAfter: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('high');
  });

  it('reason string mentions form submission', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Login',
      keywordMatches: [{ capability: 'SubmitForm', matched: ['login'] }],
      precededByTextEntryOnSameForm: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('form submission');
    expect(claim!.reason).toContain('login');
  });
});

// ────────────────────────────────────────────────────────────────────────
// SelectOption Rule
// ────────────────────────────────────────────────────────────────────────

describe('SelectOptionRule', () => {
  const rule = new SelectOptionRule();

  it('Dropdown + no remote effect + keyword "select" → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Select Country',
      keywordMatches: [{ capability: 'SelectOption', matched: ['select', 'country'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('SelectOption');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(50);
  });

  it('Dropdown + no remote effect + no keyword → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Make',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('Dropdown with remote content-change → null (filter/sort territory)', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Sort by Price',
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 0,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Click interaction → null (not a Dropdown)', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Select',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Avis Ford "Make" dropdown → SelectOption (no remote effect)', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Make',
      keywordMatches: [{ capability: 'SelectOption', matched: ['make'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('high');
    expect(claim!.parameters.target).toBe('Make');
  });

  it('Quantity dropdown (no keyword, no remote effect) → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Qty',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('Dropdown + keyword "quantity" + no remote effect → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Quantity',
      keywordMatches: [{ capability: 'SelectOption', matched: ['quantity'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('high');
  });

  it('reason string describes dropdown selection', () => {
    const evidence = makeEvidence({
      interactionType: 'Dropdown',
      tag: 'SELECT',
      accessibleName: 'Model',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('dropdown selection');
    expect(claim!.reason).toContain('local value change');
  });
});

// ────────────────────────────────────────────────────────────────────────
// AdjustValue Rule
// ────────────────────────────────────────────────────────────────────────

describe('AdjustValueRule', () => {
  const rule = new AdjustValueRule();

  it('Slider + userAdjusted + remote content-change → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Max Price',
      isSliderLike: true,
      userAdjusted: true,
      hasContentChange: true,
      hasRemoteEffect: true,
      keywordMatches: [{ capability: 'AdjustValue', matched: ['price'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('AdjustValue');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(22);
  });

  it('Slider + userAdjusted + no keyword + no remote → MEDIUM', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Volume',
      isSliderLike: true,
      userAdjusted: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('medium');
  });

  it('Slider focus-only (userAdjusted=false) → null', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Volume',
      isSliderLike: true,
      userAdjusted: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Non-slider element (e.g., Click) → null', () => {
    const evidence = makeEvidence({
      interactionType: 'Click',
      tag: 'BUTTON',
      accessibleName: 'Increase Volume',
      userAdjusted: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Spinbutton + userAdjusted + keyword "quantity" → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'DIV',
      ariaRole: 'spinbutton',
      accessibleName: 'Quantity',
      isSliderLike: true,
      userAdjusted: true,
      keywordMatches: [{ capability: 'AdjustValue', matched: ['quantity'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    // keyword=1, non-keyword=1 (physical-type) → HIGH
    expect(claim!.confidence).toBe('high');
  });

  it('Slider + userAdjusted + remote effect but no keyword → HIGH', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Price Range',
      isSliderLike: true,
      userAdjusted: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    // non-keyword = 2 (physical-type + behavioral) → HIGH
    expect(claim!.confidence).toBe('high');
  });

  it('reason string mentions value adjusted', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Volume',
      isSliderLike: true,
      userAdjusted: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('value adjusted');
  });

  it('Slider + userAdjusted + keyword + remote effect → HIGH (full evidence)', () => {
    const evidence = makeEvidence({
      interactionType: 'Slider',
      tag: 'INPUT',
      ariaRole: 'slider',
      accessibleName: 'Max Price',
      isSliderLike: true,
      userAdjusted: true,
      hasRemoteEffect: true,
      keywordMatches: [{ capability: 'AdjustValue', matched: ['price', 'range'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('high');
    expect(claim!.signalStreams.has('keyword')).toBe(true);
    expect(claim!.signalStreams.has('behavioral')).toBe(true);
    expect(claim!.signalStreams.has('physical-type')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Cross-Rule Conflicts
// ────────────────────────────────────────────────────────────────────────

describe('Phase 5 Cross-Rule Conflicts', () => {

  it('Sort dropdown claims SortSelection HIGH, SelectOption does NOT claim', () => {
    // Sort dropdown: remote content-change, sort keyword, delta=0
    // SelectOption: returns null because hasRemoteEffect=true
    const engine = new CapabilityEngine();
    engine.registerRule(new SelectOptionRule());
    engine.registerRule(new SortSelectionRule());

    const interaction = makeInteraction({
      type: 'Dropdown',
      trigger: {
        accessibleName: 'Sort by Price',
        tag: 'SELECT',
        ariaRole: 'listbox',
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [{
        category: 'content-change' as const,
        description: 'results reordered',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: 0,
      }]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('SortSelection');
    expect(results[0].alternatives.some((a) => a.capability === 'SelectOption')).toBe(false);
  });

  it('Plain quantity dropdown: SelectOption claims, no other rule claims', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new SelectOptionRule());
    engine.registerRule(new FilterSelectionRule());
    engine.registerRule(new SortSelectionRule());

    const interaction = makeInteraction({
      type: 'Dropdown',
      trigger: {
        accessibleName: 'Quantity',
        tag: 'SELECT',
        ariaRole: 'listbox',
      },
    });
    // No effects — local value change only
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('SelectOption');
    // "Quantity" matches keyword in the V1 dictionary → HIGH
    expect(results[0].confidence).toBe('high');
  });

  it('Slider with content-change: AdjustValue wins over FilterSelection (by confidence)', () => {
    // Amazon price slider: AdjustValue HIGH (slider + userAdjusted + remote effect)
    // vs FilterSelection: needs filter-specific signal, no keyword/ancestor/delta<0
    const engine = new CapabilityEngine();
    engine.registerRule(new AdjustValueRule());
    engine.registerRule(new FilterSelectionRule());

    const interaction = makeInteraction({
      type: 'Slider',
      trigger: {
        accessibleName: 'Max Price',
        tag: 'INPUT',
        ariaRole: 'slider',
      },
      metadata: { userAdjusted: true },
    });
    const effectsMap = new Map([
      ['int-test-001', [{
        category: 'content-change' as const,
        description: 'results filtered by price',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: -5,
      }]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    // AdjustValue HIGH vs FilterSelection MEDIUM (delta=-5 is filter-specific)
    // HIGH wins
    expect(results[0].capability).toBe('AdjustValue');
    expect(results[0].confidence).toBe('high');
    // FilterSelection should be in alternatives
    expect(results[0].alternatives.some((a) => a.capability === 'FilterSelection')).toBe(true);
  });

  it('Unknown button click: no rule claims → Unclassified', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new SubmitFormRule());
    engine.registerRule(new SelectOptionRule());
    engine.registerRule(new AdjustValueRule());

    const interaction = makeInteraction({
      type: 'Click',
      trigger: {
        accessibleName: 'Some Random Button',
        tag: 'BUTTON',
      },
    });
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('Unclassified');
    expect(results[0].confidence).toBe('low');
    expect(results[0].unclassifiedReason).toBeDefined();
  });

  it('Dropdown that filtered results: FilterSelection wins, SelectOption returns null', () => {
    // Dropdown with content-change + filter keyword + negative delta
    const engine = new CapabilityEngine();
    engine.registerRule(new SelectOptionRule());
    engine.registerRule(new FilterSelectionRule());

    const interaction = makeInteraction({
      type: 'Dropdown',
      trigger: {
        accessibleName: 'Brand Filter',
        tag: 'SELECT',
        ariaRole: 'listbox',
      },
    });
    const effectsMap = new Map([
      ['int-that-filtered', [{
        category: 'content-change' as const,
        description: 'results narrowed',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
        confidence: 'low' as const,
        confidenceBasis: 'structural-inference' as const,
        evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
        netNodeDelta: -8,
      }]],
    ]);
    // Override interactionId to match effectsMap key
    interaction.interactionId = 'int-that-filtered';
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('FilterSelection');
    // SelectOption returned null (hasRemoteEffect=true)
    expect(results[0].alternatives.some((a) => a.capability === 'SelectOption')).toBe(false);
  });

  it('Login flow: TextEntry[username] → SubmitForm[Sign In] via engine', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new SubmitFormRule());

    const textEntryInteraction = makeInteraction({
      interactionId: 'int-text-001',
      type: 'TextEntry',
      trigger: {
        accessibleName: 'Username',
        tag: 'INPUT',
      },
    });
    textEntryInteraction.interactionId = 'int-text-001';

    const submitInteraction = makeInteraction({
      type: 'Click',
      trigger: {
        accessibleName: 'Sign In',
        tag: 'BUTTON',
      },
    });
    submitInteraction.interactionId = 'int-submit-001';

    const results = engine.inferCapabilities(
      [textEntryEntryAdjusted(textEntryInteraction), submitInteraction],
      new Map(),
    );
    // The submit button should be SubmitForm
    const submitResult = results[1];
    expect(submitResult.capability).toBe('SubmitForm');
  });
});

// ── Helper for the login-flow test ────────────────────────────────────

/**
 * The TextEntry interaction needs to appear on the same page before the submit.
 * makeInteraction already sets pageUrl to the same value, so the sequence
 * extraction should detect precededByTextEntryOnSameForm=true for interaction[1].
 */
function textEntryEntryAdjusted(base: ReturnType<typeof makeInteraction>): ReturnType<typeof makeInteraction> {
  return base;
}

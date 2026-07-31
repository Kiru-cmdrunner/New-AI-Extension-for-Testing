/**
 * Unit tests for the evidence-based intent classification engine.
 *
 * Tests each module independently:
 *   1. Evidence generators (aria, behavioral, tag, structural, navigation)
 *   2. Intent inference (fuseEvidence)
 *   3. Type derivation (deriveType)
 *   4. Full pipeline (classifyByEvidence)
 *   5. Regression: existing classifications must not change
 */

import { describe, it, expect } from 'vitest';
import type { FeatureViewInput, IntentVote, SemanticIntent } from '../src/classifier/evidence/types';
import type { ElementIdentity, ElementRecordedEvent } from '../src/recorder/recorded-event';
import { ariaEvidence, behavioralEvidence, tagEvidence, structuralEvidence, navigationEvidence, triggerEvidence } from '../src/classifier/evidence/generators';
import { fuseEvidence } from '../src/classifier/evidence/intent-inference';
import { deriveType, deriveMetadata } from '../src/classifier/evidence/type-deriver';
import { classifyByEvidence } from '../src/classifier/evidence/evidence-classifier';

// ── Test Helpers ─────────────────────────────────────────────────────────

function makeFeatures(overrides: Partial<FeatureViewInput> = {}): FeatureViewInput {
  return {
    tag: 'DIV',
    ariaRole: null,
    accessibleName: null,
    classNameLower: '',
    hasAriaChecked: false,
    hasAriaPressed: false,
    hasCheckedTransition: false,
    checkedBefore: null,
    checkedAfter: null,
    surfaceType: null,
    ancestorRoles: [],
    opensNewTab: false,
    opensNewWindow: false,
    isLink: false,
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-test',
    ...overrides,
  };
}

function makeClickEvent(
  target: ElementIdentity,
  overrides: Partial<ElementRecordedEvent> = {},
): ElementRecordedEvent {
  return {
    eventId: 'evt-test',
    eventType: 'click',
    timestamp: '2026-07-31T08:00:00Z',
    target,
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    ...overrides,
  };
}

// ── 1. Evidence Generators ───────────────────────────────────────────────

describe('Evidence Generators', () => {

  describe('ariaEvidence', () => {
    it('votes toggle +0.8 when hasAriaChecked is true', () => {
      
      const features = makeFeatures({ hasAriaChecked: true });
      const evidence = ariaEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'toggle',
        weight: 0.8,
        source: 'aria-checked',
        reason: 'Element has checkbox role or aria-checked attribute',
      });
    });

    it('votes toggle +0.7 when hasAriaPressed is true', () => {
      
      const features = makeFeatures({ hasAriaPressed: true });
      const evidence = ariaEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'toggle',
        weight: 0.7,
        source: 'aria-pressed',
        reason: 'Button element has pressed/checked state',
      });
    });

    it('produces no evidence when no ARIA signals present', () => {
      
      const features = makeFeatures({ hasAriaChecked: false, hasAriaPressed: false });
      const evidence = ariaEvidence.generate(features);
      expect(evidence).toHaveLength(0);
    });
  });

  describe('behavioralEvidence', () => {
    it('votes toggle +0.6 when hasCheckedTransition is true', () => {
      
      const features = makeFeatures({ hasCheckedTransition: true });
      const evidence = behavioralEvidence.generate(features);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].intent).toBe('toggle');
      expect(evidence[0].weight).toBe(0.6);
      expect(evidence[0].source).toBe('checked-transition');
    });

    it('produces no evidence when no checked transition', () => {
      
      const features = makeFeatures({ hasCheckedTransition: false });
      expect(behavioralEvidence.generate(features)).toHaveLength(0);
    });
  });

  describe('tagEvidence', () => {
    it('votes navigate +0.4 for <a> tags', () => {
      
      const features = makeFeatures({ isLink: true, tag: 'A' });
      const evidence = tagEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'navigate',
        weight: 0.4,
        source: 'tag-anchor',
        reason: 'Element is an <a> tag or has link role',
      });
    });

    it('votes toggle +0.9 for native checkbox input', () => {
      
      const features = makeFeatures({ tag: 'INPUT', ariaRole: 'checkbox' });
      const evidence = tagEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'toggle',
        weight: 0.9,
        source: 'native-checkbox',
        reason: 'Native <input type="checkbox">',
      });
    });

    it('produces no evidence for a plain div', () => {
      
      const features = makeFeatures({ tag: 'DIV', ariaRole: null, isLink: false });
      expect(tagEvidence.generate(features)).toHaveLength(0);
    });
  });

  describe('structuralEvidence', () => {
    it('votes toggle +0.2 for checkbox-like CSS class', () => {
      
      const features = makeFeatures({
        classNameLower: 'a-icon-checkbox',
        isLink: true,
      });
      const evidence = structuralEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'toggle',
        weight: 0.2,
        source: 'class-checkbox',
        reason: 'Element CSS class suggests checkbox/filter pattern',
      });
    });

    it('suppresses navigate -0.2 for checkbox-like CSS class on a link', () => {
      
      const features = makeFeatures({
        classNameLower: 'navigation-item',
        isLink: true,
      });
      const evidence = structuralEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'navigate',
        weight: -0.2,
        source: 'class-checkbox',
        reason: 'Checkbox-like CSS class suppresses navigation intent',
      });
    });

    it('produces no evidence for elements without checkbox patterns', () => {
      
      const features = makeFeatures({ classNameLower: 'btn btn-primary' });
      expect(structuralEvidence.generate(features)).toHaveLength(0);
    });
  });

  describe('navigationEvidence', () => {
    it('votes navigate +0.7 when opensNewTab is true', () => {
      
      const features = makeFeatures({ opensNewTab: true });
      const evidence = navigationEvidence.generate(features);
      expect(evidence[0].intent).toBe('navigate');
      expect(evidence[0].weight).toBe(0.7);
    });

    it('votes navigate +0.7 when opensNewWindow is true', () => {
      
      const features = makeFeatures({ opensNewWindow: true });
      const evidence = navigationEvidence.generate(features);
      expect(evidence[0].intent).toBe('navigate');
      expect(evidence[0].weight).toBe(0.7);
    });

    it('produces no evidence without navigation signals', () => {

      const features = makeFeatures({ opensNewTab: false, opensNewWindow: false });
      expect(navigationEvidence.generate(features)).toHaveLength(0);
    });
  });

  describe('triggerEvidence', () => {
    it('votes trigger +0.3 for BUTTON tag', () => {

      const features = makeFeatures({ tag: 'BUTTON', ariaRole: 'button' });
      const evidence = triggerEvidence.generate(features);
      expect(evidence).toContainEqual({
        intent: 'trigger',
        weight: 0.3,
        source: 'button-element',
        reason: 'Element has button semantics (tag, role, or input type)',
      });
    });

    it('votes trigger +0.3 for role=button on non-button tag', () => {

      const features = makeFeatures({ tag: 'DIV', ariaRole: 'button' });
      const evidence = triggerEvidence.generate(features);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].intent).toBe('trigger');
      expect(evidence[0].weight).toBe(0.3);
    });

    it('votes trigger +0.3 for INPUT with role=button', () => {

      const features = makeFeatures({ tag: 'INPUT', ariaRole: 'button' });
      const evidence = triggerEvidence.generate(features);
      expect(evidence).toHaveLength(1);
      expect(evidence[0].intent).toBe('trigger');
    });

    it('does not vote for links or checkboxes', () => {

      const link = makeFeatures({ tag: 'A', ariaRole: 'link', isLink: true });
      expect(triggerEvidence.generate(link)).toHaveLength(0);

      const checkbox = makeFeatures({ tag: 'INPUT', ariaRole: 'checkbox' });
      expect(triggerEvidence.generate(checkbox)).toHaveLength(0);
    });

    it('does not vote for generic divs', () => {

      const features = makeFeatures({ tag: 'DIV', ariaRole: null });
      expect(triggerEvidence.generate(features)).toHaveLength(0);
    });
  });
});

// ── 2. Intent Inference ─────────────────────────────────────────────────

describe('Intent Inference (fuseEvidence)', () => {
  it('picks toggle over navigate when toggle evidence is stronger', () => {
    
    const evidence: IntentVote[] = [
      { intent: 'toggle', weight: 0.8, source: 'aria-checked', reason: '' },
      { intent: 'toggle', weight: 0.6, source: 'checked-transition', reason: '' },
      { intent: 'navigate', weight: 0.4, source: 'tag-anchor', reason: '' },
    ];
    const result = fuseEvidence(evidence);
    expect(result.intent).toBe('toggle');
    expect(result.confidence).toBe(1.0); // 0.8 + 0.6 = 1.4, capped to 1.0
    expect(result.runnerUp?.intent).toBe('navigate');
  });

  it('picks navigate when navigate evidence is stronger', () => {
    
    const evidence: IntentVote[] = [
      { intent: 'navigate', weight: 0.4, source: 'tag-anchor', reason: '' },
    ];
    const result = fuseEvidence(evidence);
    expect(result.intent).toBe('navigate');
    expect(result.confidence).toBe(0.4);
  });

  it('returns trigger fallback with confidence 0 for empty evidence', () => {
    
    const result = fuseEvidence([]);
    expect(result.intent).toBe('trigger');
    expect(result.confidence).toBe(0);
  });

  it('handles negative evidence correctly', () => {
    
    const evidence: IntentVote[] = [
      { intent: 'navigate', weight: 0.4, source: 'tag-anchor', reason: '' },
      { intent: 'navigate', weight: -0.2, source: 'class-checkbox', reason: '' },
      { intent: 'toggle', weight: 0.2, source: 'class-checkbox', reason: '' },
    ];
    const result = fuseEvidence(evidence);
    expect(result.intent).toBe('navigate'); // 0.4 - 0.2 = 0.2 > toggle's 0.2
    expect(result.confidence).toBe(0.2);
  });

  it('preserves full evidence audit trail', () => {
    
    const evidence: IntentVote[] = [
      { intent: 'toggle', weight: 0.8, source: 'aria-checked', reason: 'test1' },
      { intent: 'navigate', weight: 0.4, source: 'tag-anchor', reason: 'test2' },
    ];
    const result = fuseEvidence(evidence);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0].reason).toBe('test1');
  });
});

// ── 3. Type Derivation ──────────────────────────────────────────────────

describe('Type Derivation (deriveType)', () => {
  it('derives Checkbox from toggle intent', async () => {
    
    const features = makeFeatures({ ariaRole: 'checkbox' });
    expect(deriveType('toggle', features)).toBe('Checkbox');
  });

  it('derives ToggleSwitch from toggle intent with role=switch', async () => {
    
    const features = makeFeatures({ ariaRole: 'switch' });
    expect(deriveType('toggle', features)).toBe('ToggleSwitch');
  });

  it('derives ToggleSwitch from toggle intent with role=button + checked transition', async () => {
    
    const features = makeFeatures({ ariaRole: 'button', hasCheckedTransition: true });
    expect(deriveType('toggle', features)).toBe('ToggleSwitch');
  });

  it('derives Link from navigate intent', async () => {
    
    const features = makeFeatures();
    expect(deriveType('navigate', features)).toBe('Link');
  });

  it('derives Click from trigger intent', async () => {
    
    const features = makeFeatures();
    expect(deriveType('trigger', features)).toBe('Click');
  });
});

// ── 4. Full Pipeline (classifyByEvidence) ───────────────────────────────

describe('Full Pipeline (classifyByEvidence)', () => {
  it('classifies Amazon filter link as Checkbox', async () => {
    
    const target = makeIdentity({
      tag: 'A',
      ariaRole: 'link',
      accessibleName: 'Apply the filter vivo to narrow results',
      className: 'a-link-normal s-navigation-item',
    });
    const clickEvent = makeClickEvent(target, {
      checkedBefore: false,
      checkedAfter: true,
    });
    const result = classifyByEvidence(target, clickEvent);
    expect(result.type).toBe('Checkbox');
    expect(result.metadata.checked).toBe(true);
    expect(result.intent).toBe('toggle');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('classifies plain navigation link as Link', async () => {
    
    const target = makeIdentity({
      tag: 'A',
      ariaRole: 'link',
      accessibleName: "Today's Deals",
      className: 'nav-a',
    });
    const clickEvent = makeClickEvent(target);
    const result = classifyByEvidence(target, clickEvent);
    expect(result.type).toBe('Link');
    expect(result.intent).toBe('navigate');
  });

  it('classifies generic div click as Click', async () => {
    
    const target = makeIdentity({
      tag: 'DIV',
      ariaRole: null,
      accessibleName: 'Submit',
      className: 'btn',
    });
    const clickEvent = makeClickEvent(target);
    const result = classifyByEvidence(target, clickEvent);
    expect(result.type).toBe('Click');
    expect(result.intent).toBe('trigger');
  });

  it('classifies native checkbox input as Checkbox', async () => {
    
    const target = makeIdentity({
      tag: 'INPUT',
      ariaRole: 'checkbox',
      accessibleName: 'I agree',
      className: 'form-check-input',
    });
    const clickEvent = makeClickEvent(target, {
      checkedBefore: false,
      checkedAfter: true,
    });
    const result = classifyByEvidence(target, clickEvent);
    expect(result.type).toBe('Checkbox');
    expect(result.metadata.checked).toBe(true);
  });

  it('classifies role=switch with checked transition as ToggleSwitch', async () => {
    
    const target = makeIdentity({
      tag: 'DIV',
      ariaRole: 'switch',
      accessibleName: 'Dark Mode',
    });
    const clickEvent = makeClickEvent(target, {
      checkedBefore: false,
      checkedAfter: true,
    });
    const result = classifyByEvidence(target, clickEvent);
    expect(result.type).toBe('ToggleSwitch');
    expect(result.metadata.checked).toBe(true);
  });

  it('provides full evidence audit trail', async () => {
    
    const target = makeIdentity({
      tag: 'A',
      ariaRole: 'link',
      className: 'a-icon-checkbox',
    });
    const clickEvent = makeClickEvent(target, {
      checkedBefore: false,
      checkedAfter: true,
    });
    const result = classifyByEvidence(target, clickEvent);
    expect(result.evidence.length).toBeGreaterThan(0);
    // Every evidence item should have source and reason
    for (const e of result.evidence) {
      expect(e.source).toBeTruthy();
      expect(e.reason).toBeTruthy();
    }
  });
});

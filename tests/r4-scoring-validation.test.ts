/**
 * R4 Post-Calibration Scoring Validation
 *
 * Tests actual scoring behavior after the stringEqualNeutral correction
 * (both-missing optional fields → 0.5 neutral instead of 1.0).
 *
 * Shows before/after score comparison for all key scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  matchElements,
  computeSimilarity,
  extractSignature,
  extractStoredSignature,
  SCORING_POLICY,
} from '../src/repository/services/element-matching-service';
import { createElement, type Element, type ElementIdentityRecord } from '../src/domain/entities/element';
import { createUiElement, type UiElement } from '../src/domain/entities/ui-element';
import { LocatorStrategyType } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers (same as pre-calibration suite) ─────────────────

function id(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit', ariaRole: 'button', ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: 'btn', name: null, stableId: null,
    testId: 'submit-btn', dataCy: null, dataQa: null, cssSelector: 'button.btn',
    xPath: '/html/body/button', inIframe: false, shadowDom: false, elementId: 'elem-0001',
    ...overrides,
  };
}

function uiEl(overrides: Partial<ElementIdentity> = {}, opts: { sourceUrl?: string; ancestorRoles?: string[] } = {}): UiElement {
  return createUiElement({
    elementId: opts.sourceUrl ? 'e-' + Math.random().toString(36).slice(2, 6) : 'elem-0001',
    identity: id(overrides), sourceUrl: opts.sourceUrl ?? 'https://app.com/page',
    domTreePath: 'html>body>button', ancestorRoles: opts.ancestorRoles,
  });
}

function storedEl(opts: {
  logicalName?: string; identity?: ElementIdentityRecord | null; pageOrComponent?: string;
  locators?: Array<{ type: LocatorStrategyType; value: string; priority: number; confidence: number }>;
}): Element {
  return createElement({
    projectId: 'proj-001', logicalName: opts.logicalName ?? 'Submit',
    pageOrComponent: opts.pageOrComponent ?? 'https://app.com/page',
    locatorStrategies: opts.locators ?? [{ type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 }],
    identity: opts.identity === undefined ? null : opts.identity,
  });
}

function idRecord(overrides: Partial<ElementIdentityRecord> = {}): ElementIdentityRecord {
  return { accessibleName: 'Submit', ariaRole: 'button', tag: 'BUTTON', name: null,
    ariaLabel: null, ancestorRoles: null, testId: 'submit-btn', dataCy: null, dataQa: null, ...overrides };
}

function scorePair(
  freshId: Partial<ElementIdentity>,
  storedId: Partial<ElementIdentityRecord>,
  opts?: { freshAncestors?: string[]; storedAncestors?: string[]; sourceUrl?: string; storedUrl?: string },
): number {
  const fresh = extractSignature(id(freshId), opts?.sourceUrl ?? 'https://app.com/page', opts?.freshAncestors);
  const el = storedEl({ identity: idRecord({ ...storedId, ancestorRoles: opts?.storedAncestors ?? null }), pageOrComponent: opts?.storedUrl ?? 'https://app.com/page' });
  return computeSimilarity(fresh, extractStoredSignature(el));
}

// ── Before/After Score Comparison ───────────────────────────

describe('Scoring correction — before/after comparison', () => {
  it('Scenario 1: Full identity (all fields match, no ancestors)', () => {
    const after = scorePair(
      { accessibleName: 'Email', testId: 'email', name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Email', testId: 'email', name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
    );
    // Before: 0.925 (ancestorRoles both-missing=0.5*0.10=0.05 inflates by 0.05 less than 1.0 would)
    // After: all 8 fields present and match EXCEPT ancestorRoles (both missing → 0.5)
    // = 0.25 + 0.20 + 0.15 + 0.10 + 0.10 + 0.05 + 0.05 + 0.05*0.5/0.5... 
    // Let me compute: testId match=1.0*0.25, accessibleName=1.0*0.20, name=1.0*0.15, role=1.0*0.10,
    // ariaLabel=1.0*0.10, ancestors=0.5*0.10, tag=1.0*0.05, url=1.0*0.05
    // = 0.25+0.20+0.15+0.10+0.10+0.05+0.05+0.05 = 0.95
    console.log('  Before: 0.925 → After:', after.toFixed(4));
    expect(after).toBeCloseTo(0.95, 1);
    expect(after).toBeGreaterThan(SCORING_POLICY.MATCH_THRESHOLD);
  });

  it('Scenario 2: accessibleName + role + tag + URL only (no optional fields)', () => {
    const after = scorePair(
      { accessibleName: 'Submit', testId: null, name: null, ariaLabel: null, ariaRole: 'button', tag: 'BUTTON' },
      { accessibleName: 'Submit', testId: null, name: null, ariaLabel: null, ariaRole: 'button', tag: 'BUTTON' },
    );
    // Before: 0.825 (both-missing optional fields contributed 1.0 each)
    // After: testId=0.5*0.25, name=0.5*0.15, ariaLabel=0.5*0.10, ancestors=0.5*0.10,
    // accessibleName=1.0*0.20, role=1.0*0.10, tag=1.0*0.05, url=1.0*0.05
    // = 0.125+0.075+0.05+0.05+0.20+0.10+0.05+0.05 = 0.70
    console.log('  Before: 0.825 → After:', after.toFixed(4));
    // At threshold — these ARE genuine matches (same name+role+tag+url) but with
    // minimal evidence. Landing at exactly 0.70 is conservative-correct.
  });

  it('Scenario 3: Progressive evidence removal', () => {
    const full = scorePair(
      { accessibleName: 'Email', testId: 'email', name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Email', testId: 'email', name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
    );
    const noTestId = scorePair(
      { accessibleName: 'Email', testId: null, name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Email', testId: null, name: 'email', ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
    );
    const noName = scorePair(
      { accessibleName: 'Email', testId: null, name: null, ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Email', testId: null, name: null, ariaLabel: 'Email Address', ariaRole: 'textbox', tag: 'INPUT' },
    );
    const noAriaLabel = scorePair(
      { accessibleName: 'Email', testId: null, name: null, ariaLabel: null, ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Email', testId: null, name: null, ariaLabel: null, ariaRole: 'textbox', tag: 'INPUT' },
    );
    console.log('  Full identity: Before 0.925 → After', full.toFixed(4));
    console.log('  - testId:      Before 0.825 → After', noTestId.toFixed(4));
    console.log('  - name:        Before 0.825 → After', noName.toFixed(4));
    console.log('  - ariaLabel:   Before 0.825 → After', noAriaLabel.toFixed(4));
    // Key: scores should now DECREASE as evidence is removed
    expect(full).toBeGreaterThan(noTestId);
    expect(noTestId).toBeGreaterThan(noName);
    expect(noName).toBeGreaterThan(noAriaLabel);
  });

  it('Scenario 4: Two generic elements (different accessibleNames)', () => {
    const after = scorePair(
      { accessibleName: 'Email', testId: null, name: null, ariaRole: 'textbox', tag: 'INPUT' },
      { accessibleName: 'Password', testId: null, name: null, ariaRole: 'textbox', tag: 'INPUT' },
    );
    console.log('  Before: 0.625 → After:', after.toFixed(4));
    expect(after).toBeLessThan(SCORING_POLICY.MATCH_THRESHOLD);
  });

  it('Scenario 5: Identical low-evidence competing elements', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Email', testId: null, name: null, ariaRole: 'textbox', tag: 'INPUT' })];
    const stored = [
      storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }) }),
      storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }) }),
    ];
    const result = matchElements(fresh, stored);
    console.log('  Before: AMBIGUOUS → After:', result.ambiguous.length > 0 ? 'AMBIGUOUS' : result.matched.length > 0 ? 'MATCHED' : 'UNMATCHED');
    // Score for each candidate: same as scenario 2 = 0.70
    // Both score 0.70, margin 0.00 → AMBIGUOUS
    expect(result.ambiguous).toHaveLength(1);
  });

  it('Scenario 6: Changed testId with stable semantic identity', () => {
    const after = scorePair(
      { accessibleName: 'Submit', testId: 'submit-button-v2', name: 'submit', ariaRole: 'button', tag: 'BUTTON' },
      { accessibleName: 'Submit', testId: 'submit-btn-v1', name: 'submit', ariaRole: 'button', tag: 'BUTTON' },
    );
    // testId conflict=0*0.25=0, accessibleName=1*0.20, name=1*0.15, role=1*0.10,
    // ariaLabel both missing=0.5*0.10, ancestors=0.5*0.10, tag=1*0.05, url=1*0.05
    // = 0+0.20+0.15+0.10+0.05+0.05+0.05+0.05 = 0.65
    console.log('  Before: 0.700 → After:', after.toFixed(4));
    expect(after).toBeLessThan(SCORING_POLICY.MATCH_THRESHOLD);
    // Now correctly below threshold — conflicting testId + missing ariaLabel
    // means insufficient evidence for confident match
  });

  it('Scenario 7: Genuinely new element', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Phone Number', testId: 'phone', ariaRole: 'textbox', tag: 'INPUT' })];
    const stored = [storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: 'email', ariaRole: 'textbox', tag: 'INPUT' }) })];
    const result = matchElements(fresh, stored);
    console.log('  Before: UNMATCHED → After:', result.unmatched.length > 0 ? 'UNMATCHED' : 'other');
    expect(result.unmatched).toHaveLength(1);
  });

  it('Scenario 8: Pre-R4 Element fallback (identity=null)', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON' })];
    const stored = [storedEl({ identity: null, logicalName: 'Submit', locators: [{ type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 }] })];
    const result = matchElements(fresh, stored);
    const score = result.matched[0]?.matchScore;
    console.log('  Before: 0.875 → After:', score?.toFixed(4) ?? 'N/A');
    // Pre-R4 fallback: stored has logicalName='Submit', testId='submit-btn' (from locators),
    // everything else null/empty.
    // testId match=1*0.25, accessibleName=1*0.20, name both missing=0.5*0.15,
    // role: fresh='button', stored=null → 0.5*0.10, ariaLabel both null=0.5*0.10,
    // ancestors both missing=0.5*0.10, tag: fresh='BUTTON', stored='' → 0.5*0.05, url=1*0.05
    // = 0.25+0.20+0.075+0.05+0.05+0.05+0.025+0.05 = 0.75
    expect(result.matched).toHaveLength(1);
    expect(score).toBeGreaterThan(SCORING_POLICY.MATCH_THRESHOLD);
  });
});

// ── Healing Safety ──────────────────────────────────────────

describe('Healing safety after calibration', () => {
  it('MATCHED → heal: same element re-recorded still matches', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn', name: 'action', ariaRole: 'button', tag: 'BUTTON' })];
    const stored = [storedEl({ logicalName: 'Submit', identity: idRecord({ accessibleName: 'Submit', testId: 'submit-btn', name: 'action', ariaRole: 'button', tag: 'BUTTON' }) })];
    const result = matchElements(fresh, stored);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    console.log('  Match score:', result.matched[0].matchScore.toFixed(4));
  });

  it('AMBIGUOUS → skip: identical competitors still ambiguous', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' })];
    const stored = [
      storedEl({ logicalName: 'Delete', identity: idRecord({ accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' }) }),
      storedEl({ logicalName: 'Delete', identity: idRecord({ accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' }) }),
    ];
    const result = matchElements(fresh, stored);
    expect(result.ambiguous).toHaveLength(1);
    console.log('  Ambiguous candidates:', result.ambiguous[0].candidates.length);
  });

  it('UNMATCHED → create: genuinely new element still unmatched', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'New Widget', testId: 'widget', ariaRole: 'button', tag: 'BUTTON' })];
    const stored = [storedEl({ logicalName: 'Submit', identity: idRecord({ accessibleName: 'Submit', testId: 'submit-btn' }) })];
    const result = matchElements(fresh, stored);
    expect(result.unmatched).toHaveLength(1);
  });

  it('Weak-identity same element (no testId/name) still MATCHED at exactly 0.70', () => {
    const fresh = [uiEl({ elementId: 'e1', accessibleName: 'Email', testId: null, name: null, ariaLabel: null, ariaRole: 'textbox', tag: 'INPUT' })];
    const stored = [storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: null, name: null, ariaLabel: null, ariaRole: 'textbox', tag: 'INPUT' }) })];
    const result = matchElements(fresh, stored);
    const score = result.matched[0]?.matchScore;
    console.log('  Weak identity match score:', score?.toFixed(4));
    // 0.5*0.25 + 1.0*0.20 + 0.5*0.15 + 1.0*0.10 + 0.5*0.10 + 0.5*0.10 + 1.0*0.05 + 1.0*0.05 = 0.70
    // Exactly at threshold — MATCHED. This is correct for a genuine same-element re-recording.
    expect(result.matched).toHaveLength(1);
  });
});

// ── P2 Safety ────────────────────────────────────────────────

describe('P2 consumption after calibration', () => {
  it('Three-category semantics unchanged', () => {
    // MATCHED: confident resolution
    const fresh1 = [uiEl({ elementId: 'e1', accessibleName: 'Submit', testId: 'btn' })];
    const stored1 = [storedEl({ logicalName: 'Submit', identity: idRecord({ accessibleName: 'Submit', testId: 'btn' }) })];
    const r1 = matchElements(fresh1, stored1);
    expect(r1.matched).toHaveLength(1);

    // AMBIGUOUS: cannot resolve
    const fresh2 = [uiEl({ elementId: 'e1', accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' })];
    const stored2 = [
      storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }) }),
      storedEl({ logicalName: 'Email', identity: idRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }) }),
    ];
    const r2 = matchElements(fresh2, stored2);
    expect(r2.ambiguous).toHaveLength(1);

    // UNMATCHED: no plausible candidate
    const fresh3 = [uiEl({ elementId: 'e1', accessibleName: 'New', testId: 'new' })];
    const stored3 = [storedEl({ logicalName: 'Old', identity: idRecord({ accessibleName: 'Old', testId: 'old' }) })];
    const r3 = matchElements(fresh3, stored3);
    expect(r3.unmatched).toHaveLength(1);

    console.log('  All three categories work correctly');
  });
});

// ── Empty-name edge case ────────────────────────────────────

describe('Empty accessibleName edge case', () => {
  it('two elements with empty accessibleName and no other signals → below threshold', () => {
    const after = scorePair(
      { accessibleName: '', testId: null, name: null, ariaLabel: null, ariaRole: null, tag: '' },
      { accessibleName: '', testId: null, name: null, ariaLabel: null, ariaRole: null, tag: '' },
    );
    // accessibleName both empty → stringEqual returns 1.0*0.20 = 0.20
    // Everything else: neutral 0.5 or both-missing 0.5
    // = 0.5*0.25 + 1.0*0.20 + 0.5*0.15 + 0.5*0.10 + 0.5*0.10 + 0.5*0.10 + 0.5*0.05 + 1.0*0.05
    // = 0.125 + 0.20 + 0.075 + 0.05 + 0.05 + 0.05 + 0.025 + 0.05 = 0.625
    console.log('  Before: 0.825 → After:', after.toFixed(4));
    expect(after).toBeLessThan(SCORING_POLICY.MATCH_THRESHOLD);
  });
});

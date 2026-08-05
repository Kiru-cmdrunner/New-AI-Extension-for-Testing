/**
 * Element Matching Service Tests — Phase 11 Milestone 11.2
 *
 * Tests the weighted identity signature matching between fresh UiElements
 * from a new recording and stored Element entities from the Repository.
 */

import { describe, it, expect } from 'vitest';
import {
  matchElements,
  computeSimilarity,
  extractSignature,
  extractStoredSignature,
  MATCH_THRESHOLD,
  type ElementMatchResult,
} from '../src/repository/services/element-matching-service';
import { createElement, type Element } from '../src/domain/entities/element';
import { createUiElement, type UiElement } from '../src/domain/entities/ui-element';
import { ElementStatus, LocatorStrategyType } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ──────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn btn-primary',
    name: null,
    stableId: null,
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    cssSelector: 'button.btn-primary',
    xPath: '/html/body/div/button',
    inIframe: false,
    shadowDom: false,
    href: null,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeUiElement(overrides: Partial<ElementIdentity> = {}, sourceUrl = 'https://app.com/login'): UiElement {
  const identity = makeIdentity(overrides);
  return createUiElement({
    elementId: identity.elementId,
    identity,
    sourceUrl,
    domTreePath: 'html>body>button',
  });
}

function makeStoredElement(overrides: Partial<Element> = {}): Element {
  return createElement({
    projectId: 'proj-001',
    logicalName: 'Submit',
    pageOrComponent: 'login-page',
    locatorStrategies: [
      { type: LocatorStrategyType.TEST_ID, value: 'submit-btn', priority: 1, confidence: 0.95 },
      { type: LocatorStrategyType.CSS, value: '.btn-primary', priority: 2, confidence: 0.4 },
    ],
    ...overrides,
  });
}

// ── computeSimilarity ────────────────────────────────────────

describe('computeSimilarity', () => {
  it('returns 1.0 for identical signatures', () => {
    const sig = extractSignature(makeIdentity(), 'https://app.com/login');
    expect(computeSimilarity(sig, sig)).toBe(1.0);
  });

  it('returns low score for completely different elements', () => {
    const sigA = extractSignature(
      makeIdentity({ accessibleName: 'Submit', tag: 'BUTTON', ariaRole: 'button' }),
      'https://app.com/login',
    );
    const sigB = extractSignature(
      makeIdentity({ accessibleName: 'Email Input', tag: 'INPUT', ariaRole: 'textbox' }),
      'https://app.com/register',
    );
    const score = computeSimilarity(sigA, sigB);
    expect(score).toBeLessThan(0.5);
  });

  it('matches on accessibleName even when CSS changes', () => {
    // The whole point: CSS selectors are excluded from matching
    const sigA = extractSignature(
      makeIdentity({ accessibleName: 'Submit', testId: 'submit-btn' }),
      'https://app.com/login',
    );
    const sigB = extractSignature(
      makeIdentity({ accessibleName: 'Submit', testId: 'submit-btn', cssSelector: 'button.different-class' }),
      'https://app.com/login',
    );
    // CSS is not in the signature, so these match
    expect(computeSimilarity(sigA, sigB)).toBe(1.0);
  });
});

// ── matchElements ────────────────────────────────────────────

describe('matchElements', () => {
  describe('same-element matching', () => {
    it('matches a fresh element to a stored element with same identity', () => {
      const fresh = [makeUiElement()];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatched).toHaveLength(0);
      expect(result.matches[0].matchScore).toBeGreaterThanOrEqual(MATCH_THRESHOLD);
    });

    it('matches despite CSS selector change', () => {
      const fresh = [makeUiElement({ cssSelector: 'button.completely-different' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatched).toHaveLength(0);
    });

    it('matches despite XPath change', () => {
      const fresh = [makeUiElement({ xPath: '/html/body/div[2]/button' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(1);
    });
  });

  describe('different-element rejection', () => {
    it('does not match elements with different accessibleName and role', () => {
      const fresh = [makeUiElement({ accessibleName: 'Email Input', ariaRole: 'textbox', tag: 'INPUT', testId: 'email' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });

    it('does not match when testId differs and no other strong signals', () => {
      const fresh = [makeUiElement({ testId: 'cancel-btn', accessibleName: 'Cancel', ariaRole: 'button' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });
  });

  describe('partial identity', () => {
    it('matches when testId is missing but accessibleName and role match', () => {
      const fresh = [makeUiElement({ testId: null, accessibleName: 'Submit', ariaRole: 'button', tag: 'BUTTON' })];
      // Stored element has testId, fresh doesn't — still should match on name+role
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      // Should match because accessibleName + role + tag are strong enough
      // Even though testId is missing on fresh side
      expect(result.matches).toHaveLength(1);
    });

    it('matches when page scope differs but identity is strong', () => {
      const fresh = [makeUiElement({}, 'https://app.com/dashboard')];
      const stored = [makeStoredElement({ pageOrComponent: 'login-page' })];
      const result = matchElements(fresh, stored);

      // testId match + name match should overcome page scope difference
      expect(result.matches).toHaveLength(1);
    });
  });

  describe('missing fields', () => {
    it('handles elements with null ariaRole', () => {
      const fresh = [makeUiElement({ ariaRole: null, testId: 'submit-btn', accessibleName: 'Submit' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(1);
    });

    it('handles elements with no business IDs', () => {
      const fresh = [makeUiElement({ testId: null, dataCy: null, dataQa: null, accessibleName: 'Submit', ariaRole: 'button', tag: 'BUTTON' })];
      const stored = [makeStoredElement({
        locatorStrategies: [
          { type: LocatorStrategyType.CSS, value: '.btn', priority: 1, confidence: 0.4 },
        ],
      })];
      const result = matchElements(fresh, stored);

      // Should still match on accessibleName + role + tag
      expect(result.matches).toHaveLength(1);
    });
  });

  describe('batch matching', () => {
    it('matches multiple elements correctly', () => {
      const fresh = [
        makeUiElement({ elementId: 'e1', testId: 'submit-btn', accessibleName: 'Submit' }),
        makeUiElement({ elementId: 'e2', testId: 'email', accessibleName: 'Email', ariaRole: 'textbox', tag: 'INPUT' }),
      ];
      const stored = [
        makeStoredElement({ logicalName: 'Submit' }),
        createElement({
          projectId: 'proj-001',
          logicalName: 'Email',
          pageOrComponent: 'login-page',
          locatorStrategies: [
            { type: LocatorStrategyType.TEST_ID, value: 'email', priority: 1, confidence: 0.95 },
          ],
        }),
      ];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(2);
      expect(result.unmatched).toHaveLength(0);
    });

    it('returns unmatched for genuinely new elements', () => {
      const fresh = [
        makeUiElement({ elementId: 'e1', testId: 'submit-btn', accessibleName: 'Submit' }),
        makeUiElement({ elementId: 'e2', testId: 'new-field', accessibleName: 'New Field', ariaRole: 'textbox', tag: 'INPUT' }),
      ];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(1);
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].elementId).toBe('e2');
    });

    it('uses greedy matching (highest score first)', () => {
      // Two fresh elements, two stored — ensure no cross-matching
      const fresh = [
        makeUiElement({ elementId: 'e1', testId: 'submit-btn', accessibleName: 'Submit' }),
        makeUiElement({ elementId: 'e2', testId: 'cancel-btn', accessibleName: 'Cancel' }),
      ];
      const stored = [
        makeStoredElement({ logicalName: 'Submit' }),
        createElement({
          projectId: 'proj-001',
          logicalName: 'Cancel',
          pageOrComponent: 'login-page',
          locatorStrategies: [
            { type: LocatorStrategyType.TEST_ID, value: 'cancel-btn', priority: 1, confidence: 0.95 },
          ],
        }),
      ];

      const result = matchElements(fresh, stored);

      expect(result.matches).toHaveLength(2);
      // Each fresh element matched the correct stored element
      const match1 = result.matches.find((m) => m.freshUiElement.elementId === 'e1');
      const match2 = result.matches.find((m) => m.freshUiElement.elementId === 'e2');
      expect(match1).toBeDefined();
      expect(match1!.storedElement.logicalName).toBe('Submit');
      expect(match2).toBeDefined();
      expect(match2!.storedElement.logicalName).toBe('Cancel');
    });
  });

  describe('edge cases', () => {
    it('returns all unmatched when stored is empty', () => {
      const fresh = [makeUiElement()];
      const result = matchElements(fresh, []);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });

    it('returns all unmatched when fresh is empty', () => {
      const stored = [makeStoredElement()];
      const result = matchElements([], stored);

      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
    });

    it('handles custom threshold', () => {
      const fresh = [makeUiElement({ testId: null, accessibleName: 'Submit', ariaRole: 'button', tag: 'BUTTON' })];
      const stored = [makeStoredElement()];
      const result = matchElements(fresh, stored, 0.99);

      // With a very high threshold, the partial match should be rejected
      expect(result.matches).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });
  });
});

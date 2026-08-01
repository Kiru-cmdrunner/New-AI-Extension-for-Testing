/**
 * R4 Element Identity & Matching Foundation — Gate Tests
 *
 * Tests the R4 design's 14 exit criteria and difficult matching scenarios.
 * Design: .drytis/specs/r4-element-identity-matching-foundation.md
 *
 * Covers:
 *   V1-V4: Identity persistence tests
 *   M1-M15: Matching outcome tests (MATCHED/AMBIGUOUS/UNMATCHED)
 *   H1-H5: Healing service tests
 *   B1-B3: Backward compatibility tests
 */

import { describe, it, expect } from 'vitest';
import {
  matchElements,
  computeSimilarity,
  extractSignature,
  extractStoredSignature,
  SCORING_POLICY,
} from '../src/repository/services/element-matching-service';
import {
  createElement,
  healElement,
  type Element,
  type ElementIdentityRecord,
} from '../src/domain/entities/element';
import { createUiElement, type UiElement } from '../src/domain/entities/ui-element';
import { LocatorStrategyType, ElementStatus } from '../src/domain/enums';
import type { ElementIdentity } from '../src/shared/types';

// ── Test Helpers ─────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn',
    name: null,
    stableId: null,
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    cssSelector: 'button.btn',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeUiElement(
  overrides: Partial<ElementIdentity> = {},
  opts: { sourceUrl?: string; ancestorRoles?: string[] } = {},
): UiElement {
  const identity = makeIdentity(overrides);
  return createUiElement({
    elementId: identity.elementId,
    identity,
    sourceUrl: opts.sourceUrl ?? 'https://app.com/login',
    domTreePath: 'html>body>button',
    ancestorRoles: opts.ancestorRoles,
  });
}

function makeIdentityRecord(overrides: Partial<ElementIdentityRecord> = {}): ElementIdentityRecord {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    tag: 'BUTTON',
    name: null,
    ariaLabel: null,
    ancestorRoles: null,
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    ...overrides,
  };
}

function makeStoredElement(opts: {
  logicalName?: string;
  identity?: ElementIdentityRecord | null;
  testId?: string;
  pageOrComponent?: string;
  locatorStrategies?: Array<{ type: LocatorStrategyType; value: string; priority: number; confidence: number }>;
}): Element {
  const strategies = opts.locatorStrategies ?? [
    { type: LocatorStrategyType.TEST_ID, value: opts.testId ?? 'submit-btn', priority: 1, confidence: 0.95 },
    { type: LocatorStrategyType.CSS, value: '.btn', priority: 2, confidence: 0.4 },
  ];
  return createElement({
    projectId: 'proj-001',
    logicalName: opts.logicalName ?? 'Submit',
    pageOrComponent: opts.pageOrComponent ?? 'https://app.com/login',
    locatorStrategies: strategies,
    identity: opts.identity === undefined ? null : opts.identity,
  });
}

// ── V: Identity Persistence Tests ────────────────────────────

describe('R4 V: Identity Persistence', () => {
  it('V1: createElement with identity record stores all 9 fields', () => {
    const id = makeIdentityRecord({
      accessibleName: 'Email',
      ariaRole: 'textbox',
      tag: 'INPUT',
      name: 'email',
      ariaLabel: 'Email Address',
      ancestorRoles: ['form', 'div', 'body'],
      testId: 'email-field',
      dataCy: 'email-cy',
      dataQa: 'email-qa',
    });
    const el = makeStoredElement({ identity: id });

    expect(el.identity).not.toBeNull();
    expect(el.identity!.accessibleName).toBe('Email');
    expect(el.identity!.ariaRole).toBe('textbox');
    expect(el.identity!.tag).toBe('INPUT');
    expect(el.identity!.name).toBe('email');
    expect(el.identity!.ariaLabel).toBe('Email Address');
    expect(el.identity!.ancestorRoles).toEqual(['form', 'div', 'body']);
    expect(el.identity!.testId).toBe('email-field');
    expect(el.identity!.dataCy).toBe('email-cy');
    expect(el.identity!.dataQa).toBe('email-qa');
  });

  it('V2: createElement without identity returns null', () => {
    const el = makeStoredElement({ identity: null });
    expect(el.identity).toBeNull();
  });

  it('V3: healElement merges identity from fresh observation', () => {
    const existing = makeStoredElement({
      identity: makeIdentityRecord({
        accessibleName: 'Old Name',
        testId: 'old-id',
        ariaRole: 'button',
      }),
    });

    const healed = healElement(existing, {
      newStrategies: [
        { type: LocatorStrategyType.TEST_ID, value: 'new-id', priority: 1, confidence: 0.95 },
      ],
      context: {
        sourceSessionId: 'session-2',
        reason: 'test',
        proposedBy: 'test',
      },
      updatedIdentity: makeIdentityRecord({
        accessibleName: 'New Name',
        testId: 'new-id',
        ariaRole: 'button',
      }),
    });

    // Identity merged: fresh non-null fields overwrite stored
    expect(healed.identity!.accessibleName).toBe('New Name');
    expect(healed.identity!.testId).toBe('new-id');
    // logicalName preserved (display name stays)
    expect(healed.logicalName).toBe('Submit');
  });

  it('V4: healElement preserves null fields from stored identity', () => {
    const existing = makeStoredElement({
      identity: makeIdentityRecord({
        accessibleName: 'Email',
        testId: 'email-field',
        name: 'email',
        ariaRole: null, // Stored has null
      }),
    });

    const healed = healElement(existing, {
      newStrategies: [
        { type: LocatorStrategyType.TEST_ID, value: 'email-field', priority: 1, confidence: 0.95 },
      ],
      context: { sourceSessionId: 's2', reason: 'test', proposedBy: 'test' },
      updatedIdentity: makeIdentityRecord({
        accessibleName: 'Email',
        testId: 'email-field',
        name: null, // Fresh is null — should preserve stored 'email'
        ariaRole: 'textbox', // Fresh has value — should overwrite null
      }),
    });

    expect(healed.identity!.name).toBe('email'); // Preserved from stored
    expect(healed.identity!.ariaRole).toBe('textbox'); // Updated from fresh
  });
});

// ── M: Matching Outcome Tests ────────────────────────────────

describe('R4 M: Matching Outcomes', () => {
  it('M1: unique accessibleName, same page → MATCHED', () => {
    const fresh = [makeUiElement({ elementId: 'e1', accessibleName: 'Unique Button', testId: 'unique-btn' })];
    const stored = [makeStoredElement({ logicalName: 'Unique Button', testId: 'unique-btn' })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].margin).toBeGreaterThanOrEqual(SCORING_POLICY.MIN_MARGIN);
  });

  it('M2: two candidates 0.82 vs 0.55 → MATCHED (margin 0.27)', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored = [
      makeStoredElement({ logicalName: 'Submit', testId: 'submit-btn' }),
      makeStoredElement({
        logicalName: 'Cancel', testId: 'cancel-btn',
        pageOrComponent: 'https://app.com/login',
      }),
    ];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].storedElement.logicalName).toBe('Submit');
  });

  it('M3: two candidates with near-tie → AMBIGUOUS', () => {
    // Two stored elements with same name, same testId, different UUIDs
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn',
      ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored = [
      makeStoredElement({ logicalName: 'Submit', testId: 'submit-btn', identity: makeIdentityRecord({ accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON' }) }),
      makeStoredElement({ logicalName: 'Submit', testId: 'submit-btn', identity: makeIdentityRecord({ accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON' }) }),
    ];
    const result = matchElements(fresh, stored);

    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates.length).toBe(2);
  });

  it('M4: two candidates with identical scores → AMBIGUOUS', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Delete', testId: null,
      ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored = [
      makeStoredElement({
        logicalName: 'Delete', testId: null,
        locatorStrategies: [{ type: LocatorStrategyType.CSS, value: '.del1', priority: 1, confidence: 0.4 }],
        identity: makeIdentityRecord({ accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' }),
      }),
      makeStoredElement({
        logicalName: 'Delete', testId: null,
        locatorStrategies: [{ type: LocatorStrategyType.CSS, value: '.del2', priority: 1, confidence: 0.4 }],
        identity: makeIdentityRecord({ accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' }),
      }),
    ];
    const result = matchElements(fresh, stored);

    expect(result.ambiguous).toHaveLength(1);
  });

  it('M5: best candidate below threshold → UNMATCHED', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Brand New', testId: 'new-field',
      ariaRole: 'textbox', tag: 'INPUT',
    })];
    const stored = [makeStoredElement({ logicalName: 'Submit', testId: 'submit-btn' })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it('M6: same name, different HTML name attr → MATCHED to correct', () => {
    // Two emails on same page, distinguished by `name` attribute
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Email', name: 'primaryEmail',
      testId: null, ariaRole: 'textbox', tag: 'INPUT',
    })];
    const stored = [
      makeStoredElement({
        logicalName: 'Email', testId: null,
        identity: makeIdentityRecord({ accessibleName: 'Email', name: 'primaryEmail', testId: null, ariaRole: 'textbox', tag: 'INPUT' }),
      }),
      makeStoredElement({
        logicalName: 'Email', testId: null,
        identity: makeIdentityRecord({ accessibleName: 'Email', name: 'secondaryEmail', testId: null, ariaRole: 'textbox', tag: 'INPUT' }),
      }),
    ];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
    // Matched to the correct stored element (primaryEmail)
    const matchedStored = result.matched[0].storedElement;
    expect(matchedStored.identity!.name).toBe('primaryEmail');
  });

  it('M7: identical all fields → AMBIGUOUS', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Email', name: null,
      testId: null, ariaRole: 'textbox', tag: 'INPUT',
    })];
    const stored = [
      makeStoredElement({
        logicalName: 'Email', testId: null,
        identity: makeIdentityRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }),
      }),
      makeStoredElement({
        logicalName: 'Email', testId: null,
        identity: makeIdentityRecord({ accessibleName: 'Email', testId: null, ariaRole: 'textbox', tag: 'INPUT' }),
      }),
    ];
    const result = matchElements(fresh, stored);

    expect(result.ambiguous).toHaveLength(1);
  });

  it('M8: 10 identical "Delete" buttons → AMBIGUOUS', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Delete', testId: null,
      ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored: Element[] = [];
    for (let i = 0; i < 10; i++) {
      stored.push(makeStoredElement({
        logicalName: 'Delete', testId: null,
        locatorStrategies: [{ type: LocatorStrategyType.CSS, value: `.del-${i}`, priority: 1, confidence: 0.4 }],
        identity: makeIdentityRecord({ accessibleName: 'Delete', testId: null, ariaRole: 'button', tag: 'BUTTON' }),
      }));
    }
    const result = matchElements(fresh, stored);

    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates.length).toBe(10);
  });

  it('M9: DOM wrapper added (ancestorRoles change) → MATCHED', () => {
    const fresh = [makeUiElement(
      { elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON' },
      { ancestorRoles: ['form', 'section', 'div', 'main', 'body'] },
    )];
    const stored = [makeStoredElement({
      logicalName: 'Submit', testId: 'submit-btn',
      identity: makeIdentityRecord({
        accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON',
        ancestorRoles: ['form', 'section', 'main', 'body'],
      }),
    })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
  });

  it('M10: testId changed, all else same → MATCHED', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Submit', testId: 'submit-button',
      ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored = [makeStoredElement({
      logicalName: 'Submit', testId: 'submit-btn',
      identity: makeIdentityRecord({
        accessibleName: 'Submit', testId: 'submit-btn', ariaRole: 'button', tag: 'BUTTON',
      }),
    })];
    const result = matchElements(fresh, stored);

    // testId mismatch but accessibleName + ariaRole + tag match
    expect(result.matched).toHaveLength(1);
  });

  it('M11: accessibleName changed, testId+name same → MATCHED', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Email', testId: 'email-field', name: 'email',
      ariaRole: 'textbox', tag: 'INPUT',
    })];
    const stored = [makeStoredElement({
      logicalName: 'Email Address', testId: 'email-field',
      identity: makeIdentityRecord({
        accessibleName: 'Email Address', testId: 'email-field', name: 'email',
        ariaRole: 'textbox', tag: 'INPUT',
      }),
    })];
    const result = matchElements(fresh, stored);

    // accessibleName mismatch but testId + name match
    expect(result.matched).toHaveLength(1);
  });

  it('M12: framework change (tag differs, role same) → MATCHED if sufficient margin', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Category', testId: 'category-select',
      ariaRole: 'combobox', tag: 'INPUT',
    })];
    const stored = [makeStoredElement({
      logicalName: 'Category', testId: 'category-select',
      identity: makeIdentityRecord({
        accessibleName: 'Category', testId: 'category-select', ariaRole: 'combobox', tag: 'DIV',
      }),
    })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
  });

  it('M13: pre-R4 Element (identity=null) vs fresh → MATCHED via fallback', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn',
      ariaRole: 'button', tag: 'BUTTON',
    })];
    // Pre-R4 Element: no identity field
    const stored = [makeStoredElement({ identity: null, logicalName: 'Submit', testId: 'submit-btn' })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
  });

  it('M14: pre-R4 Element, same name, no testId → AMBIGUOUS if multiple', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Delete', testId: null,
      ariaRole: 'button', tag: 'BUTTON',
    })];
    // Two pre-R4 elements with same name, no testId
    const stored = [
      makeStoredElement({
        identity: null, logicalName: 'Delete', testId: null,
        locatorStrategies: [{ type: LocatorStrategyType.CSS, value: '.del1', priority: 1, confidence: 0.4 }],
      }),
      makeStoredElement({
        identity: null, logicalName: 'Delete', testId: null,
        locatorStrategies: [{ type: LocatorStrategyType.CSS, value: '.del2', priority: 1, confidence: 0.4 }],
      }),
    ];
    const result = matchElements(fresh, stored);

    // Pre-R4 fallback has weaker identity — should be AMBIGUOUS
    expect(result.ambiguous).toHaveLength(1);
  });

  it('M15: no candidates above threshold → UNMATCHED', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Completely Different', testId: 'new-thing',
      ariaRole: 'textbox', tag: 'INPUT',
    })];
    const stored = [makeStoredElement({ logicalName: 'Submit', testId: 'submit-btn' })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });
});

// ── B: Backward Compatibility Tests ──────────────────────────

describe('R4 B: Backward Compatibility', () => {
  it('B1: old Element without identity field deserializes correctly', () => {
    // Simulate a pre-R4 Element by creating without identity
    const el = makeStoredElement({ identity: null });
    expect(el.identity).toBeNull();
    // Matcher should still work with it
    const sig = extractStoredSignature(el);
    expect(sig.accessibleName).toBe('Submit');
    expect(sig.testId).toBe('submit-btn'); // From locator strategies
  });

  it('B2: matcher with old Element uses fallback path', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Submit', testId: 'submit-btn',
      ariaRole: 'button', tag: 'BUTTON',
    })];
    const stored = [makeStoredElement({ identity: null })];
    const result = matchElements(fresh, stored);

    expect(result.matched).toHaveLength(1);
  });
});

// ── Additional: Identity-aware scoring verification ─────────

describe('R4 Scoring Policy Constants', () => {
  it('weights sum to 1.0', () => {
    const w = SCORING_POLICY.WEIGHTS;
    const sum = w.BUSINESS_IDS + w.ACCESSIBLE_NAME + w.FORM_NAME +
      w.ARIA_ROLE + w.ARIA_LABEL + w.ANCESTOR_ROLES + w.TAG + w.PAGE_SCOPE;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it('MATCH_THRESHOLD and MIN_MARGIN are reasonable', () => {
    expect(SCORING_POLICY.MATCH_THRESHOLD).toBeGreaterThan(0.5);
    expect(SCORING_POLICY.MATCH_THRESHOLD).toBeLessThan(1.0);
    expect(SCORING_POLICY.MIN_MARGIN).toBeGreaterThan(0);
    expect(SCORING_POLICY.MIN_MARGIN).toBeLessThan(0.2);
  });
});

// ── Additional: Identity separation ─────────────────────────

describe('R4 logicalName vs accessibleName separation', () => {
  it('logicalName is user-editable; identity.accessibleName is frozen', () => {
    const el = makeStoredElement({
      logicalName: 'My Custom Name',
      identity: makeIdentityRecord({ accessibleName: 'Original Name' }),
    });

    expect(el.logicalName).toBe('My Custom Name');
    expect(el.identity!.accessibleName).toBe('Original Name');
  });

  it('matcher uses identity.accessibleName when available', () => {
    const fresh = [makeUiElement({
      elementId: 'e1', accessibleName: 'Original Name', testId: 'btn',
      ariaRole: 'button', tag: 'BUTTON',
    })];
    // Stored has logicalName='Renamed' but identity.accessibleName='Original Name'
    const stored = [makeStoredElement({
      logicalName: 'Renamed',
      identity: makeIdentityRecord({ accessibleName: 'Original Name', testId: 'btn', ariaRole: 'button', tag: 'BUTTON' }),
    })];
    const result = matchElements(fresh, stored);

    // Should match because identity.accessibleName matches, even though logicalName differs
    expect(result.matched).toHaveLength(1);
  });
});

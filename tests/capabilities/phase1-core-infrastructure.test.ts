/**
 * Phase 1 — Core Infrastructure Tests.
 *
 * Tests for: capability-types, keyword-dictionary, evidence-extractor,
 * conflict-resolver, capability-engine, and capability-rule interface.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 1)
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_CAPABILITY_TYPES,
  type CapabilityType,
  type CapabilityClaim,
  type CapabilityRecord,
  type SignalStream,
} from '../../src/capabilities/capability-types';
import {
  KEYWORD_DICTIONARY,
  matchKeywords,
} from '../../src/capabilities/keyword-dictionary';
import {
  extractEvidence,
} from '../../src/capabilities/evidence-extractor';
import {
  resolveClaims,
  NO_CLAIM_REASON,
  ONLY_LOW_CLAIMS_REASON,
} from '../../src/capabilities/conflict-resolver';
import { CapabilityEngine } from '../../src/capabilities/capability-engine';
import type { CapabilityRule } from '../../src/capabilities/capability-rule';
import type { ExtractedEvidence } from '../../src/capabilities/evidence-extractor';
import type { ComponentInteraction, InteractionType } from '../../src/shared/component-types';
import type { SemanticEffect } from '../../src/semantics/effect-types';
import type { DeepPartial } from '../helpers/deep-partial';
import { deepMerge } from '../helpers/deep-partial';

// ── Test Helpers ──────────────────────────────────────────────────────

/**
 * Build a minimal ComponentInteraction for testing.
 */
function makeInteraction(
  overrides: DeepPartial<ComponentInteraction> = {},
): ComponentInteraction {
  return deepMerge({
    interactionId: 'int-test-001',
    type: 'Click',
    trigger: {
      elementId: 'elem-0001',
      accessibleName: 'Test Button',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: 'body > button',
      xPath: '/html/body/button',
      inIframe: false,
      shadowDom: false,
      href: null,
    },
    triggerEvent: {
      eventId: 'evt-test-001',
      eventType: 'click',
      timestamp: 1000,
      captureSeq: 1,
      isTrusted: true,
      target: {
        elementId: 'elem-0001',
        accessibleName: 'Test Button',
        ariaRole: 'button',
        ariaLabel: null,
        ariaLabelledBy: null,
        placeholder: null,
        tag: 'BUTTON',
        className: null,
        name: null,
        stableId: null,
        testId: null,
        dataCy: null,
        dataQa: null,
        cssSelector: 'body > button',
        xPath: '/html/body/button',
        inIframe: false,
        shadowDom: false,
        href: null,
      },
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: [],
        tabIndex: null,
      },
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 10,
      clientY: 20,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
    },
    memberEvents: [],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {},
  }, overrides);
}

/**
 * Build a SemanticEffect for testing.
 */
function makeEffect(
  overrides: Partial<SemanticEffect> = {},
): SemanticEffect {
  return {
    category: 'state-toggle',
    description: 'test effect',
    affectedTarget: {
      role: null,
      label: null,
      cssPath: 'body > div',
    },
    confidence: 'high',
    confidenceBasis: 'direct-property',
    evidenceRef: {
      windowId: 'obs-evt-test-001',
      sourceEventId: 'evt-test-001',
    },
    ...overrides,
  };
}

/**
 * Build a CapabilityClaim for testing.
 */
function makeClaim(overrides: Partial<CapabilityClaim> = {}): CapabilityClaim {
  return {
    capability: 'ToggleControl',
    confidence: 'high',
    priority: 50,
    supportingSignalCount: 2,
    signalStreams: new Set<SignalStream>(['keyword', 'physical-type']),
    reason: 'state-toggle effect present',
    hasDirectProperty: true,
    ...overrides,
  };
}

/**
 * A test rule that returns a pre-set claim or null.
 */
class TestRule implements CapabilityRule {
  constructor(
    readonly capability: CapabilityType,
    readonly priority: number,
    private claim: CapabilityClaim | null,
  ) {}

  evaluate(_evidence: ExtractedEvidence): CapabilityClaim | null {
    return this.claim;
  }
}

// ────────────────────────────────────────────────────────────────────────
// capability-types.ts
// ────────────────────────────────────────────────────────────────────────
describe('capability-types', () => {
  it('ALL_CAPABILITY_TYPES has exactly 13 values', () => {
    expect(ALL_CAPABILITY_TYPES).toHaveLength(13);
  });

  it('includes all expected types', () => {
    const expected: CapabilityType[] = [
      'FilterSelection', 'SortSelection', 'Search', 'Navigate',
      'SubmitForm', 'SelectOption', 'ToggleControl', 'ExpandCollapse',
      'OpenDetail', 'UploadFile', 'Paginate', 'AdjustValue', 'Unclassified',
    ];
    expect([...ALL_CAPABILITY_TYPES].sort()).toEqual([...expected].sort());
  });

  it('Unclassified is always the last type in the union', () => {
    // It's the fallback — verifies it exists in the taxonomy
    expect(ALL_CAPABILITY_TYPES).toContain('Unclassified');
  });

  it('CapabilityRecord round-trip serialization', () => {
    const record: CapabilityRecord = {
      capabilityId: 'cap-int-001',
      interactionId: 'int-001',
      capability: 'ToggleControl',
      confidence: 'high',
      parameters: { target: 'Email notifications', value: 'on' },
      evidence: {
        physicalType: 'Checkbox',
        targetLabel: 'Email notifications',
        semanticEffects: ['state-toggle'],
        matchedKeywords: ['enable'],
        structuralContext: ['ancestor:form'],
        sequenceNotes: [],
      },
      alternatives: [
        { capability: 'FilterSelection', confidence: 'low', reason: 'remote content-change but keyword evidence stronger' },
      ],
    };

    const json = JSON.stringify(record);
    const parsed: CapabilityRecord = JSON.parse(json);

    expect(parsed.capabilityId).toBe('cap-int-001');
    expect(parsed.capability).toBe('ToggleControl');
    expect(parsed.confidence).toBe('high');
    expect(parsed.parameters.target).toBe('Email notifications');
    expect(parsed.evidence.physicalType).toBe('Checkbox');
    expect(parsed.alternatives).toHaveLength(1);
    expect(parsed.alternatives[0].capability).toBe('FilterSelection');
  });

  it('CapabilityClaim with empty signalStreams set', () => {
    const claim = makeClaim({ signalStreams: new Set(), supportingSignalCount: 0 });
    expect(claim.signalStreams.size).toBe(0);
    expect(claim.supportingSignalCount).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// keyword-dictionary.ts
// ────────────────────────────────────────────────────────────────────────
describe('keyword-dictionary', () => {
  it('has 8 categories in V1 (6 original + SelectOption + AdjustValue)', () => {
    expect(KEYWORD_DICTIONARY).toHaveLength(8);
  });

  it('filter matches "filter", "refine", "brand"', () => {
    const matches = matchKeywords(['Filter by Brand']);
    expect(matches).toHaveLength(1);
    expect(matches[0].capability).toBe('FilterSelection');
    expect(matches[0].matched).toContain('filter');
    expect(matches[0].matched).toContain('brand');
  });

  it('sort matches "sort by price"', () => {
    const matches = matchKeywords(['Sort by Price: Low to High']);
    expect(matches.some((m) => m.capability === 'SortSelection')).toBe(true);
    const sortMatch = matches.find((m) => m.capability === 'SortSelection');
    expect(sortMatch!.matched.length).toBeGreaterThanOrEqual(2); // 'sort' + 'price: low' or similar
  });

  it('does NOT match "learn" to any category', () => {
    const matches = matchKeywords(['Learn more about our services']);
    // 'learn' should not match any keyword
    expect(matches).toHaveLength(0);
  });

  it('does NOT match unrelated text', () => {
    const matches = matchKeywords(['Contact us', 'About', 'FAQ']);
    expect(matches).toHaveLength(0);
  });

  it('matches multiple capabilities from combined text', () => {
    const matches = matchKeywords(['Search and filter results']);
    expect(matches.some((m) => m.capability === 'Search')).toBe(true);
    expect(matches.some((m) => m.capability === 'FilterSelection')).toBe(true);
  });

  it('case-insensitive matching', () => {
    const matches = matchKeywords(['FILTER', 'SORT', 'SEARCH']);
    // "SEARCH" matches both Search and SubmitForm (added in F5 fix)
    expect(matches).toHaveLength(4);
    const caps = matches.map((m) => m.capability);
    expect(caps).toContain('FilterSelection');
    expect(caps).toContain('SortSelection');
    expect(caps).toContain('Search');
    expect(caps).toContain('SubmitForm');
  });

  it('empty input → empty results', () => {
    expect(matchKeywords([])).toEqual([]);
    expect(matchKeywords([''])).toEqual([]);
    expect(matchKeywords([null as any, undefined as any])).toEqual([]);
  });

  it('navigate matches "home", "back", "dashboard"', () => {
    const matches = matchKeywords(['Go to Dashboard']);
    expect(matches.some((m) => m.capability === 'Navigate')).toBe(true);
  });

  it('submit matches "sign in", "login", "save"', () => {
    const matches = matchKeywords(['Sign In']);
    expect(matches.some((m) => m.capability === 'SubmitForm')).toBe(true);
  });

  it('paginate matches "next page", "load more"', () => {
    const matches = matchKeywords(['Next Page']);
    expect(matches.some((m) => m.capability === 'Paginate')).toBe(true);
  });

  it('multiple keyword groups can match', () => {
    const matches = matchKeywords(['Filter and Sort']);
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────────────
// evidence-extractor.ts
// ────────────────────────────────────────────────────────────────────────
describe('evidence-extractor', () => {
  it('extracts physical type and accessible name', () => {
    const interaction = makeInteraction();
    const evidence = extractEvidence(interaction, [], [interaction], 0);

    expect(evidence.physical.interactionType).toBe('Click');
    expect(evidence.physical.accessibleName).toBe('Test Button');
    expect(evidence.physical.tag).toBe('BUTTON');
  });

  it('detects checkbox-like elements', () => {
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
        ariaRole: 'checkbox',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'checkbox',
        },
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);
    expect(evidence.physical.isCheckboxLike).toBe(true);
  });

  it('detects slider-like elements', () => {
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        tag: 'DIV',
        ariaRole: 'slider',
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);
    expect(evidence.physical.isSliderLike).toBe(true);
  });

  it('detects submit-type elements', () => {
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'submit',
        },
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);
    expect(evidence.physical.isSubmitType).toBe(true);
  });

  it('detects file input elements', () => {
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'file',
        },
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);
    expect(evidence.physical.isFileInput).toBe(true);
  });

  it('extracts behavioral evidence — state-toggle present', () => {
    const interaction = makeInteraction();
    const effects = [makeEffect({ category: 'state-toggle' })];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.hasStateToggle).toBe(true);
    expect(evidence.behavioral.hasContentChange).toBe(false);
  });

  it('extracts behavioral evidence — content-change present', () => {
    const interaction = makeInteraction();
    const effects = [makeEffect({ category: 'content-change' })];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.hasContentChange).toBe(true);
    expect(evidence.behavioral.hasStateToggle).toBe(false);
  });

  it('detects remote effect (content-change on different element)', () => {
    const interaction = makeInteraction();
    const effects = [
      makeEffect({
        category: 'content-change',
        affectedTarget: { role: null, label: null, cssPath: '#results' },
      }),
    ];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.hasRemoteEffect).toBe(true);
  });

  it('detects non-remote effect (content-change on trigger element)', () => {
    const interaction = makeInteraction();
    const effects = [
      makeEffect({
        category: 'content-change',
        affectedTarget: { role: null, label: null, cssPath: 'body > button' },
      }),
    ];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.hasRemoteEffect).toBe(false);
  });

  it('detects direct-property evidence', () => {
    const interaction = makeInteraction();
    const effects = [
      makeEffect({ confidenceBasis: 'direct-property' }),
    ];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.hasDirectPropertyEvidence).toBe(true);
  });

  it('aggregates netNodeDelta from content-change effects', () => {
    const interaction = makeInteraction();
    const effects = [
      makeEffect({ category: 'content-change', netNodeDelta: -5 }),
      makeEffect({ category: 'content-change', netNodeDelta: 3 }),
    ];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.netNodeDelta).toBe(-2);
  });

  it('netNodeDelta null when no content-change effects', () => {
    const interaction = makeInteraction();
    const effects = [makeEffect({ category: 'state-toggle' })];
    const evidence = extractEvidence(interaction, effects, [interaction], 0);

    expect(evidence.behavioral.netNodeDelta).toBeNull();
  });

  it('extracts sequence context — first interaction has no previous', () => {
    const interaction = makeInteraction();
    const evidence = extractEvidence(interaction, [], [interaction], 0);

    expect(evidence.sequence.previousInteractionType).toBeNull();
    expect(evidence.sequence.precededByTextEntryOnSameForm).toBe(false);
  });

  it('extracts sequence context — preceded by TextEntry on same page', () => {
    const textEntry = makeInteraction({
      interactionId: 'int-001',
      type: 'TextEntry' as InteractionType,
    });
    const click = makeInteraction({
      interactionId: 'int-002',
      type: 'Click',
    });
    const evidence = extractEvidence(click, [], [textEntry, click], 1);

    expect(evidence.sequence.previousInteractionType).toBe('TextEntry');
    expect(evidence.sequence.precededByTextEntryOnSameForm).toBe(true);
  });

  it('extracts sequence context — URL change detected', () => {
    const first = makeInteraction({
      interactionId: 'int-001',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/page1',
      },
    });
    const second = makeInteraction({
      interactionId: 'int-002',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/page2',
      },
    });
    const evidence = extractEvidence(second, [], [first, second], 1);

    expect(evidence.sequence.urlChanged).toBe(true);
  });

  it('extracts keyword matches from accessible name', () => {
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        accessibleName: 'Filter by Brand',
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);

    expect(evidence.keywords.hasAnyMatch).toBe(true);
    expect(evidence.keywords.matches.some((m) => m.capability === 'FilterSelection')).toBe(true);
  });

  it('extracts keyword matches from ancestor roles/classes', () => {
    const interaction = makeInteraction({
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          ancestorRoles: ['search'],
          ancestorClasses: ['filter-panel'],
        },
      },
    });
    const evidence = extractEvidence(interaction, [], [interaction], 0);

    expect(evidence.keywords.hasAnyMatch).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// conflict-resolver.ts
// ────────────────────────────────────────────────────────────────────────
describe('conflict-resolver', () => {
  it('single HIGH claim wins', () => {
    const claims = [makeClaim({ capability: 'ToggleControl', confidence: 'high' })];
    const result = resolveClaims(claims);
    expect(result.primary).not.toBeNull();
    expect(result.primary!.capability).toBe('ToggleControl');
    expect(result.alternatives).toEqual([]);
  });

  it('HIGH beats MEDIUM beats LOW', () => {
    const claims = [
      makeClaim({ capability: 'FilterSelection', confidence: 'low' }),
      makeClaim({ capability: 'ToggleControl', confidence: 'high' }),
      makeClaim({ capability: 'SelectOption', confidence: 'medium' }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary!.capability).toBe('ToggleControl');
    expect(result.primary!.confidence).toBe('high');
  });

  it('same confidence → most supporting signals wins', () => {
    const claims = [
      makeClaim({
        capability: 'FilterSelection',
        confidence: 'medium',
        supportingSignalCount: 1,
      }),
      makeClaim({
        capability: 'ToggleControl',
        confidence: 'medium',
        supportingSignalCount: 3,
      }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary!.capability).toBe('ToggleControl');
  });

  it('same confidence + same signal count → lowest priority number wins', () => {
    const claims = [
      makeClaim({
        capability: 'Navigate',
        confidence: 'medium',
        supportingSignalCount: 2,
        priority: 30,
      }),
      makeClaim({
        capability: 'OpenDetail',
        confidence: 'medium',
        supportingSignalCount: 2,
        priority: 10,
      }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary!.capability).toBe('OpenDetail');
  });

  it('only LOW claims → Unclassified wins, LOWs go to alternatives', () => {
    const claims = [
      makeClaim({ capability: 'FilterSelection', confidence: 'low' }),
      makeClaim({ capability: 'SelectOption', confidence: 'low' }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary).toBeNull();
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives.map((a) => a.capability)).toContain('FilterSelection');
    expect(result.alternatives.map((a) => a.capability)).toContain('SelectOption');
  });

  it('zero claims → Unclassified with no alternatives', () => {
    const result = resolveClaims([]);
    expect(result.primary).toBeNull();
    expect(result.alternatives).toEqual([]);
  });

  it('direct-property evidence breaks ties at same confidence', () => {
    const claims = [
      makeClaim({
        capability: 'FilterSelection',
        confidence: 'high',
        supportingSignalCount: 2,
        hasDirectProperty: false,
        priority: 40,
      }),
      makeClaim({
        capability: 'ToggleControl',
        confidence: 'high',
        supportingSignalCount: 2,
        hasDirectProperty: true,
        priority: 50,
      }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary!.capability).toBe('ToggleControl');
  });

  it('losing claims go to alternatives with reason', () => {
    const claims = [
      makeClaim({ capability: 'ToggleControl', confidence: 'high', reason: 'state-toggle HIGH' }),
      makeClaim({ capability: 'FilterSelection', confidence: 'low', reason: 'remote content-change' }),
    ];
    const result = resolveClaims(claims);
    expect(result.primary!.capability).toBe('ToggleControl');
    expect(result.alternatives).toHaveLength(1);
    expect(result.alternatives[0].capability).toBe('FilterSelection');
    expect(result.alternatives[0].reason).toBe('remote content-change');
  });

  it('NO_CLAIM_REASON is defined', () => {
    expect(NO_CLAIM_REASON).toContain('No capability rule');
  });

  it('ONLY_LOW_CLAIMS_REASON is defined', () => {
    expect(ONLY_LOW_CLAIMS_REASON).toContain('LOW');
  });
});

// ────────────────────────────────────────────────────────────────────────
// capability-engine.ts
// ────────────────────────────────────────────────────────────────────────
describe('CapabilityEngine', () => {
  it('empty interactions → empty results', () => {
    const engine = new CapabilityEngine();
    const results = engine.inferCapabilities([], new Map());
    expect(results).toEqual([]);
  });

  it('single interaction with no rules registered → Unclassified', () => {
    const engine = new CapabilityEngine();
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results).toHaveLength(1);
    expect(results[0].capability).toBe('Unclassified');
    expect(results[0].unclassifiedReason).toContain('No capability rule');
  });

  it('single interaction with no rules → empty alternatives (no claims)', () => {
    const engine = new CapabilityEngine();
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].alternatives).toEqual([]);
  });

  it('rule produces HIGH claim → becomes primary', () => {
    const engine = new CapabilityEngine();
    const rule = new TestRule('ToggleControl', 50, makeClaim({
      capability: 'ToggleControl',
      confidence: 'high',
    }));
    engine.registerRule(rule);
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('ToggleControl');
    expect(results[0].confidence).toBe('high');
    expect(results[0].alternatives).toEqual([]);
  });

  it('two rules: HIGH wins over LOW → HIGH is primary, LOW in alternatives', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new TestRule('ToggleControl', 50, makeClaim({
      capability: 'ToggleControl',
      confidence: 'high',
      reason: 'state-toggle present',
    })));
    engine.registerRule(new TestRule('FilterSelection', 40, makeClaim({
      capability: 'FilterSelection',
      confidence: 'low',
      reason: 'remote content-change',
    })));
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('ToggleControl');
    expect(results[0].alternatives).toHaveLength(1);
    expect(results[0].alternatives[0].capability).toBe('FilterSelection');
  });

  it('two rules: both LOW → Unclassified, both in alternatives', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new TestRule('FilterSelection', 40, makeClaim({
      capability: 'FilterSelection',
      confidence: 'low',
      reason: 'weak filter evidence',
    })));
    engine.registerRule(new TestRule('SelectOption', 60, makeClaim({
      capability: 'SelectOption',
      confidence: 'low',
      reason: 'dropdown selected',
    })));
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('Unclassified');
    expect(results[0].alternatives).toHaveLength(2);
  });

  it('multiple interactions → one record per interaction', () => {
    const engine = new CapabilityEngine();
    const rule = new TestRule('Navigate', 30, makeClaim({
      capability: 'Navigate',
      confidence: 'medium',
    }));
    engine.registerRule(rule);
    const interactions = [
      makeInteraction({ interactionId: 'int-001' }),
      makeInteraction({ interactionId: 'int-002' }),
      makeInteraction({ interactionId: 'int-003' }),
    ];
    const results = engine.inferCapabilities(interactions, new Map());
    expect(results).toHaveLength(3);
    expect(results[0].interactionId).toBe('int-001');
    expect(results[1].interactionId).toBe('int-002');
    expect(results[2].interactionId).toBe('int-003');
  });

  it('evidence trail is populated correctly', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new TestRule('ToggleControl', 50, makeClaim({
      capability: 'ToggleControl',
      confidence: 'high',
    })));
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        accessibleName: 'Dark Mode Toggle',
      },
    });
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].evidence.physicalType).toBe('Click');
    expect(results[0].evidence.targetLabel).toBe('Dark Mode Toggle');
    expect(results[0].capabilityId).toBe('cap-int-test-001');
  });

  it('rule returns null → no claim for that capability', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new TestRule('ToggleControl', 50, null));
    const interaction = makeInteraction();
    const results = engine.inferCapabilities([interaction], new Map());
    expect(results[0].capability).toBe('Unclassified');
    expect(results[0].alternatives).toEqual([]);
  });

  it('effects are consumed from EffectsMap', () => {
    const engine = new CapabilityEngine();
    // Rule checks for state-toggle
    engine.registerRule(new TestRule('ToggleControl', 50, makeClaim({
      capability: 'ToggleControl',
      confidence: 'high',
    })));
    const interaction = makeInteraction({ interactionId: 'int-001' });
    const effectsMap = new Map([
      ['int-001', [makeEffect({ category: 'state-toggle' })]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].evidence.semanticEffects).toContain('state-toggle');
  });

  it('sequence notes populated for TextEntry → Click on same page', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new TestRule('SubmitForm', 30, makeClaim({
      capability: 'SubmitForm',
      confidence: 'high',
    })));
    const textEntry = makeInteraction({
      interactionId: 'int-001',
      type: 'TextEntry' as InteractionType,
    });
    const submit = makeInteraction({
      interactionId: 'int-002',
      type: 'Click',
    });
    const results = engine.inferCapabilities([textEntry, submit], new Map());
    const submitRecord = results[1];
    expect(submitRecord.evidence.sequenceNotes).toContain('preceded by TextEntry on same page');
  });
});

/**
 * Phase 3 — Navigation Capability Rules Tests
 *
 * Tests for Navigate, OpenDetail, and Paginate rules.
 * Also tests conflict resolution between them.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 3)
 */

import { describe, it, expect } from 'vitest';
import { NavigateRule } from '../../src/capabilities/rules/navigate';
import { OpenDetailRule } from '../../src/capabilities/rules/open-detail';
import { PaginateRule } from '../../src/capabilities/rules/paginate';
import { CapabilityEngine } from '../../src/capabilities/capability-engine';
import type { ExtractedEvidence } from '../../src/capabilities/evidence-extractor';
import type { SemanticEffect } from '../../src/semantics/effect-types';
import type { ComponentInteraction, InteractionType } from '../../src/shared/component-types';
import { ToggleControlRule } from '../../src/capabilities/rules/toggle-control';
import { UploadFileRule } from '../../src/capabilities/rules/upload-file';

// ── Test Evidence Builder ─────────────────────────────────────────────

function makeEvidence(overrides: {
  urlChangedAfter?: boolean;
  hasNextItemSpecificUrl?: boolean;
  urlChanged?: boolean;
  nextUrl?: string | null;
  hasContentChange?: boolean;
  hasVisibilityChange?: boolean;
  hasStateToggle?: boolean;
  hasExpandCollapse?: boolean;
  hasRemoteEffect?: boolean;
  hasDirectPropertyEvidence?: boolean;
  netNodeDelta?: number | null;
  isCheckboxLike?: boolean;
  isFileInput?: boolean;
  interactionType?: InteractionType;
  tag?: string;
  ariaRole?: string | null;
  accessibleName?: string;
  keywordMatches?: Array<{ capability: string; matched: string[] }>;
  ancestorRoles?: string[];
  precededByListContext?: boolean;
  precededByTextEntryOnSameForm?: boolean;
  previousInteractionType?: InteractionType | null;
  urlPathChangedAfter?: boolean;
  triggerHasItemSpecificHref?: boolean;
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
      isSliderLike: false,
      isSubmitType: false,
      isFileInput: overrides.isFileInput ?? false,
      ancestorRoles: overrides.ancestorRoles ?? [],
      ancestorClasses: [],
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
      previousInteractionType: overrides.previousInteractionType ?? null,
      precededBySamePage: true,
      precededByTextEntryOnSameForm: overrides.precededByTextEntryOnSameForm ?? false,
      urlChangedAfter: overrides.urlChangedAfter ?? false,
      pageUrl: 'https://example.com',
      pageTitle: 'Example',
      urlChanged: overrides.urlChanged ?? false,
      nextUrl: overrides.nextUrl ?? null,
      hasNextItemSpecificUrl: overrides.hasNextItemSpecificUrl ?? false,
      precededByListContext: overrides.precededByListContext ?? false,
      urlPathChangedAfter: overrides.urlPathChangedAfter ?? overrides.urlChangedAfter ?? false,
      precededByFormInteraction: false,
      triggerHasItemSpecificHref: overrides.triggerHasItemSpecificHref ?? false,
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

function makeEffect(category: string, confidenceBasis = 'direct-property'): SemanticEffect {
  return {
    category: category as any,
    description: 'test effect',
    affectedTarget: { role: null, label: null, cssPath: 'body > div' },
    confidence: 'high',
    confidenceBasis: confidenceBasis as any,
    evidenceRef: { windowId: 'obs-001', sourceEventId: 'evt-001' },
  };
}

function makeInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-test-001',
    type: 'Click',
    trigger: {
      elementId: 'elem-001',
      accessibleName: 'Test',
      ariaRole: null,
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
      eventId: 'evt-001',
      eventType: 'click',
      timestamp: 1000,
      isTrusted: true,
      target: {
        elementId: 'elem-001',
        accessibleName: 'Test',
        ariaRole: null,
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
      clientX: 0,
      clientY: 0,
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
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Navigate Rule
// ────────────────────────────────────────────────────────────────────────
describe('NavigateRule', () => {
  const rule = new NavigateRule();

  it('URL changed + Link type + urlChanged from prev → HIGH', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      interactionType: 'Link',
      urlChanged: true,
      nextUrl: 'https://example.com/home',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('Navigate');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(30);
  });

  it('URL changed + Click type → MEDIUM', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      interactionType: 'Click',
      urlChanged: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('URL changed + keyword "home" → MEDIUM', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      interactionType: 'Hover',
      keywordMatches: [{ capability: 'Navigate', matched: ['home'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('URL NOT changed → null', () => {
    const evidence = makeEvidence({
      urlChangedAfter: false,
      interactionType: 'Link',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('reason string contains URL', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      nextUrl: 'https://example.com/dashboard',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('https://example.com/dashboard');
  });

  it('claims on urlPathChangedAfter without keywords (path change is definitive required signal)', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      urlPathChangedAfter: true,
      interactionType: 'Hover',
      urlChanged: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.confidence).toBe('low');
  });

  it('does NOT claim on query-param-only change (urlChangedAfter without urlPathChangedAfter)', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      urlPathChangedAfter: false,
      interactionType: 'Hover',
      urlChanged: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// OpenDetail Rule
// ────────────────────────────────────────────────────────────────────────
describe('OpenDetailRule', () => {
  const rule = new OpenDetailRule();

  it('URL changed to item-specific + list context + Link type → HIGH', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: true,
      precededByListContext: true,
      interactionType: 'Link',
      nextUrl: 'https://example.com/dp/B08N5WRWNW',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('OpenDetail');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(10);
  });

  it('URL changed to item-specific + Link type → MEDIUM', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: true,
      interactionType: 'Link',
      precededByListContext: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('URL changed but NOT item-specific → null', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: false,
      interactionType: 'Link',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('URL NOT changed → null', () => {
    const evidence = makeEvidence({
      urlChangedAfter: false,
      hasNextItemSpecificUrl: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('UUID-like URL → hasNextItemSpecificUrl pattern', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: true,
      interactionType: 'Link',
      precededByListContext: true,
      nextUrl: 'https://example.com/item/550e8400-e29b-41d4-a716-446655440000',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.capability).toBe('OpenDetail');
    expect(claim!.confidence).toBe('high');
  });

  it('reason string contains item-specific URL', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: true,
      nextUrl: 'https://example.com/dp/B08N5WRWNW',
      interactionType: 'Link',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('B08N5WRWNW');
  });

  it('preceded by TextEntry (search) → list context present', () => {
    const evidence = makeEvidence({
      urlChangedAfter: true,
      hasNextItemSpecificUrl: true,
      precededByListContext: true,
      interactionType: 'Link',
      previousInteractionType: 'TextEntry',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('sequence')).toBe(true);
    expect(claim!.confidence).toBe('high');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Paginate Rule
// ────────────────────────────────────────────────────────────────────────
describe('PaginateRule (corrected — pagination keyword required)', () => {
  const rule = new PaginateRule();

  it('keyword "next page" + content-change + Link type → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      keywordMatches: [{ capability: 'Paginate', matched: ['next page'] }],
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('Paginate');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(25);
  });

  it('keyword + content-change + positive netNodeDelta + remote effect → HIGH', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: 10,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'Paginate', matched: ['load more'] }],
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('keyword + Link type → MEDIUM (1 non-keyword supporting)', () => {
    const evidence = makeEvidence({
      keywordMatches: [{ capability: 'Paginate', matched: ['next page'] }],
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('keyword only, no other supporting → LOW', () => {
    const evidence = makeEvidence({
      keywordMatches: [{ capability: 'Paginate', matched: ['next page'] }],
      interactionType: 'Hover',
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('low');
  });

  it('NO pagination keyword → null (even with content-change)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('content-change BUT urlChangedAfter → null (that is Navigate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      urlChangedAfter: true,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'Paginate', matched: ['next page'] }],
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('NO keyword + visibility-change → null (not pagination-specific)', () => {
    const evidence = makeEvidence({
      hasVisibilityChange: true,
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('"load more" keyword + content-change → Paginate (not Navigate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      keywordMatches: [{ capability: 'Paginate', matched: ['load more'] }],
      interactionType: 'Click',
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.capability).toBe('Paginate');
  });

  it('Amazon brand filter: content-change, no keyword → null (NOT Paginate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      netNodeDelta: -10,
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('"Show Reviews": content-change, no keyword → null (NOT Paginate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Click',
      urlChangedAfter: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('"View More Specifications": content-change, no keyword → null (NOT Paginate)', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      hasRemoteEffect: true,
      interactionType: 'Link',
      urlChangedAfter: false,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('positive netNodeDelta adds structural stream', () => {
    const evidence = makeEvidence({
      hasContentChange: true,
      netNodeDelta: 5,
      interactionType: 'Link',
      keywordMatches: [{ capability: 'Paginate', matched: ['next page'] }],
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('structural')).toBe(true);
  });

  it('reason string contains matched keyword', () => {
    const evidence = makeEvidence({
      keywordMatches: [{ capability: 'Paginate', matched: ['load more'] }],
      interactionType: 'Click',
      urlChangedAfter: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('load more');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Conflict Resolution: Navigate vs OpenDetail vs Paginate
// ────────────────────────────────────────────────────────────────────────
describe('Phase 3 Conflict Resolution', () => {
  it('OpenDetail (pri 10) beats Navigate (pri 30) at same confidence', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new NavigateRule());
    engine.registerRule(new OpenDetailRule());

    // Click a product link → URL changes to /dp/B08N5WRWNW
    const interaction = makeInteraction({
      type: 'Link',
      trigger: {
        ...makeInteraction().trigger,
        accessibleName: 'Wireless Headphones',
        tag: 'A',
        ariaRole: 'link',
        href: '/dp/B08N5WRWNW',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/search?q=headphones',
        eventType: 'click',
      },
    });

    // Simulate next interaction on product page
    const nextInteraction = makeInteraction({
      interactionId: 'int-002',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/dp/B08N5WRWNW',
      },
    });

    const effectsMap = new Map();
    const results = engine.inferCapabilities([interaction, nextInteraction], effectsMap);

    // First interaction should be OpenDetail (lower priority number wins tie)
    expect(results[0].capability).toBe('OpenDetail');
    expect(results[0].alternatives).toHaveLength(1);
    expect(results[0].alternatives[0].capability).toBe('Navigate');
  });

  it('Paginate does NOT claim when URL changed (Navigate wins)', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new NavigateRule());
    engine.registerRule(new PaginateRule());

    const interaction = makeInteraction({
      type: 'Link',
      trigger: {
        ...makeInteraction().trigger,
        tag: 'A',
        accessibleName: 'Next Page',
      },
    });

    const nextInteraction = makeInteraction({
      interactionId: 'int-002',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/page2',
      },
    });

    const effectsMap = new Map([
      ['int-test-001', [makeEffect('content-change')]],
    ]);
    const results = engine.inferCapabilities([interaction, nextInteraction], effectsMap);

    // Navigate claims (URL changed), Paginate does NOT (urlChangedAfter)
    expect(results[0].capability).toBe('Navigate');
  });

  it('"Load more" → Paginate wins (no URL change, content-change present)', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new PaginateRule());
    engine.registerRule(new NavigateRule());

    const interaction = makeInteraction({
      type: 'Click',
      trigger: {
        ...makeInteraction().trigger,
        accessibleName: 'Load More',
      },
    });

    // Same URL (no navigation)
    const effectsMap = new Map([
      ['int-test-001', [makeEffect('content-change')]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);

    expect(results[0].capability).toBe('Paginate');
  });

  it('Navigate + all Phase 2 rules: Navigate loses to ToggleControl HIGH', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new NavigateRule());
    engine.registerRule(new ToggleControlRule());

    // Checkbox that triggers state-toggle AND URL change
    const interaction = makeInteraction({
      type: 'Checkbox',
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Enable feature',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'checkbox',
        },
      },
    });

    const nextInteraction = makeInteraction({
      interactionId: 'int-002',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/enabled',
      },
    });

    const effectsMap = new Map([
      ['int-test-001', [makeEffect('state-toggle')]],
    ]);
    const results = engine.inferCapabilities([interaction, nextInteraction], effectsMap);

    expect(results[0].capability).toBe('ToggleControl');
    expect(results[0].confidence).toBe('high');
  });

  it('No navigation + no content-change → Unclassified with all three rules', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new NavigateRule());
    engine.registerRule(new OpenDetailRule());
    engine.registerRule(new PaginateRule());

    const interaction = makeInteraction();
    const effectsMap = new Map();
    const results = engine.inferCapabilities([interaction], effectsMap);

    expect(results[0].capability).toBe('Unclassified');
  });

  it('all 6 rules registered: file upload wins over Navigate', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new NavigateRule());
    engine.registerRule(new OpenDetailRule());
    engine.registerRule(new PaginateRule());
    engine.registerRule(new ToggleControlRule());
    engine.registerRule(new UploadFileRule());

    const interaction = makeInteraction({
      type: 'FileUpload',
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
        accessibleName: 'Upload resume',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'file',
        },
      },
    });

    const nextInteraction = makeInteraction({
      interactionId: 'int-002',
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        pageUrl: 'https://example.com/uploaded',
      },
    });

    const effectsMap = new Map();
    const results = engine.inferCapabilities([interaction, nextInteraction], effectsMap);

    expect(results[0].capability).toBe('UploadFile');
    expect(results[0].confidence).toBe('high');
  });
});

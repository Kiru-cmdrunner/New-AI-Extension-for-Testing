/**
 * Phase 2 — Physical-Evidence Capability Rules Tests
 *
 * Tests for ToggleControl, ExpandCollapse, and UploadFile rules.
 *
 * Architecture: .drytis/specs/capability-model-finalized.md (Phase 2)
 */

import { describe, it, expect } from 'vitest';
import { ToggleControlRule } from '../../src/capabilities/rules/toggle-control';
import { ExpandCollapseRule } from '../../src/capabilities/rules/expand-collapse';
import { UploadFileRule } from '../../src/capabilities/rules/upload-file';
import { CapabilityEngine } from '../../src/capabilities/capability-engine';
import type { ExtractedEvidence } from '../../src/capabilities/evidence-extractor';
import type { SemanticEffect } from '../../src/semantics/effect-types';
import type { ComponentInteraction, InteractionType } from '../../src/shared/component-types';

// ── Test Evidence Builder ─────────────────────────────────────────────

/**
 * Build ExtractedEvidence for rule unit tests.
 * Overrides let each test specify exactly what signals are present.
 */
function makeEvidence(overrides: {
  hasStateToggle?: boolean;
  hasExpandCollapse?: boolean;
  hasContentChange?: boolean;
  hasVisibilityChange?: boolean;
  hasRemoteEffect?: boolean;
  hasDirectPropertyEvidence?: boolean;
  netNodeDelta?: number | null;
  isCheckboxLike?: boolean;
  isSliderLike?: boolean;
  isSubmitType?: boolean;
  isFileInput?: boolean;
  interactionType?: InteractionType;
  tag?: string;
  ariaRole?: string | null;
  accessibleName?: string;
  href?: string | null;
  keywordMatches?: Array<{ capability: string; matched: string[] }>;
  ancestorRoles?: string[];
  ancestorClasses?: string[];
  precededByTextEntryOnSameForm?: boolean;
  urlChanged?: boolean;
  urlChangedAfter?: boolean;
  previousInteractionType?: InteractionType | null;
  effects?: SemanticEffect[];
}): ExtractedEvidence {
  const effects = overrides.effects ?? [];
  return {
    interactionId: 'int-test-001',
    physical: {
      interactionType: overrides.interactionType ?? 'Click',
      tag: overrides.tag ?? 'BUTTON',
      ariaRole: overrides.ariaRole ?? null,
      accessibleName: overrides.accessibleName ?? 'Test Element',
      href: overrides.href ?? null,
      isCheckboxLike: overrides.isCheckboxLike ?? false,
      isSliderLike: overrides.isSliderLike ?? false,
      isSubmitType: overrides.isSubmitType ?? false,
      isFileInput: overrides.isFileInput ?? false,
      ancestorRoles: overrides.ancestorRoles ?? [],
      ancestorClasses: overrides.ancestorClasses ?? [],
    },
    behavioral: {
      effects,
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

/**
 * Build a semantic effect for evidence injection.
 */
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

/**
 * Build a minimal ComponentInteraction for engine-level tests.
 */
function makeInteraction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  const base: ComponentInteraction = {
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
  return base;
}

// ────────────────────────────────────────────────────────────────────────
// ToggleControl Rule
// ────────────────────────────────────────────────────────────────────────
describe('ToggleControlRule', () => {
  const rule = new ToggleControlRule();

  it('state-toggle + checkbox type + direct property → HIGH', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      isCheckboxLike: true,
      hasDirectPropertyEvidence: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('ToggleControl');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(20);
    expect(claim!.hasDirectProperty).toBe(true);
    expect(claim!.parameters.target).toBe('Test Element');
  });

  it('state-toggle + direct property only (no checkbox type) → MEDIUM', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: true,
      isCheckboxLike: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('state-toggle + checkbox type (no direct property) → MEDIUM', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: false,
      isCheckboxLike: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('state-toggle only, no supporting → LOW', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: false,
      isCheckboxLike: false,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('low');
  });

  it('state-toggle + keyword "enable" → keyword adds supporting', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: true,
      keywordMatches: [{ capability: 'ToggleControl', matched: ['enable'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('keyword')).toBe(true);
    expect(claim!.confidence).toBe('medium'); // behavioral + keyword = 2 streams but only 1 non-keyword
  });

  it('state-toggle + checkbox + direct property + keyword → HIGH (3 signals)', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      isCheckboxLike: true,
      hasDirectPropertyEvidence: true,
      keywordMatches: [{ capability: 'ToggleControl', matched: ['enable'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
    expect(claim!.supportingSignalCount).toBe(3);
  });

  it('NO state-toggle → returns null', () => {
    const evidence = makeEvidence({
      hasStateToggle: false,
      isCheckboxLike: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('only content-change, no state-toggle → null', () => {
    const evidence = makeEvidence({
      hasStateToggle: false,
      hasContentChange: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('reason string contains effect description', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: true,
      effects: [makeEffect('state-toggle')],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('state-toggle');
  });

  it('signalStreams contains behavioral for direct-property', () => {
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: true,
      isCheckboxLike: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('behavioral')).toBe(true);
    expect(claim!.signalStreams.has('physical-type')).toBe(true);
  });

  it('"Email notifications" checkbox with remote content-change → claims HIGH', () => {
    // The stress-test case: checkbox toggles + "Settings saved" appears elsewhere
    const evidence = makeEvidence({
      hasStateToggle: true,
      hasDirectPropertyEvidence: true,
      isCheckboxLike: true,
      hasContentChange: true,
      hasRemoteEffect: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });
});

// ────────────────────────────────────────────────────────────────────────
// ExpandCollapse Rule
// ────────────────────────────────────────────────────────────────────────
describe('ExpandCollapseRule', () => {
  const rule = new ExpandCollapseRule();

  it('expand-collapse + click type + direct property → HIGH', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      interactionType: 'Click',
      hasDirectPropertyEvidence: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('ExpandCollapse');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(20);
  });

  it('expand-collapse + link type + direct property → HIGH', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      interactionType: 'Link',
      hasDirectPropertyEvidence: true,
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('high');
  });

  it('expand-collapse + direct property only → MEDIUM', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      hasDirectPropertyEvidence: true,
      interactionType: 'Hover', // not Click or Link
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('medium');
  });

  it('expand-collapse + keyword "more" → adds keyword stream', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      hasDirectPropertyEvidence: true,
      interactionType: 'Click',
      keywordMatches: [{ capability: 'ExpandCollapse', matched: ['more'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('keyword')).toBe(true);
    expect(claim!.confidence).toBe('high');
  });

  it('expand-collapse only, no supporting → LOW', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      hasDirectPropertyEvidence: false,
      interactionType: 'Hover',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.confidence).toBe('low');
  });

  it('NO expand-collapse → returns null', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: false,
      hasStateToggle: true,
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('details open attribute → expand-collapse fires', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      hasDirectPropertyEvidence: true,
      interactionType: 'Click',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('ExpandCollapse');
  });

  it('reason string contains effect description', () => {
    const evidence = makeEvidence({
      hasExpandCollapse: true,
      hasDirectPropertyEvidence: true,
      interactionType: 'Click',
      effects: [makeEffect('expand-collapse')],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('expand-collapse');
  });
});

// ────────────────────────────────────────────────────────────────────────
// UploadFile Rule
// ────────────────────────────────────────────────────────────────────────
describe('UploadFileRule', () => {
  const rule = new UploadFileRule();

  it('FileUpload type → always HIGH', () => {
    const evidence = makeEvidence({
      isFileInput: true,
      tag: 'INPUT',
      interactionType: 'FileUpload',
    });
    const claim = rule.evaluate(evidence);
    expect(claim).not.toBeNull();
    expect(claim!.capability).toBe('UploadFile');
    expect(claim!.confidence).toBe('high');
    expect(claim!.priority).toBe(10); // most specific
  });

  it('FileUpload + keyword "upload" → keyword stream present', () => {
    const evidence = makeEvidence({
      isFileInput: true,
      tag: 'INPUT',
      interactionType: 'FileUpload',
      keywordMatches: [{ capability: 'UploadFile', matched: ['upload'] }],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('keyword')).toBe(true);
    expect(claim!.confidence).toBe('high');
  });

  it('FileUpload + form ancestor → structural stream present', () => {
    const evidence = makeEvidence({
      isFileInput: true,
      tag: 'INPUT',
      interactionType: 'FileUpload',
      ancestorRoles: ['form'],
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('structural')).toBe(true);
  });

  it('NOT FileUpload → returns null', () => {
    const evidence = makeEvidence({
      isFileInput: false,
      interactionType: 'Click',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Click type → returns null', () => {
    const evidence = makeEvidence({
      isFileInput: false,
      interactionType: 'Click',
      tag: 'BUTTON',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('Checkbox type → returns null', () => {
    const evidence = makeEvidence({
      isFileInput: false,
      isCheckboxLike: true,
      interactionType: 'Checkbox',
    });
    expect(rule.evaluate(evidence)).toBeNull();
  });

  it('reason string says definitive', () => {
    const evidence = makeEvidence({
      isFileInput: true,
      tag: 'INPUT',
      interactionType: 'FileUpload',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.reason).toContain('definitive');
  });

  it('physical-type stream always present for FileUpload', () => {
    const evidence = makeEvidence({
      isFileInput: true,
      interactionType: 'FileUpload',
    });
    const claim = rule.evaluate(evidence);
    expect(claim!.signalStreams.has('physical-type')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Engine Integration — Conflict Resolution
// ────────────────────────────────────────────────────────────────────────
describe('Phase 2 Engine Integration', () => {
  it('ToggleControl HIGH beats FilterSelection LOW', () => {
    // Build an interaction that produces both state-toggle (ToggleControl)
    // and remote content-change (would be FilterSelection — not implemented
    // yet, but we test with the rules we have).
    const engine = new CapabilityEngine();
    engine.registerRule(new ToggleControlRule());

    // Checkbox with state-toggle + remote content change
    const interaction = makeInteraction({
      type: 'Checkbox',
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Email notifications',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'checkbox',
        },
      },
      behavioralObservations: [{
        sourceEventId: 'evt-001',
        sourceEventType: 'click',
        windowId: 'obs-001',
        openedAt: 1000,
        closedAt: 4000,
        durationMs: 3000,
        endReason: 'completed',
        beforeSnapshot: null,
        finalSnapshot: null,
        mutations: [],
        mutationCount: 0,
        documentWideMutationTotal: 0,
        performanceCondition: null,
        semanticEffects: [
          makeEffect('state-toggle'),
          {
            ...makeEffect('content-change'),
            affectedTarget: { role: null, label: null, cssPath: '#settings-saved' },
          },
        ],
      }],
    });

    const effectsMap = new Map();
    // The engine extracts effects from the effectsMap, not behavioralObservations.
    // For this test, manually populate effectsMap.
    effectsMap.set('int-test-001', [
      makeEffect('state-toggle'),
      {
        ...makeEffect('content-change'),
        affectedTarget: { role: null, label: null, cssPath: '#settings-saved' },
      },
    ]);

    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('ToggleControl');
    expect(results[0].confidence).toBe('high');
  });

  it('three rules registered: only matching rule claims', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new ToggleControlRule());
    engine.registerRule(new ExpandCollapseRule());
    engine.registerRule(new UploadFileRule());

    // Interaction is a file upload — only UploadFile should claim
    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        tag: 'INPUT',
        accessibleName: 'Upload Photo',
      },
      triggerEvent: {
        ...makeInteraction().triggerEvent,
        domContext: {
          ...makeInteraction().triggerEvent.domContext,
          inputType: 'file',
        },
      },
      type: 'FileUpload',
    });

    const effectsMap = new Map();
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('UploadFile');
    expect(results[0].confidence).toBe('high');
    expect(results[0].alternatives).toEqual([]);
  });

  it('no matching rule → Unclassified', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new ToggleControlRule());
    engine.registerRule(new ExpandCollapseRule());
    engine.registerRule(new UploadFileRule());

    // Generic click with no toggle/expand/file effects
    const interaction = makeInteraction();
    const effectsMap = new Map();
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('Unclassified');
    expect(results[0].alternatives).toEqual([]);
  });

  it('evidence trail populated for ToggleControl', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new ToggleControlRule());

    const interaction = makeInteraction({
      trigger: {
        ...makeInteraction().trigger,
        accessibleName: 'Dark Mode',
        tag: 'DIV',
        ariaRole: 'checkbox',
      },
    });
    const effectsMap = new Map([
      ['int-test-001', [makeEffect('state-toggle')]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].evidence.physicalType).toBe('Click');
    expect(results[0].evidence.targetLabel).toBe('Dark Mode');
    expect(results[0].evidence.semanticEffects).toContain('state-toggle');
    expect(results[0].capabilityId).toBe('cap-int-test-001');
  });

  it('ExpandCollapse and ToggleControl do not conflict (different effects)', () => {
    const engine = new CapabilityEngine();
    engine.registerRule(new ToggleControlRule());
    engine.registerRule(new ExpandCollapseRule());

    // Interaction with expand-collapse effect only
    const interaction = makeInteraction();
    const effectsMap = new Map([
      ['int-test-001', [makeEffect('expand-collapse')]],
    ]);
    const results = engine.inferCapabilities([interaction], effectsMap);
    expect(results[0].capability).toBe('ExpandCollapse');
    expect(results[0].alternatives).toEqual([]);
  });
});

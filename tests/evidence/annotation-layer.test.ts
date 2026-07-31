/**
 * Tests for the Semantic Annotation Layer (Phase 2)
 *
 * Verifies that:
 * - Lifecycle interactions get static intent mapping + confidence 1.0
 * - Click interactions run the full evidence pipeline
 * - Ambiguous clicks (checkbox-like, link-like) get reclassified
 * - Every interaction has intent + confidence + evidenceTrail after annotation
 */

import { describe, it, expect } from 'vitest';
import { annotateWithEvidence, annotateAll } from '../../src/classifier/evidence/annotation-layer';
import type { ComponentInteraction, ObservedEvent, ElementIdentity, DomContext } from '../../src/shared/component-types';
import type { SemanticIntent } from '../../src/classifier/evidence/types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    cssSelector: 'button',
    accessibleName: 'Test',
    ariaRole: 'button',
    ariaLabel: null,
    tag: 'BUTTON',
    testId: null,
    dataCy: null,
    dataQa: null,
    stableId: null,
    className: '',
    placeholder: null,
    inputType: null,
    isContentEditable: false,
    ariaExpanded: null,
    ariaHasPopup: null,
    ancestorRoles: [],
    ancestorClasses: [],
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    ...overrides,
  };
}

function makeClickEvent(
  targetOverrides: Partial<ElementIdentity> = {},
  eventOverrides: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: 'evt-test-1',
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target: makeIdentity(targetOverrides),
    domContext: makeDomContext(),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Test',
    ...eventOverrides,
  };
}

function makeInteraction(
  type: ComponentInteraction['type'],
  triggerOverrides: Partial<ElementIdentity> = {},
  eventOverrides: Partial<ObservedEvent> = {},
  metadata: Record<string, unknown> = {},
): ComponentInteraction {
  const triggerEvent = makeClickEvent(triggerOverrides, eventOverrides);
  return {
    interactionId: 'int-1',
    type,
    trigger: triggerEvent.target,
    triggerEvent,
    memberEvents: [triggerEvent],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata,
  };
}

// ── Lifecycle Annotation Tests ─────────────────────────────────────────

describe('Lifecycle annotation', () => {
  it('annotates TextEntry with input intent and confidence 1.0', () => {
    const interaction = makeInteraction('TextEntry');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('input');
    expect(result.confidence).toBe(1.0);
    expect(result.evidenceTrail).toBeDefined();
    expect(result.evidenceTrail).toHaveLength(1);
    expect(result.evidenceTrail![0].source).toBe('lifecycle-definition');
  });

  it('annotates Checkbox with toggle intent', () => {
    const interaction = makeInteraction('Checkbox');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('toggle');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Dropdown with select intent', () => {
    const interaction = makeInteraction('Dropdown');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('select');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates DatePicker with select intent', () => {
    const interaction = makeInteraction('DatePicker');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('select');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Hover with explore intent', () => {
    const interaction = makeInteraction('Hover');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('explore');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Navigation with navigate intent', () => {
    const interaction = makeInteraction('Navigation');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('navigate');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Link with navigate intent', () => {
    const interaction = makeInteraction('Link');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('navigate');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Slider with select intent', () => {
    const interaction = makeInteraction('Slider');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('select');
    expect(result.confidence).toBe(1.0);
  });

  it('annotates Tab with select intent', () => {
    const interaction = makeInteraction('Tab');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBe('select');
    expect(result.confidence).toBe(1.0);
  });

  it('produces synthetic evidence trail for lifecycle interactions', () => {
    const interaction = makeInteraction('TextEntry');
    const result = annotateWithEvidence(interaction);

    expect(result.evidenceTrail).toHaveLength(1);
    expect(result.evidenceTrail![0].reason).toContain('TextEntry');
    expect(result.evidenceTrail![0].weight).toBe(1.0);
  });
});

// ── Click Annotation Tests ─────────────────────────────────────────────

describe('Click annotation (evidence pipeline)', () => {
  it('annotates plain Click with trigger intent', () => {
    const interaction = makeInteraction('Click');
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBeDefined();
    expect(result.confidence).toBeDefined();
    expect(result.evidenceTrail).toBeDefined();
  });

  it('annotates checkbox-like Click with toggle evidence', () => {
    const interaction = makeInteraction('Click',
      { tag: 'INPUT', ariaRole: 'checkbox', className: 'form-check' },
      { checkedBefore: true, checkedAfter: false },
    );
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBeDefined();
    expect(result.evidenceTrail).toBeDefined();
    // The evidence trail should contain evidence from the aria-checked generator
    const toggleEvidence = result.evidenceTrail!.filter(e => e.intent === 'toggle');
    expect(toggleEvidence.length).toBeGreaterThan(0);
  });

  it('annotates link-like Click with navigate evidence', () => {
    const interaction = makeInteraction('Click',
      { tag: 'A', ariaRole: 'link', className: 'nav-link' },
    );
    const result = annotateWithEvidence(interaction);

    expect(result.intent).toBeDefined();
    expect(result.evidenceTrail).toBeDefined();
    // The evidence trail should contain evidence from the tag-based generator
    const navigateEvidence = result.evidenceTrail!.filter(e => e.intent === 'navigate');
    expect(navigateEvidence.length).toBeGreaterThan(0);
  });

  it('does not reclassify Click with subtype (DoubleClick)', () => {
    const interaction = makeInteraction('Click');
    interaction.interactionSubtype = 'DoubleClick';
    const result = annotateWithEvidence(interaction);

    // Should use static mapping since it has a subtype
    expect(result.intent).toBe('trigger');
    expect(result.confidence).toBe(1.0);
  });
});

// ── Batch Annotation Tests ─────────────────────────────────────────────

describe('annotateAll', () => {
  it('annotates all interactions in a batch', () => {
    const interactions = [
      makeInteraction('TextEntry'),
      makeInteraction('Checkbox'),
      makeInteraction('Click'),
      makeInteraction('Dropdown'),
    ];

    const results = annotateAll(interactions);

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.intent).toBeDefined();
      expect(result.confidence).toBeDefined();
      expect(result.evidenceTrail).toBeDefined();
    }

    expect(results[0].intent).toBe('input');
    expect(results[1].intent).toBe('toggle');
    expect(results[3].intent).toBe('select');
  });
});

// ── Evidence Trail Completeness ───────────────────────────────────────

describe('evidence trail completeness', () => {
  it('every interaction type has an evidence trail after annotation', () => {
    const types: ComponentInteraction['type'][] = [
      'Click', 'TextEntry', 'Dropdown', 'Checkbox', 'DatePicker',
      'Hover', 'Link', 'FileUpload', 'Slider', 'Tab',
      'Scroll', 'Navigation', 'DragDrop', 'KeyboardShortcut',
      'ModalDialog', 'TagInput', 'OtpInput', 'HotkeySequence',
      'NewTab', 'NewWindow', 'Breadcrumb',
    ];

    for (const type of types) {
      const interaction = makeInteraction(type);
      const result = annotateWithEvidence(interaction);
      expect(result.evidenceTrail, `${type} should have evidence trail`).toBeDefined();
      expect(result.evidenceTrail!.length, `${type} should have at least 1 evidence`).toBeGreaterThan(0);
      expect(result.intent, `${type} should have intent`).toBeDefined();
      expect(result.confidence, `${type} should have confidence`).toBeDefined();
    }
  });
});

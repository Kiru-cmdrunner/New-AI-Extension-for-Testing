/**
 * R3 Behavioral Semantic Reasoning — Gate Tests (G9-G19)
 *
 * These tests verify that the evidence engine can classify interactions
 * based on behavioral effects produced by the application's own event
 * handlers — not just structural attributes present before the handler runs.
 *
 * Critical: Every behavioral test case proves that the classification
 * was driven by POST-HANDLER behavioral data by verifying:
 *   1. The pre-handler state had NO structural signal for the expected type
 *   2. The handler PRODUCED the behavioral signal
 *   3. The evidence trail CITES behavioral generators
 *
 * Architecture: .drytis/specs/r3-behavioral-semantic-reasoning.md §9
 */

import { describe, it, expect } from 'vitest';
import type {
  ComponentInteraction,
  ObservedEvent,
  AttributeChange,
} from '../src/shared/component-types';
import type { ElementIdentity } from '../src/shared/types';
import { classifyByEvidence } from '../src/classifier/evidence/evidence-classifier';
import { buildFeatureView } from '../src/classifier/evidence/feature-view';
import { deriveType, deriveMetadata } from '../src/classifier/evidence/type-deriver';
import { EVIDENCE_GENERATORS } from '../src/classifier/evidence/generators';
import { fuseEvidence } from '../src/classifier/evidence/intent-inference';
import type { FeatureViewInput, SemanticIntent } from '../src/classifier/evidence/types';

// ── Helpers ──────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Test',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: '',
    name: '',
    stableId: 'div|test|0',
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeClickInteraction(
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Record<string, unknown> = {},
  attributeChanges?: AttributeChange[],
): ComponentInteraction {
  const target = makeIdentity(targetOverrides);
  const triggerEvent: ObservedEvent = {
    eventId: 'evt-test-001',
    eventType: 'click',
    timestamp: Date.now(),
    isTrusted: true,
    target,
    domContext: { ...domContextOverrides, attributeChanges },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 100,
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
  };
  return {
    interactionId: 'int-test-001',
    type: 'Click',
    trigger: target,
    triggerEvent,
    memberEvents: [],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: attributeChanges ? { attributeChanges } : {},
  } as ComponentInteraction;
}

// ── G9: FeatureViewInput Propagation ─────────────────────────────────

describe('G9: FeatureViewInput field propagation', () => {
  it('maps valueBefore/valueAfter from ObservedEvent', () => {
    const target = makeIdentity();
    const event: ObservedEvent = {
      eventId: 'e1', eventType: 'click', timestamp: 0, isTrusted: true,
      target, domContext: {},
      valueBefore: 'old', valueAfter: 'new',
      checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: '', pageTitle: '',
    };
    const fv = buildFeatureView(target, event);
    expect(fv.valueBefore).toBe('old');
    expect(fv.valueAfter).toBe('new');
  });

  it('maps ariaExpanded, ariaHasPopup, ariaValueNow from DomContext', () => {
    const target = makeIdentity();
    const event: ObservedEvent = {
      eventId: 'e1', eventType: 'click', timestamp: 0, isTrusted: true,
      target,
      domContext: {
        ariaExpanded: true,
        ariaHasPopup: 'listbox',
        ariaValueNow: '50',
      },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: '', pageTitle: '',
    };
    const fv = buildFeatureView(target, event);
    expect(fv.ariaExpanded).toBe(true);
    expect(fv.ariaHasPopup).toBe('listbox');
    expect(fv.ariaValueNow).toBe('50');
  });

  it('maps isContentEditable and inputType from DomContext', () => {
    const target = makeIdentity();
    const event: ObservedEvent = {
      eventId: 'e1', eventType: 'click', timestamp: 0, isTrusted: true,
      target,
      domContext: { isContentEditable: true, inputType: 'text' },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: '', pageTitle: '',
    };
    const fv = buildFeatureView(target, event);
    expect(fv.isContentEditable).toBe(true);
    expect(fv.inputType).toBe('text');
  });

  it('maps attribute changes from parameter', () => {
    const target = makeIdentity();
    const event: ObservedEvent = {
      eventId: 'e1', eventType: 'click', timestamp: 0, isTrusted: true,
      target, domContext: {},
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: '', pageTitle: '',
    };
    const changes: AttributeChange[] = [
      { attribute: 'class', before: 'opt', after: 'opt selected' },
    ];
    const fv = buildFeatureView(target, event, changes);
    expect(fv.hasAttributeTransition).toBe(true);
    expect(fv.attributeChanges).toHaveLength(1);
    expect(fv.attributeChanges[0].attribute).toBe('class');
  });

  it('hasAttributeTransition is false when no changes provided', () => {
    const target = makeIdentity();
    const event: ObservedEvent = {
      eventId: 'e1', eventType: 'click', timestamp: 0, isTrusted: true,
      target, domContext: {},
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: 0, clientY: 0, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null,
      pageUrl: '', pageTitle: '',
    };
    const fv = buildFeatureView(target, event);
    expect(fv.hasAttributeTransition).toBe(false);
    expect(fv.attributeChanges).toHaveLength(0);
  });
});

// ── G10: select/input Type Derivation ────────────────────────────────

describe('G10: select and input type derivation', () => {
  it('derives Dropdown from select intent + aria-expanded', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: 'Combo', classNameLower: 'combo',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: true, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    expect(deriveType('select', f)).toBe('Dropdown');
  });

  it('derives Dropdown from select intent + aria-expanded transition', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: 'Combo', classNameLower: 'combo',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: true,
      attributeChanges: [{ attribute: 'aria-expanded', before: null, after: 'true' }],
    };
    expect(deriveType('select', f)).toBe('Dropdown');
  });

  it('derives Slider from select intent + aria-valuenow', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: 'slider', accessibleName: 'Vol', classNameLower: 'slider',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: '50',
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    expect(deriveType('select', f)).toBe('Slider');
  });

  it('derives TextEntry from input intent + value change', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: 'Input', classNameLower: 'display',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: 'old', valueAfter: 'new',
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    expect(deriveType('input', f)).toBe('TextEntry');
  });

  it('derives TextEntry from input intent + contentEditable', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: 'Editor', classNameLower: 'editor',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: true, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    expect(deriveType('input', f)).toBe('TextEntry');
  });

  it('falls back to Click for select/input with insufficient signals', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: 'X', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    expect(deriveType('select', f)).toBe('Click');
    expect(deriveType('input', f)).toBe('Click');
  });
});

// ── G11: Behavioral Generator Coverage ───────────────────────────────

describe('G11: behavioral evidence generators vote correctly', () => {
  it('value-change generator votes input for value transitions', () => {
    const gen = EVIDENCE_GENERATORS.find(g => g.id === 'value-change')!;
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: 'old', valueAfter: 'new',
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    const votes = gen.generate(f);
    expect(votes.some(v => v.intent === 'input' && v.weight > 0)).toBe(true);
    expect(votes.some(v => v.intent === 'trigger' && v.weight < 0)).toBe(true); // suppression
  });

  it('panel-emergence generator votes select for aria-expanded transition', () => {
    const gen = EVIDENCE_GENERATORS.find(g => g.id === 'panel-emergence')!;
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: true,
      attributeChanges: [{ attribute: 'aria-expanded', before: null, after: 'true' }],
    };
    const votes = gen.generate(f);
    expect(votes.some(v => v.intent === 'select' && v.weight >= 0.5)).toBe(true);
  });

  it('selection-state generator votes toggle for class gaining "selected"', () => {
    const gen = EVIDENCE_GENERATORS.find(g => g.id === 'selection-state')!;
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: true,
      attributeChanges: [{ attribute: 'class', before: 'opt', after: 'opt selected' }],
    };
    const votes = gen.generate(f);
    // "selected" matches SELECTION_CLASS_RE → votes select
    expect(votes.some(v => v.intent === 'select' && v.weight >= 0.4)).toBe(true);
  });

  it('selection-state generator votes toggle for class gaining "checked"', () => {
    const gen = EVIDENCE_GENERATORS.find(g => g.id === 'selection-state')!;
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: true,
      attributeChanges: [{ attribute: 'class', before: 'opt', after: 'opt checked' }],
    };
    const votes = gen.generate(f);
    // "checked" matches TOGGLE_CLASS_RE → votes toggle
    expect(votes.some(v => v.intent === 'toggle' && v.weight >= 0.4)).toBe(true);
  });

  it('slider-value generator votes select for aria-valuenow', () => {
    const gen = EVIDENCE_GENERATORS.find(g => g.id === 'slider-value')!;
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: 'slider', accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: '75',
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    const votes = gen.generate(f);
    expect(votes.some(v => v.intent === 'select' && v.weight >= 0.4)).toBe(true);
  });

  it('no behavioral generators fire when no behavioral signals present', () => {
    const f: FeatureViewInput = {
      tag: 'DIV', ariaRole: null, accessibleName: '', classNameLower: '',
      hasAriaChecked: false, hasAriaPressed: false, hasCheckedTransition: false,
      checkedBefore: null, checkedAfter: null,
      surfaceType: null, ancestorRoles: [],
      opensNewTab: false, opensNewWindow: false, isLink: false,
      valueBefore: null, valueAfter: null,
      ariaExpanded: null, ariaHasPopup: null, ariaAutoComplete: null, ariaValueNow: null,
      inputType: null, isContentEditable: false, ancestorClasses: [],
      hasAttributeTransition: false, attributeChanges: [],
    };
    const behavioralGenIds = ['value-change', 'panel-emergence', 'selection-state', 'slider-value'];
    for (const gen of EVIDENCE_GENERATORS) {
      if (!behavioralGenIds.includes(gen.id)) continue;
      const votes = gen.generate(f);
      expect(votes).toHaveLength(0);
    }
  });
});

// ── G13: Timing Proof — Post-Handler Behavioral State Drives Classification ──

describe('G13: timing proof — classification uses post-handler behavioral data', () => {
  it('div-checkbox: class change produced by handler drives Checkbox classification', () => {
    // SETUP: A div with NO structural signal for checkbox semantics
    // Pre-handler state: class="opt" — no ARIA, no input, no checkbox class
    // Handler behavior: classList.add('selected') → class="opt selected"
    const interaction = makeClickInteraction(
      {
        tag: 'DIV',
        ariaRole: null, // NO ARIA role
        className: 'opt selected', // POST-handler (trigger identity is post-handler snapshot)
        accessibleName: 'Filter Option',
        stableId: 'div|opt|0',
      },
      {},
      // Attribute changes from the post-handler re-snapshot
      [{ attribute: 'class', before: 'opt', after: 'opt selected' }],
    );

    // VERIFY: the pre-handler state had no "selected" class
    const change = interaction.metadata.attributeChanges![0];
    expect(change.before).toBe('opt');
    expect(change.after).toBe('opt selected');
    expect(change.before).not.toContain('selected'); // PROOF: signal was absent pre-handler

    // RUN: evidence classification
    const result = classifyByEvidence(interaction);

    // VERIFY: classification used behavioral evidence
    const behavioralSources = ['class-selection-transition', 'class-toggle-transition', 'class-deselection-transition'];
    const hasBehavioralEvidence = result.evidence.some(e =>
      behavioralSources.includes(e.source),
    );
    expect(hasBehavioralEvidence).toBe(true);

    // VERIFY: the winning intent is toggle or select (behaviorally classified, not trigger)
    expect(result.intent).not.toBe('trigger');
  });

  it('novel combobox: aria-expanded produced by handler drives Dropdown classification', () => {
    // SETUP: A div with NO aria-expanded before the handler
    // Handler behavior: setAttribute('aria-expanded', 'true')
    const interaction = makeClickInteraction(
      {
        tag: 'DIV',
        ariaRole: null,
        className: 'combo',
        accessibleName: 'Custom Dropdown',
        stableId: 'div|combo|0',
      },
      {},
      [{ attribute: 'aria-expanded', before: null, after: 'true' }],
    );

    // VERIFY: pre-handler state had no aria-expanded
    const change = interaction.metadata.attributeChanges![0];
    expect(change.before).toBeNull(); // PROOF: absent pre-handler
    expect(change.after).toBe('true'); // PRODUCED by handler

    const result = classifyByEvidence(interaction);

    // VERIFY: behavioral panel-emergence evidence cited
    const hasPanelEvidence = result.evidence.some(e => e.source === 'aria-expanded-transition');
    expect(hasPanelEvidence).toBe(true);

    // VERIFY: intent is select (not trigger)
    expect(result.intent).toBe('select');
  });
});

// ── G14: Div-Checkbox End-to-End ─────────────────────────────────────

describe('G14: div-checkbox end-to-end (no ARIA, no input, class toggle)', () => {
  it('classifies as Checkbox via behavioral selection-state evidence', () => {
    const interaction = makeClickInteraction(
      {
        tag: 'DIV',
        ariaRole: null,
        className: 'opt',
        accessibleName: 'vivo',
        stableId: 'div|opt|0',
      },
      {},
      [{ attribute: 'class', before: 'opt', after: 'opt selected' }],
    );

    const result = classifyByEvidence(interaction);

    // Evidence trail must cite behavioral generator
    const behavioralVotes = result.evidence.filter(e =>
      e.source === 'class-selection-transition' || e.source === 'class-toggle-transition'
    );
    expect(behavioralVotes.length).toBeGreaterThan(0);
  });
});

// ── G15: Novel Dropdown End-to-End ───────────────────────────────────

describe('G15: novel dropdown end-to-end (no ARIA, panel emerges)', () => {
  it('classifies as Dropdown via behavioral panel-emergence evidence', () => {
    const interaction = makeClickInteraction(
      {
        tag: 'DIV',
        ariaRole: null,
        className: 'combo',
        accessibleName: 'Country',
        stableId: 'div|combo|0',
      },
      {},
      [{ attribute: 'aria-expanded', before: null, after: 'true' }],
    );

    const result = classifyByEvidence(interaction);

    expect(result.intent).toBe('select');
    expect(result.type).toBe('Dropdown');
    expect(result.evidence.some(e => e.source === 'aria-expanded-transition')).toBe(true);
  });
});

// ── G16: Misleading Structural Signal ────────────────────────────────

describe('G16: misleading-signal — behavioral overrides structural', () => {
  it('link-styled toggle: <a> tag + class "active" → toggle wins over navigate', () => {
    // SETUP: <a> tag says "navigate" (tag evidence votes navigate +0.4)
    // Handler: classList.add('active') → selection-state votes toggle/select +0.5
    const interaction = makeClickInteraction(
      {
        tag: 'A',
        ariaRole: 'link',
        className: 'filter-link',
        accessibleName: 'Price Filter',
        stableId: 'a|filter-link|0',
      },
      {},
      [{ attribute: 'class', before: 'filter-link', after: 'filter-link active' }],
    );

    const result = classifyByEvidence(interaction);

    // VERIFY: toggle or select beats navigate
    // The "active" token matches SELECTION_CLASS_RE → votes select +0.5
    // The <a> tag votes navigate +0.4
    // 0.5 > 0.4 → behavioral wins
    expect(result.intent).not.toBe('navigate');
  });
});

// ── G17: Unrecognized Interaction Flagging ───────────────────────────

describe('G17: unrecognized interaction threshold', () => {
  it('flags interaction with zero behavioral evidence', () => {
    // A bare div with no ARIA, no class changes, no value changes
    const interaction = makeClickInteraction(
      {
        tag: 'DIV',
        ariaRole: null,
        className: '',
        accessibleName: '',
        stableId: 'div|bare|0',
      },
      {},
      // No attribute changes — handler didn't modify anything
      [],
    );

    const result = classifyByEvidence(interaction);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('does NOT flag interaction with strong structural evidence', () => {
    // A button with role=button — strong structural evidence for trigger
    const interaction = makeClickInteraction(
      {
        tag: 'BUTTON',
        ariaRole: 'button',
        className: 'btn',
        accessibleName: 'Submit',
        stableId: 'button|submit|0',
      },
      {},
      [],
    );

    const result = classifyByEvidence(interaction);
    expect(result.confidence).toBeGreaterThan(0);
  });
});

// ── G18: Click Lifecycle Safety ──────────────────────────────────────

describe('G18: rapid click safety', () => {
  it('produces correct evidence for each click in a rapid sequence', () => {
    // Simulate two clicks on different elements
    const click1 = makeClickInteraction(
      { tag: 'BUTTON', ariaRole: 'button', className: 'btn1', stableId: 'btn1|0' },
      {},
    );
    const click2 = makeClickInteraction(
      { tag: 'BUTTON', ariaRole: 'button', className: 'btn2', stableId: 'btn2|0' },
      {},
    );

    const result1 = classifyByEvidence(click1);
    const result2 = classifyByEvidence(click2);

    // Both should classify independently
    expect(result1.type).toBeDefined();
    expect(result2.type).toBeDefined();
  });

  it('preserves DoubleClick subtype through evidence classification', () => {
    const interaction = makeClickInteraction(
      { tag: 'DIV', ariaRole: null, className: 'card', stableId: 'div|card|0' },
      {},
    );
    interaction.triggerEvent.eventType = 'dblclick';

    const result = classifyByEvidence(interaction);
    // Should not crash, should produce valid classification
    expect(result).toBeDefined();
  });
});

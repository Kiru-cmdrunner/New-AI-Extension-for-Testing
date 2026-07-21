/**
 * Integration tests — Stage 3b Integration & Execution JSON Verb Mapping.
 *
 * Phase 3 Integration Step 2.
 *
 * Verifies that:
 *   1. SemanticInteraction objects are correctly derived from CanonicalSteps.
 *   2. normalizeToCanonical() maps legacy types to canonical types.
 *   3. lookupExecutionVerb() is used exclusively (no inline mapActionType).
 *   4. Execution JSON verbs match the frozen verb-mapping-table for every type.
 *   5. End-to-end: timeline → classify → canonical-step → execution-json with verb table.
 *   6. Backward compatibility: legacy action types still produce correct verbs.
 *   7. Determinism: same input always produces same verb.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeToCanonical,
  stepToSemanticInteraction,
  stepsToSemanticInteractions,
} from '../src/generation/engine/step-to-semantic';
import { lookupExecutionVerb, VERB_MAPPING_TABLE } from '../src/generation/verb-mapping-table';
import { classifyInteractions } from '../src/generation/engine/semantic-classifier';
import { canonicalStepGenerator } from '../src/generation/generators/canonical-step-generator';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { CanonicalStep } from '../src/generation/types';
import type { CanonicalType } from '../src/shared/architecture-types';

// ── Helpers ────────────────────────────────────────────────

function makeStep(overrides: Partial<CanonicalStep> = {}): CanonicalStep {
  return {
    stepId: 'step-0001',
    stepNumber: 1,
    actionType: 'click',
    plainEnglish: 'Click "Test"',
    elementIdentity: {
      accessibleName: 'Test Button',
      ariaRole: 'button',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      name: null,
      stableId: 'btn-1',
      testId: null,
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'button.test',
      xPath: '//button',
      inIframe: false,
      shadowDom: false,
      elementId: 'btn-1',
    },
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: 'click-0001',
    value: null,
    checked: null,
    executionJson: null,
    timestamp: '2024-01-01T10:00:00Z',
    ...overrides,
  };
}

function makeRecordingContext() {
  return { startUrl: 'https://example.com', startTitle: 'Test', capturedAt: '2024-01-01T00:00:00Z' };
}

// ── normalizeToCanonical ───────────────────────────────────

describe('normalizeToCanonical — legacy type mapping', () => {
  it('maps legacy navigation → navigate', () => {
    expect(normalizeToCanonical('navigation')).toBe('navigate');
  });

  it('maps legacy text → fill', () => {
    expect(normalizeToCanonical('text')).toBe('fill');
  });

  it('maps legacy checkbox → toggle', () => {
    expect(normalizeToCanonical('checkbox')).toBe('toggle');
  });

  it('maps legacy radio → select', () => {
    expect(normalizeToCanonical('radio')).toBe('select');
  });

  it('maps legacy dateSelect → selectDate', () => {
    expect(normalizeToCanonical('dateSelect')).toBe('selectDate');
  });

  it('passes canonical navigate through', () => {
    expect(normalizeToCanonical('navigate')).toBe('navigate');
  });

  it('passes canonical fill through', () => {
    expect(normalizeToCanonical('fill')).toBe('fill');
  });

  it('passes canonical toggle through', () => {
    expect(normalizeToCanonical('toggle')).toBe('toggle');
  });

  it('passes canonical select through', () => {
    expect(normalizeToCanonical('select')).toBe('select');
  });

  it('passes canonical selectDate through', () => {
    expect(normalizeToCanonical('selectDate')).toBe('selectDate');
  });

  it('passes canonical hover through', () => {
    expect(normalizeToCanonical('hover')).toBe('hover');
  });

  it('passes canonical click through', () => {
    expect(normalizeToCanonical('click')).toBe('click');
  });

  it('defaults unknown types to click (L5)', () => {
    expect(normalizeToCanonical('unknown-type')).toBe('click');
    expect(normalizeToCanonical('')).toBe('click');
  });
});

// ── stepToSemanticInteraction ──────────────────────────────

describe('stepToSemanticInteraction — CanonicalStep → SemanticInteraction', () => {
  it('extracts canonicalType from step actionType', () => {
    const step = makeStep({ actionType: 'toggle', checked: true });
    const si = stepToSemanticInteraction(step);
    expect(si.canonicalType).toBe('toggle');
  });

  it('normalizes legacy actionType to canonical', () => {
    const step = makeStep({ actionType: 'checkbox', checked: true });
    const si = stepToSemanticInteraction(step);
    expect(si.canonicalType).toBe('toggle');
  });

  it('preserves actionId from linkedInteractionId', () => {
    const step = makeStep({ linkedInteractionId: 'text-0042' });
    const si = stepToSemanticInteraction(step);
    expect(si.actionId).toBe('text-0042');
  });

  it('preserves stepId', () => {
    const step = makeStep({ stepId: 'step-0099' });
    const si = stepToSemanticInteraction(step);
    expect(si.stepId).toBe('step-0099');
  });

  it('preserves value for fill steps', () => {
    const step = makeStep({ actionType: 'fill', value: 'hello@test.com' });
    const si = stepToSemanticInteraction(step);
    expect(si.value).toBe('hello@test.com');
  });

  it('preserves checked state for toggle steps', () => {
    const step = makeStep({ actionType: 'toggle', checked: false });
    const si = stepToSemanticInteraction(step);
    expect(si.checked).toBe(false);
  });

  it('returns null value for non-value steps', () => {
    const step = makeStep({ actionType: 'click', value: null });
    const si = stepToSemanticInteraction(step);
    expect(si.value).toBeNull();
  });

  it('returns null checked for non-toggle steps', () => {
    const step = makeStep({ actionType: 'fill', checked: null });
    const si = stepToSemanticInteraction(step);
    expect(si.checked).toBeNull();
  });
});

describe('stepsToSemanticInteractions — batch conversion', () => {
  it('converts all steps in order', () => {
    const steps = [
      makeStep({ stepId: 'step-0001', actionType: 'click' }),
      makeStep({ stepId: 'step-0002', actionType: 'fill', value: 'test' }),
      makeStep({ stepId: 'step-0003', actionType: 'toggle', checked: true }),
    ];

    const sis = stepsToSemanticInteractions(steps);
    expect(sis).toHaveLength(3);
    expect(sis[0].canonicalType).toBe('click');
    expect(sis[1].canonicalType).toBe('fill');
    expect(sis[2].canonicalType).toBe('toggle');
  });

  it('returns empty array for empty input', () => {
    expect(stepsToSemanticInteractions([])).toEqual([]);
  });
});

// ── lookupExecutionVerb via verb-mapping-table ─────────────

describe('lookupExecutionVerb — all 10 canonical types', () => {
  const cases: Array<{ type: CanonicalType; verb: string; checked?: boolean }> = [
    { type: 'navigate', verb: 'navigate' },
    { type: 'click', verb: 'click' },
    { type: 'fill', verb: 'fill' },
    { type: 'select', verb: 'select' },
    { type: 'toggle', verb: 'check', checked: true },
    { type: 'toggle', verb: 'uncheck', checked: false },
    { type: 'selectDate', verb: 'fill' },
    { type: 'hover', verb: 'hover' },
    { type: 'pressKey', verb: 'press' },
    { type: 'upload', verb: 'upload' },
    { type: 'drag', verb: 'drag' },
  ];

  for (const { type, verb, checked } of cases) {
    it(`${type}${checked !== undefined ? ` (checked=${checked})` : ''} → ${verb}`, () => {
      expect(lookupExecutionVerb(type, checked)).toBe(verb);
    });
  }
});

// ── Execution JSON uses verb-mapping-table exclusively ─────

describe('Execution JSON Generator — verb mapping via frozen table', () => {
  function runExecJson(actionType: string, checked: boolean | null = null, value: string | null = null) {
    const step = makeStep({ actionType, checked, value });
    const result = executionJsonGenerator.generate({ steps: [step] });
    return result.output![0].executionJson!.action.type;
  }

  it('click → click', () => {
    expect(runExecJson('click')).toBe('click');
  });

  it('navigate → navigate', () => {
    // Navigation step needs URL in accessibleName
    const step = makeStep({
      actionType: 'navigate',
      elementIdentity: { ...makeStep().elementIdentity, accessibleName: 'https://example.com' },
    });
    const result = executionJsonGenerator.generate({ steps: [step] });
    expect(result.output![0].executionJson!.action.type).toBe('navigate');
  });

  it('fill → fill', () => {
    expect(runExecJson('fill', null, 'test@example.com')).toBe('fill');
  });

  it('select → select', () => {
    expect(runExecJson('select', null, 'India')).toBe('select');
  });

  it('toggle (checked=true) → check', () => {
    expect(runExecJson('toggle', true)).toBe('check');
  });

  it('toggle (checked=false) → uncheck', () => {
    expect(runExecJson('toggle', false)).toBe('uncheck');
  });

  it('selectDate → fill', () => {
    expect(runExecJson('selectDate', null, '2026-07-15')).toBe('fill');
  });

  it('hover → hover', () => {
    expect(runExecJson('hover')).toBe('hover');
  });

  // Backward compatibility: legacy types still work
  it('legacy navigation → navigate', () => {
    const step = makeStep({
      actionType: 'navigation',
      elementIdentity: { ...makeStep().elementIdentity, accessibleName: 'https://example.com' },
    });
    const result = executionJsonGenerator.generate({ steps: [step] });
    expect(result.output![0].executionJson!.action.type).toBe('navigate');
  });

  it('legacy text → fill', () => {
    expect(runExecJson('text', null, 'test@example.com')).toBe('fill');
  });

  it('legacy checkbox (checked=true) → check', () => {
    expect(runExecJson('checkbox', true)).toBe('check');
  });

  it('legacy checkbox (checked=false) → uncheck', () => {
    expect(runExecJson('checkbox', false)).toBe('uncheck');
  });

  it('legacy radio → select', () => {
    expect(runExecJson('radio', null, 'Option A')).toBe('select');
  });

  it('legacy dateSelect → fill', () => {
    expect(runExecJson('dateSelect', null, '2026-07-15')).toBe('fill');
  });
});

// ── End-to-End Pipeline ────────────────────────────────────

describe('End-to-End: Timeline → Stage 3a → Stage 3b → Stage 4', () => {
  it('full mixed-type timeline produces correct verbs at every stage', () => {
    const timeline: any[] = [
      { actionId: 'nav-001', type: 'navigation', timestamp: '2024-01-01T10:00:00Z', url: 'https://example.com' },
      { actionId: 'clk-001', type: 'click', timestamp: '2024-01-01T10:01:00Z',
        className: null,
        elementIdentity: { tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Submit', cssSelector: 'button', xPath: '//button', elementId: 'btn1', inIframe: false, shadowDom: false } },
      { actionId: 'txt-001', type: 'text', timestamp: '2024-01-01T10:02:00Z', value: 'user@test.com',
        className: null,
        elementIdentity: { tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Email', cssSelector: 'input', xPath: '//input', elementId: 'inp1', inIframe: false, shadowDom: false } },
      { actionId: 'chk-001', type: 'checkbox', timestamp: '2024-01-01T10:03:00Z', checked: true,
        className: null,
        elementIdentity: { tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Remember', cssSelector: 'input', xPath: '//input', elementId: 'chk1', inIframe: false, shadowDom: false } },
      { actionId: 'rad-001', type: 'radio', timestamp: '2024-01-01T10:04:00Z',
        className: null,
        elementIdentity: { tag: 'INPUT', ariaRole: 'radio', accessibleName: 'Option A', cssSelector: 'input', xPath: '//input', elementId: 'rad1', inIframe: false, shadowDom: false } },
      { actionId: 'sel-001', type: 'select', timestamp: '2024-01-01T10:05:00Z', value: 'India',
        className: null,
        elementIdentity: { tag: 'SELECT', ariaRole: 'combobox', accessibleName: 'Country', cssSelector: 'select', xPath: '//select', elementId: 'sel1', inIframe: false, shadowDom: false } },
      { actionId: 'hov-001', type: 'hover', timestamp: '2024-01-01T10:06:00Z',
        className: null,
        elementIdentity: { tag: 'DIV', ariaRole: null, accessibleName: 'Menu', cssSelector: 'div', xPath: '//div', elementId: 'div1', inIframe: false, shadowDom: false } },
      { actionId: 'dat-001', type: 'dateSelect', timestamp: '2024-01-01T10:07:00Z', dateType: 'date', displayValue: '15 Jul 2026', isoValue: '2026-07-15',
        className: null,
        elementIdentity: { tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Depart', cssSelector: 'input', xPath: '//input', elementId: 'dat1', inIframe: false, shadowDom: false } },
    ];

    // Stage 3a: Classify
    const classified = classifyInteractions(timeline);
    const canonicalTypes = classified.map(c => c.canonicalType);
    expect(canonicalTypes).toEqual([
      'navigate', 'click', 'fill', 'toggle', 'select', 'select', 'hover', 'selectDate',
    ]);

    // Stage 3b: Generate Canonical Steps
    const stepResult = canonicalStepGenerator.generate({
      timeline,
      recordingContext: makeRecordingContext(),
      classified,
    });
    expect(stepResult.status).toBe('success');

    // Derive SemanticInteractions (Stage 3b → Stage 4 bridge)
    const semanticInteractions = stepsToSemanticInteractions(stepResult.output!);
    expect(semanticInteractions).toHaveLength(8);

    // Verify SemanticInteraction canonicalTypes
    expect(semanticInteractions.map(si => si.canonicalType)).toEqual(canonicalTypes);

    // Stage 4: Generate Execution JSON
    const jsonResult = executionJsonGenerator.generate({ steps: stepResult.output! });
    expect(jsonResult.status).toBe('success');

    // Verify execution verbs come from the frozen table
    const verbs = jsonResult.output!.map(s => s.executionJson!.action.type);
    expect(verbs).toEqual([
      'navigate', // navigate → navigate
      'click',    // click → click
      'fill',     // fill → fill
      'check',    // toggle (checked=true) → check
      'select',   // select (radio) → select
      'select',   // select (dropdown) → select
      'hover',    // hover → hover
      'fill',     // selectDate → fill
    ]);

    // Cross-verify against the frozen verb-mapping-table
    for (let i = 0; i < semanticInteractions.length; i++) {
      const si = semanticInteractions[i];
      const expectedVerb = lookupExecutionVerb(si.canonicalType, si.checked ?? undefined);
      expect(verbs[i]).toBe(expectedVerb);
    }
  });
});

// ── Determinism ────────────────────────────────────────────

describe('Determinism — same input → same verb', () => {
  it('produces identical verbs on repeated runs', () => {
    const steps = [
      makeStep({ stepId: 's1', actionType: 'click' }),
      makeStep({ stepId: 's2', actionType: 'fill', value: 'test' }),
      makeStep({ stepId: 's3', actionType: 'toggle', checked: true }),
      makeStep({ stepId: 's4', actionType: 'select', value: 'opt' }),
      makeStep({ stepId: 's5', actionType: 'selectDate', value: '2026-07-15' }),
      makeStep({ stepId: 's6', actionType: 'hover' }),
    ];

    const run1 = executionJsonGenerator.generate({ steps: [...steps] });
    const run2 = executionJsonGenerator.generate({ steps: [...steps] });

    const verbs1 = run1.output!.map(s => s.executionJson!.action.type);
    const verbs2 = run2.output!.map(s => s.executionJson!.action.type);

    expect(verbs1).toEqual(verbs2);
    expect(verbs1).toEqual(['click', 'fill', 'check', 'select', 'fill', 'hover']);
  });

  it('SemanticInteraction derivation is deterministic', () => {
    const step = makeStep({ actionType: 'toggle', checked: true });
    const si1 = stepToSemanticInteraction(step);
    const si2 = stepToSemanticInteraction(step);
    expect(si1).toEqual(si2);
  });
});

// ── Verb Mapping Table Completeness ────────────────────────

describe('VERB_MAPPING_TABLE — frozen table invariants', () => {
  it('has all 10 canonical types', () => {
    const types = Object.keys(VERB_MAPPING_TABLE);
    expect(types).toHaveLength(10);
    expect(types.sort()).toEqual([
      'click', 'drag', 'fill', 'hover', 'navigate',
      'pressKey', 'select', 'selectDate', 'toggle', 'upload',
    ]);
  });

  it('every entry has a valid ExecutionVerb', () => {
    for (const [, entry] of Object.entries(VERB_MAPPING_TABLE)) {
      expect(entry.executionVerb).toBeDefined();
      expect(typeof entry.executionVerb).toBe('string');
      expect(entry.note).toBeDefined();
      expect(entry.requiresValue).toBeDefined();
    }
  });

  it('toggle defaults to check when checked is undefined', () => {
    expect(lookupExecutionVerb('toggle')).toBe('check');
  });
});

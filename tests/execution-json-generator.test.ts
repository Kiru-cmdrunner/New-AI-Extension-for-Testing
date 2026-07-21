/**
 * Tests for the Execution JSON Generator.
 *
 * Milestone B5.3 (v5.0.0)
 *
 * Tests the generator's ability to produce valid B5.2-conformant Execution JSON
 * from Canonical Test Steps, including:
 *   - Click steps → element target with locators
 *   - Navigation steps → navigation target with empty locators
 *   - Error handling (no valid locators → error status)
 *   - B5.2 validation rules (VR-1 through VR-13)
 *   - Determinism
 *   - Per-step error isolation
 */

import { describe, it, expect } from 'vitest';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { CanonicalStep } from '../src/generation/types';
import type { ElementIdentity } from '../src/shared/types';

/** Helper: create a base ElementIdentity for click steps. */
function makeElementIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: 'Submit',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    name: null,
    stableId: null,
    testId: 'submit-btn',
    dataCy: null,
    dataQa: null,
    className: null,
    cssSelector: 'button[type="submit"]',
    xPath: '//button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

/** Helper: create a canonical click step. */
function makeClickStep(overrides: Partial<CanonicalStep> = {}): CanonicalStep {
  return {
    stepId: 'step-0001',
    stepNumber: 1,
    actionType: 'click',
    plainEnglish: 'Click "Submit" button',
    elementIdentity: makeElementIdentity(),
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: 'click-0001',
    value: null,
    checked: null,
    executionJson: null,
    timestamp: '2026-07-14T12:00:00.000Z',
    ...overrides,
  };
}

/** Helper: create a canonical navigation step. */
function makeNavigationStep(overrides: Partial<CanonicalStep> = {}): CanonicalStep {
  return {
    stepId: 'step-0002',
    stepNumber: 2,
    actionType: 'navigation',
    plainEnglish: 'Navigate to "https://example.com/results"',
    elementIdentity: {
      accessibleName: 'https://example.com/results',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'NAVIGATION',
      name: null,
      stableId: null,
      testId: null,
      dataCy: null,
      dataQa: null,
      className: null,
      cssSelector: 'body',
      xPath: '//body',
      inIframe: false,
      shadowDom: false,
      elementId: 'nav',
    },
    aiEnrichment: null,
    aiConfidence: 0,
    linkedInteractionId: 'nav-0001',
    value: null,
    checked: null,
    executionJson: null,
    timestamp: '2026-07-14T12:00:01.000Z',
    ...overrides,
  };
}

describe('Execution JSON Generator', () => {
  // ── Contract Structure ──────────────────────────────────

  it('produces all six sections on each step', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(1);
    const json = result.output![0].executionJson;

    expect(json).not.toBeNull();
    expect(json!.action).toBeDefined();
    expect(json!.target).toBeDefined();
    expect(json!.locators).toBeDefined();
    expect(json!.context).toBeDefined();
    expect(json!.trace).toBeDefined();
    expect(json!.meta).toBeDefined();
  });

  // ── Action Section ──────────────────────────────────────

  it('maps click actionType to "click" action.type', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.action.type).toBe('click');
    expect(json.action.value).toBeNull();
  });

  it('maps navigation actionType to "navigate" action.type', () => {
    const steps = [makeNavigationStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.action.type).toBe('navigate');
    expect(json.action.value).toBeNull();
  });

  // ── Target Section ──────────────────────────────────────

  it('element actions produce element target with tag/role/name', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'View Details',
      }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.target.kind).toBe('element');
    expect(json.target.tag).toBe('A');
    expect(json.target.role).toBe('link');
    expect(json.target.name).toBe('View Details');
  });

  it('navigation actions produce navigation target with url', () => {
    const steps = [makeNavigationStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.target.kind).toBe('navigation');
    expect(json.target.url).toBe('https://example.com/results');
  });

  // ── Locators Section ────────────────────────────────────

  it('element actions produce 1-3 locators with primary role', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.locators.length).toBeGreaterThanOrEqual(1);
    expect(json.locators.length).toBeLessThanOrEqual(3);
    expect(json.locators[0].role).toBe('primary');
  });

  it('navigation actions produce empty locators array', () => {
    const steps = [makeNavigationStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.locators).toEqual([]);
  });

  it('locator strategies are unique within one execution JSON', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({
        testId: 'btn',
        ariaLabel: 'Submit',
        className: null,
        cssSelector: 'button.submit',
      }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    const strategies = json.locators.map((l) => l.strategy);
    const unique = new Set(strategies);
    expect(strategies.length).toBe(unique.size);
  });

  // ── Context Section ─────────────────────────────────────

  it('context reflects iframe and shadowDom flags', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({
        inIframe: true,
        shadowDom: true,
        iframeContext: {
          frameSrc: 'https://example.com/frame',
          frameName: 'myframe',
          frameId: 'frame-1',
          frameSelector: '#frame-1',
          frameXPath: '//iframe[@id="frame-1"]',
          frameIndex: 0,
          frameDepth: 1,
        },
      }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.context.iframe).toBe(true);
    expect(json.context.shadowDom).toBe(true);
    expect(json.context.frame).not.toBeNull();
    expect(json.context.frame!.frameSrc).toBe('https://example.com/frame');
  });

  it('context.frame is null when iframe is false', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.context.iframe).toBe(false);
    expect(json.context.frame).toBeNull();
  });

  // ── Traceability Section ────────────────────────────────

  it('trace carries interactionId and stepId', () => {
    const steps = [makeClickStep({
      stepId: 'step-0042',
      linkedInteractionId: 'click-0010',
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.trace.interactionId).toBe('click-0010');
    expect(json.trace.stepId).toBe('step-0042');
  });

  // ── Metadata Section ────────────────────────────────────

  it('meta.status is "generated" for successful steps', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.meta.status).toBe('generated');
    expect(json.meta.warnings).toEqual([]);
    expect(json.meta.generatedAt).toBeTruthy();
  });

  it('meta.status is "error" for steps with no valid locators', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({
        testId: null,
        dataCy: null,
        dataQa: null,
        ariaLabel: null,
        ariaLabelledBy: null,
        stableId: null,
        name: null,
        accessibleName: '',
        className: null,
        cssSelector: '',
        xPath: '',
        tag: 'DIV',
      }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.meta.status).toBe('error');
    expect(json.locators).toEqual([]);
    expect(json.meta.warnings.length).toBeGreaterThan(0);
  });

  // ── Per-Step Error Isolation ────────────────────────────

  it('failed step does not prevent other steps from generating', () => {
    const steps = [
      makeClickStep({
        stepId: 'step-0001',
        linkedInteractionId: 'click-0001',
        elementIdentity: makeElementIdentity({ testId: 'btn1' }),
      }),
      makeClickStep({
        stepId: 'step-0002',
        stepNumber: 2,
        linkedInteractionId: 'click-0002',
        elementIdentity: makeElementIdentity({
          testId: null,
          dataCy: null,
          dataQa: null,
          ariaLabel: null,
          ariaLabelledBy: null,
          stableId: null,
          name: null,
          accessibleName: '',
          className: null,
          cssSelector: '',
          xPath: '',
        }),
      }),
      makeClickStep({
        stepId: 'step-0003',
        stepNumber: 3,
        linkedInteractionId: 'click-0003',
        elementIdentity: makeElementIdentity({ testId: 'btn3' }),
      }),
    ];
    const result = executionJsonGenerator.generate({ steps });

    expect(result.status).toBe('partial');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].executionJson!.meta.status).toBe('generated');
    expect(result.output![1].executionJson!.meta.status).toBe('error');
    expect(result.output![2].executionJson!.meta.status).toBe('generated');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].stepIndex).toBe(1);
  });

  // ── Mixed Click + Navigation Steps ──────────────────────

  it('handles mixed click and navigation steps correctly', () => {
    const steps = [
      makeClickStep({ stepId: 'step-0001', stepNumber: 1 }),
      makeNavigationStep({ stepId: 'step-0002', stepNumber: 2 }),
      makeClickStep({
        stepId: 'step-0003',
        stepNumber: 3,
        linkedInteractionId: 'click-0002',
      }),
    ];
    const result = executionJsonGenerator.generate({ steps });

    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);

    // Step 1: click
    expect(result.output![0].executionJson!.target.kind).toBe('element');
    expect(result.output![0].executionJson!.locators.length).toBeGreaterThan(0);

    // Step 2: navigation
    expect(result.output![1].executionJson!.target.kind).toBe('navigation');
    expect(result.output![1].executionJson!.locators).toEqual([]);

    // Step 3: click
    expect(result.output![2].executionJson!.target.kind).toBe('element');
    expect(result.output![2].executionJson!.locators.length).toBeGreaterThan(0);
  });

  // ── Determinism ─────────────────────────────────────────

  it('is deterministic: same steps → same JSON (excluding timestamp)', () => {
    const steps = [makeClickStep()];

    const result1 = executionJsonGenerator.generate({ steps });
    const result2 = executionJsonGenerator.generate({ steps });

    const json1 = { ...result1.output![0].executionJson!, meta: { ...result1.output![0].executionJson!.meta, generatedAt: '' } };
    const json2 = { ...result2.output![0].executionJson!, meta: { ...result2.output![0].executionJson!.meta, generatedAt: '' } };

    expect(json1).toEqual(json2);
  });

  // ── Edge Cases ──────────────────────────────────────────

  it('handles empty steps array', () => {
    const result = executionJsonGenerator.generate({ steps: [] });

    expect(result.status).toBe('success');
    expect(result.output).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('preserves non-executionJson fields on steps', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const output = result.output![0];

    expect(output.stepId).toBe('step-0001');
    expect(output.stepNumber).toBe(1);
    expect(output.actionType).toBe('click');
    expect(output.plainEnglish).toBe('Click "Submit" button');
    expect(output.linkedInteractionId).toBe('click-0001');
  });

  // ── B5.2 Validation Rules ───────────────────────────────

  it('VR-3: target kind matches action type', () => {
    const clickResult = executionJsonGenerator.generate({ steps: [makeClickStep()] });
    const navResult = executionJsonGenerator.generate({ steps: [makeNavigationStep()] });

    expect(clickResult.output![0].executionJson!.action.type).toBe('click');
    expect(clickResult.output![0].executionJson!.target.kind).toBe('element');

    expect(navResult.output![0].executionJson!.action.type).toBe('navigate');
    expect(navResult.output![0].executionJson!.target.kind).toBe('navigation');
  });

  it('VR-6: locator count is within 0-3 bounds', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({
        testId: 'a',
        dataCy: 'b',
        dataQa: 'c',
        ariaLabel: 'd',
        stableId: 'e',
        accessibleName: 'f',
        className: null,
        cssSelector: 'g',
        xPath: 'h',
      }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.locators.length).toBeLessThanOrEqual(3);
  });

  it('VR-7: exactly one primary locator when locators exist', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    const primaries = json.locators.filter((l) => l.role === 'primary');
    expect(primaries).toHaveLength(1);
  });

  it('VR-11: frame context is null when iframe is false', () => {
    const steps = [makeClickStep({
      elementIdentity: makeElementIdentity({ inIframe: false }),
    })];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(json.context.iframe).toBe(false);
    expect(json.context.frame).toBeNull();
  });

  it('VR-13: meta.status is valid value', () => {
    const steps = [makeClickStep()];
    const result = executionJsonGenerator.generate({ steps });
    const json = result.output![0].executionJson!;

    expect(['generated', 'error']).toContain(json.meta.status);
  });

  // ── Generator Contract ──────────────────────────────────

  it('has correct name and dependencies', () => {
    expect(executionJsonGenerator.name).toBe('execution-json-generator');
    expect(executionJsonGenerator.dependencies).toContain('canonical-step-generator');
  });

  it('never throws — returns GeneratorResult on all inputs', () => {
    const steps = [makeClickStep({ elementIdentity: makeElementIdentity({ tag: '' }) })];
    expect(() => executionJsonGenerator.generate({ steps })).not.toThrow();
  });
});

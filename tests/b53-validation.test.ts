import { describe, it, expect } from 'vitest';
import { executionJsonGenerator } from '../src/generation/generators/execution-json-generator';
import type { CanonicalStep } from '../src/generation/types';
import type { ElementIdentity } from '../src/shared/types';

function makeIdentity(overrides: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'BUTTON', className: null, name: null, stableId: null, testId: null,
    dataCy: null, dataQa: null, cssSelector: '', xPath: '', inIframe: false,
    shadowDom: false, elementId: 'elem-001', ...overrides,
  };
}

function makeStep(overrides: Partial<CanonicalStep>): CanonicalStep {
  return {
    stepId: 'step-0001', stepNumber: 1, actionType: 'click',
    plainEnglish: 'Click', elementIdentity: makeIdentity({}),
    aiEnrichment: null, aiConfidence: 0, linkedInteractionId: 'click-0001',
    executionJson: null, value: null, checked: null, timestamp: '2026-07-14T12:00:00Z', ...overrides,
  };
}

describe('B5.3 End-to-End Contract Validation', () => {
  it('T1: Click with data-testid → all 6 sections, VR rules, testId primary', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      elementIdentity: makeIdentity({ testId: 'submit-btn', accessibleName: 'Submit', tag: 'BUTTON', ariaRole: 'button', cssSelector: 'button[type=submit]', xPath: '//button' }),
    })] });
    const json = result.output![0].executionJson!;
    // All 6 sections
    expect(json.action).toBeDefined();
    expect(json.target).toBeDefined();
    expect(Array.isArray(json.locators)).toBe(true);
    expect(json.context).toBeDefined();
    expect(json.trace).toBeDefined();
    expect(json.meta).toBeDefined();
    // VR rules
    expect(json.action.type).toBe('click');
    expect(json.target.kind).toBe('element');
    expect(json.target.tag).toBe('BUTTON');
    expect(json.target.name).toBe('Submit');
    expect(json.locators[0].strategy).toBe('testId');
    expect(json.locators[0].value).toBe('submit-btn');
    expect(json.locators[0].role).toBe('primary');
    expect(json.locators.length).toBeLessThanOrEqual(3);
    expect(json.context.iframe).toBe(false);
    expect(json.context.shadowDom).toBe(false);
    expect(json.context.frame).toBeNull();
    expect(json.trace.interactionId).toBe('click-0001');
    expect(json.trace.stepId).toBe('step-0001');
    expect(json.meta.status).toBe('generated');
  });

  it('T2: Click with aria-label only → ariaLabel primary', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-002', linkedInteractionId: 'click-002',
      elementIdentity: makeIdentity({ ariaLabel: 'Close dialog', accessibleName: 'Close', tag: 'BUTTON', cssSelector: 'button.close' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.locators[0].strategy).toBe('ariaLabel');
    expect(json.locators[0].value).toBe('Close dialog');
  });

  it('T3: Auto-generated React ID (:r1:) → rejected, text becomes primary', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-003', linkedInteractionId: 'click-003',
      elementIdentity: makeIdentity({ stableId: ':r1:', accessibleName: 'Submit', tag: 'BUTTON', cssSelector: 'button' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.locators.find(l => l.strategy === 'id')).toBeUndefined();
    expect(json.locators[0].strategy).toBe('text');
  });

  it('T4: Structural-only element → css primary, structural warning', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-004', linkedInteractionId: 'click-004',
      elementIdentity: makeIdentity({ cssSelector: 'div.form > button.submit', xPath: '//div/form/button', accessibleName: '', tag: 'BUTTON' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.locators[0].strategy).toBe('css');
    expect(json.meta.warnings.some(w => w.includes('structural'))).toBe(true);
  });

  it('T5: Navigation step → navigation target, empty locators', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-005', stepNumber: 2, actionType: 'navigation',
      plainEnglish: 'Navigate', linkedInteractionId: 'nav-001',
      elementIdentity: makeIdentity({ tag: 'NAVIGATION', accessibleName: 'https://example.com/results' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.action.type).toBe('navigate');
    expect(json.target.kind).toBe('navigation');
    expect(json.target.url).toBe('https://example.com/results');
    expect(json.locators).toHaveLength(0);
  });

  it('T6: iframe context → frame populated', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-006', linkedInteractionId: 'click-006',
      elementIdentity: makeIdentity({ testId: 'frame-btn', accessibleName: 'Frame Button', tag: 'BUTTON',
        inIframe: true, iframeContext: { frameSrc: 'https://example.com/frame', frameName: 'myframe', frameId: 'frame-1', frameSelector: '#frame-1', frameXPath: '//iframe[@id="frame-1"]', frameIndex: 0, frameDepth: 1 } }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.context.iframe).toBe(true);
    expect(json.context.frame).not.toBeNull();
    expect(json.context.frame!.frameSrc).toBe('https://example.com/frame');
    expect(json.context.frame!.frameDepth).toBe(1);
  });

  it('T7: Shadow DOM → shadowDom=true', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-007', linkedInteractionId: 'click-007',
      elementIdentity: makeIdentity({ testId: 'shadow-btn', accessibleName: 'Shadow Button', tag: 'MY-COMPONENT', shadowDom: true }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.context.shadowDom).toBe(true);
    expect(json.context.iframe).toBe(false);
  });

  it('T8: Error step (no valid locators) → meta.status=error, NOT null', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-008', linkedInteractionId: 'click-008',
      elementIdentity: makeIdentity({ tag: 'DIV', accessibleName: '', cssSelector: '', xPath: '' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.meta.status).toBe('error');
    expect(json).not.toBeNull();
    expect(json.locators).toHaveLength(0);
    expect(json.meta.warnings.length).toBeGreaterThan(0);
  });

  it('T9: Per-step error isolation — 3 steps, middle fails', () => {
    const result = executionJsonGenerator.generate({ steps: [
      makeStep({ stepId: 's1', stepNumber: 1, linkedInteractionId: 'c1',
        elementIdentity: makeIdentity({ testId: 'ok', accessibleName: 'OK', tag: 'BUTTON' }) }),
      makeStep({ stepId: 's2', stepNumber: 2, linkedInteractionId: 'c2',
        elementIdentity: makeIdentity({ tag: 'DIV', accessibleName: '', cssSelector: '', xPath: '' }) }),
      makeStep({ stepId: 's3', stepNumber: 3, linkedInteractionId: 'c3',
        elementIdentity: makeIdentity({ testId: 'ok2', accessibleName: 'OK2', tag: 'BUTTON' }) }),
    ] });
    expect(result.status).toBe('partial');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].executionJson!.meta.status).toBe('generated');
    expect(result.output![1].executionJson!.meta.status).toBe('error');
    expect(result.output![2].executionJson!.meta.status).toBe('generated');
    expect(result.errors).toHaveLength(1);
  });

  it('T10: Full workflow click→nav→click', () => {
    const result = executionJsonGenerator.generate({ steps: [
      makeStep({ stepId: 's1', stepNumber: 1, actionType: 'click', linkedInteractionId: 'c1',
        elementIdentity: makeIdentity({ testId: 'search-btn', accessibleName: 'Search', tag: 'BUTTON' }) }),
      makeStep({ stepId: 's2', stepNumber: 2, actionType: 'navigation', linkedInteractionId: 'n1',
        elementIdentity: makeIdentity({ tag: 'NAVIGATION', accessibleName: 'https://example.com/results' }) }),
      makeStep({ stepId: 's3', stepNumber: 3, actionType: 'click', linkedInteractionId: 'c2',
        elementIdentity: makeIdentity({ dataCy: 'result-1', accessibleName: 'First Result', tag: 'A', ariaRole: 'link' }) }),
    ] });
    expect(result.status).toBe('success');
    expect(result.output).toHaveLength(3);
    expect(result.output![0].executionJson!.target.kind).toBe('element');
    expect(result.output![1].executionJson!.target.kind).toBe('navigation');
    expect(result.output![2].executionJson!.locators[0].strategy).toBe('dataCy');
  });

  it('T11: Determinism — same input produces identical output (excl. timestamp)', () => {
    const baseSteps = [
      makeStep({ stepId: 's1', stepNumber: 1, linkedInteractionId: 'c1',
        elementIdentity: makeIdentity({ testId: 'btn', ariaLabel: 'Submit', accessibleName: 'Submit', cssSelector: 'button', xPath: '//button', tag: 'BUTTON' }) }),
    ];
    const run1 = executionJsonGenerator.generate({ steps: JSON.parse(JSON.stringify(baseSteps)) });
    const run2 = executionJsonGenerator.generate({ steps: JSON.parse(JSON.stringify(baseSteps)) });
    const j1 = { ...run1.output![0].executionJson!, meta: { ...run1.output![0].executionJson!.meta, generatedAt: '' } };
    const j2 = { ...run2.output![0].executionJson!, meta: { ...run2.output![0].executionJson!.meta, generatedAt: '' } };
    expect(JSON.stringify(j1)).toBe(JSON.stringify(j2));
  });

  it('T12: Generator does NOT modify non-executionJson fields', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 'step-012', stepNumber: 7, actionType: 'click', plainEnglish: 'Click "Custom"',
      linkedInteractionId: 'click-012', aiConfidence: 0.95,
      elementIdentity: makeIdentity({ testId: 'x', accessibleName: 'X', tag: 'INPUT' }),
    })] });
    const s = result.output![0];
    expect(s.stepId).toBe('step-012');
    expect(s.stepNumber).toBe(7);
    expect(s.actionType).toBe('click');
    expect(s.plainEnglish).toBe('Click "Custom"');
    expect(s.linkedInteractionId).toBe('click-012');
    expect(s.aiConfidence).toBe(0.95);
    expect(s.elementIdentity.testId).toBe('x');
  });

  it('T13: CSS-in-JS class rejection', () => {
    const result = executionJsonGenerator.generate({ steps: [makeStep({
      stepId: 's13', linkedInteractionId: 'c13',
      elementIdentity: makeIdentity({ cssSelector: 'div.css-abc123456', xPath: '//div', accessibleName: '', tag: 'DIV' }),
    })] });
    const json = result.output![0].executionJson!;
    expect(json.locators.find(l => l.strategy === 'css')).toBeUndefined();
  });

  it('T14: Multiple auto-generated ID patterns rejected', () => {
    const patterns = [':r1:', 'cdk-overlay-0', 'sc-abc123def', 'a1b2c3d4e5f6a7b8', 'radix-1', 'mui-12345'];
    for (const id of patterns) {
      const result = executionJsonGenerator.generate({ steps: [makeStep({
        stepId: 's14', linkedInteractionId: 'c14',
        elementIdentity: makeIdentity({ stableId: id, accessibleName: 'Element', tag: 'DIV', cssSelector: 'div' }),
      })] });
      const json = result.output![0].executionJson!;
      expect(json.locators.find(l => l.strategy === 'id'), `ID "${id}" should be rejected`).toBeUndefined();
    }
  });
});

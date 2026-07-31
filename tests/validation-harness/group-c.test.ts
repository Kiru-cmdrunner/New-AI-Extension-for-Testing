/**
 * Group C — Advanced Interactions Validation (C1–C5)
 */

import { describe, it, beforeEach } from 'vitest';
import {
  runFullPipeline, makeEvent, makeTarget, makeContext,
  resetEventCounter, recordFinding, getResolvedType, type Finding,
} from './harness';
import { IRAction } from '../../src/domain/execution-ir/types';

beforeEach(() => resetEventCounter());

// C1: Hover
describe('C1 — Hover', () => {
  it('hover over element (mouseenter + mouseleave)', () => {
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Product card', ariaRole: 'group',
      cssSelector: 'div.product-card', stableId: 'product-1',
    });
    const result = runFullPipeline([
      makeEvent('mouseenter', target, {}, { clientX: 100, clientY: 200 }),
      makeEvent('mouseleave', target, {}, { clientX: 100, clientY: 200 }),
    ]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'C1', capabilityName: 'Hover',
      scenario: 'Hover over product card (mouseenter → mouseleave)',
      app: 'synthetic (Amazon-like)',
      expected: 'Hover interaction',
      observed: `type=${resolvedType}, interactions=${result.interactions.length}`,
      scores: {
        q1_intent: resolvedType === 'Hover' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 3,
        q3_locator: 4,
        q4_description: step?.description?.includes('Hover') ? 5 : 3,
        q5_replay: step?.action === IRAction.HOVER ? 5 : 2,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Hover' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Hover' ? 'definition recognition — mouseenter/mouseleave lifecycle' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// C2: Slider
describe('C2 — Slider', () => {
  it('native range input slider', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Volume', ariaRole: 'slider',
      inputType: 'range', cssSelector: 'input[type="range"]', stableId: 'volume',
    });
    const ctx = makeContext({ inputType: 'range', ariaValueNow: '75', ariaValueMin: '0', ariaValueMax: '100' });
    const result = runFullPipeline([
      makeEvent('change', target, ctx, { valueAfter: '75' }),
    ]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'C2', capabilityName: 'Slider',
      scenario: 'Native range input slider to 75',
      app: 'synthetic',
      expected: 'Slider with sliderValue',
      observed: `type=${resolvedType}, sliderValue=${ci?.metadata?.sliderValue ?? 'MISSING'}`,
      scores: {
        q1_intent: resolvedType === 'Slider' || resolvedType === 'NativeSlider' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 4,
        q4_description: step?.description?.includes('slider') || step?.description?.includes('Slider') ? 5 : 3,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Slider' || resolvedType === 'NativeSlider' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Slider' && resolvedType !== 'NativeSlider' ? 'definition recognition' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// C3: Drag and Drop
describe('C3 — Drag and Drop', () => {
  it('HTML5 drag and drop (dragstart → drop)', () => {
    const source = makeTarget({
      tag: 'DIV', accessibleName: 'Task card', ariaRole: 'article',
      cssSelector: 'div.task-card', stableId: 'task-1', draggable: true as any,
    });
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Done column', ariaRole: 'list',
      cssSelector: 'div.column.done', stableId: 'col-done',
    });
    const result = runFullPipeline([
      makeEvent('dragstart', source),
      makeEvent('drop', target),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'C3', capabilityName: 'Drag and Drop',
      scenario: 'HTML5 drag task card to done column',
      app: 'synthetic (Trello-like)',
      expected: 'DragDrop interaction with source + target',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'DragDrop' || resolvedType === 'Html5DragDrop' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 3,
        q3_locator: 3,
        q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'DragDrop' || resolvedType === 'Html5DragDrop' ? 'full' : 'partial',
      rootCause: resolvedType !== 'DragDrop' && resolvedType !== 'Html5DragDrop' ? 'definition recognition — drag lifecycle' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// C4: File Upload
describe('C4 — File Upload', () => {
  it('native file input', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Upload avatar', ariaRole: 'button',
      inputType: 'file', cssSelector: 'input[type="file"]', stableId: 'avatar-upload',
    });
    const ctx = makeContext({ inputType: 'file' });
    const result = runFullPipeline([
      makeEvent('change', target, ctx, { valueAfter: 'avatar.png' }),
    ]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'C4', capabilityName: 'File Upload',
      scenario: 'Native file input change',
      app: 'synthetic',
      expected: 'FileUpload interaction',
      observed: `type=${resolvedType}, action=${step?.action}`,
      scores: {
        q1_intent: resolvedType === 'FileUpload' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 4,
        q4_description: step?.description?.includes('Upload') ? 5 : 3,
        q5_replay: 3, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'FileUpload' ? 'full' : 'partial',
      rootCause: resolvedType !== 'FileUpload' ? 'definition recognition' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// C5: Stepper / Counter
describe('C5 — Stepper / Counter', () => {
  it('increment counter (click + button)', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Increase adults', ariaRole: 'button',
      cssSelector: 'button.stepper-increment', stableId: 'adults-inc',
    });
    const ctx = makeContext({ ariaValueNow: '2' });
    const result = runFullPipeline([
      makeEvent('click', target, ctx),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'C5', capabilityName: 'Stepper / Counter',
      scenario: 'Click increment button for adults counter',
      app: 'synthetic (Booking.com-like)',
      expected: 'Stepper interaction with delta',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Stepper' ? 5 : resolvedType === 'Click' ? 2 : 1,
        q2_abstraction: 5, q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Stepper' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Stepper' ? 'definition recognition — proximity-based grouping' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

/**
 * Group D — Specialized Inputs Validation (D1–D3)
 * Group E — Compound & Structural (E1–E2)
 * Group F — Cross-Cutting (F1–F2)
 */

import { describe, it, beforeEach } from 'vitest';
import {
  runFullPipeline, makeEvent, makeTarget, makeContext,
  resetEventCounter, recordFinding, getResolvedType,
  getTopLocatorStrategy, type Finding,
} from './harness';
import { IRAction } from '../../src/domain/execution-ir/types';

beforeEach(() => resetEventCounter());

// D1: Tag Input
describe('D1 — Tag Input', () => {
  it('type → Enter → type → comma (multi-value)', () => {
    const target = makeTarget({
      tag: 'INPUT', accessibleName: 'Add tag', ariaRole: 'textbox',
      inputType: 'text', cssSelector: 'input.tag-input', stableId: 'tag-input',
    });
    const result = runFullPipeline([
      makeEvent('focus', target),
      makeEvent('input', target, {}, { valueAfter: 'javascript' }),
      makeEvent('keydown', target, {}, { key: 'Enter', code: 'Enter' }),
      makeEvent('input', target, {}, { valueAfter: 'typescript' }),
      makeEvent('keydown', target, {}, { key: ',', code: 'Comma' }),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'D1', capabilityName: 'Tag Input',
      scenario: 'Type two tags separated by Enter and comma',
      app: 'synthetic (MUI-like)',
      expected: 'TagInput interaction with collected values',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'TagInput' ? 5 : resolvedType === 'TextEntry' ? 3 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : 2,
        q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'TagInput' ? 'full' : 'partial',
      rootCause: resolvedType !== 'TagInput' ? 'definition recognition — delimiter lifecycle' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// D2: OTP Input
describe('D2 — OTP Input', () => {
  it('multi-box OTP entry (6 digits)', () => {
    const digits: ReturnType<typeof makeEvent>[] = [];
    for (let i = 0; i < 6; i++) {
      const target = makeTarget({
        tag: 'INPUT', accessibleName: `Digit ${i + 1}`, ariaRole: 'textbox',
        inputType: 'text', maxLength: 1 as any,
        cssSelector: `input.otp-digit[data-index="${i}"]`, stableId: `otp-${i}`,
      });
      digits.push(makeEvent('input', target, {}, { valueAfter: String((i + 1) % 10) }));
    }
    const result = runFullPipeline(digits);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'D2', capabilityName: 'OTP Input',
      scenario: '6-digit OTP entry across 6 input boxes',
      app: 'synthetic',
      expected: 'OtpInput interaction (6 digits grouped)',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'OtpInput' ? 5 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : result.interactions.length <= 2 ? 3 : 1,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'OtpInput' ? 'full' : 'partial',
      rootCause: resolvedType !== 'OtpInput' ? 'definition recognition — adjacent input grouping' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// D3: Rich Text Editor
describe('D3 — Rich Text Editor', () => {
  it('contenteditable div (Quill-like)', () => {
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Editor', ariaRole: 'textbox',
      cssSelector: 'div.ql-editor', stableId: 'quill-editor',
    });
    const ctx = makeContext({ isContentEditable: true });
    const result = runFullPipeline([
      makeEvent('focus', target, ctx),
      makeEvent('input', target, ctx, { valueAfter: '<p>Hello world</p>' }),
      makeEvent('blur', target, ctx, { valueAfter: '<p>Hello world</p>' }),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'D3', capabilityName: 'Rich Text Editor',
      scenario: 'Contenteditable div (Quill-like)',
      app: 'synthetic',
      expected: 'TextEntry with RichTextEditor subtype',
      observed: `type=${resolvedType}, metadata.isRichTextEditor=${ci?.metadata?.isRichTextEditor ?? 'MISSING'}`,
      scores: {
        q1_intent: resolvedType === 'RichTextEditor' ? 5 : resolvedType === 'TextEntry' ? 4 : 2,
        q2_abstraction: 5, q3_locator: 3, q4_description: 4, q5_replay: 3,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'RichTextEditor' || resolvedType === 'TextEntry' ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// E1: Multi-config dropdown
describe('E1 — Multi-Config Dropdown', () => {
  it('flight booking panel (steppers + selects + confirm)', () => {
    const trigger = makeTarget({
      tag: 'BUTTON', accessibleName: 'Economy', ariaRole: 'button',
      ariaHasPopup: 'dialog', cssSelector: 'button.cabin-trigger', stableId: 'cabin',
    });

    // Simplified: surface-bound interactions inside a dialog
    const adultsInc = makeTarget({
      tag: 'BUTTON', accessibleName: 'Add adult', ariaRole: 'button',
      cssSelector: 'button[data-action="increment"][data-field="adults"]', stableId: 'adults-plus',
    });
    const doneBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Done', ariaRole: 'button',
      cssSelector: 'button.confirm', stableId: 'done',
    });

    const result = runFullPipeline([
      makeEvent('click', trigger, makeContext({ ariaHasPopup: 'dialog' })),
      makeEvent('click', adultsInc, makeContext({ surfaceType: 'dialog', surfaceLabel: 'Cabin selector' })),
      makeEvent('click', adultsInc, makeContext({ surfaceType: 'dialog', surfaceLabel: 'Cabin selector' })),
      makeEvent('click', doneBtn, makeContext({ surfaceType: 'dialog', surfaceLabel: 'Cabin selector' })),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'E1', capabilityName: 'Multi-Config Dropdown',
      scenario: 'Flight panel: open → 2x increment → confirm',
      app: 'synthetic (Booking.com-like)',
      expected: 'Compound Dropdown with subActions, ConfigurationSession enrichment',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}, subActions=${ci?.metadata?.subActions ? 'present' : 'MISSING'}`,
      scores: {
        q1_intent: resolvedType === 'CustomDropdown' || resolvedType === 'Dropdown' ? 4 : 2,
        q2_abstraction: result.interactions.length === 1 ? 5 : result.interactions.length <= 2 ? 3 : 2,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'partial',
      rootCause: 'compound lifecycle requires real surface detection to validate',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// E2: Modal Dialog
describe('E2 — Modal Dialog', () => {
  it('confirmation modal: open → click confirm', () => {
    const trigger = makeTarget({
      tag: 'BUTTON', accessibleName: 'Delete account', ariaRole: 'button',
      cssSelector: 'button.delete-btn', stableId: 'delete-trigger',
    });
    const confirmBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Confirm', ariaRole: 'button',
      cssSelector: 'button.modal-confirm', stableId: 'modal-confirm',
    });
    const modalCtx = makeContext({ surfaceType: 'dialog', surfaceLabel: 'Delete confirmation' });

    const result = runFullPipeline([
      makeEvent('click', trigger),
      makeEvent('click', confirmBtn, modalCtx),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'E2', capabilityName: 'Modal Dialog',
      scenario: 'Click delete → modal appears → click confirm',
      app: 'synthetic',
      expected: 'ModalDialog interaction or separate Click with modal context',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores: {
        q1_intent: 3,
        q2_abstraction: result.interactions.length === 2 ? 4 : result.interactions.length === 1 ? 3 : 2,
        q3_locator: 3, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'partial', rootCause: 'modal lifecycle requires real DOM surface detection', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// F1: Locator Quality
describe('F1 — Locator Quality', () => {
  it('element with data-testid (highest priority)', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Username', ariaRole: 'button',
      testId: 'username-input', stableId: 'user', name: 'username',
      cssSelector: 'button.form-control', xPath: '/html/body/form/button[1]',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const topStrategy = getTopLocatorStrategy(result.irPlan);

    recordFinding({
      capabilityId: 'F1', capabilityName: 'Locator Quality',
      scenario: 'Element with data-testid, stableId, name, CSS, XPath',
      app: 'synthetic',
      expected: 'Top locator = testId (highest confidence)',
      observed: `topStrategy=${topStrategy}`,
      scores: {
        q1_intent: 5, q2_abstraction: 5,
        q3_locator: topStrategy === 'testId' ? 5 : topStrategy === 'accessibleName' ? 3 : 2,
        q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: topStrategy === 'testId' ? 'full' : 'partial',
      rootCause: topStrategy !== 'testId' ? 'locator ranking — testId not prioritized' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('element with only CSS (no semantic locators)', () => {
    const target = makeTarget({
      tag: 'DIV', accessibleName: '', ariaRole: null,
      cssSelector: 'div:nth-child(3) > span.icon', xPath: '/html/body/div[2]/span[1]',
      className: 'icon-wrapper',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const topStrategy = getTopLocatorStrategy(result.irPlan);

    recordFinding({
      capabilityId: 'F1', capabilityName: 'Locator Quality',
      scenario: 'Element with only CSS/XPath (no semantic identifiers)',
      app: 'synthetic',
      expected: 'CSS selector used, fragility acknowledged',
      observed: `topStrategy=${topStrategy}`,
      scores: {
        q1_intent: 5, q2_abstraction: 5,
        q3_locator: 2, // Expected to be poor
        q4_description: 2, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'partial', rootCause: 'no semantic locators available — expected limitation', severity: 'P3',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('element with React auto-generated ID (should be filtered)', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
      stableId: ':r1:', // React auto-generated
      testId: null, cssSelector: 'button.submit-btn',
      className: 'css-1a2b3c', // CSS-in-JS hash
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const topStrategy = getTopLocatorStrategy(result.irPlan);

    recordFinding({
      capabilityId: 'F1', capabilityName: 'Locator Quality',
      scenario: 'React auto-generated ID (:r1:) + CSS-in-JS class',
      app: 'synthetic (React/MUI-like)',
      expected: 'Auto-generated ID filtered, CSS used as fallback',
      observed: `topStrategy=${topStrategy}`,
      scores: {
        q1_intent: 5, q2_abstraction: 5,
        q3_locator: topStrategy === 'css' || topStrategy === 'accessible_name' ? 3 : 1,
        q4_description: 4, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'partial',
      rootCause: 'auto-generated ID filtering — need to verify :r1: is filtered',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// F2: Iframe Interactions
describe('F2 — Iframe Interactions', () => {
  it('click inside iframe (payment button)', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Pay $99.00', ariaRole: 'button',
      cssSelector: 'button.pay-btn', stableId: 'pay-btn',
      inIframe: true,
    });
    const ctx = makeContext({});
    const event = makeEvent('click', target, ctx);
    event.target = { ...event.target, inIframe: true, iframeContext: {
      frameSrc: 'https://js.stripe.com/v3/elements',
      frameName: null, frameId: '__privateStripeFrame',
      frameSelector: 'iframe[name="__privateStripeFrame"]',
      frameXPath: null, frameIndex: 0, frameDepth: 1,
    } as any };
    const result = runFullPipeline([event]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';
    const hasFrameLocator = result.playwright?.includes('frameLocator') ?? false;

    recordFinding({
      capabilityId: 'F2', capabilityName: 'Iframe Interactions',
      scenario: 'Click pay button inside Stripe payment iframe',
      app: 'synthetic (Stripe-like)',
      expected: 'Click interaction with frameLocator in Playwright output',
      observed: `type=${resolvedType}, frameLocator=${hasFrameLocator}`,
      scores: {
        q1_intent: resolvedType === 'Click' ? 5 : 2,
        q2_abstraction: 5,
        q3_locator: hasFrameLocator ? 4 : 2,
        q4_description: 4, q5_replay: hasFrameLocator ? 4 : 2,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: hasFrameLocator ? 'full' : 'partial',
      rootCause: !hasFrameLocator ? 'Playwright adapter — frameLocator not generated' : '',
      severity: 'P1',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

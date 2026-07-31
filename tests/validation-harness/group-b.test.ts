/**
 * Group B — Click Interactions Validation (B1–B4)
 */

import { describe, it, beforeEach } from 'vitest';
import {
  runFullPipeline, makeEvent, makeTarget, makeContext,
  resetEventCounter, recordFinding, getResolvedType, type Finding,
} from './harness';
import { IRAction } from '../../src/domain/execution-ir/types';

beforeEach(() => resetEventCounter());

// B1: Plain click
describe('B1 — Plain Click', () => {
  it('button click with data-testid', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
      testId: 'submit-btn', cssSelector: 'button[type="submit"]',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B1', capabilityName: 'Plain Click',
      scenario: 'Button click with data-testid',
      app: 'synthetic',
      expected: 'Click interaction with testId locator',
      observed: `type=${resolvedType}, locators=${step?.target?.kind === 'element' ? step.target.resolvedLocators.length : 0}, desc="${step?.description}"`,
      scores: {
        q1_intent: resolvedType === 'Click' ? 5 : 2,
        q2_abstraction: 5,
        q3_locator: step?.target?.kind === 'element' && step.target.resolvedLocators[0]?.type === 'test_id' ? 5 : 3,
        q4_description: step?.description?.includes('Click') ? 5 : 3,
        q5_replay: step?.action === IRAction.CLICK ? 5 : 2,
        q6_confidence: 4,
        q7_evidence: ci?.evidenceTrail?.length ? 4 : 3,
        q8_assertion: (step?.assertions?.length ?? 0) > 0 ? 4 : 2,
      },
      supportLevel: 'full', rootCause: '', severity: 'P3',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('div click (non-semantic element)', () => {
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Action card', ariaRole: 'button',
      cssSelector: 'div.action-card', className: 'action-card clickable',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B1', capabilityName: 'Plain Click',
      scenario: 'Div with role=button (SPA clickable element)',
      app: 'synthetic (React SPA-like)',
      expected: 'Click interaction, evidence annotation runs',
      observed: `type=${resolvedType}, evidence=${ci?.evidenceTrail?.length ?? 0} votes, intent=${ci?.intent ?? 'none'}`,
      scores: {
        q1_intent: resolvedType === 'Click' ? 5 : 2,
        q2_abstraction: 5,
        q3_locator: 3, // No testId, CSS only
        q4_description: step?.description?.includes('Click') ? 4 : 3,
        q5_replay: step?.action === IRAction.CLICK ? 5 : 2,
        q6_confidence: ci?.confidence !== undefined ? 4 : 2,
        q7_evidence: ci?.evidenceTrail?.length ? 4 : 2,
        q8_assertion: 2,
      },
      supportLevel: 'full', rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// B2: Link navigation
describe('B2 — Link Navigation', () => {
  it('same-page anchor link', () => {
    const target = makeTarget({
      tag: 'A', accessibleName: 'About Us', ariaRole: 'link',
      cssSelector: 'a[href="/about"]', stableId: 'nav-about',
    });
    const result = runFullPipeline([makeEvent('click', target)]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B2', capabilityName: 'Link Navigation',
      scenario: 'Same-page anchor link click',
      app: 'synthetic (Wikipedia-like)',
      expected: 'Link interaction (not generic Click)',
      observed: `type=${resolvedType}, action=${step?.action}`,
      scores: {
        q1_intent: resolvedType === 'Link' ? 5 : resolvedType === 'Click' ? 3 : 2,
        q2_abstraction: 5,
        q3_locator: 4,
        q4_description: step?.description?.includes('Click') ? 4 : 3,
        q5_replay: step?.action === IRAction.CLICK ? 4 : 2,
        q6_confidence: 4,
        q7_evidence: ci?.evidenceTrail?.length ? 4 : 3,
        q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Link' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Link' ? 'definition recognition — Link def may need href check' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('SPA navigation (pushState)', () => {
    const result = runFullPipeline([
      makeEvent('click', makeTarget({ tag: 'A', accessibleName: 'Dashboard', ariaRole: 'link' })),
      makeEvent('navigation', {}, {}, { pageUrl: 'https://example.com/dashboard', pageTitle: 'Dashboard' }),
    ]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B2', capabilityName: 'Link Navigation',
      scenario: 'SPA pushState navigation',
      app: 'synthetic (YouTube-like)',
      expected: 'Navigation interaction with URL change',
      observed: `${result.interactions.length} interaction(s), type[0]=${resolvedType}`,
      scores: { q1_intent: 3, q2_abstraction: 4, q3_locator: 3, q4_description: 3, q5_replay: 3, q6_confidence: 3, q7_evidence: 3, q8_assertion: 2 },
      supportLevel: 'partial', rootCause: 'SPA navigation needs real browser to validate properly', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// B3: Double-click / right-click
describe('B3 — Double-Click / Right-Click', () => {
  it('double-click on table row', () => {
    const target = makeTarget({
      tag: 'TR', accessibleName: 'Order #12345', ariaRole: 'row',
      cssSelector: 'tr.order-row', stableId: 'order-12345',
    });
    const result = runFullPipeline([
      makeEvent('dblclick', target),
    ]);
    const ci = result.interactions[0];
    const step = result.irPlan?.steps[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B3', capabilityName: 'Double-Click / Right-Click',
      scenario: 'Double-click on table row',
      app: 'synthetic',
      expected: 'DoubleClick subtype',
      observed: `type=${resolvedType}, action=${step?.action}`,
      scores: {
        q1_intent: resolvedType === 'DoubleClick' ? 5 : resolvedType === 'Click' ? 3 : 2,
        q2_abstraction: 5, q3_locator: 4,
        q4_description: step?.description?.includes('Double') ? 5 : 3,
        q5_replay: 3, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'DoubleClick' ? 'full' : 'partial',
      rootCause: resolvedType !== 'DoubleClick' ? 'definition recognition — dblclick event type may not be recognized' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });

  it('right-click (contextmenu)', () => {
    const target = makeTarget({
      tag: 'TD', accessibleName: 'Cell content', ariaRole: 'cell',
      cssSelector: 'td.cell', stableId: 'cell-b2',
    });
    const result = runFullPipeline([
      makeEvent('contextmenu', target),
    ]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B3', capabilityName: 'Double-Click / Right-Click',
      scenario: 'Right-click (contextmenu) on cell',
      app: 'synthetic',
      expected: 'RightClick subtype',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'RightClick' ? 5 : 2,
        q2_abstraction: 5, q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'RightClick' ? 'full' : 'partial',
      rootCause: resolvedType !== 'RightClick' ? 'definition recognition — contextmenu event may not be captured' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

// B4: Tab / Breadcrumb
describe('B4 — Tab / Breadcrumb', () => {
  it('tab panel activation', () => {
    const target = makeTarget({
      tag: 'BUTTON', accessibleName: 'Settings', ariaRole: 'tab',
      cssSelector: 'button[role="tab"]', stableId: 'tab-settings',
    });
    const ctx = makeContext({ ancestorRoles: ['tablist'] });
    const result = runFullPipeline([makeEvent('click', target, ctx)]);
    const ci = result.interactions[0];
    const resolvedType = ci ? getResolvedType(ci) : 'NONE';

    recordFinding({
      capabilityId: 'B4', capabilityName: 'Tab / Breadcrumb',
      scenario: 'Tab panel activation (role=tab inside tablist)',
      app: 'synthetic (React Spectrum-like)',
      expected: 'Tab interaction',
      observed: `type=${resolvedType}`,
      scores: {
        q1_intent: resolvedType === 'Tab' ? 5 : resolvedType === 'Click' ? 3 : 2,
        q2_abstraction: 5, q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: resolvedType === 'Tab' ? 'full' : 'partial',
      rootCause: resolvedType !== 'Tab' ? 'definition recognition — ancestor role tablist may not be checked' : '',
      severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

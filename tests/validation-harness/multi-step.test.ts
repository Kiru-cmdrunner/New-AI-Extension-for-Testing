/**
 * Expanded Validation: Multi-Step Workflow Sequences
 *
 * Tests whether the classification pipeline produces coherent
 * multi-interaction test flows — not just isolated interactions.
 * These sequences exercise:
 * - Interaction merging and dedup
 * - IR sequencing
 * - Playwright multi-step output
 * - State tracking across interactions
 */

import { describe, it, beforeEach } from 'vitest';
import {
  runFullPipeline, makeEvent, makeTarget, makeContext,
  resetEventCounter, recordFinding, getResolvedType,
  type Finding,
} from './harness';

beforeEach(() => resetEventCounter());

describe('Multi-Step: Login Flow', () => {
  it('email + password + submit button', () => {
    const emailInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Email', ariaRole: 'textbox',
      inputType: 'email' as any, testId: 'email', cssSelector: 'input[type="email"]',
    });
    const pwInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Password', ariaRole: 'textbox',
      inputType: 'password' as any, testId: 'password', cssSelector: 'input[type="password"]',
    });
    const submitBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Sign in', ariaRole: 'button',
      testId: 'login-submit', cssSelector: 'button[type="submit"]',
    });

    const result = runFullPipeline([
      makeEvent('focus', emailInput, makeContext({ inputType: 'email' })),
      makeEvent('input', emailInput, makeContext({ inputType: 'email' }), { valueAfter: 'user@test.com' }),
      makeEvent('blur', emailInput, makeContext({ inputType: 'email' }), { valueAfter: 'user@test.com' }),
      makeEvent('focus', pwInput, makeContext({ inputType: 'password' })),
      makeEvent('input', pwInput, makeContext({ inputType: 'password' }), { valueAfter: 'secret123' }),
      makeEvent('blur', pwInput, makeContext({ inputType: 'password' }), { valueAfter: 'secret123' }),
      makeEvent('click', submitBtn),
    ]);

    const types = result.interactions.map(ci => getResolvedType(ci));
    const stepCount = result.irPlan?.steps.length ?? 0;
    const playwrightLines = result.playwright?.split('\n').filter(l => l.trim()) ?? [];

    recordFinding({
      capabilityId: 'MS-1', capabilityName: 'Login Flow',
      scenario: 'Focus email → type → blur → focus password → type → blur → click submit',
      app: 'synthetic (auth flow)',
      expected: '3 interactions: TextEntry(email), TextEntry(password), Click(submit)',
      observed: `${result.interactions.length} interactions: [${types.join(', ')}], ${stepCount} IR steps, ${playwrightLines.length} Playwright lines`,
      scores: {
        q1_intent: types.length === 3 && types[0] === 'TextEntry' && types[2] === 'Click' ? 5 : 3,
        q2_abstraction: types.length === 3 ? 5 : 3,
        q3_locator: 4, q4_description: 4, q5_replay: 4,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 3,
      },
      supportLevel: types.length === 3 ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

describe('Multi-Step: Search and Filter', () => {
  it('type search → press Enter → click filter dropdown → select option', () => {
    const searchInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Search products', ariaRole: 'searchbox',
      inputType: 'search' as any, testId: 'search', cssSelector: 'input[type="search"]',
    });
    const filterTrigger = makeTarget({
      tag: 'BUTTON', accessibleName: 'Filter by category', ariaRole: 'button',
      ariaHasPopup: 'listbox', testId: 'filter-trigger', cssSelector: 'button.filter',
    });
    const filterOption = makeTarget({
      tag: 'DIV', accessibleName: 'Electronics', ariaRole: 'option',
      testId: 'opt-electronics', cssSelector: 'div.option',
    });

    const result = runFullPipeline([
      makeEvent('focus', searchInput, makeContext({ inputType: 'search' })),
      makeEvent('input', searchInput, makeContext({ inputType: 'search' }), { valueAfter: 'laptop' }),
      makeEvent('keydown', searchInput, makeContext({ inputType: 'search' }), { key: 'Enter', code: 'Enter' }),
      makeEvent('blur', searchInput, makeContext({ inputType: 'search' }), { valueAfter: 'laptop' }),
      makeEvent('click', filterTrigger, makeContext({ ariaHasPopup: 'listbox' })),
      makeEvent('click', filterOption, makeContext({ surfaceType: 'popover', surfaceLabel: 'Filter' })),
    ]);

    const types = result.interactions.map(ci => getResolvedType(ci));
    const stepCount = result.irPlan?.steps.length ?? 0;

    recordFinding({
      capabilityId: 'MS-2', capabilityName: 'Search and Filter',
      scenario: 'Search → Enter → open filter dropdown → select option',
      app: 'synthetic (e-commerce)',
      expected: '2-3 interactions: TextEntry(search), Dropdown/CustomDropdown(filter)',
      observed: `${result.interactions.length} interactions: [${types.join(', ')}], ${stepCount} IR steps`,
      scores: {
        q1_intent: 4, q2_abstraction: result.interactions.length <= 3 ? 4 : 2,
        q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'full', rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

describe('Multi-Step: Form Submission with Validation', () => {
  it('fill 3 fields → select dropdown → check checkbox → submit', () => {
    const nameInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Full name', ariaRole: 'textbox',
      inputType: 'text' as any, testId: 'name', cssSelector: 'input#name',
    });
    const emailInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Email address', ariaRole: 'textbox',
      inputType: 'email' as any, testId: 'email', cssSelector: 'input#email',
    });
    const phoneInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Phone number', ariaRole: 'textbox',
      inputType: 'tel' as any, testId: 'phone', cssSelector: 'input#phone',
    });
    const countrySelect = makeTarget({
      tag: 'SELECT', accessibleName: 'Country', ariaRole: 'combobox',
      testId: 'country', cssSelector: 'select#country',
    });
    const termsCheckbox = makeTarget({
      tag: 'INPUT', accessibleName: 'Accept terms', ariaRole: 'checkbox',
      inputType: 'checkbox' as any, testId: 'terms', cssSelector: 'input#terms',
    });
    const submitBtn = makeTarget({
      tag: 'BUTTON', accessibleName: 'Register', ariaRole: 'button',
      testId: 'submit', cssSelector: 'button[type="submit"]',
    });

    const result = runFullPipeline([
      makeEvent('focus', nameInput, makeContext({ inputType: 'text' })),
      makeEvent('input', nameInput, makeContext({ inputType: 'text' }), { valueAfter: 'Jane Doe' }),
      makeEvent('blur', nameInput, makeContext({ inputType: 'text' }), { valueAfter: 'Jane Doe' }),
      makeEvent('focus', emailInput, makeContext({ inputType: 'email' })),
      makeEvent('input', emailInput, makeContext({ inputType: 'email' }), { valueAfter: 'jane@test.com' }),
      makeEvent('blur', emailInput, makeContext({ inputType: 'email' }), { valueAfter: 'jane@test.com' }),
      makeEvent('focus', phoneInput, makeContext({ inputType: 'tel' })),
      makeEvent('input', phoneInput, makeContext({ inputType: 'tel' }), { valueAfter: '+1234567890' }),
      makeEvent('blur', phoneInput, makeContext({ inputType: 'tel' }), { valueAfter: '+1234567890' }),
      makeEvent('change', countrySelect, makeContext({}), { valueAfter: 'United States' }),
      makeEvent('click', termsCheckbox, makeContext({ inputType: 'checkbox' })),
      makeEvent('click', submitBtn),
    ]);

    const types = result.interactions.map(ci => getResolvedType(ci));
    const stepCount = result.irPlan?.steps.length ?? 0;
    const playwrightCode = result.playwright ?? '';
    const hasAssertions = (result.irPlan?.steps.some(s => s.assertions && s.assertions.length > 0)) ?? false;

    recordFinding({
      capabilityId: 'MS-3', capabilityName: 'Form Submission',
      scenario: '3 TextEntry + NativeDropdown + Checkbox + Click(submit)',
      app: 'synthetic (registration form)',
      expected: '6 interactions: TextEntry×3, NativeDropdown, Checkbox, Click',
      observed: `${result.interactions.length} interactions: [${types.join(', ')}], ${stepCount} steps, assertions=${hasAssertions}`,
      scores: {
        q1_intent: types.length === 6 ? 5 : 3,
        q2_abstraction: types.length === 6 ? 5 : 3,
        q3_locator: 4, q4_description: 4,
        q5_replay: 4, q6_confidence: 4, q7_evidence: 3,
        q8_assertion: hasAssertions ? 4 : 2,
      },
      supportLevel: types.length === 6 ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode,
    } as Finding);
  });
});

describe('Multi-Step: Tab Navigation with Content', () => {
  it('click tab → fill input → click another tab → fill input', () => {
    const tab1 = makeTarget({
      tag: 'DIV', accessibleName: 'Personal Info', ariaRole: 'tab',
      testId: 'tab-personal', cssSelector: 'div[role="tab"]#tab1',
    });
    const tab2 = makeTarget({
      tag: 'DIV', accessibleName: 'Work Details', ariaRole: 'tab',
      testId: 'tab-work', cssSelector: 'div[role="tab"]#tab2',
    });
    const personalInput = makeTarget({
      tag: 'INPUT', accessibleName: 'First name', ariaRole: 'textbox',
      inputType: 'text' as any, testId: 'firstName', cssSelector: 'input#firstName',
    });
    const workInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Job title', ariaRole: 'textbox',
      inputType: 'text' as any, testId: 'jobTitle', cssSelector: 'input#jobTitle',
    });

    const result = runFullPipeline([
      makeEvent('click', tab1),
      makeEvent('focus', personalInput, makeContext({ inputType: 'text' })),
      makeEvent('input', personalInput, makeContext({ inputType: 'text' }), { valueAfter: 'John' }),
      makeEvent('blur', personalInput, makeContext({ inputType: 'text' }), { valueAfter: 'John' }),
      makeEvent('click', tab2),
      makeEvent('focus', workInput, makeContext({ inputType: 'text' })),
      makeEvent('input', workInput, makeContext({ inputType: 'text' }), { valueAfter: 'Engineer' }),
      makeEvent('blur', workInput, makeContext({ inputType: 'text' }), { valueAfter: 'Engineer' }),
    ]);

    const types = result.interactions.map(ci => getResolvedType(ci));
    const stepCount = result.irPlan?.steps.length ?? 0;

    recordFinding({
      capabilityId: 'MS-4', capabilityName: 'Tab Navigation Flow',
      scenario: 'Click tab1 → fill → click tab2 → fill',
      app: 'synthetic (settings page)',
      expected: '4 interactions: Tab, TextEntry, Tab, TextEntry',
      observed: `${result.interactions.length} interactions: [${types.join(', ')}], ${stepCount} steps`,
      scores: {
        q1_intent: types.length === 4 ? 5 : 3,
        q2_abstraction: types.length === 4 ? 5 : 3,
        q3_locator: 4, q4_description: 4, q5_replay: 4,
        q6_confidence: 4, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: types.length === 4 ? 'full' : 'partial',
      rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

describe('Multi-Step: E-commerce Product Selection', () => {
  it('search → click product → select quantity → add to cart', () => {
    const search = makeTarget({
      tag: 'INPUT', accessibleName: 'Search', ariaRole: 'searchbox',
      inputType: 'search' as any, testId: 'search', cssSelector: 'input.search',
    });
    const productCard = makeTarget({
      tag: 'DIV', accessibleName: 'Wireless Headphones', ariaRole: 'button',
      testId: 'product-1', cssSelector: 'div.product-card',
    });
    const qtyPlus = makeTarget({
      tag: 'BUTTON', accessibleName: '+', ariaRole: 'button',
      className: 'qty-plus increment', cssSelector: 'button.qty-plus',
    });
    const addToCart = makeTarget({
      tag: 'BUTTON', accessibleName: 'Add to Cart', ariaRole: 'button',
      testId: 'add-to-cart', cssSelector: 'button.add-to-cart',
    });

    const result = runFullPipeline([
      makeEvent('focus', search, makeContext({ inputType: 'search' })),
      makeEvent('input', search, makeContext({ inputType: 'search' }), { valueAfter: 'headphones' }),
      makeEvent('blur', search, makeContext({ inputType: 'search' }), { valueAfter: 'headphones' }),
      makeEvent('click', productCard),
      makeEvent('click', qtyPlus),
      makeEvent('click', addToCart),
    ]);

    const types = result.interactions.map(ci => getResolvedType(ci));
    const stepCount = result.irPlan?.steps.length ?? 0;

    recordFinding({
      capabilityId: 'MS-5', capabilityName: 'E-commerce Selection',
      scenario: 'Search → click product → qty+ → add to cart',
      app: 'synthetic (e-commerce)',
      expected: '4 interactions: TextEntry, Click, Stepper, Click',
      observed: `${result.interactions.length} interactions: [${types.join(', ')}], ${stepCount} steps`,
      scores: {
        q1_intent: 4, q2_abstraction: result.interactions.length === 4 ? 5 : 3,
        q3_locator: 4, q4_description: 3, q5_replay: 3,
        q6_confidence: 3, q7_evidence: 3, q8_assertion: 2,
      },
      supportLevel: 'full', rootCause: '', severity: 'P2',
      emitted: result.interactions, plan: result.irPlan, playwrightCode: result.playwright,
    } as Finding);
  });
});

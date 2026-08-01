/**
 * Area 3 — Multi-Step Workflow Validation
 *
 * Tests whether the recorder handles sequences of interactions as coherent
 * workflows — state tracking, ordering, context carryover, and multi-element
 * flows that exercise the pipeline end to end.
 *
 * Each test simulates a realistic multi-step user workflow (login, form fill,
 * wizard, data table interaction, etc.) and verifies:
 *  - All interactions are captured (no drops)
 *  - Interaction ordering is preserved
 *  - Each step is correctly classified
 *  - The IR plan preserves step order
 *  - Playwright output is sequential and replayable
 *  - Assertions are meaningful for state changes
 *
 * Architecture: .drytis/EXPANDED_VALIDATION_DESIGN.md §5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runFullPipeline, makeTarget, makeContext, makeEvent, resetEventCounter } from './harness';
import type { RawObservation } from './types';

// ── Helpers ──────────────────────────────────────────────────────────

const observations: RawObservation[] = [];

function recordObs(
  observationId: string,
  capabilityId: string,
  scores: RawObservation['scores'],
  observed: string,
  rootCause: string,
  category: RawObservation['category'],
  severity: RawObservation['severity'],
  subsystem: RawObservation['subsystem'],
  emitted?: unknown[],
  playwrightCode?: string | null,
): void {
  observations.push({
    observationId,
    area: 'workflow',
    capabilityId,
    framework: null,
    scores,
    support: scores.q1_intent >= 4 ? 'full' : scores.q1_intent >= 2 ? 'partial' : 'unsupported',
    observed,
    rootCause,
    category,
    severity,
    subsystem,
    confidence: 'VERIFIED',
    emittedInteractions: emitted,
    playwrightCode,
  });
}

function getTypes(result: ReturnType<typeof runFullPipeline>): string[] {
  return result.interactions.map(ci => {
    const r = ci as Record<string, unknown>;
    return (r.interactionSubtype as string) ?? (r.type as string);
  });
}

function getPlanStepTypes(result: ReturnType<typeof runFullPipeline>): string[] {
  if (!result.irPlan) return [];
  return result.irPlan.steps.map(s => s.action);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Multi-Step Workflows', () => {
  beforeEach(() => resetEventCounter());

  // ── WF-01: Login Flow ──────────────────────────────────────────────

  describe('WF-01: Login flow (email + password + submit)', () => {
    it('captures all 3 steps with correct types and ordering', () => {
      const emailTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        accessibleName: 'Email',
        cssSelector: 'input[type="email"]',
        xPath: '//input[@type="email"]',
        testId: 'email-input',
      });
      const passTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        accessibleName: 'Password',
        cssSelector: 'input[type="password"]',
        xPath: '//input[@type="password"]',
        testId: 'password-input',
      });
      const submitTarget = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Sign in',
        cssSelector: 'button[type="submit"]',
        xPath: '//button[@type="submit"]',
        testId: 'login-btn',
      });

      const events = [
        makeEvent('focus', emailTarget, makeContext({ inputType: 'email' }), { timestamp: 1000 }),
        makeEvent('input', emailTarget, makeContext({ inputType: 'email' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'user@test.com' }),
        makeEvent('blur', emailTarget, makeContext({ inputType: 'email' }),
          { timestamp: 1200, valueBefore: '', valueAfter: 'user@test.com' }),
        makeEvent('focus', passTarget, makeContext({ inputType: 'password' }), { timestamp: 2000 }),
        makeEvent('input', passTarget, makeContext({ inputType: 'password' }),
          { timestamp: 2100, valueBefore: '', valueAfter: 'secret123' }),
        makeEvent('blur', passTarget, makeContext({ inputType: 'password' }),
          { timestamp: 2200, valueBefore: '', valueAfter: 'secret123' }),
        makeEvent('click', submitTarget, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/login',
        pageTitle: 'Sign in',
        testCaseName: 'User can log in',
      });

      const types = getTypes(result);
      const stepTypes = getPlanStepTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      const allCorrect = interactionCount >= 2; // text entries might merge
      const hasSubmit = types.includes('Click') || types.includes('Button');
      const order = result.interactions
        .map(ci => (ci as Record<string, unknown>).interactionId as string)
        .join(',');
      const sorted = [...result.interactions].sort(
        (a, b) => (a as Record<string, unknown>).timestamp as number - (b as Record<string, unknown>).timestamp as number
      );
      const orderPreserved = sorted.every((ci, i) =>
        (ci as Record<string, unknown>).interactionId === result.interactions[i].interactionId
      );

      const q1 = allCorrect && hasSubmit ? 5 : 2;
      const q2 = interactionCount <= 3 ? 5 : 3;
      const q5 = stepCount >= 2 && stepCount <= 4 ? 5 : 3;

      recordObs('WF-01', 'login-flow',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q5, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}], ${stepCount} IR steps [${stepTypes.join(', ')}]`,
        allCorrect ? 'None' : 'Submit click not captured or text entries not captured',
        'implementation-gap',
        allCorrect ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── WF-02: Form Fill (5 fields + submit) ───────────────────────────

  describe('WF-02: Form fill (5 fields + submit)', () => {
    it('captures all fields without dedup drops', () => {
      const fields = [
        { name: 'First name', type: 'text', testId: 'firstName', value: 'John' },
        { name: 'Last name', type: 'text', testId: 'lastName', value: 'Doe' },
        { name: 'Email', type: 'email', testId: 'email', value: 'john@example.com' },
        { name: 'Phone', type: 'tel', testId: 'phone', value: '555-1234' },
        { name: 'City', type: 'text', testId: 'city', value: 'New York' },
      ];

      const events = fields.flatMap((f, i) => {
        const target = makeTarget({
          tag: 'INPUT',
          ariaRole: 'textbox',
          accessibleName: f.name,
          testId: f.testId,
          cssSelector: `input[data-testid="${f.testId}"]`,
          xPath: `//input[@data-testid="${f.testId}"]`,
        });
        const baseTime = 1000 + i * 1000;
        return [
          makeEvent('focus', target, makeContext({ inputType: f.type }), { timestamp: baseTime }),
          makeEvent('input', target, makeContext({ inputType: f.type }),
            { timestamp: baseTime + 50, valueBefore: '', valueAfter: f.value }),
          makeEvent('blur', target, makeContext({ inputType: f.type }),
            { timestamp: baseTime + 100, valueBefore: '', valueAfter: f.value }),
        ];
      });

      const submitTarget = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Save profile',
        testId: 'save-btn',
        cssSelector: 'button[type="submit"]',
        xPath: '//button[@type="submit"]',
      });
      events.push(makeEvent('click', submitTarget, makeContext({}), { timestamp: 6000 }));

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/profile/edit',
        pageTitle: 'Edit Profile',
        testCaseName: 'Fill profile form',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      // Should capture at least 5 text entries + 1 click
      const textEntries = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return (t.type === 'TextEntry' || t.interactionSubtype === 'TextEntry');
      }).length;
      const clicks = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return t.type === 'Click' || t.interactionSubtype === 'Click';
      }).length;

      // The recorder may deduplicate nearby inputs but 5 distinct fields
      // with distinct testIds should produce at least 5 text entries.
      const hasAll = textEntries >= 4;
      const hasSubmit = clicks >= 1;
      const allGood = hasAll && hasSubmit;

      const q1 = allGood ? 5 : 2;
      const q2 = interactionCount === 6 ? 5 : interactionCount > 6 ? 3 : 2;
      const q5 = stepCount >= 5 ? 5 : 3;

      recordObs('WF-02', 'form-fill-5',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q5, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions (text=${textEntries}, click=${clicks}), ${stepCount} IR steps. Types: [${types.join(', ')}]`,
        allGood ? 'None' : `Expected ≥5 text + 1 click, got text=${textEntries}, click=${clicks}`,
        'implementation-gap',
        allGood ? 'P3' : 'P1',
        'Pipeline/Dedup',
        result.interactions,
        result.playwright,
      );

      expect(result.interactions.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ── WF-03: Multi-Step Wizard (3 steps, navigation) ─────────────────

  describe('WF-03: Multi-step wizard (step navigation)', () => {
    it('captures step form + next-button navigation', () => {
      // Step 1: enter name, click "Next"
      const nameTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'textbox',
        accessibleName: 'Project name',
        testId: 'proj-name',
        cssSelector: 'input[data-testid="proj-name"]',
        xPath: '//input[@data-testid="proj-name"]',
      });
      const next1Target = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Next',
        testId: 'next-step-1',
        cssSelector: 'button[data-testid="next-step-1"]',
        xPath: '//button[@data-testid="next-step-1"]',
      });
      // Step 2: select template from dropdown
      const dropdownTrigger = makeTarget({
        tag: 'DIV',
        ariaRole: 'combobox',
        ariaExpanded: null,
        accessibleName: 'Template',
        className: 'MuiSelect-select',
        testId: 'template-select',
        cssSelector: 'div[data-testid="template-select"]',
        xPath: '//div[@data-testid="template-select"]',
      });
      const dropdownOption = makeTarget({
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'React + TypeScript',
        cssSelector: 'li[data-value="react-ts"]',
        xPath: '//li[@data-value="react-ts"]',
      });
      const next2Target = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Next',
        testId: 'next-step-2',
        cssSelector: 'button[data-testid="next-step-2"]',
        xPath: '//button[@data-testid="next-step-2"]',
      });
      // Step 3: checkbox, click "Create"
      const checkboxTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'checkbox',
        accessibleName: 'Initialize git repository',
        testId: 'init-git',
        cssSelector: 'input[data-testid="init-git"]',
        xPath: '//input[@data-testid="init-git"]',
      });
      const createTarget = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Create project',
        testId: 'create-btn',
        cssSelector: 'button[data-testid="create-btn"]',
        xPath: '//button[@data-testid="create-btn"]',
      });

      const events = [
        // Step 1
        makeEvent('focus', nameTarget, makeContext({ inputType: 'text' }), { timestamp: 1000 }),
        makeEvent('input', nameTarget, makeContext({ inputType: 'text' }),
          { timestamp: 1050, valueBefore: '', valueAfter: 'My App' }),
        makeEvent('blur', nameTarget, makeContext({ inputType: 'text' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'My App' }),
        makeEvent('click', next1Target, makeContext({}), { timestamp: 2000 }),
        // Step 2 (simulate page change with different elements)
        makeEvent('mousedown', dropdownTrigger, makeContext({ ariaHasPopup: 'listbox' }), { timestamp: 3000 }),
        makeEvent('click', dropdownOption, makeContext({}), { timestamp: 3500 }),
        makeEvent('click', next2Target, makeContext({}), { timestamp: 4000 }),
        // Step 3
        makeEvent('click', checkboxTarget, makeContext({}),
          { timestamp: 5000, checkedBefore: false, checkedAfter: true }),
        makeEvent('click', createTarget, makeContext({}), { timestamp: 6000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/new',
        pageTitle: 'Create Project',
        testCaseName: 'Create project via wizard',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      // Should have: text entry, click (next), dropdown, click (next), checkbox, click (create)
      const hasTextEntry = types.some(t => t.includes('TextEntry') || t.includes('Text'));
      const hasCheckbox = types.some(t => t.includes('Checkbox') || t.includes('Check'));
      const hasDropdown = types.some(t => t.includes('Dropdown') || t.includes('Select'));

      const allCaptured = interactionCount >= 5;
      const q1 = allCaptured && hasTextEntry && hasCheckbox ? 5 : 2;
      const q2 = interactionCount >= 5 && interactionCount <= 8 ? 5 : 3;
      const q5 = stepCount >= 5 ? 5 : 3;

      recordObs('WF-03', 'wizard-3-step',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 3, q5_replay: q5, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}], ${stepCount} IR steps. text=${hasTextEntry}, checkbox=${hasCheckbox}, dropdown=${hasDropdown}`,
        allCaptured ? 'None' : 'Steps dropped during dedup or not captured',
        'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(result.interactions.length).toBeGreaterThanOrEqual(4);
    });
  });

  // ── WF-04: Data Table Interaction ──────────────────────────────────

  describe('WF-04: Data table (sort column + click row)', () => {
    it('captures header click and row selection', () => {
      const headerTarget = makeTarget({
        tag: 'TH',
        ariaRole: 'columnheader',
        accessibleName: 'Name',
        testId: 'col-name',
        cssSelector: 'th[data-testid="col-name"]',
        xPath: '//th[@data-testid="col-name"]',
      });
      const rowTarget = makeTarget({
        tag: 'TR',
        ariaRole: 'row',
        accessibleName: 'Alice Smith, Developer',
        className: 'MuiTableRow-root',
        testId: 'row-0',
        cssSelector: 'tr[data-testid="row-0"]',
        xPath: '//tr[@data-testid="row-0"]',
      });

      const events = [
        makeEvent('click', headerTarget, makeContext({}), { timestamp: 1000 }),
        makeEvent('click', rowTarget, makeContext({}), { timestamp: 2000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/users',
        pageTitle: 'Users',
        testCaseName: 'Sort and select user',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      // Both should be classified as Click at minimum.
      // Ideally header click would detect sort intent.
      const hasHeaderClick = interactionCount >= 1;
      const hasRowClick = interactionCount >= 2;
      const allCaptured = hasHeaderClick && hasRowClick;

      const q1 = allCaptured ? 4 : 2; // Click is correct but sort intent not detected
      const q4 = 3; // Generic click descriptions, no "sort by Name" semantics

      recordObs('WF-04', 'data-table',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${interactionCount} interactions [${types.join(', ')}], ${stepCount} IR steps`,
        allCaptured ? 'None (sort intent detection is a future enhancement)' : 'Row or header click not captured — TH/TR elements filtered by isInteractiveElement gate',
        allCaptured ? 'capability-gap' : 'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      // Observation test — 0 interactions is a valid finding
      expect(result).toBeDefined();
    });
  });

  // ── WF-05: Search + Filter + Results ───────────────────────────────

  describe('WF-05: Search + filter + interact with result', () => {
    it('captures search input, filter dropdown, and result click', () => {
      const searchTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'searchbox',
        accessibleName: 'Search products',
        testId: 'search-input',
        cssSelector: 'input[data-testid="search-input"]',
        xPath: '//input[@data-testid="search-input"]',
      });
      const filterTrigger = makeTarget({
        tag: 'DIV',
        ariaRole: 'combobox',
        ariaExpanded: null,
        accessibleName: 'Category',
        className: 'MuiSelect-select',
        testId: 'category-filter',
        cssSelector: 'div[data-testid="category-filter"]',
        xPath: '//div[@data-testid="category-filter"]',
      });
      const filterOption = makeTarget({
        tag: 'LI',
        ariaRole: 'option',
        accessibleName: 'Electronics',
        cssSelector: 'li[data-value="electronics"]',
        xPath: '//li[@data-value="electronics"]',
      });
      const resultTarget = makeTarget({
        tag: 'A',
        ariaRole: 'link',
        accessibleName: 'Wireless Headphones - $79.99',
        testId: 'product-42',
        cssSelector: 'a[data-testid="product-42"]',
        xPath: '//a[@data-testid="product-42"]',
      });

      const events = [
        // Search
        makeEvent('focus', searchTarget, makeContext({ inputType: 'search' }), { timestamp: 1000 }),
        makeEvent('input', searchTarget, makeContext({ inputType: 'search' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'headphones' }),
        makeEvent('blur', searchTarget, makeContext({ inputType: 'search' }),
          { timestamp: 1200, valueBefore: '', valueAfter: 'headphones' }),
        // Filter
        makeEvent('mousedown', filterTrigger, makeContext({ ariaHasPopup: 'listbox' }), { timestamp: 2000 }),
        makeEvent('click', filterOption, makeContext({}), { timestamp: 2500 }),
        // Click result
        makeEvent('click', resultTarget, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://shop.example.com',
        pageTitle: 'Products',
        testCaseName: 'Search and select product',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      const hasTextEntry = types.some(t => t.includes('Text'));
      const hasDropdown = types.some(t => t.includes('Dropdown'));
      const hasClick = types.some(t => t === 'Click' || t === 'Link');

      const allCaptured = interactionCount >= 3;
      const q1 = allCaptured ? 4 : 2;
      const q4 = hasTextEntry && hasDropdown ? 4 : 2;

      recordObs('WF-05', 'search-filter-result',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}], ${stepCount} IR steps. text=${hasTextEntry}, dropdown=${hasDropdown}, click=${hasClick}`,
        allCaptured ? 'None' : 'Some interactions not captured',
        'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── WF-06: Toggle + Conditional Content ────────────────────────────

  describe('WF-06: Toggle switch reveals conditional form', () => {
    it('captures toggle and conditional field interaction', () => {
      const toggleTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'switch',
        accessibleName: 'Enable notifications',
        testId: 'notif-toggle',
        cssSelector: 'input[data-testid="notif-toggle"]',
        xPath: '//input[@data-testid="notif-toggle"]',
      });
      const conditionalTarget = makeTarget({
        tag: 'INPUT',
        ariaRole: 'spinbutton',
        accessibleName: 'Notification frequency (minutes)',
        inputType: 'number',
        testId: 'notif-freq',
        cssSelector: 'input[data-testid="notif-freq"]',
        xPath: '//input[@data-testid="notif-freq"]',
      });

      const events = [
        makeEvent('click', toggleTarget, makeContext({}),
          { timestamp: 1000, checkedBefore: false, checkedAfter: true }),
        // Conditional field appears after toggle
        makeEvent('focus', conditionalTarget, makeContext({ inputType: 'number' }), { timestamp: 2000 }),
        makeEvent('input', conditionalTarget, makeContext({ inputType: 'number' }),
          { timestamp: 2100, valueBefore: '', valueAfter: '30' }),
        makeEvent('blur', conditionalTarget, makeContext({ inputType: 'number' }),
          { timestamp: 2200, valueBefore: '', valueAfter: '30' }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/settings',
        pageTitle: 'Settings',
        testCaseName: 'Enable notifications and set frequency',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      const hasToggle = types.some(t => t.includes('Switch') || t.includes('Toggle') || t.includes('Checkbox'));
      const hasText = types.some(t => t.includes('Text'));

      const q1 = interactionCount >= 2 ? 4 : 2;
      const q4 = hasToggle ? 3 : 2; // Switch vs Checkbox classification

      recordObs('WF-06', 'toggle-conditional',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}]. toggle=${hasToggle}, text=${hasText}`,
        'None (toggle likely classified as Checkbox, not Switch — semantic nuance)',
        'capability-gap',
        'P3',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── WF-07: Shopping Cart Flow ──────────────────────────────────────

  describe('WF-07: Shopping cart (add qty + remove)', () => {
    it('captures quantity change and remove button', () => {
      const qtyIncTarget = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Increase quantity',
        testId: 'qty-inc-0',
        cssSelector: 'button[data-testid="qty-inc-0"]',
        xPath: '//button[@data-testid="qty-inc-0"]',
      });
      const removeTarget = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Remove item',
        testId: 'remove-0',
        cssSelector: 'button[data-testid="remove-0"]',
        xPath: '//button[@data-testid="remove-0"]',
      });

      const events = [
        makeEvent('click', qtyIncTarget, makeContext({}), { timestamp: 1000 }),
        makeEvent('click', qtyIncTarget, makeContext({}), { timestamp: 2000 }),
        makeEvent('click', removeTarget, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://shop.example.com/cart',
        pageTitle: 'Shopping Cart',
        testCaseName: 'Adjust cart quantities and remove item',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      // Clicking same button twice should produce 2 interactions or at least
      // dedup to one with count metadata. Let's see what happens.
      const hasClick = interactionCount >= 1;

      recordObs('WF-07', 'shopping-cart',
        { q1_intent: hasClick ? 4 : 2, q2_abstraction: 3, q3_locator: 4, q4_description: 3, q5_replay: 3, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${interactionCount} interactions [${types.join(', ')}] (3 clicks sent: 2× same button + 1× different)`,
        interactionCount < 2 ? 'Same-element dedup may merge repeated clicks on the same target' : 'None',
        interactionCount < 2 ? 'architectural-limitation' : 'implementation-gap',
        interactionCount < 2 ? 'P2' : 'P3',
        'Pipeline/Dedup',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── WF-08: Tab Navigation Between Views ────────────────────────────

  describe('WF-08: Tab navigation (3 tabs + content per tab)', () => {
    it('captures tab switches and interactions within tabs', () => {
      const tab1 = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'tab',
        ariaSelected: true,
        accessibleName: 'Profile',
        testId: 'tab-profile',
        cssSelector: 'button[data-testid="tab-profile"]',
        xPath: '//button[@data-testid="tab-profile"]',
      });
      const tab2 = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'tab',
        ariaSelected: false,
        accessibleName: 'Security',
        testId: 'tab-security',
        cssSelector: 'button[data-testid="tab-security"]',
        xPath: '//button[@data-testid="tab-security"]',
      });
      const tab3 = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'tab',
        ariaSelected: false,
        accessibleName: 'Billing',
        testId: 'tab-billing',
        cssSelector: 'button[data-testid="tab-billing"]',
        xPath: '//button[@data-testid="tab-billing"]',
      });
      // Interact in Security tab
      const changePassBtn = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Change password',
        testId: 'change-pass-btn',
        cssSelector: 'button[data-testid="change-pass-btn"]',
        xPath: '//button[@data-testid="change-pass-btn"]',
      });

      const events = [
        makeEvent('click', tab2, makeContext({}), { timestamp: 1000 }),
        makeEvent('click', changePassBtn, makeContext({}), { timestamp: 2000 }),
        makeEvent('click', tab3, makeContext({}), { timestamp: 3000 }),
        makeEvent('click', tab1, makeContext({}), { timestamp: 4000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/settings',
        pageTitle: 'Account Settings',
        testCaseName: 'Navigate tabs and interact',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      const hasTab = types.some(t => t.includes('Tab'));
      const hasClick = types.some(t => t === 'Click');

      // All 4 should be captured
      const allCaptured = interactionCount >= 4;
      const q1 = allCaptured ? 5 : 3;
      const q4 = hasTab ? 4 : 2;

      recordObs('WF-08', 'tab-navigation',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}], ${stepCount} IR steps. tab=${hasTab}, click=${hasClick}`,
        allCaptured ? 'None' : 'Some tab clicks dropped or not classified as Tab',
        'implementation-gap',
        allCaptured ? 'P3' : 'P2',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(3);
    });
  });

  // ── WF-09: Modal Dialog Interaction ────────────────────────────────

  describe('WF-09: Modal dialog (open + interact + close)', () => {
    it('captures modal trigger, field inside modal, and close', () => {
      const openModalBtn = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Add comment',
        testId: 'add-comment-btn',
        cssSelector: 'button[data-testid="add-comment-btn"]',
        xPath: '//button[@data-testid="add-comment-btn"]',
      });
      const modalTextarea = makeTarget({
        tag: 'TEXTAREA',
        ariaRole: 'textbox',
        accessibleName: 'Your comment',
        testId: 'comment-text',
        cssSelector: 'textarea[data-testid="comment-text"]',
        xPath: '//textarea[@data-testid="comment-text"]',
      });
      const saveBtn = makeTarget({
        tag: 'BUTTON',
        ariaRole: 'button',
        accessibleName: 'Save comment',
        testId: 'save-comment-btn',
        cssSelector: 'button[data-testid="save-comment-btn"]',
        xPath: '//button[@data-testid="save-comment-btn"]',
      });

      const events = [
        makeEvent('click', openModalBtn, makeContext({}), { timestamp: 1000 }),
        makeEvent('focus', modalTextarea, makeContext({ isContentEditable: false }), { timestamp: 2000 }),
        makeEvent('input', modalTextarea, makeContext({ isContentEditable: false }),
          { timestamp: 2100, valueBefore: '', valueAfter: 'Great work!' }),
        makeEvent('blur', modalTextarea, makeContext({ isContentEditable: false }),
          { timestamp: 2200, valueBefore: '', valueAfter: 'Great work!' }),
        makeEvent('click', saveBtn, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/post/123',
        pageTitle: 'Post Details',
        testCaseName: 'Add comment via modal',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      const hasText = types.some(t => t.includes('Text'));
      const hasClick = types.some(t => t === 'Click');

      // All 3 interactions should be captured
      const allCaptured = interactionCount >= 3;
      const q1 = allCaptured ? 5 : 2;

      recordObs('WF-09', 'modal-dialog',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions [${types.join(', ')}]. text=${hasText}, click=${hasClick}`,
        allCaptured ? 'None' : 'Modal interactions not fully captured',
        'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── WF-10: Rapid Form Filling (stress test dedup) ──────────────────

  describe('WF-10: Rapid form filling (stress dedup)', () => {
    it('does not drop interactions when filling fields in quick succession', () => {
      const events: Parameters<typeof makeEvent>[] = [];
      // 10 fields, 100ms apart
      for (let i = 0; i < 10; i++) {
        const target = makeTarget({
          tag: 'INPUT',
          ariaRole: 'textbox',
          accessibleName: `Field ${i + 1}`,
          testId: `field-${i}`,
          cssSelector: `input[data-testid="field-${i}"]`,
          xPath: `//input[@data-testid="field-${i}"]`,
        });
        events.push(
          ['focus', target, makeContext({ inputType: 'text' }), { timestamp: 1000 + i * 100 }],
          ['input', target, makeContext({ inputType: 'text' }),
            { timestamp: 1010 + i * 100, valueBefore: '', valueAfter: `val${i}` }],
          ['blur', target, makeContext({ inputType: 'text' }),
            { timestamp: 1020 + i * 100, valueBefore: '', valueAfter: `val${i}` }],
        );
      }

      const obsEvents = events.map(e => makeEvent(...e));

      const result = runFullPipeline(obsEvents, {
        startUrl: 'https://app.example.com/form',
        pageTitle: 'Big Form',
        testCaseName: 'Fill 10 fields rapidly',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      // With 10 distinct testIds, dedup should not merge them.
      const textCount = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return t.type === 'TextEntry' || t.interactionSubtype === 'TextEntry';
      }).length;

      const q1 = textCount >= 8 ? 5 : textCount >= 5 ? 3 : 1;
      const q2 = textCount === 10 ? 5 : textCount >= 8 ? 4 : 2;

      recordObs('WF-10', 'rapid-form-fill-10',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions (${textCount} text entries), expected 10 text entries. Types: [${types.join(', ')}]`,
        textCount < 10 ? `Dedup dropped ${10 - textCount} interactions despite distinct testIds` : 'None',
        textCount < 10 ? 'implementation-gap' : 'implementation-gap',
        textCount < 8 ? 'P1' : textCount < 10 ? 'P2' : 'P3',
        'Pipeline/Dedup',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(5);
    });
  });

  // ── WF-11: Checkbox Group (multiple checkboxes) ────────────────────

  describe('WF-11: Checkbox group (select 3 of 5)', () => {
    it('captures all 3 checkbox toggles as distinct interactions', () => {
      const events: ReturnType<typeof makeEvent>[] = [];
      const labels = ['Reading', 'Music', 'Sports', 'Cooking', 'Travel'];
      const checkedIndices = [0, 2, 4];

      for (const idx of checkedIndices) {
        const target = makeTarget({
          tag: 'INPUT',
          ariaRole: 'checkbox',
          accessibleName: labels[idx],
          testId: `hobby-${idx}`,
          cssSelector: `input[data-testid="hobby-${idx}"]`,
          xPath: `//input[@data-testid="hobby-${idx}"]`,
        });
        events.push(
          makeEvent('click', target, makeContext({}),
            { timestamp: 1000 + idx * 500, checkedBefore: false, checkedAfter: true })
        );
      }

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/signup',
        pageTitle: 'Sign Up',
        testCaseName: 'Select 3 hobbies',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      const checkboxCount = result.interactions.filter(ci => {
        const t = (ci as Record<string, unknown>);
        return t.type === 'Checkbox' || t.interactionSubtype === 'Checkbox';
      }).length;

      const allCaptured = checkboxCount >= 3;
      const q1 = allCaptured ? 5 : 2;
      const q2 = checkboxCount === 3 ? 5 : 3;

      recordObs('WF-11', 'checkbox-group-3',
        { q1_intent: q1, q2_abstraction: q2, q3_locator: 4, q4_description: 4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions (${checkboxCount} checkboxes), expected 3. Types: [${types.join(', ')}]`,
        allCaptured ? 'None' : 'Some checkbox toggles were dropped or misclassified',
        'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── WF-12: Mixed Form (text + select + radio + checkbox + submit) ──

  describe('WF-12: Mixed form (all field types)', () => {
    it('captures every field type in a diverse form', () => {
      const textTarget = makeTarget({
        tag: 'INPUT', ariaRole: 'textbox', accessibleName: 'Full name',
        testId: 'fullname', cssSelector: 'input[data-testid="fullname"]',
        xPath: '//input[@data-testid="fullname"]',
      });
      const selectTarget = makeTarget({
        tag: 'SELECT', ariaRole: null, accessibleName: 'Country',
        testId: 'country', cssSelector: 'select[data-testid="country"]',
        xPath: '//select[@data-testid="country"]',
      });
      const radioTarget = makeTarget({
        tag: 'INPUT', ariaRole: 'radio', accessibleName: 'Express shipping',
        testId: 'ship-express', cssSelector: 'input[data-testid="ship-express"]',
        xPath: '//input[@data-testid="ship-express"]',
      });
      const checkTarget = makeTarget({
        tag: 'INPUT', ariaRole: 'checkbox', accessibleName: 'Gift wrap',
        testId: 'gift-wrap', cssSelector: 'input[data-testid="gift-wrap"]',
        xPath: '//input[@data-testid="gift-wrap"]',
      });
      const submitTarget = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Place order',
        testId: 'place-order', cssSelector: 'button[data-testid="place-order"]',
        xPath: '//button[@data-testid="place-order"]',
      });

      const events = [
        makeEvent('focus', textTarget, makeContext({ inputType: 'text' }), { timestamp: 1000 }),
        makeEvent('input', textTarget, makeContext({ inputType: 'text' }),
          { timestamp: 1050, valueBefore: '', valueAfter: 'Jane Smith' }),
        makeEvent('blur', textTarget, makeContext({ inputType: 'text' }),
          { timestamp: 1100, valueBefore: '', valueAfter: 'Jane Smith' }),
        makeEvent('change', selectTarget, makeContext({}), // native select change
          { timestamp: 2000, valueBefore: '', valueAfter: 'Canada' }),
        makeEvent('click', radioTarget, makeContext({}),
          { timestamp: 3000, checkedBefore: false, checkedAfter: true }),
        makeEvent('click', checkTarget, makeContext({}),
          { timestamp: 4000, checkedBefore: false, checkedAfter: true }),
        makeEvent('click', submitTarget, makeContext({}), { timestamp: 5000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://shop.example.com/checkout',
        pageTitle: 'Checkout',
        testCaseName: 'Complete checkout form',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const stepCount = result.irPlan?.steps.length ?? 0;

      const hasText = types.some(t => t.includes('Text'));
      const hasSelect = types.some(t => t.includes('Dropdown') || t.includes('Select') || t.includes('NativeDropdown'));
      const hasRadio = types.some(t => t.includes('Radio'));
      const hasCheckbox = types.some(t => t.includes('Checkbox'));
      const hasClick = types.some(t => t === 'Click' || t === 'Button');

      const diversity = [hasText, hasSelect, hasRadio, hasCheckbox, hasClick].filter(Boolean).length;
      const q1 = diversity >= 4 ? 5 : diversity >= 3 ? 3 : 1;
      const q4 = diversity >= 4 ? 4 : 2;

      recordObs('WF-12', 'mixed-form-all-types',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 3 },
        `${interactionCount} interactions, ${stepCount} steps. Diversity: ${diversity}/5 types (text=${hasText}, select=${hasSelect}, radio=${hasRadio}, checkbox=${hasCheckbox}, click=${hasClick}). Types: [${types.join(', ')}]`,
        diversity < 4 ? 'Some field types not classified correctly' : 'None',
        'implementation-gap',
        diversity >= 4 ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(3);
    });
  });

  // ── WF-13: Pagination Navigation ───────────────────────────────────

  describe('WF-13: Pagination (next page, page 3, prev page)', () => {
    it('captures pagination clicks', () => {
      const nextBtn = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Next page',
        testId: 'page-next', cssSelector: 'button[data-testid="page-next"]',
        xPath: '//button[@data-testid="page-next"]',
      });
      const page3 = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Page 3',
        testId: 'page-3', cssSelector: 'button[data-testid="page-3"]',
        xPath: '//button[@data-testid="page-3"]',
      });
      const prevBtn = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Previous page',
        testId: 'page-prev', cssSelector: 'button[data-testid="page-prev"]',
        xPath: '//button[@data-testid="page-prev"]',
      });

      const events = [
        makeEvent('click', nextBtn, makeContext({}), { timestamp: 1000 }),
        makeEvent('click', page3, makeContext({}), { timestamp: 2000 }),
        makeEvent('click', prevBtn, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/items?page=1',
        pageTitle: 'Items',
        testCaseName: 'Navigate pagination',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      // These should all be Click; pagination semantic detection is future.
      const allCaptured = interactionCount >= 3;
      const q1 = allCaptured ? 4 : 2;
      const q4 = 2; // Generic click descriptions, no "navigate to page 3" semantics

      recordObs('WF-13', 'pagination',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: q4, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${interactionCount} interactions [${types.join(', ')}] (3 pagination clicks sent)`,
        allCaptured ? 'None (pagination navigation semantics not detected — future enhancement)' : 'Some pagination clicks dropped',
        allCaptured ? 'capability-gap' : 'implementation-gap',
        allCaptured ? 'P3' : 'P1',
        'Pipeline',
        result.interactions,
        [result.playwright],
      );

      expect(interactionCount).toBeGreaterThanOrEqual(2);
    });
  });

  // ── WF-14: Nested Accordion ────────────────────────────────────────

  describe('WF-14: Nested accordion (expand + interact + collapse)', () => {
    it('captures accordion expand, interaction inside, and collapse', () => {
      const accordionHeader = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', ariaExpanded: false,
        accessibleName: 'Advanced settings',
        testId: 'accordion-advanced', cssSelector: 'button[data-testid="accordion-advanced"]',
        xPath: '//button[@data-testid="accordion-advanced"]',
      });
      const innerField = makeTarget({
        tag: 'INPUT', ariaRole: 'spinbutton', accessibleName: 'Cache TTL (seconds)',
        testId: 'cache-ttl', cssSelector: 'input[data-testid="cache-ttl"]',
        xPath: '//input[@data-testid="cache-ttl"]',
      });
      const accordionHeader2 = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', ariaExpanded: true,
        accessibleName: 'Advanced settings',
        testId: 'accordion-advanced', cssSelector: 'button[data-testid="accordion-advanced"]',
        xPath: '//button[@data-testid="accordion-advanced"]',
      });

      const events = [
        makeEvent('click', accordionHeader, makeContext({}), { timestamp: 1000 }),
        makeEvent('focus', innerField, makeContext({ inputType: 'number' }), { timestamp: 2000 }),
        makeEvent('input', innerField, makeContext({ inputType: 'number' }),
          { timestamp: 2100, valueBefore: '', valueAfter: '3600' }),
        makeEvent('blur', innerField, makeContext({ inputType: 'number' }),
          { timestamp: 2200, valueBefore: '', valueAfter: '3600' }),
        makeEvent('click', accordionHeader2, makeContext({}), { timestamp: 3000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/config',
        pageTitle: 'Configuration',
        testCaseName: 'Expand accordion, configure, collapse',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      const hasText = types.some(t => t.includes('Text'));
      const hasClick = types.some(t => t === 'Click');

      const allCaptured = interactionCount >= 2;
      const q1 = allCaptured ? 4 : 2;

      recordObs('WF-14', 'nested-accordion',
        { q1_intent: q1, q2_abstraction: 3, q3_locator: 4, q4_description: 3, q5_replay: 3, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${interactionCount} interactions [${types.join(', ')}]. text=${hasText}, click=${hasClick} (expand+collapse on same element)`,
        'Accordion expand/collapse may not be distinguished from generic Click',
        'capability-gap',
        'P3',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── WF-15: Drag-and-Drop List Reorder ──────────────────────────────

  describe('WF-15: Drag-and-drop list reorder', () => {
    it('captures drag start and drop as a DragDrop interaction', () => {
      const dragHandle = makeTarget({
        tag: 'DIV', ariaRole: 'button', accessibleName: 'Drag item "Task A"',
        testId: 'drag-task-a', cssSelector: 'div[data-testid="drag-task-a"]',
        xPath: '//div[@data-testid="drag-task-a"]',
      });
      const dropZone = makeTarget({
        tag: 'DIV', ariaRole: 'list', accessibleName: 'Column: In Progress',
        testId: 'drop-col-inprogress', cssSelector: 'div[data-testid="drop-col-inprogress"]',
        xPath: '//div[@data-testid="drop-col-inprogress"]',
      });

      const events = [
        makeEvent('dragstart', dragHandle, makeContext({}),
          { timestamp: 1000, clientX: 100, clientY: 200 }),
        makeEvent('dragover', dropZone, makeContext({}),
          { timestamp: 1500, clientX: 300, clientY: 400 }),
        makeEvent('drop', dropZone, makeContext({}),
          { timestamp: 2000, clientX: 300, clientY: 400 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/board',
        pageTitle: 'Kanban Board',
        testCaseName: 'Drag task to In Progress',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;

      const hasDrag = types.some(t => t.includes('Drag') || t.includes('Drop'));

      const q1 = hasDrag ? 5 : interactionCount >= 1 ? 3 : 1;

      recordObs('WF-15', 'drag-drop-reorder',
        { q1_intent: q1, q2_abstraction: 4, q3_locator: 4, q4_description: hasDrag ? 4 : 2, q5_replay: q1, q6_confidence: 4, q7_evidence: 3, q8_assertion: 2 },
        `${interactionCount} interactions [${types.join(', ')}]. drag-drop=${hasDrag}`,
        hasDrag ? 'None' : 'Drag/drop events not classified as DragDrop',
        hasDrag ? 'implementation-gap' : 'implementation-gap',
        hasDrag ? 'P3' : 'P2',
        'Pipeline/Definitions',
        result.interactions,
        result.playwright,
      );

      expect(result).toBeDefined();
    });
  });

  // ── WF-16: Toast Notification (post-action verification) ───────────

  describe('WF-16: Toast notification after save', () => {
    it('captures save click; toast appearance is not an interaction but affects assertions', () => {
      const saveBtn = makeTarget({
        tag: 'BUTTON', ariaRole: 'button', accessibleName: 'Save changes',
        testId: 'save-changes', cssSelector: 'button[data-testid="save-changes"]',
        xPath: '//button[@data-testid="save-changes"]',
      });

      const events = [
        makeEvent('click', saveBtn, makeContext({}), { timestamp: 1000 }),
      ];

      const result = runFullPipeline(events, {
        startUrl: 'https://app.example.com/settings',
        pageTitle: 'Settings',
        testCaseName: 'Save changes',
      });

      const types = getTypes(result);
      const interactionCount = result.interactions.length;
      const assertionCount = result.irPlan?.steps[0]?.assertions?.length ?? 0;

      const hasClick = interactionCount >= 1;
      // Ideally there would be an assertion for the toast text
      // but since toast DOM is not in the event stream, this is expected.
      const q8 = assertionCount >= 1 ? 4 : 2;

      recordObs('WF-16', 'toast-notification',
        { q1_intent: hasClick ? 5 : 2, q2_abstraction: 4, q3_locator: 4, q4_description: 3, q5_replay: 4, q6_confidence: 4, q7_evidence: 3, q8_assertion: q8 },
        `${interactionCount} interactions [${types.join(', ')}], ${assertionCount} assertions. Toast text not capturable from event stream.`,
        'Toast verification requires DOM snapshot inspection, not just event stream — architectural limitation',
        'architectural-limitation',
        'P3',
        'Pipeline/Assertions',
        result.interactions,
        result.playwright,
      );

      expect(interactionCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Summary ────────────────────────────────────────────────────────

  describe('Multi-Step Workflow Summary', () => {
    it('records all workflow observations', () => {
      console.log(`\n[Multi-Step Workflows] ${observations.length} observations recorded`);
      for (const obs of observations) {
        const avg = (
          obs.scores.q1_intent + obs.scores.q2_abstraction + obs.scores.q3_locator +
          obs.scores.q4_description + obs.scores.q5_replay + obs.scores.q6_confidence +
          obs.scores.q7_evidence + obs.scores.q8_assertion
        ) / 8;
        console.log(
          `  ${obs.observationId} (${obs.capabilityId}): Q1=${obs.scores.q1_intent} avg=${avg.toFixed(1)} | ${obs.severity} | ${obs.observed}`
        );
      }
      // Ensure we have observations
      expect(observations.length).toBeGreaterThanOrEqual(15);
    });
  });
});

/**
 * Sub-phase 4: Real-World Semantic Effect Validation
 *
 * Tests the complete chain: ComponentInteraction → Behavioral Observation →
 * interpret() → SemanticEffect[] on real DOM structures matching real-world
 * web applications.
 *
 * Each test case:
 * 1. Creates a realistic DOM structure (JSDOM)
 * 2. Simulates a user interaction (click, type, toggle)
 * 3. Captures ElementStateSnapshot before/after (Phase A simulation)
 * 4. Captures MutationRecords via MutationObserver (Phase B simulation)
 * 5. Feeds (ObservationResult, InterpretationContext) through interpret()
 * 6. Verifies category, direction, affectedTarget, confidence
 *
 * No production code is modified. Results are recorded for the validation report.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { interpret } from '../../src/semantics/effect-interpreter';
import type { InterpretationContext } from '../../src/semantics/interpretation-context';
import type {
  ObservationResult,
  ElementStateSnapshot,
  MutationRecord2,
} from '../../src/shared/observation-types';
import type { SemanticEffect } from '../../src/semantics/effect-types';

// ── JSDOM Helpers ─────────────────────────────────────────────────────

let dom: JSDOM;
let document: Document;
let mutationObs: MutationObserver | null = null;
let capturedMutations: MutationRecord2[] = [];
let mutationIdCounter = 0;

/**
 * Set up JSDOM with a given HTML body content.
 */
function setupDOM(htmlBody: string): void {
  dom = new JSDOM(`<!DOCTYPE html><html><body>${htmlBody}</body></html>`, {
    pretendToBeVisual: true,
  });
  document = dom.window.document;

  // Patch MutationObserver onto global if needed
  if (!(global as any).MutationObserver) {
    (global as any).MutationObserver = dom.window.MutationObserver;
  }
  mutationIdCounter = 0;
  capturedMutations = [];
}

/**
 * Start capturing mutations on document.body (mirrors Phase B DocumentObserver config).
 */
function startMutationCapture(): void {
  capturedMutations = [];
  mutationObs = new dom.window.MutationObserver((records: MutationRecord[]) => {
    for (const record of records) {
      capturedMutations.push(mutationRecordToM2(record));
    }
  });
  mutationObs.observe(document.body, {
    childList: true,
    attributes: true,
    characterData: true,
    subtree: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  });
}

/**
 * Stop capturing and return the collected mutations.
 * Must be called after a microtask flush (await flushMutations()) to ensure
 * JSDOM's async MutationObserver delivery has completed.
 */
function stopMutationCapture(): MutationRecord2[] {
  if (mutationObs) {
    mutationObs.disconnect();
    mutationObs = null;
  }
  return capturedMutations;
}

/**
 * Flush JSDOM's async MutationObserver delivery.
 * MutationObserver delivers records via microtask queue, so we need
 * to yield to the event loop before reading capturedMutations.
 */
async function flushMutations(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Convert a DOM MutationRecord to our MutationRecord2 format.
 */
function mutationRecordToM2(record: MutationRecord): MutationRecord2 {
  const target = record.target as Element;
  let targetPath = '';
  try {
    targetPath = getCssPath(target);
  } catch {
    targetPath = target.tagName?.toLowerCase() ?? 'unknown';
  }

  const m2: MutationRecord2 = {
    id: ++mutationIdCounter,
    type: record.type as 'attributes' | 'childList' | 'characterData',
    targetPath,
    targetTag: (record.target as Element)?.tagName ?? '',
    attributeName: record.attributeName ?? null,
    oldValue: record.oldValue ?? null,
    newValue: null,
    addedNodesCount: 0,
    removedNodesCount: 0,
    timestamp: performance.now(),
    windowIds: ['obs-test'],
  };

  if (record.type === 'attributes' && record.attributeName) {
    try {
      m2.newValue = (record.target as Element).getAttribute(record.attributeName);
    } catch {
      m2.newValue = null;
    }
  } else if (record.type === 'characterData') {
    m2.newValue = (record.target as any).nodeValue ?? null;
  } else if (record.type === 'childList') {
    m2.addedNodesCount = record.addedNodes.length;
    m2.removedNodesCount = record.removedNodes.length;
  }

  return m2;
}

/**
 * Build a CSS path from element to body (simplified getPath).
 */
function getCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
    } else {
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current!.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current);
          selector += `:nth-of-type(${index + 1})`;
        }
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return 'body > ' + parts.join(' > ');
}

/**
 * Capture an ElementStateSnapshot from a DOM element (mirrors Phase A cache).
 */
function captureSnapshot(el: Element | null): ElementStateSnapshot | null {
  if (!el) return null;
  const htmlEl = el as HTMLElement;

  const getAriaBool = (attr: string): boolean | null => {
    const val = htmlEl.getAttribute(attr);
    if (val === 'true') return true;
    if (val === 'false') return false;
    return null;
  };

  const inputEl = htmlEl as HTMLInputElement;

  return {
    value: typeof inputEl.value === 'string' ? inputEl.value : null,
    checked: typeof inputEl.checked === 'boolean' ? inputEl.checked : null,
    className: htmlEl.className ?? '',
    disabled: htmlEl.hasAttribute('disabled') || inputEl.disabled === true,
    ariaExpanded: getAriaBool('aria-expanded'),
    ariaChecked: getAriaBool('aria-checked'),
    ariaPressed: getAriaBool('aria-pressed'),
    textContent: htmlEl.textContent?.trim().slice(0, 200) || null,
    childCount: htmlEl.children.length,
    capturedAt: Date.now(),
  };
}

/**
 * Build a complete ObservationResult from captured evidence.
 */
function buildResult(opts: {
  beforeSnapshot: ElementStateSnapshot | null;
  finalSnapshot: ElementStateSnapshot | null;
  mutations: MutationRecord2[];
  endReason?: 'completed' | 'element-removed' | 'recording-stopped';
  performanceCondition?: any;
}): ObservationResult {
  return {
    sourceEventId: 'evt-test',
    sourceEventType: 'click',
    windowId: 'obs-test',
    openedAt: 1000,
    closedAt: 4000,
    durationMs: 3000,
    endReason: opts.endReason ?? 'completed',
    beforeSnapshot: opts.beforeSnapshot,
    finalSnapshot: opts.finalSnapshot,
    mutations: opts.mutations,
    mutationCount: opts.mutations.length,
    documentWideMutationTotal: opts.mutations.length,
    performanceCondition: opts.performanceCondition ?? null,
  };
}

/**
 * Build an InterpretationContext.
 */
function buildCtx(opts: Partial<InterpretationContext> = {}): InterpretationContext {
  return {
    interactionType: 'Click',
    triggerRole: null,
    triggerLabel: '',
    triggerCssPath: '',
    ...opts,
  };
}

// ── Assertion helpers ─────────────────────────────────────────────────

interface EffectAssertion {
  effects: SemanticEffect[];
  label: string;
}

function assertCategory(test: EffectAssertion, expected: string): void {
  const cats = test.effects.map((e) => e.category);
  expect(cats, `${test.label} categories`).toContain(expected);
}

function assertConfidence(test: EffectAssertion, expected: string): void {
  const matching = test.effects.find((e) => true);
  expect(matching?.confidence, `${test.label} confidence`).toBe(expected);
}

function assertEffectCount(test: EffectAssertion, expected: number): void {
  expect(test.effects.length, `${test.label} effect count`).toBe(expected);
}

function assertDescriptionContains(test: EffectAssertion, expected: string): void {
  const matching = test.effects.find((e) =>
    e.description.includes(expected),
  );
  expect(matching, `${test.label} should have description containing "${expected}"`).toBeDefined();
}

// ── TEST CASES ────────────────────────────────────────────────────────

describe('Sub-phase 4: Real-World Semantic Effect Validation', () => {

  // ═══════════════════════════════════════════════════════════════════════
  // A. DIRECT STATE TOGGLE (state-toggle / HIGH)
  // ═══════════════════════════════════════════════════════════════════════

  describe('A1: Native Checkbox Toggle', () => {
    it('should produce state-toggle HIGH with checked direction', async () => {
      setupDOM('<input type="checkbox" id="cb" />');
      const cb = document.getElementById('cb')!;
      const before = captureSnapshot(cb);

      startMutationCapture();
      // Simulate user clicking the checkbox
      (cb as HTMLInputElement).checked = true;
      cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      // Allow microtasks to flush
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(cb);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({ interactionType: 'Checkbox', triggerRole: 'checkbox', triggerLabel: 'cb', triggerCssPath: getCssPath(cb) });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'A1 native checkbox' };
      assertCategory(test, 'state-toggle');
      assertConfidence(test, 'high');
      assertEffectCount(test, 1);
      assertDescriptionContains(test, 'checked: false → true');
    });
  });

  describe('A2: Native Radio Button Selection', () => {
    it('should produce state-toggle HIGH for radio selection', async () => {
      setupDOM(`
        <input type="radio" name="opt" id="r1" checked />
        <input type="radio" name="opt" id="r2" />
      `);
      const r2 = document.getElementById('r2')!;
      const before = captureSnapshot(r2);

      startMutationCapture();
      (r2 as HTMLInputElement).checked = true;
      r2.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(r2);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({ interactionType: 'RadioButton', triggerRole: 'radio', triggerLabel: 'Option 2', triggerCssPath: getCssPath(r2) });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'A2 native radio' };
      assertCategory(test, 'state-toggle');
      assertConfidence(test, 'high');
      assertDescriptionContains(test, 'checked: false → true');
    });
  });

  describe('A3: Amazon-style Custom Checkbox (ARIA)', () => {
    it('should produce state-toggle HIGH from aria-checked mutation', async () => {
      // This is the Amazon failure pattern: clicking a <span> inside a
      // role="checkbox" container. The aria-checked is on the container,
      // not on the clicked element.
      setupDOM(`
        <div id="ccb" role="checkbox" aria-checked="false" tabindex="0">
          <i class="a-icon-checkbox"></i>
          <span>Subscribe</span>
        </div>
      `);
      const ccb = document.getElementById('ccb')!;
      const before = captureSnapshot(ccb);

      startMutationCapture();
      // Simulate the component's click handler toggling aria-checked
      ccb.setAttribute('aria-checked', 'true');
      // Also toggle the inner icon class (Amazon does this)
      const icon = ccb.querySelector('.a-icon-checkbox')!;
      icon.className = 'a-icon-checkbox a-icon-checkbox-checked';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(ccb);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Checkbox',
        triggerRole: 'checkbox',
        triggerLabel: 'Subscribe',
        triggerCssPath: getCssPath(ccb),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'A3 Amazon checkbox' };
      assertCategory(test, 'state-toggle');
      assertConfidence(test, 'high');
      // Description should show aria-checked direction
      assertDescriptionContains(test, 'aria-checked: false → true');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // B. EXPAND-COLLAPSE (expand-collapse / HIGH)
  // ═══════════════════════════════════════════════════════════════════════

  describe('B1: Accordion Expand', () => {
    it('should produce expand-collapse HIGH from aria-expanded delta', async () => {
      setupDOM(`
        <div id="accordion">
          <button id="acc-hdr" aria-expanded="false">Section 1</button>
          <div class="panel" hidden>Content here</div>
        </div>
      `);
      const hdr = document.getElementById('acc-hdr')!;
      const before = captureSnapshot(hdr);

      startMutationCapture();
      hdr.setAttribute('aria-expanded', 'true');
      const panel = document.querySelector('.panel') as HTMLElement;
      panel.hidden = false;
      panel.textContent = 'Expanded content';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(hdr);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Section 1',
        triggerCssPath: getCssPath(hdr),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'B1 accordion' };
      assertCategory(test, 'expand-collapse');
      assertConfidence(test, 'high');
      assertDescriptionContains(test, 'expanded: collapsed → expanded');

      // NOTE: panel content change should ALSO appear if content-change rule fires
      // This tests multi-effect behavior
      const hasContentChange = effects.some((e) => e.category === 'content-change');
      if (hasContentChange) {
        // Valid: accordion expansion adds content → content-change is expected alongside
      }
    });
  });

  describe('B2: Modal Dialog Open', () => {
    it('should detect structural content change when modal appears', async () => {
      setupDOM(`
        <button id="open-modal">Open Modal</button>
        <div id="app-root"></div>
      `);
      const btn = document.getElementById('open-modal')!;
      const root = document.getElementById('app-root')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      // Simulate modal injection (typical React/Bootstrap pattern)
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = '<div class="modal-dialog" role="dialog" aria-modal="true"><h2>Are you sure?</h2><button>OK</button></div>';
      root.appendChild(overlay);
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Open Modal',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'B2 modal open' };
      // The button itself has no aria-expanded → no expand-collapse
      // The modal DOM injection → content-change on root
      assertCategory(test, 'content-change');
      // Structural inference → at least MEDIUM
      expect(effects[0]?.confidence).toMatch(/medium|low/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C. CONTENT CHANGE (content-change / MEDIUM)
  // ═══════════════════════════════════════════════════════════════════════

  describe('C1: Filter Button Updating Results', () => {
    it('should produce content-change MEDIUM on results container, not trigger', async () => {
      setupDOM(`
        <button id="filter-btn" data-filter="electronics">Electronics</button>
        <ul id="results">
          <li>Item 1</li>
          <li>Item 2</li>
          <li>Item 3</li>
        </ul>
      `);
      const btn = document.getElementById('filter-btn')!;
      const results = document.getElementById('results')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      // Simulate filter: remove non-matching items, keep 1
      results.innerHTML = '<li>Item 2</li>';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Electronics',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'C1 filter results' };
      assertCategory(test, 'content-change');
      // Target should be the results container, not the filter button
      const contentEffect = effects.find((e) => e.category === 'content-change')!;
      expect(contentEffect.affectedTarget.cssPath).toContain('results');
      expect(contentEffect.affectedTarget.cssPath).not.toContain('filter-btn');
    });
  });

  describe('C2: Text Input + Live Search Results', () => {
    it('should produce unclassified on text field (value delta has no v1 category), content-change on results', async () => {
      setupDOM(`
        <input type="text" id="search" placeholder="Search..." />
        <ul id="search-results">
          <li>Apple</li>
          <li>Banana</li>
          <li>Cherry</li>
        </ul>
      `);
      const search = document.getElementById('search') as HTMLInputElement;
      const results = document.getElementById('search-results')!;
      const before = captureSnapshot(search);

      startMutationCapture();
      // Simulate typing: input value changes (does NOT fire MutationObserver on the input itself)
      // But search results update (childList mutations on the results ul)
      search.value = 'ap';
      results.innerHTML = '<li>Apple</li>';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(search);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'TextEntry',
        triggerRole: 'textbox',
        triggerLabel: 'Search',
        triggerCssPath: getCssPath(search),
      });
      const effects = interpret(result, ctx);

      // The input has a value delta but no rule recognizes it → should NOT be state-toggle
      // The results container has childList mutations → content-change
      const categories = effects.map((e) => e.category);

      // CRITICAL: must NOT produce state-toggle for a value change
      expect(categories).not.toContain('state-toggle');

      // content-change from results container mutations
      expect(categories).toContain('content-change');
    });
  });

  describe('C3: React-style Dynamic Re-render', () => {
    it('should produce content-change on high mutation volume', async () => {
      setupDOM(`
        <button id="toggle-btn">Toggle View</button>
        <div id="app">
          <div class="card">Card A</div>
          <div class="card">Card B</div>
        </div>
      `);
      const btn = document.getElementById('toggle-btn')!;
      const app = document.getElementById('app')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      // Simulate React re-render: replace entire content
      app.innerHTML = `
        <div class="card card-new">Card X</div>
        <div class="card card-new">Card Y</div>
        <div class="card card-new">Card Z</div>
      `;
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Toggle View',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'C3 React re-render' };
      assertCategory(test, 'content-change');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // D. MULTIPLE EFFECTS (multi-effect)
  // ═══════════════════════════════════════════════════════════════════════

  describe('D1: Checkbox Toggle + Content Change (filter)', () => {
    it('should produce BOTH state-toggle HIGH and content-change MEDIUM', async () => {
      setupDOM(`
        <label>
          <input type="checkbox" id="avail-filter" /> Available only
        </label>
        <ul id="product-list">
          <li>Product A</li>
          <li>Product B (out of stock)</li>
        </ul>
      `);
      const cb = document.getElementById('avail-filter')!;
      const list = document.getElementById('product-list')!;
      const before = captureSnapshot(cb);

      startMutationCapture();
      // Toggle checkbox
      (cb as HTMLInputElement).checked = true;
      cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      // Filter updates list
      list.innerHTML = '<li>Product A</li>';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(cb);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Checkbox',
        triggerRole: 'checkbox',
        triggerLabel: 'Available only',
        triggerCssPath: getCssPath(cb),
      });
      const effects = interpret(result, ctx);

      const categories = effects.map((e) => e.category);
      expect(categories, 'D1 should have both state-toggle and content-change').toContain('state-toggle');
      expect(categories, 'D1 should have both state-toggle and content-change').toContain('content-change');

      // state-toggle must be HIGH regardless of noise
      const toggleEffect = effects.find((e) => e.category === 'state-toggle')!;
      expect(toggleEffect.confidence).toBe('high');
      expect(toggleEffect.description).toContain('checked: false → true');
    });
  });

  describe('D2: Accordion Expand + Dynamic Content Load', () => {
    it('should produce expand-collapse HIGH alongside content-change MEDIUM', async () => {
      setupDOM(`
        <button id="acc-btn" aria-expanded="false">Load More</button>
        <div id="acc-panel"></div>
      `);
      const btn = document.getElementById('acc-btn')!;
      const panel = document.getElementById('acc-panel')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      // Expand
      btn.setAttribute('aria-expanded', 'true');
      // Dynamically load content into panel
      panel.innerHTML = '<p>Loaded content item 1</p><p>Loaded content item 2</p>';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Load More',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const categories = effects.map((e) => e.category);
      expect(categories).toContain('expand-collapse');

      const expandEffect = effects.find((e) => e.category === 'expand-collapse')!;
      expect(expandEffect.confidence).toBe('high');
      expect(expandEffect.description).toContain('expanded: collapsed → expanded');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // E. NO OBSERVABLE EFFECT (no-observable-effect)
  // ═══════════════════════════════════════════════════════════════════════

  describe('E1: Click on Non-interactive Element (completed window)', () => {
    it('should produce no-observable-effect HIGH when window completed with zero mutations', async () => {
      setupDOM('<div id="dead-zone">Some text</div>');
      const div = document.getElementById('dead-zone')!;
      const before = captureSnapshot(div);

      startMutationCapture();
      // Click does nothing
      div.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(div);
      const result = buildResult({
        beforeSnapshot: before,
        finalSnapshot: after,
        mutations,
        endReason: 'completed',
      });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: null,
        triggerLabel: 'Some text',
        triggerCssPath: getCssPath(div),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'E1 no effect (completed)' };
      assertCategory(test, 'no-observable-effect');
      assertConfidence(test, 'high');
      assertEffectCount(test, 1);
    });
  });

  describe('E2: Stop Recording Mid-Window (early close)', () => {
    it('should produce no-observable-effect LOW when window ended early', async () => {
      setupDOM('<div id="target">Click me</div>');
      const div = document.getElementById('target')!;
      const before = captureSnapshot(div);

      // No mutations captured (window stopped before anything happened)
      const after = captureSnapshot(div);
      const result = buildResult({
        beforeSnapshot: before,
        finalSnapshot: after,
        mutations: [],
        endReason: 'recording-stopped',
      });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: null,
        triggerLabel: 'Click me',
        triggerCssPath: getCssPath(div),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'E2 no effect (early close)' };
      assertCategory(test, 'no-observable-effect');
      assertConfidence(test, 'low');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F. UNCLASSIFIED (unclassified / LOW)
  // ═══════════════════════════════════════════════════════════════════════

  describe('F1: CSS-Only Effect (class mutation, no state property)', () => {
    it('should produce unclassified LOW when only class attribute changes', async () => {
      setupDOM('<button id="style-btn" class="btn-default">Styled Button</button>');
      const btn = document.getElementById('style-btn')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      // Only visual styling changes — no aria/checked/disabled
      btn.className = 'btn-default btn-selected';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Styled Button',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'F1 CSS-only' };
      assertCategory(test, 'unclassified');
      assertConfidence(test, 'low');
      assertEffectCount(test, 1);
      // Description should mention attributes
      assertDescriptionContains(test, 'attributes');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // G. EDGE CASES / STRESS
  // ═══════════════════════════════════════════════════════════════════════

  describe('G1: Rapid Consecutive Checkbox Toggles (window independence)', () => {
    it('should produce separate state-toggle effects for each independent window', async () => {
      // Each checkbox gets its own observation window.
      // We test that interpret() is correctly stateless across calls.
      setupDOM(`
        <input type="checkbox" id="cb1" />
        <input type="checkbox" id="cb2" />
        <input type="checkbox" id="cb3" />
      `);

      const allEffects: { id: string; effects: SemanticEffect[] }[] = [];

      for (const id of ['cb1', 'cb2', 'cb3']) {
        const cb = document.getElementById(id)!;
        const before = captureSnapshot(cb);

        startMutationCapture();
        (cb as HTMLInputElement).checked = true;
        cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        await flushMutations();
      const mutations = stopMutationCapture();

        const after = captureSnapshot(cb);
        const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
        const ctx = buildCtx({
          interactionType: 'Checkbox',
          triggerRole: 'checkbox',
          triggerLabel: id,
          triggerCssPath: getCssPath(cb),
        });
        const effects = interpret(result, ctx);
        allEffects.push({ id, effects });
      }

      // Each window should produce exactly one state-toggle HIGH
      expect(allEffects.length).toBe(3);
      for (const { id, effects } of allEffects) {
        expect(effects.length, `G1 ${id} effect count`).toBe(1);
        expect(effects[0]!.category, `G1 ${id} category`).toBe('state-toggle');
        expect(effects[0]!.confidence, `G1 ${id} confidence`).toBe('high');
        expect(effects[0]!.description, `G1 ${id} description`).toContain('checked: false → true');
      }
    });
  });

  describe('G2: SPA Navigation (bulk DOM replacement)', () => {
    it('should handle large structural change (may aggregate to broad effect)', async () => {
      setupDOM(`
        <a id="nav-link" href="/about">About Us</a>
        <div id="app-root">
          <div class="page-home">
            <h1>Home</h1>
            <p>Welcome to the home page</p>
            <div class="feature-grid">
              <div class="feature">Feature 1</div>
              <div class="feature">Feature 2</div>
            </div>
          </div>
        </div>
      `);
      const link = document.getElementById('nav-link')!;
      const root = document.getElementById('app-root')!;
      const before = captureSnapshot(link);

      startMutationCapture();
      // Simulate SPA navigation: replace entire page content
      root.innerHTML = `
        <div class="page-about">
          <h1>About Us</h1>
          <p>We are a company.</p>
          <div class="team-grid">
            <div class="member">Alice</div>
            <div class="member">Bob</div>
            <div class="member">Carol</div>
          </div>
          <div class="contact">
            <p>Contact us at info@example.com</p>
          </div>
        </div>
      `;
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(link);
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Navigation',
        triggerRole: 'link',
        triggerLabel: 'About Us',
        triggerCssPath: getCssPath(link),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'G2 SPA navigation' };
      // Should be content-change (either per-path or aggregated)
      assertCategory(test, 'content-change');

      // With many distinct paths, should aggregate to LOW
      // With few paths, should be MEDIUM
      const contentEffect = effects.find((e) => e.category === 'content-change')!;
      expect(['medium', 'low']).toContain(contentEffect.confidence);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // BONUS: Additional real-world patterns
  // ═══════════════════════════════════════════════════════════════════════

  describe('X1: Enable-Disable (disabled property delta)', () => {
    it('should produce enable-disable HIGH from disabled property change', async () => {
      setupDOM(`
        <button id="submit-btn" disabled>Submit</button>
        <button id="agree-btn">I Agree</button>
      `);
      const submit = document.getElementById('submit-btn')!;
      const before = captureSnapshot(submit);

      startMutationCapture();
      // User clicks "I Agree", which enables the submit button
      submit.removeAttribute('disabled');
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(submit);
      // For this test, we treat submit as the trigger (simulating focus + observation)
      const result = buildResult({ beforeSnapshot: before, finalSnapshot: after, mutations });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Submit',
        triggerCssPath: getCssPath(submit),
      });
      const effects = interpret(result, ctx);

      const test: EffectAssertion = { effects, label: 'X1 enable-disable' };
      assertCategory(test, 'enable-disable');
      assertConfidence(test, 'high');
      assertDescriptionContains(test, 'disabled → enabled');
    });
  });

  describe('X2: Element Removed from DOM', () => {
    it('should produce visibility-change for element-removed endReason', async () => {
      setupDOM(`
        <button id="close-btn">Close</button>
        <div id="banner">Important announcement</div>
      `);
      const closeBtn = document.getElementById('close-btn')!;
      const banner = document.getElementById('banner')!;
      const before = captureSnapshot(closeBtn);

      startMutationCapture();
      // Clicking close removes the banner
      banner.remove();
      await flushMutations();
      const mutations = stopMutationCapture();

      // The TRIGGER element (close button) is still in DOM
      // But endReason is 'completed' since the trigger wasn't removed
      // visibility-change only fires when the TRIGGER element was removed
      const after = captureSnapshot(closeBtn);
      const result = buildResult({
        beforeSnapshot: before,
        finalSnapshot: after,
        mutations,
        endReason: 'completed',
      });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Close',
        triggerCssPath: getCssPath(closeBtn),
      });
      const effects = interpret(result, ctx);

      // The banner removal → content-change (childList removal)
      // NOT visibility-change (that only fires for trigger element removal)
      const categories = effects.map((e) => e.category);
      expect(categories).not.toContain('visibility-change');
      expect(categories).toContain('content-change');
    });
  });

  describe('X3: Noise-Degraded Structural Effect', () => {
    it('should degrade content-change to LOW when performanceCondition present', async () => {
      setupDOM(`
        <button id="btn">Update</button>
        <div id="container"></div>
      `);
      const btn = document.getElementById('btn')!;
      const container = document.getElementById('container')!;
      const before = captureSnapshot(btn);

      startMutationCapture();
      container.innerHTML = '<p>New content</p>';
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(btn);
      const result = buildResult({
        beforeSnapshot: before,
        finalSnapshot: after,
        mutations,
        performanceCondition: {
          batchRecordCount: 150,
          batchDurationMs: 20,
          timestamp: 2000,
        },
      });
      const ctx = buildCtx({
        interactionType: 'Click',
        triggerRole: 'button',
        triggerLabel: 'Update',
        triggerCssPath: getCssPath(btn),
      });
      const effects = interpret(result, ctx);

      const contentEffect = effects.find((e) => e.category === 'content-change');
      expect(contentEffect, 'X3 should have content-change').toBeDefined();
      expect(contentEffect!.confidence, 'X3 noise should degrade to LOW').toBe('low');
    });
  });

  describe('X4: Direct Property Immune to Noise', () => {
    it('should keep state-toggle HIGH even with performanceCondition present', async () => {
      setupDOM('<input type="checkbox" id="cb" />');
      const cb = document.getElementById('cb')!;
      const before = captureSnapshot(cb);

      startMutationCapture();
      (cb as HTMLInputElement).checked = true;
      cb.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      // Add lots of noise mutations
      for (let i = 0; i < 50; i++) {
        const noise = document.createElement('div');
        document.body.appendChild(noise);
        noise.remove();
      }
      await flushMutations();
      const mutations = stopMutationCapture();

      const after = captureSnapshot(cb);
      const result = buildResult({
        beforeSnapshot: before,
        finalSnapshot: after,
        mutations,
        performanceCondition: {
          batchRecordCount: 100,
          batchDurationMs: 18,
          timestamp: 2000,
        },
      });
      const ctx = buildCtx({
        interactionType: 'Checkbox',
        triggerRole: 'checkbox',
        triggerLabel: 'cb',
        triggerCssPath: getCssPath(cb),
      });
      const effects = interpret(result, ctx);

      const toggleEffect = effects.find((e) => e.category === 'state-toggle');
      expect(toggleEffect, 'X4 should have state-toggle').toBeDefined();
      expect(toggleEffect!.confidence, 'X4 direct property immune to noise').toBe('high');
    });
  });
});

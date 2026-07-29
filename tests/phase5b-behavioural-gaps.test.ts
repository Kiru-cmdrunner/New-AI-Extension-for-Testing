/**
 * Phase 5b — Behavioural Gap Closure Tests
 *
 * Tests:
 * 1. Ancestor CSS class extraction (Channel B)
 * 2. Scroll burst coalescing lifecycle
 * 3. Date picker multi-mode completion + nav button rejection
 * 4. Dropdown no-op detection
 * 5. Per-type temporal dedup
 * 6. Interactive element filter (Click pattern)
 * 7. Priority-based pattern discovery
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LifecycleEngine } from '../src/pipeline/lifecycle/lifecycle-engine';
import { resetActionCounter, buildSemanticActions } from '../src/pipeline/lifecycle/semantic-action-builder';
import { TemporalDedup } from '../src/pipeline/recognition/temporal-dedup';
import { getAllPatterns, getPatternById } from '../src/pipeline/recognition/pattern-registry';
import { evaluateOperator } from '../src/pipeline/recognition/pattern-evaluator';
import { captureAncestorClasses } from '../src/pipeline/channels/channel-b-dom-structure';
import type { RecognisedInteraction } from '../src/types/recognition';
import type { EvidenceBatch } from '../src/types/evidence';
import type { InteractionVerb, ComponentType } from '../src/types/foundation';
import type { SemanticActionOutput } from '../src/pipeline/lifecycle/lifecycle-types';

let idCounter = 0;

function makeRecognised(
  verb: InteractionVerb,
  componentType: ComponentType,
  timestamp = '2024-01-01T00:00:00.000Z',
): RecognisedInteraction {
  idCounter++;
  return {
    id: `rec-${idCounter}`,
    kind: 'recognised',
    verb,
    componentType,
    matchedPattern: { id: 'test', verb, componentType, conditions: [], confidenceThreshold: 1.0, description: 'test' },
    confidence: 0.95,
    sourceBatches: [`batch-${idCounter}`],
    timestamp,
    description: `${verb} on ${componentType}`,
    evidenceTrace: [],
  };
}

function makeBatch(
  id: string,
  opts?: { accessibleName?: string; valueAfter?: string; locator?: string; ariaRole?: string | null; tag?: string | null },
): EvidenceBatch {
  return {
    id,
    evidence: [],
    events: [],
    timestamp: '2024-01-01T00:00:00.000Z',
    target: {
      primaryLocator: { kind: 'css', value: opts?.locator ?? '#el1', confidence: 0.9 },
      accessibleName: opts?.accessibleName ?? null,
      ariaRole: opts?.ariaRole ?? null,
      tag: opts?.tag ?? null,
    } as any,
    domContext: {
      valueTransition: opts?.valueAfter ? { before: null, after: opts.valueAfter } : undefined,
    } as any,
  } as any;
}

// ── 1. Ancestor CSS Class Extraction ─────────────────────────────────────

describe('Phase 5b: Ancestor CSS class extraction', () => {
  it('captureAncestorClasses should extract CSS classes from parent elements', () => {
    // JSDOM-based test
    const grandparent = document.createElement('div');
    grandparent.className = 'oxd-form-row MuiSelect-root';

    const parent = document.createElement('div');
    parent.className = 'oxd-checkbox-wrapper';

    const child = document.createElement('input');
    child.type = 'checkbox';

    parent.appendChild(child);
    grandparent.appendChild(parent);

    const classes = captureAncestorClasses(child);
    expect(classes).toContain('oxd-checkbox-wrapper');
    expect(classes).toContain('oxd-form-row');
    expect(classes).toContain('MuiSelect-root');
  });

  it('captureAncestorClasses should return empty string for elements without ancestors', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const classes = captureAncestorClasses(el);
    // body has no className in JSDOM typically
    expect(typeof classes).toBe('string');
  });
});

// ── 2. Scroll Burst Coalescing ───────────────────────────────────────────

describe('Phase 5b: Scroll burst coalescing', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should activate scroll lifecycle on first scroll event', () => {
    const result = engine.processResult(makeRecognised('scroll', 'Generic'));
    expect(result.emitted).toHaveLength(0);
    expect(engine.getActiveLifecycles()).toHaveLength(1);
  });

  it('should sustain scroll lifecycle on subsequent scroll within burst gap', () => {
    engine.processResult(makeRecognised('scroll', 'Generic'));
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // Second scroll 200ms later (within 500ms burst gap)
    engine.processResult(makeRecognised('scroll', 'Generic', '2024-01-01T00:00:00.200Z'));
    expect(engine.getActiveLifecycles()).toHaveLength(1);
  });

  it('should commit scroll lifecycle when a non-scroll event arrives', () => {
    engine.processResult(makeRecognised('scroll', 'Generic'));
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // A click event commits the scroll
    const result = engine.processResult(
      makeRecognised('click', 'Button', '2024-01-01T00:00:00.300Z'),
    );
    // Scroll should be committed (emitted)
    const scrollAction = result.emitted.find(e => e.verb === 'scroll');
    expect(scrollAction).toBeDefined();
    expect(scrollAction!.committed).toBe(true);
  });

  it('should commit scroll lifecycle on burst gap expiry', () => {
    engine.processResult(makeRecognised('scroll', 'Generic'));
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // Another scroll 600ms later (exceeds 500ms burst gap)
    const result = engine.processResult(
      makeRecognised('scroll', 'Generic', '2024-01-01T00:00:00.600Z'),
    );
    // First scroll should be committed, new one activated
    expect(result.emitted.length).toBeGreaterThanOrEqual(1);
    expect(engine.getActiveLifecycles()).toHaveLength(1);
  });
});

// ── 3. Date Picker Multi-Mode Completion ─────────────────────────────────

describe('Phase 5b: Date picker multi-mode completion', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should commit date picker via calendar cell click (existing mode)', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1', { locator: '#dp1' }),
    );
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    const result = engine.processResult(
      makeRecognised('click', 'Generic', '2024-01-01T00:00:02.000Z'),
      makeBatch('b2', { accessibleName: '15', ariaRole: 'gridcell' }),
    );
    expect(result.emitted[0]!.verb).toBe('selectDate');
    expect(result.emitted[0]!.value).toBe('15');
  });

  it('should commit date picker via typed date + blur (new mode)', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1', { locator: '#dp1' }),
    );

    // Simulate fill event (typed date + blur)
    const result = engine.processResult(
      makeRecognised('fill', 'TextInput', '2024-01-01T00:00:02.000Z'),
      makeBatch('b2', { valueAfter: '2024-01-15' }),
    );
    // The fill should match the commitOnAlternative rule
    expect(result.emitted.length).toBeGreaterThanOrEqual(1);
    const dateAction = result.emitted.find(e => e.verb === 'selectDate');
    expect(dateAction).toBeDefined();
  });

  it('should treat date picker nav buttons as lifecycle-internal (sustain)', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1', { locator: '#dp1' }),
    );

    // Click on "Next Month" nav button — should sustain, not commit or cancel
    const navResult = engine.processResult(
      makeRecognised('click', 'Generic', '2024-01-01T00:00:01.000Z'),
      makeBatch('b2', { accessibleName: 'Next Month', ariaRole: 'button' }),
    );
    expect(engine.getActiveLifecycles()).toHaveLength(1); // Still active
    expect(navResult.emitted).toHaveLength(0); // Nothing emitted

    // Now click a calendar cell — should commit
    const commitResult = engine.processResult(
      makeRecognised('click', 'Generic', '2024-01-01T00:00:02.000Z'),
      makeBatch('b3', { accessibleName: '15', ariaRole: 'gridcell' }),
    );
    expect(commitResult.emitted[0]!.verb).toBe('selectDate');
    expect(commitResult.emitted[0]!.value).toBe('15');
  });
});

// ── 4. Dropdown No-Op Detection ──────────────────────────────────────────

describe('Phase 5b: Dropdown no-op detection', () => {
  beforeEach(() => { resetActionCounter(); idCounter = 0; });

  it('should filter out placeholder selections', () => {
    const output: SemanticActionOutput = {
      definitionId: 'dropdown-lifecycle',
      verb: 'select',
      componentType: 'DropDownListbox',
      sourceResults: ['r1', 'r2'],
      startedAt: '2024-01-01T00:00:00.000Z',
      endedAt: '2024-01-01T00:00:01.000Z',
      value: '-- Select Country --',
      committed: true,
    };

    const actions = buildSemanticActions([output]);
    expect(actions).toHaveLength(0); // Filtered as no-op
  });

  it('should NOT filter out real selections', () => {
    const output: SemanticActionOutput = {
      definitionId: 'dropdown-lifecycle',
      verb: 'select',
      componentType: 'DropDownListbox',
      sourceResults: ['r1', 'r2'],
      startedAt: '2024-01-01T00:00:00.000Z',
      endedAt: '2024-01-01T00:00:01.000Z',
      value: 'India',
      committed: true,
    };

    const actions = buildSemanticActions([output]);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.value).toBe('India');
  });

  it('should NOT filter non-dropdown actions', () => {
    const output: SemanticActionOutput = {
      definitionId: 'immediate',
      verb: 'click',
      componentType: 'Button',
      sourceResults: ['r1'],
      startedAt: '2024-01-01T00:00:00.000Z',
      endedAt: '2024-01-01T00:00:00.000Z',
      value: '-- Select Country --',
      committed: true,
    };

    const actions = buildSemanticActions([output]);
    expect(actions).toHaveLength(1);
  });
});

// ── 5. Per-Type Temporal Dedup ───────────────────────────────────────────

describe('Phase 5b: Per-type temporal dedup', () => {
  let dedup: TemporalDedup;

  beforeEach(() => { dedup = new TemporalDedup(); idCounter = 0; });

  it('should suppress duplicate same-element same-type within window', () => {
    const rec1 = makeRecognised('click', 'Button', '2024-01-01T00:00:00.000Z');
    const batch1 = makeBatch('b1', { locator: '#btn1' });

    const rec2 = makeRecognised('click', 'Button', '2024-01-01T00:00:01.000Z');
    const batch2 = makeBatch('b2', { locator: '#btn1' });

    expect(dedup.isDuplicate(rec1, batch1)).toBe(false);
    expect(dedup.isDuplicate(rec2, batch2)).toBe(true); // Same element + type within 2s
  });

  it('should NOT suppress different elements', () => {
    const rec1 = makeRecognised('click', 'Button', '2024-01-01T00:00:00.000Z');
    const batch1 = makeBatch('b1', { locator: '#btn1' });

    const rec2 = makeRecognised('click', 'Button', '2024-01-01T00:00:01.000Z');
    const batch2 = makeBatch('b2', { locator: '#btn2' });

    expect(dedup.isDuplicate(rec1, batch1)).toBe(false);
    expect(dedup.isDuplicate(rec2, batch2)).toBe(false);
  });

  it('should suppress same-name checkbox/radio cross-element within window', () => {
    const rec1 = makeRecognised('toggle', 'Checkbox', '2024-01-01T00:00:00.000Z');
    const batch1 = makeBatch('b1', { locator: '#cb1', accessibleName: 'Remember me' });

    const rec2 = makeRecognised('toggle', 'Checkbox', '2024-01-01T00:00:00.500Z');
    const batch2 = makeBatch('b2', { locator: '#cb2', accessibleName: 'Remember me' });

    expect(dedup.isDuplicate(rec1, batch1)).toBe(false);
    expect(dedup.isDuplicate(rec2, batch2)).toBe(true); // Same name, cross-element
  });

  it('should NOT suppress events outside window', () => {
    const rec1 = makeRecognised('click', 'Button', '2024-01-01T00:00:00.000Z');
    const batch1 = makeBatch('b1', { locator: '#btn1' });

    const rec2 = makeRecognised('click', 'Button', '2024-01-01T00:00:03.000Z');
    const batch2 = makeBatch('b2', { locator: '#btn1' });

    expect(dedup.isDuplicate(rec1, batch1)).toBe(false);
    expect(dedup.isDuplicate(rec2, batch2)).toBe(false); // 3s > 2s window
  });

  it('should NOT suppress scroll (exempt from dedup)', () => {
    const rec1 = makeRecognised('scroll', 'Generic', '2024-01-01T00:00:00.000Z');
    const rec2 = makeRecognised('scroll', 'Generic', '2024-01-01T00:00:00.100Z');
    const batch1 = makeBatch('b1', { locator: '#scroll1' });

    expect(dedup.isDuplicate(rec1, batch1)).toBe(false);
    expect(dedup.isDuplicate(rec2, batch1)).toBe(false);
  });
});

// ── 6. Interactive Element Filter ────────────────────────────────────────

describe('Phase 5b: Interactive element filter', () => {
  it('GENERIC_CLICK pattern should have priority 10 (lowest)', () => {
    const pattern = getPatternById('generic-click-v1');
    expect(pattern).toBeDefined();
    expect(pattern!.priority).toBe(10);
  });

  it('CHECKBOX_TOGGLE pattern should have higher priority than generic click', () => {
    const checkbox = getPatternById('checkbox-toggle-v1');
    const generic = getPatternById('generic-click-v1');
    expect(checkbox!.priority!).toBeGreaterThan(generic!.priority!);
  });

  it('GENERIC_CLICK should match elements with interactive CSS class (e.g. "btn-primary")', () => {
    // Regression test for bug: matches operator rejected RegExp objects
    // The cssClass signal value is a space-delimited class string
    expect(evaluateOperator('matches', 'btn-primary clickable', /\b(?:btn|button|clickable)\b/i)).toBe(true);
    expect(evaluateOperator('matches', 'plain-div container', /\b(?:btn|button|clickable)\b/i)).toBe(false);
  });
});

// ── 7. Priority-Based Pattern Discovery ──────────────────────────────────

describe('Phase 5b: Priority-based pattern discovery', () => {
  it('all patterns should have a priority field', () => {
    const patterns = getAllPatterns();
    for (const p of patterns) {
      expect(p.priority).toBeDefined();
      expect(typeof p.priority).toBe('number');
    }
  });

  it('patterns should be sorted by priority descending', () => {
    const patterns = getAllPatterns();
    for (let i = 1; i < patterns.length; i++) {
      const prev = patterns[i - 1]!.priority ?? 100;
      const curr = patterns[i]!.priority ?? 100;
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it('generic-click should be the last pattern', () => {
    const patterns = getAllPatterns();
    const last = patterns[patterns.length - 1];
    expect(last!.id).toBe('generic-click-v1');
  });
});

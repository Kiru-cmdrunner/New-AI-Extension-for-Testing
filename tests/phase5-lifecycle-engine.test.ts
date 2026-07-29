/**
 * Phase 5 — Lifecycle Engine Tests
 *
 * Tests the generic state machine interpreter for:
 * - Immediate action pass-through (click, toggle, navigate, scroll)
 * - Text entry lifecycle (self-commit, no-op rejection)
 * - Dropdown lifecycle (activate → option commit, outside-click cancel)
 * - Date picker lifecycle (activate → date commit, outside-click cancel)
 * - Slider lifecycle (self-commit)
 * - Stale timeout cancellation
 * - Navigation flush
 * - Flush on recording stop
 * - Multi-lifecycle coexistence
 * - SemanticActionBuilder plain English descriptions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LifecycleEngine } from '../src/pipeline/lifecycle/lifecycle-engine';
import { buildSemanticActions, processToSemanticActions, resetActionCounter } from '../src/pipeline/lifecycle/semantic-action-builder';
import {
  LIFECYCLE_DEFINITIONS,
  findActivatingDefinition,
  DROPDOWN_LIFECYCLE,
  TEXT_ENTRY_LIFECYCLE,
} from '../src/pipeline/lifecycle/lifecycle-definitions';
import type { RecognisedInteraction, UnrecognisedInteraction } from '../src/types/recognition';
import type { EvidenceBatch } from '../src/types/evidence';
import type { InteractionVerb, ComponentType } from '../src/types/foundation';
import type { SemanticActionOutput } from '../src/pipeline/lifecycle/lifecycle-types';

// ── Test Helpers ─────────────────────────────────────────────────────────

let idCounter = 0;

function makeRecognised(
  verb: InteractionVerb,
  componentType: ComponentType,
  timestamp = '2024-01-01T00:00:00.000Z',
  extra?: Partial<RecognisedInteraction>,
): RecognisedInteraction {
  idCounter++;
  return {
    id: `rec-${idCounter}`,
    kind: 'recognised',
    verb,
    componentType,
    matchedPattern: {
      id: 'test-pattern',
      componentType,
      verb: verb,
      conditions: [], confidenceThreshold: 1.0, description: "test",
    },
    confidence: 0.95,
    sourceBatches: [`batch-${idCounter}`],
    timestamp,
    description: `${verb} on ${componentType}`,
    evidenceTrace: [],
    ...extra,
  };
}

function makeUnrecognised(
  timestamp = '2024-01-01T00:00:00.000Z',
): UnrecognisedInteraction {
  idCounter++;
  return {
    id: `unrec-${idCounter}`,
    kind: 'unrecognised',
    reason: 'no_pattern_matched',
    sourceBatches: [`batch-${idCounter}`],
    timestamp,
    attemptedVerb: null,
    closestMatch: null,
    evidence: [],
  };
}

function makeBatch(
  id: string,
  opts?: {
    accessibleName?: string;
    valueAfter?: string;
    locator?: string;
    ariaRole?: string | null;
    tag?: string | null;
  },
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

function makeOutput(overrides: Partial<SemanticActionOutput>): SemanticActionOutput {
  return {
    definitionId: 'immediate',
    verb: 'click',
    componentType: 'Button',
    sourceResults: ['r1'],
    startedAt: '2024-01-01T00:00:00.000Z',
    endedAt: '2024-01-01T00:00:00.000Z',
    value: null,
    committed: true,
    ...overrides,
  };
}

// ── Immediate Actions ────────────────────────────────────────────────────

describe('LifecycleEngine — Immediate Actions', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should pass through click as immediate action', () => {
    const result = engine.processResult(makeRecognised('click', 'Button'));
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('click');
    expect(result.emitted[0]!.committed).toBe(true);
  });

  it('should pass through toggle as immediate action', () => {
    const result = engine.processResult(makeRecognised('toggle', 'Checkbox'));
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('toggle');
  });

  it('should flush active lifecycles on navigate (not emit navigate itself)', () => {
    const result = engine.processResult(makeRecognised('navigate', 'Link'));
    expect(result.emitted).toHaveLength(0);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });

  it('should activate scroll lifecycle (burst coalescing — Phase 5b)', () => {
    const result = engine.processResult(makeRecognised('scroll', 'Generic'));
    // Scroll is now lifecycle-managed, not immediate. First scroll activates.
    expect(result.emitted).toHaveLength(0);
    expect(engine.getActiveLifecycles()).toHaveLength(1);
  });

  it('should pass through unrecognised interactions', () => {
    const result = engine.processResult(makeUnrecognised());
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('unknown');
  });
});

// ── Text Entry Lifecycle ─────────────────────────────────────────────────

describe('LifecycleEngine — Text Entry Lifecycle', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should self-commit text entry when value is captured', () => {
    const result = engine.processResult(
      makeRecognised('fill', 'TextInput'),
      makeBatch('b1', { valueAfter: 'hello world' }),
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('fill');
    expect(result.emitted[0]!.value).toBe('hello world');
    expect(result.emitted[0]!.committed).toBe(true);
  });

  it('should reject text entry with no value (no-op)', () => {
    const result = engine.processResult(
      makeRecognised('fill', 'TextInput'),
      makeBatch('b1', { valueAfter: undefined }),
    );
    expect(result.emitted).toHaveLength(0);
  });

  it('should reject text entry with no batch', () => {
    const result = engine.processResult(makeRecognised('fill', 'TextInput'));
    expect(result.emitted).toHaveLength(0);
  });
});

// ── Dropdown Lifecycle ───────────────────────────────────────────────────

describe('LifecycleEngine — Dropdown Lifecycle', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should activate on trigger and commit on option click', () => {
    const trigger = makeRecognised('select', 'DropDownListbox');
    let result = engine.processResult(trigger, makeBatch('b1', { locator: '#dd1' }));
    expect(result.emitted).toHaveLength(0);
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // Click on a dropdown option — has ariaRole=option
    const option = makeRecognised('click', 'Generic', '2024-01-01T00:00:01.000Z');
    const optionBatch = makeBatch('b2', { accessibleName: 'India', ariaRole: 'option' });
    result = engine.processResult(option, optionBatch);
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('select');
    expect(result.emitted[0]!.value).toBe('India');
    expect(result.emitted[0]!.committed).toBe(true);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });

  it('should cancel dropdown on outside click (no option role)', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { locator: '#dd1' }),
    );

    // Click on a button outside the dropdown — ariaRole=button (not option)
    const outsideClick = makeRecognised('click', 'Button', '2024-01-01T00:00:01.000Z');
    const result = engine.processResult(outsideClick, makeBatch('b2', { ariaRole: 'button' }));

    expect(result.cancelled).toHaveLength(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('click');
  });

  it('should cancel stale dropdown after maxDurationMs', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { locator: '#dd1' }),
    );

    const result = engine.processResult(
      makeRecognised('click', 'Button', '2024-01-01T00:00:15.000Z'),
      makeBatch('b2', { ariaRole: 'button' }),
    );
    expect(result.cancelled).toHaveLength(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });

  it('should cancel dropdown on Escape key (cancelOnEscape=true)', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { locator: '#dd1' }),
    );
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // Press Escape
    const escape = makeRecognised('pressKey', 'Generic', '2024-01-01T00:00:01.000Z');
    const result = engine.processResult(escape);

    // Dropdown cancelled (no sustainedBy + rejectIfNoProgress=true → no emit)
    expect(result.cancelled).toHaveLength(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
    // Escape is swallowed — no SemanticAction for the Escape itself
    expect(result.emitted).toHaveLength(0);
  });
});

describe('LifecycleEngine — Date Picker Lifecycle', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should activate on trigger and commit on date click', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1', { locator: '#dp1' }),
    );
    expect(engine.getActiveLifecycles()).toHaveLength(1);

    // Click on a date cell — has role=gridcell
    const dateClick = makeRecognised('click', 'Generic', '2024-01-01T00:00:02.000Z');
    const result = engine.processResult(dateClick, makeBatch('b2', { accessibleName: '15', ariaRole: 'gridcell' }));
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('selectDate');
    expect(result.emitted[0]!.value).toBe('15');
    expect(result.emitted[0]!.committed).toBe(true);
  });

  it('should cancel date picker on outside click', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1'),
    );

    const outside = makeRecognised('click', 'Button', '2024-01-01T00:00:01.000Z');
    const result = engine.processResult(outside, makeBatch('b2', { ariaRole: 'button' }));
    expect(result.cancelled).toHaveLength(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });

  it('should cancel date picker on Escape key', () => {
    engine.processResult(
      makeRecognised('selectDate', 'DatePicker'),
      makeBatch('b1'),
    );

    const escape = makeRecognised('pressKey', 'Generic', '2024-01-01T00:00:01.000Z');
    const result = engine.processResult(escape);
    expect(result.cancelled).toHaveLength(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
    expect(result.emitted).toHaveLength(0);
  });
});

// ── Slider Lifecycle ─────────────────────────────────────────────────────

describe('LifecycleEngine — Slider Lifecycle', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should self-commit slider value change', () => {
    const result = engine.processResult(
      makeRecognised('selectOption', 'Slider'),
      makeBatch('b1', { valueAfter: '50' }),
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('selectOption');
    expect(result.emitted[0]!.value).toBe('50');
  });

  it('should still emit slider even without value (rejectIfNoProgress=false)', () => {
    const result = engine.processResult(
      makeRecognised('selectOption', 'Slider'),
      makeBatch('b1'),
    );
    expect(result.emitted).toHaveLength(1);
  });
});

// ── Navigation Flush ─────────────────────────────────────────────────────

describe('LifecycleEngine — Navigation Flush', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should flush active lifecycles when navigation occurs', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { locator: '#dd1' }),
    );

    engine.processResult(makeRecognised('navigate', 'Link', '2024-01-01T00:00:05.000Z'));
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });
});

// ── Flush (Recording Stop) ───────────────────────────────────────────────

describe('LifecycleEngine — Flush on Recording Stop', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should emit committed value on flush if lifecycle has value', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { accessibleName: 'Country', locator: '#dd1' }),
    );

    const result = engine.flush(Date.now());
    expect(result.emitted.length).toBeGreaterThanOrEqual(1);
    expect(engine.getActiveLifecycles()).toHaveLength(0);
  });

  it('should discard no-progress lifecycles on flush', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { accessibleName: undefined, valueAfter: undefined, locator: '#dd1' }),
    );

    const result = engine.flush(Date.now());
    expect(result.emitted).toHaveLength(0);
    expect(result.cancelled.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Multi-Lifecycle Coexistence ──────────────────────────────────────────

describe('LifecycleEngine — Multi-Lifecycle Coexistence', () => {
  let engine: LifecycleEngine;

  beforeEach(() => { engine = new LifecycleEngine(); resetActionCounter(); idCounter = 0; });

  it('should handle text entry then dropdown sequentially', () => {
    let result = engine.processResult(
      makeRecognised('fill', 'TextInput'),
      makeBatch('b1', { valueAfter: 'test@example.com' }),
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('fill');

    engine.processResult(
      makeRecognised('select', 'DropDownListbox', '2024-01-01T00:00:02.000Z'),
      makeBatch('b2', { locator: '#dd1' }),
    );

    result = engine.processResult(
      makeRecognised('click', 'Generic', '2024-01-01T00:00:03.000Z'),
      makeBatch('b3', { accessibleName: 'Admin', ariaRole: 'option' }),
    );
    expect(result.emitted).toHaveLength(1);
    expect(result.emitted[0]!.verb).toBe('select');
    expect(result.emitted[0]!.value).toBe('Admin');
  });

  it('should handle scroll between lifecycle events (Phase 5b)', () => {
    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1', { locator: '#dk1' }),
    );

    // Scroll activates a scroll lifecycle (burst coalescing)
    let result = engine.processResult(
      makeRecognised('scroll', 'Generic', '2024-01-01T00:00:01.000Z'),
    );
    // Both dropdown and scroll lifecycles are now active
    expect(engine.getActiveLifecycles().length).toBeGreaterThanOrEqual(2);

    // Click on dropdown option — commits scroll (non-scroll event) and dropdown
    result = engine.processResult(
      makeRecognised('click', 'Generic', '2024-01-01T00:00:02.000Z'),
      makeBatch('b3', { accessibleName: 'Option A', ariaRole: 'option' }),
    );
    // Should produce at least one action
    expect(result.emitted.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Reset ────────────────────────────────────────────────────────────────

describe('LifecycleEngine — Reset', () => {
  it('should clear all state on reset', () => {
    const engine = new LifecycleEngine();
    resetActionCounter();
    idCounter = 0;

    engine.processResult(
      makeRecognised('select', 'DropDownListbox'),
      makeBatch('b1'),
    );
    expect(engine.getActiveLifecycles()).toHaveLength(1);
    engine.reset();
    expect(engine.getActiveLifecycles()).toHaveLength(0);
    expect(engine.getEmittedActions()).toHaveLength(0);
  });
});

// ── SemanticActionBuilder ────────────────────────────────────────────────

describe('SemanticActionBuilder', () => {
  beforeEach(() => { resetActionCounter(); idCounter = 0; });

  it('should build plain English for fill', () => {
    const actions = buildSemanticActions([makeOutput({
      definitionId: 'text-entry-lifecycle',
      verb: 'fill', componentType: 'TextInput', value: 'hello',
    })]);
    expect(actions[0]!.plainEnglish).toBe("Enter 'hello' in the text field");
    expect(actions[0]!.id).toBe('action-0001');
  });

  it('should build plain English for select with value', () => {
    const actions = buildSemanticActions([makeOutput({
      verb: 'select', componentType: 'DropDownListbox', value: 'India',
    })]);
    expect(actions[0]!.plainEnglish).toBe("Select 'India' from the dropdown");
  });

  it('should build plain English for toggle', () => {
    const actions = buildSemanticActions([makeOutput({ verb: 'toggle', componentType: 'Checkbox' })]);
    expect(actions[0]!.plainEnglish).toBe('Toggle the checkbox');
  });

  it('should build plain English for click button', () => {
    const actions = buildSemanticActions([makeOutput({ verb: 'click', componentType: 'Button' })]);
    expect(actions[0]!.plainEnglish).toBe('Click the button');
  });

  it('should build plain English for navigate', () => {
    const actions = buildSemanticActions([makeOutput({ verb: 'navigate', componentType: 'Link' })]);
    expect(actions[0]!.plainEnglish).toBe('Navigate to a new page');
  });

  it('should build plain English for scroll', () => {
    const actions = buildSemanticActions([makeOutput({ verb: 'scroll', componentType: 'Generic' })]);
    expect(actions[0]!.plainEnglish).toBe('Scroll the page');
  });

  it('should build plain English for slider', () => {
    const actions = buildSemanticActions([makeOutput({
      verb: 'selectOption', componentType: 'Slider', value: '50',
    })]);
    expect(actions[0]!.plainEnglish).toBe("Set the slider to '50'");
  });

  it('should build plain English for selectDate', () => {
    const actions = buildSemanticActions([makeOutput({
      verb: 'selectDate', componentType: 'DatePicker', value: '2024-01-15',
    })]);
    expect(actions[0]!.plainEnglish).toBe("Select date '2024-01-15' from the date picker");
  });

  it('should assign sequential IDs', () => {
    const actions = buildSemanticActions([
      makeOutput({}),
      makeOutput({ sourceResults: ['r2'] }),
      makeOutput({ sourceResults: ['r3'] }),
    ]);
    expect(actions[0]!.id).toBe('action-0001');
    expect(actions[1]!.id).toBe('action-0002');
    expect(actions[2]!.id).toBe('action-0003');
  });

  it('should reset counter via processToSemanticActions', () => {
    const output = [makeOutput({})];
    processToSemanticActions(output);
    const actions = buildSemanticActions(output);
    expect(actions[0]!.id).toBe('action-0002');

    const actions2 = processToSemanticActions(output);
    expect(actions2[0]!.id).toBe('action-0001');
  });
});

// ── Lifecycle Definitions ────────────────────────────────────────────────

describe('Lifecycle Definitions', () => {
  it('should include all four lifecycle definitions', () => {
    const ids = LIFECYCLE_DEFINITIONS.map(d => d.id);
    expect(ids).toContain('text-entry-lifecycle');
    expect(ids).toContain('dropdown-lifecycle');
    expect(ids).toContain('date-picker-lifecycle');
    expect(ids).toContain('slider-lifecycle');
  });

  it('should find activating definition for select+DropDownListbox', () => {
    expect(findActivatingDefinition('select', 'DropDownListbox')?.id).toBe('dropdown-lifecycle');
  });

  it('should find activating definition for fill+TextInput', () => {
    expect(findActivatingDefinition('fill', 'TextInput')?.id).toBe('text-entry-lifecycle');
  });

  it('should find activating definition for selectDate+DatePicker', () => {
    expect(findActivatingDefinition('selectDate', 'DatePicker')?.id).toBe('date-picker-lifecycle');
  });

  it('should find activating definition for selectOption+Slider', () => {
    expect(findActivatingDefinition('selectOption', 'Slider')?.id).toBe('slider-lifecycle');
  });

  it('should NOT find activating definition for click+Button (immediate)', () => {
    expect(findActivatingDefinition('click', 'Button')).toBeUndefined();
  });

  it('should verify dropdown has outside-click and escape cancellation', () => {
    expect(DROPDOWN_LIFECYCLE.cancelOnOutsideClick).toBe(true);
    expect(DROPDOWN_LIFECYCLE.cancelOnEscape).toBe(true);
    expect(DROPDOWN_LIFECYCLE.maxDurationMs).toBe(10_000);
    expect(DROPDOWN_LIFECYCLE.rejectIfNoProgress).toBe(true);
  });

  it('should verify text entry rejects no-progress', () => {
    expect(TEXT_ENTRY_LIFECYCLE.rejectIfNoProgress).toBe(true);
    expect(TEXT_ENTRY_LIFECYCLE.cancelOnOutsideClick).toBe(false);
  });
});

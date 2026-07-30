/**
 * Category B — No Enrichment (Regression Safety)
 *
 * Verifies that the Structural Semantic Enrichment layer does NOT touch
 * any interaction type that isn't a multi-config Dropdown.
 *
 * For each pattern:
 *   1. shouldEnrich() returns false
 *   2. enrichConfigurationSession() returns interaction with no configurationSession
 *   3. IR Bridge produces the expected single-step IR (no field expansion)
 */

import { describe, it, expect } from 'vitest';
import { shouldEnrich, enrichConfigurationSession } from '../../src/enrichment/structural-enrichment';
import { build } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { ComponentInteraction } from '../../src/shared/component-types';
import type { SessionEvent } from '../../src/shared/types';
import { IRAction } from '../../src/domain/execution-ir/types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeTarget(name: string, tag = 'BUTTON', role = 'button'): any {
  return {
    tagName: tag,
    ariaRole: role,
    ariaLabel: name,
    accessibleName: name,
    inputType: null,
    cssClasses: [],
    elementId: `elem-${name.toLowerCase().replace(/\s+/g, '-')}`,
  };
}

function makeEvent(actionId: string, name: string): SessionEvent {
  return {
    actionId,
    timestamp: Date.now(),
    action: 'click',
    target: makeTarget(name),
    valueBefore: null,
    valueAfter: null,
    modifierKeys: [],
    url: 'https://example.com',
    timestampISO: new Date().toISOString(),
  } as unknown as SessionEvent;
}

function buildPlan(interaction: ComponentInteraction, events: SessionEvent[]) {
  const input: IRBridgeInput = {
    events,
    interactions: [interaction],
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', pageTitle: 'Test' },
    testCaseName: 'test',
  };
  return build(input);
}

// ── B1: Simple native dropdown ────────────────────────────────────────

describe('B1: Simple native dropdown — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Dropdown',
    trigger: makeTarget('One Way'),
    target: makeTarget('One Way'),
    eventIds: ['evt-1'],
    metadata: { selectedValue: 'Round Trip', targetName: 'One Way' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('enrichConfigurationSession does not add configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });

  it('IR Bridge produces a step (no configurationSession expansion)', () => {
    const plan = buildPlan(interaction, [makeEvent('evt-1', 'Round Trip')]);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    // Should NOT have multiple field-based steps (enrichment didn't fire)
    expect(plan.steps.length).toBeLessThanOrEqual(2);
  });
});

// ── B2: Simple custom dropdown (open → pick → auto-close) ─────────────

describe('B2: Simple custom dropdown — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Dropdown',
    trigger: makeTarget('Currency'),
    target: makeTarget('Currency'),
    eventIds: ['evt-1'],
    metadata: {
      selectedValue: 'USD',
      targetName: 'Currency',
      // No subActions — auto-close pattern, no Done button
    },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession in enriched result', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B3: Checkbox toggle ───────────────────────────────────────────────

describe('B3: Checkbox toggle — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Checkbox',
    trigger: makeTarget('Remember me', 'INPUT', 'checkbox'),
    target: makeTarget('Remember me', 'INPUT', 'checkbox'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Remember me', checked: true },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });

  it('IR Bridge produces TOGGLE step', () => {
    const plan = buildPlan(interaction, [makeEvent('evt-1', 'Remember me')]);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    // Checkbox maps to TOGGLE
    const toggleStep = plan.steps.find(s => s.action === IRAction.TOGGLE);
    expect(toggleStep).toBeDefined();
  });
});

// ── B4: Radio button selection ────────────────────────────────────────

describe('B4: Radio button — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'RadioButton',
    trigger: makeTarget('Round Trip', 'INPUT', 'radio'),
    target: makeTarget('Round Trip', 'INPUT', 'radio'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Round Trip', noOpSelection: false },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B5: Text entry ────────────────────────────────────────────────────

describe('B5: Text entry — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'TextEntry',
    trigger: makeTarget('Search', 'INPUT', 'textbox'),
    target: makeTarget('Search', 'INPUT', 'textbox'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Search', textValue: 'hello world', userTyped: true },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });

  it('IR Bridge produces FILL step', () => {
    const event: SessionEvent = {
      ...makeEvent('evt-1', 'Search'),
      action: 'text',
      value: 'hello world',
    } as any;
    const plan = buildPlan(interaction, [event]);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    const fillStep = plan.steps.find(s => s.action === IRAction.FILL);
    expect(fillStep).toBeDefined();
  });
});

// ── B6: Slider ────────────────────────────────────────────────────────

describe('B6: Slider — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Slider',
    trigger: makeTarget('Price Range', 'INPUT', 'slider'),
    target: makeTarget('Price Range', 'INPUT', 'slider'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Price Range', value: '500' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B7: Hover ─────────────────────────────────────────────────────────

describe('B7: Hover — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Hover',
    trigger: makeTarget('Menu Item'),
    target: makeTarget('Menu Item'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Menu Item', dwellMs: 1200, meaningful: true, confidence: 70 },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B8: Link click ────────────────────────────────────────────────────

describe('B8: Link click — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Link',
    trigger: makeTarget('Home', 'A', 'link'),
    target: makeTarget('Home', 'A', 'link'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Home', href: null },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B9: Tab click ─────────────────────────────────────────────────────

describe('B9: Tab click — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Tab',
    trigger: makeTarget('Details'),
    target: makeTarget('Details'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Details' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B10: Navigation ───────────────────────────────────────────────────

describe('B10: Navigation — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Navigation',
    trigger: makeTarget('Page', undefined as any, undefined as any),
    target: makeTarget('Page', undefined as any, undefined as any),
    eventIds: ['evt-1'],
    metadata: { pageUrl: 'https://example.com/page2', pageTitle: 'Page 2' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B11: Scroll ───────────────────────────────────────────────────────

describe('B11: Scroll — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Scroll',
    trigger: makeTarget('Page', undefined as any, undefined as any),
    target: makeTarget('Page', undefined as any, undefined as any),
    eventIds: ['evt-1'],
    metadata: { scrollDeltaY: 500, scrollDeltaX: 0, hasDelta: true, scrollTarget: 'page' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B12: Button click (generic) ───────────────────────────────────────

describe('B12: Button click — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'Click',
    trigger: makeTarget('Submit'),
    target: makeTarget('Submit'),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Submit', targetTag: 'BUTTON', targetRole: 'button', clientX: 100, clientY: 200 },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });

  it('IR Bridge produces CLICK step', () => {
    const plan = buildPlan(interaction, [makeEvent('evt-1', 'Submit')]);
    expect(plan.steps.length).toBeGreaterThanOrEqual(1);
    const clickStep = plan.steps.find(s => s.action === IRAction.CLICK);
    expect(clickStep).toBeDefined();
  });
});

// ── B13: File upload ──────────────────────────────────────────────────

describe('B13: File upload — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'FileUpload',
    trigger: makeTarget('Upload Document', 'INPUT', undefined as any),
    target: makeTarget('Upload Document', 'INPUT', undefined as any),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Upload Document', fileName: 'report.pdf' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── B14: Date picker ──────────────────────────────────────────────────

describe('B14: Date picker — NOT enriched', () => {
  const interaction: ComponentInteraction = {
    type: 'DatePicker',
    trigger: makeTarget('Departure Date', 'INPUT', undefined as any),
    target: makeTarget('Departure Date', 'INPUT', undefined as any),
    eventIds: ['evt-1'],
    metadata: { targetName: 'Departure Date', selectedDate: '15', dateValue: '2026-08-15' },
  } as unknown as ComponentInteraction;

  it('shouldEnrich returns false', () => {
    expect(shouldEnrich(interaction)).toBe(false);
  });

  it('no configurationSession', () => {
    const result = enrichConfigurationSession(interaction);
    expect(result.metadata?.configurationSession).toBeUndefined();
  });
});

// ── Summary: enrichment is invisible to all non-config types ──────────

describe('Summary: all non-config types are untouched', () => {
  const types: Array<{ type: string; metadata: Record<string, unknown> }> = [
    { type: 'Click', metadata: { targetName: 'Btn' } },
    { type: 'Checkbox', metadata: { targetName: 'CB', checked: true } },
    { type: 'RadioButton', metadata: { targetName: 'RB' } },
    { type: 'TextEntry', metadata: { targetName: 'TE', textValue: 'x' } },
    { type: 'Slider', metadata: { targetName: 'SL', value: '5' } },
    { type: 'Hover', metadata: { targetName: 'HV' } },
    { type: 'Link', metadata: { targetName: 'LNK' } },
    { type: 'Tab', metadata: { targetName: 'TAB' } },
    { type: 'Navigation', metadata: { pageUrl: 'https://x.com' } },
    { type: 'Scroll', metadata: { scrollDeltaY: 100 } },
    { type: 'FileUpload', metadata: { targetName: 'FU' } },
    { type: 'DatePicker', metadata: { targetName: 'DP' } },
  ];

  for (const { type, metadata } of types) {
    it(`${type} — shouldEnrich=false, no configurationSession`, () => {
      const interaction = {
        type,
        trigger: makeTarget('X'),
        target: makeTarget('X'),
        eventIds: ['evt-1'],
        metadata,
      } as unknown as ComponentInteraction;

      expect(shouldEnrich(interaction)).toBe(false);
      const result = enrichConfigurationSession(interaction);
      expect(result.metadata?.configurationSession).toBeUndefined();
      // Metadata should be unchanged — check that it still has its original key
      const hasOriginalKey = 'targetName' in (result.metadata ?? {})
        || 'pageUrl' in (result.metadata ?? {})
        || 'scrollDeltaY' in (result.metadata ?? {});
      expect(hasOriginalKey).toBe(true);
    });
  }
});

/**
 * 7.4-B2 S2A-11 — TextEntry why-block: comboboxSignal rendering pin.
 *
 * Spec .drytis/specs/phase-7-4-b2-combobox-typeable.md §S2A-11:
 *   - TextEntry with comboboxSignal → 'why: combobox input (aria-autocomplete=list)'
 *   - TextEntry without comboboxSignal → null (no fabricated why-block)
 *
 * Also pins P4c fs-parse map unchanged — no DEFINITION_PRIORITIES edits in B2.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildWhyBlock,
  DEFINITION_PRIORITIES,
} from '../../src/sidepanel/understanding-badge';
import type { ComponentInteraction } from '../../src/shared/component-types';

function interaction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'TextEntry',
    trigger: {} as ComponentInteraction['trigger'],
    triggerEvent: {} as ComponentInteraction['triggerEvent'],
    memberEvents: [],
    startTime: 0,
    endTime: 0,
    endState: 'completed',
    metadata: {},
    ...overrides,
  };
}

describe('7.4-B2 S2A-11 — TextEntry combobox why-block', () => {
  it('TextEntry + comboboxSignal=list → "why: combobox input (aria-autocomplete=list)"', () => {
    const why = buildWhyBlock(interaction({
      type: 'TextEntry',
      metadata: { comboboxSignal: 'list' },
    }));
    expect(why).toBe('why: combobox input (aria-autocomplete=list)');
  });

  it('TextEntry + comboboxSignal=both → "why: combobox input (aria-autocomplete=both)"', () => {
    const why = buildWhyBlock(interaction({
      type: 'TextEntry',
      metadata: { comboboxSignal: 'both' },
    }));
    expect(why).toBe('why: combobox input (aria-autocomplete=both)');
  });

  it('TextEntry + comboboxSignal=datalist → "why: combobox input (aria-autocomplete=datalist)"', () => {
    const why = buildWhyBlock(interaction({
      type: 'TextEntry',
      metadata: { comboboxSignal: 'datalist' },
    }));
    expect(why).toBe('why: combobox input (aria-autocomplete=datalist)');
  });

  it('TextEntry without comboboxSignal → null (no fabricated why-block)', () => {
    const why = buildWhyBlock(interaction({
      type: 'TextEntry',
      metadata: {},
    }));
    expect(why).toBeNull();
  });

  it('TextEntry with comboboxSignal=undefined → null (boolean-valued lesson)', () => {
    const why = buildWhyBlock(interaction({
      type: 'TextEntry',
      metadata: { comboboxSignal: undefined },
    }));
    expect(why).toBeNull();
  });
});

// P4c pin: DEFINITION_PRIORITIES unchanged — no priority edits in B2
describe('7.4-B2 — DEFINITION_PRIORITIES unchanged (P4c drift pin)', () => {
  const DEFS_DIR = path.join(__dirname, '..', '..', 'src', 'definitions');

  function parseDefinitionFile(src: string): { type: string; priority: number } | null {
    const typeMatch = src.match(/type:\s*'([A-Za-z]+)'/);
    const prioMatch = src.match(/priority:\s*(\d+)/);
    if (!typeMatch || !prioMatch) return null;
    return { type: typeMatch[1], priority: Number(prioMatch[1]) };
  }

  const definitionFiles = fs
    .readdirSync(DEFS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && f !== 'patterns.ts' && f !== 'dom-context-extractor.ts');

  const parsed = definitionFiles.map((f) => ({
    file: f,
    ...parseDefinitionFile(fs.readFileSync(path.join(DEFS_DIR, f), 'utf-8'))!,
  }));

  it('parses all 18 definition files (7.4-B5: +modal.ts)', () => {
    expect(parsed.length).toBe(18);
  });

  it('has a map entry for every parsed definition type', () => {
    for (const def of parsed) {
      expect(DEFINITION_PRIORITIES[def.type]).toBeDefined();
    }
  });

  it('map size === parsed count (no stale entries)', () => {
    expect(Object.keys(DEFINITION_PRIORITIES).length).toBe(parsed.length);
  });
});

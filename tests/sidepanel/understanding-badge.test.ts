/**
 * MS-U1 — understanding badge + why-block + priority drift pin (RED first).
 *
 * Spec: .drytis/specs/phase-6-u1-observed-workflow-cards.md (P4/P4b/P4c/P5).
 *
 *  P4   badge text for recognized / Unclassified+reason / projected pair.
 *  P4b  honesty: no reason metadata → `reason not recorded`, never blank.
 *  P4c  priority drift pin: frozen renderer map matches the registry.
 *  P5   why-block renders recorded facts only.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUnderstandingBadge,
  buildProjectedChip,
  buildWhyBlock,
  DEFINITION_PRIORITIES,
} from '../../src/sidepanel/understanding-badge';
import type { ComponentInteraction } from '../../src/shared/component-types';

function interaction(overrides: Partial<ComponentInteraction> = {}): ComponentInteraction {
  return {
    interactionId: 'int-1',
    type: 'Click',
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

// ── P4: badge text ──────────────────────────────────────────────────────

describe('P4 — buildUnderstandingBadge', () => {
  it('recognized DatePicker → `✓ DatePicker (prio 10)`', () => {
    const badge = buildUnderstandingBadge(interaction({ type: 'DatePicker' }));
    expect(badge?.text).toBe('✓ DatePicker (prio 10)');
  });

  it('recognized Click → `✓ Click (prio 180)`', () => {
    const badge = buildUnderstandingBadge(interaction({ type: 'Click' }));
    expect(badge?.text).toBe('✓ Click (prio 180)');
  });

  it('Unclassified + reason → `❓ Unclassified — {reason}`', () => {
    const badge = buildUnderstandingBadge(interaction({
      type: 'Unclassified',
      metadata: { reason: 'unclaimed-at-projection' },
    }));
    expect(badge?.text).toBe('❓ Unclassified — unclaimed-at-projection');
  });

  it('P4b: Unclassified without reason → honest `reason not recorded`', () => {
    const badge = buildUnderstandingBadge(interaction({ type: 'Unclassified', metadata: {} }));
    expect(badge?.text).toBe('❓ Unclassified — reason not recorded');
  });

  it('primary badge stays a single object for projected cards', () => {
    const badge = buildUnderstandingBadge(interaction({
      type: 'Unclassified',
      metadata: { reason: 'unclaimed-at-projection', physicalEvents: ['mousedown', 'click'] },
    }));
    expect(badge?.text).toBe('❓ Unclassified — unclaimed-at-projection');
  });

  it('buildProjectedChip renders the paired-physical line when 2+ physicalEvents', () => {
    const chip = buildProjectedChip({
      reason: 'unclaimed-at-projection',
      physicalEvents: ['mousedown', 'click'],
    });
    expect(chip?.text).toBe('⚠ projected (mousedown+click paired)');
  });
});

// ── P4c: priority drift pin (fs-parse, NOT registry-import) ─────────────
//
// D1: the renderer holds a FROZEN literal map; this pin parses the 16
// definition files from source and fails on ANY drift — a changed priority,
// a new definition, or a removed one — so the copy is always reviewed.

describe('P4c — DEFINITION_PRIORITIES matches the definition files (parsed from source)', () => {
  const DEFS_DIR = path.join(__dirname, '..', '..', 'src', 'definitions');

  /** Parse `type: 'X'` and `priority: N` literals from one definition file. */
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

  it('parses all 16 definition files (parse-failure fails the pin)', () => {
    expect(parsed.length).toBe(16);
  });

  it('has a map entry for every parsed definition type', () => {
    for (const def of parsed) {
      expect(
        DEFINITION_PRIORITIES[def.type],
        `definition ${def.type} (${def.file}) is missing from the renderer map`,
      ).toBeDefined();
    }
  });

  it('map values match the parsed file priorities exactly (drift fails)', () => {
    for (const def of parsed) {
      expect(
        DEFINITION_PRIORITIES[def.type],
        `priority drift for ${def.type} (${def.file}): map has ${JSON.stringify(DEFINITION_PRIORITIES[def.type])}, file has ${def.priority}`,
      ).toBe(def.priority);
    }
    // Stale entries (definition removed but still in the map) also fail:
    expect(Object.keys(DEFINITION_PRIORITIES).length).toBe(parsed.length);
  });
});

// ── P5: why-block ───────────────────────────────────────────────────────

describe('P5 — buildWhyBlock', () => {
  it('Hover renders its evidenceReason', () => {
    const why = buildWhyBlock(interaction({
      type: 'Hover',
      metadata: { evidenceReason: 'tooltip revealed' },
    }));
    expect(why).toContain('tooltip revealed');
  });

  it('Dropdown provisional→confirmed renders the trace line', () => {
    const why = buildWhyBlock(interaction({
      type: 'Dropdown',
      metadata: {
        selectionConfirmed: true,
        provisionalSelection: 'low',
        selectedValue: 'high',
      },
    }));
    expect(why).toContain('provisional: low → final: high');
  });

  it('Dropdown plain confirmed renders `selection confirmed`', () => {
    const why = buildWhyBlock(interaction({
      type: 'Dropdown',
      metadata: { selectionConfirmed: true, selectedValue: 'high' },
    }));
    expect(why).toContain('selection confirmed');
  });

  it('DatePicker renders the gridcell detection line', () => {
    const why = buildWhyBlock(interaction({ type: 'DatePicker', metadata: {} }));
    expect(why).toContain('gridcell');
  });

  it('Click does not render a gridcell line', () => {
    const why = buildWhyBlock(interaction({ type: 'Click', metadata: {} }));
    expect(why ?? '').not.toContain('gridcell');
  });

  it('absent facts → null (no fabricated why-block)', () => {
    expect(buildWhyBlock(interaction({ type: 'Click', metadata: {} }))).toBeNull();
  });
});

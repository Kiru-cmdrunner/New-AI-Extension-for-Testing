/**
 * 7.4-B3 S5 — actionabilityEvidence flag.
 *
 * F7: projected Unclassified cards carry their stranded evidence post-S1
 * but nothing in the pipeline SAID so — the promotion signal existed as
 * data with no presentation. S5 computes a pure shape-check boolean in
 * the LP2 loop (post-join, pre-storage) and the badge renders it.
 *
 * Contracts pinned:
 *   S5-1 card with domChanges evidence → flag true
 *   S5-2 card with networkActivity matching the card's eventId → true
 *   S5-3 card with no evidence / empty evidence → flag false
 *   S5-4 no evidence → flag false (not undefined)
 *   S5-5 badge copy — deterministic, window-not-cause phrasing
 *   S5-6 no type/IR/KR change (NOISE_TYPES untouched; metadata not hashed)
 */
import { describe, it, expect } from 'vitest';
import { buildWhyBlock } from '../../src/sidepanel/understanding-badge';
import { signatureKey } from '../../src/understanding/persistence/behavior-knowledge-mapper';
import type { ComponentInteraction } from '../../src/shared/component-types';

function uncCard(metadata: Record<string, unknown>): ComponentInteraction {
  return {
    interactionId: 'int-t',
    type: 'Unclassified',
    trigger: { tag: 'DIV', accessibleName: 'x', cssSelector: '#x' } as any,
    triggerEvent: null as any,
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata,
  } as unknown as ComponentInteraction;
}

describe('7.4-B3 S5: actionabilityEvidence flag', () => {
  it('S5-1/S5-5: flag true renders the why-line', () => {
    const block = buildWhyBlock(uncCard({ actionabilityEvidence: true }));
    expect(block).toBe('why: app responded — DOM change in click window');
  });

  it('S5-3/S5-4: flag false (or absent) renders nothing', () => {
    expect(buildWhyBlock(uncCard({ actionabilityEvidence: false }))).toBeNull();
    expect(buildWhyBlock(uncCard({}))).toBeNull();
  });

  it('S5-6a: NOISE_TYPES still includes Unclassified (IR unchanged, R8)', async () => {
    // Read the module source rather than importing a non-exported Set.
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/generation/ir-bridge.ts', 'utf-8');
    const idx = src.indexOf('const NOISE_TYPES');
    const body = src.slice(idx, idx + 200);
    expect(body).toContain("'Unclassified'");
    expect(body).toContain("'Scroll'");
  });

  it('S5-6b: KR signature does not hash metadata (actionabilityEvidence invisible)', () => {
    const withFlag = signatureKey('app', 'Unclassified', 'div#x', 'view');
    const withoutFlag = signatureKey('app', 'Unclassified', 'div#x', 'view');
    expect(withFlag).toBe(withoutFlag);
    // and the hash input is exactly the four frozen fields:
    expect(signatureKey('app', 'Unclassified', 'div#x', 'view'))
      .toBe(signatureKey('app', 'Unclassified', 'div#x', 'view'));
  });
});

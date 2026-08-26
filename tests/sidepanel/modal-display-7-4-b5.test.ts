/**
 * 7.4-B5 Modal — panel display pins (spec B5-1-9: TYPE_DISPLAY, badge, why-block, fs-parse sync).
 *
 * Red-first: fails until Modal is in DEFINITION_PRIORITIES, TYPE_DISPLAY,
 * and the why-block has Modal cases.
 */
import { describe, it, expect } from 'vitest';
import {
  buildUnderstandingBadge,
  buildWhyBlock,
  DEFINITION_PRIORITIES,
} from '../../src/sidepanel/understanding-badge';
import type { ComponentInteraction } from '../../src/shared/component-types';
import { ALL_DEFINITIONS } from '../../src/definitions';

function makeInteraction(
  over: Partial<ComponentInteraction> & { type: string; metadata: Record<string, unknown> },
): ComponentInteraction {
  return {
    interactionId: 'int-1',
    trigger: {
      accessibleName: 'Open Dialog',
      ariaRole: null,
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      tag: 'BUTTON',
      className: null,
      name: null,
      stableId: 'btn-1',
      testId: null,
      dataCy: null,
      dataQa: null,
      cssSelector: '#btn-1',
      xPath: '/html/body/button',
      inIframe: false,
      shadowDom: false,
      href: null,
      inputType: null,
      elementId: '',
    },
    triggerEvent: {} as any,
    memberEvents: [],
    startTime: 1000,
    endTime: 1000,
    endState: 'completed',
    ...over,
  } as ComponentInteraction;
}

describe('7.4-B5 Modal — panel display (B5-1-9)', () => {
  it('DEFINITION_PRIORITIES has Modal entry at 75', () => {
    expect(DEFINITION_PRIORITIES.Modal).toBe(75);
  });

  it('DEFINITION_PRIORITIES count matches parsed definition file count (fs-parse sync)', () => {
    // This mirrors the understanding-badge.test.ts:128 pin:
    // Object.keys(DEFINITION_PRIORITIES).length must equal parsed definition count.
    // Adding modal.ts makes the parsed count 18; the map must also be 18.
    const fs = require('fs');
    const path = require('path');
    const DEFS_DIR = path.join(__dirname, '../../src/definitions');
    const files = fs
      .readdirSync(DEFS_DIR)
      .filter(
        (f: string) =>
          f.endsWith('.ts') &&
          f !== 'index.ts' &&
          f !== 'patterns.ts' &&
          f !== 'dom-context-extractor.ts',
      );
    expect(Object.keys(DEFINITION_PRIORITIES).length).toBe(files.length);
  });

  it('badge renders "✓ Modal (prio 75)"', () => {
    const badge = buildUnderstandingBadge(makeInteraction({
      type: 'Modal',
      metadata: { action: 'open', targetName: 'Open Dialog' },
    }));
    expect(badge.text).toContain('Modal');
    expect(badge.text).toContain('75');
  });

  it('why-block open: aria-haspopup=dialog convention', () => {
    const why = buildWhyBlock(makeInteraction({
      type: 'Modal',
      metadata: { action: 'open', targetName: 'Open Dialog' },
    }));
    expect(why).toBeTruthy();
    expect(why!.toLowerCase()).toContain('dialog');
  });

  it('why-block dismiss: Escape pressed while dialog', () => {
    const why = buildWhyBlock(makeInteraction({
      type: 'Modal',
      metadata: { action: 'dismiss-escape', key: 'Escape', dialogInAncestry: true },
    }));
    expect(why).toBeTruthy();
    expect(why!.toLowerCase()).toContain('escape');
  });

  it('ALL_DEFINITIONS count is 18 (includes Modal)', () => {
    expect(ALL_DEFINITIONS).toHaveLength(18);
    expect(ALL_DEFINITIONS.find((d) => d.type === 'Modal')).toBeDefined();
  });
});
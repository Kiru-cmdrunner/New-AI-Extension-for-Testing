/**
 * 6F-M3 Wave 1 — O13 stopped-view placeholder honesty
 *
 * Spec: .drytis/specs/phase-6f-m3-w1-display-honesty.md §1 (AC1–AC5)
 *
 * After STOP, "⏳ Collecting behavioral evidence…" is a lie for any card
 * whose evidence never arrived. The stopped view must render an honest
 * terminal note instead; the live view keeps the collecting placeholder.
 */
import { describe, it, expect } from 'vitest';
import type { ComponentInteraction } from '../../../src/shared/component-types';
import {
  renderProductionInteractions,
} from '../../../src/sidepanel/interaction-renderer';

const LIVE_PLACEHOLDER = 'Collecting behavioral evidence';
const TERMINAL_NOTE = 'No behavioral evidence captured for this interaction';

function clickNoEvidence(): ComponentInteraction {
  return {
    interactionId: 'int-o13-1',
    type: 'Click' as never,
    trigger: {
      accessibleName: 'Search',
      tag: 'BUTTON',
      ariaRole: 'button',
      stableId: 'search-btn',
    } as never,
    triggerEvent: { eventId: 'evt-1', eventType: 'click' } as never,
    memberEvents: [] as never,
    startTime: 1_000,
    endTime: 1_100,
    endState: 'completed' as never,
    metadata: { targetName: 'Search' },
  } as unknown as ComponentInteraction;
}

function container(): HTMLElement {
  return document.createElement('div');
}

function allText(el: HTMLElement): string {
  return el.textContent ?? '';
}

describe('6F-M3 O13 — stopped-view placeholder honesty', () => {
  it('AC1: stopped view + null evidence → terminal note, never "Collecting…" (default filter)', () => {
    const c = container();
    renderProductionInteractions(c, [clickNoEvidence()], { view: 'stopped' });
    const text = allText(c);
    expect(text).toContain(TERMINAL_NOTE);
    expect(text).not.toContain(LIVE_PLACEHOLDER);
    // Card itself still renders (show-and-mark, never hide)
    expect(c.querySelectorAll('.interaction-event').length).toBe(1);
  });

  it('AC2: live view + null evidence → collecting placeholder unchanged', () => {
    const c = container();
    renderProductionInteractions(c, [clickNoEvidence()], { view: 'live' });
    const text = allText(c);
    expect(text).toContain(LIVE_PLACEHOLDER);
    expect(text).not.toContain(TERMINAL_NOTE);
  });

  it('AC3: default options (no view) → live behavior byte-identical (back-compat)', () => {
    const c = container();
    renderProductionInteractions(c, [clickNoEvidence()]);
    const text = allText(c);
    expect(text).toContain(LIVE_PLACEHOLDER);
    expect(text).not.toContain(TERMINAL_NOTE);
  });

  it('AC4: stopped + showHidden + null evidence → card + terminal note + suppressed chip co-exist', () => {
    const suppressed = clickNoEvidence();
    // A TextEntry with no typing is production-suppressed but rendered with
    // a chip when showHidden=true — combined with null evidence.
    suppressed.type = 'TextEntry' as never;
    (suppressed.metadata as Record<string, unknown>).textValue = '';
    (suppressed.metadata as Record<string, unknown>).userTyped = false;
    const c = container();
    renderProductionInteractions(c, [suppressed], {
      view: 'stopped',
      showHidden: true,
    });
    const text = allText(c);
    expect(text).toContain(TERMINAL_NOTE);
    expect(text).not.toContain(LIVE_PLACEHOLDER);
    // Card rendered despite being suppressed (show-and-mark)
    expect(c.querySelectorAll('.interaction-event').length).toBe(1);
    expect(c.querySelector('.interaction-chip--suppressed')).not.toBeNull();
  });

  it('AC5a: stopped view + evidence present → evidence renders, no placeholder at all', () => {
    const withEv = clickNoEvidence();
    withEv.behavioralEvidence = {
      window: { endReason: 'stabilized', durationMs: 90 },
      targetEvidence: { identity: null, before: null, after: null },
      applicationEvidence: {
        domChanges: [],
        newSurfaces: [],
        removedSurfaces: [],
        visibilityChanges: [],
      },
    } as never;
    const c = container();
    renderProductionInteractions(c, [withEv], { view: 'stopped' });
    const text = allText(c);
    expect(text).not.toContain(LIVE_PLACEHOLDER);
    expect(text).not.toContain(TERMINAL_NOTE);
    expect(text).toContain('Window: 90ms');
  });
});

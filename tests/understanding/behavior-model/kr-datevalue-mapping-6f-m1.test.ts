/**
 * 6F-M1 Item B — KR parameter VALUE mapping (dateValue fallback)
 *
 * Spec: .drytis/specs/phase-6f-m1-gesture-ownership.md §2.1.B, §2.3.4, §3.B
 *
 * episode-builder param value chain becomes:
 *   textValue ?? dateValue ?? valueAfter
 *
 * Drives the real buildEpisodes with the same fixture shapes as
 * episode-builder.test.ts (deterministic, no real time).
 */

import { describe, it, expect } from 'vitest';
import {
  buildEpisodes,
  type EpisodeBuilderInteraction,
} from '../../../src/understanding/behavior-model/episode-builder';

const T = 1_000_000;
let seq = 0;

function evt(opts: {
  eventType: string;
  timestamp: number;
  captureSeq?: number;
  valueAfter?: string | null;
}): any {
  seq += 1;
  return {
    eventId: `evt-p1-${seq}`,
    eventType: opts.eventType,
    timestamp: opts.timestamp,
    captureSeq: opts.captureSeq ?? seq,
    captureOrigin: { tabId: 7, frameId: 0 },
    pageId: 'p1',
    valueAfter: opts.valueAfter ?? null,
  };
}

/** DatePicker parameter member (focus-triggered; metadata carries dateValue). */
function datePicker(
  id: string,
  t: number,
  over: {
    dateValue?: string;
    textValue?: string;
    valueAfter?: string | null;
  } = {},
): EpisodeBuilderInteraction {
  const metadata: Record<string, unknown> = { targetName: 'Depart on' };
  if (over.dateValue !== undefined) metadata.dateValue = over.dateValue;
  if (over.textValue !== undefined) metadata.textValue = over.textValue;
  return {
    interactionId: id,
    type: 'DatePicker',
    triggerEvent: evt({ eventType: 'focus', timestamp: t, valueAfter: over.valueAfter ?? null }),
    trigger: { tag: 'INPUT', accessibleName: 'Depart on', inputType: null },
    memberEvents: [],
    startTime: t,
    endTime: t + 80,
    endState: 'completed',
    metadata,
  } as unknown as EpisodeBuilderInteraction;
}

/** Submit-capable click anchor (same shape as episode-builder.test.ts). */
function addToCartClick(t0: number): EpisodeBuilderInteraction {
  const triggerEvent = evt({ eventType: 'click', timestamp: t0 });
  return {
    interactionId: `int-${t0}`,
    type: 'Click',
    triggerEvent,
    trigger: { tag: 'INPUT', inputType: 'submit', accessibleName: 'Add to Cart' },
    memberEvents: [triggerEvent],
    startTime: t0,
    endTime: t0 + 190,
    endState: 'completed',
    metadata: { targetName: 'Add to Cart' },
  } as unknown as EpisodeBuilderInteraction;
}

describe('6F-M1 B — episode-builder dateValue param mapping', () => {
  it('AC-B1: dateValue present, textValue/valueAfter absent → value === dateValue', () => {
    const dp = datePicker('int-dp', T - 500, {
      dateValue: 'Choose Sunday, September 6th, 2026',
    });
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [dp, click] });
    const ep = r.episodes[0];
    expect(ep.parameterInputs).toHaveLength(1);
    expect(ep.parameterInputs[0]).toMatchObject({
      interactionId: 'int-dp',
      label: 'Depart on',
      value: 'Choose Sunday, September 6th, 2026',
    });
  });

  it('AC-B1b: textValue present → wins over dateValue', () => {
    const dp = datePicker('int-dp', T - 500, {
      textValue: 'Amanda',
      dateValue: '2026-09-06',
    });
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [dp, click] });
    expect(r.episodes[0].parameterInputs[0]?.value).toBe('Amanda');
  });

  it('AC-B1c: dateValue + valueAfter both present → dateValue wins', () => {
    const dp = datePicker('int-dp', T - 500, {
      dateValue: 'Choose Sunday, September 6th, 2024',
      valueAfter: 'stale-echo',
    });
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [dp, click] });
    expect(r.episodes[0].parameterInputs[0]?.value).toBe('Choose Sunday, September 6th, 2024');
  });

  it('AC-B2: textEntry param values unchanged (no regression)', () => {
    const te = {
      interactionId: 'int-te',
      type: 'TextEntry',
      triggerEvent: evt({ eventType: 'input', timestamp: T - 500 }),
      trigger: { tag: 'INPUT', accessibleName: 'Search' },
      memberEvents: [],
      startTime: T - 500,
      endTime: T - 420,
      endState: 'completed',
      metadata: { targetName: 'Search', textValue: 'lamp' },
    } as unknown as EpisodeBuilderInteraction;
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [te, click] });
    expect(r.episodes[0].parameterInputs[0]).toMatchObject({
      interactionId: 'int-te',
      label: 'Search',
      value: 'lamp',
      link: 'form-overlap',
    });
  });

  it('AC-B2b: valueAfter fallback still applies when neither textValue nor dateValue exist', () => {
    const te = {
      interactionId: 'int-va',
      type: 'TextEntry',
      triggerEvent: evt({ eventType: 'input', timestamp: T - 500, valueAfter: 'typed-final-value' }),
      trigger: { tag: 'INPUT', accessibleName: 'Notes' },
      memberEvents: [],
      startTime: T - 500,
      endTime: T - 420,
      endState: 'completed',
      metadata: { targetName: 'Notes' },
    } as unknown as EpisodeBuilderInteraction;
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [te, click] });
    expect(r.episodes[0].parameterInputs[0]?.value).toBe('typed-final-value');
  });

  it('AC-B3: all sources absent → honest null (no invented value)', () => {
    const dp = datePicker('int-null', T - 500, {});
    const click = addToCartClick(T);
    const r = buildEpisodes({ interactions: [dp, click] });
    expect(r.episodes[0].parameterInputs[0]?.value).toBeNull();
  });

  it('AC-B4: linkage window edge — param at exactly PARAMETER_LINK_WINDOW_MS still links', () => {
    const dp = datePicker('int-edge', T, { dateValue: '2026-09-06' });
    const click = addToCartClick(T + 30_000);
    const r = buildEpisodes({ interactions: [dp, click] });
    expect(r.episodes[0].parameterInputs).toHaveLength(1);
    expect(r.episodes[0].parameterInputs[0]?.value).toBe('2026-09-06');
  });
});

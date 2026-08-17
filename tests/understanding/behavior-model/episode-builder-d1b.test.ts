/**
 * D1b — episode-builder parameter linking for the suggestion-<div> shape.
 *
 * Typing a query and picking a suggestion <div> that triggers a
 * programmatic form submit: the div is not submit-capable, so pre-D1b the
 * TextEntry owned NO episode and parameterInputs was empty. D1b extends
 * Rule 2 (form-overlap) with the gesture-adjacent nav-owner arm.
 */
import { describe, it, expect } from 'vitest';
import { buildEpisodes } from '../../../src/understanding/behavior-model/episode-builder';
import type { EpisodeBuilderInteraction } from '../../../src/understanding/behavior-model/episode-builder';
import type { ComponentInteraction } from '../../../src/shared/component-types';

function identity(name: string, tag: string, cssSelector: string) {
  return {
    accessibleName: name, ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag, className: null, name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector, xPath: '',
    inIframe: false, shadowDom: false, href: null, inputType: null, elementId: '',
  };
}

type Mut = Partial<EpisodeBuilderInteraction> & { interactionId: string };

function mk(mut: Mut): EpisodeBuilderInteraction {
  const base: ComponentInteraction = {
    interactionId: mut.interactionId,
    type: 'Unclassified',
    endState: 'completed',
    startTime: 0,
    endTime: 0,
    trigger: identity('x', 'DIV', '.x'),
    memberEvents: [],
    metadata: {},
  } as unknown as ComponentInteraction;
  return {
    ...base,
    triggerEvent: {
      eventId: `evt-pA-${mut.interactionId.replace(/[^0-9]/g, '') || '0'}`,
      eventType: 'click',
      timestamp: 0,
      captureSeq: 0,
      captureOrigin: { tabId: 7, frameId: 0 },
      target: identity('x', 'DIV', '.x'),
    } as never,
    ...mut,
  } as unknown as EpisodeBuilderInteraction;
}

const TAB = 7;
const PAGE = 'evt-pA-';

/** TextEntry completed at t, on the search input (same page as the div). */
function text(tEnd: number): Mut {
  return {
    interactionId: 'int-2',
    type: 'TextEntry',
    startTime: tEnd - 800,
    endTime: tEnd,
    lifecycleId: 'lc-text',
    trigger: identity('Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox'),
    triggerEvent: {
      eventId: `${PAGE}2`,
      eventType: 'focus',
      timestamp: tEnd - 800,
      captureSeq: 1,
      captureOrigin: { tabId: TAB, frameId: 0 },
      target: identity('Search Replica Bazaar', 'INPUT', '#twotabsearchtextbox'),
      valueAfter: 'headphones',
    } as never,
    metadata: { textValue: 'headphones', targetName: 'Search Replica Bazaar' },
  };
}

/** Click on the suggestion div (anchor) at t. */
function suggestClick(t: number): Mut {
  return {
    interactionId: 'int-4',
    type: 'Click',
    startTime: t,
    endTime: t,
    lifecycleId: 'lc-sug',
    trigger: identity('wireless headphones pro', 'DIV', '#sug-0'),
    triggerEvent: {
      eventId: `${PAGE}4`,
      eventType: 'click',
      timestamp: t,
      captureSeq: 2,
      captureOrigin: { tabId: TAB, frameId: 0 },
      target: identity('wireless headphones pro', 'DIV', '#sug-0'),
    } as never,
    metadata: { targetName: 'wireless headphones pro' },
  };
}

/** Synthetic navigation committed at t (destination of the programmatic submit). */
function nav(t: number): Mut {
  return {
    interactionId: 'int-5',
    type: 'Navigation',
    startTime: t,
    endTime: t,
    trigger: identity('http://x/search.html?q=headphones', 'HTML', 'html'),
    triggerEvent: {
      eventId: `nav-${t}`,
      eventType: 'navigation',
      timestamp: t,
      captureSeq: 3,
      captureOrigin: { tabId: TAB, frameId: 0 },
      target: identity('http://x/search.html?q=headphones', 'HTML', 'html'),
    } as never,
    metadata: {},
  };
}

describe('D1b gesture-adjacent nav-owner parameter link', () => {
  it('text completed ≤500ms before the suggestion-div click (which owns the nav) links as parameter', () => {
    const interactions = [
      mk(text(1900)),
      mk(suggestClick(2000)),
      mk(nav(2100)),
    ];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    expect(ep).toBeDefined();
    const param = ep!.parameterInputs.find((p) => p.interactionId === 'int-2');
    expect(param).toBeDefined();
    expect(param!.value).toBe('headphones');
    expect(param!.label).toBe('Search Replica Bazaar');
    expect(param!.link).toBe('form-overlap');
  });

  it('text completed long before the div click (>500ms) does NOT link via the gesture arm', () => {
    const interactions = [
      mk(text(1000)),
      mk(suggestClick(2000)),
      mk(nav(2100)),
    ];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    expect(ep?.parameterInputs.find((p) => p.interactionId === 'int-2')).toBeUndefined();
  });

  it('submit-capable BUTTON keeps the original 30s window (D1b does not narrow it)', () => {
    // Text completed 5s before the Go button click — outside 500ms, inside 30s.
    const goClick: Mut = {
      interactionId: 'int-4',
      type: 'Click',
      startTime: 6000,
      endTime: 6000,
      lifecycleId: 'lc-go',
      trigger: identity('Go', 'BUTTON', '#go-search'),
      triggerEvent: {
        eventId: `${PAGE}4`,
        eventType: 'click',
        timestamp: 6000,
        captureSeq: 2,
        captureOrigin: { tabId: TAB, frameId: 0 },
        target: identity('Go', 'BUTTON', '#go-search'),
      } as never,
      metadata: { targetName: 'Go' },
    };
    const interactions = [mk(text(1000)), goClick as never, mk(nav(6100))];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    const param = ep?.parameterInputs.find((p) => p.interactionId === 'int-2');
    expect(param).toBeDefined();
    expect(param!.link).toBe('form-overlap');
  });

  it('an A-link owning the navigation does NOT get the gesture arm (links do not submit forms)', () => {
    const link: Mut = {
      interactionId: 'int-7',
      type: 'Link',
      startTime: 2000,
      endTime: 2000,
      lifecycleId: 'lc-link',
      trigger: identity('Aurora Wireless Headphones', 'A', '#result-P100'),
      triggerEvent: {
        eventId: `${PAGE}7`,
        eventType: 'click',
        timestamp: 2000,
        captureSeq: 2,
        captureOrigin: { tabId: TAB, frameId: 0 },
        target: identity('Aurora Wireless Headphones', 'A', '#result-P100'),
      } as never,
      metadata: { targetName: 'Aurora Wireless Headphones' },
    };
    const interactions = [mk(text(1900)), link as never, mk(nav(2100))];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-7');
    expect(ep?.parameterInputs.find((p) => p.interactionId === 'int-2')).toBeUndefined();
  });

  it('div click WITHOUT a navigation does NOT get the gesture arm', () => {
    // A plain div click that opens a dropdown (no commit) — no nav owned.
    const interactions = [mk(text(1900)), mk(suggestClick(2000))];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    expect(ep?.parameterInputs.find((p) => p.interactionId === 'int-2')).toBeUndefined();
  });

  it('different tab: nav owned on another tab does not grant the link', () => {
    const foreignNav: Mut = {
      ...nav(2100),
      triggerEvent: {
        eventId: 'nav-foreign',
        eventType: 'navigation',
        timestamp: 2100,
        captureSeq: 3,
        captureOrigin: { tabId: 9, frameId: 0 },
        target: identity('http://y/', 'HTML', 'html'),
      } as never,
    };
    const interactions = [mk(text(1900)), mk(suggestClick(2000)), foreignNav as never];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    expect(ep?.parameterInputs.find((p) => p.interactionId === 'int-2')).toBeUndefined();
  });

  it('intervening anchor between text and div click blocks the link (guard kept)', () => {
    const intervening: Mut = {
      interactionId: 'int-3',
      type: 'Click',
      startTime: 1950,
      endTime: 1950,
      lifecycleId: 'lc-mid',
      trigger: identity('something', 'BUTTON', '#other'),
      triggerEvent: {
        eventId: `${PAGE}3`,
        eventType: 'click',
        timestamp: 1950,
        captureSeq: 2,
        captureOrigin: { tabId: TAB, frameId: 0 },
        target: identity('something', 'BUTTON', '#other'),
      } as never,
      metadata: { targetName: 'something' },
    };
    const interactions = [mk(text(1900)), intervening as never, mk(suggestClick(2000)), mk(nav(2100))];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    expect(ep?.parameterInputs.find((p) => p.interactionId === 'int-2')).toBeUndefined();
  });

  it('full suggestion shape: episode has members text+nav and parameter value present', () => {
    const interactions = [
      mk(text(1900)),
      mk(suggestClick(2000)),
      mk(nav(2100)),
    ];
    const result = buildEpisodes({ interactions } as never);
    const ep = result.episodes.find((e) => e.anchor.interactionId === 'int-4');
    const roles = ep!.members.map((m) => m.role).sort();
    expect(roles).toEqual(['anchor', 'navigation', 'parameter']);
    // Text is unowned overall (no episode link) → not in unowned list.
    expect(result.unownedInteractionIds).not.toContain('int-2');
  });
});

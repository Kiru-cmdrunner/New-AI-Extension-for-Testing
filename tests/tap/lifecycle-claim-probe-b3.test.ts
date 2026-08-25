/**
 * 7.4-B3 E2E C3 RCA probe #2 (kept: pins the collector semantics the RCA relied on).
 *
 * Question: in real Chrome, the dismissal click (evt-59, plain #popover-backdrop
 * div) opened an evidence window at 5782.8 that NEVER self-closed (300ms-cadence
 * re-scheduling in its stabilityTrace) and was only force-closed at STOP
 * (endReason 'recording-stopped', 1266ms after open). Non-lifecycle windows
 * close on 300ms quiescence (evt-2 'stabilized' @783ms, evt-22 @300ms did).
 *
 * A window that never self-closes is either holdOpen (a lifecycle claimed it and
 * never finalized — an abandoned lifecycle is invisible in the projection) or
 * gate-blocked (stale causal in-flight). This probe asks: does ANY definition in
 * ALL_DEFINITIONS start a lifecycle on a click on a plain div with body/html
 * ancestry (the exact evt-59 shape)?
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions';
import type { ObservedEvent } from '../../src/shared/component-types';
import type { RuntimeConfig } from '../../src/shared/component-types';

const mkClick = (eventId: string, sel: string, tag: string, name: string): ObservedEvent => ({
  eventId,
  eventType: 'click',
  timestamp: Date.now(),
  captureSeq: performance.now(),
  isTrusted: true,
  target: {
    tag,
    cssSelector: sel,
    accessibleName: name,
    ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, className: '', name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, xPath: '',
    inIframe: false, shadowDom: false, href: null, inputType: null, elementId: '',
  },
  domContext: {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: ['body', 'html'],
    ancestorClasses: ['', ''],
    tabIndex: null,
  },
  valueBefore: null,
  valueAfter: null,
  checkedBefore: null,
  checkedAfter: null,
  clientX: 5, clientY: 5,
  key: null, code: null,
  shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  scrollDeltaY: null, scrollDeltaX: null,
  pageUrl: 'http://127.0.0.1:8244/census-validation.html',
  pageTitle: '7.4-B3 Census Fixture',
  captureOrigin: { tabId: 1, frameId: 0 },
} as unknown as ObservedEvent);

describe('lifecycle claim probe — plain-div click (evt-59 shape)', () => {
  it('no definition starts a lifecycle on the dismissal click', () => {
    const starts: string[] = [];
    const config: RuntimeConfig = {
      onEmit: () => {},
      onLifecycleStart: (ctx) => { starts.push(`${ctx.type} on ${ctx.triggerEvent.eventId}`); },
    };
    const runtime = createRuntime(ALL_DEFINITIONS, config);
    const emitted = runtime.process(mkClick('evt-B', 'body > div#popover-backdrop', 'DIV', ''));
    expect(starts).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('no lifecycle starts on the plain-div/no-affordance click either (control)', () => {
    const starts: string[] = [];
    const runtime = createRuntime(ALL_DEFINITIONS, {
      onEmit: () => {},
      onLifecycleStart: (ctx) => { starts.push(ctx.type); },
    });
    runtime.process(mkClick('evt-C', '#plain-div', 'DIV', 'plain div — no affordance'));
    expect(starts).toEqual([]);
  });

  it('a BUTTON click DOES start a Click lifecycle (positive control)', () => {
    const starts: string[] = [];
    const runtime = createRuntime(ALL_DEFINITIONS, {
      onEmit: () => {},
      onLifecycleStart: (ctx) => { starts.push(ctx.type); },
    });
    runtime.process(mkClick('evt-D', '#repeat-btn', 'BUTTON', 'Repeat Me'));
    expect(starts).toContain('Click');
  });
});

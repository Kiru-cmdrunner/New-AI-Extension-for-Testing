/**
 * 7.4-B4 S3 — Live-bridge DROP pin (black-box, via public build()).
 *
 * NOISE_TYPES = {Scroll, Unclassified} in src/generation/ir-bridge.ts is
 * NOT exported — before this file, NOTHING pinned the live bridge's
 * Unclassified drop. An accidental NOISE_TYPES edit would silently flip
 * the only production IR policy without failing any test.
 *
 * The honest black-box assertion is sourceEventId set-membership: a plan
 * built from recognized + Unclassified interactions must carry ZERO steps
 * whose sourceEventId belongs to an Unclassified interaction, and the step
 * count must equal the recognized-only expectation (N Unclassified in ⇒
 * same plan as 0 in). (metadata.unclassified is an adapter-only marker
 * the bridge never sets — asserting its absence would pin nothing.)
 *
 * D2 decision: DROP — decision record .drytis/notes/
 * phase-7-4-b3-d1-d2-decision-record.md + canonical spec
 * .drytis/specs/phase-7-4-b4-unclassified-output-policy.md (2026-08-26).
 */

import { describe, it, expect } from 'vitest';
import { build } from '../../src/generation/ir-bridge';
import type { ComponentInteraction, ObservedEvent, ElementIdentity } from '../../src/shared/component-types';

// ── Factories (shape proven by tests/generation/dropdown-input-replay-7-4-b2.test.ts) ──

function makeIdentity(over: Partial<ElementIdentity>): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    href: null,
    inputType: null,
    elementId: '',
    ...over,
  } as ElementIdentity;
}

function makeObserved(over: Partial<ObservedEvent> & { eventId: string; eventType: string }): ObservedEvent {
  return {
    timestamp: 1,
    captureSeq: 1,
    isTrusted: true,
    domContext: {
      inputType: null,
      ariaExpanded: null,
      ariaHasPopup: null,
      isContentEditable: false,
      disabled: false,
      readOnly: false,
      required: false,
      ancestorRoles: [],
      ancestorClasses: [],
      tabIndex: null,
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.test/',
    pageTitle: 'Test',
    target: makeIdentity({}),
    ...over,
  } as unknown as ObservedEvent;
}

function makeUnclassified(
  id: string,
  eventId: string,
  physicalEventType: string,
): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'DIV',
    stableId: 'plain-div',
    accessibleName: 'Plain Div',
    cssSelector: 'div.plain',
    xPath: '/html/body/div[3]',
    elementId: 'elem-plain',
  });
  return {
    interactionId: id,
    type: 'Unclassified',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: physicalEventType as ObservedEvent['eventType'],
      target: identity,
    }),
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: {
      physicalEventType,
      recognized: false,
      reason: 'no-definition-matched',
      targetName: 'Plain Div',
      targetTag: 'DIV',
      targetRole: null,
    },
  } as unknown as ComponentInteraction;
}

function makeClick(id: string, eventId: string): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'BUTTON',
    stableId: 'login-btn',
    accessibleName: 'Login',
    cssSelector: '#login-btn',
    xPath: '/html/body/button',
    elementId: 'elem-login',
  });
  return {
    interactionId: id,
    type: 'Click',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: 'click',
      target: identity,
    }),
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: { targetName: 'Login', targetTag: 'BUTTON' },
  } as unknown as ComponentInteraction;
}

function makeTextEntry(id: string, eventId: string): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'INPUT',
    stableId: 'user-in',
    accessibleName: 'Username',
    cssSelector: '#user-in',
    xPath: '/html/body/input',
    inputType: 'text',
    elementId: 'elem-user',
  });
  return {
    interactionId: id,
    type: 'TextEntry',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: 'focus',
      target: identity,
    }),
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: { targetName: 'Username', textValue: 'admin', userTyped: true },
  } as unknown as ComponentInteraction;
}

function makeScroll(id: string, eventId: string): ComponentInteraction {
  const identity = makeIdentity({
    tag: 'DIV',
    stableId: 'scroll-host',
    accessibleName: 'Scroll Host',
    cssSelector: '#scroll-host',
    xPath: '/html/body/div[4]',
    elementId: 'elem-scroll',
  });
  return {
    interactionId: id,
    type: 'Scroll',
    trigger: identity,
    triggerEvent: makeObserved({
      eventId,
      eventType: 'scroll',
      target: identity,
    }),
    memberEvents: [],
    startTime: 1,
    endTime: 2,
    endState: 'completed',
    metadata: { targetName: 'Scroll Host', hasDelta: true, scrollDeltaY: 400 },
  } as unknown as ComponentInteraction;
}

function buildIR(interactions: ComponentInteraction[]) {
  return build({
    interactions,
    recordingContext: { startUrl: 'https://example.test/', title: 'Test' },
    testCaseName: 'B4 noise drop',
  } as never);
}

// ── S3-1: Unclassified drop ────────────────────────────────

describe('7.4-B4 S3: live bridge NOISE_TYPES DROP pin', () => {
  it('S3-1: zero steps sourced from Unclassified interactions; recognized-only parity', () => {
    const unclassified = [
      makeUnclassified('int-u1', 'evt-unc-1', 'click'),
      makeUnclassified('int-u2', 'evt-unc-2', 'contextmenu'),
      makeUnclassified('int-u3', 'evt-unc-3', 'keydown'),
    ];
    const recognized = [
      makeClick('int-r1', 'evt-rec-1'),
      makeTextEntry('int-r2', 'evt-rec-2'),
    ];

    const mixed = buildIR([...unclassified, ...recognized]);
    const baseline = buildIR([...recognized]);

    // Sanity: the plan is non-degenerate
    expect(mixed.steps.length).toBeGreaterThan(0);

    // 3 Unclassified in ⇒ same step count as 0 in
    expect(mixed.steps.length).toBe(baseline.steps.length);

    // Zero steps carry a sourceEventId belonging to an Unclassified interaction
    const unclassifiedEventIds = new Set(unclassified.map((u) => u.triggerEvent.eventId));
    const leaked = mixed.steps.filter(
      (s) => s.sourceEventId !== undefined && unclassifiedEventIds.has(s.sourceEventId),
    );
    expect(leaked).toHaveLength(0);
  });

  it('S3-1b: the drop holds per physical type (click, contextmenu, keydown individually)', () => {
    for (const [physical, eventId] of [
      ['click', 'evt-unc-click'],
      ['contextmenu', 'evt-unc-ctx'],
      ['keydown', 'evt-unc-key'],
    ] as const) {
      const mixed = buildIR([makeUnclassified('int-u', eventId, physical), makeClick('int-r1', 'evt-rec-1')]);
      const baseline = buildIR([makeClick('int-r1', 'evt-rec-1')]);
      expect(mixed.steps.length).toBe(baseline.steps.length);
      expect(
        mixed.steps.filter((s) => s.sourceEventId === eventId),
      ).toHaveLength(0);
    }
  });

  it('S3-2: Scroll is likewise dropped (whole NOISE_TYPES set pinned)', () => {
    const scroll = makeScroll('int-s1', 'evt-sc-1');
    const recognized = [makeClick('int-r1', 'evt-rec-1')];

    const mixed = buildIR([scroll, ...recognized]);
    const baseline = buildIR([...recognized]);

    expect(mixed.steps.length).toBe(baseline.steps.length);
    expect(mixed.steps.filter((s) => s.sourceEventId === 'evt-sc-1')).toHaveLength(0);
  });
});

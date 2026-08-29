/**
 * B7-P1 UNIT — Hover member-event policy (red-first)
 *
 * Spec §5.1.3 + W-6: member events for a hover lifecycle are pointer-path
 * facts (subsequent trusted mouseenters, gated or not) + the terminal
 * event. Mousemoves are NOT member events. MAX_POINTER_PATH_FACTS = 20
 * per window, drop-oldest. Enforced definition-locally (W-6).
 *
 * These tests drive the runtime (ComponentRuntime + hover definition)
 * directly with synthetic ObservedEvents and assert memberEvents shape.
 */

import { describe, it, expect } from 'vitest';
import { createRuntime } from '../../src/runtime/component-runtime';
import { hoverDefinition } from '../../src/definitions/hover';

describe('B7-P1: hover member policy', () => {
  function observed(eventType: string, eventId: string, tag = 'BUTTON') {
    return {
      eventId,
      eventType,
      timestamp: Date.now(),
      captureSeq: seq++,
      isTrusted: true,
      target: {
        accessibleName: 'x', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
        placeholder: null, tag, className: null, name: null, stableId: 'btn-' + eventId,
        testId: null, dataCy: null, dataQa: null, cssSelector: '', xPath: '', elementId: '',
        rect: null, textContent: null, shadowContext: null,
      },
      domContext: {
        inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false,
        disabled: false, readOnly: false, required: false, ancestorRoles: [],
        ancestorClasses: [], tabIndex: 0,
      },
      valueBefore: null, valueAfter: null,
      checkedBefore: null, checkedAfter: null,
      clientX: 1, clientY: 1, key: null, code: null,
      shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
      scrollDeltaY: null, scrollDeltaX: null, pageUrl: 'http://t/', pageTitle: 'T',
    } as any;
  }
  let seq = 0;

  it('gated enter triggers Hover discovery; mousemoves are not member events', () => {
    const runtime = createRuntime([hoverDefinition], { onEmit: () => {} });
    const enter = observed('mouseenter', 'evt-1');
    runtime.process(enter);
    runtime.process(observed('mousemove', 'evt-2'));
    runtime.process(observed('mousemove', 'evt-3'));
    runtime.process(observed('mousemove', 'evt-4'));
    const interactions = runtime.flush();
    const hover = interactions.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    const members = (hover!.memberEvents ?? []).map((m) => m.eventType);
    expect(members).not.toContain('mousemove');
  });

  it('subsequent mouseenters ARE member events (pointer-path facts)', () => {
    const runtime = createRuntime([hoverDefinition], { onEmit: () => {} });
    runtime.process(observed('mouseenter', 'evt-1'));
    runtime.process(observed('mouseenter', 'evt-2'));
    runtime.process(observed('mouseenter', 'evt-3'));
    const interactions = runtime.flush();
    const hover = interactions.find((i) => i.type === 'Hover');
    expect(hover).toBeDefined();
    const enterIds = (hover!.memberEvents ?? [])
      .filter((m) => m.eventType === 'mouseenter')
      .map((m) => m.eventId);
    expect(enterIds).toContain('evt-2');
    expect(enterIds).toContain('evt-3');
  });

  it('MAX_POINTER_PATH_FACTS = 20, drop-oldest', () => {
    const runtime = createRuntime([hoverDefinition], { onEmit: () => {} });
    runtime.process(observed('mouseenter', 'evt-1'));
    for (let i = 2; i <= 30; i++) {
      runtime.process(observed('mouseenter', `evt-${i}`));
    }
    const interactions = runtime.flush();
    const hover = interactions.find((i) => i.type === 'Hover');
    const enters = (hover!.memberEvents ?? []).filter((m) => m.eventType === 'mouseenter');
    expect(enters.length).toBe(20);
    expect(enters[0].eventId).toBe('evt-11');
    // Spec §5.1.3 "count recorded": dropped facts are counted, never silent.
    expect(hover!.metadata.pointerPathDropped).toBe(10);
  });
});

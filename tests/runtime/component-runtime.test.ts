/**
 * Unit Tests: Component Runtime
 *
 * Tests the lifecycle management engine.
 *
 * Architecture: `.drytis/specs/m0a-architecture-validation.md` §2.2 Stage 2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import type {
  ComponentDefinition,
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Test Definitions ─────────────────────────────────────────────────

/**
 * A simple immediate-completion definition for testing.
 * Triggers on click, completes immediately.
 */
function makeImmediateDef(
  type: any,
  priority: number,
  triggerTypes: string[],
): ComponentDefinition {
  return {
    type,
    priority,
    triggerEventTypes: new Set(triggerTypes),
    detectTrigger() {
      return { type } as any;
    },
    isInScope() {
      return false; // immediate completion
    },
    handleEvent() {
      return { endState: 'completed' as const };
    },
    shouldCancelOnOutside() {
      return false;
    },
    buildResult(ctx) {
      return { metadata: { targetName: ctx.trigger.accessibleName } };
    },
  };
}

/**
 * A lifecycle definition that starts on focus and completes on blur.
 */
function makeLifecycleDef(
  type: any,
  priority: number,
): ComponentDefinition {
  return {
    type,
    priority,
    triggerEventTypes: new Set(['focus']),
    detectTrigger(event) {
      if (event.eventType === 'focus') return { type } as any;
      return null;
    },
    isInScope(event, ctx) {
      // In scope if same element
      return event.target.stableId === ctx.trigger.stableId;
    },
    handleEvent(event) {
      if (event.eventType === 'blur') {
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside(event, ctx) {
      // If user clicks a different element, abandon
      if (event.eventType === 'click' && event.target.stableId !== ctx.trigger.stableId) {
        return true;
      }
      return false;
    },
    buildResult(ctx) {
      return {
        metadata: {
          targetName: ctx.trigger.accessibleName,
          valueAfter: ctx.triggerEvent.valueAfter,
        },
      };
    },
  };
}

describe('Component Runtime', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  function setup(defs: ComponentDefinition[], initialId?: number) {
    emitted = [];
    const config: RuntimeConfig = {
      onEmit: (i) => emitted.push(i),
      ...(initialId !== undefined ? { initialInteractionId: initialId } : {}),
    };
    runtime = createRuntime(defs, config);
  }

  beforeEach(() => {
    emitted = [];
  });

  // ── Basic Processing ─────────────────────────────────────────────

  it('processes a click event through a click definition', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    const event = makeObservedEvent({
      eventId: 'e1',
      eventType: 'click',
      target: { accessibleName: 'Login', tag: 'BUTTON', stableId: 'login-btn' } as any,
    });

    const result = runtime.process(event);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('Click');
    expect(result[0].endState).toBe('completed');
    expect(result[0].metadata.targetName).toBe('Login');
  });

  it('emits to the onEmit callback', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    runtime.process(
      makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: { accessibleName: 'Save', tag: 'BUTTON', stableId: 'save' } as any,
      }),
    );

    expect(emitted.length).toBe(1);
    expect(emitted[0].type).toBe('Click');
  });

  // ── Event Dedup ─────────────────────────────────────────────────

  it('skips duplicate events by eventId', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    const event = makeObservedEvent({
      eventId: 'dup-1',
      eventType: 'click',
      target: { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'b1' } as any,
    });

    const r1 = runtime.process(event);
    const r2 = runtime.process(event); // same eventId
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(0);
  });

  // ── Lifecycle Management ────────────────────────────────────────

  it('manages a focus → blur lifecycle', () => {
    const textDef = makeLifecycleDef('TextEntry', 50);
    setup([textDef]);

    const focusEvent = makeObservedEvent({
      eventId: 'f1',
      eventType: 'focus',
      target: { accessibleName: 'Username', tag: 'INPUT', stableId: 'username' } as any,
    });

    const blurEvent = makeObservedEvent({
      eventId: 'b1',
      eventType: 'blur',
      target: { accessibleName: 'Username', tag: 'INPUT', stableId: 'username' } as any,
    });

    const r1 = runtime.process(focusEvent);
    expect(r1.length).toBe(0); // focus starts lifecycle, no emission yet
    expect(runtime.activeCount).toBe(1);

    const r2 = runtime.process(blurEvent);
    expect(r2.length).toBe(1);
    expect(r2[0].type).toBe('TextEntry');
    expect(r2[0].endState).toBe('completed');
    expect(runtime.activeCount).toBe(0);
  });

  it('abandons a lifecycle when user clicks elsewhere', () => {
    const textDef = makeLifecycleDef('TextEntry', 50);
    setup([textDef]);

    runtime.process(
      makeObservedEvent({
        eventId: 'f1',
        eventType: 'focus',
        target: { accessibleName: 'Search', tag: 'INPUT', stableId: 'search' } as any,
      }),
    );
    expect(runtime.activeCount).toBe(1);

    runtime.process(
      makeObservedEvent({
        eventId: 'c1',
        eventType: 'click',
        target: { accessibleName: 'Login', tag: 'BUTTON', stableId: 'login' } as any,
      }),
    );
    // TextEntry was abandoned (click elsewhere).
    // Capture guarantee v2: the click also falls through to the Unclassified
    // fallback since no Click definition is registered in this test.
    expect(emitted.length).toBe(2);
    expect(emitted[0].endState).toBe('abandoned');
    expect(runtime.activeCount).toBe(0);
  });

  // ── Priority Ordering ───────────────────────────────────────────

  it('discovers higher-priority definitions first', () => {
    const highPriority = makeImmediateDef('DatePicker', 10, ['click']);
    const lowPriority = makeImmediateDef('Click', 180, ['click']);
    setup([lowPriority, highPriority]);

    const event = makeObservedEvent({
      eventId: 'e1',
      eventType: 'click',
      target: { accessibleName: 'Date', tag: 'INPUT', stableId: 'date' } as any,
    });

    const result = runtime.process(event);
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('DatePicker'); // higher priority won
  });

  // ── Flush ───────────────────────────────────────────────────────

  it('flushes active components as interrupted', () => {
    const textDef = makeLifecycleDef('TextEntry', 50);
    setup([textDef]);

    runtime.process(
      makeObservedEvent({
        eventId: 'f1',
        eventType: 'focus',
        target: { accessibleName: 'Name', tag: 'INPUT', stableId: 'name' } as any,
      }),
    );
    expect(runtime.activeCount).toBe(1);

    const flushed = runtime.flush();
    expect(flushed.length).toBe(1);
    expect(flushed[0].endState).toBe('interrupted');
    expect(runtime.activeCount).toBe(0);
  });

  // ── Dedup (temporal) ────────────────────────────────────────────

  it('suppresses duplicate interactions within the dedup window', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    const target = { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'btn1' } as any;

    const e1 = makeObservedEvent({ eventId: 'e1', eventType: 'click', target, timestamp: 1000 });
    const e2 = makeObservedEvent({ eventId: 'e2', eventType: 'click', target, timestamp: 1500 });

    const r1 = runtime.process(e1);
    const r2 = runtime.process(e2);
    expect(r1.length).toBe(1); // first emitted
    expect(r2.length).toBe(0); // second suppressed by dedup
  });

  it('allows duplicate interactions outside the dedup window', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    const target = { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'btn1' } as any;

    const e1 = makeObservedEvent({ eventId: 'e1', eventType: 'click', target, timestamp: 1000 });
    const e2 = makeObservedEvent({ eventId: 'e2', eventType: 'click', target, timestamp: 5000 });

    const r1 = runtime.process(e1);
    const r2 = runtime.process(e2);
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(1); // outside window, emitted
  });

  // ── Snapshot / Restore ──────────────────────────────────────────

  it('snapshots and restores state', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef], 5);

    runtime.process(
      makeObservedEvent({
        eventId: 'e1',
        eventType: 'click',
        target: { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'b' } as any,
        timestamp: 1000,
      }),
    );

    const snap = runtime.snapshot();
    expect(snap.interactionCounter).toBe(6); // 5 + 1
    expect(snap.seenEventIds).toContain('e1');

    // Restore into a new runtime
    setup([clickDef], 0);
    runtime.restore(snap);
    expect(runtime.snapshot().interactionCounter).toBe(6);
    expect(runtime.snapshot().seenEventIds).toContain('e1');
  });

  // ── Navigation Flush ────────────────────────────────────────────

  it('flushes on navigation event', () => {
    const textDef = makeLifecycleDef('TextEntry', 50);
    setup([textDef]);

    runtime.process(
      makeObservedEvent({
        eventId: 'f1',
        eventType: 'focus',
        target: { accessibleName: 'Name', tag: 'INPUT', stableId: 'name' } as any,
      }),
    );
    expect(runtime.activeCount).toBe(1);

    const navEvent = makeObservedEvent({
      eventId: 'nav1',
      eventType: 'navigation' as any,
      target: { accessibleName: '', tag: 'HTML', stableId: null } as any,
    });

    const result = runtime.process(navEvent);
    // Flush interrupts the TextEntry. No Navigation definition is registered
    // in this test, so only the interrupted TextEntry is emitted.
    expect(result.length).toBe(1);
    expect(result[0].endState).toBe('interrupted');
    expect(runtime.activeCount).toBe(0);
  });

  // ── Error Isolation ─────────────────────────────────────────────

  it('isolates definition errors and continues processing', () => {
    const throwingDef: ComponentDefinition = {
      type: 'Click',
      priority: 180,
      triggerEventTypes: new Set(['click']),
      detectTrigger() {
        throw new Error('detectTrigger boom');
      },
      isInScope() { return false; },
      handleEvent() { return null; },
      shouldCancelOnOutside() { return false; },
      buildResult() { return { metadata: {} }; },
    };
    setup([throwingDef]);

    const event = makeObservedEvent({
      eventId: 'e1',
      eventType: 'click',
      target: { accessibleName: 'Btn', tag: 'BUTTON', stableId: 'b' } as any,
    });

    // Should NOT throw
    const result = runtime.process(event);
    // Capture guarantee v2: even when detectTrigger throws, a discrete
    // click is preserved as Unclassified instead of silently dropped.
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('Unclassified');
    expect(runtime.errors.length).toBeGreaterThan(0);
    expect(runtime.errors[0]).toContain('detectTrigger');
  });

  // ── Seen Events Cap ─────────────────────────────────────────────

  it('halves seenEventIds when cap is exceeded', () => {
    const clickDef = makeImmediateDef('Click', 180, ['click']);
    setup([clickDef]);

    // Process 501 events with unique IDs
    for (let i = 0; i < 501; i++) {
      runtime.process(
        makeObservedEvent({
          eventId: `e-${i}`,
          eventType: 'focus', // won't trigger click def
          target: { accessibleName: 'X', tag: 'DIV', stableId: `d${i}` } as any,
        }),
      );
    }

    // The seenEventIds set should have been halved
    const snap = runtime.snapshot();
    expect(snap.seenEventIds.length).toBeLessThanOrEqual(500);
  });
});

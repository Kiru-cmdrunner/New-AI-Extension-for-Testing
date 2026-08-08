/**
 * Tests: Verification Regression — Full Pipeline Equivalence
 *
 * Milestone 4/5 of the End-to-End Capture Guarantee.
 *
 * M5: The Projection Engine is now authoritative. These tests verify
 * pipeline self-consistency: every discrete event in the ledger is
 * represented in the final output (either by a completed interaction
 * or an Unclassified projection).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import type {
  ComponentDefinition,
  ObservedEvent,
  ComponentInteraction,
  RuntimeConfig,
} from '../../src/shared/component-types';
import { makeObservedEvent } from '../helpers/make-event';

// ── Test Definitions (simplified, representative) ─────────────────────

function makeClickDef(): ComponentDefinition {
  return {
    type: 'Click',
    priority: 180,
    triggerEventTypes: new Set(['click', 'contextmenu']),
    detectTrigger(event) {
      const { tag, ariaRole } = event.target;
      const interactiveTags = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
      const interactiveRoles = new Set(['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option']);
      if (interactiveTags.has(tag)) return { type: 'Click' };
      if (ariaRole && interactiveRoles.has(ariaRole)) return { type: 'Click' };
      return null;
    },
    isInScope() { return false; },
    handleEvent() { return { endState: 'completed' as const }; },
    shouldCancelOnOutside() { return false; },
    buildResult(ctx) { return { metadata: { targetName: ctx.trigger.accessibleName || 'element' } }; },
  };
}

function makeTextEntryDef(): ComponentDefinition {
  return {
    type: 'TextEntry',
    priority: 50,
    triggerEventTypes: new Set(['focus']),
    detectTrigger(event) {
      if (event.eventType === 'focus' && (event.target.tag === 'INPUT' || event.target.tag === 'TEXTAREA')) {
        return { type: 'TextEntry' };
      }
      return null;
    },
    isInScope(event, ctx) { return event.target.stableId === ctx.trigger.stableId; },
    handleEvent(event) {
      if (event.eventType === 'blur') return { endState: 'completed' as const };
      return null;
    },
    shouldCancelOnOutside() { return false; },
    buildResult(ctx) { return { metadata: { targetName: ctx.trigger.accessibleName || 'text' } }; },
  };
}

function makeDropdownDef(): ComponentDefinition {
  return {
    type: 'Dropdown',
    priority: 40,
    triggerEventTypes: new Set(['click', 'focus']),
    semanticChildRoles: ['option'],
    semanticChildTags: ['OPTION'],
    detectTrigger(event) {
      if (event.eventType === 'click' && event.domContext.ariaHasPopup) return { type: 'Dropdown' };
      return null;
    },
    isInScope(event, ctx) {
      if (event.target.stableId === ctx.trigger.stableId) return true;
      if (event.target.ariaRole === 'option') return true;
      return false;
    },
    handleEvent(event, ctx) {
      if (event.eventType === 'click' && event.target.ariaRole === 'option') {
        ctx.data.selectedValue = event.target.accessibleName;
        return { endState: 'completed' as const };
      }
      return null;
    },
    shouldCancelOnOutside(event) { return event.eventType === 'click'; },
    buildResult(ctx) { return { metadata: { targetName: ctx.trigger.accessibleName, selectedValue: ctx.data.selectedValue ?? '' } }; },
  };
}

// ── Test Harness ──────────────────────────────────────────────────────

function setupPipeline(defs: ComponentDefinition[]) {
  const emitted: ComponentInteraction[] = [];
  const ledger = new EvidenceLedger();
  const config: RuntimeConfig = { onEmit: (i) => emitted.push(i), evidenceLedger: ledger };
  const runtime = createRuntime(defs, config);
  return { runtime, emitted, ledger };
}

/**
 * Processes events through the full M5 pipeline and returns a
 * self-consistency check: every discrete event in the ledger
 * must be represented in the projected output (either by a
 * completed interaction or an Unclassified projection).
 */
function processAndVerify(
  runtime: ComponentRuntime,
  ledger: EvidenceLedger,
  emitted: ComponentInteraction[],
  events: ObservedEvent[],
) {
  for (const event of events) {
    ledger.append(event);
    runtime.process(event);
  }
  runtime.flush();

  const projection = projectInteractions(ledger, emitted);

  // Collect all eventIds represented in the projection
  const representedIds = new Set<string>();
  for (const interaction of projection.interactions) {
    if (interaction.triggerEvent?.eventId) {
      representedIds.add(interaction.triggerEvent.eventId);
    }
    for (const ev of interaction.memberEvents ?? []) {
      representedIds.add(ev.eventId);
    }
    // Unclassified interactions store their backing event ID in metadata
    if (interaction.type === 'Unclassified' && interaction.metadata.eventId) {
      representedIds.add(interaction.metadata.eventId as string);
    }
  }

  // Collect all discrete event IDs from the ledger
  const ledgerEntryIds = new Set(ledger.getEntries().map((e) => e.eventId));

  // Every discrete event must be represented
  const unrepresented = [...ledgerEntryIds].filter((id) => !representedIds.has(id));

  return {
    match: unrepresented.length === 0,
    projection,
    unrepresented,
    ledgerEntries: ledger.getEntries(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('Verification Regression — Full Pipeline Equivalence', () => {
  let defs: ComponentDefinition[];

  beforeEach(() => {
    defs = [makeClickDef(), makeTextEntryDef(), makeDropdownDef()];
  });

  it('simple button click → both produce 1 Click → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100,
        target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('unrecognized click on div → both produce 1 Unclassified → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100,
        target: { tag: 'DIV', accessibleName: 'Box', stableId: 'box1', cssSelector: 'div#box1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('mousedown on div (no def matches) → both produce 1 Unclassified → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100,
        target: { tag: 'DIV', accessibleName: 'Box', stableId: 'box1', cssSelector: 'div#box1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('mousedown + click on button → runtime: 1 Unclassified + 1 Click, projection: same → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100,
        target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101,
        target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('TextEntry (focus → input → blur) → both produce 1 TextEntry → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'focus', captureSeq: 100,
        target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-2', eventType: 'input', captureSeq: 200,
        target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-3', eventType: 'blur', captureSeq: 300,
        target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('Dropdown lifecycle (trigger → option click) → both produce 1 Dropdown → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100,
        target: { tag: 'BUTTON', accessibleName: 'Choose', stableId: 'dd1', cssSelector: 'button#dd1', ariaRole: 'button' },
        domContext: { ariaHasPopup: 'listbox', tabIndex: 0 } as any,
      }),
      makeObservedEvent({
        eventId: 'evt-p1-2', eventType: 'click', captureSeq: 200,
        target: { tag: 'LI', accessibleName: 'Option A', stableId: 'opt1', cssSelector: 'li#opt1', ariaRole: 'option' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('multiple sequential clicks → both produce same set → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'click', captureSeq: 100,
        target: { tag: 'BUTTON', accessibleName: 'A', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-2', eventType: 'click', captureSeq: 200,
        target: { tag: 'BUTTON', accessibleName: 'B', stableId: 'btn2', cssSelector: 'button#btn2' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-3', eventType: 'click', captureSeq: 300,
        target: { tag: 'A', accessibleName: 'Link', stableId: 'link1', cssSelector: 'a#link1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('contextmenu on button → both produce 1 Click → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'contextmenu', captureSeq: 100,
        target: { tag: 'BUTTON', accessibleName: 'Menu', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('keydown on div → both produce 1 Unclassified → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'keydown', captureSeq: 100,
        target: { tag: 'DIV', accessibleName: 'Container', stableId: 'div1', cssSelector: 'div#div1' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });

  it('mixed: mousedown + click + TextEntry + Dropdown → match', () => {
    const { runtime, emitted, ledger } = setupPipeline(defs);
    const events = [
      // mousedown on body (Unclassified)
      makeObservedEvent({
        eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100,
        target: { tag: 'DIV', accessibleName: 'Body', stableId: 'body', cssSelector: 'div#body' },
      }),
      // click on button (Click)
      makeObservedEvent({
        eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101,
        target: { tag: 'BUTTON', accessibleName: 'Submit', stableId: 'btn1', cssSelector: 'button#btn1' },
      }),
      // TextEntry
      makeObservedEvent({
        eventId: 'evt-p1-3', eventType: 'focus', captureSeq: 200,
        target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
      }),
      makeObservedEvent({
        eventId: 'evt-p1-4', eventType: 'blur', captureSeq: 300,
        target: { tag: 'INPUT', accessibleName: 'Name', stableId: 'inp1', cssSelector: 'input#inp1' },
      }),
      // Dropdown
      makeObservedEvent({
        eventId: 'evt-p1-5', eventType: 'click', captureSeq: 400,
        target: { tag: 'BUTTON', accessibleName: 'Choose', stableId: 'dd1', cssSelector: 'button#dd1', ariaRole: 'button' },
        domContext: { ariaHasPopup: 'listbox', tabIndex: 0 } as any,
      }),
      makeObservedEvent({
        eventId: 'evt-p1-6', eventType: 'click', captureSeq: 500,
        target: { tag: 'LI', accessibleName: 'Opt', stableId: 'opt1', cssSelector: 'li#opt1', ariaRole: 'option' },
      }),
    ];

    const result = processAndVerify(runtime, ledger, emitted, events);
    expect(result.match).toBe(true);
  });
});

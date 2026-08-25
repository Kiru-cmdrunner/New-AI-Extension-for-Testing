/**
 * Tests: Structural fixes from RCA2 (2026-08-20) — no-timing-rule versions.
 *
 * S2  — icon-class naming tier in bestName/iconNameFromClasses
 * S1' — projection pairing of adjacent mousedown→click on the same element
 * S3' — dropdown structural completion gating (calendar-cell exclusion,
 *       containment-proof completion, parked provisional selection,
 *       displaced end on next different-target discrete event)
 *
 * Spec: .drytis/specs/structural-fixes-rca2-2026-08-20.md
 * RCA:  .drytis/notes/rca-adanione-custom-controls-2026-08-20.md (Correction)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EvidenceLedger } from '../../src/runtime/evidence-ledger';
import { projectInteractions } from '../../src/runtime/projection-engine';
import { makeObservedEvent } from '../helpers/make-event';
import { dropdownDefinition } from '../../src/definitions/dropdown';
import { bestName, iconNameFromClasses, hasDateCellName } from '../../src/definitions/patterns';
import { resolveMeaning } from '../../src/enrichment/meaning-resolver';
import type {
  ComponentContext,
  ObservedEvent,
  ComponentInteraction,
  DomContext,
} from '../../src/shared/component-types';
import type { ComponentDetectionResult } from '../../src/enrichment/component-types';

// ── helpers ─────────────────────────────────────────────────────────────

/** Complete DomContext fixture (makeObservedEvent defaults; explicit for type-safety). */
const FULL_DOM_CONTEXT: DomContext = {
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
};

function makeCtx(trigger: ObservedEvent): ComponentContext {
  return {
    type: 'Dropdown',
    state: 'active',
    trigger: trigger.target,
    triggerEvent: trigger,
    memberEvents: [trigger],
    scopeKeys: new Set(),
    startTime: trigger.timestamp,
    endTime: 0,
    data: {},
  };
}

function optionClick(name: string, opts: {
  className?: string;
  ancestorRoles?: string[];
  ancestorClasses?: string[];
  ariaHasPopup?: string | null;
} = {}): ObservedEvent {
  return makeObservedEvent({
    eventId: `evt-p1-opt-${Math.floor(Math.random() * 100000)}`,
    eventType: 'click',
    captureSeq: Math.floor(Math.random() * 100000),
    target: {
      tag: 'DIV',
      accessibleName: name,
      ariaRole: 'option',
      className: opts.className ?? 'select-option',
    },
    domContext: {
      ...FULL_DOM_CONTEXT,
      ancestorRoles: opts.ancestorRoles ?? [],
      ancestorClasses: opts.ancestorClasses ?? [],
      ariaHasPopup: opts.ariaHasPopup ?? null,
    },
  });
}

// ── S2: icon naming tier ────────────────────────────────────────────────

describe('S2 — iconNameFromClasses', () => {
  it('icon-plus → "add icon" (semantic override, matches enrichment layer)', () => {
    expect(iconNameFromClasses('icon-plus')).toBe('add icon');
  });

  it('fa-plus → "add icon" (semantic override)', () => {
    expect(iconNameFromClasses('fa fa-plus')).toBe('add icon');
  });

  it('mdi-chevron-down → "chevron-down icon"', () => {
    expect(iconNameFromClasses('mdi mdi-chevron-down')).toBe('chevron-down icon');
  });

  it('bi-x → "close icon" (semantic override)', () => {
    expect(iconNameFromClasses('bi bi-x')).toBe('close icon');
  });

  it('arrow-down-icon (trailing form) → "arrow-down icon"', () => {
    expect(iconNameFromClasses('adani arrow-down-icon')).toBe('arrow-down icon');
  });

  it('no icon tokens → null', () => {
    expect(iconNameFromClasses('btn primary large')).toBeNull();
    expect(iconNameFromClasses(null)).toBeNull();
    expect(iconNameFromClasses('')).toBeNull();
  });

  it('does not match inside longer words (word boundaries)', () => {
    expect(iconNameFromClasses('harmonic-iconic')).toBeNull();
  });
});

describe('S2 — bestName icon tier', () => {
  it('accessibleName still wins over icon class', () => {
    expect(bestName('Submit', null, null, 'icon-plus')).toBe('Submit');
  });

  it('ariaLabel wins over icon class', () => {
    expect(bestName('', 'Add passenger', null, 'icon-plus')).toBe('Add passenger');
  });

  it('placeholder wins over icon class', () => {
    expect(bestName('', null, 'From', 'icon-plus')).toBe('From');
  });

  it('all empty + icon class → icon name instead of "element"', () => {
    expect(bestName('', null, null, 'icon-plus')).toBe('add icon');
  });

  it('all empty + no icon class → "element" unchanged', () => {
    expect(bestName('', null, null, null)).toBe('element');
  });
});

describe('S2 — meaning resolver icon preference', () => {
  it('icon-derived targetName yields to componentData.iconName when richer', () => {
    const interaction = {
      type: 'Click',
      metadata: { targetName: 'add icon' },
    } as unknown as ComponentInteraction;
    const detection = {
      componentType: 'IconButton',
      componentData: { iconName: 'add' },
    } as unknown as ComponentDetectionResult;
    expect(resolveMeaning(interaction, detection)).toBe('Click add button');
  });

  it('real targetName never replaced by icon name', () => {
    const interaction = {
      type: 'Click',
      metadata: { targetName: 'Add Adult' },
    } as unknown as ComponentInteraction;
    const detection = {
      componentType: 'Generic',
      componentData: { iconName: 'add' },
    } as unknown as ComponentDetectionResult;
    expect(resolveMeaning(interaction, detection)).toBe('Click "Add Adult"');
  });
});

// ── S1': projection pairing ────────────────────────────────────────────

describe("S1' — projection pairing (structural, no timing)", () => {
  let ledger: EvidenceLedger;

  beforeEach(() => {
    ledger = new EvidenceLedger();
  });

  it('adjacent mousedown→click same element → ONE card with both physical events', () => {
    const identity = {
      accessibleName: 'Premium Economy', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', className: 'pax-class-row', name: null, stableId: 'row-pe',
      testId: null, dataCy: null, dataQa: null, cssSelector: 'div.row-pe', xPath: '',
      inIframe: false, shadowDom: false, href: null, elementId: '', inputType: null,
    };
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100, target: identity,
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101, target: identity,
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');
    ledger.setDisposition('evt-p1-2', 'unclaimed');

    const result = projectInteractions(ledger, []);

    expect(result.projectedUnclassified).toHaveLength(1);
    const card = result.projectedUnclassified[0];
    expect(card.metadata.physicalEventType).toBe('click');
    expect(card.metadata.physicalEvents).toEqual(['mousedown', 'click']);
    expect(card.metadata.pairedAtProjection).toBe(true);
    expect(result.pairedEventIds.has('evt-p1-1')).toBe(true);
  });

  it('non-adjacent mousedown…click (intervening entry) → TWO cards', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100,
      target: { tag: 'DIV', stableId: 'a', cssSelector: 'div#a', accessibleName: 'A' },
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'keydown', captureSeq: 150,
      target: { tag: 'INPUT', stableId: 'b', cssSelector: 'input#b', accessibleName: 'B' },
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-3', eventType: 'click', captureSeq: 200,
      target: { tag: 'DIV', stableId: 'a', cssSelector: 'div#a', accessibleName: 'A' },
    }));
    for (const id of ['evt-p1-1', 'evt-p1-2', 'evt-p1-3']) {
      ledger.setDisposition(id, 'unclaimed');
    }

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(3);
  });

  it('adjacent but DIFFERENT element → TWO cards', () => {
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100,
      target: { tag: 'DIV', stableId: 'a', cssSelector: 'div#a', accessibleName: 'A' },
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101,
      target: { tag: 'DIV', stableId: 'b', cssSelector: 'div#b', accessibleName: 'B' },
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');
    ledger.setDisposition('evt-p1-2', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(2);
  });

  it('contextmenu never pairs', () => {
    const identity = { tag: 'A', stableId: 'link', cssSelector: 'a#link', accessibleName: 'Link' };
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100, target: identity,
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'contextmenu', captureSeq: 101, target: identity,
    }));
    ledger.setDisposition('evt-p1-1', 'unclaimed');
    ledger.setDisposition('evt-p1-2', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(2);
    expect(result.pairedEventIds.size).toBe(0);
  });

  it('claimed click entry never pairs (covered events excluded first)', () => {
    const identity = { tag: 'BUTTON', stableId: 'btn', cssSelector: 'button#btn', accessibleName: 'Go' };
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-1', eventType: 'mousedown', captureSeq: 100, target: identity,
    }));
    ledger.append(makeObservedEvent({
      eventId: 'evt-p1-2', eventType: 'click', captureSeq: 101, target: identity,
    }));
    // click claimed by a recognized interaction; mousedown also claimed (member)
    ledger.setDisposition('evt-p1-1', 'claimed', 'int-1', 'Click');
    ledger.setDisposition('evt-p1-2', 'claimed', 'int-1', 'Click');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(0);
  });

  it('page boundary prevents pairing (different pageId)', () => {
    // pageId is embedded in the eventId (evt-{pageId}-{n}) — the ledger
    // extracts it from there, so identical identity objects on different
    // pages (evt-pA / evt-pB) must NOT pair.
    const mk = () => ({
      accessibleName: 'X', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
      placeholder: null, tag: 'DIV', className: null, name: null, stableId: 'x',
      testId: null, dataCy: null, dataQa: null, cssSelector: 'div#x', xPath: '',
      inIframe: false, shadowDom: false, href: null, elementId: '', inputType: null,
    });
    ledger.append(makeObservedEvent({
      eventId: `evt-pA-1`, eventType: 'mousedown', captureSeq: 100, target: mk(),
    }));
    ledger.append(makeObservedEvent({
      eventId: `evt-pB-1`, eventType: 'click', captureSeq: 101, target: mk(),
    }));
    ledger.setDisposition('evt-pA-1', 'unclaimed');
    ledger.setDisposition('evt-pB-1', 'unclaimed');

    const result = projectInteractions(ledger, []);
    expect(result.projectedUnclassified).toHaveLength(2);
  });
});

// ── S3': dropdown structural completion gating ──────────────────────────

describe('S3′ — date-cell name shape (framework-agnostic calendar exclusion)', () => {
  it('matches the W3C date-cell naming shape', () => {
    expect(hasDateCellName('Choose Saturday, September 5th, 2026', null)).toBe(true);
    expect(hasDateCellName('Choose Tuesday, September 29th, 2026', null)).toBe(true);
    expect(hasDateCellName('Friday, 4 September 2026', null)).toBe(false); // different dialect — not the APG shape
  });

  it('does not match ordinary option names', () => {
    expect(hasDateCellName('Premium Economy', null)).toBe(false);
    expect(hasDateCellName('Round Trip', null)).toBe(false);
    expect(hasDateCellName('', null)).toBe(false);
    expect(hasDateCellName(null, null)).toBe(false);
  });

  it('falls back to aria-label when accessible name empty', () => {
    expect(hasDateCellName('', 'Choose Saturday, September 5th, 2026')).toBe(true);
  });
});

describe("S3' — dropdown calendar-cell exclusion", () => {
  it('calendar-cell option click does NOT complete the lifecycle (class shape)', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    expect(dropdownDefinition.detectTrigger(trigger)).not.toBeNull();
    const ctx = makeCtx(trigger);

    const calCell = makeObservedEvent({
      eventId: 'evt-p1-cal', eventType: 'click', captureSeq: 20,
      target: {
        tag: 'DIV', accessibleName: 'Choose Saturday, September 5th, 2026',
        ariaRole: 'option', className: 'calendar-day',
      },
    });

    expect(dropdownDefinition.handleEvent(calCell, ctx)).toBeNull();
    expect(ctx.data.selectedValue).toBeUndefined();
  });

  it('date-cell NAMED click without date classes does NOT complete (name shape)', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);

    const namedCell = makeObservedEvent({
      eventId: 'evt-p1-cal2', eventType: 'click', captureSeq: 20,
      target: {
        tag: 'DIV', accessibleName: 'Choose Saturday, September 5th, 2026',
        ariaRole: 'option', className: 'cal-cell', // unknown class family
      },
    });

    expect(dropdownDefinition.handleEvent(namedCell, ctx)).toBeNull();
    expect(ctx.data.selectedValue).toBeUndefined();
    expect(ctx.data.pendingOptionClick).toBeUndefined(); // excluded, not parked
  });
});

describe("S3' — containment-proven completion still works", () => {
  it('option inside dropdown surface (non-calendar) completes with selection', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'oxd-select-text', accessibleName: 'Location' },
    });
    const ctx = makeCtx(trigger);

    const opt = optionClick('New York', {
      className: 'oxd-select-option',
      ancestorClasses: ['oxd-select-dropdown'],
    });

    const completion = dropdownDefinition.handleEvent(opt, ctx);
    expect(completion).toEqual({ endState: 'completed' });
    expect(ctx.data.selectedValue).toBe('New York');
    expect(ctx.data.selectionConfirmed).toBe(true);
  });

  it('option with surfaceRole ancestry (aria-haspopup listbox) completes', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'BUTTON', accessibleName: 'Sort' },
      domContext: { ...FULL_DOM_CONTEXT, ariaHasPopup: 'listbox' },
    });
    const ctx = makeCtx(trigger);

    const opt = optionClick('Descending', {
      className: '',
      ancestorRoles: ['listbox'],
    });

    const completion = dropdownDefinition.handleEvent(opt, ctx);
    expect(completion).toEqual({ endState: 'completed' });
  });

  it('native SELECT change completes unchanged', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'focus', captureSeq: 10,
      target: { tag: 'SELECT', accessibleName: 'Country' },
    });
    const ctx = makeCtx(trigger);

    const change = makeObservedEvent({
      eventId: 'evt-p1-ch', eventType: 'change', captureSeq: 20,
      valueAfter: 'IN',
      target: { tag: 'SELECT', accessibleName: 'Country' },
    });

    // P11: a native-SELECT change is now PROVISIONAL (keyboard driving fires
    // a trusted change per ArrowDown); completion is the structural end —
    // blur of the select. Without the blur the lifecycle stays open.
    const blur = makeObservedEvent({
      eventId: 'evt-p1-bl', eventType: 'blur', captureSeq: 30,
      target: { tag: 'SELECT', accessibleName: 'Country' },
    });

    const provisional = dropdownDefinition.handleEvent(change, ctx);
    expect(provisional).toBeNull();
    const completion = dropdownDefinition.handleEvent(blur, ctx);
    expect(completion).toEqual({ endState: 'completed' });
    expect(ctx.data.selectedValue).toBe('IN');
  });
});

describe("S3' — parked provisional selection + structural displaced end", () => {
  it('option click WITHOUT containment proof parks, does not complete', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);

    const bare = optionClick('Premium Economy', { className: '' });

    expect(dropdownDefinition.handleEvent(bare, ctx)).toBeNull();
    expect(ctx.data.pendingOptionClick).toEqual({ eventId: bare.eventId, name: 'Premium Economy' });
    expect(ctx.data.selectedValue).toBeUndefined();
  });

  it('next different-target discrete event ends lifecycle (shouldCancelOnOutside)', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);

    const bare = optionClick('Premium Economy', { className: '' });
    dropdownDefinition.handleEvent(bare, ctx);

    const elsewhere = makeObservedEvent({
      eventId: 'evt-p1-else', eventType: 'click', captureSeq: 30,
      target: { tag: 'INPUT', stableId: 'from', accessibleName: 'From' },
    });

    expect(dropdownDefinition.shouldCancelOnOutside(elsewhere, ctx)).toBe(true);
  });

  it('same-target click after parking does NOT end the lifecycle', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);

    const bare = optionClick('Premium Economy', { className: '' });
    dropdownDefinition.handleEvent(bare, ctx);

    const sameAgain = makeObservedEvent({
      eventId: 'evt-p1-same', eventType: 'click', captureSeq: 30,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });

    expect(dropdownDefinition.shouldCancelOnOutside(sameAgain, ctx)).toBe(false);
  });

  it('buildResult carries honest unconfirmed-selection metadata', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);
    const bare = optionClick('Premium Economy', { className: '' });
    dropdownDefinition.handleEvent(bare, ctx);

    const result = dropdownDefinition.buildResult(ctx, { endState: 'abandoned' });
    expect(result.metadata.provisionalSelection).toBe('Premium Economy');
    expect(result.metadata.selectionConfirmed).toBe(false);
    expect(result.metadata.selectedValue).toBe('');
  });

  it('buildResult on confirmed completion has NO unconfirmed markers', () => {
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'oxd-select-text', accessibleName: 'Location' },
    });
    const ctx = makeCtx(trigger);
    const opt = optionClick('New York', {
      className: 'oxd-select-option',
      ancestorClasses: ['oxd-select-dropdown'],
    });
    dropdownDefinition.handleEvent(opt, ctx);

    const result = dropdownDefinition.buildResult(ctx, { endState: 'completed' });
    expect(result.metadata.selectedValue).toBe('New York');
    // 7.4-B2b (dropdown-whyline-dead-path fix): confirmed completion now
    // WRITES selectionConfirmed=true (was undefined — the documented dead
    // path that gated the IR two-step CLICK and the panel why-line).
    expect(result.metadata.selectionConfirmed).toBe(true);
    expect(result.metadata.provisionalSelection).toBeUndefined();
  });

  it('displaced end fires before the stray date-cell could ever complete (AdaniOne sequence)', () => {
    // Exact AdaniOne shape: Economy opened; Premium Economy row (bare div)
    // parked; then ANY next action on another element (e.g. calendar cell)
    // ends the lifecycle — the calendar cell never becomes the selection.
    const trigger = makeObservedEvent({
      eventId: 'evt-p1-trg', eventType: 'click', captureSeq: 10,
      target: { tag: 'DIV', className: 'PaxAndClass-selectbox', accessibleName: '1Economy' },
    });
    const ctx = makeCtx(trigger);

    const pe = optionClick('Premium Economy', { className: '' });
    dropdownDefinition.handleEvent(pe, ctx);

    const dateCell = makeObservedEvent({
      eventId: 'evt-p1-date', eventType: 'click', captureSeq: 30,
      target: {
        tag: 'DIV', accessibleName: 'Choose Saturday, September 5th, 2026',
        ariaRole: 'option', className: 'calendar-day',
      },
    });

    // Runtime order: shouldCancelOnOutside is consulted (event out of scope)
    expect(dropdownDefinition.shouldCancelOnOutside(dateCell, ctx)).toBe(true);
    // And even if offered in-scope, the calendar-cell exclusion holds
    expect(dropdownDefinition.handleEvent(dateCell, ctx)).toBeNull();
    expect(ctx.data.selectedValue).toBeUndefined();
  });
});

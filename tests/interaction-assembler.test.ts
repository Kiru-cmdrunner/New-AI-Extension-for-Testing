/**
 * Interaction Assembler — unit tests
 *
 * Tests the transaction state machine for collapsing composite interactions
 * (dropdowns, date pickers, dialogs) into single business actions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  InteractionAssembler,
  hasOpenSurface,
  triggeredSurfaceOpen,
  isInsideSurface,
  classifyCompositeType,
  isDefinitiveSelection,
  resolveCollapsedType,
  extractSelectedValue,
  extractOpenerLabel,
  type BufferedSnapshot,
} from '../src/recorder/pipeline/interaction-assembler';
import type { InteractionSnapshot, ClassifyOutput } from '../src/shared/evidence-types';
import type { DeterministicState } from '../src/shared/architecture-types';
import type { SessionEvent } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIdentity(overrides?: Record<string, unknown>) {
  return {
    accessibleName: 'Test Element',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div.test',
    xPath: '//div',
    className: null,
    id: null,
    textContent: null,
    type: null,
    inIframe: false,
    shadowDom: false,
    iframeContext: undefined,
    elementId: 'elem-0001',
    ...overrides,
  };
}

function makeSnapshot(overrides?: Partial<InteractionSnapshot>): InteractionSnapshot {
  return {
    identity: makeIdentity(),
    primaryEvent: { type: 'click', timestamp: new Date().toISOString(), isTrusted: true },
    secondaryEvents: [],
    ancestorContext: {
      roles: [],
      containerClasses: [],
      hasCalendarAncestor: false,
      hasListboxAncestor: false,
      hasMenuAncestor: false,
      hasDialogAncestor: false,
    },
    ariaAttributes: {
      role: null,
      ariaLabel: null,
      ariaHasPopup: null,
      ariaSelected: null,
      ariaChecked: null,
      ariaPressed: null,
      ariaExpanded: null,
    },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeClassification(
  canonicalType: string = 'click',
  tier: 1 | 2 | 3 = 3,
): ClassifyOutput {
  return {
    classified: {
      canonicalType: canonicalType as never,
      actionId: 'act-0001',
      originalEvent: {} as never,
      classificationTier: tier,
      evidence: {
        ruleId: 'R16',
        ruleDescription: 'Fallback click',
        matchedSignals: [],
        tier,
      },
    },
    aiEligible: tier < 3,
  };
}

function makeDetState(overrides?: Partial<DeterministicState>): DeterministicState {
  return {
    currentUrl: 'https://example.com',
    pageTitle: 'Test Page',
    openDialogs: [],
    openDropdowns: [],
    activeForm: null,
    activeElement: null,
    ...overrides,
  };
}

// ── Pure function tests ────────────────────────────────────────────────

describe('hasOpenSurface', () => {
  it('returns false for null state', () => {
    expect(hasOpenSurface(null)).toBe(false);
  });

  it('returns false when no dropdowns or dialogs', () => {
    expect(hasOpenSurface(makeDetState())).toBe(false);
  });

  it('returns true when dropdowns are open', () => {
    expect(hasOpenSurface(makeDetState({
      openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Class', className: 'dropdown' }],
    }))).toBe(true);
  });

  it('returns true when dialogs are open', () => {
    expect(hasOpenSurface(makeDetState({
      openDialogs: [{ tag: 'DIV', role: 'dialog', accessibleName: 'Modal', className: 'modal' }],
    }))).toBe(true);
  });
});

describe('triggeredSurfaceOpen', () => {
  it('returns true when domMutations has childListChanges', () => {
    const snapshot = makeSnapshot({
      domMutations: { childListChanges: 2, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
    });
    expect(triggeredSurfaceOpen(snapshot)).toBe(true);
  });

  it('returns true for combobox role', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ ariaRole: 'combobox' }),
    });
    expect(triggeredSurfaceOpen(snapshot)).toBe(true);
  });

  it('returns true when ariaExpanded is "true"', () => {
    const snapshot = makeSnapshot({
      ariaAttributes: { role: null, ariaLabel: null, ariaHasPopup: null, ariaSelected: null, ariaChecked: null, ariaPressed: null, ariaExpanded: 'true' },
    });
    expect(triggeredSurfaceOpen(snapshot)).toBe(true);
  });

  it('returns false for plain click on a div', () => {
    const snapshot = makeSnapshot();
    expect(triggeredSurfaceOpen(snapshot)).toBe(false);
  });
});

describe('isInsideSurface', () => {
  it('returns true when hasListboxAncestor', () => {
    const snapshot = makeSnapshot({
      ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
    });
    expect(isInsideSurface(snapshot)).toBe(true);
  });

  it('returns true when hasCalendarAncestor', () => {
    const snapshot = makeSnapshot({
      ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: true, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: false },
    });
    expect(isInsideSurface(snapshot)).toBe(true);
  });

  it('returns true when hasDialogAncestor', () => {
    const snapshot = makeSnapshot({
      ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: true },
    });
    expect(isInsideSurface(snapshot)).toBe(true);
  });

  it('returns false when no surface ancestors', () => {
    const snapshot = makeSnapshot();
    expect(isInsideSurface(snapshot)).toBe(false);
  });
});

describe('classifyCompositeType', () => {
  it('classifies calendar context as datepicker', () => {
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: true, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: false },
      }),
      classification: makeClassification(),
    }];
    expect(classifyCompositeType(snapshots)).toBe('datepicker');
  });

  it('classifies dialog context as dialog', () => {
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: true },
      }),
      classification: makeClassification(),
    }];
    expect(classifyCompositeType(snapshots)).toBe('dialog');
  });

  it('classifies listbox with text input as autocomplete', () => {
    const snapshots: BufferedSnapshot[] = [
      { snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
      }), classification: makeClassification() },
      { snapshot: makeSnapshot({
        valueChange: { before: '', after: 'search term', inputType: 'text', isDateLike: false },
      }), classification: makeClassification('fill') },
    ];
    expect(classifyCompositeType(snapshots)).toBe('autocomplete');
  });

  it('classifies listbox without text input as dropdown', () => {
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
      }),
      classification: makeClassification(),
    }];
    expect(classifyCompositeType(snapshots)).toBe('dropdown');
  });

  it('returns generic for unknown context', () => {
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot(),
      classification: makeClassification(),
    }];
    expect(classifyCompositeType(snapshots)).toBe('generic');
  });
});

describe('isDefinitiveSelection', () => {
  it('returns true for canonical type select', () => {
    const classification = makeClassification('select', 2);
    expect(isDefinitiveSelection(classification, makeSnapshot())).toBe(true);
  });

  it('returns true for canonical type selectDate', () => {
    const classification = makeClassification('selectDate', 2);
    expect(isDefinitiveSelection(classification, makeSnapshot())).toBe(true);
  });

  it('returns true for click with value change', () => {
    const classification = makeClassification('click', 3);
    const snapshot = makeSnapshot({
      valueChange: { before: '', after: 'Premium Economy', inputType: 'text', isDateLike: false },
    });
    expect(isDefinitiveSelection(classification, snapshot)).toBe(true);
  });

  it('returns true for option role', () => {
    const classification = makeClassification('click', 3);
    const snapshot = makeSnapshot({
      identity: makeIdentity({ ariaRole: 'option' }),
    });
    expect(isDefinitiveSelection(classification, snapshot)).toBe(true);
  });

  it('returns false for plain click without value change', () => {
    const classification = makeClassification('click', 3);
    expect(isDefinitiveSelection(classification, makeSnapshot())).toBe(false);
  });
});

describe('resolveCollapsedType', () => {
  it('keeps select as-is', () => {
    const classification = makeClassification('select', 2);
    const result = resolveCollapsedType(classification, []);
    expect(result.classified.canonicalType).toBe('select');
  });

  it('keeps selectDate as-is', () => {
    const classification = makeClassification('selectDate', 2);
    const result = resolveCollapsedType(classification, []);
    expect(result.classified.canonicalType).toBe('selectDate');
  });

  it('upgrades click to selectDate when date context', () => {
    const classification = makeClassification('click', 3);
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: true, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: false },
      }),
      classification: makeClassification(),
    }];
    const result = resolveCollapsedType(classification, snapshots);
    expect(result.classified.canonicalType).toBe('selectDate');
    expect(result.classified.evidence.ruleId).toBe('ASSEMBLER');
  });

  it('upgrades click to select for dropdown context', () => {
    const classification = makeClassification('click', 3);
    const snapshots: BufferedSnapshot[] = [{
      snapshot: makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
      }),
      classification: makeClassification(),
    }];
    const result = resolveCollapsedType(classification, snapshots);
    expect(result.classified.canonicalType).toBe('select');
    expect(result.classified.evidence.ruleId).toBe('ASSEMBLER');
  });
});

describe('extractSelectedValue', () => {
  it('extracts date value from date picker', () => {
    const snapshot = makeSnapshot({
      valueChange: { before: '', after: '2026-07-18', inputType: 'date', isDateLike: true },
    });
    expect(extractSelectedValue(snapshot, 'datepicker')).toBe('2026-07-18');
  });

  it('extracts accessible name for dropdown option', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ accessibleName: 'Premium Economy' }),
    });
    expect(extractSelectedValue(snapshot, 'dropdown')).toBe('Premium Economy');
  });

  it('falls back to value change', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ accessibleName: '' }),
      valueChange: { before: '', after: 'Option A', inputType: 'text', isDateLike: false },
    });
    expect(extractSelectedValue(snapshot, 'dropdown')).toBe('Option A');
  });

  it('returns empty string when no value', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ accessibleName: '' }),
    });
    expect(extractSelectedValue(snapshot, 'generic')).toBe('');
  });
});

describe('extractOpenerLabel', () => {
  it('uses accessible name', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ accessibleName: 'Travel Class' }),
    });
    expect(extractOpenerLabel(snapshot)).toBe('Travel Class');
  });

  it('falls back to tag when no name', () => {
    const snapshot = makeSnapshot({
      identity: makeIdentity({ accessibleName: '', ariaLabel: null, tag: 'BUTTON' }),
    });
    expect(extractOpenerLabel(snapshot)).toBe('BUTTON');
  });
});

// ── State machine tests ────────────────────────────────────────────────

describe('InteractionAssembler — state machine', () => {
  let assembler: InteractionAssembler;
  let emitted: SessionEvent[];
  let updates: { actionId: string; fields: Partial<SessionEvent> }[];

  beforeEach(() => {
    assembler = new InteractionAssembler();
    emitted = [];
    updates = [];
    assembler.onEmit((event) => emitted.push(event));
    assembler.onUpdate((actionId, fields) => updates.push({ actionId, fields }));
    assembler.setEventBuilder((classification, _snapshot) => {
      const type = classification.classified.canonicalType === 'select' ? 'select'
        : classification.classified.canonicalType === 'selectDate' ? 'dateSelect'
        : classification.classified.canonicalType === 'fill' ? 'text'
        : 'click';
      return {
        actionId: `${type}-${String(emitted.length + 1).padStart(4, '0')}`,
        type,
        timestamp: new Date().toISOString(),
      } as SessionEvent;
    });
  });

  it('starts in IDLE state', () => {
    expect(assembler.getState()).toBe('IDLE');
  });

  it('emits immediately for simple click (no surface)', () => {
    const classification = makeClassification('click', 3);
    const snapshot = makeSnapshot();
    const detState = makeDetState(); // no open surfaces

    const result = assembler.process(classification, snapshot, detState);

    expect(result.state).toBe('IDLE');
    expect(result.eventsToEmit).toHaveLength(1);
    expect(result.transactionStarted).toBe(false);
    expect(emitted).toHaveLength(1);
  });

  it('starts transaction when surface is open', () => {
    const classification = makeClassification('click', 3);
    const snapshot = makeSnapshot({
      domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
    });

    const result = assembler.process(classification, snapshot, null);

    expect(result.state).toBe('PENDING');
    expect(result.transactionStarted).toBe(true);
    expect(emitted).toHaveLength(1); // opener emitted
  });

  it('buffers snapshots while surface is open (PENDING)', () => {
    // 1. Start transaction
    const openerClassification = makeClassification('click', 3);
    const openerSnapshot = makeSnapshot({
      domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
    });
    assembler.process(openerClassification, openerSnapshot, null);
    expect(emitted).toHaveLength(1); // opener

    // 2. Second snapshot inside surface (no surface close)
    const bodyClassification = makeClassification('click', 3);
    const bodySnapshot = makeSnapshot({
      ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
    });
    const detStateOpen = makeDetState({
      openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Options', className: 'list' }],
    });

    const result = assembler.process(bodyClassification, bodySnapshot, detStateOpen);

    expect(result.state).toBe('PENDING');
    expect(result.eventsToEmit).toHaveLength(0); // buffered
    expect(emitted).toHaveLength(1); // still just the opener
  });

  it('commits transaction when surface closes with selection', () => {
    // 1. Start transaction (opener)
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );

    // 2. Selection inside surface
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
        identity: makeIdentity({ accessibleName: 'Premium Economy', ariaRole: 'option' }),
        valueChange: { before: '', after: 'Premium Economy', inputType: 'text', isDateLike: false },
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Class', className: 'list' }] }),
    );

    // 3. Surface closed — final snapshot outside surface
    const result = assembler.process(
      makeClassification('click', 3),
      makeSnapshot(), // no surface context
      makeDetState(), // no open surfaces
    );

    // Should commit: opener updated, no new events emitted
    expect(result.state).toBe('COMMITTED');
    expect(result.transactionEnded).toBe(true);
    expect(updates.length).toBeGreaterThanOrEqual(1);

    // The opener should have been updated with select type
    const update = updates[0];
    expect(update.fields.type).toBe('select');
  });

  it('cancels transaction when surface closes without selection', () => {
    // 1. Start transaction
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );

    // 2. Buffer a non-selection event (escape key — not a selection)
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
        keyEvents: ['Escape'],
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Class', className: 'list' }] }),
    );

    // 3. DeterministicState update: surface closed (deferred commit)
    assembler.onSessionContextUpdate(makeDetState());

    // 4. Next snapshot triggers deferred commit.
    // The buffer has [opener, escape-click]. Escape is not a selection
    // candidate, so the transaction should CANCEL.
    const result = assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        primaryEvent: { type: 'navigation', timestamp: new Date().toISOString(), isTrusted: true },
      }),
      makeDetState(),
    );

    expect(result.state).toBe('CANCELLED');
    // Opener (step 1) + escape-click + closing-nav (both from cancelTransaction) = 3
    // No double-emit of the closing snapshot
    expect(emitted.length).toBe(3);
  });

  it('handles SessionContext-triggered commit (surface closes between snapshots)', () => {
    // 1. Start transaction
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );

    // 2. Selection inside surface
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
        identity: makeIdentity({ accessibleName: 'Option 2', ariaRole: 'option' }),
        valueChange: { before: '', after: 'Option 2', inputType: 'text', isDateLike: false },
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'List', className: 'list' }] }),
    );

    // 3. DeterministicState update: surface closed
    assembler.onSessionContextUpdate(makeDetState()); // no open surfaces

    // 4. Next snapshot triggers the deferred commit
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot(),
      makeDetState(),
    );

    // Should have committed via the deferred context update
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].fields.type).toBe('select');
  });

  it('flush commits pending transaction on STOP_RECORDING', () => {
    // 1. Start transaction
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );

    // 2. Selection inside surface
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
        identity: makeIdentity({ accessibleName: 'Premium', ariaRole: 'option' }),
        valueChange: { before: '', after: 'Premium', inputType: 'text', isDateLike: false },
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Class', className: 'list' }] }),
    );

    // 3. Flush (STOP_RECORDING before surface closed)
    assembler.flush();

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0].fields.type).toBe('select');
  });

  it('reset clears transaction state', () => {
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );
    expect(assembler.getState()).toBe('PENDING');

    assembler.reset();
    expect(assembler.getState()).toBe('IDLE');
  });

  it('multiple simple clicks all pass through unchanged', () => {
    for (let i = 0; i < 5; i++) {
      assembler.process(
        makeClassification('click', 3),
        makeSnapshot(),
        makeDetState(),
      );
    }

    expect(emitted).toHaveLength(5);
    expect(updates).toHaveLength(0);
    expect(assembler.getState()).toBe('IDLE');
  });

  it('collapses date picker selection into selectDate event', () => {
    // 1. Open date picker
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
      }),
      null,
    );

    // 2. Select a date inside the calendar
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: true, hasListboxAncestor: false, hasMenuAncestor: false, hasDialogAncestor: false },
        identity: makeIdentity({ accessibleName: '18', ariaRole: 'gridcell' }),
        valueChange: { before: '', after: '2026-07-18', inputType: 'date', isDateLike: true },
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'grid', accessibleName: 'Calendar', className: 'calendar' }] }),
    );

    // 3. Surface closed
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot(),
      makeDetState(),
    );

    // Should be collapsed to selectDate
    const update = updates[0];
    expect(update.fields.type).toBe('dateSelect');
    const fieldsAsRecord = update.fields as unknown as Record<string, unknown>;
    expect(fieldsAsRecord.compositeType).toBe('datepicker');
  });

  it('attaches composite metadata to collapsed event', () => {
    // Start + select + close
    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        domMutations: { childListChanges: 1, attributeChanges: 0, visibilityChanges: 0, observedWindow: 100 },
        identity: makeIdentity({ accessibleName: 'Travel Class' }),
      }),
      null,
    );

    assembler.process(
      makeClassification('click', 3),
      makeSnapshot({
        ancestorContext: { roles: [], containerClasses: [], hasCalendarAncestor: false, hasListboxAncestor: true, hasMenuAncestor: false, hasDialogAncestor: false },
        identity: makeIdentity({ accessibleName: 'Premium Economy', ariaRole: 'option' }),
        valueChange: { before: '', after: 'Premium Economy', inputType: 'text', isDateLike: false },
      }),
      makeDetState({ openDropdowns: [{ tag: 'DIV', role: 'listbox', accessibleName: 'Class', className: 'list' }] }),
    );

    assembler.process(
      makeClassification('click', 3),
      makeSnapshot(),
      makeDetState(),
    );

    const update = updates[0];
    const fields = update.fields as unknown as Record<string, unknown>;
    expect(fields.compositeAction).toBe(true);
    expect(fields.compositeType).toBe('dropdown');
    expect(fields.compositeSelectedValue).toBe('Premium Economy');
    expect(fields.compositeOpenerLabel).toBe('Travel Class');
    expect(fields.compositeSubSteps).toBeGreaterThanOrEqual(2);
  });
});

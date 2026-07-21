import { describe, it, expect } from 'vitest';
import {
  classifyInteractions,
  classifySingleEvent,
  summarizeClassification,
  type ClassificationContext,
} from '../src/generation/engine/semantic-classifier';
import type { SessionEvent } from '../src/shared/types';
import type { MentalModel } from '../src/shared/architecture-types';

// ── Test Factories ─────────────────────────────────────────

function makeNavEvent(): SessionEvent {
  return {
    actionId: 'nav-0001',
    type: 'navigation',
    url: 'https://example.com',
    title: 'Example',
    timestamp: '2026-07-17T00:00:00Z',
  } as SessionEvent;
}

function makeClickEvent(opts?: {
  ariaRole?: string;
  tag?: string;
  actionId?: string;
}): SessionEvent {
  return {
    actionId: opts?.actionId ?? 'click-0001',
    type: 'click',
    timestamp: '2026-07-17T00:00:00Z',
    elementIdentity: {
      tag: opts?.tag ?? 'BUTTON',
      ariaRole: opts?.ariaRole ?? 'button',
      accessibleName: 'Submit',
    },
  } as unknown as SessionEvent;
}

function makeTextEvent(value: string, actionId = 'text-0001'): SessionEvent {
  return {
    actionId,
    type: 'text',
    timestamp: '2026-07-17T00:00:00Z',
    value,
    elementIdentity: {
      tag: 'INPUT',
      ariaRole: 'textbox',
      accessibleName: 'Search',
    },
  } as unknown as SessionEvent;
}

function makeHoverEvent(): SessionEvent {
  return {
    actionId: 'hover-0001',
    type: 'hover',
    timestamp: '2026-07-17T00:00:00Z',
    elementIdentity: {
      tag: 'DIV',
      ariaRole: null,
      accessibleName: 'Menu Item',
    },
  } as unknown as SessionEvent;
}

function makeCheckboxEvent(checked = true): SessionEvent {
  return {
    actionId: 'checkbox-0001',
    type: 'checkbox',
    timestamp: '2026-07-17T00:00:00Z',
    checked,
    elementIdentity: {
      tag: 'INPUT',
      ariaRole: 'checkbox',
      accessibleName: 'Accept Terms',
    },
  } as unknown as SessionEvent;
}

function makeRadioEvent(): SessionEvent {
  return {
    actionId: 'radio-0001',
    type: 'radio',
    timestamp: '2026-07-17T00:00:00Z',
    elementIdentity: {
      tag: 'INPUT',
      ariaRole: 'radio',
      accessibleName: 'Option A',
    },
  } as unknown as SessionEvent;
}

function makeSelectEvent(value: string): SessionEvent {
  return {
    actionId: 'select-0001',
    type: 'select',
    timestamp: '2026-07-17T00:00:00Z',
    value,
    elementIdentity: {
      tag: 'SELECT',
      ariaRole: 'listbox',
      accessibleName: 'Country',
    },
  } as unknown as SessionEvent;
}

function makeDateSelectEvent(): SessionEvent {
  return {
    actionId: 'dateSelect-0001',
    type: 'dateSelect',
    timestamp: '2026-07-17T00:00:00Z',
    dateType: 'date',
    displayValue: '15 July 2026',
    isoValue: '2026-07-15',
    elementIdentity: {
      tag: 'INPUT',
      ariaRole: 'textbox',
      accessibleName: 'Depart on',
    },
  } as unknown as SessionEvent;
}

function makeMentalModelWithIntent(intent: string, confidence: number): MentalModel {
  return {
    appIdentity: null,
    workflow: null,
    currentFocus: null,
    userIntent: { primary: intent, confidence, evidence: [], alternatives: [] },
    recentChange: null,
    confidence: { intent: confidence, workflow: 0.3, appFocus: 0.3, uiFocus: 0.3, change: 0.3, composite: 0.3 },
    lastUpdated: '2026-07-17T00:00:00Z',
  };
}

// ── Tests ──────────────────────────────────────────────────

describe('Semantic Classifier', () => {

  describe('Tier 1 — Deterministic Rules', () => {

    it('Rule R1: navigation → navigate (tier 1)', () => {
      const result = classifySingleEvent(makeNavEvent());
      expect(result.canonicalType).toBe('navigate');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R1');
    });

    it('Rule R2a: text with regular value → fill (tier 1)', () => {
      const result = classifySingleEvent(makeTextEvent('hello world'));
      expect(result.canonicalType).toBe('fill');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R2a');
    });

    it('Rule R2b: text with date-like value on date input → selectDate (tier 1)', () => {
      const event = makeTextEvent('2026-07-15');
      const result = classifySingleEvent(event);
      expect(result.canonicalType).toBe('selectDate');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R2b');
    });

    it('Rule R3: dateSelect → selectDate (tier 1)', () => {
      const result = classifySingleEvent(makeDateSelectEvent());
      expect(result.canonicalType).toBe('selectDate');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R3');
    });

    it('Rule R4: checkbox → toggle (tier 1)', () => {
      const result = classifySingleEvent(makeCheckboxEvent(true));
      expect(result.canonicalType).toBe('toggle');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R4');
    });

    it('Rule R4: checkbox unchecked → toggle (tier 1)', () => {
      const result = classifySingleEvent(makeCheckboxEvent(false));
      expect(result.canonicalType).toBe('toggle');
      expect(result.classificationTier).toBe(1);
    });

    it('Rule R5: radio → select (tier 1)', () => {
      const result = classifySingleEvent(makeRadioEvent());
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R5');
    });

    it('Rule R6: select → select (tier 1)', () => {
      const result = classifySingleEvent(makeSelectEvent('USA'));
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R6');
    });

    it('Rule R7: hover → hover (tier 1)', () => {
      const result = classifySingleEvent(makeHoverEvent());
      expect(result.canonicalType).toBe('hover');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R7');
    });
  });

  describe('Rule 12a — Click on ARIA selection target', () => {
    it('click on role=option → select (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'option' }));
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(1);
      expect(result.evidence).toContain('R12a');
    });

    it('click on role=menuitem → select (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'menuitem' }));
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(1);
    });

    it('click on role=treeitem → select (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'treeitem' }));
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(1);
    });

    it('click on role=button → NOT select (falls through)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }));
      expect(result.canonicalType).not.toBe('select');
    });
  });

  describe('Rule 12b — Click with AI advisory (Tier 2)', () => {
    it('click with AI intent "select option" > 0.7 confidence → select (tier 2)', () => {
      const ctx: ClassificationContext = {
        mentalModel: makeMentalModelWithIntent('select an option from dropdown', 0.85),
      };
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }), ctx);
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(2);
      expect(result.evidence).toContain('R12b');
    });

    it('click with AI intent below 0.7 → does NOT trigger Tier 2', () => {
      const ctx: ClassificationContext = {
        mentalModel: makeMentalModelWithIntent('select an option', 0.5),
      };
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }), ctx);
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).not.toBe(2);
    });

    it('click with AI intent "choose" keyword → select (tier 2)', () => {
      const ctx: ClassificationContext = {
        mentalModel: makeMentalModelWithIntent('choose a payment method', 0.75),
      };
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }), ctx);
      expect(result.canonicalType).toBe('select');
      expect(result.classificationTier).toBe(2);
    });

    it('click with AI intent unrelated to selection → Tier 3 click', () => {
      const ctx: ClassificationContext = {
        mentalModel: makeMentalModelWithIntent('submit the login form', 0.9),
      };
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }), ctx);
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).toBe(3);
    });

    it('click with no MentalModel → Tier 3 (no Tier 2)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }), { mentalModel: null });
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).toBe(3);
    });
  });

  describe('Rule 13 — Click vs Toggle', () => {
    it('click on SUMMARY element → toggle (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ tag: 'SUMMARY' }));
      expect(result.canonicalType).toBe('toggle');
    });

    it('click on role=switch → toggle (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'switch' }));
      expect(result.canonicalType).toBe('toggle');
    });

    it('click on role=tab → toggle (tier 1)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'tab' }));
      expect(result.canonicalType).toBe('toggle');
    });
  });

  describe('Rule 14 — Default Fallback', () => {
    it('plain click on button → click (tier 3)', () => {
      const result = classifySingleEvent(makeClickEvent({ ariaRole: 'button' }));
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).toBe(3);
      expect(result.evidence).toContain('R14');
    });

    it('plain click on link → click (tier 3)', () => {
      const result = classifySingleEvent(makeClickEvent({ tag: 'A', ariaRole: 'link' }));
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).toBe(3);
    });

    it('unknown event type → click (tier 3)', () => {
      const event = {
        actionId: 'unknown-0001',
        type: 'someFutureType',
        timestamp: '2026-07-17T00:00:00Z',
      } as unknown as SessionEvent;
      const result = classifySingleEvent(event);
      expect(result.canonicalType).toBe('click');
      expect(result.classificationTier).toBe(3);
    });
  });

  describe('Date-like value detection', () => {
    it('ISO date "2026-07-15" detected as date-like', () => {
      const event = makeTextEvent('2026-07-15');
      expect(classifySingleEvent(event).canonicalType).toBe('selectDate');
    });

    it('Human-readable "July 15" detected as date-like', () => {
      const event = makeTextEvent('July 15, 2026');
      expect(classifySingleEvent(event).canonicalType).toBe('selectDate');
    });

    it('"15 Jul 2026" detected as date-like', () => {
      const event = makeTextEvent('15 Jul 2026');
      expect(classifySingleEvent(event).canonicalType).toBe('selectDate');
    });

    it('Regular text "hello world" NOT date-like → fill', () => {
      const event = makeTextEvent('hello world');
      expect(classifySingleEvent(event).canonicalType).toBe('fill');
    });

    it('Empty string → fill (not date-like)', () => {
      const event = makeTextEvent('');
      expect(classifySingleEvent(event).canonicalType).toBe('fill');
    });

    it('Numbers only "12345" → fill (not date-like)', () => {
      const event = makeTextEvent('12345');
      expect(classifySingleEvent(event).canonicalType).toBe('fill');
    });
  });

  describe('Batch classification', () => {
    it('classifies multiple events in order', () => {
      const timeline: SessionEvent[] = [
        makeNavEvent(),
        makeClickEvent(),
        makeTextEvent('test'),
        makeHoverEvent(),
      ];
      const results = classifyInteractions(timeline);
      expect(results).toHaveLength(4);
      expect(results[0].canonicalType).toBe('navigate');
      expect(results[1].canonicalType).toBe('click');
      expect(results[2].canonicalType).toBe('fill');
      expect(results[3].canonicalType).toBe('hover');
    });

    it('preserves actionId mapping', () => {
      const timeline: SessionEvent[] = [
        { ...makeNavEvent(), actionId: 'custom-001' },
        { ...makeClickEvent(), actionId: 'custom-002' },
      ];
      const results = classifyInteractions(timeline);
      expect(results[0].actionId).toBe('custom-001');
      expect(results[1].actionId).toBe('custom-002');
    });

    it('handles empty timeline', () => {
      const results = classifyInteractions([]);
      expect(results).toHaveLength(0);
    });

    it('handles mixed Tier 1/2/3 classifications', () => {
      const timeline: SessionEvent[] = [
        makeNavEvent(),                        // tier 1
        makeClickEvent({ ariaRole: 'button' }), // tier 3
        makeClickEvent({ ariaRole: 'option' }), // tier 1
        makeCheckboxEvent(true),                // tier 1
      ];
      const results = classifyInteractions(timeline);
      expect(results[0].classificationTier).toBe(1);
      expect(results[1].classificationTier).toBe(3);
      expect(results[2].classificationTier).toBe(1);
      expect(results[3].classificationTier).toBe(1);
    });
  });

  describe('Without AI (system functional without AI)', () => {
    it('all events classify correctly with null MentalModel', () => {
      const timeline: SessionEvent[] = [
        makeNavEvent(),
        makeClickEvent(),
        makeTextEvent('hello'),
        makeCheckboxEvent(true),
        makeRadioEvent(),
        makeSelectEvent('US'),
        makeHoverEvent(),
        makeDateSelectEvent(),
      ];
      const results = classifyInteractions(timeline, { mentalModel: null });
      expect(results).toHaveLength(8);
      // Every event gets a valid canonical type
      for (const r of results) {
        expect(r.canonicalType).toBeTruthy();
        expect(r.classificationTier).toBeGreaterThanOrEqual(1);
        expect(r.classificationTier).toBeLessThanOrEqual(3);
      }
    });

    it('all events classify correctly with undefined context', () => {
      const results = classifyInteractions([makeNavEvent(), makeClickEvent()]);
      expect(results).toHaveLength(2);
      expect(results[0].canonicalType).toBe('navigate');
      expect(results[1].canonicalType).toBe('click');
    });
  });

  describe('Evidence trail', () => {
    it('every classified interaction has a non-empty evidence string', () => {
      const timeline: SessionEvent[] = [
        makeNavEvent(), makeClickEvent(), makeTextEvent('test'),
      ];
      const results = classifyInteractions(timeline);
      for (const r of results) {
        expect(r.evidence).toBeTruthy();
        expect(r.evidence.length).toBeGreaterThan(0);
      }
    });

    it('evidence contains rule ID', () => {
      const results = classifyInteractions([makeNavEvent()]);
      expect(results[0].evidence).toMatch(/R\d+/);
    });
  });

  describe('Immutability', () => {
    it('original events are not mutated', () => {
      const events = [makeClickEvent()];
      const original = JSON.parse(JSON.stringify(events));
      classifyInteractions(events);
      expect(events).toEqual(original);
    });
  });

  describe('summarizeClassification', () => {
    it('returns correct summary counts', () => {
      const timeline: SessionEvent[] = [
        makeNavEvent(),
        makeClickEvent(),
        makeClickEvent({ ariaRole: 'option' }),
        makeTextEvent('hello'),
      ];
      const results = classifyInteractions(timeline);
      const summary = summarizeClassification(results);
      expect(summary.total).toBe(4);
      expect(summary.byType.navigate).toBe(1);
      expect(summary.byType.click).toBe(1);
      expect(summary.byType.select).toBe(1);
      expect(summary.byType.fill).toBe(1);
      expect(summary.byTier.tier1).toBe(3);
      expect(summary.byTier.tier3).toBe(1);
    });

    it('handles empty input', () => {
      const summary = summarizeClassification([]);
      expect(summary.total).toBe(0);
    });
  });
});

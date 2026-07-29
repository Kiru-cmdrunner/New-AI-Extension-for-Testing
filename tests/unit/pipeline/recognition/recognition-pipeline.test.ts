/**
 * Recognition Pipeline Tests — Phase 4 (with behavioural comparison)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recogniseInteractions,
  resetRecognitionCounter,
} from '../../../../src/pipeline/recognition/recognition-pipeline';
import { getAllPatterns, getPatternById } from '../../../../src/pipeline/recognition/pattern-registry';
import { isRecognised } from '../../../../src/types/recognition';
import type { EvidenceBatch } from '../../../../src/types/evidence';
import type { TargetElementIdentity, TargetDomContext } from '../../../../src/types/element';
import type { EvidenceRecord } from '../../../../src/types/foundation';

function makeTarget(o: Partial<TargetElementIdentity> = {}): TargetElementIdentity {
  return {
    tag: 'BUTTON', accessibleName: 'Submit', ariaRole: 'button',
    ariaExpanded: null, ariaHasPopup: null, ariaChecked: null,
    ariaSelected: null, ariaPressed: null, inputType: null,
    isContentEditable: false,
    locators: [{ kind: 'testId', value: 'btn-1', confidence: 0.95, source: 'observed' }],
    primaryLocator: { kind: 'testId', value: 'btn-1', confidence: 0.95, source: 'observed' },
    inShadowDom: false, inIframe: false, frameContext: null, ...o,
  };
}

function makeDomContext(o: Partial<TargetDomContext> = {}): TargetDomContext {
  return {
    surfaces: [], valueTransition: null, checkedTransition: null,
    ancestorChain: [], datePicker: null, fileUpload: null,
    dialog: null, navigation: null, ...o,
  };
}

function makeBatch(
  id: string, target: TargetElementIdentity, events: string[],
  domCtx: Partial<TargetDomContext> = {}, evidence: EvidenceRecord[] = [],
): EvidenceBatch {
  const n = parseInt(id.replace(/\D/g, '') || '0');
  const base = Date.parse('2026-01-01T00:00:00Z') + n * 100;
  return {
    id, target,
    startedAt: new Date(base).toISOString(),
    endedAt: new Date(base + 50).toISOString(),
    domContext: makeDomContext(domCtx),
    evidence, eventSequence: events,
    status: 'pending', correlationGroup: null, pageUrl: 'https://example.com',
  };
}

describe('Pattern Registry', () => {
  it('should have 12+ patterns', () => {
    expect(getAllPatterns().length).toBeGreaterThanOrEqual(12);
  });
  it('should include all expected pattern IDs', () => {
    const ids = getAllPatterns().map((p) => p.id);
    expect(ids).toContain('checkbox-toggle-v1');
    expect(ids).toContain('radio-select-v1');
    expect(ids).toContain('link-click-v1');
    expect(ids).toContain('button-click-v1');
    expect(ids).toContain('generic-click-v1');
    expect(ids).toContain('text-entry-v1');
    expect(ids).toContain('dropdown-select-v1');
    expect(ids).toContain('date-picker-v1');
    expect(ids).toContain('scroll-v1');
    expect(ids).toContain('hover-v1');
    expect(ids).toContain('navigation-v1');
    expect(ids).toContain('slider-drag-v1');
  });
  it('should order patterns by specificity', () => {
    const p = getAllPatterns();
    expect(p.findIndex((p) => p.id === 'checkbox-toggle-v1'))
      .toBeLessThan(p.findIndex((p) => p.id === 'generic-click-v1'));
  });
  it('should find pattern by ID', () => {
    expect(getPatternById('button-click-v1')?.verb).toBe('click');
  });
  it('should return undefined for unknown ID', () => {
    expect(getPatternById('nope')).toBeUndefined();
  });
});

describe('Recognition Pipeline', () => {
  beforeEach(() => resetRecognitionCounter());

  it('empty input → empty output', () => {
    const o = recogniseInteractions([]);
    expect(o.results).toHaveLength(0);
    expect(o.recognisedCount).toBe(0);
  });

  it('recognises button click', () => {
    const o = recogniseInteractions([makeBatch('1', makeTarget({ ariaRole: 'button' }), ['click'])]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('click');
    expect(o.results[0]!.componentType).toBe('Button');
  });

  it('recognises checkbox toggle', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ tag: 'INPUT', ariaRole: 'checkbox' }), ['click'],
      { checkedTransition: { before: false, after: true, property: 'checked' } })]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('toggle');
    expect(o.results[0]!.componentType).toBe('Checkbox');
  });

  it('recognises link click', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ tag: 'A', ariaRole: 'link' }), ['click'])]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.componentType).toBe('Link');
  });

  it('recognises radio select', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ tag: 'INPUT', ariaRole: 'radio' }), ['click'])]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('selectOption');
    expect(o.results[0]!.componentType).toBe('RadioButton');
  });

  it('recognises scroll', () => {
    const o = recogniseInteractions([makeBatch('1', makeTarget(), ['scroll'])]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('scroll');
  });

  it('recognises navigation', () => {
    const o = recogniseInteractions([makeBatch('1', makeTarget(), ['navigation'])]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('navigate');
  });

  it('recognises text entry (focus→input→blur)', () => {
    const t = makeTarget({ tag: 'INPUT', ariaRole: 'textbox' });
    const o = recogniseInteractions([
      makeBatch('1', t, ['focus']),
      makeBatch('2', t, ['input'], { valueTransition: { before: '', after: 'hi' } }),
      makeBatch('3', t, ['blur']),
    ]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.verb).toBe('fill');
  });

  it('rejects bare div without interactive signals (Phase 5b interactive filter)', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ tag: 'DIV', ariaRole: null }), ['click'])]);
    // Phase 5b: Generic click now requires interactive indicators.
    // Bare divs/spans without ARIA roles, interactive tags, or interactive
    // CSS classes are NOT matched.
    expect(o.recognisedCount).toBe(0);
    expect(o.unrecognisedCount).toBe(1);
  });

  it('includes evidenceTrace', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ ariaRole: 'button' }), ['click'])]);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.evidenceTrace.length).toBeGreaterThan(0);
  });

  it('includes matchedPatternIds', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ ariaRole: 'button' }), ['click'])]);
    expect(o.matchedPatternIds).toContain('button-click-v1');
  });

  it('recognises slider drag', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ ariaRole: 'slider' }), ['input', 'change'],
      { valueTransition: { before: '30', after: '50' } })]);
    expect(o.recognisedCount).toBe(1);
    if (!isRecognised(o.results[0]!)) return;
    expect(o.results[0]!.componentType).toBe('Slider');
  });

  it('correct counts for mixed input', () => {
    const o = recogniseInteractions([
      makeBatch('1', makeTarget({ tag: 'A', ariaRole: 'link',
        primaryLocator: { kind: 'testId', value: 'link-1', confidence: 0.95, source: 'observed' } }), ['click']),
      makeBatch('2', makeTarget({ tag: 'BUTTON', ariaRole: 'button' }), ['click']),
      makeBatch('3', makeTarget(), ['scroll']),
      makeBatch('4', makeTarget({ tag: 'DIV', ariaRole: null }), ['keydown']),
    ]);
    expect(o.recognisedCount).toBe(3);
    expect(o.unrecognisedCount).toBe(1);
  });

  it('closestMatch for unrecognised', () => {
    const o = recogniseInteractions([makeBatch('1',
      makeTarget({ tag: 'DIV', ariaRole: null }), ['keydown'])]);
    expect(o.unrecognisedCount).toBe(1);
    expect(o.results[0]!.kind).toBe('unrecognised');
  });

  it('multiple text entries on different fields', () => {
    const t1 = makeTarget({ tag: 'INPUT', ariaRole: 'textbox',
      primaryLocator: { kind: 'testId', value: 'name', confidence: 0.95, source: 'observed' } });
    const t2 = makeTarget({ tag: 'INPUT', ariaRole: 'textbox',
      primaryLocator: { kind: 'testId', value: 'email', confidence: 0.95, source: 'observed' } });
    const o = recogniseInteractions([
      makeBatch('1', t1, ['focus']),
      makeBatch('2', t1, ['input'], { valueTransition: { before: '', after: 'J' } }),
      makeBatch('3', t1, ['blur']),
      makeBatch('4', t2, ['focus']),
      makeBatch('5', t2, ['input'], { valueTransition: { before: '', after: 'e' } }),
      makeBatch('6', t2, ['blur']),
    ]);
    expect(o.recognisedCount).toBe(2);
  });

  // ── Behavioural parity with working-better ────────────────────────────

  describe('Behavioural parity with working-better', () => {
    it('native INPUT[checkbox] without ariaRole', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: null, inputType: 'checkbox' }), ['click'],
        { checkedTransition: { before: false, after: true, property: 'checked' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('Checkbox');
    });

    it('ARIA switch role as checkbox toggle', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'DIV', ariaRole: 'switch' }), ['click'],
        { checkedTransition: { before: false, after: true, property: 'aria-checked' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('Checkbox');
    });

    it('native INPUT[radio] without ariaRole', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: null, inputType: 'radio' }), ['click'])]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('RadioButton');
    });

    it('role=link without anchor tag', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'SPAN', ariaRole: 'link' }), ['click'])]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('Link');
    });

    it('BUTTON tag without ariaRole', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'BUTTON', ariaRole: null }), ['click'])]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('Button');
    });

    it('native SELECT tag as dropdown', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'SELECT', ariaRole: null }), ['click', 'change'],
        { valueTransition: { before: 'a', after: 'b' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('DropDownListbox');
    });

    it('aria-haspopup=listbox as dropdown', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'DIV', ariaRole: null, ariaHasPopup: 'listbox' }), ['click'],
        { valueTransition: { before: '', after: 'Opt' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('DropDownListbox');
    });

    it('native INPUT[range] as slider', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: null, inputType: 'range' }), ['input', 'change'],
        { valueTransition: { before: '30', after: '60' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.componentType).toBe('Slider');
    });

    it('date input type', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: null, inputType: 'date' }), ['change'])]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.verb).toBe('selectDate');
      expect(o.results[0]!.componentType).toBe('DatePicker');
    });

    it('text entry from input events alone', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: 'textbox' }), ['input'],
        { valueTransition: { before: '', after: 'hello' } })]);
      expect(o.recognisedCount).toBe(1);
      if (!isRecognised(o.results[0]!)) return;
      expect(o.results[0]!.verb).toBe('fill');
    });

    it('text entry without value change is unrecognised', () => {
      const o = recogniseInteractions([makeBatch('1',
        makeTarget({ tag: 'INPUT', ariaRole: 'textbox' }), ['input'])]);
      expect(o.unrecognisedCount).toBe(1);
    });
  });
});

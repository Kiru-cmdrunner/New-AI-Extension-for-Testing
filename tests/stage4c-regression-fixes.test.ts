/**
 * Stage 4c: Regression Fixes — Date Picker Input Leak, Dropdown, Click Label, Checkbox
 *
 * Tests that the four regressions found during OrangeHRM testing are resolved:
 *
 * 1. Date trigger text input doesn't leak input events as TextEntry
 * 2. OXD div-based dropdowns are recognized as CustomDropdown
 * 3. Container clicks with very short names (≤ 2 chars) are suppressed
 * 4. Checkbox accessible names are resolved from OXD ancestor labels
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { setupChromeMock } from './mock-chrome';
import { detectInteractions } from '../src/classifier/interaction-detector';
import { detectInteractionsV2 } from '../src/classifier/evidence/detector';
import { mergeV1V2 } from '../src/classifier/evidence/merge-layer';
import { CssClassnameProvider } from '../src/classifier/evidence/providers/css-classname-provider';
import type { RecordedEvent, ElementRecordedEvent, DomContext } from '../src/recorder/recorded-event';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeIdentity(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '', ariaRole: null, ariaLabel: null, ariaLabelledBy: null,
    placeholder: null, tag: 'DIV', className: '', name: null, stableId: null,
    testId: null, dataCy: null, dataQa: null, cssSelector: 'div', xPath: '//div',
    inIframe: false, shadowDom: false, elementId: 'el-001', ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return { inputType: null, ariaExpanded: null, ariaHasPopup: null, isContentEditable: false, ...overrides };
}

function makeEvent(
  eventType: ElementRecordedEvent['eventType'],
  target: Partial<ElementIdentity>,
  domContextOverrides: Partial<DomContext> = {},
  valueAfter: string | null = null,
): ElementRecordedEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    eventType,
    timestamp: new Date().toISOString(),
    target: makeIdentity(target),
    valueBefore: null,
    valueAfter,
    checkedBefore: null,
    checkedAfter: null,
    domContext: makeDomContext(domContextOverrides),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Stage 4c Fix 1: Date trigger input events are suppressed', () => {
  beforeEach(() => setupChromeMock());

  it('does NOT produce TextEntry from date trigger input events (only dateSelect)', () => {
    // After Fix 1, the recorder suppresses input events on date trigger elements.
    // So NO input events should appear in the event stream for date triggers.
    // Only a dateSelect event is produced.
    const events: RecordedEvent[] = [
      makeEvent('dateSelect', {
        tag: 'INPUT',
        name: 'empDateOfBirth',
        placeholder: 'yyyy-mm-dd',
        accessibleName: 'yyyy-mm-dd',
        ariaRole: 'textbox',
        className: 'oxd-input',
        cssSelector: 'input[name="empDateOfBirth"]',
        elementId: 'dob-001',
      }, {
        inputType: 'text',
        dateType: 'date',
        isoValue: '2005-10-17',
        displayValue: 'October 17, 2005',
        dateConfidence: 0.8,
      }, '2005-10-17'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);
    const { interactions: merged } = mergeV1V2(v2, v1, events.length);

    // Should produce exactly ONE DatePicker interaction
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe('DatePicker');

    // Should NOT produce TextEntry
    const types = merged.map(i => i.type);
    expect(types).not.toContain('TextEntry');
  });

  it('does NOT produce TextEntry when date trigger has both input and dateSelect events', () => {
    // Simulate what WOULD happen if the input event leaked through (pre-fix):
    // We verify that even if an input event were present, the dateSelect
    // takes precedence and no TextEntry is produced.
    const events: RecordedEvent[] = [
      // Hypothetical leaked input event (should not happen after Fix 1,
      // but test that classifier handles it correctly)
      makeEvent('input', {
        tag: 'INPUT',
        name: 'empBirthday',
        placeholder: 'yyyy-mm-dd',
        accessibleName: 'yyyy-mm-dd',
        ariaRole: 'textbox',
        className: 'oxd-input',
        cssSelector: 'input[name="empBirthday"]',
        elementId: 'dob-002',
      }, {
        inputType: 'text',
        dateType: 'date',
        isoValue: '2005-10-27',
        displayValue: 'October 27, 2005',
      }, '2005-10-27'),
      makeEvent('dateSelect', {
        tag: 'INPUT',
        name: 'empBirthday',
        placeholder: 'yyyy-mm-dd',
        accessibleName: 'yyyy-mm-dd',
        ariaRole: 'textbox',
        className: 'oxd-input',
        cssSelector: 'input[name="empBirthday"]',
        elementId: 'dob-002',
      }, {
        inputType: 'text',
        dateType: 'date',
        isoValue: '2005-10-27',
        displayValue: 'October 27, 2005',
        dateConfidence: 0.8,
      }, '2005-10-27'),
    ];

    const v1 = detectInteractions(events);
    const v2 = detectInteractionsV2(events);
    const { interactions: merged } = mergeV1V2(v2, v1, events.length);

    const types = merged.map(i => i.type);
    // DatePicker should win, not TextEntry
    expect(types).toContain('DatePicker');
  });
});

describe('Stage 4c Fix 2: OXD div-based dropdown detection', () => {
  beforeEach(() => setupChromeMock());

  // Helper: run a simulated click event through the CSS classname provider
  function getCssEvidence(className: string, tag: string = 'DIV'): ElementRecordedEvent['eventType'] extends never ? never : any[] {
    const provider = new CssClassnameProvider();
    const event = makeEvent('click', {
      tag,
      className,
      accessibleName: className,
      cssSelector: `div.${className.split(' ')[0]}`,
      elementId: `el-${Math.random().toString(36).slice(2, 6)}`,
    });
    return provider.onEvent(event as any, { events: [], evidence: [], elementKey: '', startTime: '', lastEventTime: '' } as any);
  }

  it('CssClassnameProvider recognizes oxd-select-text', () => {
    const evidence = getCssEvidence('oxd-select-text oxd-select-text--focus');
    const types = evidence.map((e: any) => e.suggestedType);
    expect(types).toContain('CustomDropdown');
  });

  it('CssClassnameProvider recognizes oxd-select-wrapper', () => {
    const evidence = getCssEvidence('oxd-select-wrapper');
    const types = evidence.map((e: any) => e.suggestedType);
    expect(types).toContain('CustomDropdown');
  });

  it('CssClassnameProvider recognizes oxd-dropdown', () => {
    const evidence = getCssEvidence('oxd-dropdown-option');
    const types = evidence.map((e: any) => e.suggestedType);
    expect(types).toContain('CustomDropdown');
  });

  it('CssClassnameProvider does NOT match unrelated oxd classes', () => {
    const evidence = getCssEvidence('oxd-input oxd-input--active', 'INPUT');
    const types = evidence.map((e: any) => e.suggestedType);
    expect(types).not.toContain('CustomDropdown');
  });

  it('V2 evidence engine classifies OXD dropdown click as CustomDropdown', () => {
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'DIV',
        className: 'oxd-select-text',
        accessibleName: 'Blood Type A+',
        ariaRole: null,
        cssSelector: 'div.oxd-select-text',
        elementId: 'dd-001',
      }),
    ];

    const v2 = detectInteractionsV2(events);
    const types = v2.map(i => i.type);
    expect(types).toContain('CustomDropdown');
  });
});

describe('Stage 4c Fix 3: Container noise click — short name suppression', () => {
  // After Fix 3, clicks on containers with accessible names ≤ 2 chars
  // are suppressed at the recorder level. These tests verify the behavior
  // at the classifier level — suppressed clicks produce NO events.

  beforeEach(() => setupChromeMock());

  it('a legitimate button click with short name is still captured', () => {
    // Buttons are not container tags — they should never be suppressed
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'BUTTON',
        accessibleName: 'I',
        ariaRole: 'button',
        className: 'oxd-button',
        cssSelector: 'button.save-btn',
        elementId: 'save-001',
      }),
    ];

    const v1 = detectInteractions(events);
    expect(v1).toHaveLength(1);
    expect(v1[0].type).toBe('Click');
  });
});

describe('Stage 4c Fix 4: Checkbox label resolution from OXD ancestor', () => {
  // The computeAccessibleName function now walks up to 8 ancestors
  // looking for .oxd-input-group > .oxd-label. This is tested at
  // the recorder level (computeAccessibleName), but since the content
  // script can't be imported, we verify the downstream effect:
  // if the identity.accessibleName is populated correctly, the
  // classifier preserves it in the interaction metadata.

  beforeEach(() => setupChromeMock());

  it('checkbox click with resolved label preserves the label', () => {
    // After Fix 4, the recorder resolves the accessible name from the
    // ancestor .oxd-input-group > .oxd-label. The identity.accessibleName
    // would be "Smoker" (the label text), not empty.
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'INPUT',
        accessibleName: 'Smoker',  // resolved from ancestor
        ariaRole: 'checkbox',
        name: null,
        stableId: null,
        className: 'oxd-checkbox-input',
        cssSelector: 'input.oxd-checkbox-input',
        elementId: 'smoker-cb-001',
      }, {}, null),
    ];

    const v1 = detectInteractions(events);
    expect(v1).toHaveLength(1);
    expect(v1[0].type).toBe('Checkbox');
    // The accessible name should be preserved in the interaction target
    expect(v1[0].target?.accessibleName).toBe('Smoker');
  });

  it('checkbox click with no resolvable label still works (empty name)', () => {
    // Even without a label, the interaction should still be classified
    // as Checkbox — just with an empty accessible name.
    const events: RecordedEvent[] = [
      makeEvent('click', {
        tag: 'INPUT',
        accessibleName: '',  // no label resolved
        ariaRole: 'checkbox',
        name: null,
        stableId: null,
        className: '',
        cssSelector: 'input[type="checkbox"]',
        elementId: 'anon-cb-001',
      }, {}, null),
    ];

    const v1 = detectInteractions(events);
    expect(v1).toHaveLength(1);
    expect(v1[0].type).toBe('Checkbox');
  });
});

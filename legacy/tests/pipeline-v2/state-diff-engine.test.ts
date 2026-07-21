/**
 * Unit tests for the State Diff Engine.
 *
 * Tests cover:
 *   - DOM state snapshot capture (using jsdom)
 *   - Diff computation between two snapshots
 *   - Value changes, toggle changes, radio changes, range changes
 *   - Focus changes, surface changes, tab changes, URL changes
 *   - Structural change detection
 *   - hasMeaningfulChanges / isValueSelection / isToggleChange / isRadioSelection
 *   - Empty diff (no changes)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  snapshotState,
  computeDiff,
  hasMeaningfulChanges,
  isValueSelection,
  isToggleChange,
  isRadioSelection,
} from '../../src/recorder/pipeline-v2/state-diff-engine';
import type {
  StateSnapshot,
  StateDiff,
  ElementDescriptor,
} from '../../src/recorder/pipeline-v2/canonical-event-schema';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeDescriptor(overrides: Partial<ElementDescriptor> = {}): ElementDescriptor {
  return {
    accessibleName: 'Test Element',
    ariaRole: null,
    tag: 'INPUT',
    id: 'test-el',
    cssSelector: '#test-el',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    timestamp: '2026-07-18T00:00:00.000Z',
    url: 'https://example.com',
    pageTitle: 'Test Page',
    inputs: [],
    checkboxes: [],
    radios: [],
    toggles: [],
    ranges: [],
    focusedElement: null,
    openSurfaces: [],
    activeTab: null,
    expandedAccordions: [],
    interactiveElementCount: 0,
    ...overrides,
  };
}

// ── computeDiff Tests ───────────────────────────────────────────────────

describe('computeDiff', () => {
  describe('value changes', () => {
    it('should detect a value change', () => {
      const before = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ accessibleName: 'Email', id: 'email', cssSelector: '#email' }),
          value: '',
          inputType: 'email',
        }],
      });
      const after = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ accessibleName: 'Email', id: 'email', cssSelector: '#email' }),
          value: 'test@example.com',
          inputType: 'email',
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.valueChanges).toHaveLength(1);
      expect(diff.valueChanges[0].field).toBe('Email');
      expect(diff.valueChanges[0].before).toBe('');
      expect(diff.valueChanges[0].after).toBe('test@example.com');
    });

    it('should detect multiple value changes', () => {
      const before = makeSnapshot({
        inputs: [
          { descriptor: makeDescriptor({ id: 'a', cssSelector: '#a' }), value: 'old1', inputType: 'text' },
          { descriptor: makeDescriptor({ id: 'b', cssSelector: '#b' }), value: 'old2', inputType: 'text' },
        ],
      });
      const after = makeSnapshot({
        inputs: [
          { descriptor: makeDescriptor({ id: 'a', cssSelector: '#a' }), value: 'new1', inputType: 'text' },
          { descriptor: makeDescriptor({ id: 'b', cssSelector: '#b' }), value: 'new2', inputType: 'text' },
        ],
      });

      const diff = computeDiff(before, after);
      expect(diff.valueChanges).toHaveLength(2);
    });

    it('should NOT report a change when values are identical', () => {
      const before = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ id: 'a', cssSelector: '#a' }),
          value: 'same',
          inputType: 'text',
        }],
      });
      const after = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ id: 'a', cssSelector: '#a' }),
          value: 'same',
          inputType: 'text',
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.valueChanges).toHaveLength(0);
    });

    it('should detect a dropdown selection (value change)', () => {
      const before = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ accessibleName: 'Country', id: 'country', cssSelector: '#country' }),
          value: '',
          inputType: 'select-one',
        }],
      });
      const after = makeSnapshot({
        inputs: [{
          descriptor: makeDescriptor({ accessibleName: 'Country', id: 'country', cssSelector: '#country' }),
          value: 'Canada',
          inputType: 'select-one',
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.valueChanges).toHaveLength(1);
      expect(diff.valueChanges[0].after).toBe('Canada');
    });
  });

  describe('toggle changes', () => {
    it('should detect a checkbox toggle', () => {
      const before = makeSnapshot({
        checkboxes: [{
          descriptor: makeDescriptor({ accessibleName: 'Subscribe', id: 'sub', cssSelector: '#sub' }),
          checked: false,
        }],
      });
      const after = makeSnapshot({
        checkboxes: [{
          descriptor: makeDescriptor({ accessibleName: 'Subscribe', id: 'sub', cssSelector: '#sub' }),
          checked: true,
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.toggleChanges).toHaveLength(1);
      expect(diff.toggleChanges[0].before).toBe(false);
      expect(diff.toggleChanges[0].after).toBe(true);
    });

    it('should detect an aria-pressed toggle', () => {
      const before = makeSnapshot({
        toggles: [{
          descriptor: makeDescriptor({ accessibleName: 'Dark Mode', id: 'dark', cssSelector: '#dark' }),
          checked: false,
        }],
      });
      const after = makeSnapshot({
        toggles: [{
          descriptor: makeDescriptor({ accessibleName: 'Dark Mode', id: 'dark', cssSelector: '#dark' }),
          checked: true,
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.toggleChanges).toHaveLength(1);
    });

    it('should NOT report a change when toggle is unchanged', () => {
      const before = makeSnapshot({
        checkboxes: [{
          descriptor: makeDescriptor({ id: 'c', cssSelector: '#c' }),
          checked: true,
        }],
      });
      const after = makeSnapshot({
        checkboxes: [{
          descriptor: makeDescriptor({ id: 'c', cssSelector: '#c' }),
          checked: true,
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.toggleChanges).toHaveLength(0);
    });
  });

  describe('radio changes', () => {
    it('should detect a radio selection change', () => {
      const before = makeSnapshot({
        radios: [{
          name: 'plan',
          descriptor: makeDescriptor({ id: 'plan-group', cssSelector: '#plan-group' }),
          selectedOption: makeDescriptor({ accessibleName: 'Basic', id: 'basic', cssSelector: '#basic' }),
          options: [],
        }],
      });
      const after = makeSnapshot({
        radios: [{
          name: 'plan',
          descriptor: makeDescriptor({ id: 'plan-group', cssSelector: '#plan-group' }),
          selectedOption: makeDescriptor({ accessibleName: 'Pro', id: 'pro', cssSelector: '#pro' }),
          options: [],
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.radioChanges).toHaveLength(1);
      expect(diff.radioChanges[0].before?.accessibleName).toBe('Basic');
      expect(diff.radioChanges[0].after?.accessibleName).toBe('Pro');
    });

    it('should detect initial radio selection (null → selected)', () => {
      const before = makeSnapshot({
        radios: [{
          name: 'plan',
          descriptor: makeDescriptor({ cssSelector: '#plan' }),
          selectedOption: null,
          options: [],
        }],
      });
      const after = makeSnapshot({
        radios: [{
          name: 'plan',
          descriptor: makeDescriptor({ cssSelector: '#plan' }),
          selectedOption: makeDescriptor({ accessibleName: 'Pro', cssSelector: '#pro' }),
          options: [],
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.radioChanges).toHaveLength(1);
      expect(diff.radioChanges[0].before).toBeNull();
      expect(diff.radioChanges[0].after?.accessibleName).toBe('Pro');
    });
  });

  describe('range changes', () => {
    it('should detect a slider value change', () => {
      const before = makeSnapshot({
        ranges: [{
          descriptor: makeDescriptor({ accessibleName: 'Volume', id: 'vol', cssSelector: '#vol' }),
          value: '25',
          min: '0',
          max: '100',
        }],
      });
      const after = makeSnapshot({
        ranges: [{
          descriptor: makeDescriptor({ accessibleName: 'Volume', id: 'vol', cssSelector: '#vol' }),
          value: '75',
          min: '0',
          max: '100',
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.rangeChanges).toHaveLength(1);
      expect(diff.rangeChanges[0].before).toBe('25');
      expect(diff.rangeChanges[0].after).toBe('75');
    });
  });

  describe('focus changes', () => {
    it('should detect focus moving between elements', () => {
      const before = makeSnapshot({
        focusedElement: makeDescriptor({ accessibleName: 'Email', cssSelector: '#email' }),
      });
      const after = makeSnapshot({
        focusedElement: makeDescriptor({ accessibleName: 'Password', cssSelector: '#password' }),
      });

      const diff = computeDiff(before, after);
      expect(diff.focusChange).not.toBeNull();
      expect(diff.focusChange?.from?.accessibleName).toBe('Email');
      expect(diff.focusChange?.to?.accessibleName).toBe('Password');
    });

    it('should return null when focus is unchanged', () => {
      const before = makeSnapshot({
        focusedElement: makeDescriptor({ cssSelector: '#email' }),
      });
      const after = makeSnapshot({
        focusedElement: makeDescriptor({ cssSelector: '#email' }),
      });

      const diff = computeDiff(before, after);
      expect(diff.focusChange).toBeNull();
    });
  });

  describe('surface changes', () => {
    it('should detect a surface opening', () => {
      const before = makeSnapshot({ openSurfaces: [] });
      const after = makeSnapshot({
        openSurfaces: [{
          type: 'dropdown',
          descriptor: makeDescriptor({ accessibleName: 'Country List', cssSelector: '#country-list' }),
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.surfaceChanges).toHaveLength(1);
      expect(diff.surfaceChanges[0].action).toBe('opened');
      expect(diff.surfaceChanges[0].type).toBe('dropdown');
    });

    it('should detect a surface closing', () => {
      const before = makeSnapshot({
        openSurfaces: [{
          type: 'modal',
          descriptor: makeDescriptor({ accessibleName: 'Settings Dialog', cssSelector: '#settings-modal' }),
        }],
      });
      const after = makeSnapshot({ openSurfaces: [] });

      const diff = computeDiff(before, after);
      expect(diff.surfaceChanges).toHaveLength(1);
      expect(diff.surfaceChanges[0].action).toBe('closed');
      expect(diff.surfaceChanges[0].type).toBe('modal');
    });

    it('should detect both opening and closing', () => {
      const before = makeSnapshot({
        openSurfaces: [{
          type: 'dropdown',
          descriptor: makeDescriptor({ cssSelector: '#old-dd' }),
        }],
      });
      const after = makeSnapshot({
        openSurfaces: [{
          type: 'modal',
          descriptor: makeDescriptor({ cssSelector: '#new-modal' }),
        }],
      });

      const diff = computeDiff(before, after);
      expect(diff.surfaceChanges).toHaveLength(2);
    });
  });

  describe('tab changes', () => {
    it('should detect active tab switching', () => {
      const before = makeSnapshot({
        activeTab: {
          selectedTab: makeDescriptor({ accessibleName: 'Overview', cssSelector: '#tab-overview' }),
          activePanel: makeDescriptor({ cssSelector: '#panel-overview' }),
        },
      });
      const after = makeSnapshot({
        activeTab: {
          selectedTab: makeDescriptor({ accessibleName: 'Settings', cssSelector: '#tab-settings' }),
          activePanel: makeDescriptor({ cssSelector: '#panel-settings' }),
        },
      });

      const diff = computeDiff(before, after);
      expect(diff.tabChange).not.toBeNull();
      expect(diff.tabChange?.from.accessibleName).toBe('Overview');
      expect(diff.tabChange?.to.accessibleName).toBe('Settings');
    });
  });

  describe('URL changes', () => {
    it('should detect URL change', () => {
      const before = makeSnapshot({ url: 'https://example.com/page1' });
      const after = makeSnapshot({ url: 'https://example.com/page2' });

      const diff = computeDiff(before, after);
      expect(diff.urlChange).not.toBeNull();
      expect(diff.urlChange?.from).toBe('https://example.com/page1');
      expect(diff.urlChange?.to).toBe('https://example.com/page2');
    });

    it('should return null when URL is unchanged', () => {
      const before = makeSnapshot({ url: 'https://example.com' });
      const after = makeSnapshot({ url: 'https://example.com' });

      const diff = computeDiff(before, after);
      expect(diff.urlChange).toBeNull();
    });
  });

  describe('structural changes', () => {
    it('should detect when interactive element count changes', () => {
      const before = makeSnapshot({ interactiveElementCount: 10 });
      const after = makeSnapshot({ interactiveElementCount: 15 });

      const diff = computeDiff(before, after);
      expect(diff.structuralChangeDetected).toBe(true);
    });

    it('should not detect structural change when count is same', () => {
      const before = makeSnapshot({ interactiveElementCount: 10 });
      const after = makeSnapshot({ interactiveElementCount: 10 });

      const diff = computeDiff(before, after);
      expect(diff.structuralChangeDetected).toBe(false);
    });
  });

  describe('empty diff', () => {
    it('should produce all-empty diff for identical snapshots', () => {
      const snapshot = makeSnapshot();
      const diff = computeDiff(snapshot, snapshot);

      expect(diff.valueChanges).toHaveLength(0);
      expect(diff.toggleChanges).toHaveLength(0);
      expect(diff.radioChanges).toHaveLength(0);
      expect(diff.rangeChanges).toHaveLength(0);
      expect(diff.focusChange).toBeNull();
      expect(diff.surfaceChanges).toHaveLength(0);
      expect(diff.tabChange).toBeNull();
      expect(diff.urlChange).toBeNull();
      expect(diff.structuralChangeDetected).toBe(false);
    });
  });
});

// ── Analysis Helpers Tests ─────────────────────────────────────────────

describe('analysis helpers', () => {
  const emptyDiff: StateDiff = {
    valueChanges: [],
    toggleChanges: [],
    radioChanges: [],
    rangeChanges: [],
    focusChange: null,
    surfaceChanges: [],
    tabChange: null,
    urlChange: null,
    structuralChangeDetected: false,
  };

  describe('hasMeaningfulChanges', () => {
    it('should return false for empty diff', () => {
      expect(hasMeaningfulChanges(emptyDiff)).toBe(false);
    });

    it('should return true for value change', () => {
      expect(hasMeaningfulChanges({
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor(),
          field: 'Email',
          before: '',
          after: 'test',
          inputType: 'text',
        }],
      })).toBe(true);
    });

    it('should return true for surface change', () => {
      expect(hasMeaningfulChanges({
        ...emptyDiff,
        surfaceChanges: [{
          type: 'dropdown',
          action: 'opened',
          descriptor: makeDescriptor(),
        }],
      })).toBe(true);
    });

    it('should return true for URL change', () => {
      expect(hasMeaningfulChanges({
        ...emptyDiff,
        urlChange: { from: '/a', to: '/b' },
      })).toBe(true);
    });
  });

  describe('isValueSelection', () => {
    it('should return true for exactly one non-empty value change', () => {
      expect(isValueSelection({
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor(),
          field: 'Country',
          before: '',
          after: 'Canada',
          inputType: 'select-one',
        }],
      })).toBe(true);
    });

    it('should return false for multiple value changes', () => {
      expect(isValueSelection({
        ...emptyDiff,
        valueChanges: [
          { descriptor: makeDescriptor(), field: 'A', before: '', after: '1', inputType: 'text' },
          { descriptor: makeDescriptor(), field: 'B', before: '', after: '2', inputType: 'text' },
        ],
      })).toBe(false);
    });

    it('should return false for empty after value', () => {
      expect(isValueSelection({
        ...emptyDiff,
        valueChanges: [{
          descriptor: makeDescriptor(),
          field: 'Email',
          before: 'test',
          after: '',
          inputType: 'text',
        }],
      })).toBe(false);
    });
  });

  describe('isToggleChange', () => {
    it('should return true for exactly one toggle change', () => {
      expect(isToggleChange({
        ...emptyDiff,
        toggleChanges: [{
          descriptor: makeDescriptor(),
          field: 'Subscribe',
          before: false,
          after: true,
        }],
      })).toBe(true);
    });

    it('should return false for no toggle changes', () => {
      expect(isToggleChange(emptyDiff)).toBe(false);
    });
  });

  describe('isRadioSelection', () => {
    it('should return true for exactly one radio change', () => {
      expect(isRadioSelection({
        ...emptyDiff,
        radioChanges: [{
          groupName: 'plan',
          groupDescriptor: makeDescriptor(),
          before: null,
          after: makeDescriptor(),
        }],
      })).toBe(true);
    });
  });
});

// ── DOM Snapshot Tests (jsdom) ─────────────────────────────────────────

describe('snapshotState with DOM', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should capture input elements from the DOM', () => {
    document.body.innerHTML = `
      <input id="email" type="email" placeholder="Email" value="test@example.com" />
      <input id="name" type="text" value="John" />
    `;

    const snapshot = snapshotState();
    expect(snapshot.inputs).toHaveLength(2);
    const email = snapshot.inputs.find((i) => i.descriptor.id === 'email');
    expect(email?.value).toBe('test@example.com');
  });

  it('should capture checkbox states from the DOM', () => {
    document.body.innerHTML = `
      <input id="agree" type="checkbox" checked />
      <input id="newsletter" type="checkbox" />
    `;

    const snapshot = snapshotState();
    expect(snapshot.checkboxes).toHaveLength(2);
    const agree = snapshot.checkboxes.find((c) => c.descriptor.id === 'agree');
    expect(agree?.checked).toBe(true);
    const newsletter = snapshot.checkboxes.find((c) => c.descriptor.id === 'newsletter');
    expect(newsletter?.checked).toBe(false);
  });

  it('should capture native select value from the DOM', () => {
    document.body.innerHTML = `
      <select id="country">
        <option value="">Select...</option>
        <option value="ca">Canada</option>
        <option value="us" selected>United States</option>
      </select>
    `;

    const snapshot = snapshotState();
    expect(snapshot.inputs).toHaveLength(1);
    expect(snapshot.inputs[0].value).toBe('United States');
  });

  it('should capture ARIA toggle from the DOM', () => {
    document.body.innerHTML = `
      <button id="dark-mode" aria-pressed="true">Dark Mode</button>
      <button id="notifications" aria-pressed="false">Notifications</button>
    `;

    const snapshot = snapshotState();
    const darkMode = snapshot.toggles.find((t) => t.descriptor.id === 'dark-mode');
    expect(darkMode?.checked).toBe(true);
  });

  it('should capture range inputs from the DOM', () => {
    document.body.innerHTML = `
      <input id="volume" type="range" min="0" max="100" value="50" />
    `;

    const snapshot = snapshotState();
    expect(snapshot.ranges).toHaveLength(1);
    expect(snapshot.ranges[0].value).toBe('50');
  });

  it('should capture URL and title from the DOM', () => {
    document.title = 'Test Page Title';

    const snapshot = snapshotState();
    expect(snapshot.pageTitle).toBe('Test Page Title');
  });

  it('should count interactive elements', () => {
    document.body.innerHTML = `
      <button>Click</button>
      <a href="#">Link</a>
      <input type="text" />
      <select><option>A</option></select>
    `;

    const snapshot = snapshotState();
    expect(snapshot.interactiveElementCount).toBeGreaterThanOrEqual(4);
  });

  it('should capture radio groups from the DOM', () => {
    document.body.innerHTML = `
      <input type="radio" name="plan" id="basic" />
      <input type="radio" name="plan" id="pro" checked />
    `;

    const snapshot = snapshotState();
    expect(snapshot.radios).toHaveLength(1);
    expect(snapshot.radios[0].name).toBe('plan');
    expect(snapshot.radios[0].selectedOption?.id).toBe('pro');
  });

  it('should ignore hidden elements', () => {
    document.body.innerHTML = `
      <input id="visible" type="text" value="hello" />
      <input id="hidden-el" type="text" value="hidden" style="display:none" />
    `;

    const snapshot = snapshotState();
    expect(snapshot.inputs).toHaveLength(1);
    expect(snapshot.inputs[0].descriptor.id).toBe('visible');
  });
});

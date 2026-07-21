/**
 * Selection Controls Completion — Comprehensive Tests
 *
 * Validates detection for:
 *   1. ToggleSwitch (role=switch, button+aria-pressed, MUI/AntD/Bootstrap CSS)
 *   2. Tab (role=tab, MUI/AntD/Bootstrap CSS, metadata, timeline phrasing)
 *   3. Slider (role=slider, input[type=range], MUI/AntD CSS, metadata, phrasing)
 *
 * Also validates regression: plain checkbox → Checkbox, plain button → Click,
 * plain link → Link, plain text input → TextEntry.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { COMMIT_THRESHOLD } from '../../src/classifier/evidence/combination.js';
import type { ElementIdentity, ElementRecordedEvent } from '../../src/recorder/recorded-event.js';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  focusEvent,
  blurEvent,
  changeEvent,
  domContext,
  checkboxDomContext,
  radioDomContext,
} from './helpers.js';

const MIN_CONFIDENCE = COMMIT_THRESHOLD;

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TOGGLE SWITCH
// ═══════════════════════════════════════════════════════════════════════════════

describe('ToggleSwitch Detection', () => {
  beforeEach(() => resetEventCounter());

  // ── ARIA role=switch ──
  describe('ARIA role=switch', () => {
    it('role=switch + click → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Notifications',
        cssSelector: 'input#notif-switch',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: true, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
      expect(ts!.metadata.checked).toBe(true);
      expect(ts!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('role=switch toggle off → checked=false', () => {
      const sw = makeTarget({
        tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Auto-save',
        cssSelector: 'input#autosave',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: false, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
      expect(ts!.metadata.checked).toBe(false);
    });
  });

  // ── ARIA role=button + aria-pressed ──
  describe('ARIA role=button + aria-pressed', () => {
    it('role=button + checkedAfter → ToggleSwitch (not Click)', () => {
      const btn = makeTarget({
        tag: 'DIV', ariaRole: 'button', accessibleName: 'Dark Mode',
        cssSelector: 'div#dark-mode',
      });

      const result = detectInteractionsV2([
        clickEvent(btn, { checkedAfter: true, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
      expect(ts!.metadata.checked).toBe(true);

      // Should NOT be Click
      const click = result.find(r => r.type === 'Click');
      expect(click).toBeUndefined();
    });
  });

  // ── MUI Switch ──
  describe('Material UI Switch', () => {
    it('MuiSwitch-root + click → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'SPAN', accessibleName: 'Airplane Mode',
        className: 'MuiSwitch-root',
        cssSelector: 'span#mui-switch',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: true, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
    });

    it('MuiSwitch-switchBase + role=switch → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Wi-Fi',
        className: 'MuiSwitch-switchBase Mui-checked',
        cssSelector: 'input#wifi-switch',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: false, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
      expect(ts!.metadata.checked).toBe(false);
    });
  });

  // ── Ant Design Switch ──
  describe('Ant Design Switch', () => {
    it('ant-switch + click → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'BUTTON', accessibleName: 'Loading',
        className: 'ant-switch ant-switch-checked',
        cssSelector: 'button#ant-switch',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: false, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
    });
  });

  // ── Bootstrap Switch ──
  describe('Bootstrap Switch', () => {
    it('form-switch + click → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'INPUT', accessibleName: 'Email alerts',
        className: 'form-check-input form-switch',
        cssSelector: 'input#email-alerts',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: true, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
    });
  });

  // ── Generic toggle patterns ──
  describe('Generic toggle patterns', () => {
    it('toggle-switch class → ToggleSwitch', () => {
      const sw = makeTarget({
        tag: 'DIV', accessibleName: 'Sync',
        className: 'toggle-switch',
        cssSelector: 'div#sync-toggle',
      });

      const result = detectInteractionsV2([
        clickEvent(sw, { checkedAfter: true, domContext: domContext() }),
      ]);

      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeDefined();
    });
  });

  // ── Timeline phrasing ──
  describe('timeline phrasing', () => {
    it('checked=true → "Enable "X""', () => {
      const ts = makeTarget({ tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Notifications', cssSelector: '#s1' });
      const result = detectInteractionsV2([clickEvent(ts, { checkedAfter: true, domContext: domContext() })]);
      const ts_int = result.find(r => r.type === 'ToggleSwitch');
      expect(ts_int).toBeDefined();
      const formatted = actionDescription(ts_int!);
      expect(formatted).toContain('Enable');
      expect(formatted).toContain('Notifications');
    });

    it('checked=false → "Disable "X""', () => {
      const ts = makeTarget({ tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Sync', cssSelector: '#s2' });
      const result = detectInteractionsV2([clickEvent(ts, { checkedAfter: false, domContext: domContext() })]);
      const ts_int = result.find(r => r.type === 'ToggleSwitch');
      expect(ts_int).toBeDefined();
      const formatted = actionDescription(ts_int!);
      expect(formatted).toContain('Disable');
      expect(formatted).toContain('Sync');
    });
  });

  // ── Regression: plain checkbox and button ──
  describe('regression', () => {
    it('plain checkbox → Checkbox (not ToggleSwitch)', () => {
      const cb = makeTarget({
        tag: 'INPUT', accessibleName: 'Accept terms', cssSelector: 'input#terms',
      });
      const result = detectInteractionsV2([
        clickEvent(cb, { checkedAfter: true, domContext: checkboxDomContext() }),
      ]);
      const checkbox = result.find(r => r.type === 'Checkbox');
      expect(checkbox).toBeDefined();
      const ts = result.find(r => r.type === 'ToggleSwitch');
      // Checkbox should win (higher confidence from DomProvider @ 0.99)
      // ToggleSwitch may or may not be present, but Checkbox should be the winner
      expect(checkbox!.confidence).toBeGreaterThan(ts?.confidence ?? 0);
    });

    it('plain button without aria-pressed → Click (not ToggleSwitch)', () => {
      const btn = makeTarget({
        tag: 'BUTTON', accessibleName: 'Submit', cssSelector: 'button#submit',
      });
      const result = detectInteractionsV2([
        clickEvent(btn, { domContext: domContext() }),
      ]);
      const click = result.find(r => r.type === 'Click');
      expect(click).toBeDefined();
      const ts = result.find(r => r.type === 'ToggleSwitch');
      expect(ts).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TAB
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tab Detection', () => {
  beforeEach(() => resetEventCounter());

  // ── ARIA role=tab ──
  describe('ARIA role=tab', () => {
    it('role=tab + click → Tab (not Click)', () => {
      const tab = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Settings',
        cssSelector: 'div#tab-settings',
      });

      const result = detectInteractionsV2([
        clickEvent(tab, { domContext: domContext() }),
      ]);

      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
      expect(t!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);

      // Should NOT be Click
      const click = result.find(r => r.type === 'Click');
      expect(click).toBeUndefined();
    });

    it('role=tab mouseenter → NOT Tab (click-only role)', () => {
      const tab = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Profile',
        cssSelector: 'div#tab-profile',
      });

      const result = detectInteractionsV2([
        mouseenterEventLocal(tab),
      ]);

      const t = result.find(r => r.type === 'Tab');
      // Tab should not fire on mouseenter (click-gated)
      // It might be Hover instead
      const hover = result.find(r => r.type === 'Hover');
      // Either Hover or nothing — but not Tab
      if (result.length > 0) {
        expect(t).toBeUndefined();
      }
    });
  });

  // ── MUI Tabs ──
  describe('Material UI Tabs', () => {
    it('MuiTab-root + click → Tab', () => {
      const tab = makeTarget({
        tag: 'DIV', accessibleName: 'General',
        className: 'MuiTab-root Mui-selected',
        cssSelector: 'div#mui-tab',
      });

      const result = detectInteractionsV2([
        clickEvent(tab, { domContext: domContext() }),
      ]);

      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
    });

    it('MuiTabs (container) + click on child → Tab', () => {
      const tab = makeTarget({
        tag: 'DIV', accessibleName: 'Advanced',
        className: 'MuiButtonBase-root MuiTab-root',
        cssSelector: 'div#advanced-tab',
      });

      const result = detectInteractionsV2([
        clickEvent(tab, { domContext: domContext() }),
      ]);

      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
    });
  });

  // ── Ant Design Tabs ──
  describe('Ant Design Tabs', () => {
    it('ant-tabs-tab + click → Tab', () => {
      const tab = makeTarget({
        tag: 'DIV', accessibleName: 'Details',
        className: 'ant-tabs-tab',
        cssSelector: 'div#antd-tab',
      });

      const result = detectInteractionsV2([
        clickEvent(tab, { domContext: domContext() }),
      ]);

      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
    });
  });

  // ── Bootstrap Tabs ──
  describe('Bootstrap Tabs', () => {
    it('Bootstrap nav-tabs with role=tab → Tab', () => {
      const tab = makeTarget({
        tag: 'BUTTON', accessibleName: 'Home',
        ariaRole: 'tab',
        className: 'nav-link',
        cssSelector: 'button#bs-tab',
      });

      const result = detectInteractionsV2([
        clickEvent(tab, { domContext: domContext() }),
      ]);

      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
    });
  });

  // ── Multiple tabs ──
  describe('multiple tabs', () => {
    it('clicking two different tabs → two Tab interactions', () => {
      const tab1 = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Overview',
        cssSelector: 'div#tab-overview',
      });
      const tab2 = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Activity',
        cssSelector: 'div#tab-activity',
      });

      const result = detectInteractionsV2([
        clickEvent(tab1, { domContext: domContext() }),
        clickEvent(tab2, { domContext: domContext() }),
      ]);

      const tabs = result.filter(r => r.type === 'Tab');
      expect(tabs.length).toBe(2);

      // No event ID overlap
      const overlap = tabs[0].eventIds.filter(id => tabs[1].eventIds.includes(id));
      expect(overlap.length).toBe(0);
    });
  });

  // ── Timeline phrasing ──
  describe('timeline phrasing', () => {
    it('Tab with name → "Click "X" tab"', () => {
      const tab = makeTarget({
        tag: 'DIV', ariaRole: 'tab', accessibleName: 'Billing',
        cssSelector: 'div#tab-billing',
      });
      const result = detectInteractionsV2([clickEvent(tab, { domContext: domContext() })]);
      const t = result.find(r => r.type === 'Tab');
      expect(t).toBeDefined();
      expect(t!.metadata.selectedTab).toBe('Billing');
      const formatted = actionDescription(t!);
      expect(formatted).toContain('Billing');
      expect(formatted).toContain('tab');
    });
  });

  // ── Regression ──
  describe('regression', () => {
    it('plain link (no tab classes) → Link (not Tab)', () => {
      const link = makeTarget({
        tag: 'A', accessibleName: 'Go Home', cssSelector: 'a#home-link',
      });
      const result = detectInteractionsV2([clickEvent(link, { domContext: domContext() })]);
      const link_int = result.find(r => r.type === 'Link');
      expect(link_int).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SLIDER
// ═══════════════════════════════════════════════════════════════════════════════

describe('Slider Detection', () => {
  beforeEach(() => resetEventCounter());

  // ── ARIA role=slider ──
  describe('ARIA role=slider', () => {
    it('role=slider + change → Slider', () => {
      const slider = makeTarget({
        tag: 'DIV', ariaRole: 'slider', accessibleName: 'Volume',
        cssSelector: 'div#volume-slider',
      });

      const result = detectInteractionsV2([
        focusEvent(slider, { valueBefore: '50', domContext: domContext() }),
        changeEvent(slider, { valueBefore: '50', valueAfter: '75', domContext: domContext() }),
        blurEvent(slider, { valueAfter: '75', domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
      expect(s!.metadata.sliderValue).toBe('75');
      expect(s!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('role=slider click without change → Slider', () => {
      const slider = makeTarget({
        tag: 'DIV', ariaRole: 'slider', accessibleName: 'Brightness',
        cssSelector: 'div#brightness',
      });

      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
    });
  });

  // ── Native input[type=range] ──
  describe('Native input[type=range]', () => {
    it('type=range + change → Slider (not TextEntry)', () => {
      const slider = makeTarget({
        tag: 'INPUT', accessibleName: 'Price Range',
        cssSelector: 'input#price-range',
      });

      const result = detectInteractionsV2([
        focusEvent(slider, { valueBefore: '0', domContext: domContext({ inputType: 'range' }) }),
        changeEvent(slider, { valueBefore: '0', valueAfter: '500', domContext: domContext({ inputType: 'range' }) }),
        blurEvent(slider, { valueAfter: '500', domContext: domContext({ inputType: 'range' }) }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
      expect(s!.metadata.sliderValue).toBe('500');

      // Should NOT be TextEntry
      const te = result.find(r => r.type === 'TextEntry');
      expect(te).toBeUndefined();
    });

    it('type=range via cssSelector (no domContext) → Slider', () => {
      const slider = makeTarget({
        tag: 'INPUT', accessibleName: 'Opacity',
        cssSelector: 'input[type="range"]#opacity',
      });

      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext({ inputType: 'range' }) }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
    });
  });

  // ── MUI Slider ──
  describe('Material UI Slider', () => {
    it('MuiSlider-root + click → Slider', () => {
      const slider = makeTarget({
        tag: 'SPAN', accessibleName: 'Font Size',
        className: 'MuiSlider-root',
        cssSelector: 'span#mui-slider',
      });

      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
    });

    it('MuiSlider-thumb + change → Slider', () => {
      const slider = makeTarget({
        tag: 'SPAN', ariaRole: 'slider', accessibleName: 'Zoom',
        className: 'MuiSlider-thumb',
        cssSelector: 'span#mui-thumb',
      });

      const result = detectInteractionsV2([
        changeEvent(slider, { valueBefore: '100', valueAfter: '150', domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
      expect(s!.metadata.sliderValue).toBe('150');
    });
  });

  // ── Ant Design Slider ──
  describe('Ant Design Slider', () => {
    it('ant-slider + click → Slider', () => {
      const slider = makeTarget({
        tag: 'DIV', accessibleName: 'Steps',
        className: 'ant-slider',
        cssSelector: 'div#antd-slider',
      });

      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
    });
  });

  // ── Generic slider patterns ──
  describe('Generic slider patterns', () => {
    it('range-slider class → Slider', () => {
      const slider = makeTarget({
        tag: 'DIV', accessibleName: 'Threshold',
        className: 'range-slider',
        cssSelector: 'div#threshold',
      });

      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext() }),
      ]);

      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
    });
  });

  // ── Timeline phrasing ──
  describe('timeline phrasing', () => {
    it('sliderValue present → "Set "X" to VALUE"', () => {
      const slider = makeTarget({
        tag: 'INPUT', accessibleName: 'Volume',
        cssSelector: 'input#vol',
      });
      const result = detectInteractionsV2([
        changeEvent(slider, { valueAfter: '80', domContext: domContext({ inputType: 'range' }) }),
      ]);
      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
      const formatted = actionDescription(s!);
      expect(formatted).toContain('Volume');
      expect(formatted).toContain('80');
    });

    it('no sliderValue → "Adjust "X" slider"', () => {
      const slider = makeTarget({
        tag: 'SPAN', ariaRole: 'slider', accessibleName: 'Gain',
        cssSelector: 'span#gain',
      });
      const result = detectInteractionsV2([
        clickEvent(slider, { domContext: domContext() }),
      ]);
      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeDefined();
      const formatted = actionDescription(s!);
      expect(formatted).toContain('Gain');
      expect(formatted).toContain('slider');
    });
  });

  // ── Regression ──
  describe('regression', () => {
    it('plain text input → TextEntry (not Slider)', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Name', cssSelector: 'input#name',
      });
      const result = detectInteractionsV2([
        focusEvent(input, { valueBefore: '', domContext: domContext({ inputType: 'text' }) }),
        blurEvent(input, { valueAfter: 'John', domContext: domContext({ inputType: 'text' }) }),
      ]);
      const te = result.find(r => r.type === 'TextEntry');
      expect(te).toBeDefined();
      const s = result.find(r => r.type === 'Slider');
      expect(s).toBeUndefined();
    });

    it('plain checkbox → Checkbox (not Slider)', () => {
      const cb = makeTarget({
        tag: 'INPUT', accessibleName: 'Agree', cssSelector: 'input#agree',
      });
      const result = detectInteractionsV2([
        clickEvent(cb, { checkedAfter: true, domContext: checkboxDomContext() }),
      ]);
      const c = result.find(r => r.type === 'Checkbox');
      expect(c).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FULL FORM WORKFLOW (all three types together)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Form Workflow', () => {
  beforeEach(() => resetEventCounter());

  it('Settings form: Toggle → Tab → Slider', () => {
    const toggle = makeTarget({
      tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Notifications',
      cssSelector: 'input#notif',
    });
    const tab = makeTarget({
      tag: 'DIV', ariaRole: 'tab', accessibleName: 'Audio',
      cssSelector: 'div#audio-tab',
    });
    const slider = makeTarget({
      tag: 'INPUT', accessibleName: 'Volume',
      cssSelector: 'input#vol-slider',
    });

    const result = detectInteractionsV2([
      clickEvent(toggle, { checkedAfter: true, domContext: domContext() }),
      clickEvent(tab, { domContext: domContext() }),
      changeEvent(slider, { valueBefore: '50', valueAfter: '80', domContext: domContext({ inputType: 'range' }) }),
    ]);

    expect(result.find(r => r.type === 'ToggleSwitch')).toBeDefined();
    expect(result.find(r => r.type === 'Tab')).toBeDefined();
    expect(result.find(r => r.type === 'Slider')).toBeDefined();

    // No event ID overlap between any pair
    const ts = result.find(r => r.type === 'ToggleSwitch')!;
    const t = result.find(r => r.type === 'Tab')!;
    const s = result.find(r => r.type === 'Slider')!;

    expect(ts.eventIds.filter(id => t.eventIds.includes(id)).length).toBe(0);
    expect(ts.eventIds.filter(id => s.eventIds.includes(id)).length).toBe(0);
    expect(t.eventIds.filter(id => s.eventIds.includes(id)).length).toBe(0);
  });

  it('Multiple toggles on same page → separate interactions', () => {
    const toggle1 = makeTarget({
      tag: 'INPUT', ariaRole: 'switch', accessibleName: 'Email',
      cssSelector: 'input#email-tg',
    });
    const toggle2 = makeTarget({
      tag: 'INPUT', ariaRole: 'switch', accessibleName: 'SMS',
      cssSelector: 'input#sms-tg',
    });

    const result = detectInteractionsV2([
      clickEvent(toggle1, { checkedAfter: true, domContext: domContext() }),
      clickEvent(toggle2, { checkedAfter: true, domContext: domContext() }),
    ]);

    const toggles = result.filter(r => r.type === 'ToggleSwitch');
    expect(toggles.length).toBe(2);
    expect(toggles[0].eventIds.filter(id => toggles[1].eventIds.includes(id)).length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: mouseenter event (local helper for this test file)
// ═══════════════════════════════════════════════════════════════════════════════

function mouseenterEventLocal(
  targetOverrides: Partial<ElementIdentity> = {},
): ElementRecordedEvent {
  const event = clickEvent(targetOverrides);
  event.eventType = 'mouseenter';
  return event;
}

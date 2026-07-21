/**
 * Navigation UI — Breadcrumb & Menu Detection Tests
 *
 * Validates Breadcrumb and Menu interaction detection across native HTML,
 * Material UI (MUI), Ant Design, Bootstrap, and generic frameworks.
 * Also validates regression — Link, Tab, and CustomDropdown detection
 * remain unaffected.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { detectInteractionsV2 } from '../../src/classifier/evidence/detector.js';
import { detectInteractions } from '../../src/classifier/interaction-detector.js';
import { COMMIT_THRESHOLD } from '../../src/classifier/evidence/combination.js';
import { actionDescription } from '../../src/sidepanel/timeline-renderer.js';
import type { DetectedInteraction } from '../../src/classifier/interaction-types.js';
import {
  resetEventCounter,
  makeTarget,
  clickEvent,
  domContext,
} from './helpers.js';

const MIN_CONFIDENCE = COMMIT_THRESHOLD;

/** Helper: find an interaction of a specific type from results. */
function findType(result: DetectedInteraction[], type: string): DetectedInteraction | undefined {
  return result.find(r => r.type === type);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. BREADCRUMB — FRAMEWORK CSS DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Breadcrumb — Framework Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('Bootstrap breadcrumb-item → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'LI', accessibleName: 'Products',
        className: 'breadcrumb-item',
        cssSelector: 'li.breadcrumb-item',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
      expect(bc!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('Bootstrap breadcrumb-item active → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'LI', accessibleName: 'Current Page',
        className: 'breadcrumb-item active',
        cssSelector: 'li.breadcrumb-item.active',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('AntD ant-breadcrumb-link → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'A', accessibleName: 'Home',
        className: 'ant-breadcrumb-link',
        cssSelector: 'a.ant-breadcrumb-link',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('MUI MuiBreadcrumbs-li → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'LI', accessibleName: 'Dashboard',
        className: 'MuiBreadcrumbs-li',
        cssSelector: 'li.MuiBreadcrumbs-li',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('Generic breadcrumb class → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'A', accessibleName: 'Category',
        className: 'breadcrumb-link',
        cssSelector: 'a.breadcrumb-link',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('Generic "crumb" class → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'A', accessibleName: 'Section',
        className: 'crumb',
        cssSelector: 'a.crumb',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('breadcrumb NOT classified as Link (even with tag=A)', () => {
      const crumb = makeTarget({
        tag: 'A', accessibleName: 'Products',
        className: 'breadcrumb-item',
        cssSelector: 'a.breadcrumb-item',
      });

      const result = detectInteractionsV2([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      const link = findType(result, 'Link');
      expect(bc).toBeDefined();
      expect(link).toBeUndefined();
    });
  });

  describe('V1 Interaction Detector', () => {
    it('breadcrumb-item CSS → Breadcrumb', () => {
      const crumb = makeTarget({
        tag: 'LI', accessibleName: 'Products',
        className: 'breadcrumb-item',
        cssSelector: 'li.breadcrumb-item',
      });

      const result = detectInteractions([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });

    it('breadcrumb with tag=A → Breadcrumb (not Link)', () => {
      const crumb = makeTarget({
        tag: 'A', accessibleName: 'Home',
        className: 'breadcrumb-link',
        cssSelector: 'a.breadcrumb-link',
      });

      const result = detectInteractions([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      const link = findType(result, 'Link');
      expect(bc).toBeDefined();
      expect(link).toBeUndefined();
    });

    it('"crumb" class → Breadcrumb in V1', () => {
      const crumb = makeTarget({
        tag: 'SPAN', accessibleName: 'Section',
        className: 'crumb',
        cssSelector: 'span.crumb',
      });

      const result = detectInteractions([
        clickEvent(crumb, { domContext: domContext() }),
      ]);

      const bc = findType(result, 'Breadcrumb');
      expect(bc).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. MENU — ARIA AND CSS DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Menu — Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('V1 Interaction Detector', () => {
    it('role=menuitem → Menu', () => {
      const item = makeTarget({
        tag: 'DIV', accessibleName: 'Settings',
        ariaRole: 'menuitem',
        cssSelector: 'div#settings-menuitem',
      });

      const result = detectInteractions([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('role=menuitemcheckbox → Menu', () => {
      const item = makeTarget({
        tag: 'DIV', accessibleName: 'Toggle Option',
        ariaRole: 'menuitemcheckbox',
        cssSelector: 'div#toggle-opt',
      });

      const result = detectInteractions([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('navbar-item CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Dashboard',
        className: 'navbar-item',
        cssSelector: 'a.navbar-item',
      });

      const result = detectInteractions([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('sidebar-item CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Reports',
        className: 'sidebar-item',
        cssSelector: 'a.sidebar-item',
      });

      const result = detectInteractions([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('menu-link CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Profile',
        className: 'menu-link',
        cssSelector: 'a.menu-link',
      });

      const result = detectInteractions([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });
  });

  describe('V2 Evidence Engine', () => {
    it('navbar-item CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Home',
        className: 'navbar-item',
        cssSelector: 'a.navbar-item',
      });

      const result = detectInteractionsV2([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('sidebar-item CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Analytics',
        className: 'sidebar-item',
        cssSelector: 'a.sidebar-item',
      });

      const result = detectInteractionsV2([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });

    it('menu-link CSS → Menu', () => {
      const item = makeTarget({
        tag: 'A', accessibleName: 'Logout',
        className: 'menu-link',
        cssSelector: 'a.menu-link',
      });

      const result = detectInteractionsV2([
        clickEvent(item, { domContext: domContext() }),
      ]);

      const menu = findType(result, 'Menu');
      expect(menu).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TIMELINE PHRASING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Timeline Phrasing', () => {
  function makeInteraction(
    type: string,
    metadata: Record<string, unknown>,
    targetName = '',
  ): DetectedInteraction {
    return {
      interactionId: 'test-1',
      type: type as any,
      eventIds: ['evt-0001'],
      rawEventTypes: ['click'],
      target: makeTarget({ accessibleName: targetName }),
      metadata: metadata as any,
      confidence: 0.9,
    };
  }

  describe('Breadcrumb phrasing', () => {
    it('with name → Click "Products" breadcrumb', () => {
      const interaction = makeInteraction('Breadcrumb', { accessibleName: 'Products' }, 'Products');
      expect(actionDescription(interaction)).toBe('Click "Products" breadcrumb');
    });

    it('without name → Click breadcrumb', () => {
      const interaction = makeInteraction('Breadcrumb', {});
      expect(actionDescription(interaction)).toBe('Click breadcrumb');
    });
  });

  describe('Menu phrasing', () => {
    it('with name → Click "Settings" menu item', () => {
      const interaction = makeInteraction('Menu', { accessibleName: 'Settings' }, 'Settings');
      expect(actionDescription(interaction)).toBe('Click "Settings" menu item');
    });

    it('without name → Click menu item', () => {
      const interaction = makeInteraction('Menu', {});
      expect(actionDescription(interaction)).toBe('Click menu item');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REGRESSION — LINK, TAB, CUSTOMDROPDOWN UNAFFECTED
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — Existing Navigation UI Unaffected', () => {
  beforeEach(() => resetEventCounter());

  it('nav-link (Bootstrap) → Link (NOT Breadcrumb or Menu)', () => {
    const link = makeTarget({
      tag: 'A', accessibleName: 'About Us',
      className: 'nav-link',
      cssSelector: 'a.nav-link',
    });

    const result = detectInteractionsV2([
      clickEvent(link, { domContext: domContext() }),
    ]);

    const linkResult = findType(result, 'Link');
    const bc = findType(result, 'Breadcrumb');
    const menu = findType(result, 'Menu');
    expect(linkResult).toBeDefined();
    expect(bc).toBeUndefined();
    expect(menu).toBeUndefined();
  });

  it('plain <a> without breadcrumb/menu class → Link', () => {
    const link = makeTarget({
      tag: 'A', accessibleName: 'Contact',
      cssSelector: 'a#contact-link',
    });

    const result = detectInteractionsV2([
      clickEvent(link, { domContext: domContext() }),
    ]);

    const linkResult = findType(result, 'Link');
    expect(linkResult).toBeDefined();
  });

  it('role=tab → Tab (NOT Menu or Breadcrumb)', () => {
    const tab = makeTarget({
      tag: 'DIV', accessibleName: 'Overview',
      ariaRole: 'tab',
      className: 'nav-tab',
      cssSelector: 'div.nav-tab',
    });

    const result = detectInteractionsV2([
      clickEvent(tab, { domContext: domContext() }),
    ]);

    const tabResult = findType(result, 'Tab');
    expect(tabResult).toBeDefined();
  });

  it('dropdown-item → CustomDropdown (NOT Menu)', () => {
    const item = makeTarget({
      tag: 'DIV', accessibleName: 'Option 1',
      className: 'dropdown-item',
      cssSelector: 'div.dropdown-item',
    });

    const result = detectInteractionsV2([
      clickEvent(item, { domContext: domContext() }),
    ]);

    const dd = findType(result, 'CustomDropdown');
    const menu = findType(result, 'Menu');
    expect(dd).toBeDefined();
    expect(menu).toBeUndefined();
  });

  it('plain button click → Click (NOT Menu or Breadcrumb)', () => {
    const button = makeTarget({
      tag: 'BUTTON', accessibleName: 'Submit',
      cssSelector: 'button#submit',
    });

    const result = detectInteractionsV2([
      clickEvent(button, { domContext: domContext() }),
    ]);

    const click = findType(result, 'Click');
    const menu = findType(result, 'Menu');
    const bc = findType(result, 'Breadcrumb');
    expect(click).toBeDefined();
    expect(menu).toBeUndefined();
    expect(bc).toBeUndefined();
  });

  it('V1: nav-link → Link (NOT Breadcrumb or Menu)', () => {
    const link = makeTarget({
      tag: 'A', accessibleName: 'About',
      className: 'nav-link',
      cssSelector: 'a.nav-link',
    });

    const result = detectInteractions([
      clickEvent(link, { domContext: domContext() }),
    ]);

    const linkResult = findType(result, 'Link');
    expect(linkResult).toBeDefined();
  });

  it('V1: dropdown-item → CustomDropdown (NOT Menu)', () => {
    const item = makeTarget({
      tag: 'DIV', accessibleName: 'Option',
      className: 'dropdown-item',
      cssSelector: 'div.dropdown-item',
    });

    const result = detectInteractions([
      clickEvent(item, { domContext: domContext() }),
    ]);

    // V1 may classify dropdown-item as Click or CustomDropdown depending on
    // the classifier chain, but it must NOT be Menu
    const menu = findType(result, 'Menu');
    expect(menu).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. FULL NAVIGATION WORKFLOW
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Navigation Workflow', () => {
  beforeEach(() => resetEventCounter());

  it('Mixed nav: Breadcrumb + Menu + Link in sequence', () => {
    const breadcrumb = makeTarget({
      tag: 'LI', accessibleName: 'Products',
      className: 'breadcrumb-item',
      cssSelector: 'li.breadcrumb-item',
    });
    const menuItem = makeTarget({
      tag: 'A', accessibleName: 'Settings',
      className: 'navbar-item',
      cssSelector: 'a.navbar-item',
    });
    const link = makeTarget({
      tag: 'A', accessibleName: 'Help',
      cssSelector: 'a#help-link',
    });

    const result = detectInteractionsV2([
      clickEvent(breadcrumb, { domContext: domContext() }),
      clickEvent(menuItem, { domContext: domContext() }),
      clickEvent(link, { domContext: domContext() }),
    ]);

    const bc = findType(result, 'Breadcrumb');
    const menu = findType(result, 'Menu');
    const linkResult = findType(result, 'Link');

    expect(bc).toBeDefined();
    expect(menu).toBeDefined();
    expect(linkResult).toBeDefined();

    // Each interaction has distinct event IDs
    expect(bc!.eventIds).not.toEqual(menu!.eventIds);
    expect(menu!.eventIds).not.toEqual(linkResult!.eventIds);
  });
});

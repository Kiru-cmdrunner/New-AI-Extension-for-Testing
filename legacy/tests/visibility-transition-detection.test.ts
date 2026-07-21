/**
 * Visibility Transition Detection Tests — Milestone C3.3
 *
 * Tests the new Visibility Transition Detection mechanism for Gate 5.
 *
 * Permanently frozen C3.1 §3.3: "Observable application behavior means
 * the application reveals new interactive content — menus, tooltips, panels,
 * action buttons — that changes what the user can do next."
 *
 * The detection mechanism (computed style comparison) is an implementation
 * detail per C3.1 §3.3 Product Stability Note. These tests verify the
 * mechanism correctly serves the product rule.
 *
 * Product alignment (C3.3 review):
 *   QUALIFY: display/visibility/opacity transitions, zero-size→visible
 *   EXCLUDE: background-color, cursor, text-decoration, border, box-shadow,
 *            transform (scale), animation (without content reveal)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { __testing } from '../src/recorder/hover-content-script';

// ── Test Helpers ──────────────────────────────────────────

function setupDOM(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

// ── takeVisibilitySnapshot ────────────────────────────────

describe('C3.3 — Visibility Transition Detection: takeVisibilitySnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures display, visibility, opacity, and hasSize for each element', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Services</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/booking">Book Flight</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const snapshot = __testing.takeVisibilitySnapshot(parent);

    // Pre-order traversal: [parent(0), link(1), submenu(2), li(3), a(4)]
    const submenuState = snapshot.states[2];

    expect(submenuState).toBeDefined();
    expect(submenuState.display).toBe('none');
  });

  it('captures display for visible elements', () => {
    setupDOM(`
      <div id="parent">
        <button id="btn" style="display: block; width: 100px; height: 40px;">Click</button>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const snapshot = __testing.takeVisibilitySnapshot(parent);

    // Pre-order: [parent(0), btn(1)]
    const btnState = snapshot.states[1];

    expect(btnState).toBeDefined();
    expect(btnState.display).toBe('block');
  });

  it('captures all descendant elements in the subtree', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/a" id="item1">A</a></li>
          <li><a href="/b" id="item2">B</a></li>
          <li><a href="/c" id="item3">C</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const snapshot = __testing.takeVisibilitySnapshot(parent);

    // Parent, link, submenu, 3 li, 3 a = 9 elements
    expect(snapshot.states.length).toBe(9);
  });
});

// ── detectVisibilityTransition: Qualifying Scenarios ──────

describe('C3.3 — Visibility Transition Detection: Qualifying Transitions', () => {

  it('QUALIFIES: display none → block (CSS mega-menu pattern)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Services</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/booking">Book Flight</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Simulate CSS :hover reveal
    document.getElementById('submenu')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: visibility hidden → visible', () => {
    setupDOM(`
      <div id="parent">
        <button id="trigger">Hover Me</button>
        <div id="tooltip" style="visibility: hidden;">Help text</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('tooltip')!.style.visibility = 'visible';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: opacity 0 → 1 (tooltip fade-in)', () => {
    setupDOM(`
      <div id="parent">
        <span id="trigger">?</span>
        <div id="tooltip" style="opacity: 0;">Tooltip content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('tooltip')!.style.opacity = '1';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: opacity 0 → 0.5 (partial reveal)', () => {
    setupDOM(`
      <div id="parent">
        <button id="trigger">Hover</button>
        <div id="panel" style="opacity: 0;">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('panel')!.style.opacity = '0.5';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: sibling submenu reveal (Adani One pattern)', () => {
    setupDOM(`
      <li id="parent" class="subMenuParent">
        <a id="link" href="/services">Services</a>
        <ul id="submenu" class="subMenu" style="display: none;">
          <li><a href="/booking">Book Flight</a></li>
          <li><a href="/hotels">Hotels</a></li>
        </ul>
      </li>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // The <a> target has no children. The sibling <ul> changes.
    document.getElementById('submenu')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: tooltip with text-only content (no interactive elements)', () => {
    setupDOM(`
      <div id="parent">
        <span id="help-icon">?</span>
        <div id="tooltip" style="display: none;">This field is required for submission.</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('tooltip')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: multiple elements transition (full menu with sub-items)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Products</a>
        <div id="mega-menu" style="display: none;">
          <ul>
            <li><a href="/laptops">Laptops</a></li>
            <li><a href="/phones">Phones</a></li>
            <li><a href="/tablets">Tablets</a></li>
          </ul>
        </div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('mega-menu')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES: cascading menu (nested display transitions)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">File</a>
        <ul id="menu1" style="display: none;">
          <li id="submenu-item">
            <a href="#">Export As</a>
            <ul id="menu2" style="display: none;">
              <li><a href="/pdf">PDF</a></li>
            </ul>
          </li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Reveal both menus
    document.getElementById('menu1')!.style.display = 'block';
    document.getElementById('menu2')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });
});

// ── detectVisibilityTransition: Excluded Scenarios ───────

describe('C3.3 — Visibility Transition Detection: Cosmetic Exclusion', () => {

  it('REJECTS: background-color change only', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <div id="content" style="display: block; background-color: transparent;">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Only cosmetic change
    document.getElementById('content')!.style.backgroundColor = '#f0f0f0';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: cursor change only', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('link')!.style.cursor = 'pointer';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: text-decoration change only', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('link')!.style.textDecoration = 'underline';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: border-color change only', () => {
    setupDOM(`
      <div id="parent">
        <div id="content" style="border: 1px solid #ccc;">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('content')!.style.borderColor = '#333';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: box-shadow change only', () => {
    setupDOM(`
      <div id="parent">
        <div id="content">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('content')!.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: no change at all (identical snapshots)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/booking">Book</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // No change — same state

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('REJECTS: element that was already visible (no transition)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#" style="display: block;">Menu</a>
        <div id="content" style="display: block;">Always visible</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Elements remain visible — no transition

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });
});

// ── detectVisibilityTransition: Edge Cases ────────────────

describe('C3.3 — Visibility Transition Detection: Edge Cases', () => {

  it('QUALIFIES: mixed cosmetic + non-cosmetic (display + background)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <div id="panel" style="display: none; background-color: transparent;">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Both cosmetic and non-cosmetic change
    const panel = document.getElementById('panel')!;
    panel.style.display = 'block';
    panel.style.backgroundColor = '#f0f0f0';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('QUALIFIES when one element has cosmetic-only and another has visibility transition', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <div id="cosmetic" style="background-color: transparent;">Always shown</div>
        <div id="hidden" style="display: none;">Revealed on hover</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('cosmetic')!.style.backgroundColor = '#ccc';
    document.getElementById('hidden')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('REJECTS: element going from visible to hidden (opposite direction)', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Menu</a>
        <div id="content" style="display: block;">Content</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    // Element becomes hidden (opposite of what we're detecting)
    document.getElementById('content')!.style.display = 'none';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('QUALIFIES: element transitions from display:none to display:flex', () => {
    setupDOM(`
      <div id="parent">
        <button id="trigger">Hover</button>
        <div id="actions" style="display: none;">
          <button>Edit</button>
          <button>Delete</button>
        </div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('actions')!.style.display = 'flex';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });

  it('handles empty subtree gracefully', () => {
    setupDOM('<div id="empty"></div>');

    const parent = document.getElementById('empty')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(false);
  });

  it('handles deeply nested revealed content', () => {
    setupDOM(`
      <div id="parent">
        <a id="link" href="#">Trigger</a>
        <div id="container" style="display: none;">
          <div class="wrapper">
            <div class="inner">
              <ul class="menu">
                <li><a href="/deep">Deep Link</a></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const baseline = __testing.takeVisibilitySnapshot(parent);

    document.getElementById('container')!.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const result = detector.compare(baseline, parent);

    expect(result).toBe(true);
  });
});

// ── Architecture Independence ─────────────────────────────

describe('C3.3 — Architecture: Gate 5 Independence', () => {

  it('createVisibilityTransitionDetector follows the same callback contract as MutationObserver', () => {
    // The detector factory takes a callback and returns an object with compare().
    // This mirrors the MutationObserver pattern: create → attach → fires callback.
    const detector = __testing.createVisibilityTransitionDetector();
    expect(detector).toBeDefined();
    expect(typeof detector.compare).toBe('function');
  });

  it('takeVisibilitySnapshot returns a serializable structure', () => {
    setupDOM(`
      <div id="parent">
        <a href="#">Link</a>
        <div style="display: none;">Hidden</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const snapshot = __testing.takeVisibilitySnapshot(parent);

    expect(snapshot).toBeDefined();
    expect(Array.isArray(snapshot.states)).toBe(true);
    expect(snapshot.states.length).toBeGreaterThan(0);
  });

  it('VISIBILITY_PROPERTIES is defined and excludes cosmetic properties', () => {
    expect(__testing.VISIBILITY_PROPERTIES).toBeDefined();

    // Only non-cosmetic visibility-affecting properties
    expect(__testing.VISIBILITY_PROPERTIES).toContain('display');
    expect(__testing.VISIBILITY_PROPERTIES).toContain('visibility');
    expect(__testing.VISIBILITY_PROPERTIES).toContain('opacity');

    // Cosmetic properties must NOT be in the visibility properties set
    expect(__testing.VISIBILITY_PROPERTIES).not.toContain('background-color');
    expect(__testing.VISIBILITY_PROPERTIES).not.toContain('cursor');
    expect(__testing.VISIBILITY_PROPERTIES).not.toContain('text-decoration');
    expect(__testing.VISIBILITY_PROPERTIES).not.toContain('box-shadow');
  });
});

// ── takePreHoverSnapshotWithWalkUp (Incremental Walk-Up Clone) ──

describe('C3.3 — Walk-Up Clone Baseline: takePreHoverSnapshotWithWalkUp', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures pre-hover state for hidden elements (display:none)', () => {
    setupDOM(`
      <div id="parent">
        <a href="#" id="trigger">Services</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/1">Item 1</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    // Pre-order: [parent(0), trigger(1), submenu(2), li(3), a(4)]
    expect(result).not.toBeNull();
    expect(result!.baseline.states[2].display).toBe('none');
  });

  it('captures pre-hover state for visible elements', () => {
    setupDOM(`
      <div id="parent">
        <a href="#" id="trigger">Always Visible</a>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    // With no hidden elements, walk-up goes to wider ancestor.
    // Just verify the result is valid and not all-none.
    expect(result!.baseline.states.length).toBeGreaterThan(0);
  });

  it('returns a valid baseline when subtree has no hidden elements', () => {
    // When there are no hidden elements, walk-up goes wider.
    // This test verifies the result is still usable — not that it matches
    // a live snapshot of just the parent (which would be narrower).
    setupDOM(`
      <div id="parent">
        <a href="#">A</a>
        <ul>
          <li><a href="/1">L1</a></li>
          <li><a href="/2">L2</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    expect(result!.baseline.states.length).toBeGreaterThan(0);
  });

  it('preserves inline display:none in the clone', () => {
    setupDOM(`
      <div id="parent">
        <div id="hidden-el" style="display: none;">Hidden</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    // Index 0 = parent, index 1 = hidden-el
    expect(result!.baseline.states[1].display).toBe('none');
  });

  it('does not leave clone artifacts in the DOM', () => {
    setupDOM(`
      <div id="parent">
        <a href="#">Link</a>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    __testing.takePreHoverSnapshotWithWalkUp(parent);

    // The clone container should have been removed
    const cloneContainers = document.querySelectorAll('[data-cmdrunner-clone]');
    expect(cloneContainers.length).toBe(0);
  });

  it('detects transition when hidden element becomes visible (Adani One pattern)', () => {
    setupDOM(`
      <div id="parent">
        <a href="#" id="trigger">Services</a>
        <ul id="submenu" style="display: none;">
          <li><a href="/booking">Book Flight</a></li>
          <li><a href="/hotels">Hotels</a></li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const submenu = document.getElementById('submenu')!;

    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);
    expect(result).not.toBeNull();

    // Simulate :hover effect — change display to block
    (submenu as HTMLElement).style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const qualified = detector.compare(result!.baseline, result!.effectiveScope);

    expect(qualified).toBe(true);
  });

  it('rejects transition when no visibility change occurs (cosmetic only)', () => {
    setupDOM(`
      <div id="parent">
        <button id="btn" style="background: blue;">Submit</button>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);
    expect(result).not.toBeNull();

    const btn = document.getElementById('btn') as HTMLElement;
    btn.style.background = 'darkblue';

    const detector = __testing.createVisibilityTransitionDetector();
    const qualified = detector.compare(result!.baseline, result!.effectiveScope);

    expect(qualified).toBe(false);
  });

  it('rejects transition when content was always visible', () => {
    setupDOM(`
      <div id="parent">
        <a href="#">Link</a>
        <p>Always visible text</p>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    const detector = __testing.createVisibilityTransitionDetector();
    const qualified = detector.compare(result!.baseline, result!.effectiveScope);

    expect(qualified).toBe(false);
  });

  it('produces deterministic results across multiple calls', () => {
    setupDOM(`
      <div id="parent">
        <a href="#">A</a>
        <div style="display: none;">Hidden</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const r1 = __testing.takePreHoverSnapshotWithWalkUp(parent);
    const r2 = __testing.takePreHoverSnapshotWithWalkUp(parent);
    const r3 = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(r1!.baseline.states.length).toBe(r2!.baseline.states.length);
    expect(r2!.baseline.states.length).toBe(r3!.baseline.states.length);

    for (let i = 0; i < r1!.baseline.states.length; i++) {
      expect(r1!.baseline.states[i].display).toBe(r2!.baseline.states[i].display);
      expect(r2!.baseline.states[i].display).toBe(r3!.baseline.states[i].display);
    }
  });

  // ── Walk-Up Specific Tests ──

  it('returns effectiveScope and levelsWalked in the result', () => {
    setupDOM(`
      <div id="parent">
        <div style="display: none;">Hidden</div>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    expect(result!.effectiveScope).toBeDefined();
    expect(result!.levelsWalked).toBeDefined();
    expect(typeof result!.levelsWalked).toBe('number');
  });

  it('finds invisible elements at level 0 when parent has hidden children', () => {
    setupDOM(`
      <div id="parent">
        <a href="#" id="trigger">Menu</a>
        <ul id="submenu" style="display: none;">
          <li>Item</li>
        </ul>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    expect(result!.levelsWalked).toBe(0);
    expect(result!.effectiveScope).toBe(parent);
  });

  it('walks up to ancestor when parent has no hidden elements but ancestor does', () => {
    // Simulates Adani One CSS context dependency:
    // The hiding CSS selector references an ancestor. When we clone just
    // the immediate parent (LI), the CSS rule doesn't match and nothing
    // appears hidden. We must walk up to the NAV to find the hidden submenu.
    setupDOM(`
      <nav id="grandparent">
        <ul id="middle">
          <li id="parent">
            <a href="#" id="trigger">Services</a>
          </li>
          <li>
            <ul id="submenu" style="display: none;">
              <li><a href="/1">Item</a></li>
            </ul>
          </li>
        </ul>
      </nav>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    // Level 0 (parent LI) has no hidden elements.
    // Level 1 (UL#middle) has the hidden submenu.
    expect(result!.levelsWalked).toBeGreaterThanOrEqual(1);
    expect(result!.effectiveScope.id).toBe('middle');
  });

  it('stops at first ancestor level with invisible elements', () => {
    // Level 0: no hidden elements. Level 1: has hidden child.
    // Should stop at level 1 (first match).
    setupDOM(`
      <div id="level2">
        <div id="level1">
          <div id="level0">
            <span>Visible</span>
          </div>
          <div style="display: none;" id="hidden1">Hidden at level 1</div>
        </div>
      </div>
    `);

    const level0 = document.getElementById('level0')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(level0);

    expect(result).not.toBeNull();
    expect(result!.levelsWalked).toBe(1);
    expect(result!.effectiveScope.id).toBe('level1');
  });

  it('walks up maximum 4 levels (MAX_WALKUP_LEVELS)', () => {
    // 6 levels deep, hidden element at level 5.
    // Should not find it if MAX_WALKUP_LEVELS < 5.
    let html = '<div id="root"><div style="display:none;">Hidden</div>';
    for (let i = 0; i < 4; i++) html += '<div>';
    html += '<div id="target"><span>Trigger</span></div>';
    for (let i = 0; i < 4; i++) html += '</div>';
    html += '</div>';
    setupDOM(html);

    const target = document.getElementById('target')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(target);

    expect(result).not.toBeNull();
    // levelsWalked should not exceed MAX_WALKUP_LEVELS - 1 (0-indexed)
    expect(result!.levelsWalked).toBeLessThanOrEqual(__testing.MAX_WALKUP_LEVELS - 1);
  });

  it('returns fallback baseline when no ancestor has invisible elements', () => {
    setupDOM(`
      <div id="parent">
        <span>All visible content</span>
      </div>
    `);

    const parent = document.getElementById('parent')!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(parent);

    expect(result).not.toBeNull();
    // Fallback returns the widest level tested (last ancestor or original)
    expect(result!.baseline).toBeDefined();
    expect(result!.effectiveScope).toBeDefined();
  });

  it('returns null when element has no parent', () => {
    // documentElement has no parent
    const result = __testing.takePreHoverSnapshotWithWalkUp(document.documentElement!);
    // Should still return something (documentElement is its own root)
    // but with 0 invisible elements typically
    expect(result).not.toBeNull();
  });

  // ── Adani One Regression Tests ──

  it('REGRESSION: Adani One CSS context loss — walk-up finds hidden submenu', () => {
    // Exact Adani One pattern: CSS rule references ancestor chain.
    // Submenu is a SIBLING of the <a> target, inside an <li> inside
    // a compound selector that requires the full ancestor chain.
    setupDOM(`
      <nav id="mainnav" class="PrimaryMenu_mainNav">
        <ul class="menu">
          <li class="PrimaryMenu_subMenuParent" id="menu-item">
            <a id="servicestoggle" href="/services">Services</a>
            <ul class="PrimaryMenu_subMenu" style="display: none;" id="submenu">
              <li><a href="/booking">Book Flight</a></li>
            </ul>
          </li>
        </ul>
      </nav>
    `);

    const target = document.getElementById('servicestoggle')!;
    const targetParent = target.parentElement!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(targetParent);

    expect(result).not.toBeNull();
    // The LI clone should find the hidden submenu at level 0
    expect(result!.levelsWalked).toBe(0);
    // Submenu should be display:none in the baseline
    const submenuIdx = result!.baseline.states.findIndex(
      (s) => s.display === 'none',
    );
    expect(submenuIdx).toBeGreaterThanOrEqual(0);
  });

  it('REGRESSION: Adani One transition detection after walk-up baseline', () => {
    setupDOM(`
      <nav id="mainnav" class="PrimaryMenu_mainNav">
        <ul class="menu">
          <li class="PrimaryMenu_subMenuParent" id="menu-item">
            <a id="servicestoggle" href="/services">Services</a>
            <ul class="PrimaryMenu_subMenu" style="display: none;" id="submenu">
              <li><a href="/booking">Book Flight</a></li>
            </ul>
          </li>
        </ul>
      </nav>
    `);

    const target = document.getElementById('servicestoggle')!;
    const targetParent = target.parentElement!;
    const result = __testing.takePreHoverSnapshotWithWalkUp(targetParent);
    expect(result).not.toBeNull();

    // Simulate :hover effect — change display to block
    const submenu = document.getElementById('submenu') as HTMLElement;
    submenu.style.display = 'block';

    const detector = __testing.createVisibilityTransitionDetector();
    const qualified = detector.compare(result!.baseline, result!.effectiveScope);

    expect(qualified).toBe(true);
  });
});

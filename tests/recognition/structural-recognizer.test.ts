/**
 * Structural Recognizer — unit tests with real-world ARIA fixtures.
 *
 * Tests recognition against actual ARIA structures from:
 *   - WAI-ARIA Authoring Practices Guide (APG) — the canonical reference
 *   - Radix UI — popular headless component library
 *   - Headless UI — Tailwind Labs' component library
 *   - Material UI (MUI) — Google's Material Design implementation
 *   - shadcn/ui — Radix-based, increasingly popular
 *
 * These fixtures use REAL ARIA role structures that these libraries produce.
 * The goal is to prove the recognizer works across real applications.
 */

import { describe, it, expect } from 'vitest';
import {
  recognize,
  type RecognitionInput,
} from '../../src/recorder/recognition/structural-recognizer';
import { PatternType, ComponentRole, RecognitionSource } from '../../src/domain/enums';

// ── Helpers ──────────────────────────────────────────────

function mkElement(elementId: string, ariaRole: string | null, tag = 'div'): {
  elementId: string;
  ariaRole: string | null;
  tag: string;
} {
  return { elementId, ariaRole, tag };
}

function mkInput(
  element: { elementId: string; ariaRole: string | null; tag: string },
  ancestorRoles?: Array<{ elementId: string; ariaRole: string | null; tag: string }>,
  siblingElementRoles?: Array<{ elementId: string; ariaRole: string | null; tag: string }>,
): RecognitionInput {
  return { element, ancestorRoles: ancestorRoles ?? [], siblingElementRoles };
}

// ── WAI-ARIA APG Combobox ────────────────────────────────

describe('Structural Recognizer — WAI-ARIA APG Combobox', () => {
  // Real WAI-ARIA APG combobox structure:
  // https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
  //
  // <div role="combobox" aria-expanded="true">
  //   <input type="text" ... />
  //   <ul role="listbox">
  //     <li role="option">Option 1</li>
  //     <li role="option">Option 2</li>
  //   </ul>
  // </div>

  it('should recognize combobox when user interacts with an option', () => {
    const result = recognize(
      mkInput(
        mkElement('elem-opt1', 'option', 'li'),
        [
          mkElement('elem-combobox', 'combobox'),
          mkElement('elem-listbox', 'listbox'),
        ],
        [
          mkElement('elem-opt1', 'option', 'li'),
          mkElement('elem-opt2', 'option', 'li'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.confidence).toBe(0.95);
    expect(result.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
    expect(result.rootElementId).toBe('elem-combobox');
    expect(result.matchedRole).toBe('combobox');
    expect(result.constituents.length).toBeGreaterThanOrEqual(2);
    expect(result.constituents.some((c) => c.role === ComponentRole.OPTION)).toBe(true);
  });

  it('should recognize combobox when user interacts with the trigger', () => {
    const result = recognize(
      mkInput(
        mkElement('elem-trigger', 'combobox', 'div'),
        [
          mkElement('elem-combobox', 'combobox'),
          mkElement('elem-listbox', 'listbox'),
          mkElement('elem-opt1', 'option'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.rootElementId).toBe('elem-combobox');
    expect(result.constituents.some((c) => c.role === ComponentRole.TRIGGER)).toBe(true);
  });

  it('should recognize standalone listbox (Headless UI Listbox pattern)', () => {
    // Headless UI uses listbox as the root (no combobox trigger)
    // <ul role="listbox">
    //   <li role="option">...</li>
    // </ul>
    const result = recognize(
      mkInput(
        mkElement('elem-opt1', 'option', 'li'),
        [
          mkElement('elem-listbox', 'listbox'),
        ],
        [
          mkElement('elem-opt1', 'option', 'li'),
          mkElement('elem-opt2', 'option', 'li'),
          mkElement('elem-opt3', 'option', 'li'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.rootElementId).toBe('elem-listbox');
    expect(result.matchedRole).toBe('listbox');
  });
});

// ── Radix UI Select ──────────────────────────────────────

describe('Structural Recognizer — Radix UI Select', () => {
  // Radix Select produces:
  // <button role="combobox" aria-expanded="true">
  //   <span>Selected value</span>
  // </button>
  // <div role="listbox">
  //   <div role="option" data-radix-collection-item>
  //     Option 1
  //   </div>
  // </div>

  it('should recognize Radix Select combobox trigger', () => {
    const result = recognize(
      mkInput(
        mkElement('radix-trigger', 'combobox', 'button'),
        [
          mkElement('radix-trigger', 'combobox', 'button'),
          mkElement('radix-listbox', 'listbox', 'div'),
          mkElement('radix-opt1', 'option', 'div'),
          mkElement('radix-opt2', 'option', 'div'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.rootElementId).toBe('radix-trigger');
    expect(result.matchedRole).toBe('combobox');
    expect(result.confidence).toBe(0.95);
  });
});

// ── shadcn/ui (Radix-based) ─────────────────────────────

describe('Structural Recognizer — shadcn/ui Select', () => {
  // shadcn/ui Select is built on Radix and produces identical ARIA:
  // <button role="combobox">
  //   <span>Framework</span>
  // </button>
  // <div role="listbox">
  //   <div role="option">Next.js</div>
  //   <div role="option">Svelte</div>
  // </div>

  it('should recognize shadcn Select when interacting with option', () => {
    const result = recognize(
      mkInput(
        mkElement('shad-opt', 'option', 'div'),
        [
          mkElement('shad-trigger', 'combobox', 'button'),
          mkElement('shad-listbox', 'listbox', 'div'),
        ],
        [
          mkElement('shad-opt1', 'option', 'div'),
          mkElement('shad-opt2', 'option', 'div'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.DROPDOWN);
    expect(result.constituents.some((c) => c.role === ComponentRole.OPTION)).toBe(true);
  });
});

// ── WAI-ARIA APG Radio Group ─────────────────────────────

describe('Structural Recognizer — Radio Group', () => {
  // <div role="radiogroup">
  //   <label>Travel Class</label>
  //   <input type="radio" role="radio" aria-checked="true" />
  //   <input type="radio" role="radio" />
  //   <input type="radio" role="radio" />
  // </div>

  it('should recognize radio group when interacting with a radio', () => {
    const result = recognize(
      mkInput(
        mkElement('radio-economy', 'radio', 'input'),
        [
          mkElement('radio-group', 'radiogroup', 'div'),
        ],
        [
          mkElement('radio-economy', 'radio', 'input'),
          mkElement('radio-premium', 'radio', 'input'),
          mkElement('radio-business', 'radio', 'input'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.RADIO_GROUP);
    expect(result.rootElementId).toBe('radio-group');
    expect(result.matchedRole).toBe('radiogroup');
    expect(result.constituents.some((c) => c.role === ComponentRole.OPTION)).toBe(true);
    expect(result.constituents.some((c) => c.role === ComponentRole.CONTAINER)).toBe(true);
  });

  it('should NOT match radio group when only container is present without radios', () => {
    // radiogroup pattern requires minConstituents: 2 (container + at least 1 radio)
    const result = recognize(
      mkInput(
        mkElement('radio-group', 'radiogroup', 'div'),
        [],
        [], // no radios
      ),
    );

    // Should not match RADIO_GROUP because minConstituents not met
    // But CONTAINER role is assigned — only 1 constituent < minConstituents of 2
    expect(result.patternType).toBeNull();
  });
});

// ── MUI Dialog ───────────────────────────────────────────

describe('Structural Recognizer — MUI Dialog', () => {
  // Material UI Dialog:
  // <div role="dialog" aria-modal="true">
  //   <h2>Dialog Title</h2>
  //   <p>Content</p>
  //   <button>Cancel</button>
  //   <button>OK</button>
  // </div>

  it('should recognize dialog container when interacting with a button inside it', () => {
    const result = recognize(
      mkInput(
        mkElement('mui-ok-btn', 'button', 'button'),
        [
          mkElement('mui-dialog', 'dialog', 'div'),
        ],
        [
          mkElement('mui-cancel-btn', 'button', 'button'),
          mkElement('mui-ok-btn', 'button', 'button'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.MODAL);
    expect(result.rootElementId).toBe('mui-dialog');
    expect(result.matchedRole).toBe('dialog');
  });

  it('should recognize alertdialog variant', () => {
    const result = recognize(
      mkInput(
        mkElement('mui-alert-content', null, 'p'),
        [
          mkElement('mui-alertdialog', 'alertdialog', 'div'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.MODAL);
    expect(result.matchedRole).toBe('alertdialog');
  });
});

// ── MUI / WAI-ARIA Tabs ──────────────────────────────────

describe('Structural Recognizer — Tabs', () => {
  // <div role="tablist">
  //   <button role="tab" aria-selected="true">Tab 1</button>
  //   <button role="tab">Tab 2</button>
  //   <button role="tab">Tab 3</button>
  // </div>
  // <div role="tabpanel">...</div>

  it('should recognize tabs when interacting with a tab', () => {
    const result = recognize(
      mkInput(
        mkElement('tab1', 'tab', 'button'),
        [
          mkElement('tablist', 'tablist', 'div'),
        ],
        [
          mkElement('tab1', 'tab', 'button'),
          mkElement('tab2', 'tab', 'button'),
          mkElement('tab3', 'tab', 'button'),
          mkElement('panel1', 'tabpanel', 'div'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.TABS);
    expect(result.rootElementId).toBe('tablist');
    expect(result.matchedRole).toBe('tablist');
    expect(result.constituents.some((c) => c.role === ComponentRole.TAB)).toBe(true);
  });

  it('should NOT match tabs when only tablist present without tabs', () => {
    const result = recognize(
      mkInput(
        mkElement('tablist', 'tablist', 'div'),
        [],
        [], // no tabs
      ),
    );

    expect(result.patternType).toBeNull();
  });
});

// ── Checkbox ─────────────────────────────────────────────

describe('Structural Recognizer — Checkbox', () => {
  // <div role="checkbox" aria-checked="false" tabindex="0">
  //   Subscribe to newsletter
  // </div>

  it('should recognize checkbox as a single-element component', () => {
    const result = recognize(
      mkInput(
        mkElement('checkbox-news', 'checkbox', 'div'),
        [], // no ancestors needed
      ),
    );

    expect(result.patternType).toBe(PatternType.CHECKBOX);
    expect(result.rootElementId).toBe('checkbox-news');
    expect(result.matchedRole).toBe('checkbox');
    expect(result.constituents).toHaveLength(1);
    expect(result.constituents[0].role).toBe(ComponentRole.TRIGGER);
  });

  it('should recognize native checkbox via ARIA role', () => {
    // Even native <input type="checkbox"> gets implicit role="checkbox"
    const result = recognize(
      mkInput(
        mkElement('native-cb', 'checkbox', 'input'),
        [],
      ),
    );

    expect(result.patternType).toBe(PatternType.CHECKBOX);
  });
});

// ── Non-component elements (should return null) ──────────

describe('Structural Recognizer — non-component elements', () => {
  it('should return null for a standalone button with no ARIA widget context', () => {
    const result = recognize(
      mkInput(
        mkElement('standalone-btn', null, 'button'),
        [],
      ),
    );

    expect(result.patternType).toBeNull();
    expect(result.rootElementId).toBeNull();
    expect(result.constituents).toHaveLength(0);
  });

  it('should return null for a plain text input with no combobox ancestor', () => {
    const result = recognize(
      mkInput(
        mkElement('plain-input', null, 'input'),
        [],
      ),
    );

    expect(result.patternType).toBeNull();
  });

  it('should return null for a paragraph element', () => {
    const result = recognize(
      mkInput(
        mkElement('some-text', null, 'p'),
        [],
      ),
    );

    expect(result.patternType).toBeNull();
  });
});

// ── Specificity ordering ─────────────────────────────────

describe('Structural Recognizer — pattern specificity', () => {
  it('should match radiogroup over listbox when both are in the chain', () => {
    // Edge case: a radiogroup inside something with listbox-like structure.
    // Since radiogroup has 1 root role (more specific) and dropdown has 2,
    // radiogroup should be tried first and should match.
    const result = recognize(
      mkInput(
        mkElement('radio-1', 'radio', 'input'),
        [
          mkElement('rg', 'radiogroup', 'div'),
          mkElement('lb', 'listbox', 'div'),
        ],
      ),
    );

    expect(result.patternType).toBe(PatternType.RADIO_GROUP);
  });
});

// ── Confidence and recognition source ───────────────────

describe('Structural Recognizer — confidence and source', () => {
  it('all structural recognitions should have 0.95 confidence', () => {
    const patterns = [
      // Dropdown
      mkInput(
        mkElement('opt', 'option'),
        [mkElement('cb', 'combobox'), mkElement('lb', 'listbox')],
        [mkElement('opt', 'option'), mkElement('opt2', 'option')],
      ),
      // Checkbox
      mkInput(mkElement('cb', 'checkbox')),
      // Radio group
      mkInput(
        mkElement('r', 'radio'),
        [mkElement('rg', 'radiogroup')],
        [mkElement('r', 'radio'), mkElement('r2', 'radio')],
      ),
      // Modal
      mkInput(mkElement('d', 'dialog')),
      // Tabs
      mkInput(
        mkElement('t', 'tab'),
        [mkElement('tl', 'tablist')],
        [mkElement('t', 'tab'), mkElement('t2', 'tab')],
      ),
    ];

    for (const input of patterns) {
      const result = recognize(input);
      expect(result.confidence).toBe(0.95);
      expect(result.recognitionSource).toBe(RecognitionSource.STRUCTURAL);
    }
  });
});

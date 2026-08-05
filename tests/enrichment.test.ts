/**
 * Tests for the Three-Layer Enrichment Pipeline
 *
 * Tests detectComponent (Layer 2), resolveMeaning (Layer 3),
 * and enrichInteraction (integration of both layers).
 *
 * Architecture: .drytis/specs/three-layer-component-model.md
 */

import { describe, it, expect } from 'vitest';
import { detectComponent } from '../src/enrichment/component-detector';
import { resolveMeaning } from '../src/enrichment/meaning-resolver';
import { enrichInteraction } from '../src/enrichment/enrich';
import type { ComponentInteraction, ObservedEvent } from '../src/shared/component-types';
import type { ElementIdentity } from '../src/shared/types';

// ── Helpers ───────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    tag: 'BUTTON',
    cssPath: 'body > button',
    accessibleName: '',
    ariaLabel: null,
    textContent: '',
    href: null,
    type: null,
    inputType: null,
    role: null,
    ariaRole: null,
    className: null,
    id: null,
    value: null,
    placeholder: null,
    checkedBefore: null,
    checkedAfter: null,
    elementKey: 'btn-0',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  const target = overrides.target ? makeTarget(overrides.target) : makeTarget();
  return {
    eventId: 'evt-1-0',
    eventType: 'click',
    timestamp: 1000,
    isTrusted: true,
    target,
    domContext: {
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
    },
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: 100,
    clientY: 200,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com',
    pageTitle: 'Example',
    ...overrides,
    target,
  };
}

function makeInteraction(
  type: ComponentInteraction['type'],
  metadata: Record<string, unknown>,
  eventOverrides: Partial<ObservedEvent> = {},
): ComponentInteraction {
  const event = makeEvent(eventOverrides);
  return {
    interactionId: 'int-0',
    type,
    trigger: event.target,
    triggerEvent: event,
    memberEvents: [event],
    startTime: 1000,
    endTime: 2000,
    endState: 'completed',
    metadata: {
      targetName: metadata.targetName ?? 'Submit',
      ...metadata,
    },
  };
}

// ── Layer 2: Component Detection ──────────────────────────────────────

describe('Layer 2: Component Detection (detectComponent)', () => {
  it('detects MUI DataGrid from className', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'DIV',
        className: 'MuiDataGrid-root',
        elementKey: 'grid-0',
        accessibleName: 'Users',
        ariaRole: 'grid',
        textContent: 'Users',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('DataGrid');
    expect(result.componentFramework).toBe('MUI');
  });

  it('detects AG Grid from ancestor classes', () => {
    const event = makeEvent({
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['ag-header-cell', 'ag-theme-alpine'],
        tabIndex: null,
      },
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('DataGrid');
    expect(result.componentFramework).toBe('AGGrid');
  });

  it('detects AntDesign table', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'TD',
        className: 'ant-table-cell',
        elementKey: 'cell-0',
        accessibleName: 'John',
        ariaRole: 'gridcell',
        textContent: 'John',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('DataGrid');
    expect(result.componentFramework).toBe('AntDesign');
  });

  it('detects IconButton from button with no text', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'BUTTON',
        className: 'MuiIconButton-root',
        elementKey: 'icon-btn-0',
        accessibleName: '',
        ariaRole: null,
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('IconButton');
    expect(result.componentFramework).toBe('MUI');
  });

  it('detects SortButton from className with "sort"', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'DIV',
        className: 'ag-header-cell sort-asc',
        elementKey: 'sort-0',
        accessibleName: 'Name',
        ariaRole: 'columnheader',
        textContent: 'Name',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('SortButton');
    expect(result.componentFramework).toBe('AGGrid');
  });

  it('detects Dialog from aria-role', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'DIV',
        className: 'some-overlay',
        elementKey: 'dialog-0',
        accessibleName: 'Settings',
        ariaRole: 'dialog',
        textContent: 'Settings',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('Dialog');
  });

  it('detects OXD framework from ancestor classes', () => {
    const event = makeEvent({
      domContext: {
        inputType: null,
        ariaExpanded: null,
        ariaHasPopup: null,
        isContentEditable: false,
        disabled: false,
        readOnly: false,
        required: false,
        ancestorRoles: [],
        ancestorClasses: ['oxd-table-row', 'oxd-table-card'],
        tabIndex: null,
      },
    });
    const result = detectComponent(event);
    expect(result.componentFramework).toBe('OXD');
  });

  it('detects ChakraUI from className', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'BUTTON',
        className: 'chakra-button css-1a2b3c',
        elementKey: 'chakra-0',
        accessibleName: 'Action',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentFramework).toBe('ChakraUI');
  });

  it('detects RadixUI from className', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'BUTTON',
        className: 'radix-trigger',
        elementKey: 'radix-0',
        accessibleName: 'Open',
        ariaRole: null,
      }),
    });
    const result = detectComponent(event);
    expect(result.componentFramework).toBe('RadixUI');
  });

  it('detects TreeView from aria-role treeitem', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'DIV',
        className: 'tree-node',
        elementKey: 'tree-0',
        accessibleName: 'Folder A',
        ariaRole: 'treeitem',
        textContent: 'Folder A',
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('TreeView');
  });

  it('returns Generic for unstyled non-button elements', () => {
    const event = makeEvent({
      target: makeTarget({ tag: 'DIV', accessibleName: 'Content', textContent: 'Content' }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('Generic');
    expect(result.componentFramework).toBe('Generic');
  });

  it('extracts icon name from fa-search class', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'BUTTON',
        className: 'fa-search',
        elementKey: 'icon-0',
        accessibleName: '',
        ariaRole: null,
      }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('IconButton');
    expect(result.componentData.iconName).toBe('Search');
  });

  it('extracts icon name from fa-trash class', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'BUTTON',
        className: 'fas fa-trash',
        elementKey: 'icon-1',
        accessibleName: '',
        ariaRole: null,
      }),
    });
    const result = detectComponent(event);
    expect(result.componentData.iconName).toBe('Delete');
  });
});

// ── Layer 3: Meaning Resolution ────────────────────────────────────────

describe('Layer 3: Meaning Resolution (resolveMeaning)', () => {
  it('generates "Sort by Name" for SortButton Click', () => {
    const interaction = makeInteraction('Click', { targetName: 'Name' });
    const detection = {
      componentType: 'SortButton' as const,
      componentFramework: 'AGGrid' as const,
      businessMeaning: '',
      componentData: { columnName: 'Name' },
    };
    expect(resolveMeaning(interaction, detection)).toBe('Sort by Name');
  });

  it('generates "Switch to Grid View" for GridToggle Click', () => {
    const interaction = makeInteraction('Click', { targetName: 'Grid View' });
    const detection = {
      componentType: 'GridToggle' as const,
      componentFramework: 'Generic' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Switch to Grid View');
  });

  it('generates "Click Close button" for IconButton', () => {
    const interaction = makeInteraction('Click', { targetName: 'Close' });
    const detection = {
      componentType: 'IconButton' as const,
      componentFramework: 'MUI' as const,
      businessMeaning: '',
      componentData: { iconName: 'Close' },
    };
    expect(resolveMeaning(interaction, detection)).toBe('Click Close button');
  });

  it('generates rating meaning from metadata value', () => {
    const interaction = makeInteraction('Click', {
      targetName: 'Product Quality',
      value: 4,
    });
    const detection = {
      componentType: 'Rating' as const,
      componentFramework: 'MUI' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Rate 4 stars for Product Quality');
  });

  it('generates toggle switch meaning from metadata checked', () => {
    const interaction = makeInteraction('Click', {
      targetName: 'Dark Mode',
      checked: true,
    });
    const detection = {
      componentType: 'ToggleSwitch' as const,
      componentFramework: 'MUI' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Enable Dark Mode');
  });

  it('generates breadcrumb meaning', () => {
    const interaction = makeInteraction('Click', { targetName: 'Home' });
    const detection = {
      componentType: 'Breadcrumb' as const,
      componentFramework: 'AntDesign' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Navigate to Home via breadcrumb');
  });

  it('generates fallback Click meaning for Generic component', () => {
    const interaction = makeInteraction('Click', { targetName: 'Submit' });
    const detection = {
      componentType: 'Generic' as const,
      componentFramework: 'Generic' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Click "Submit"');
  });

  it('generates TextEntry fallback for Generic', () => {
    const interaction = makeInteraction('TextEntry', {
      targetName: 'Search Box',
      textValue: 'laptop',
    });
    const detection = {
      componentType: 'Generic' as const,
      componentFramework: 'Generic' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Enter "laptop" in "Search Box"');
  });

  it('generates dropdown fallback for Generic', () => {
    const interaction = makeInteraction('Dropdown', {
      targetName: 'Country',
      selectedValue: 'United States',
    });
    const detection = {
      componentType: 'Generic' as const,
      componentFramework: 'Generic' as const,
      businessMeaning: '',
      componentData: {},
    };
    expect(resolveMeaning(interaction, detection)).toBe('Select "United States" from "Country"');
  });
});

// ── Integration: enrichInteraction ─────────────────────────────────────

describe('Integration: enrichInteraction', () => {
  it('enriches a MUI IconButton Click with all three layers', () => {
    const interaction = makeInteraction('Click', { targetName: 'Submit' }, {
      target: makeTarget({
        tag: 'BUTTON',
        className: 'MuiIconButton-root',
        elementKey: 'icon-btn-0',
        accessibleName: '',
        ariaRole: null,
      }),
    });
    enrichInteraction(interaction);
    expect(interaction.componentType).toBe('IconButton');
    expect(interaction.componentFramework).toBe('MUI');
    expect(interaction.businessMeaning).toBeDefined();
    expect(typeof interaction.businessMeaning).toBe('string');
  });

  it('enriches an AG Grid SortButton Click', () => {
    const interaction = makeInteraction('Click', { targetName: 'Name' }, {
      target: makeTarget({
        tag: 'DIV',
        className: 'ag-header-cell sort-asc',
        elementKey: 'sort-0',
        accessibleName: 'Name',
        ariaRole: 'columnheader',
        textContent: 'Name',
      }),
    });
    enrichInteraction(interaction);
    expect(interaction.componentType).toBe('SortButton');
    expect(interaction.componentFramework).toBe('AGGrid');
    expect(interaction.businessMeaning).toBe('Sort by Name');
  });

  it('preserves all existing interaction fields after enrichment', () => {
    const interaction = makeInteraction('Click', { targetName: 'Save' });
    const originalId = interaction.interactionId;
    const originalType = interaction.type;
    const originalMeta = { ...interaction.metadata };

    enrichInteraction(interaction);

    expect(interaction.interactionId).toBe(originalId);
    expect(interaction.type).toBe(originalType);
    expect(interaction.metadata).toEqual(originalMeta);
  });

  it('enriches Chakra ToggleSwitch enable', () => {
    const interaction = makeInteraction('Click', {
      targetName: 'Notifications',
      checked: true,
    }, {
      target: makeTarget({
        tag: 'BUTTON',
        className: 'chakra-switch',
        elementKey: 'switch-0',
        accessibleName: 'Notifications',
        ariaRole: 'switch',
      }),
    });
    enrichInteraction(interaction);
    expect(interaction.componentType).toBe('ToggleSwitch');
    expect(interaction.componentFramework).toBe('ChakraUI');
    expect(interaction.businessMeaning).toBe('Enable Notifications');
  });
});

// ── Edge Cases ─────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles null className gracefully', () => {
    const event = makeEvent({
      target: makeTarget({
        tag: 'DIV',
        className: null,
        elementKey: 'div-0',
        accessibleName: 'Content',
        ariaRole: null,
        textContent: 'Content',
      }),
    });
    expect(() => detectComponent(event)).not.toThrow();
    const result = detectComponent(event);
    expect(result.componentType).toBe('Generic');
  });

  it('handles empty ancestorClasses', () => {
    const event = makeEvent({
      target: makeTarget({ tag: 'DIV', accessibleName: 'Content', textContent: 'Content' }),
    });
    const result = detectComponent(event);
    expect(result.componentType).toBe('Generic');
  });
});

/**
 * Golden Master Test Corpus
 *
 * Captures baseline IR plans + Playwright output through the CURRENT adapter path:
 *   ComponentInteraction → adaptInteraction() → DetectedInteraction → build() → ExecutionIRPlan
 *
 * After the type unification migration, the new path is:
 *   ComponentInteraction → build() → ExecutionIRPlan  (no adapter)
 *
 * The differential test compares both paths' outputs for byte-identical equality.
 *
 * Architecture: .drytis/PHASE3_DESIGN.md §9 (Equivalence Validation Strategy)
 */

import type { ComponentInteraction } from '../../src/shared/component-types';
import type { ElementIdentity, SessionEvent } from '../../src/shared/types';

// ── Fixture Builders ──────────────────────────────────────────────────

export function makeElementIdentity(
  overrides: Partial<ElementIdentity> = {},
): ElementIdentity {
  return {
    accessibleName: 'Test Button',
    ariaRole: 'button',
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'BUTTON',
    className: 'btn',
    name: '',
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'body > button',
    xPath: '/html/body/button',
    inIframe: false,
    shadowDom: false,
    elementId: 'elem-0001',
    ...overrides,
  };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter++;
  return `${prefix}-${String(idCounter).padStart(4, '0')}`;
}

export function makeComponentInteraction(
  type: string,
  overrides: Partial<ComponentInteraction> = {},
): ComponentInteraction {
  const trigger = makeElementIdentity();
  return {
    interactionId: nextId('int'),
    type: type as ComponentInteraction['type'],
    trigger,
    triggerEvent: {
      eventId: nextId('evt'),
      eventType: 'click',
      timestamp: Date.now(),
      isTrusted: true,
      target: trigger,
      domContext: {},
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 0,
      clientY: 0,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com',
      pageTitle: 'Test Page',
    },
    memberEvents: [],
    startTime: Date.now(),
    endTime: Date.now(),
    endState: 'completed',
    metadata: {},
    ...overrides,
  } as unknown as ComponentInteraction;
}

// ── Layer 1: Per-Type Canonical Fixtures ─────────────────────────────
// One per unified InteractionType, with representative metadata.

export function buildLayer1Fixtures(): ComponentInteraction[] {
  const fixtures: ComponentInteraction[] = [];

  // Click
  fixtures.push(makeComponentInteraction('Click', {
    metadata: { targetName: 'Submit Button' },
  }));

  // DoubleClick
  fixtures.push(makeComponentInteraction('Click', {
    interactionSubtype: 'DoubleClick',
    metadata: { targetName: 'Desktop Icon' },
  }));

  // RightClick
  fixtures.push(makeComponentInteraction('Click', {
    interactionSubtype: 'RightClick',
    metadata: { targetName: 'Context Menu Trigger', rightClick: true },
  }));

  // TextEntry
  fixtures.push(makeComponentInteraction('TextEntry', {
    metadata: { textValue: 'hello@example.com', targetName: 'Email' },
  }));

  // RichTextEditor (via TextEntry with flag)
  fixtures.push(makeComponentInteraction('TextEntry', {
    interactionSubtype: 'RichTextEditor',
    metadata: { textValue: '<p>Rich text</p>', targetName: 'Comment', isRichTextEditor: true, editorType: 'Quill' },
  }));

  // Dropdown (custom)
  fixtures.push(makeComponentInteraction('Dropdown', {
    metadata: { selectedValue: 'Option A', targetName: 'Country' },
  }));

  // Dropdown (native)
  fixtures.push(makeComponentInteraction('Dropdown', {
    interactionSubtype: 'NativeDropdown',
    metadata: { selectedValue: 'India', targetName: 'Country' },
  }));

  // Dropdown (autocomplete)
  fixtures.push(makeComponentInteraction('Dropdown', {
    interactionSubtype: 'Autocomplete',
    metadata: { selectedValue: 'New York', targetName: 'City' },
  }));

  // Dropdown (multiSelect)
  fixtures.push(makeComponentInteraction('Dropdown', {
    interactionSubtype: 'MultiSelect',
    metadata: { selectedValue: 'Tag1, Tag2', targetName: 'Tags' },
  }));

  // Checkbox
  fixtures.push(makeComponentInteraction('Checkbox', {
    metadata: { checked: true, targetName: 'Remember me' },
  }));

  // ToggleSwitch
  fixtures.push(makeComponentInteraction('Checkbox', {
    interactionSubtype: 'ToggleSwitch',
    metadata: { checked: true, targetName: 'Notifications' },
  }));

  // RadioButton
  fixtures.push(makeComponentInteraction('RadioButton', {
    metadata: { targetName: 'Credit Card' },
  }));

  // DatePicker
  fixtures.push(makeComponentInteraction('DatePicker', {
    metadata: { selectedDate: '2024-03-15', displayValue: 'March 15, 2024', targetName: 'Departure Date' },
  }));

  // Hover
  fixtures.push(makeComponentInteraction('Hover', {
    metadata: { hoverDuration: 500, targetName: 'Info Icon' },
  }));

  // Link
  fixtures.push(makeComponentInteraction('Link', {
    metadata: { targetName: 'About Us' },
  }));

  // FileUpload
  fixtures.push(makeComponentInteraction('FileUpload', {
    metadata: { fileName: 'document.pdf', fileCount: 1, targetName: 'Upload Document' },
  }));

  // Slider
  fixtures.push(makeComponentInteraction('Slider', {
    metadata: { sliderValue: '50', min: '0', max: '100', targetName: 'Volume' },
  }));

  // Tab
  fixtures.push(makeComponentInteraction('Tab', {
    metadata: { selectedTab: 'Settings', targetName: 'Settings Tab' },
  }));

  // Scroll (page)
  fixtures.push(makeComponentInteraction('Scroll', {
    metadata: { scrollPosition: { x: 0, y: 500 } },
  }));

  // Scroll (container)
  fixtures.push(makeComponentInteraction('Scroll', {
    interactionSubtype: 'ContainerScroll',
    metadata: { scrollPosition: { x: 0, y: 200 } },
  }));

  // Navigation
  fixtures.push(makeComponentInteraction('Navigation', {
    metadata: { targetName: 'Navigation' },
    triggerEvent: {
      eventId: 'evt-nav-0001',
      eventType: 'navigation',
      timestamp: Date.now(),
      isTrusted: true,
      target: makeElementIdentity(),
      domContext: {},
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 0,
      clientY: 0,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com/dashboard',
      pageTitle: 'Dashboard',
    },
  }));

  // Navigation (Back)
  fixtures.push(makeComponentInteraction('Navigation', {
    interactionSubtype: 'Back',
    metadata: { targetName: 'Back' },
  }));

  // Navigation (Forward)
  fixtures.push(makeComponentInteraction('Navigation', {
    interactionSubtype: 'Forward',
    metadata: { targetName: 'Forward' },
  }));

  // Navigation (Refresh)
  fixtures.push(makeComponentInteraction('Navigation', {
    interactionSubtype: 'Refresh',
    metadata: { targetName: 'Refresh' },
  }));

  // DragDrop
  fixtures.push(makeComponentInteraction('DragDrop', {
    metadata: { dropTarget: 'Drop Zone', sourceElement: 'Drag Item', targetName: 'Drag Item' },
  }));

  // KeyboardShortcut
  fixtures.push(makeComponentInteraction('KeyboardShortcut', {
    metadata: {
      shortcutKey: 'Ctrl+S',
      keyValue: 's',
      keyCode: 'KeyS',
      playwrightKey: 'Control+s',
      hasCtrl: true,
      hasShift: false,
      hasAlt: false,
      hasCmd: false,
      targetName: 'Save',
    },
  }));

  // ModalDialog
  fixtures.push(makeComponentInteraction('ModalDialog', {
    metadata: {
      modalTitle: 'Settings Dialog',
      targetName: 'Settings',
      hasSubActions: false,
    },
  }));

  // ModalDialog with subActions
  fixtures.push(makeComponentInteraction('ModalDialog', {
    metadata: {
      modalTitle: 'Filter Dialog',
      targetName: 'Filter',
      hasSubActions: true,
      subActions: [
        { action: 'select', label: 'Status', value: 'Active' },
        { action: 'click', label: 'Apply' },
      ],
    },
  }));

  // Stepper
  fixtures.push(makeComponentInteraction('Stepper', {
    metadata: {
      fieldName: 'Adults',
      totalDelta: 2,
      incrementCount: 2,
      decrementCount: 0,
      targetName: 'Adults',
      subActions: [
        { action: 'increment', label: 'Adults', field: 'Adults', delta: 1 },
        { action: 'increment', label: 'Adults', field: 'Adults', delta: 1 },
      ],
    },
  }));

  // TagInput
  fixtures.push(makeComponentInteraction('TagInput', {
    metadata: { textValue: 'tag1, tag2', tags: ['tag1', 'tag2'], targetName: 'Tags' },
  }));

  // OtpInput
  fixtures.push(makeComponentInteraction('OtpInput', {
    metadata: { otpValue: '123456', tags: ['1', '2', '3', '4', '5', '6'], targetName: 'OTP' },
  }));

  // HotkeySequence
  fixtures.push(makeComponentInteraction('HotkeySequence', {
    metadata: {
      sequenceDisplay: 'Ctrl+K then Esc',
      playwrightSequence: 'Control+k,Escape',
      targetName: 'Command Palette',
    },
  }));

  // NewTab
  fixtures.push(makeComponentInteraction('NewTab', {
    metadata: { openedUrl: 'https://example.com/new', openedTitle: 'New Tab', targetName: 'Open New Tab' },
  }));

  // NewWindow
  fixtures.push(makeComponentInteraction('NewWindow', {
    metadata: { openedUrl: 'https://example.com/popup', openedTitle: 'Popup', targetName: 'Open Popup' },
  }));

  // Breadcrumb
  fixtures.push(makeComponentInteraction('Breadcrumb', {
    metadata: { breadcrumbLevel: 2, breadcrumbPath: ['Home', 'Products'], targetName: 'Products' },
  }));

  return fixtures;
}

// ── Layer 2: Edge-Case Fixtures ──────────────────────────────────────

export function buildLayer2Fixtures(): ComponentInteraction[] {
  const fixtures: ComponentInteraction[] = [];

  // Empty metadata (graceful degradation)
  fixtures.push(makeComponentInteraction('Click', { metadata: {} }));

  // TextEntry with finalValue instead of textValue
  fixtures.push(makeComponentInteraction('TextEntry', {
    metadata: { finalValue: 'fallback@test.com', targetName: 'Email' },
  }));

  // Slider with value instead of sliderValue
  fixtures.push(makeComponentInteraction('Slider', {
    metadata: { value: 75, min: '0', max: '100', targetName: 'Brightness' },
  }));

  // Slider with range (startValue/endValue)
  fixtures.push(makeComponentInteraction('Slider', {
    metadata: { sliderValue: '30', startValue: '20', endValue: '80', min: '0', max: '100', dragTracked: true, targetName: 'Price Range' },
  }));

  // Checkbox unchecked
  fixtures.push(makeComponentInteraction('Checkbox', {
    metadata: { checked: false, targetName: 'Newsletter' },
  }));

  // DatePicker with dateAmbiguous
  fixtures.push(makeComponentInteraction('DatePicker', {
    metadata: { selectedDate: '2024-03-15', displayValue: '15/03/2024', dateAmbiguous: true, targetName: 'Date' },
  }));

  // FileUpload with multiple files
  fixtures.push(makeComponentInteraction('FileUpload', {
    metadata: { fileName: 'a.pdf', fileCount: 3, targetName: 'Documents' },
  }));

  // Dropdown with subActions (multi-config)
  fixtures.push(makeComponentInteraction('Dropdown', {
    metadata: {
      isMultiConfig: true,
      selectedValue: 'Economy',
      targetName: 'Economy',
      subActions: [
        { action: 'increment', label: 'Adults', value: '2' },
        { action: 'select', label: 'Class', value: 'Premium' },
        { action: 'click', label: 'Done' },
      ],
    },
  }));

  // Dropdown with configurationSession
  fixtures.push(makeComponentInteraction('Dropdown', {
    metadata: {
      configurationSession: {
        fields: [
          { label: 'Adults', kind: 'counter', finalValue: '2', delta: 1 },
          { label: 'Class', kind: 'select', finalValue: 'Premium' },
        ],
        commitAction: { label: 'Done' },
        triggerLabel: 'Economy',
      },
      targetName: 'Economy',
    },
  }));

  // Abandoned interaction (lower confidence)
  fixtures.push(makeComponentInteraction('Click', {
    endState: 'abandoned',
    metadata: { targetName: 'Abandoned Button' },
  }));

  // Interrupted interaction
  fixtures.push(makeComponentInteraction('TextEntry', {
    endState: 'interrupted',
    metadata: { textValue: 'partial', targetName: 'Search' },
  }));

  // Navigation with pageUrl/pageTitle from triggerEvent
  fixtures.push(makeComponentInteraction('Navigation', {
    triggerEvent: {
      eventId: 'evt-nav-0002',
      eventType: 'navigation',
      timestamp: Date.now(),
      isTrusted: true,
      target: makeElementIdentity(),
      domContext: {},
      valueBefore: null,
      valueAfter: null,
      checkedBefore: null,
      checkedAfter: null,
      clientX: 0,
      clientY: 0,
      key: null,
      code: null,
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      scrollDeltaY: null,
      scrollDeltaX: null,
      pageUrl: 'https://example.com/login',
      pageTitle: 'Login Page',
    },
    metadata: {},
  }));

  // Click inside iframe
  fixtures.push(makeComponentInteraction('Click', {
    trigger: makeElementIdentity({
      inIframe: true,
      iframeContext: {
        frameSrc: 'https://example.com/embed',
        frameName: 'embed',
        frameId: 'frame-1',
        frameSelector: 'iframe#embed',
        frameXPath: '/html/body/iframe',
        frameIndex: 0,
        frameDepth: 1,
      },
    }),
    metadata: { targetName: 'Iframe Button' },
  }));

  // Element with testId
  fixtures.push(makeComponentInteraction('Click', {
    trigger: makeElementIdentity({
      testId: 'submit-btn',
      accessibleName: 'Submit',
    }),
    metadata: { targetName: 'Submit' },
  }));

  // Element with ariaLabel
  fixtures.push(makeComponentInteraction('Click', {
    trigger: makeElementIdentity({
      ariaLabel: 'Close dialog',
      testId: null,
      stableId: null,
    }),
    metadata: { targetName: 'Close' },
  }));

  // Checkbox ToggleSwitch unchecked
  fixtures.push(makeComponentInteraction('Checkbox', {
    interactionSubtype: 'ToggleSwitch',
    metadata: { checked: false, targetName: 'Dark Mode' },
  }));

  // Stepper with negative delta
  fixtures.push(makeComponentInteraction('Stepper', {
    metadata: {
      fieldName: 'Children',
      totalDelta: -1,
      incrementCount: 0,
      decrementCount: 1,
      targetName: 'Children',
      subActions: [
        { action: 'decrement', label: 'Children', field: 'Children', delta: -1 },
      ],
    },
  }));

  return fixtures;
}

// ── Layer 3: Multi-Interaction Sequences ─────────────────────────────

export function buildLayer3Fixtures(): ComponentInteraction[][] {
  const sequences: ComponentInteraction[][] = [];

  // Sequence 1: Login flow (5 interactions)
  sequences.push([
    makeComponentInteraction('Click', { metadata: { targetName: 'Email Field' } }),
    makeComponentInteraction('TextEntry', { metadata: { textValue: 'user@test.com', targetName: 'Email' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Password Field' } }),
    makeComponentInteraction('TextEntry', { metadata: { textValue: 'secret123', targetName: 'Password' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Sign In' } }),
  ]);

  // Sequence 2: Form fill with dropdown + checkbox (7 interactions)
  sequences.push([
    makeComponentInteraction('TextEntry', { metadata: { textValue: 'John Doe', targetName: 'Full Name' } }),
    makeComponentInteraction('Dropdown', { interactionSubtype: 'NativeDropdown', metadata: { selectedValue: 'USA', targetName: 'Country' } }),
    makeComponentInteraction('Checkbox', { metadata: { checked: true, targetName: 'Terms' } }),
    makeComponentInteraction('TextEntry', { metadata: { textValue: 'john@test.com', targetName: 'Email' } }),
    makeComponentInteraction('DatePicker', { metadata: { selectedDate: '2024-06-01', displayValue: 'June 1, 2024', targetName: 'Birthday' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Submit' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Submit' } }), // duplicate for merge rule
  ]);

  // Sequence 3: Mixed with scroll noise (6 interactions, 1 filtered)
  sequences.push([
    makeComponentInteraction('Click', { metadata: { targetName: 'Search' } }),
    makeComponentInteraction('TextEntry', { metadata: { textValue: 'query', targetName: 'Search Box' } }),
    makeComponentInteraction('Scroll', { metadata: {} }), // noise - filtered
    makeComponentInteraction('Click', { metadata: { targetName: 'First Result' } }),
    makeComponentInteraction('Scroll', { interactionSubtype: 'ContainerScroll', metadata: {} }), // noise - filtered
    makeComponentInteraction('Navigation', { metadata: { targetName: 'Detail Page' } }),
  ]);

  // Sequence 4: Modal dialog workflow (4 interactions)
  sequences.push([
    makeComponentInteraction('Click', { metadata: { targetName: 'Open Settings' } }),
    makeComponentInteraction('ModalDialog', {
      metadata: {
        modalTitle: 'Settings',
        targetName: 'Settings',
        hasSubActions: true,
        subActions: [
          { action: 'toggle', label: 'Enable notifications', value: 'true' },
          { action: 'select', label: 'Theme', value: 'Dark' },
          { action: 'click', label: 'Save' },
        ],
      },
    }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Close' } }),
    makeComponentInteraction('Navigation', { metadata: { targetName: 'Dashboard' } }),
  ]);

  // Sequence 5: Multi-config dropdown + stepper (3 interactions)
  sequences.push([
    makeComponentInteraction('Dropdown', {
      metadata: {
        isMultiConfig: true,
        targetName: 'Filters',
        subActions: [
          { action: 'select', label: 'Status', value: 'Active' },
          { action: 'select', label: 'Priority', value: 'High' },
          { action: 'click', label: 'Apply' },
        ],
      },
    }),
    makeComponentInteraction('Stepper', {
      metadata: { fieldName: 'Quantity', totalDelta: 3, targetName: 'Quantity' },
    }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Add to Cart' } }),
  ]);

  // Sequence 6: Rich text + tags + OTP (5 interactions)
  sequences.push([
    makeComponentInteraction('TextEntry', { interactionSubtype: 'RichTextEditor', metadata: { textValue: '<p>Hello</p>', isRichTextEditor: true, editorType: 'Quill', targetName: 'Comment' } }),
    makeComponentInteraction('TagInput', { metadata: { textValue: 'react, typescript', tags: ['react', 'typescript'], targetName: 'Tags' } }),
    makeComponentInteraction('OtpInput', { metadata: { otpValue: '123456', tags: ['1', '2', '3', '4', '5', '6'], targetName: 'OTP' } }),
    makeComponentInteraction('Checkbox', { metadata: { checked: true, targetName: 'Accept' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Submit' } }),
  ]);

  // Sequence 7: All navigation subtypes (5 interactions)
  sequences.push([
    makeComponentInteraction('Navigation', { metadata: { targetName: 'Page Nav' } }),
    makeComponentInteraction('Navigation', { interactionSubtype: 'Back', metadata: { targetName: 'Back' } }),
    makeComponentInteraction('Navigation', { interactionSubtype: 'Forward', metadata: { targetName: 'Forward' } }),
    makeComponentInteraction('Navigation', { interactionSubtype: 'Refresh', metadata: { targetName: 'Refresh' } }),
    makeComponentInteraction('Link', { metadata: { targetName: 'Home' } }),
  ]);

  // Sequence 8: Drag-drop + keyboard shortcuts (4 interactions)
  sequences.push([
    makeComponentInteraction('DragDrop', { metadata: { dropTarget: 'Folder A', sourceElement: 'File.txt', targetName: 'File.txt' } }),
    makeComponentInteraction('KeyboardShortcut', { metadata: { shortcutKey: 'Ctrl+S', playwrightKey: 'Control+s', hasCtrl: true, targetName: 'Save' } }),
    makeComponentInteraction('KeyboardShortcut', { metadata: { shortcutKey: 'Ctrl+Z', playwrightKey: 'Control+z', hasCtrl: true, targetName: 'Undo' } }),
    makeComponentInteraction('HotkeySequence', { metadata: { sequenceDisplay: 'Ctrl+K then Esc', playwrightSequence: 'Control+k,Escape', targetName: 'Cancel' } }),
  ]);

  // Sequence 9: Hover + tab + breadcrumb + new tab (5 interactions)
  sequences.push([
    makeComponentInteraction('Hover', { metadata: { hoverDuration: 300, targetName: 'Menu Item' } }),
    makeComponentInteraction('Tab', { metadata: { selectedTab: 'Profile', targetName: 'Profile Tab' } }),
    makeComponentInteraction('Breadcrumb', { metadata: { breadcrumbLevel: 1, breadcrumbPath: ['Home'], targetName: 'Home' } }),
    makeComponentInteraction('NewTab', { metadata: { openedUrl: 'https://example.com/new', targetName: 'External Link' } }),
    makeComponentInteraction('Click', { metadata: { targetName: 'Close Tab' } }),
  ]);

  // Sequence 10: Large mixed sequence (20 interactions for readability merge stress)
  const largeSeq: ComponentInteraction[] = [];
  for (let i = 0; i < 10; i++) {
    largeSeq.push(makeComponentInteraction('Click', { metadata: { targetName: `Button ${i}` } }));
  }
  for (let i = 0; i < 5; i++) {
    largeSeq.push(makeComponentInteraction('TextEntry', { metadata: { textValue: `value${i}`, targetName: `Field ${i}` } }));
  }
  largeSeq.push(makeComponentInteraction('Scroll', { metadata: {} })); // noise
  largeSeq.push(makeComponentInteraction('Checkbox', { metadata: { checked: true, targetName: 'Agree' } }));
  largeSeq.push(makeComponentInteraction('Dropdown', { metadata: { selectedValue: 'Option B', targetName: 'Select' } }));
  largeSeq.push(makeComponentInteraction('Slider', { metadata: { sliderValue: '50', targetName: 'Volume' } }));
  largeSeq.push(makeComponentInteraction('DatePicker', { metadata: { selectedDate: '2024-01-15', targetName: 'Date' } }));
  largeSeq.push(makeComponentInteraction('Navigation', { metadata: { targetName: 'Submit' } }));
  sequences.push(largeSeq);

  return sequences;
}

// ── Corpus Assembly ──────────────────────────────────────────────────

export interface CorpusEntry {
  id: string;
  description: string;
  interactions: ComponentInteraction[];
}

export function buildCorpus(): CorpusEntry[] {
  const entries: CorpusEntry[] = [];

  // Layer 1: per-type canonical
  const layer1 = buildLayer1Fixtures();
  for (let i = 0; i < layer1.length; i++) {
    entries.push({
      id: `L1-${String(i + 1).padStart(2, '0')}`,
      description: `Layer1: ${layer1[i].type}${layer1[i].interactionSubtype ? ` (${layer1[i].interactionSubtype})` : ''}`,
      interactions: [layer1[i]],
    });
  }

  // Layer 2: edge cases
  const layer2 = buildLayer2Fixtures();
  for (let i = 0; i < layer2.length; i++) {
    entries.push({
      id: `L2-${String(i + 1).padStart(2, '0')}`,
      description: `Layer2: edge-${layer2[i].type}${layer2[i].interactionSubtype ? `-${layer2[i].interactionSubtype}` : ''}`,
      interactions: [layer2[i]],
    });
  }

  // Layer 3: multi-interaction sequences
  const layer3 = buildLayer3Fixtures();
  for (let i = 0; i < layer3.length; i++) {
    entries.push({
      id: `L3-${String(i + 1).padStart(2, '0')}`,
      description: `Layer3: sequence-${i + 1} (${layer3[i].length} interactions)`,
      interactions: layer3[i],
    });
  }

  return entries;
}

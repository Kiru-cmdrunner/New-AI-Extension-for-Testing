/**
 * Rich Text Editor Tests
 *
 * Validates the EditorAdapter interface and its integration with TextEntry.
 * Tests that contentEditable elements are correctly identified as specific
 * rich text editor frameworks (Quill, CKEditor, ProseMirror, etc.) and that
 * the interactionSubtype is set to 'RichTextEditor'.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRuntime, type ComponentRuntime } from '../../src/runtime/component-runtime';
import { ALL_DEFINITIONS } from '../../src/definitions/index';
import { detectEditor, quillAdapter, ckEditorAdapter, prosemirrorAdapter, slateAdapter, draftJsAdapter, tinyMceAdapter } from '../../src/definitions/editor-adapters';
import type {
  ComponentInteraction,
  ObservedEvent,
  DomContext,
  BrowserEventType,
} from '../../src/shared/component-types';
import type { ElementIdentity } from '../../src/shared/types';
import { build as buildIRPlan } from '../../src/generation/ir-bridge';
import type { IRBridgeInput } from '../../src/generation/ir-bridge-input';
import type { DetectedInteraction } from '../../src/classifier/interaction-types';
import type { IRStep } from '../../src/domain/execution-ir/types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<ElementIdentity> = {}): ElementIdentity {
  return {
    accessibleName: '',
    ariaRole: null,
    ariaLabel: null,
    ariaLabelledBy: null,
    placeholder: null,
    tag: 'DIV',
    className: null,
    name: null,
    stableId: null,
    testId: null,
    dataCy: null,
    dataQa: null,
    cssSelector: 'div',
    xPath: '/html/body/div',
    inIframe: false,
    shadowDom: false,
    elementId: '',
    ...overrides,
  };
}

function makeDomContext(overrides: Partial<DomContext> = {}): DomContext {
  return {
    inputType: null,
    ariaExpanded: null,
    ariaHasPopup: null,
    isContentEditable: false,
    disabled: false,
    readOnly: false,
    required: false,
    ancestorRoles: [],
    ancestorClasses: [],
    surfaceId: null,
    surfaceType: null,
    surfaceRole: null,
    surfaceLabel: null,
    ...overrides,
  };
}

let evtCounter = 0;
function makeEvent(
  eventType: string,
  targetOverrides: Partial<ElementIdentity> = {},
  domContextOverrides: Partial<DomContext> = {},
  extras: Partial<ObservedEvent> = {},
): ObservedEvent {
  return {
    eventId: `evt-${++evtCounter}`,
    eventType: eventType as BrowserEventType,
    timestamp: Date.now(),
    isTrusted: true,
    target: makeTarget(targetOverrides),
    domContext: makeDomContext(domContextOverrides),
    valueBefore: null,
    valueAfter: null,
    checkedBefore: null,
    checkedAfter: null,
    clientX: null,
    clientY: null,
    key: null,
    code: null,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    scrollDeltaY: null,
    scrollDeltaX: null,
    pageUrl: 'https://example.com/editor',
    pageTitle: 'Editor',
    ...extras,
  };
}

// ── Adapter Detection Tests ───────────────────────────────────────────

describe('EditorAdapter Detection', () => {
  it('detects Quill via .ql-editor class', () => {
    const target = makeTarget({ className: 'ql-editor text-left' });
    const ctx = makeDomContext({ isContentEditable: true });
    expect(quillAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('Quill');
  });

  it('detects Quill via ancestor class', () => {
    const target = makeTarget({ className: 'some-inner' });
    const ctx = makeDomContext({ isContentEditable: true, ancestorClasses: ['ql-editor', 'ql-container'] });
    expect(detectEditor(target, ctx)).toBe('Quill');
  });

  it('detects CKEditor 5 via .ck-editor__editable', () => {
    const target = makeTarget({ className: 'ck-editor__editable' });
    const ctx = makeDomContext({ isContentEditable: true });
    expect(ckEditorAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('CKEditor');
  });

  it('detects ProseMirror via .ProseMirror class', () => {
    const target = makeTarget({ className: 'ProseMirror' });
    const ctx = makeDomContext({ isContentEditable: true });
    expect(prosemirrorAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('ProseMirror');
  });

  it('detects Slate via data-slate-editor', () => {
    const target = makeTarget({ testId: 'data-slate-editor' });
    const ctx = makeDomContext({ isContentEditable: true, ancestorClasses: ['slate-editor'] });
    expect(slateAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('Slate');
  });

  it('detects Draft.js via ancestor classes', () => {
    const target = makeTarget({ className: 'some-class' });
    const ctx = makeDomContext({ isContentEditable: true, ancestorClasses: ['public-DraftEditor-content'] });
    expect(draftJsAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('Draft.js');
  });

  it('detects TinyMCE via mce-content-body class', () => {
    const target = makeTarget({ className: 'mce-content-body' });
    const ctx = makeDomContext({ isContentEditable: true });
    expect(tinyMceAdapter.matches(target, ctx)).toBe(true);
    expect(detectEditor(target, ctx)).toBe('TinyMCE');
  });

  it('returns null for unknown contentEditable', () => {
    const target = makeTarget({ className: 'my-custom-editor' });
    const ctx = makeDomContext({ isContentEditable: true });
    expect(detectEditor(target, ctx)).toBeNull();
  });
});

// ── TextEntry Integration Tests ───────────────────────────────────────

describe('TextEntry Rich Text Editor Integration', () => {
  let emitted: ComponentInteraction[];
  let runtime: ComponentRuntime;

  beforeEach(() => {
    evtCounter = 0;
    emitted = [];
    runtime = createRuntime([...ALL_DEFINITIONS], {
      onEmit: (i) => emitted.push(i),
    });
  });

  it('sets interactionSubtype to RichTextEditor for Quill editor', () => {
    const QUILL_EDITOR = {
      tag: 'DIV',
      accessibleName: 'Message Body',
      ariaRole: 'textbox',
      className: 'ql-editor',
      stableId: 'quill-editor',
      cssSelector: 'div.ql-editor',
    };

    // Focus the editor
    runtime.process(makeEvent('focus', QUILL_EDITOR, {
      isContentEditable: true,
    }));

    // Type something
    runtime.process(makeEvent('input', QUILL_EDITOR, {
      isContentEditable: true,
    }, { valueAfter: 'Hello World' }));

    // Blur to complete
    runtime.process(makeEvent('blur', QUILL_EDITOR, {
      isContentEditable: true,
    }, { valueAfter: 'Hello World' }));

    const text = emitted.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.interactionSubtype).toBe('RichTextEditor');
    expect(text!.metadata.editorType).toBe('Quill');
    expect(text!.metadata.isRichTextEditor).toBe(true);
    expect(text!.metadata.textValue).toBe('Hello World');
  });

  it('sets editorType to ContentEditable for unknown editors', () => {
    const GENERIC_EDITOR = {
      tag: 'DIV',
      accessibleName: 'Notes',
      ariaRole: 'textbox',
      className: 'custom-editor',
      stableId: 'notes-editor',
      cssSelector: 'div.custom-editor',
    };

    runtime.process(makeEvent('focus', GENERIC_EDITOR, {
      isContentEditable: true,
    }));
    runtime.process(makeEvent('input', GENERIC_EDITOR, {
      isContentEditable: true,
    }, { valueAfter: 'Some text' }));
    runtime.process(makeEvent('blur', GENERIC_EDITOR, {
      isContentEditable: true,
    }, { valueAfter: 'Some text' }));

    const text = emitted.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.interactionSubtype).toBe('RichTextEditor');
    expect(text!.metadata.editorType).toBe('ContentEditable');
    expect(text!.metadata.isRichTextEditor).toBe(true);
  });

  it('does NOT set RichTextEditor for regular <input> elements', () => {
    const INPUT = {
      tag: 'INPUT',
      inputType: 'text',
      accessibleName: 'Name',
      ariaRole: null,
      stableId: 'name-input',
      cssSelector: 'input#name',
    };

    runtime.process(makeEvent('focus', INPUT, {
      isContentEditable: false,
    }));
    runtime.process(makeEvent('input', INPUT, {
      isContentEditable: false,
    }, { valueAfter: 'John' }));
    runtime.process(makeEvent('blur', INPUT, {
      isContentEditable: false,
    }, { valueAfter: 'John' }));

    const text = emitted.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.interactionSubtype).not.toBe('RichTextEditor');
    expect(text!.metadata.editorType).toBeUndefined();
    expect(text!.metadata.isRichTextEditor).toBeUndefined();
    expect(text!.metadata.textValue).toBe('John');
  });

  it('does NOT set RichTextEditor for <textarea> elements', () => {
    const TEXTAREA = {
      tag: 'TEXTAREA',
      accessibleName: 'Description',
      ariaRole: null,
      stableId: 'desc-area',
      cssSelector: 'textarea#desc',
    };

    runtime.process(makeEvent('focus', TEXTAREA, {
      isContentEditable: false,
    }));
    runtime.process(makeEvent('input', TEXTAREA, {
      isContentEditable: false,
    }, { valueAfter: 'A long description' }));
    runtime.process(makeEvent('blur', TEXTAREA, {
      isContentEditable: false,
    }, { valueAfter: 'A long description' }));

    const text = emitted.find((i) => i.type === 'TextEntry');
    expect(text).toBeDefined();
    expect(text!.interactionSubtype).not.toBe('RichTextEditor');
    expect(text!.metadata.isRichTextEditor).toBeUndefined();
  });
});

// ── IR Bridge Integration Tests ───────────────────────────────────────

function makeIRInteraction(
  type: string,
  metadata: Record<string, unknown>,
  identity?: Partial<ElementIdentity>,
): DetectedInteraction {
  return {
    interactionId: `int-${type}-1`,
    type: type as any,
    eventIds: ['evt-1'],
    rawEventTypes: ['input', 'blur'],
    target: {
      tag: 'DIV',
      accessibleName: identity?.accessibleName ?? 'Rich Editor',
      ariaRole: 'textbox',
      ariaLabel: null,
      ariaLabelledBy: null,
      placeholder: null,
      stableId: null,
      cssSelector: identity?.cssSelector ?? '.ql-editor',
      elementId: '',
      testId: null,
      className: '',
      ancestorClasses: [],
      href: null,
      tabIndex: -1,
    },
    metadata: metadata as any,
    confidence: 0.9,
  } as DetectedInteraction;
}

function buildPlan(interactions: DetectedInteraction[]): IRStep[] {
  const input: IRBridgeInput = {
    events: [],
    interactions,
    understanding: null,
    recordingContext: { startUrl: 'https://example.com', title: 'Test' } as any,
    testCaseName: 'Rich Text Editor Test',
  };
  return buildIRPlan(input).steps;
}

describe('RichTextEditor IR Bridge', () => {
  it('maps RichTextEditor to fill action with text value', () => {
    const interaction = makeIRInteraction('RichTextEditor', {
      textValue: 'Hello World',
      editorType: 'Quill',
      isRichTextEditor: true,
    });

    const steps = buildPlan([interaction]);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('fill');
    expect(steps[0].input).toBe('Hello World');
  });

  it('maps RichTextEditor description to "Fill ... in ..."', () => {
    const interaction = makeIRInteraction('RichTextEditor', {
      textValue: 'Draft text',
      editorType: 'CKEditor',
      isRichTextEditor: true,
    }, { accessibleName: 'Body Editor', cssSelector: '.ck-editor__editable' });

    const steps = buildPlan([interaction]);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('fill');
    expect(steps[0].description).toContain('Draft text');
    expect(steps[0].description).toContain('Body Editor');
  });

  it('falls back to null input when textValue is missing', () => {
    const interaction = makeIRInteraction('RichTextEditor', {
      editorType: 'ContentEditable',
      isRichTextEditor: true,
    });

    const steps = buildPlan([interaction]);
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toBe('fill');
    expect(steps[0].input).toBeNull();
  });
});

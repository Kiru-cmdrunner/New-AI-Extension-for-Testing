/**
 * EditorAdapter Interface — Pluggable Rich Text Editor Detection
 *
 * Each adapter identifies a specific rich text editor framework by checking
 * the trigger element's CSS classes and attributes. This allows TextEntry to
 * set the correct interactionSubtype and editorType for downstream layers
 * (IR bridge generates editor-specific Playwright code).
 *
 * The adapter chain is iterated in priority order. First match wins.
 *
 * Architecture: `.drytis/TIER1_ARCHITECTURAL_JUSTIFICATION.md` §Item 4
 */

import type { DomContext } from '../../shared/component-types';
import type { ElementIdentity } from '../../shared/types';

/**
 * An adapter that detects and identifies a specific rich text editor framework.
 *
 * Detection is based on the editor's published DOM structure (stable API
 * contracts of the libraries), NOT on CSS class heuristics:
 *   - Quill always renders `.ql-editor`
 *   - CKEditor always renders `.ck-editor__editable`
 *   - ProseMirror always renders `.ProseMirror`
 *   - Slate always sets `data-slate-editor`
 *   - Draft.js always sets `data-contents`
 */
export interface EditorAdapter {
  /** Human-readable editor name for metadata. */
  readonly name: string;
  /**
   * Does this adapter handle the given element?
   * Check CSS classes, attributes, and ancestor classes.
   */
  matches(target: ElementIdentity, domContext: DomContext): boolean;
}

// ── Adapter Implementations ───────────────────────────────────────────

/** Quill — .ql-editor class on the editable region */
export const quillAdapter: EditorAdapter = {
  name: 'Quill',
  matches(target, _domContext) {
    const cls = target.className || '';
    if (/\bql-editor\b/i.test(cls)) return true;
    const ancestors = _domContext.ancestorClasses?.join(' ') || '';
    return /\bql-editor\b/i.test(ancestors);
  },
};

/** CKEditor 5 — .ck-editor__editable class */
export const ckEditorAdapter: EditorAdapter = {
  name: 'CKEditor',
  matches(target, _domContext) {
    const cls = target.className || '';
    if (/\bck-editor__editable\b/i.test(cls)) return true;
    const ancestors = _domContext.ancestorClasses?.join(' ') || '';
    return /\bck-content\b/i.test(ancestors) || /\bck-editor\b/i.test(ancestors);
  },
};

/** ProseMirror — .ProseMirror class */
export const prosemirrorAdapter: EditorAdapter = {
  name: 'ProseMirror',
  matches(target, _domContext) {
    const cls = target.className || '';
    if (/\bProseMirror\b/i.test(cls)) return true;
    const ancestors = _domContext.ancestorClasses?.join(' ') || '';
    return /\bProseMirror\b/i.test(ancestors);
  },
};

/** Slate.js — data-slate-editor attribute */
export const slateAdapter: EditorAdapter = {
  name: 'Slate',
  matches(target, _domContext) {
    // Slate sets data-slate-editor on the editable container.
    // This appears in the testId or can be detected via ancestor classes.
    const ancestors = _domContext.ancestorClasses?.join(' ') || '';
    return /\bslate-editor\b|\bslate-node\b/i.test(ancestors) ||
           /\bdata-slate-editor\b/i.test(target.testId || '');
  },
};

/** Draft.js — data-contents attribute (detected via ancestor classes) */
export const draftJsAdapter: EditorAdapter = {
  name: 'Draft.js',
  matches(_target, domContext) {
    const ancestors = domContext.ancestorClasses?.join(' ') || '';
    return /\bdraft-editor\b|\bpublic-DraftEditor\b/i.test(ancestors);
  },
};

/** TinyMCE — tox-edit-area / mce-content-body classes */
export const tinyMceAdapter: EditorAdapter = {
  name: 'TinyMCE',
  matches(target, domContext) {
    const cls = target.className || '';
    if (/\bmce-content-body\b/i.test(cls)) return true;
    const ancestors = domContext.ancestorClasses?.join(' ') || '';
    return /\btox-edit-area\b|\bmce-edit-area\b/i.test(ancestors);
  },
};

// ── Adapter Chain ─────────────────────────────────────────────────────

/**
 * All registered editor adapters in priority order.
 * First match wins. The generic contentEditable fallback is implicit
 * (handled by TextEntry when no adapter matches).
 */
export const EDITOR_ADAPTERS: EditorAdapter[] = [
  quillAdapter,
  ckEditorAdapter,
  prosemirrorAdapter,
  slateAdapter,
  draftJsAdapter,
  tinyMceAdapter,
];

/**
 * Detect the editor type for a contentEditable trigger element.
 * Returns the editor name, or null if no known adapter matches.
 */
export function detectEditor(
  target: ElementIdentity,
  domContext: DomContext,
): string | null {
  for (const adapter of EDITOR_ADAPTERS) {
    if (adapter.matches(target, domContext)) {
      return adapter.name;
    }
  }
  return null;
}

# P0-9: Rich Text Editor — EditorAdapter Interface

## Problem

Rich text editors (Quill, Draft.js, Slate, TinyMCE, CKEditor, ProseMirror) are
detected as TextEntry because `isContentEditable` is true. Text values are
extracted via `innerText`/`textContent` by identity-extractor.ts. However:

1. No editor identification — generated Playwright code uses `fill()` which doesn't
   work for most rich text editors (they need `click()` + `type()` or editor-specific APIs)
2. No HTML content capture — only plain text is extracted, losing formatting
3. No `interactionSubtype` — all contentEditable elements look the same to
   downstream layers

## Architecture

**NOT a new definition.** An EditorAdapter interface + adapter chain that
enhances TextEntry's `buildResult` when the trigger element is contentEditable.

```typescript
interface EditorAdapter {
  matches(domContext: DomContext, target: ElementIdentity): boolean;
  readonly name: string;
}
```

The adapter identifies the editor type. Value extraction already works via
`identity-extractor.ts` (`innerText`/`textContent` for contentEditable).

TextEntry's `buildResult` checks if `isContentEditable` is true, then iterates
the adapter chain. First match sets `interactionSubtype` and `editorType` metadata.
If no adapter matches, sets `interactionSubtype = 'ContentEditable'` (generic).

## Files to Change

1. `src/definitions/editor-adapters/types.ts` — EditorAdapter interface
2. `src/definitions/editor-adapters/index.ts` — adapter registry + chain
3. `src/definitions/text-entry.ts` — enhanced buildResult with adapter check
4. `src/classifier/interaction-types.ts` — RichTextEditor type/subtype
5. `src/generation/component-to-classifier-adapter.ts` — subtype mapping
6. `src/generation/ir-bridge.ts` — RichTextEditor description
7. `src/sidepanel/interaction-renderer.ts` — display entry
8. `tests/runtime/rich-text-editor.test.ts` — unit tests

## Acceptance Criteria

- [ ] Quill editor (.ql-editor) detected and identified as editorType='Quill'
- [ ] CKEditor 5 (.ck-editor__editable) detected as editorType='CKEditor'
- [ ] ProseMirror (.ProseMirror) detected as editorType='ProseMirror'
- [ ] Slate.js (data-slate-editor) detected as editorType='Slate'
- [ ] Draft.js (data-contents) detected as editorType='Draft.js'
- [ ] Generic contentEditable falls back to editorType='ContentEditable'
- [ ] interactionSubtype set to 'RichTextEditor' for all contentEditable
- [ ] Regular <input>/<textarea> NOT affected (no adapter check)
- [ ] Text value is correctly captured from the editor
- [ ] Existing 4,550 tests pass (zero regressions)

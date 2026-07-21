/**
 * File Upload — Comprehensive Detection Tests
 *
 * Validates FileUpload and DragDropUpload detection, metadata extraction,
 * and timeline phrasing across native HTML, Material UI (MUI), Ant Design,
 * Bootstrap, and generic frameworks.
 *
 * Also validates regression — DragDrop (element drag), TextEntry, and Click
 * detection remain unaffected.
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
  changeEvent,
  dragstartEvent,
  dropEvent,
  domContext,
} from './helpers.js';

const MIN_CONFIDENCE = COMMIT_THRESHOLD;

/** Helper: find an interaction of a specific type from V2 results. */
function findType(result: DetectedInteraction[], type: string): DetectedInteraction | undefined {
  return result.find(r => r.type === type);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FILEUPLOAD — NATIVE HTML FILE INPUT
// ═══════════════════════════════════════════════════════════════════════════════

describe('FileUpload — Native HTML', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('input[type=file] change → FileUpload with files metadata', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Resume Upload',
        cssSelector: 'input[type="file"]#resume',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [{ name: 'resume.pdf', type: 'application/pdf' }],
        uploadMethod: 'browse',
        acceptedFileTypes: '.pdf,.doc,.docx',
        multipleFiles: false,
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.files).toEqual(['resume.pdf']);
      expect(fu!.metadata.fileCount).toBe(1);
      expect(fu!.metadata.uploadMethod).toBe('browse');
      expect(fu!.metadata.acceptedFileTypes).toBe('.pdf,.doc,.docx');
      expect(fu!.metadata.multiple).toBe(false);
      expect(fu!.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
    });

    it('input[type=file] via domContext only (no cssSelector) → FileUpload', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Document',
        cssSelector: '#doc-upload',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [{ name: 'contract.pdf', type: 'application/pdf' }],
        uploadMethod: 'browse',
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.files).toEqual(['contract.pdf']);
    });

    it('file names are real names (not C:\\fakepath\\)', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Avatar',
        cssSelector: 'input[type="file"]#avatar',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [{ name: 'photo.jpg', type: 'image/jpeg' }],
        uploadMethod: 'browse',
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.files).toEqual(['photo.jpg']);
      // Must NOT contain the fake path
      expect(fu!.metadata.files?.[0]).not.toContain('fakepath');
    });

    it('multiple files → correct file count', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Attachments',
        cssSelector: 'input[type="file"]#attach',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [
          { name: 'file1.pdf', type: 'application/pdf' },
          { name: 'file2.pdf', type: 'application/pdf' },
          { name: 'file3.jpg', type: 'image/jpeg' },
        ],
        uploadMethod: 'browse',
        multipleFiles: true,
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.fileCount).toBe(3);
      expect(fu!.metadata.files).toHaveLength(3);
      expect(fu!.metadata.multiple).toBe(true);
    });

    it('accept attribute captured', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Image Upload',
        cssSelector: 'input[type="file"]#img',
      });
      const ctx = domContext({
        inputType: 'file',
        acceptedFileTypes: 'image/*',
        fileData: [{ name: 'photo.png', type: 'image/png' }],
        uploadMethod: 'browse',
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.acceptedFileTypes).toBe('image/*');
    });

    it('no file data (empty change) → still FileUpload but no file names', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Upload',
        cssSelector: 'input[type="file"]#up',
      });
      const ctx = domContext({
        inputType: 'file',
      });

      const result = detectInteractionsV2([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.files).toBeUndefined();
      expect(fu!.metadata.fileCount).toBeUndefined();
    });
  });

  describe('V1 Interaction Detector', () => {
    it('input[type=file] change → FileUpload with files metadata', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Resume',
        cssSelector: 'input[type="file"]#resume',
        name: 'resume',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [{ name: 'resume.pdf', type: 'application/pdf' }],
        uploadMethod: 'browse',
      });

      const result = detectInteractions([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.files).toEqual(['resume.pdf']);
      expect(fu!.metadata.fileCount).toBe(1);
      expect(fu!.metadata.uploadMethod).toBe('browse');
    });

    it('multiple files → correct count in V1', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Docs',
        cssSelector: 'input[type="file"]#docs',
        name: 'documents',
      });
      const ctx = domContext({
        inputType: 'file',
        fileData: [
          { name: 'a.pdf', type: 'application/pdf' },
          { name: 'b.pdf', type: 'application/pdf' },
        ],
        uploadMethod: 'browse',
        multipleFiles: true,
      });

      const result = detectInteractions([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
      expect(fu!.metadata.fileCount).toBe(2);
      expect(fu!.metadata.multiple).toBe(true);
    });

    it('V1 uses domContext.inputType for detection', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'File',
        cssSelector: '#file-input', // No type=file in selector
      });
      const ctx = domContext({
        inputType: 'file',
      });

      const result = detectInteractions([
        changeEvent(input, { domContext: ctx }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FILEUPLOAD — FRAMEWORK CSS DETECTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('FileUpload — Framework Detection', () => {
  beforeEach(() => resetEventCounter());

  describe('Material UI', () => {
    it('MuiDropzoneArea-root → FileUpload', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Drop files here',
        className: 'MuiDropzoneArea-root',
        cssSelector: 'div#mui-dropzone',
      });

      const result = detectInteractionsV2([
        clickEvent(dropzone, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('MuiDropzone-root → FileUpload', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Upload',
        className: 'MuiDropzone-root',
        cssSelector: 'div#mui-dz',
      });

      const result = detectInteractionsV2([
        clickEvent(dropzone, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });
  });

  describe('Ant Design', () => {
    it('ant-upload → FileUpload', () => {
      const upload = makeTarget({
        tag: 'DIV', accessibleName: 'Click to upload',
        className: 'ant-upload ant-upload-select',
        cssSelector: 'div#antd-upload',
      });

      const result = detectInteractionsV2([
        clickEvent(upload, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('ant-upload-btn → FileUpload', () => {
      const btn = makeTarget({
        tag: 'DIV', accessibleName: 'Upload Button',
        className: 'ant-upload-btn',
        cssSelector: 'div#antd-btn',
      });

      const result = detectInteractionsV2([
        clickEvent(btn, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('ant-upload-dragger → DragDropUpload', () => {
      const dragger = makeTarget({
        tag: 'DIV', accessibleName: 'Drag files here',
        className: 'ant-upload-dragger',
        cssSelector: 'div#antd-dragger',
      });

      const result = detectInteractionsV2([
        clickEvent(dragger, { domContext: domContext() }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
    });
  });

  describe('Bootstrap', () => {
    it('form-control-file → FileUpload', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Choose file',
        className: 'form-control-file',
        cssSelector: 'input#bs-file',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('custom-file-input → FileUpload', () => {
      const input = makeTarget({
        tag: 'INPUT', accessibleName: 'Browse',
        className: 'custom-file-input',
        cssSelector: 'input#bs-custom',
      });

      const result = detectInteractionsV2([
        clickEvent(input, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });
  });

  describe('Generic patterns', () => {
    it('upload-area → FileUpload', () => {
      const area = makeTarget({
        tag: 'DIV', accessibleName: 'Upload Area',
        className: 'upload-area',
        cssSelector: 'div#upload-area',
      });

      const result = detectInteractionsV2([
        clickEvent(area, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('file-upload → FileUpload', () => {
      const area = makeTarget({
        tag: 'DIV', accessibleName: 'File Upload',
        className: 'file-upload-container',
        cssSelector: 'div#file-upload',
      });

      const result = detectInteractionsV2([
        clickEvent(area, { domContext: domContext() }),
      ]);

      const fu = findType(result, 'FileUpload');
      expect(fu).toBeDefined();
    });

    it('dropzone → DragDropUpload', () => {
      const dz = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Zone',
        className: 'react-dropzone',
        cssSelector: 'div#rdz',
      });

      const result = detectInteractionsV2([
        clickEvent(dz, { domContext: domContext() }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
    });

    it('drop-zone → DragDropUpload', () => {
      const dz = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Zone',
        className: 'drop-zone',
        cssSelector: 'div#dz',
      });

      const result = detectInteractionsV2([
        clickEvent(dz, { domContext: domContext() }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. DRAG-DROP UPLOAD (FILE DRAG FROM OS)
// ═══════════════════════════════════════════════════════════════════════════════

describe('DragDropUpload — File Drag-Drop', () => {
  beforeEach(() => resetEventCounter());

  describe('V2 Evidence Engine', () => {
    it('drop with fileData → DragDropUpload (NOT DragDrop)', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Upload Area',
        className: 'react-dropzone',
        cssSelector: 'div#dz',
      });
      const ctx = domContext({
        fileData: [{ name: 'photo.jpg', type: 'image/jpeg' }],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractionsV2([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      const dd = findType(result, 'DragDrop');
      expect(ddu).toBeDefined();
      expect(dd).toBeUndefined();
      expect(ddu!.metadata.files).toEqual(['photo.jpg']);
      expect(ddu!.metadata.fileCount).toBe(1);
      expect(ddu!.metadata.uploadMethod).toBe('drag-drop');
    });

    it('multiple files dropped → DragDropUpload with count', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Files',
        className: 'drop-zone',
        cssSelector: 'div#dz2',
      });
      const ctx = domContext({
        fileData: [
          { name: 'file1.pdf', type: 'application/pdf' },
          { name: 'file2.pdf', type: 'application/pdf' },
          { name: 'file3.jpg', type: 'image/jpeg' },
        ],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractionsV2([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.fileCount).toBe(3);
      expect(ddu!.metadata.files).toHaveLength(3);
    });

    it('drop with acceptedFileTypes → metadata captured', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'PDF Drop',
        className: 'upload-drop-zone',
        cssSelector: 'div#pdf-dz',
      });
      const ctx = domContext({
        fileData: [{ name: 'doc.pdf', type: 'application/pdf' }],
        uploadMethod: 'drag-drop',
        acceptedFileTypes: '.pdf',
      });

      const result = detectInteractionsV2([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.acceptedFileTypes).toBe('.pdf');
    });

    // ── Combined CSS + drop scenarios (multi-provider reinforcement) ──

    it('MUI Dropzone CSS + drop with files → DragDropUpload', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Files Here',
        className: 'MuiDropzoneArea-root',
        cssSelector: 'div#mui-dz-drop',
      });
      const ctx = domContext({
        fileData: [{ name: 'report.pdf', type: 'application/pdf' }],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractionsV2([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.files).toEqual(['report.pdf']);
    });

    it('AntD upload-dragger CSS + drop with files → DragDropUpload', () => {
      const dragger = makeTarget({
        tag: 'DIV', accessibleName: 'Drag files here',
        className: 'ant-upload-dragger',
        cssSelector: 'div#antd-dragger-drop',
      });
      const ctx = domContext({
        fileData: [
          { name: 'a.pdf', type: 'application/pdf' },
          { name: 'b.jpg', type: 'image/jpeg' },
        ],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractionsV2([
        dropEvent(dragger, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.fileCount).toBe(2);
    });

    it('react-dropzone CSS + drop with files → DragDropUpload', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Zone',
        className: 'react-dropzone',
        cssSelector: 'div#rdz-drop',
      });
      const ctx = domContext({
        fileData: [{ name: 'avatar.png', type: 'image/png' }],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractionsV2([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.files).toEqual(['avatar.png']);
    });
  });

  describe('V1 Interaction Detector', () => {
    it('drop with fileData → DragDropUpload (NOT DragDrop)', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Drop Area',
        className: 'dropzone',
        cssSelector: 'div#dz3',
      });
      const ctx = domContext({
        fileData: [{ name: 'invoice.pdf', type: 'application/pdf' }],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractions([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      const dd = findType(result, 'DragDrop');
      expect(ddu).toBeDefined();
      expect(dd).toBeUndefined();
      expect(ddu!.metadata.files).toEqual(['invoice.pdf']);
      expect(ddu!.metadata.uploadMethod).toBe('drag-drop');
    });

    it('multiple files → DragDropUpload in V1', () => {
      const dropzone = makeTarget({
        tag: 'DIV', accessibleName: 'Multi Drop',
        cssSelector: 'div#dz4',
      });
      const ctx = domContext({
        fileData: [
          { name: 'a.pdf', type: 'application/pdf' },
          { name: 'b.pdf', type: 'application/pdf' },
        ],
        uploadMethod: 'drag-drop',
      });

      const result = detectInteractions([
        dropEvent(dropzone, { domContext: ctx }),
      ]);

      const ddu = findType(result, 'DragDropUpload');
      expect(ddu).toBeDefined();
      expect(ddu!.metadata.fileCount).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. TIMELINE PHRASING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Timeline Phrasing', () => {
  // Helper: create a minimal DetectedInteraction for timeline testing
  function makeInteraction(
    type: string,
    metadata: Record<string, unknown>,
    targetName = '',
  ): DetectedInteraction {
    return {
      interactionId: 'test-1',
      type: type as any,
      eventIds: ['evt-0001'],
      rawEventTypes: ['change'],
      target: makeTarget({ accessibleName: targetName }),
      metadata: metadata as any,
      confidence: 0.9,
    };
  }

  describe('FileUpload phrasing', () => {
    it('single file → Upload "file.pdf" to "Documents"', () => {
      const interaction = makeInteraction('FileUpload', {
        files: ['invoice.pdf'],
        fileCount: 1,
        uploadMethod: 'browse',
      }, 'Documents');
      expect(actionDescription(interaction)).toBe('Upload "invoice.pdf" to "Documents"');
    });

    it('single file without target name', () => {
      const interaction = makeInteraction('FileUpload', {
        files: ['photo.jpg'],
        fileCount: 1,
        uploadMethod: 'browse',
      });
      expect(actionDescription(interaction)).toBe('Upload "photo.jpg"');
    });

    it('multiple files → Upload N files to "Attachments"', () => {
      const interaction = makeInteraction('FileUpload', {
        files: ['a.pdf', 'b.pdf', 'c.pdf'],
        fileCount: 3,
        uploadMethod: 'browse',
      }, 'Attachments');
      expect(actionDescription(interaction)).toBe('Upload 3 files to "Attachments"');
    });

    it('multiple files without target name', () => {
      const interaction = makeInteraction('FileUpload', {
        files: ['a.pdf', 'b.pdf'],
        fileCount: 2,
        uploadMethod: 'browse',
      });
      expect(actionDescription(interaction)).toBe('Upload 2 files');
    });

    it('no file names → Upload file "Resume"', () => {
      const interaction = makeInteraction('FileUpload', {}, 'Resume');
      expect(actionDescription(interaction)).toBe('Upload file "Resume"');
    });

    it('no file names, no target → Upload file', () => {
      const interaction = makeInteraction('FileUpload', {});
      expect(actionDescription(interaction)).toBe('Upload file');
    });

    it('drag-drop browse shows "by drag-drop" suffix', () => {
      const interaction = makeInteraction('FileUpload', {
        files: ['doc.pdf'],
        fileCount: 1,
        uploadMethod: 'drag-drop',
      }, 'Upload');
      expect(actionDescription(interaction)).toBe('Upload "doc.pdf" to "Upload" by drag-drop');
    });
  });

  describe('DragDropUpload phrasing', () => {
    it('single file → Drag "photo.jpg" to "Upload Area"', () => {
      const interaction = makeInteraction('DragDropUpload', {
        files: ['photo.jpg'],
        fileCount: 1,
      }, 'Upload Area');
      expect(actionDescription(interaction)).toBe('Drag "photo.jpg" to "Upload Area"');
    });

    it('multiple files → Drag N files to "Drop Zone"', () => {
      const interaction = makeInteraction('DragDropUpload', {
        files: ['a.jpg', 'b.jpg', 'c.jpg'],
        fileCount: 3,
      }, 'Drop Zone');
      expect(actionDescription(interaction)).toBe('Drag 3 files to "Drop Zone"');
    });

    it('no target name → defaults to "Upload Area"', () => {
      const interaction = makeInteraction('DragDropUpload', {
        files: ['file.pdf'],
        fileCount: 1,
      });
      expect(actionDescription(interaction)).toBe('Drag "file.pdf" to "Upload Area"');
    });

    it('no file names → Drag file to "Upload Area"', () => {
      const interaction = makeInteraction('DragDropUpload', {});
      expect(actionDescription(interaction)).toBe('Drag file to "Upload Area"');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. REGRESSION — DRAGDROP (ELEMENT DRAG) UNAFFECTED
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — DragDrop (element drag)', () => {
  beforeEach(() => resetEventCounter());

  it('dragstart + drop (no files) → DragDrop, NOT DragDropUpload', () => {
    const source = makeTarget({
      tag: 'DIV', accessibleName: 'Task Card',
      cssSelector: 'div#task-card',
    });
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Done Column',
      cssSelector: 'div#done-col',
    });

    const result = detectInteractionsV2([
      dragstartEvent(source),
      dropEvent(target),
    ]);

    const dd = findType(result, 'DragDrop');
    const ddu = findType(result, 'DragDropUpload');
    expect(dd).toBeDefined();
    expect(ddu).toBeUndefined();
  });

  it('dragstart + drop (no files) in V1 → DragDrop', () => {
    const source = makeTarget({
      tag: 'DIV', accessibleName: 'Item',
      cssSelector: 'div#item',
    });
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Bin',
      cssSelector: 'div#bin',
    });

    const result = detectInteractions([
      dragstartEvent(source),
      dropEvent(target),
    ]);

    const dd = findType(result, 'DragDrop');
    const ddu = findType(result, 'DragDropUpload');
    expect(dd).toBeDefined();
    expect(ddu).toBeUndefined();
  });

  it('standalone dragstart → DragDrop (incomplete)', () => {
    const source = makeTarget({
      tag: 'DIV', accessibleName: 'Widget',
      cssSelector: 'div#widget',
    });

    const result = detectInteractionsV2([
      dragstartEvent(source),
    ]);

    const dd = findType(result, 'DragDrop');
    expect(dd).toBeDefined();
  });

  it('standalone drop (no files, no dragstart) → DragDrop', () => {
    const target = makeTarget({
      tag: 'DIV', accessibleName: 'Container',
      cssSelector: 'div#container',
    });

    const result = detectInteractionsV2([
      dropEvent(target),
    ]);

    const dd = findType(result, 'DragDrop');
    const ddu = findType(result, 'DragDropUpload');
    expect(dd).toBeDefined();
    expect(ddu).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. REGRESSION — TEXT ENTRY UNAFFECTED
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — TextEntry unaffected', () => {
  beforeEach(() => resetEventCounter());

  it('text input is NOT classified as FileUpload', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Username',
      cssSelector: 'input[type="text"]#username',
    });
    const ctx = domContext({ inputType: 'text' });

    const result = detectInteractionsV2([
      changeEvent(input, { valueAfter: 'john', domContext: ctx }),
    ]);

    const fu = findType(result, 'FileUpload');
    expect(fu).toBeUndefined();
  });

  it('file input is NOT classified as TextEntry', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Upload File',
      cssSelector: 'input[type="file"]#up',
    });
    const ctx = domContext({
      inputType: 'file',
      fileData: [{ name: 'doc.pdf', type: 'application/pdf' }],
      uploadMethod: 'browse',
    });

    const result = detectInteractionsV2([
      changeEvent(input, { domContext: ctx }),
    ]);

    const te = findType(result, 'TextEntry');
    expect(te).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. REGRESSION — CLICK UNAFFECTED
// ═══════════════════════════════════════════════════════════════════════════════

describe('Regression — Click unaffected', () => {
  beforeEach(() => resetEventCounter());

  it('button click is NOT classified as FileUpload', () => {
    const button = makeTarget({
      tag: 'BUTTON', accessibleName: 'Submit',
      cssSelector: 'button#submit',
    });

    const result = detectInteractionsV2([
      clickEvent(button),
    ]);

    const fu = findType(result, 'FileUpload');
    expect(fu).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. RAW EVENT INTEGRITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Raw Event Integrity', () => {
  beforeEach(() => resetEventCounter());

  it('FileUpload preserves change event ID', () => {
    const input = makeTarget({
      tag: 'INPUT', accessibleName: 'Doc',
      cssSelector: 'input[type="file"]#doc',
    });
    const ctx = domContext({
      inputType: 'file',
      fileData: [{ name: 'doc.pdf', type: 'application/pdf' }],
      uploadMethod: 'browse',
    });

    const events = [changeEvent(input, { domContext: ctx })];
    const ids = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);
    const fu = findType(result, 'FileUpload');
    expect(fu).toBeDefined();
    for (const id of ids) {
      expect(fu!.eventIds).toContain(id);
    }
  });

  it('DragDropUpload preserves drop event ID', () => {
    const dropzone = makeTarget({
      tag: 'DIV', accessibleName: 'Drop Zone',
      cssSelector: 'div#dz',
    });
    const ctx = domContext({
      fileData: [{ name: 'photo.jpg', type: 'image/jpeg' }],
      uploadMethod: 'drag-drop',
    });

    const events = [dropEvent(dropzone, { domContext: ctx })];
    const ids = events.map(e => e.eventId);

    const result = detectInteractionsV2(events);
    const ddu = findType(result, 'DragDropUpload');
    expect(ddu).toBeDefined();
    for (const id of ids) {
      expect(ddu!.eventIds).toContain(id);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. FULL WORKFLOW — MIXED UPLOAD FORM
// ═══════════════════════════════════════════════════════════════════════════════

describe('Full Upload Workflow', () => {
  beforeEach(() => resetEventCounter());

  it('Form: FileUpload (browse) + DragDropUpload (drag-drop)', () => {
    const fileInput = makeTarget({
      tag: 'INPUT', accessibleName: 'Profile Photo',
      cssSelector: 'input[type="file"]#photo',
    });
    const dropzone = makeTarget({
      tag: 'DIV', accessibleName: 'Documents',
      className: 'react-dropzone',
      cssSelector: 'div#docs-dz',
    });

    const result = detectInteractionsV2([
      changeEvent(fileInput, {
        domContext: domContext({
          inputType: 'file',
          fileData: [{ name: 'avatar.png', type: 'image/png' }],
          uploadMethod: 'browse',
        }),
      }),
      dropEvent(dropzone, {
        domContext: domContext({
          fileData: [{ name: 'resume.pdf', type: 'application/pdf' }],
          uploadMethod: 'drag-drop',
        }),
      }),
    ]);

    const fu = findType(result, 'FileUpload');
    const ddu = findType(result, 'DragDropUpload');

    expect(fu).toBeDefined();
    expect(ddu).toBeDefined();

    expect(fu!.metadata.files).toEqual(['avatar.png']);
    expect(fu!.metadata.uploadMethod).toBe('browse');

    expect(ddu!.metadata.files).toEqual(['resume.pdf']);
    expect(ddu!.metadata.uploadMethod).toBe('drag-drop');

    // No event ID overlap
    expect(fu!.eventIds.filter(id => ddu!.eventIds.includes(id)).length).toBe(0);
  });
});

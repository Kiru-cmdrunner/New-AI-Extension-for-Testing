# File Upload — Complete Detection & Metadata

## Goal
Achieve full production-level detection for FileUpload and DragDropUpload interactions across native HTML, Material UI (MUI), Ant Design, and Bootstrap. Currently, both types exist in the `InteractionType` enum and `DomProvider` detects native file inputs, but **no file metadata is extracted** (names, count, upload method, accepted types), **DragDropUpload has no detection logic at all**, and the timeline phrasing is generic (`Upload file "X"`).

## Current State

| Aspect | Status |
|--------|--------|
| `FileUpload` type in enum | ✅ Exists |
| `DragDropUpload` type in enum | ✅ Exists |
| `DomProvider` native file input detection | ✅ Detects `inputType==='file'` |
| `InteractionMetadata.files` field | ✅ Exists (string[]) |
| File metadata extraction | ❌ `DomProvider` returns `{}` metadata |
| `DragDropUpload` V2 detection | ❌ No detection at all |
| `DragDropUpload` V1 detection | ❌ Only `FileUpload` detected |
| `fileCount` metadata | ❌ Missing |
| `uploadMethod` metadata | ❌ Missing |
| `acceptedFileTypes` metadata | ❌ Missing |
| `multiple` attribute | ❌ Missing |
| Timeline phrasing | ⚠️ Generic `Upload file "X"` — no file names/count/method |
| `DragDropUpload` timeline case | ❌ Missing entirely |
| MUI dropzone CSS detection | ❌ Missing |
| AntD upload CSS detection | ❌ Missing |
| Bootstrap file input CSS detection | ❌ Missing |
| Tests for file upload | ❌ None exist |

## Architecture — How File Upload Events Flow

```
Content Script (deterministic-recorder.ts)
  │  User picks files via browse dialog → <input type="file"> change event
  │  User drags files onto a dropzone → drop event with dataTransfer.files
  ▼
RecordedEvent (ElementRecordedEvent with eventType='change' or 'drop')
  │  Currently: NO file metadata captured (valueAfter is empty for file inputs)
  ▼
Evidence Engine V2 (providers → combination → DetectedInteraction)
  │  DomProvider detects inputType='file' → FileUpload
  │  EventSequenceProvider handles 'drop' → currently emits DragDrop, NOT DragDropUpload
  ▼
V1 Detector (interaction-detector.ts)
  │  isFileInput() checks name/className for 'file'/'upload' → FileUpload with {} metadata
  ▼
Timeline Renderer → plain English description
  │  "Upload file 'Resume'" (no file names, no count)
```

## Key Design Decision: File Metadata Capture

File inputs have a special behavior: `input.value` for `<input type="file">` is a fake path like `C:\fakepath\filename.pdf` (security restriction). The **real** file data is in `input.files` (a FileList). Similarly, drag-and-drop zones receive files via `event.dataTransfer.files`.

The content script must capture this file data at event time because the Evidence Engine and V1 detector only see the recorded event (the DOM has changed by then).

### What to Capture
- **File names** — from `input.files[i].name` or `event.dataTransfer.files[i].name`
- **File count** — `files.length`
- **Upload method** — `'browse'` for native input change, `'drag-drop'` for drop events
- **Accepted file types** — from the input's `accept` attribute (e.g., `.pdf,image/*`)
- **Multiple attribute** — whether the input has `multiple` attribute

## Implementation

### Phase 1: Type Extensions

#### `src/recorder/recorded-event.ts` — DomContext
Add to the `DomContext` interface:
```typescript
/** For file inputs: accepted file types from the accept attribute. null if no accept attribute. */
acceptedFileTypes?: string | null;
/** For file inputs: whether the multiple attribute is present. */
multipleFiles?: boolean;
/** Files captured at event time. Array of {name, type}. */
fileData?: { name: string; type: string }[] | null;
/** How files were uploaded: 'browse' (input change) or 'drag-drop' (drop event). */
uploadMethod?: 'browse' | 'drag-drop' | null;
```

#### `src/recorder/recorded-event.ts` — ElementRecordedEvent
No change needed — `domContext` already covers it. The file data rides on domContext.

#### `src/classifier/interaction-types.ts` — InteractionMetadata
Add new fields:
```typescript
// File Upload
files?: string[];                    // already exists — file names
fileCount?: number;                  // NEW — number of files uploaded
uploadMethod?: string;               // NEW — 'browse' or 'drag-drop'
acceptedFileTypes?: string;          // NEW — accept attribute value
multiple?: boolean;                  // NEW — multiple attribute present
```

### Phase 2: Content Script — Capture File Metadata

#### `src/recorder/deterministic-recorder.ts`

**2a. Extend `captureDomContext()`** to capture file-specific fields:
```typescript
if (el instanceof HTMLInputElement && el.type === 'file') {
  domContext.acceptedFileTypes = el.accept || null;
  domContext.multipleFiles = el.multiple;
}
```

**2b. Extend the `change` event handler** for file inputs:
When `target` is an `<input type="file">`, extract `target.files`:
```typescript
if (target instanceof HTMLInputElement && target.type === 'file') {
  const fileData = Array.from(target.files ?? []).map(f => ({ name: f.name, type: f.type }));
  domContext.fileData = fileData.length > 0 ? fileData : null;
  domContext.uploadMethod = 'browse';
}
```
This replaces the current empty valueAfter for file inputs.

**2c. Extend the `drop` event handler** to capture dropped files:
```typescript
document.addEventListener('drop', (event) => {
  // ... existing recording/isTrusted guards ...
  const target = resolveTarget(event);
  if (!target) return;

  // Capture dropped files
  const domContext = captureDomContext(target);
  const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
  if (droppedFiles.length > 0) {
    domContext.fileData = droppedFiles.map(f => ({ name: f.name, type: f.type }));
    domContext.uploadMethod = 'drag-drop';
  }
  // Also detect dropzone context
  if (isDropzone(target)) {
    domContext.acceptedFileTypes = findAcceptInContainer(target);
  }

  sendEvent('drop', target, null, null, null, null, null, domContext);
}, true);
```

**2d. Update `sendEvent()` signature** to accept an optional pre-built domContext (currently it builds it internally). This is needed because the drop handler needs to augment the domContext with file data before sending.

**2e. Add `isDropzone()` helper** — detects upload dropzones by CSS class patterns:
- `ant-upload` (AntD)
- `MuiDropzoneArea-root`, `MuiDropzone-root` (MUI)
- `react-dropzone`, `dropzone` (react-dropzone / generic)
- `upload-area`, `upload-zone`, `file-drop` (generic)
- Elements with `ondrop` attribute

### Phase 3: V2 Evidence Engine Providers

#### `src/classifier/evidence/providers/dom-provider.ts`

**3a. FileUpload metadata extraction:**
Update the existing file input detection to extract metadata from `domContext.fileData`:
```typescript
if (isFileInput(domCtx, cssSelector, name)) {
  const meta = extractFileMetadata(domCtx);
  evidence.push({
    provider: this.name,
    suggestedType: 'FileUpload' as InteractionType,
    confidence: 0.95,
    weight: 0.9,
    metadata: meta,
    reason: `File input detected (type=file or name contains file/upload)`,
  });
}
```

New helper:
```typescript
function extractFileMetadata(domCtx: DomContext | undefined): Partial<InteractionMetadata> {
  if (!domCtx) return {};
  const meta: Partial<InteractionMetadata> = {};
  if (domCtx.fileData && domCtx.fileData.length > 0) {
    meta.files = domCtx.fileData.map(f => f.name);
    meta.fileCount = domCtx.fileData.length;
  }
  if (domCtx.uploadMethod) meta.uploadMethod = domCtx.uploadMethod;
  if (domCtx.acceptedFileTypes) meta.acceptedFileTypes = domCtx.acceptedFileTypes;
  if (domCtx.multipleFiles !== undefined) meta.multiple = domCtx.multipleFiles;
  return meta;
}
```

**3b. DragDropUpload detection on drop events:**
When a `drop` event carries `fileData` (files dragged from OS), emit DragDropUpload evidence. This must work alongside the existing DragDrop detection. The distinction:
- `drop` with `fileData` → **DragDropUpload** (files from OS to a dropzone)
- `drop` with a preceding `dragstart` → **DragDrop** (element dragged within the page)

Add to `onEvent()`:
```typescript
// ── Drop with files → DragDropUpload ──
if (event.eventType === 'drop' && domCtx?.fileData && domCtx.fileData.length > 0) {
  const meta = extractFileMetadata(domCtx);
  evidence.push({
    provider: this.name,
    suggestedType: 'DragDropUpload' as InteractionType,
    confidence: 0.95,
    weight: 0.9,
    metadata: meta,
    reason: `Drop event with ${domCtx.fileData.length} file(s) — drag-drop file upload`,
  });
}
```

#### `src/classifier/evidence/providers/event-sequence-provider.ts`

**3c. Drop events with files → DragDropUpload (not DragDrop):**
Update the existing `case 'drop'` handler:
```typescript
case 'drop': {
  const fileData = event.domContext?.fileData;
  if (fileData && fileData.length > 0) {
    return [{
      provider: this.name,
      suggestedType: 'DragDropUpload' as InteractionType,
      confidence: 0.9,
      weight: 0.85,
      metadata: {
        ...extractFileMetadata(event.domContext),
        dropTarget: event.target.accessibleName || undefined,
      },
      reason: 'drop event with file data — drag-drop upload',
    }];
  }
  // Existing: no file data → element drag-drop
  return [{
    provider: this.name,
    suggestedType: 'DragDrop' as InteractionType,
    confidence: 0.85,
    weight: 0.8,
    metadata: extractDropMetadata(event),
    reason: 'drop event detected',
  }];
}
```

**3d. dragstart with files → DragDropUpload:**
If a `dragstart` event's target is a file input or dropzone, hint at DragDropUpload. This covers the rare case where dragstart fires on a file element.

#### `src/classifier/evidence/providers/css-classname-provider.ts`

**3e. MUI dropzone detection:**
Add to `MUI_COMPONENT_MAP`:
```typescript
'Dropzone':      { type: 'FileUpload', confidence: 0.85, weight: 0.8 },
'DropzoneArea':  { type: 'FileUpload', confidence: 0.85, weight: 0.8 },
```

**3f. AntD upload detection:**
Add to `ANTD_COMPONENT_MAP`:
```typescript
'upload':           { type: 'FileUpload', confidence: 0.85, weight: 0.8 },
'upload-dragger':   { type: 'DragDropUpload', confidence: 0.85, weight: 0.8 },
'upload-btn':       { type: 'FileUpload', confidence: 0.8, weight: 0.75 },
```

**3g. Bootstrap file input detection:**
Add to `BOOTSTRAP_CLASS_MAP`:
```typescript
'form-control-file': { type: 'FileUpload', confidence: 0.8, weight: 0.75 },
'custom-file-input': { type: 'FileUpload', confidence: 0.8, weight: 0.75 },
```

**3h. Generic upload/dropzone patterns:**
Add to the generic section:
```typescript
if (lower.includes('dropzone') || lower.includes('drop-zone') || lower.includes('file-drop')) {
  return { type: 'DragDropUpload', confidence: 0.75, weight: 0.7, framework: 'Generic' };
}
if (lower.includes('upload-area') || lower.includes('upload-zone') || lower.includes('file-upload')) {
  return { type: 'FileUpload', confidence: 0.7, weight: 0.65, framework: 'Generic' };
}
```

**Important ordering**: upload patterns must be checked BEFORE any generic 'file' or 'upload' substring matching to avoid false positives. The generic patterns use specific compound names (dropzone, upload-area) not bare 'upload'.

### Phase 4: V1 Interaction Detector

#### `src/classifier/interaction-detector.ts`

**4a. Improve `isFileInput()` — use domContext.inputType:**
```typescript
function isFileInput(identity: ElementIdentity, domCtx?: DomContext): boolean {
  if (domCtx?.inputType === 'file') return true;
  const cssSel = identity.cssSelector ?? '';
  if (/type=["']?file["']?/i.test(cssSel)) return true;
  const nameOrClass = `${identity.name ?? ''} ${identity.className ?? ''}`.toLowerCase();
  return nameOrClass.includes('file') || nameOrClass.includes('upload');
}
```

**4b. Extract file metadata in FileUpload detection:**
```typescript
if (target.tag === 'INPUT' && isFileInput(target, domCtx)) {
  const meta: InteractionMetadata = {};
  const fileCtx = events[0]?.domContext;
  if (fileCtx?.fileData) {
    meta.files = fileCtx.fileData.map(f => f.name);
    meta.fileCount = fileCtx.fileData.length;
  }
  if (fileCtx?.uploadMethod) meta.uploadMethod = fileCtx.uploadMethod;
  if (fileCtx?.acceptedFileTypes) meta.acceptedFileTypes = fileCtx.acceptedFileTypes;
  if (fileCtx?.multipleFiles !== undefined) meta.multiple = fileCtx.multipleFiles;
  return { type: 'FileUpload', metadata: meta, confidence: 1.0 };
}
```

**4c. Add DragDropUpload detection before the existing DragDrop section:**
```typescript
// ── Drag & Drop Upload (file drag-drop, not element drag-drop) ──
{
  const dropEvent = events.find(e => e.eventType === 'drop') as ElementRecordedEvent | undefined;
  if (dropEvent && dropEvent.domContext?.fileData && dropEvent.domContext.fileData.length > 0) {
    const meta: InteractionMetadata = {};
    meta.files = dropEvent.domContext.fileData.map(f => f.name);
    meta.fileCount = dropEvent.domContext.fileData.length;
    meta.uploadMethod = 'drag-drop';
    if (dropEvent.domContext.acceptedFileTypes) meta.acceptedFileTypes = dropEvent.domContext.acceptedFileTypes;
    return { type: 'DragDropUpload', metadata: meta, confidence: 1.0 };
  }
}
```
This must be placed BEFORE the DragDrop detection section.

### Phase 5: Timeline Renderer

#### `src/sidepanel/timeline-renderer.ts`

**5a. FileUpload case — replace generic phrasing:**
```typescript
case 'FileUpload': {
  const files = m.files ?? [];
  const method = m.uploadMethod === 'drag-drop' ? ' by drag-drop' : '';
  if (files.length === 1) {
    return `Upload "${files[0]}"${targetName ? ` to "${targetName}"` : ''}${method}`;
  }
  if (files.length > 1) {
    return `Upload ${files.length} files${targetName ? ` to "${targetName}"` : ''}${method}`;
  }
  return `Upload file${targetName ? ` "${targetName}"` : ''}`;
}
```

**5b. Add DragDropUpload case:**
```typescript
case 'DragDropUpload': {
  const files = m.files ?? [];
  if (files.length === 1) {
    return `Drag "${files[0]}" to ${targetName ? `"${targetName}"` : 'Upload Area'}`;
  }
  if (files.length > 1) {
    return `Drag ${files.length} files to ${targetName ? `"${targetName}"` : 'Upload Area'}`;
  }
  return `Drag file to ${targetName ? `"${targetName}"` : 'Upload Area'}`;
}
```

## Timeline Examples
- Upload `"invoice.pdf"` → `Upload "invoice.pdf" to "Documents"`
- Upload 3 files → `Upload 3 files to "Attachments"`
- Drag `"photo.jpg"` → `Drag "photo.jpg" to "Upload Area"`
- No file names → `Upload file "Resume"` (fallback)

## Files to Change

| File | Change |
|------|--------|
| `src/recorder/recorded-event.ts` | Add file fields to DomContext |
| `src/recorder/deterministic-recorder.ts` | Capture file metadata in change/drop handlers |
| `src/classifier/interaction-types.ts` | Add fileCount, uploadMethod, acceptedFileTypes, multiple to InteractionMetadata |
| `src/classifier/evidence/providers/dom-provider.ts` | Extract file metadata, detect DragDropUpload on drop |
| `src/classifier/evidence/providers/event-sequence-provider.ts` | Distinguish file drop from element drop |
| `src/classifier/evidence/providers/css-classname-provider.ts` | MUI/AntD/Bootstrap/generic upload patterns |
| `src/classifier/interaction-detector.ts` | V1 metadata extraction + DragDropUpload detection |
| `src/sidepanel/timeline-renderer.ts` | FileUpload + DragDropUpload phrasing |
| `tests/evidence-engine/file-upload.test.ts` | NEW — comprehensive tests |

## Acceptance Criteria

### FileUpload Detection
- [ ] Native `<input type="file">` change → FileUpload with files, fileCount, uploadMethod='browse'
- [ ] `domContext.inputType='file'` → FileUpload (no cssSelector needed)
- [ ] File names extracted correctly (not `C:\fakepath\...`)
- [ ] File count correct for multiple files
- [ ] Accepted file types extracted from `accept` attribute
- [ ] `multiple` attribute captured
- [ ] MUI DropzoneArea CSS → FileUpload
- [ ] AntD upload CSS → FileUpload
- [ ] Bootstrap form-control-file CSS → FileUpload
- [ ] Generic upload-area CSS → FileUpload

### DragDropUpload Detection
- [ ] Drop event with file data → DragDropUpload (NOT DragDrop)
- [ ] File names from dataTransfer.files extracted
- [ ] File count correct
- [ ] uploadMethod='drag-drop'
- [ ] MUI Dropzone CSS + drop → DragDropUpload
- [ ] AntD upload-dragger CSS + drop → DragDropUpload
- [ ] Generic dropzone CSS + drop → DragDropUpload

### Timeline Phrasing
- [ ] Single file: `Upload "invoice.pdf" to "Documents"`
- [ ] Multiple files: `Upload 3 files to "Attachments"`
- [ ] No file names: `Upload file "Resume"`
- [ ] Drag single file: `Drag "photo.jpg" to "Upload Area"`
- [ ] Drag multiple files: `Drag 3 files to "Upload Area"`

### Regression
- [ ] DragDrop (element drag) still detected correctly (dragstart + drop without files)
- [ ] DragDropUpload (file drop) does NOT interfere with DragDrop (element drop)
- [ ] TextEntry detection unaffected (file inputs are NOT text entry)
- [ ] Click detection unaffected
- [ ] DatePicker/TimePicker/DateTimePicker unaffected
- [ ] All 2488 existing tests pass

# File Transfer Recording — Upload & Download

## Objective
Add File Upload and File Download interaction types through the Interaction Registry.

## Type Definitions

### File Upload
```typescript
interface FileUploadEvent {
  actionId: string; type: 'file_upload';
  timestamp: string; elementIdentity: ElementIdentity;
  files: { name: string; type: string }[];
  uploadVariant: 'native' | 'mui-dropzone' | 'antd' | 'react-dropzone' | 'generic';
  aiUnderstanding?: AIUnderstanding; aiError?: string;
}
```

### File Download
```typescript
interface FileDownloadEvent {
  actionId: string; type: 'file_download';
  timestamp: string; elementIdentity: ElementIdentity;
  fileName: string;
  downloadUrl?: string;
  downloadStatus: 'started' | 'complete' | 'interrupted';
  aiUnderstanding?: AIUnderstanding; aiError?: string;
}
```

## Execution JSON
```json
// Upload
{ "action": "file_upload", "files": [{ "name": "resume.pdf", "type": "application/pdf" }] }
// Download
{ "action": "file_download", "fileName": "Monthly Report.pdf" }
```

## Plain English
- Upload: `Upload "resume.pdf" to the "Resume" field`
- Multi-file: `Upload 3 files to the "Attachments" field`
- Download: `Download "Monthly Report.pdf"`

## Download Detection Strategy
Two-phase approach — ONLY records actual downloads, not click attempts:
1. Content script detects click on download element → captures identity → sends `FILE_DOWNLOAD_PENDING`
2. Service worker listens to `chrome.downloads.onCreated` → matches pending → creates event with filename
3. If no `onCreated` fires within 30s → discard pending (no download happened)

## Upload Detection Strategy
All frameworks use hidden `<input type="file">`:
1. Listen for `change` on `<input type="file">` — universal capture point
2. Read `event.target.files` for names and types
3. Framework detection: `.ant-upload`, `.MuiDropzoneArea-root`, `.react-dropzone`, generic
4. Also listen for `drop` events on drag-drop zones → read `dataTransfer.files`

## Acceptance Criteria
- [ ] Upload captures file names and types
- [ ] Download only records actual browser downloads (not click-only)
- [ ] Plain English correct for both
- [ ] Execution JSON correct
- [ ] AI prompts include file info
- [ ] Action IDs: `upload-NNNN`, `download-NNNN`
- [ ] Element ID, iframeContext, Screenshot, Repository reused
- [ ] All 354 existing tests pass
- [ ] New tests for both types

## Out of Scope
Hover, Scroll, Right Click, Double Click, Drag & Drop (non-file), Keyboard Shortcuts

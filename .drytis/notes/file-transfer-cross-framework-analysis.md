# File Transfer — Cross-Framework Pattern Analysis

## Upload Detection

### Key Insight
**ALL frameworks ultimately use a hidden `<input type="file">` element.** The `change` event on this input is the universal capture point. Framework-specific detection is needed only to identify the container for element identity purposes.

### Framework Patterns
1. **Native HTML**: `<input type="file">` — `change` event, `event.target.files` gives FileList (name, type, size)
2. **Material UI Dropzone** (`material-ui-dropzone`/`mui-file-dropzone`): Based on react-dropzone. `<div>` container with hidden `<input type="file">`. Classes: `.MuiDropzoneArea-root`, `.MuiDropzone-root`
3. **Ant Design Upload**: `.ant-upload` container → `.ant-upload-btn`, `.ant-upload-drag`, `.ant-upload-select`. Renders `<input type="file">` inside.
4. **React Dropzone**: `getRootProps()` on `<div>`, `getInputProps()` on `<input type="file">`. Input typically hidden. Change event fires on input.
5. **Drag & Drop Zones**: `drop` event on container, read `event.dataTransfer.files`
6. **Enterprise Components**: Usually wrap one of the above. Common: SAP, Salesforce, custom React/Angular wrappers.

### State Reading
- File names: `file.name` (from File API — browser restricts full path)
- File types: `file.type` (MIME type)
- File sizes: `file.size`
- Multiple: check `input.multiple` attribute or count of files

---

## Download Detection

### Key Insight
**The `chrome.downloads.onCreated` API in the service worker is the universal capture point.** ALL download methods (direct links, blob downloads, generated downloads, etc.) go through Chrome's download subsystem. The `DownloadItem` object provides `filename`, `url`, `mime`, `state`, `totalBytes`.

### Critical Design Decision
Per spec: "Record only successful downloads. Do not assume a download occurred simply because a Download button was clicked."

**Two-phase approach:**
1. Content script detects click on download element → captures element identity → sends `FILE_DOWNLOAD_PENDING` to service worker
2. Service worker `chrome.downloads.onCreated` listener → matches to pending download → creates actual event with filename from `DownloadItem`
3. If no `onCreated` fires within timeout → discard pending (no actual download happened)

### Download Methods Covered by chrome.downloads API
1. Direct file links: `<a href="file.pdf" download>`
2. Blob/Object URL: `URL.createObjectURL(blob)` → `<a>` click
3. Generated downloads: JS creates blob → triggers download
4. Server-generated: Content-Disposition header triggers download
5. ZIP/PDF/Excel: Same as above — all go through download API

### DownloadItem Fields
- `filename`: Full path relative to Downloads directory (includes subdirs)
- `url`: Source URL
- `mime`: MIME type
- `state`: 'in_progress' | 'complete' | 'interrupted'
- `totalBytes`: Expected size
- `fileSize`: Actual downloaded size

### Element Detection (for identity)
- `<a download>`: links with `download` attribute
- `<a>` linking to file extensions: `.pdf`, `.xlsx`, `.zip`, `.doc`, `.csv`, etc.
- Buttons with download-related text: "Download", "Export", "Save"
- Elements with download-related classes: `.download`, `.ant-btn-download`, `.MuiButton-download`

### Browser Limitations
- `chrome.downloads.onDeterminingFilename` can conflict with other extensions — avoid using it
- Blob downloads from service worker: `URL.createObjectURL` not supported in MV3 service workers
- Cross-origin downloads: filename may be restricted by Content-Disposition header
- Some downloads open in-browser (PDFs) instead of downloading — check `mime` type

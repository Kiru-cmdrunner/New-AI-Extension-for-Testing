# Download ZIP Recovery Pattern

## Problem
After container resume (idle pause), generated files in /workspace are sometimes
lost. The extension ZIP (`cmdrunner-extension-v0.1.0.zip`) is served via a
symlink from `/workspace/download/cmdrunner-extension-v0.1.0.zip` →
`/workspace/cmdrunner-extension-v0.1.0.zip`. The target file gets lost on resume.

## Recovery Steps
1. `npm run build` to regenerate dist/
2. Create ZIP from dist/ contents:
   ```python
   import zipfile, os
   zip_path = '/workspace/cmdrunner-extension-v0.1.0.zip'
   items = []
   for root, dirs, files in os.walk('dist'):
       if 'extension-zip' in root: continue
       for f in files:
           full = os.path.join(root, f)
           rel = os.path.relpath(full, 'dist')
           items.append((full, rel))
   with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
       for full, rel in items:
           zf.write(full, rel)
   ```
3. The symlink in /workspace/download/ will resolve correctly.

## URL
- Preview: https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdreader-extension-v0.1.0.zip
- Port 8889 serves /download/* via Caddy reverse proxy

## Servers
- service-bg-service-3487: port 8888 (serves /downloads/*)
- service-bg-service-3498: port 8889 (serves /download/*)

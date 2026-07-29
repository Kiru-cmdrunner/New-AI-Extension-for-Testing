# Download 404 Root Cause — Filename Typo

## Root Cause
The download link was intermittently returning 404 due to a **filename typo**
between two spellings:

- **Correct**: `cmdrunner-extension-v0.1.0.zip` (CmdRunner — matches project name)
- **Wrong**: `cmdreader-extension-v0.1.0.zip` (CmdReader — typo from first dev view)

The user was given a link with "cmdreader" but the file was named "cmdrunner".
The symlink in /workspace/download/ was also "cmdrunner".

## Logs Evidence
```
200  GET /download/cmdrunner-extension-v0.1.0.zip  ← works
404  GET /download/cmdreader-extension-v0.1.0.zip  ← typo
```

## Fix
Created ALL filename variants (cmdrunner/cmdreader × versioned/unversioned)
in both /workspace/download/ and /workspace/downloads/ with symlinks.
Updated the setup script to do this automatically on every deploy.

## Permanent Download Links (all return 200)
- https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdrunner-extension-v0.1.0.zip
- https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdrunner-extension.zip
- https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdreader-extension-v0.1.0.zip
- https://new-cmdrunner-ai-ext-upxqyy.drytis.dev/download/cmdreader-extension.zip

## Also available via /downloads/ (port 8888)
All variants also symlinked into /workspace/downloads/

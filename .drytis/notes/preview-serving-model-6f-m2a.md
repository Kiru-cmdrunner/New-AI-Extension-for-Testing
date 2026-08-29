# Preview serving after 6F-M2a (2026-08-23)

The preview file-server (bg service 3591) is now rooted at `/workspace/serve`,
a mirror the service script creates at start: `cp -r dist/. serve/dist/` +
`cp -r public/. serve/public/`. The workspace root is no longer served
(.git/src/.drytis all 404 over preview).

**Operational rule (infra_verifier advisory WARN):** `serve/` is a static
copy — after ANY `npm run build`, restart the file-server or the preview
serves stale dist artifacts:

    procmgr restart service-bg-service-3591

Container boots are safe (setup script builds before services start), only
mid-session manual rebuilds need the restart. `/download` (8080 proxy,
`/workspace/download`) is unaffected — canonical ZIP served from disk
directly.

Stale-build check one-liner: `diff -rq dist serve/dist` — empty = fresh.

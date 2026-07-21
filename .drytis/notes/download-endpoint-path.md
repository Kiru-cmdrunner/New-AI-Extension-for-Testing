# Download Endpoint Serves from /workspace/download/

The Caddy proxy at `/download/*` routes to Python SimpleHTTP on port 8080, 
which serves from `/workspace`. So `/download/cmdrunner-extension.zip` 
resolves to **`/workspace/download/cmdrunner-extension.zip`** — NOT 
`/workspace/public/cmdrunner-extension.zip`.

When rebuilding the extension, ALWAYS copy to `/workspace/download/`:

```bash
cp cmdrunner-extension.zip /workspace/download/cmdrunner-extension.zip
```

The root path `/` is served by `npm exec serve dist -l 5173` which serves 
the `dist/` directory directly.

Discovered: 2026-07-19 — user was repeatedly getting v10.4.11 because copies 
were going to `/workspace/public/` instead of `/workspace/download/`.

/**
 * pack-zip.mjs — packs the built extension into cmdrunner-extension.zip
 * and copies it to BOTH locations:
 *   - /workspace/cmdrunner-extension.zip        (repo root)
 *   - /workspace/download/cmdrunner-extension.zip (download endpoint)
 *
 * ZIP STRUCTURE (flat — matches what Chrome expects):
 *   manifest.json               ← from dist/ (flattened to root)
 *   service-worker-loader.js    ← from dist/
 *   assets/...                   ← from dist/assets/ (compiled JS/CSS)
 *   src/sidepanel/index.html     ← from dist/src/sidepanel/ (BUILT html with compiled refs)
 *   src/repository/index.html    ← from dist/src/repository/
 *   src/settings/index.html      ← from dist/src/settings/
 *   src/assets/icon-*.png        ← from dist/src/assets/ (icons)
 *
 * Excludes: raw .ts source files, test/demo HTML, dev-only files.
 *
 * Runs automatically as part of `npm run build`.
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dirname as pathDirname } from 'path';

const __dirname = pathDirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const OUTPUT_FILES = [
  join(root, 'cmdrunner-extension.zip'),
  join(root, 'download', 'cmdrunner-extension.zip'),
];

const pyScript = `
import zipfile, os, json

root = ${JSON.stringify(root)}
dist_dir = os.path.join(root, 'dist')
outputs = ${JSON.stringify(OUTPUT_FILES)}

# Files to EXCLUDE from the zip (test/demo HTML, raw .ts source)
EXCLUDE_EXTS = {'.ts'}

collected = []

# Walk ALL of dist/ (which already has the correct structure):
#   dist/manifest.json, dist/service-worker-loader.js, dist/assets/*,
#   dist/src/sidepanel/index.html (built), dist/src/repository/*, dist/src/settings/*,
#   dist/src/assets/icon-*.png
for dirpath, dirnames, filenames in os.walk(dist_dir):
    for fn in sorted(filenames):
        ext = os.path.splitext(fn)[1]
        if ext in EXCLUDE_EXTS:
            continue
        # Exclude ALL root-level HTML files — these are test/validation pages
        # copied from public/ by Vite. Only HTML under dist/src/ (side panel,
        # settings, repository) is part of the actual extension.
        if ext == '.html' and dirpath == dist_dir:
            continue
        full = os.path.join(dirpath, fn)
        arcname = os.path.relpath(full, dist_dir)  # flat: manifest.json, assets/..., src/...
        collected.append((full, arcname))

for out in outputs:
    outdir = os.path.dirname(out)
    os.makedirs(outdir, exist_ok=True)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for full, arcname in collected:
            zf.write(full, arcname)

mpath = os.path.join(dist_dir, 'manifest.json')
with open(mpath) as f:
    manifest = json.load(f)

size_kb = os.path.getsize(outputs[0]) / 1024
print(f"Packed extension v{manifest['version']} ({len(collected)} files, {size_kb:.1f} KB)")
for o in outputs:
    print(f"  -> {os.path.relpath(o, root)}")
`;

function main() {
  for (const out of OUTPUT_FILES) {
    const dir = dirname(out);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  try {
    execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, {
      cwd: root,
      stdio: 'inherit',
    });
  } catch (err) {
    console.error('pack-zip file:', err.message);
    process.exit(1);
  }
}

main();

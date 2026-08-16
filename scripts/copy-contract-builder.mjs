// Publish the standalone snow-contract builder as a static page.
//
// Copies reference/Marcos_Snow_Contract_Builder.html (and the logo it
// references relatively) into dist/snow-contract-builder/ at build time, so
// Firebase Hosting serves it at /snow-contract-builder.
//
// WHY COPY AT BUILD TIME rather than commit a second copy under public/:
// src/lib/snowContractText.test.ts — the transcription guard — verifies the
// clause constants in the app against reference/Marcos_Snow_Contract_Builder.html
// character-for-character. If the hosted builder were a separate file, the
// guard would keep verifying the reference while clients received the copy,
// and the two could drift without a single test going red. Copying from the
// reference on every build means the page that ships IS the file that is
// verified. There is one source of truth and it is the one under test.
//
// Runs as part of `npm run build`, after vite (which empties dist).

import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'reference');
const OUT_DIR = join(ROOT, 'dist', 'snow-contract-builder');

// The builder plus every asset it references relatively. Keep this list in
// step with the <img>/<link> tags in the HTML — a missing asset here is a
// broken image on a client-facing page, not a build error.
const FILES = [
  { from: 'Marcos_Snow_Contract_Builder.html', to: 'index.html' },
  { from: 'marcos-snow-logo-tight.png', to: 'marcos-snow-logo-tight.png' },
];

if (!existsSync(join(ROOT, 'dist'))) {
  console.error('[contract-builder] dist/ does not exist — run vite build first.');
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });

let total = 0;
for (const f of FILES) {
  const src = join(SRC_DIR, f.from);
  if (!existsSync(src)) {
    console.error(`[contract-builder] MISSING ${src} — the hosted builder would be broken. Failing the build.`);
    process.exit(1);
  }
  const dest = join(OUT_DIR, f.to);
  copyFileSync(src, dest);
  const bytes = statSync(dest).size;
  total += bytes;
  console.log(`[contract-builder] ${f.from} -> dist/snow-contract-builder/${f.to} (${(bytes / 1024).toFixed(1)} KB)`);
}
console.log(`[contract-builder] published /snow-contract-builder (${(total / 1024).toFixed(1)} KB total)`);

// Run after changing the inline import map: node scripts/security.mjs
// Validate without writing: node scripts/security.mjs --check
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const htmlPath = new URL('index.html', root);
let html = readFileSync(htmlPath, 'utf8');
const importMap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
if (!importMap) throw new Error('Inline import map not found');
const hash = createHash('sha256').update(importMap).digest('base64');
const policy = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "form-action 'none'",
  `script-src 'self' 'sha256-${hash}' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/three@0.164.1/ https://cdn.jsdelivr.net/npm/gsap@3.12.5/ https://www.gstatic.com/draco/versioned/decoders/1.5.7/`,
  // GSAP updates element styles; inline JavaScript remains disallowed.
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' blob: data:",
  "connect-src 'self' https://cdn.jsdelivr.net/npm/three@0.164.1/ https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  // Draco uses a Blob worker and WebAssembly for compressed model decoding.
  "worker-src 'self' blob:",
].join('; ');

const meta = `  <meta http-equiv="Content-Security-Policy" content="${policy}" />`;
if (html.includes('<meta http-equiv="Content-Security-Policy"')) {
  html = html.replace(/^  <meta http-equiv="Content-Security-Policy"[^\r\n]*\r?\n/m, meta + '\n');
} else {
  html = html.replace(/(  <meta charset="UTF-8" \/>\r?\n)/, '$1' + meta + '\n');
}
const headers = [
  { key: 'Content-Security-Policy', value: policy + "; frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
];
const files = [
  ['index.html', html],
  ['_headers', '/*\n' + headers.map(({key, value}) => `  ${key}: ${value}`).join('\n') + '\n'],
  ['vercel.json', JSON.stringify({
    $schema: 'https://openapi.vercel.sh/vercel.json',
    headers: [{ source: '/(.*)', headers }],
  }, null, 2) + '\n'],
];
for (const [filename, contents] of files) {
  const file = new URL(filename, root);
  if (process.argv.includes('--check')) {
    if (readFileSync(file, 'utf8') !== contents) throw new Error(`Stale security configuration: ${filename}`);
  } else {
    writeFileSync(file, contents);
  }
}
console.log(process.argv.includes('--check') ? 'Security configurations and import-map hash match.' : 'Security configurations updated.');

// Cloud Storage for the on-device model (D-032), as the signed-in Firebase
// CLI user. The access token stays in memory and is never printed.
//
//   node scripts/model-storage.mjs status                 default bucket and the model files
//   node scripts/model-storage.mjs create-bucket          default bucket in asia-south1 (once; needs the owner's go-ahead)
//   node scripts/model-storage.mjs upload <file.litertlm> upload the model, then models/gemma3-1b-it-int4.json
//
// The manifest ({file, size, sha256}) is what the app reads before it
// downloads, so a new upload needs no app release. Upload the official
// file only (litert-community/Gemma3-1B-IT, gemma3-1b-it-int4.litertlm).
import { createHash } from 'node:crypto';
import { createReadStream, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const P = 'expense-tracker-v2-5c9fa';
const LOCATION = 'asia-south1';
const MODEL = 'models/gemma3-1b-it-int4.litertlm';
const MANIFEST = 'models/gemma3-1b-it-int4.json';

const require = createRequire(import.meta.url);
const FT = execSync('npm root -g').toString().trim() + '/firebase-tools/lib';
const { configstore } = require(`${FT}/configstore.js`);
const cliAuth = require(`${FT}/auth.js`);
let accessToken;
async function token() {
  if (!accessToken) {
    const refresh = configstore.get('tokens')?.refresh_token;
    if (!refresh) throw new Error('Not signed in: run `firebase login` first.');
    accessToken = (await cliAuth.getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  }
  return accessToken;
}
async function call(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'X-Goog-User-Project': P, ...(body && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body instanceof Uint8Array ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json, headers: res.headers };
}

async function defaultBucket() {
  const r = await call('GET', `https://firebasestorage.googleapis.com/v1alpha/projects/${P}/defaultBucket`);
  return r.status === 200 ? r.body : null;
}

async function status() {
  const b = await defaultBucket();
  if (!b) return console.log('No default bucket yet.');
  const name = b.bucket?.name?.split('/').pop() ?? b.name;
  console.log('default bucket:', name, b.location ?? '', b.storageClass ?? '');
  for (const o of [MANIFEST, MODEL]) {
    const r = await call('GET', `https://storage.googleapis.com/storage/v1/b/${name}/o/${encodeURIComponent(o)}`);
    console.log(o, r.status === 200 ? `${r.body.size} bytes, ${r.body.updated}` : `missing (${r.status})`);
  }
}

async function createBucket() {
  const existing = await defaultBucket();
  if (existing) return console.log('Already exists:', JSON.stringify(existing));
  const r = await call('POST', `https://firebasestorage.googleapis.com/v1alpha/projects/${P}/defaultBucket`, { location: LOCATION, storageClass: 'STANDARD' });
  console.log('create:', r.status, JSON.stringify(r.body).slice(0, 400));
}

function sha256(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function upload(path) {
  const b = await defaultBucket();
  if (!b) throw new Error('No default bucket: run create-bucket first.');
  const bucket = b.bucket?.name?.split('/').pop();
  const size = statSync(path).size;
  const sha = await sha256(path);
  console.log(`file: ${size} bytes, sha256 ${sha}`);

  // Resumable upload in 32 MiB chunks.
  const start = await call('POST', `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=resumable&name=${encodeURIComponent(MODEL)}`,
    { name: MODEL, contentType: 'application/octet-stream', metadata: { sha256: sha } },
    { 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(size) });
  const session = start.headers.get('location');
  if (start.status !== 200 || !session) throw new Error(`upload start failed: ${start.status} ${JSON.stringify(start.body).slice(0, 300)}`);
  const CHUNK = 32 * 1024 * 1024;
  const fd = openSync(path, 'r');
  try {
    for (let offset = 0; offset < size; offset += CHUNK) {
      const len = Math.min(CHUNK, size - offset);
      const buf = new Uint8Array(len);
      readSync(fd, buf, 0, len, offset);
      const r = await fetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes ${offset}-${offset + len - 1}/${size}` }, body: buf });
      if (!(r.status === 308 || r.status === 200 || r.status === 201)) throw new Error(`chunk at ${offset}: ${r.status} ${(await r.text()).slice(0, 300)}`);
      process.stdout.write(`\r${Math.round(((offset + len) / size) * 100)}%`);
    }
  } finally {
    closeSync(fd);
  }
  console.log('');
  const meta = await call('GET', `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(MODEL)}`);
  if (Number(meta.body.size) !== size) throw new Error(`uploaded size ${meta.body.size} != ${size}`);

  const manifest = new TextEncoder().encode(JSON.stringify({ file: MODEL, size, sha256: sha, license: 'Gemma Terms of Use, https://ai.google.dev/gemma/terms' }));
  const m = await call('POST', `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(MANIFEST)}`,
    manifest, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  if (m.status !== 200) throw new Error(`manifest upload failed: ${m.status}`);
  console.log(`uploaded gs://${bucket}/${MODEL} and ${MANIFEST}`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'status') await status();
else if (cmd === 'create-bucket') await createBucket();
else if (cmd === 'upload' && arg) await upload(arg);
else console.log('usage: node scripts/model-storage.mjs status | create-bucket | upload <file.litertlm>');

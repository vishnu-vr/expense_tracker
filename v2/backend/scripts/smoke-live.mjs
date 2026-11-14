// Live smoke test of the DEPLOYED v2 backend, using a throwaway account.
//
//   node scripts/smoke-live.mjs [projectId]        (default: expense-tracker-v2-5c9fa)
//
// Checks: sign-up, security rules (allow + deny), the transaction trigger
// (notification + embedding), that clients cannot read embeddings, and one
// real askAgent answer (a small, billed model call).
// Creates one auth user, users/{uid}, homes/{id}, 3 transactions and their
// side effects, then deletes all of it. Needs `firebase login` with access to
// the project. Reads the public API key from app/lib/firebase_options.dart.
import { readFileSync } from 'node:fs';
const P = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'expense-tracker-v2-5c9fa';
const KEY = readFileSync(new URL('../../app/lib/firebase_options.dart', import.meta.url), 'utf8')
  .match(/apiKey: '([^']+)'/)[1];
const FS = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
const FN = `https://asia-south1-${P}.cloudfunctions.net`;

// --- Google API calls as the signed-in Firebase CLI user (`firebase login`). ---
// No gcloud or service-account key needed; the token is never printed.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const FT = execSync('npm root -g').toString().trim() + '/firebase-tools/lib';
const { configstore } = require(`${FT}/configstore.js`);
const cliAuth = require(`${FT}/auth.js`);
let accessToken;
async function adminToken() {
  if (!accessToken) {
    const refresh = configstore.get('tokens')?.refresh_token;
    if (!refresh) throw new Error('Not signed in: run `firebase login` first.');
    accessToken = (await cliAuth.getAccessToken(refresh, ['https://www.googleapis.com/auth/cloud-platform'])).access_token;
  }
  return accessToken;
}
async function admin(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await adminToken()}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': P },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text.trim() ? JSON.parse(text) : {} };
}
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const email = `smoke-${Date.now()}@example.invalid`;
let uid, token, homeId;
const created = [];
const f = (v) => typeof v === 'number' ? { doubleValue: v } : Array.isArray(v) ? { arrayValue: { values: v.map(f) } }
  : v instanceof Date ? { timestampValue: v.toISOString() } : { stringValue: v };
const doc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)])) });
const as = (method, path, body, qs = '') => fetch(`${FS}/${path}${qs}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined }).then(j);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function query(collectionId, field, value) {
  return ((await admin('POST', `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId }],
    where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } } } } })).body ?? [])
    .filter((r) => r.document).map((r) => r.document);
}
let failures = 0;
const check = (name, ok, extra = '') => (ok || failures++, console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`));

if (process.argv.includes('--cleanup')) { await cleanup(); process.exit(0); }

try {
  const su = await j(await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: `T-${Math.random().toString(36).slice(2)}9!`, returnSecureToken: true }) }));
  uid = su.body.localId; token = su.body.idToken;
  check('sign up', su.status === 200 && !!uid);

  homeId = `smoke${Date.now()}`;
  const now = new Date();
  // Batch: create home + point user at it (exercises the rules' getAfter path).
  const commit = await fetch(`${FS}:commit`.replace('/documents:commit', '/documents:commit'), {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [
      { update: { name: `projects/${P}/databases/(default)/documents/homes/${homeId}`,
        ...doc({ name: 'Smoke test', displayId: 'SMK' + String(Date.now()).slice(-3), ownerId: uid, memberIds: [uid], createdAt: now }) } },
      { update: { name: `projects/${P}/databases/(default)/documents/users/${uid}`,
        ...doc({ email, name: 'Smoke', homeId, createdAt: now }) } },
    ] }) }).then(j);
  check('create household (rules allow)', commit.status === 200, commit.status !== 200 ? JSON.stringify(commit.body).slice(0, 200) : '');

  const other = await as('PATCH', `homes/someoneelse${Date.now()}`, doc({ name: 'x', ownerId: 'nobody', memberIds: ['nobody'], displayId: 'XXXXXX' }));
  check('rules reject a home owned by someone else', other.status === 403);

  for (const [amount, note, cat, daysAgo] of [[480, 'Swiggy dinner', 'food', 1], [310, 'Uber to office', 'transportation', 2], [649, 'Netflix', 'bills', 3]]) {
    const r = await as('POST', 'transactions', doc({ amount, note, categoryId: cat, type: 'expense', userId: uid, userEmail: email,
      homeId, tagIds: [], date: new Date(Date.now() - daysAgo * 864e5), createdAt: now, updatedAt: now }));
    if (r.body.name) created.push(r.body.name.split('/documents/')[1]);
    check(`add entry "${note}"`, r.status === 200);
  }
  const bad = await as('POST', 'transactions', doc({ amount: 1, categoryId: 'food', type: 'expense', userId: 'someone-else', homeId, tagIds: [], date: now }));
  check('rules reject an entry claiming another user', bad.status === 403);

  await sleep(15000);
  const txId = created[0].split('/')[1];
  const notes = await admin('POST', `${FS}:runQuery`, { structuredQuery: { from: [{ collectionId: 'notifications' }],
    where: { fieldFilter: { field: { fieldPath: 'homeId' }, op: 'EQUAL', value: { stringValue: homeId } } } } });
  const nCount = notes.body.filter?.((x) => x.document).length ?? 0;
  check('server trigger wrote household notifications', nCount >= 3, `${nCount} found`);
  const emb = await admin('GET', `${FS}/transactionEmbeddings/${txId}`);
  const dims = emb.body.fields?.vector?.mapValue?.fields?.value?.arrayValue?.values?.length;
  check('server trigger wrote the embedding', emb.status === 200, `status ${emb.status}${dims ? `, ${dims} dims` : ''}`);
  const clientEmb = await as('GET', `transactionEmbeddings/${txId}`);
  check('clients cannot read embeddings', clientEmb.status === 403);

  const t0 = Date.now();
  const ask = await fetch(`${FN}/askAgent`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { message: 'How much did I spend in the last 7 days, and on what?', timeZone: 'Asia/Kolkata' } }) }).then(j);
  const blocks = ask.body.result?.blocks ?? [];
  check('assistant answered', ask.status === 200 && blocks.length > 0,
    `${((Date.now() - t0) / 1000).toFixed(1)}s, ${ask.status}${ask.body.error ? ' ' + JSON.stringify(ask.body.error).slice(0, 200) : ''}`);
  for (const b of blocks) console.log('      ', b.type, JSON.stringify(b).slice(0, 220));
  if (ask.body.result?.threadId) {
    created.push(`homes/${homeId}/aiThreads/${ask.body.result.threadId}`);
    const thread = await admin('GET', `${FS}/homes/${homeId}/aiThreads/${ask.body.result.threadId}`);
    const u = thread.body.fields?.usage?.mapValue?.fields ?? {};
    const q = Number(u.questions?.integerValue ?? 0);
    const tokens = Number(u.inputTokens?.integerValue ?? 0) + Number(u.outputTokens?.integerValue ?? 0);
    check('thread records usage', q === 1 && tokens > 0, `${q} question, ${tokens} tokens`);
    const roll = await query('aiUsage', 'homeId', homeId);
    check('monthly usage rollup written', roll.length === 1 && Number(roll[0].fields?.questions?.integerValue) === 1);
  }
} finally {
  await cleanup();
  if (failures) process.exitCode = 1;
}

/**
 * Deletes every trace of smoke runs: homes named "Smoke test", their threads,
 * transactions, embeddings and notifications, and auth users whose email ends
 * in @example.invalid. Safe to run on its own: `node scripts/smoke-live.mjs --cleanup`.
 */
async function cleanup() {
  const del = async (p) => admin('DELETE', `${FS}/${p}`);
  const path = (doc) => doc.name.split('/documents/')[1];

  for (let pass = 0; pass < 2; pass++) {
    for (const home of await query('homes', 'name', 'Smoke test')) {
      const homeId = path(home).split('/')[1];
      for (const t of (await admin('GET', `${FS}/homes/${homeId}/aiThreads`)).body.documents ?? []) {
        for (const sub of ['messages', 'proposals']) {
          for (const m of (await admin('GET', `${FS}/${path(t)}/${sub}`)).body.documents ?? []) await del(path(m));
        }
        await del(path(t));
      }
      for (const tx of await query('transactions', 'homeId', homeId)) {
        await del(path(tx));
        await del(`transactionEmbeddings/${path(tx).split('/')[1]}`);
      }
      for (const e of await query('transactionEmbeddings', 'homeId', homeId)) await del(path(e));
      for (const n of await query('notifications', 'homeId', homeId)) await del(path(n));
      for (const r of await query('aiUsage', 'homeId', homeId)) await del(path(r));
      if (pass === 1) await del(`homes/${homeId}`);
    }
    // Deleting transactions fires the trigger, which writes "deleted"
    // notifications; the second pass removes those.
    if (pass === 0) await new Promise((r) => setTimeout(r, 10000));
  }
  const users = (await admin('POST', `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:query`,
    { returnUserInfo: true })).body.userInfo ?? [];
  for (const u of users.filter((u) => u.email?.endsWith('@example.invalid'))) {
    await del(`users/${u.localId}`);
    await admin('POST', `https://identitytoolkit.googleapis.com/v1/projects/${P}/accounts:delete`, { localId: u.localId });
  }
  console.log('cleanup done');
}

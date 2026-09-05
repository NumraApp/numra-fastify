import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { Numra } from '@numra/core';
import { numraPlugin } from '../src/index.js';
import { startMockServer, LOOKUP_OK } from './mock-server.js';

const SECRET = 'whsec_test';

async function build(opts = {}, upstreamHandler = () => ({ body: LOOKUP_OK })) {
  const upstream = await startMockServer(upstreamHandler);
  const app = Fastify();

  await app.register(numraPlugin, {
    prefix: '/api/numra',
    client: new Numra({ apiKey: 'k', baseUrl: upstream.url }),
    ...opts,
  });

  /* A route on the PARENT instance, mounted after the plugin. If the raw
     parser leaked out of the plugin's child scope, this one would receive a
     Buffer instead of an object — which is the whole reason the plugin is not
     wrapped in fastify-plugin. */
  app.post('/unrelated', async (req) => ({ typeofBody: typeof req.body, name: req.body?.name }));

  await app.ready();
  return { app, upstream, close: async () => { await app.close(); await upstream.close(); } };
}

const evt = JSON.stringify({ id: 'evt_1', event: 'verification.flagged', data: { phone: '+212600000000' } });
const now = () => Math.floor(Date.now() / 1000);
const sign = (b, ts) => ({
  'Numra-Signature': 'sha256=' + createHmac('sha256', SECRET).update(`${ts}.${b}`).digest('hex'),
  'Numra-Timestamp': String(ts),
  'Content-Type': 'application/json',
});

const post = (app, url, payload, headers) =>
  app.inject({ method: 'POST', url, payload, headers });

/* ── authorize ──────────────────────────────────────────────────────────── */

test('with no authorize, every request is refused as a misconfiguration', async () => {
  /* The stub goes up BEFORE build(): createHandlers binds its logger at
     construction, so a stub installed afterwards captures nothing. */
  const said = [];
  const real = console.error;
  console.error = (...a) => said.push(a.join(' '));

  let t, res;
  try {
    t = await build({ webhookSecret: SECRET });
    res = await post(t.app, '/api/numra/check', { phone: '+212600000000' });
  } finally {
    console.error = real;
  }

  /* 500, not 403: nobody asked for this to be locked, it just is. A 403 would
     read as "this user lacks permission" and send the integrator hunting
     through their session code. */
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, 'NUMRA_NOT_CONFIGURED');
  assert.equal(t.upstream.calls.length, 0, 'no quota spent');

  /* And the fix it prints has to be callable HERE. A Fastify user told to
     call `numraRouter` concludes the message is stale and reaches for
     `authorize: () => true`. */
  assert.match(said.join('\n'), /app\.register\(numraPlugin/);
  await t.close();
});

test('a rejecting authorize is a plain 403 and spends nothing', async () => {
  const t = await build({ authorize: () => false });
  const res = await post(t.app, '/api/numra/check', { phone: '+212600000000' });

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, 'FORBIDDEN');
  assert.equal(t.upstream.calls.length, 0);
  await t.close();
});

test('an authorize that throws fails closed', async () => {
  /* A session lookup hitting a dead database must not become an open door. */
  const t = await build({ authorize: () => { throw new Error('db down'); } });
  const res = await post(t.app, '/api/numra/check', { phone: '+212600000000' });

  assert.equal(res.statusCode, 403);
  assert.equal(t.upstream.calls.length, 0);
  await t.close();
});

/* ── /check ─────────────────────────────────────────────────────────────── */

test('/check returns the narrowed payload, not the engine internals', async () => {
  const t = await build({ authorize: () => true });
  const res = await post(t.app, '/api/numra/check', { phone: '+212600000000' });
  const body = res.json();

  assert.equal(res.statusCode, 200);
  assert.equal(body.riskLevel, 'HIGH');
  assert.equal(body.customerStyle.code, 'reactive');
  assert.equal(body.raw, undefined, 'raw must never cross to the browser');
  assert.equal(body.risk_score_raw, undefined, 'engine diagnostics stay server-side');
  await t.close();
});

test('/check still receives a parsed JSON body', async () => {
  /* The regression guard's other half: if the raw parser were registered on
     the plugin instead of the child, req.body here would be a Buffer and the
     phone would come back missing. */
  const t = await build({ authorize: () => true, webhookSecret: SECRET });
  const res = await post(t.app, '/api/numra/check', { phone: '+212600000000' });

  assert.equal(res.statusCode, 200);
  assert.equal(t.upstream.calls[0].path, '/v1/phone/lookup');
  await t.close();
});

/* ── webhooks ───────────────────────────────────────────────────────────── */

test('a signed webhook sent as application/json verifies', async () => {
  /* THE regression test. `addContentTypeParser('*')` on its own does not
     catch application/json — Fastify has a built-in parser for it, so the
     catch-all never runs, the body arrives parsed, and verification fails
     looking exactly like a forgery. The raw route lives in its own child with
     the inherited parsers removed; this proves it. */
  const seen = [];
  const t = await build({ authorize: () => true, webhookSecret: SECRET, onEvent: (e) => seen.push(e) });
  const res = await post(t.app, '/api/numra/webhook', evt, sign(evt, now()));

  assert.equal(res.statusCode, 200, res.body);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event, 'verification.flagged');
  await t.close();
});

test('a forged signature is 400 and the handler never runs', async () => {
  const seen = [];
  const t = await build({ authorize: () => true, webhookSecret: SECRET, onEvent: (e) => seen.push(e) });
  const res = await post(t.app, '/api/numra/webhook', evt, {
    ...sign(evt, now()), 'Numra-Signature': 'sha256=deadbeef',
  });

  /* 400 not 401: an unauthentic sender has no credential to fix, and 401
     invites a retry storm. */
  assert.equal(res.statusCode, 400);
  assert.equal(seen.length, 0);
  await t.close();
});

test('a stale timestamp is rejected as a replay', async () => {
  const t = await build({ authorize: () => true, webhookSecret: SECRET });
  const res = await post(t.app, '/api/numra/webhook', evt, sign(evt, now() - 3600));

  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'expired');
  await t.close();
});

test('without a webhookSecret the route does not exist', async () => {
  const t = await build({ authorize: () => true });
  const res = await post(t.app, '/api/numra/webhook', evt, sign(evt, now()));

  assert.equal(res.statusCode, 404);
  await t.close();
});

test('a slow handler cannot cause duplicate deliveries', async () => {
  /* Numra retries on non-2xx, so the route must acknowledge before doing the
     merchant's own work. */
  const t = await build({
    authorize: () => true,
    webhookSecret: SECRET,
    onEvent: () => new Promise((r) => setTimeout(r, 400)),
  });
  const started = Date.now();
  const res = await post(t.app, '/api/numra/webhook', evt, sign(evt, now()));

  assert.equal(res.statusCode, 200);
  assert.ok(Date.now() - started < 300, 'acknowledged before the handler finished');
  await t.close();
});

/* ── encapsulation ──────────────────────────────────────────────────────── */

test('the raw parser does not leak to the rest of the app', async () => {
  /* If this fails, every other POST route in the merchant's app silently
     starts receiving Buffers — the loudest possible reason not to wrap this
     plugin in fastify-plugin. */
  const t = await build({ authorize: () => true, webhookSecret: SECRET });
  const res = await post(t.app, '/unrelated', { name: 'zineb' });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().typeofBody, 'object');
  assert.equal(res.json().name, 'zineb');
  await t.close();
});

# @getnumra/fastify

**Numra phone checks, outcome reporting and verified webhooks as a Fastify plugin.**

[![npm version](https://img.shields.io/npm/v/@getnumra/fastify)](https://www.npmjs.com/package/@getnumra/fastify) [![npm downloads](https://img.shields.io/npm/dm/@getnumra/fastify)](https://www.npmjs.com/package/@getnumra/fastify) [![licence: MIT](https://img.shields.io/npm/l/@getnumra/fastify)](LICENSE)

The backend endpoint that `@getnumra/react` calls. Holds your Numra API key so
the browser never does.

```bash
npm install @getnumra/fastify
```

## Register it

```js
import Fastify from 'fastify';
import { numraPlugin } from '@getnumra/fastify';

const app = Fastify();

await app.register(numraPlugin, {
  prefix: '/api/numra',
  apiKey: process.env.NUMRA_API_KEY,
  authorize: (req) => Boolean(req.session?.user),   // required
  webhookSecret: process.env.NUMRA_WEBHOOK_SECRET,  // optional
  onEvent: (event) => queue.add(event),
});
```

Then on the page:

```jsx
import { useNumraCheck, RiskBadge } from '@getnumra/react';

const { data, isLoading } = useNumraCheck(phone);
<RiskBadge check={data} loading={isLoading} />
```

The two halves are built to meet — no glue between them.

## `authorize` is required, and defaults to deny

This route spends your Numra quota, and every lookup is billable. Without an
`authorize` function it is an open relay pointed at your own bill, so the
default **denies every request** and logs what to write.

Return `true` to allow. If your check throws, the request is denied — failing
closed, so a database blip cannot become an open door.

Keep the key in `.env` and out of version control. A key committed once is in
the history of every clone of that repository, and rotating it is the only fix.

## Rate-limit it too

`authorize` decides who may spend your quota, not how much. On a public
checkout those are different questions — the guard is a session that owns a
cart, and any visitor gets one by loading the page — so one session in a loop
is a bill. Register a limiter in the same encapsulated scope:

```js
await app.register(async (scope) => {
  await scope.register(import('@fastify/rate-limit'), { max: 60, timeWindow: '1 minute' });
  await scope.register(numraPlugin, { prefix: '/api/numra', ... });
});
```

Sixty a minute is far above a real checkout and still bounds what a script can
spend. Keep it off `/webhook` — Numra retries a non-2xx, so a 429 there comes
straight back as a redelivery.

## Webhooks and the raw body

Nothing to wire. Fastify parses per content type rather than app-wide, so the
plugin puts `/webhook` in its own encapsulated child, removes the inherited
parsers there and reads the body as a Buffer. `/check` and `/outcome` keep
normal JSON bodies, and the rest of your app is untouched.

This is the one thing worth knowing if you write your own: registering
`addContentTypeParser('*')` is **not** enough. The catch-all only runs for
content types with no parser, and Fastify ships a built-in one for
`application/json` — which is what a webhook arrives as. The catch-all never
fires, the body arrives parsed, and every signature fails while looking
exactly like a forgery.

The plugin is deliberately **not** wrapped in `fastify-plugin`. Encapsulation
is what keeps that parser off your other routes.

The route acknowledges before running your `onEvent`, so a slow handler cannot
turn into duplicate deliveries.

**De-duplicate on `event.id` inside `onEvent`.** A retry reuses the id, and a
replay captured inside the 300-second signature window verifies perfectly — so
the plugin will call you twice for one event, and a handler that cancels an
order or sends an SMS will do it twice.

The webhook route is deliberately outside `authorize`. Its signature is its
authentication, it spends no quota, and Numra has no session to satisfy a
session check with.

## What reaches the browser

A subset: verdict, risk level and score, trust, confidence, `isRated`,
blacklist flag, customer style. Not `raw`, not engine internals, nothing that
names another merchant.

Upstream failures are translated rather than relayed. A rejected credential
becomes `502 UPSTREAM_UNAVAILABLE`, never a 401 — the merchant's credential
problem is not the visitor's business, and a 401 in the browser reads as
"you are logged out".

## Endpoints

| Method | Path | Body |
|---|---|---|
| POST | `/check` | `{ phone }` |
| POST | `/outcome` | `{ phone, orderId, outcomeType, … }` |
| POST | `/webhook` | raw, signed by Numra |

## Release notes

Every release is tagged and written up on the
[Releases page](https://github.com/NumraApp/numra-fastify/releases). The same
history in one file is in [CHANGELOG.md](CHANGELOG.md).

## Contributing

Bug reports and patches are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers
running the tests, the regression test a change is expected to bring with it,
and which repository a given fix actually belongs in.

## Security

Vulnerabilities go privately to the address in [SECURITY.md](SECURITY.md).
**Do not open a public issue for a security problem** — this plugin holds a
credential that reads a shared fraud ledger, and a public report is a working
exploit for every merchant using it until a fix ships.

## The rest of the family

Twelve packages, one contract. The server side holds the API key; the browser
side calls the endpoint the server side mounts.

Server:

| Package | Repository |
|---|---|
| `@getnumra/core` | [numra-js-core](https://github.com/NumraApp/numra-js-core) |
| `@getnumra/express` | [numra-express](https://github.com/NumraApp/numra-express) |
| `@getnumra/fastify` | [numra-fastify](https://github.com/NumraApp/numra-fastify) — this repo |
| `@getnumra/next` | [numra-next](https://github.com/NumraApp/numra-next) |
| `@getnumra/nuxt` | [numra-nuxt](https://github.com/NumraApp/numra-nuxt) |
| `numra/numra-php` | [numra-php](https://github.com/NumraApp/numra-php) |
| `numra/laravel` | [numra-laravel](https://github.com/NumraApp/numra-laravel) |

Browser:

| Package | Repository |
|---|---|
| `@getnumra/browser` | [numra-browser](https://github.com/NumraApp/numra-browser) |
| `@getnumra/react` | [numra-react](https://github.com/NumraApp/numra-react) |
| `@getnumra/vue` | [numra-vue](https://github.com/NumraApp/numra-vue) |
| `@getnumra/svelte` | [numra-svelte](https://github.com/NumraApp/numra-svelte) |
| `@getnumra/angular` | [numra-angular](https://github.com/NumraApp/numra-angular) |

Documentation for all of them is at [numra.ma/docs](https://numra.ma/docs).

## Licence

MIT

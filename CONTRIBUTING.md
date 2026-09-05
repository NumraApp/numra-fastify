# Contributing to @getnumra/fastify

Patches are welcome. This plugin sits in front of a credential that reads a
shared fraud ledger and spends a merchant's paid quota, so the bar for a change
is a test that would have caught the bug, not a convincing description of it.

## Running the tests

```bash
npm install
npm test
```

Node 22.12 or newer, as `engines` declares. The suite is the built-in
`node:test` runner. `test/mock-server.js` stands in for the API, so the tests
never touch the network and never need a key.

## Every change needs a test

Every package in this family ships a regression suite, and it is the only
thing standing between a refactor and a silent behavioural change. So:

- A bug fix comes with a test that fails before it and passes after.
- A new option comes with a test that exercises it.
- A change to existing behaviour comes with the changed assertion, and the
  reason for the change in the commit message.

`test/plugin.test.js` asserts two things that are easy to undo by accident:
that the webhook route receives an unparsed Buffer, and that the parser change
which makes that possible stays inside its encapsulated child. Registering
this plugin through `fastify-plugin` would break the second one, which is why
it deliberately is not.

## Which repository your fix belongs in

These repositories are split out of a single monorepo. What you see here is
one package of twelve, and this one is deliberately thin: the decisions —
deny-by-default authorisation, what the browser is allowed to see, how an
upstream failure is translated — all live in `createHandlers` in
[numra-js-core](https://github.com/NumraApp/numra-js-core), shared with the
Express, Next and Nuxt packages.

So:

- Behaviour that should be identical across those four belongs in
  **`@getnumra/core`**, not here. Fixing it here alone is how four copies of
  "deny by default" become three.
- Anything Fastify-shaped — registration, encapsulation, content-type parsers,
  the reply object — belongs here.
- A change on the browser side of the wire belongs in
  [numra-browser](https://github.com/NumraApp/numra-browser).

If your fix lands in `@getnumra/core`, this package picks it up as a dependency
bump; say so in the pull request.

## The conformance gate

```bash
node scripts/openapi-conformance.js
```

This checks the package against the API contract and against itself. It fails
by default when no contract is vendored, on purpose: a conformance step that
goes green having compared nothing manufactures exactly the assurance it
exists to provide. Point `NUMRA_OPENAPI` at a copy of the spec, or drop it at
one of the paths the script lists, to make it run for real.

## House style

British spelling, no emoji in headings, and prose that says what a thing does
rather than how good it is. Comments explain the decision, not the syntax.

## Reporting a bug

Open an issue with the package version, the Fastify version, the Node version,
and the smallest reproduction you can manage. **A security vulnerability is
not a bug report** — see [SECURITY.md](SECURITY.md) and mail it privately
instead.

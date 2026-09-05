import { Numra, createHandlers } from '@numra/core';

/* ═══════════════════════════════════════════════════════════════════════════
   @numra/fastify — the same endpoint, Fastify-shaped
   ───────────────────────────────────────────────────────────────────────────
       await app.register(numraPlugin, { apiKey, authorize, prefix: '/api/numra' });

   All the decisions live in @numra/core's createHandlers, shared with the
   Express, Next and Nuxt packages. This file is the Fastify wrapper and
   nothing else.

   ── The raw body, Fastify's way ───────────────────────────────────────────
   Fastify parses JSON before the handler runs, and unlike Express there is no
   "mount before the parser" escape — parsing is per-content-type, registered
   on the instance.

   `addContentTypeParser('*')` alone does NOT solve this. The catch-all is
   only consulted for content types that have no parser, and Fastify ships a
   built-in one for application/json — which is exactly what a webhook is sent
   as. The catch-all would never run, the body would arrive already parsed,
   and every signature would fail while looking like a forgery.

   So the webhook lives in its own encapsulated child, where the built-in
   parsers are removed outright and everything becomes a Buffer. /check and
   /outcome stay outside that child and keep normal JSON bodies.

   Encapsulation is what keeps that from escaping: a child plugin's parsers do
   not leak to the parent unless you use fastify-plugin, which this
   deliberately does not.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {object} options
 * @param {string} [options.apiKey]
 * @param {(req) => boolean|Promise<boolean>} [options.authorize]
 * @param {string} [options.webhookSecret]
 * @param {(event, req) => void|Promise<void>} [options.onEvent]
 * @param {object} [options.client]
 * @param {string} [options.baseUrl]
 */
export async function numraPlugin(fastify, options = {}) {
  const { apiKey, authorize, webhookSecret, onEvent, client, baseUrl } = options;

  const numra = client ?? new Numra({ apiKey, baseUrl, integration: 'fastify' });
  const handlers = createHandlers({
    client: numra, authorize, webhookSecret,
    usage: "app.register(numraPlugin, { apiKey, authorize: (req) => Boolean(req.session?.user) })",
  });

  fastify.post('/check', async (req, reply) => {
    const out = await handlers.check(req.body, req);
    return reply.code(out.status).send(out.body);
  });

  fastify.post('/outcome', async (req, reply) => {
    const out = await handlers.outcome(req.body, req);
    return reply.code(out.status).send(out.body);
  });

  if (webhookSecret) {
    await fastify.register(async (raw) => {
      /* Drop the inherited parsers — including the built-in application/json
         one — so the catch-all below is what actually runs. Encapsulated: the
         parent instance and its other routes are untouched. */
      raw.removeAllContentTypeParsers();
      raw.addContentTypeParser(
        '*',
        { parseAs: 'buffer' },
        (_req, body, done) => done(null, body),
      );

      raw.post('/webhook', async (req, reply) => {
        const out = handlers.webhook(req.body, req.headers);
        await reply.code(out.status).send(out.body);
        if (!out.event) return;

        /* Already acknowledged. Numra retries on a non-2xx, so a slow handler
           run before the reply would become duplicate deliveries. */
        try {
          await onEvent?.(out.event, req);
        } catch (e) {
          req.log?.error?.({ err: e }, '[numra] onEvent threw after acknowledging');
        }
      });
    });
  }
}

export default numraPlugin;
export { Numra, NumraError } from '@numra/core';

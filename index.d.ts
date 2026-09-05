import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Numra, NumraError } from '@getnumra/core';

export interface NumraPluginOptions {
  /** Numra credential. Server-side only. */
  apiKey?: string;
  /**
   * Runs before every lookup. Return false to reject.
   *
   * REQUIRED. The default denies everything and logs why — this route spends
   * your Numra quota, so leaving it open is an open relay pointed at your
   * own bill.
   */
  authorize?: (req: FastifyRequest) => boolean | Promise<boolean>;
  /** Enables POST /webhook when set. */
  webhookSecret?: string;
  onEvent?: (event: Record<string, unknown>, req: FastifyRequest) => void | Promise<void>;
  /** A pre-built client, for tests. */
  client?: Numra;
  baseUrl?: string;
}

/** What the browser receives — a subset. Never `raw`, never engine internals. */
export interface BrowserCheck {
  phone: string;
  verdict: string;
  riskLevel: string;
  riskScore: number;
  trustScore: number;
  confidence: number;
  isRated: boolean;
  isBlacklisted: boolean;
  customerStyle: { code: string; label: string; icon: string; color: string; riskSensitivity: number } | null;
}

/**
 * Register with a prefix — the three routes mount under it:
 *
 *     await app.register(numraPlugin, {
 *       prefix: '/api/numra',
 *       apiKey: process.env.NUMRA_API_KEY,
 *       authorize: (req) => Boolean(req.session?.user),
 *     });
 *
 * Not wrapped in fastify-plugin, deliberately: the webhook route needs its own
 * content-type parser, and encapsulation is what keeps that off your other
 * routes.
 */
export declare function numraPlugin(
  fastify: FastifyInstance,
  options?: NumraPluginOptions,
): Promise<void>;

export default numraPlugin;
export { Numra, NumraError } from '@getnumra/core';

/**
 * Causal network-noise filters — SHARED single source of truth.
 *
 * Used by BOTH:
 *   - the recorder's causal network-idle gate (src/tap/network-bridge.ts —
 *     which requests may block consequence settling), and
 *   - the executor's inter-step network drain (src/background/
 *     network-observation.ts — which requests may block replay pacing).
 *
 * Extracted from network-bridge.ts (2026-08-20) so the two contexts can
 * never drift. Patterns are IDENTICAL to the historical definitions.
 */

/** Static-asset URLs — never causal, never block settling/drain. */
export const NOISE_URL_RE_CAUSAL =
  /\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|mjs|woff2?|ttf)(\?|$)/i;

/** Telemetry/beacon URLs — also never block settling (§8). */
export const TELEMETRY_URL_RE_CAUSAL =
  /\/unagi|\/events\/|\/beacon|\/pixel|\/csm|\/aax2|\/impression|fls-|\/1\/batch\/|uedata/i;

/**
 * True when the URL is causal noise (static asset or telemetry) — such a
 * request must NEVER be counted as in-flight by a causal idle/drain check.
 */
export function isCausalNoiseUrl(url: string): boolean {
  return NOISE_URL_RE_CAUSAL.test(url) || TELEMETRY_URL_RE_CAUSAL.test(url);
}

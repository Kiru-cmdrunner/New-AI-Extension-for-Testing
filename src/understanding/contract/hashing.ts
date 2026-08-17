/**
 * Hashing helpers for contract artifacts.
 *
 * `sha256Hex` uses Web Crypto (`globalThis.crypto.subtle`), available in
 * the extension service worker and in Node ≥ 18 — the same primitive on
 * both sides of the M-EXEC boundary, so snapshot hashes verify identically
 * in-extension and in the Node execution layer.
 */

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/** Small helpers for the demo: exact decimal comparison, a test address generator, polling. */
import { generateKeyPairSync } from 'node:crypto';

// ── Exact decimals (never floating point for money) ──────────────────────────

const SCALE = 18;
function toUnits(d: string): bigint {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(d.trim());
  if (!m) throw new Error(`not a decimal string: ${d}`);
  const frac = (m[3] ?? '').slice(0, SCALE).padEnd(SCALE, '0');
  const v = BigInt(m[2]!) * 10n ** BigInt(SCALE) + BigInt(frac || '0');
  return m[1] ? -v : v;
}
function fromUnits(v: bigint, decimals: number): string {
  const neg = v < 0n; if (neg) v = -v;
  const unit = 10n ** BigInt(SCALE);
  const whole = v / unit;
  const frac = (v % unit).toString().padStart(SCALE, '0').slice(0, decimals);
  return `${neg ? '-' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

/** -1, 0 or 1. */
export function cmpDecimal(a: string, b: string): number {
  const x = toUnits(a), y = toUnits(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
export function addDecimal(a: string, b: string, decimals: number): string {
  return fromUnits(toUnits(a) + toUnits(b), decimals);
}
export function minDecimal(a: string, b: string): string {
  return cmpDecimal(a, b) <= 0 ? a : b;
}
/** Truncate to `decimals` places. */
export function fixDecimal(a: string, decimals: number): string {
  return fromUnits(toUnits(a), decimals);
}

// ── A fresh external address for the demo counterparty ───────────────────────

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)]! + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}

/** A newly generated ed25519 public key, base58-encoded: the address format the API's network uses. Nobody keeps the
 *  private key, so treat anything sent there as gone (fine for sandbox test tokens only). */
export function freshExternalAddress(): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.x) throw new Error('ed25519 key export failed');
  return base58(Buffer.from(jwk.x, 'base64url'));
}

// ── Polling ──────────────────────────────────────────────────────────────────

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Calls `fetch` every `intervalMs` until `done` is true or `timeoutMs` passes. Returns the last value. */
export async function pollUntil<T>(fetch: () => Promise<T>, done: (v: T) => boolean, opts: { intervalMs?: number; timeoutMs?: number; onChange?: (v: T) => void; key?: (v: T) => string } = {}): Promise<{ value: T; finished: boolean }> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  let last: string | undefined;
  for (;;) {
    const v = await fetch();
    const k = opts.key?.(v);
    if (k !== undefined && k !== last) { last = k; opts.onChange?.(v); }
    if (done(v)) return { value: v, finished: true };
    if (Date.now() + interval > deadline) return { value: v, finished: false };
    await sleep(interval);
  }
}

/**
 * A minimal webhook receiver on `node:http` (no framework, no dependencies).
 *
 * Every delivery carries `X-AxLink-Signature: t=<unix seconds>,v1=<hex>` where
 *   v1 = HMAC-SHA256(secret, t + "." + rawBody)
 * and `secret` is the value returned once by POST /v1/webhook-endpoints.
 *
 * Rules this receiver follows:
 * 1. Verify over the raw bytes, before parsing JSON. Re-serialising the body changes it and breaks the signature.
 * 2. Compare with a timing-safe comparison.
 * 3. Refuse old or future timestamps (replay window, default 300 s back / 60 s ahead).
 * 4. Answer 2xx quickly and do the work afterwards. AxLink retries failed deliveries, so the same event can arrive
 *    more than once: deduplicate on the event `id`.
 *
 * Run: AXLINK_WEBHOOK_SECRET=whsec_... npm run webhooks   (listens on WEBHOOK_PORT, default 8787, path /webhooks/axlink)
 * Expose it to AxLink through your public https ingress; the endpoint URL you register must be public https.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadDotEnv } from './config';

export interface WebhookEvent<D = Record<string, unknown>> {
  /** Event id (evt_...): the same id is redelivered on retry. Use it as your idempotency key. */
  id: string;
  /** e.g. deposit.settled, transfer.settled, conversion.settled, withdrawal.paid, payout.paid, payout.instruction */
  type: string;
  createdAt: string;
  data: D;
}

export type SignatureFailure = 'MISSING_SIGNATURE' | 'MALFORMED_SIGNATURE' | 'TIMESTAMP_TOO_OLD' | 'TIMESTAMP_IN_FUTURE' | 'SIGNATURE_MISMATCH';

export class WebhookSignatureError extends Error {
  override readonly name = 'WebhookSignatureError';
  constructor(readonly code: SignatureFailure, message: string) { super(message); }
}

export interface VerifyOptions {
  /** Tolerated age of the signature timestamp, in seconds (default 300). */
  toleranceSeconds?: number;
  /** Tolerated clock skew into the future, in seconds (default 60). */
  futureSkewSeconds?: number;
  /** For tests: current time in unix seconds. */
  now?: number;
}

/**
 * Verify `X-AxLink-Signature` over the raw body. Throws `WebhookSignatureError`; returns normally when valid.
 * Several `v1=` values are accepted (any one matching is enough), which lets you rotate secrets without downtime.
 */
export function verifyAxLinkSignature(rawBody: Buffer | string, header: string | string[] | undefined, secret: string, opts: VerifyOptions = {}): void {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new WebhookSignatureError('MISSING_SIGNATURE', 'X-AxLink-Signature header is absent');

  let t: number | undefined;
  const v1: string[] = [];
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't' && /^\d+$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === undefined || v1.length === 0) throw new WebhookSignatureError('MALFORMED_SIGNATURE', 'expected t=<unix>,v1=<hex sha256>');

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const tolerance = opts.toleranceSeconds ?? 300;
  if (now - t > tolerance) throw new WebhookSignatureError('TIMESTAMP_TOO_OLD', `signature timestamp is more than ${tolerance}s old`);
  if (t - now > (opts.futureSkewSeconds ?? 60)) throw new WebhookSignatureError('TIMESTAMP_IN_FUTURE', 'signature timestamp is in the future');

  const body = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(body).digest();
  const ok = v1.some(sig => {
    const got = Buffer.from(sig, 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new WebhookSignatureError('SIGNATURE_MISMATCH', 'HMAC does not match');
}

/** In-memory dedupe of recent event ids. Use your database (a unique key on the event id) in production. */
class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 10_000) {}
  /** True the first time an id is seen. */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) this.ids.delete(this.ids.values().next().value as string);
    return true;
  }
}

const MAX_BODY_BYTES = 1024 * 1024;

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Your business logic. Keep it idempotent: the same event can arrive twice. */
async function handleEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case 'deposit.settled':
    case 'settlement.received':
    case 'end_user.deposit.credited':
      // Credit your customer / mark the deposit final in your core system.
      break;
    case 'transfer.settled':
    case 'transfer.failed':
    case 'conversion.settled':
    case 'conversion.failed':
    case 'withdrawal.paid':
    case 'withdrawal.failed':
      // Update the status of the operation your system started (look it up by data id / your reference).
      break;
    case 'payout.instruction':
      // Leg 2 payout partner: act on data.stage (ACCEPT_REQUESTED -> accept; PAY -> pay locally and report the result).
      break;
    default:
      break;
  }
  console.log(`[webhook] ${event.type} ${event.id}`, JSON.stringify(event.data));
}

export function createWebhookServer(secret: string, path = '/webhooks/axlink') {
  const seen = new RecentIds();
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body?: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== path) return send(404, { error: 'not found' });

    let raw: Buffer;
    try { raw = await readRawBody(req); } catch { return send(413, { error: 'body too large' }); }

    try {
      verifyAxLinkSignature(raw, req.headers['x-axlink-signature'], secret);
    } catch (e) {
      const code = e instanceof WebhookSignatureError ? e.code : 'ERROR';
      console.warn(`[webhook] rejected: ${code}`);
      return send(400, { error: code });
    }

    let event: WebhookEvent;
    try { event = JSON.parse(raw.toString('utf8')) as WebhookEvent; } catch { return send(400, { error: 'INVALID_JSON' }); }

    if (!seen.add(event.id)) return send(200, { ok: true, duplicate: true });
    // Acknowledge first, then process. A failure in your processing must not make AxLink resend forever:
    // record the event durably before acknowledging if you need stronger guarantees.
    send(200, { ok: true });
    handleEvent(event).catch(err => console.error(`[webhook] handler failed for ${event.id}:`, err));
  });
}

if (require.main === module) {
  loadDotEnv();
  const secret = process.env.AXLINK_WEBHOOK_SECRET;
  if (!secret || secret === 'whsec_replace_me') {
    console.error('Set AXLINK_WEBHOOK_SECRET to the secret returned when you created the webhook endpoint.');
    process.exit(1);
  }
  const port = Number(process.env.WEBHOOK_PORT ?? 8787);
  createWebhookServer(secret).listen(port, () => console.log(`AxLink webhook receiver on http://localhost:${port}/webhooks/axlink`));
}

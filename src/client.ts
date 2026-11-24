/**
 * A small typed HTTP client for the AxLink institution API (`/api/v1`).
 *
 * - Bearer auth with your institution API key.
 * - `X-AxLink-Environment` sent from the key prefix: if the key belongs to the other environment, AxLink answers
 *   409 ENVIRONMENT_MISMATCH instead of acting on either.
 * - `Idempotency-Key` on writes. Pass your own key (derived from your business reference) when you may retry: the same
 *   key and the same body return the original result, and nothing moves twice.
 * - The error envelope `{ error: { code, message, requestId, details? } }` becomes an `AxLinkApiError`.
 * - A timeout on every request. GET requests are retried on network errors, 429 and 5xx; writes are never retried
 *   automatically (retry them yourself with the same Idempotency-Key).
 *
 * Node 18+ built-in `fetch`; no dependencies.
 */
import { randomUUID } from 'node:crypto';
import type { Environment } from './types';
import type { ErrorEnvelope } from './types';

export interface AxLinkClientOptions {
  apiKey: string;
  /** Host only, e.g. https://axlink.appraglobal.com. The client appends /api/v1. */
  baseUrl: string;
  /** Per-request timeout in milliseconds (default 30000). */
  timeoutMs?: number;
  /** Sent as X-AxLink-Environment. Usually derived from the key prefix. */
  environment?: Environment | null;
  /** When true, every non-GET request is refused locally before it is sent (see `WritesBlockedError`). */
  blockWrites?: boolean;
  /** Retries for GET requests on network errors, 429 and 5xx (default 2). */
  getRetries?: number;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Query = Record<string, string | number | boolean | undefined | null>;

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Sent as the Idempotency-Key header on writes. Generated when omitted. 8 to 128 characters. */
  idempotencyKey?: string;
}

/** AxLink answered with a non-2xx status. `code` is stable and machine-readable; branch on it, not on `message`. */
export class AxLinkApiError extends Error {
  override readonly name = 'AxLinkApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string | undefined,
    readonly details: unknown,
    readonly method: HttpMethod,
    readonly path: string,
  ) {
    super(`${method} ${path} -> ${status} ${code}: ${message}${requestId ? ` (requestId ${requestId})` : ''}`);
  }
}

/** The request did not get an HTTP answer: timeout, DNS, connection reset. A write may or may not have happened:
 *  retry it with the same Idempotency-Key, or look it up, before doing anything else. */
export class AxLinkTransportError extends Error {
  override readonly name = 'AxLinkTransportError';
  constructor(readonly kind: 'TIMEOUT' | 'NETWORK', readonly method: HttpMethod, readonly path: string, override readonly cause?: unknown) {
    super(`${method} ${path}: ${kind === 'TIMEOUT' ? 'timed out' : `network error (${(cause as Error | undefined)?.message ?? 'unknown'})`}`);
  }
}

/** A write was refused locally because the client was built with `blockWrites: true` (production safety switch). */
export class WritesBlockedError extends Error {
  override readonly name = 'WritesBlockedError';
  constructor(readonly method: HttpMethod, readonly path: string) {
    super(`${method} ${path} not sent: writes are disabled for this client (production key without ALLOW_PRODUCTION_WRITES=true)`);
  }
}

/** A fresh idempotency key. In production code derive it from your own reference (e.g. `payment-${invoiceId}`). */
export const newIdempotencyKey = (prefix = 'axl'): string => `${prefix}-${randomUUID()}`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export class AxLinkClient {
  readonly baseUrl: string;
  readonly environment: Environment | null;
  readonly blockWrites: boolean;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly getRetries: number;

  constructor(opts: AxLinkClientOptions) {
    if (!opts.apiKey) throw new Error('apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.environment = opts.environment ?? null;
    this.blockWrites = opts.blockWrites ?? false;
    this.getRetries = opts.getRetries ?? 2;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }
  delete<T = void>(path: string, opts: Omit<RequestOptions, 'body'> = {}): Promise<T> {
    return this.request<T>('DELETE', path, opts);
  }

  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    const isWrite = method !== 'GET';
    if (isWrite && this.blockWrites) throw new WritesBlockedError(method, path);

    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: 'application/json',
      'User-Agent': 'axlink-api-example-usage/1.0',
    };
    if (this.environment) headers['X-AxLink-Environment'] = this.environment;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (isWrite) headers['Idempotency-Key'] = opts.idempotencyKey ?? newIdempotencyKey();
    const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);

    const attempts = isWrite ? 1 : 1 + this.getRetries;
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.timeoutMs);
      try {
        res = await fetch(url, { method, headers, body, signal: ac.signal });
      } catch (e) {
        const err = new AxLinkTransportError(ac.signal.aborted ? 'TIMEOUT' : 'NETWORK', method, path, e);
        if (attempt < attempts) { await sleep(backoff(attempt)); continue; }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        const text = await res.text();
        return (text ? JSON.parse(text) : undefined) as T;
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < attempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await res.text().catch(() => undefined);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : backoff(attempt));
        continue;
      }
      throw await toApiError(res, method, path);
    }
  }
}

const backoff = (attempt: number) => Math.min(250 * 2 ** (attempt - 1), 4000) + Math.floor(Math.random() * 100);

async function toApiError(res: Response, method: HttpMethod, path: string): Promise<AxLinkApiError> {
  const text = await res.text().catch(() => '');
  let env: Partial<ErrorEnvelope> | undefined;
  try { env = text ? (JSON.parse(text) as Partial<ErrorEnvelope>) : undefined; } catch { /* not JSON (e.g. a proxy page) */ }
  const e = env?.error;
  return new AxLinkApiError(
    res.status,
    e?.code ?? `HTTP_${res.status}`,
    e?.message ?? (text.slice(0, 200) || res.statusText),
    e?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    e?.details,
    method,
    path,
  );
}

/** Path segment encoder for ids and your own references. */
export const seg = (v: string): string => encodeURIComponent(v);

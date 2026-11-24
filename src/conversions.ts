/**
 * Leg A conversion: your USDC/USDT into your own USD or EUR treasury balance.
 *
 *   GET  /v1/conversions/pairs   pairs available to you
 *   POST /v1/conversions/quote   quote: rate, fee and the exact amount credited (`creditAmount`); nothing moves
 *   POST /v1/conversions         execute a quote (idempotencyKey in the body)
 *   GET  /v1/conversions         list, newest first (limit, cursor, status)
 *   GET  /v1/conversions/{id}    one
 *
 * Execution reserves the stablecoin at once; the credit lands in the treasury when settlement confirms
 * (webhook `conversion.settled`; on failure `conversion.failed` and the reservation is released).
 */
import { seg, type AxLinkClient } from './client';
import type { Conversion, ConversionList, ConversionPairsResponse, ConversionQuote, ConversionQuoteRequest, ExecuteConversionRequest } from './types';

export class ConversionsApi {
  constructor(private readonly http: AxLinkClient) {}

  pairs(): Promise<ConversionPairsResponse> {
    return this.http.get('/conversions/pairs');
  }

  /** Quotes expire (see `expiresAt`). With `walletId`, `funding.sufficient` says whether execution can proceed. */
  async quote(body: ConversionQuoteRequest): Promise<ConversionQuote> {
    return (await this.http.post<{ quote: ConversionQuote }>('/conversions/quote', body)).quote;
  }

  /** Errors to expect: 422 INSUFFICIENT_BALANCE / QUOTE_EXPIRED, 409 ROUTE_NOT_ENABLED. */
  async execute(body: ExecuteConversionRequest): Promise<Conversion> {
    // This endpoint carries its idempotency key in the body; the same value is sent as the header too.
    return (await this.http.post<{ conversion: Conversion }>('/conversions', body, { idempotencyKey: body.idempotencyKey })).conversion;
  }

  list(query: { limit?: number; cursor?: string; status?: string } = {}): Promise<ConversionList> {
    return this.http.get('/conversions', query);
  }

  async get(id: string): Promise<Conversion> {
    return (await this.http.get<{ conversion: Conversion }>(`/conversions/${seg(id)}`)).conversion;
  }
}

/**
 * Leg C: payout orders. RECORD-ONLY: a payout order is a record of a disbursement instruction. It moves no money,
 * posts nothing to the ledger and is not linked to the Leg 2 payout flow (payouts.ts), which is the one that settles
 * value. Needs Leg 2 enabled.
 *
 *   GET  /v1/payout-orders/corridors   payout methods per currency (a currency not listed accepts BANK_TRANSFER only)
 *   POST /v1/payout-orders             create a record (Idempotency-Key required)
 *   GET  /v1/payout-orders             list, newest first (status, currency, limit, cursor)
 *   GET  /v1/payout-orders/{id}        one
 *
 * Status: PENDING -> SENT -> PROCESSING -> COMPLETED or FAILED (CANCELLED is a side exit).
 */
import { seg, type AxLinkClient } from './client';
import type { CreatePayoutOrderRequest, PayoutOrder, PayoutOrderList, PayoutOrderMethod, PayoutOrderQuery } from './types';

export class PayoutOrdersApi {
  constructor(private readonly http: AxLinkClient) {}

  async corridors(): Promise<{ currency: string; methods: PayoutOrderMethod[] }[]> {
    return (await this.http.get<{ corridors: { currency: string; methods: PayoutOrderMethod[] }[] }>('/payout-orders/corridors')).corridors;
  }

  /** Mobile-money methods need `recipientPhone`; BANK_TRANSFER needs `accountNumber`. 409 PAYOUT_ORDER_EXISTS_FOR_TRANSFER
   *  when an order already exists for the same `transferId`. */
  create(body: CreatePayoutOrderRequest, idempotencyKey: string): Promise<PayoutOrder> {
    return this.http.post('/payout-orders', body, { idempotencyKey });
  }

  list(query: PayoutOrderQuery = {}): Promise<PayoutOrderList> {
    return this.http.get('/payout-orders', { ...query });
  }

  get(id: string): Promise<PayoutOrder> {
    return this.http.get(`/payout-orders/${seg(id)}`);
  }
}

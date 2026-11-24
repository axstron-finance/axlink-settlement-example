/**
 * Leg 2, sending bank (originator): pay a recipient in local currency through a payout partner bank.
 * Needs Leg 2 and the `sender` role (GET /v1/institutions/me -> leg2Roles.sender).
 *
 *   GET  /v1/payouts/capacity   how much can be promised now in a currency (and rail)
 *   POST /v1/payouts/quotes     the exact local amount the recipient receives, with fees and expiry
 *   POST /v1/payouts            accept a quote with the beneficiary (Idempotency-Key required)
 *   GET  /v1/payouts/{id}       status, funding, local amount, partner reference once paid
 *
 * After `create`, send exactly `funding.amount` of `funding.asset` to `funding.address` before `fundingDeadline`.
 * Status: QUOTED -> AWAITING_FUNDING -> FUNDING_RECEIVED -> FUNDING_CONFIRMED -> SETTLING -> PARTNER_SETTLEMENT_RECEIVED
 *   -> INSTRUCTED -> BENEFICIARY_PAID -> COMPLETED (side exits: EXPIRED, FUNDING_EXPIRED, FUNDING_SHORT, PAYOUT_FAILED, REFUNDED).
 * Webhooks: payout.funding_confirmed, payout.funding_short / _excess / _late, payout.partner_settled, payout.paid, payout.failed.
 */
import { seg, type AxLinkClient } from './client';
import type { CreatePayoutRequest, Payout, PayoutCapacity, PayoutQuoteRequest, PayoutRail } from './types';

export class PayoutsApi {
  constructor(private readonly http: AxLinkClient) {}

  capacity(currency: string, rail?: PayoutRail): Promise<PayoutCapacity> {
    return this.http.get('/payouts/capacity', { currency, rail });
  }

  /** Returns a payout in status QUOTED; its `id` is the quote id for `create`. */
  quote(body: PayoutQuoteRequest): Promise<Payout> {
    return this.http.post('/payouts/quotes', body);
  }

  create(body: CreatePayoutRequest, idempotencyKey: string): Promise<Payout> {
    return this.http.post('/payouts', body, { idempotencyKey });
  }

  get(id: string): Promise<Payout> {
    return this.http.get(`/payouts/${seg(id)}`);
  }
}

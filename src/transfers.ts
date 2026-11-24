/**
 * Leg A transfers (outbound settlements) to an ACTIVE counterparty.
 *
 *   POST /v1/transfers               Idempotency-Key required
 *   POST /v1/settlements             same action under its blueprint name; Idempotency-Key required
 *   GET  /v1/transfers               list (?status=<stage>)
 *   GET  /v1/transfers/{id}          status, stage and proof
 *   POST /v1/transfers/{id}/cancel   only while AWAITING_APPROVAL
 *   GET  /v1/settlements/{id}        status and proof of a transfer or a deposit instruction
 *
 * The first create answers 202; a replay with the same key and body answers 200 with the same transfer, so a retry
 * never pays twice. A different body under the same key is 409 IDEMPOTENCY_MISMATCH.
 * Sandbox approves automatically under a limit; production waits for AxLink approval (stage AWAITING_APPROVAL).
 */
import { seg, type AxLinkClient } from './client';
import type { CreateTransferRequest, Deposit, Transfer, TransferStage } from './types';

export class TransfersApi {
  constructor(private readonly http: AxLinkClient) {}

  create(body: CreateTransferRequest, idempotencyKey: string): Promise<Transfer> {
    return this.http.post('/transfers', body, { idempotencyKey });
  }

  /** POST /v1/settlements: identical behaviour to `create`. */
  createSettlement(body: CreateTransferRequest, idempotencyKey: string): Promise<Transfer> {
    return this.http.post('/settlements', body, { idempotencyKey });
  }

  list(stage?: Exclude<TransferStage, 'UNDER_REVIEW'>): Promise<Transfer[]> {
    return this.http.get('/transfers', { status: stage });
  }

  get(id: string): Promise<Transfer> {
    return this.http.get(`/transfers/${seg(id)}`);
  }

  cancel(id: string): Promise<Transfer> {
    return this.http.post(`/transfers/${seg(id)}/cancel`);
  }

  /** GET /v1/settlements/{id}: a Transfer (kind TRANSFER) or a deposit instruction (kind DEPOSIT). */
  getSettlement(id: string): Promise<Transfer | Deposit> {
    return this.http.get(`/settlements/${seg(id)}`);
  }
}

/** Final when the public status is COMPLETED or FAILED. */
export const isFinal = (t: { status: string }): boolean => t.status === 'COMPLETED' || t.status === 'FAILED';

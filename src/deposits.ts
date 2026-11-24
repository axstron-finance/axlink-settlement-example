/**
 * Leg A deposits: announce an expected deposit so AxLink can match it, then send exactly that amount to the wallet's
 * receiving address. Credited at finality; webhook `deposit.settled`.
 *
 *   POST /v1/deposits              announce
 *   GET  /v1/deposits              list (newest first, max 100; ?status=)
 *   GET  /v1/deposits/{id}         one
 *   POST /v1/deposits/{id}/cancel  cancel a PENDING instruction
 *   GET  /v1/settlements/{id}      status and proof (answers for a deposit or a transfer id) — see transfers.ts
 */
import { seg, type AxLinkClient } from './client';
import type { AnnounceDepositRequest, Deposit, DepositInstructionStatus } from './types';

export class DepositsApi {
  constructor(private readonly http: AxLinkClient) {}

  announce(body: AnnounceDepositRequest): Promise<Deposit> {
    return this.http.post('/deposits', body);
  }

  list(status?: Exclude<DepositInstructionStatus, 'RECEIVED'>): Promise<Deposit[]> {
    return this.http.get('/deposits', { status });
  }

  get(id: string): Promise<Deposit> {
    return this.http.get(`/deposits/${seg(id)}`);
  }

  /** 409 when the instruction is no longer PENDING. Returns the instruction (instructionStatus CANCELLED). */
  cancel(id: string): Promise<Deposit> {
    return this.http.post(`/deposits/${seg(id)}/cancel`);
  }
}

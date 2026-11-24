/**
 * Leg 2, payout partner bank: you pay recipients from your own local-currency balance and AxLink settles stablecoin
 * to your settlement wallet. Needs Leg 2 and the `partner` role (GET /v1/institutions/me -> leg2Roles.partner).
 *
 *   GET  /v1/payout-accounts                       your payout accounts with capacity
 *   POST /v1/payout-accounts/{currency}/balance    report your verified local balance
 *   POST /v1/payout-accounts/{currency}/hold       confirm the hold on your payout funds
 *   GET  /v1/payout-instructions                   orders addressed to you (?status=)
 *   GET  /v1/payout-instructions/{id}              one; look it up before retrying after a local-rail timeout
 *   POST /v1/payout-instructions/{id}/accept       stage 1: accept and confirm the exact local amount is reserved
 *   POST /v1/payout-instructions/{id}/result       stage 2: after stage PAY, report PAID (with your local reference) or FAILED
 *
 * Each stage is also delivered by the signed `payout.instruction` webhook with the same instruction id: treat that id
 * as your idempotency key. Repeating the same accept or result is a no-op (200).
 */
import { seg, type AxLinkClient } from './client';
import type {
  AcceptInstructionRequest, AcceptInstructionResponse, InstructionResultRequest, InstructionResultResponse,
  PayoutAccount, PayoutInstruction, ReportBalanceRequest,
} from './types';

export class PayoutPartnerApi {
  constructor(private readonly http: AxLinkClient) {}

  async accounts(): Promise<PayoutAccount[]> {
    return (await this.http.get<{ accounts: PayoutAccount[] }>('/payout-accounts')).accounts;
  }

  /** 409 STALE_BALANCE_REPORT when `asOf` is older than the balance AxLink already holds. */
  reportBalance(currency: string, body: ReportBalanceRequest): Promise<PayoutAccount> {
    return this.http.post(`/payout-accounts/${seg(currency)}/balance`, body);
  }

  confirmHold(currency: string): Promise<PayoutAccount> {
    return this.http.post(`/payout-accounts/${seg(currency)}/hold`);
  }

  async instructions(status?: 'INSTRUCTED' | 'BENEFICIARY_PAID' | 'PAYOUT_FAILED'): Promise<PayoutInstruction[]> {
    return (await this.http.get<{ instructions: PayoutInstruction[] }>('/payout-instructions', { status })).instructions;
  }

  instruction(id: string): Promise<PayoutInstruction> {
    return this.http.get(`/payout-instructions/${seg(id)}`);
  }

  /** 409 RESERVATION_MISMATCH (amount differs from the quoted one), ALREADY_ACCEPTED, NOT_OFFERED. */
  accept(id: string, body: AcceptInstructionRequest): Promise<AcceptInstructionResponse> {
    return this.http.post(`/payout-instructions/${seg(id)}/accept`, body);
  }

  /** PAID needs `localReference`, `amount` and `currency`. AxLink reports the beneficiary paid only from this result. */
  result(id: string, body: InstructionResultRequest): Promise<InstructionResultResponse> {
    return this.http.post(`/payout-instructions/${seg(id)}/result`, body);
  }
}

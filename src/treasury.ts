/**
 * Leg A treasury: your USD/EUR balance (from conversions), your institution's own bank accounts, and withdrawals to
 * them. Third-party payouts are Leg 2 (payouts.ts), never these routes.
 *
 *   GET  /v1/treasury               balances, bank accounts, recent withdrawals, withdrawal routes, fees
 *   GET  /v1/bank-accounts          your bank accounts (masked)
 *   POST /v1/bank-accounts          add one; the holder must be your institution's legal name
 *   POST /v1/withdrawals/preview    amount, fee, net amount and whether it is allowed; nothing moves
 *   POST /v1/withdrawals            withdraw (Idempotency-Key required)
 *   GET  /v1/withdrawals            list, newest first
 *   GET  /v1/withdrawals/{id}       one
 *
 * Withdrawal status: REQUESTED -> PROCESSING -> PAID (bank reference) or FAILED (balance released).
 * Webhooks `withdrawal.paid` / `withdrawal.failed`.
 */
import { seg, type AxLinkClient } from './client';
import type { BankAccount, CreateBankAccountRequest, CreateWithdrawalRequest, Treasury, Withdrawal, WithdrawalPreview, WithdrawalPreviewRequest } from './types';

export class TreasuryApi {
  constructor(private readonly http: AxLinkClient) {}

  get(): Promise<Treasury> {
    return this.http.get('/treasury');
  }

  async listBankAccounts(): Promise<BankAccount[]> {
    return (await this.http.get<{ items: BankAccount[] }>('/bank-accounts')).items;
  }

  /** Sandbox: VERIFIED at once. Production: PENDING_VERIFICATION until AxLink compliance verifies it.
   *  422 ACCOUNT_NOT_INSTITUTION_OWNED when `accountName` is not your legal name. */
  addBankAccount(body: CreateBankAccountRequest): Promise<BankAccount> {
    return this.http.post('/bank-accounts', body);
  }

  previewWithdrawal(body: WithdrawalPreviewRequest): Promise<WithdrawalPreview> {
    return this.http.post('/withdrawals/preview', body);
  }

  /** 422 INSUFFICIENT_BALANCE / BANK_ACCOUNT_NOT_VERIFIED, 409 ROUTE_NOT_ENABLED. Replay with the same key: 200, same withdrawal. */
  createWithdrawal(body: CreateWithdrawalRequest, idempotencyKey: string): Promise<Withdrawal> {
    return this.http.post('/withdrawals', body, { idempotencyKey });
  }

  async listWithdrawals(): Promise<Withdrawal[]> {
    return (await this.http.get<{ items: Withdrawal[] }>('/withdrawals')).items;
  }

  getWithdrawal(id: string): Promise<Withdrawal> {
    return this.http.get(`/withdrawals/${seg(id)}`);
  }
}

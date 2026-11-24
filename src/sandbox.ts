/**
 * Sandbox test funds (sandbox keys only; a production key gets 403 SANDBOX_ONLY).
 *
 *   POST /v1/sandbox/test-funds   Idempotency-Key required
 *
 * The funds take the path of a real deposit: a deposit instruction marked `testFunds: true`, a ledger posting, and the
 * `deposit.received` / `deposit.settled` webhooks. When the sandbox runs on a real test network instead of the
 * simulated custodian, the answer is 409 USE_DEVNET_FAUCET: get test USDC from the issuer's public test faucet and
 * send it to the wallet's receiving address.
 */
import type { AxLinkClient } from './client';
import type { Deposit, TestFundsRequest } from './types';

export class SandboxApi {
  constructor(private readonly http: AxLinkClient) {}

  /** Same key and body again returns the original deposit (200) instead of adding funds twice. */
  addTestFunds(body: TestFundsRequest, idempotencyKey: string): Promise<Deposit> {
    return this.http.post('/sandbox/test-funds', body, { idempotencyKey });
  }
}

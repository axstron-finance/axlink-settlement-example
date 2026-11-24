/**
 * Leg A receiving addresses for your own customers ("end users"). `ref` is your customer or account reference; it is
 * kept with the address and reported with every deposit to it.
 *
 *   POST /v1/end-users/{ref}/receiving-details   issue (or return the existing) address for one customer
 *   GET  /v1/end-users                           customers with addresses and balances
 *   GET  /v1/end-users/{ref}                     one customer: addresses, balances, receipts
 *   POST /v1/end-users/{ref}/releases            move a customer's credited deposits into one of your wallets (Idempotency-Key)
 *   GET  /v1/end-users/{ref}/releases            releases of one customer
 *   GET  /v1/end-users/{ref}/releases/{id}       one release
 */
import { seg, type AxLinkClient } from './client';
import type { CreateReleaseRequest, EndUserDetail, EndUserRelease, EndUserSummary, ReceivingDetails } from './types';

export class EndUsersApi {
  constructor(private readonly http: AxLinkClient) {}

  /** `asset`: "USDC" or "USDT" (or the asset ID). Calling again for the same ref returns the same address. */
  receivingDetails(ref: string, asset: string): Promise<ReceivingDetails> {
    return this.http.post(`/end-users/${seg(ref)}/receiving-details`, { asset });
  }

  async list(): Promise<EndUserSummary[]> {
    return (await this.http.get<{ endUsers: EndUserSummary[] }>('/end-users')).endUsers;
  }

  get(ref: string): Promise<EndUserDetail> {
    return this.http.get(`/end-users/${seg(ref)}`);
  }

  /** Asynchronous: 202 PROCESSING, then webhook `end_user.funds.released` or `end_user.release.failed`. */
  createRelease(ref: string, body: CreateReleaseRequest, idempotencyKey: string): Promise<EndUserRelease> {
    return this.http.post(`/end-users/${seg(ref)}/releases`, body, { idempotencyKey });
  }

  async listReleases(ref: string): Promise<EndUserRelease[]> {
    return (await this.http.get<{ releases: EndUserRelease[] }>(`/end-users/${seg(ref)}/releases`)).releases;
  }

  getRelease(ref: string, id: string): Promise<EndUserRelease> {
    return this.http.get(`/end-users/${seg(ref)}/releases/${seg(id)}`);
  }
}

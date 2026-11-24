/**
 * Leg A monitoring and reconciliation for your operations staff.
 *
 *   GET /v1/activity             one feed: deposits, expected deposits, transfers, conversions, withdrawals, failed webhooks
 *   GET /v1/activity/diagnose    "my customer's deposit is missing": what AxLink knows about one transaction hash
 *   GET /v1/receiving-addresses  addresses issued through the API, with your references (?q=reference or address)
 */
import type { AxLinkClient } from './client';
import type { ActivityQuery, ActivityResponse, DiagnoseResponse, ReceivingAddressesResponse } from './types';

export class MonitoringApi {
  constructor(private readonly http: AxLinkClient) {}

  activity(query: ActivityQuery = {}): Promise<ActivityResponse> {
    return this.http.get('/activity', { q: query.q, kind: query.kind, attention: query.attention === undefined ? undefined : String(query.attention), limit: query.limit });
  }

  /** 400 INVALID_TX_HASH when the value is not a transaction hash of the network. */
  diagnose(txHash: string): Promise<DiagnoseResponse> {
    return this.http.get('/activity/diagnose', { txHash });
  }

  receivingAddresses(q?: string): Promise<ReceivingAddressesResponse> {
    return this.http.get('/receiving-addresses', { q });
  }
}

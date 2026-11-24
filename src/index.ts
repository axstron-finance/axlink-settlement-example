/**
 * One object with every API area. Copy this folder into your project, or copy only the modules you need.
 *
 *   const axlink = createAxLink({ apiKey: process.env.AXLINK_API_KEY!, baseUrl: 'https://axlink.appraglobal.com' });
 *   const me = await axlink.institution.me();
 */
import { AxLinkClient, type AxLinkClientOptions } from './client';
import { environmentOfKey } from './config';
import { InstitutionApi } from './institution';
import { WalletsApi } from './wallets';
import { SandboxApi } from './sandbox';
import { DepositsApi } from './deposits';
import { EndUsersApi } from './end-users';
import { CounterpartiesApi } from './counterparties';
import { TransfersApi } from './transfers';
import { ConversionsApi } from './conversions';
import { TreasuryApi } from './treasury';
import { LedgerApi } from './ledger';
import { MonitoringApi } from './monitoring';
import { WebhookEndpointsApi } from './webhook-endpoints';
import { PayoutsApi } from './payouts';
import { PayoutPartnerApi } from './payout-partner';
import { PayoutOrdersApi } from './payout-orders';

export * from './client';
export * from './types';

export function createAxLink(opts: AxLinkClientOptions) {
  const http = new AxLinkClient({ environment: environmentOfKey(opts.apiKey), ...opts });
  return {
    http,
    institution: new InstitutionApi(http),
    wallets: new WalletsApi(http),
    sandbox: new SandboxApi(http),
    deposits: new DepositsApi(http),
    endUsers: new EndUsersApi(http),
    counterparties: new CounterpartiesApi(http),
    transfers: new TransfersApi(http),
    conversions: new ConversionsApi(http),
    treasury: new TreasuryApi(http),
    ledger: new LedgerApi(http),
    monitoring: new MonitoringApi(http),
    webhookEndpoints: new WebhookEndpointsApi(http),
    /** Leg 2, sending bank. */
    payouts: new PayoutsApi(http),
    /** Leg 2, payout partner bank. */
    payoutPartner: new PayoutPartnerApi(http),
    /** Leg C, records only: moves no money. */
    payoutOrders: new PayoutOrdersApi(http),
  };
}

export type AxLink = ReturnType<typeof createAxLink>;

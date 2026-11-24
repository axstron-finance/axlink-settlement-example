/**
 * Leg A wallets and receiving addresses.
 *
 *   POST /v1/wallets                          create a wallet (custody vault) in the key's environment
 *   GET  /v1/wallets                          list
 *   GET  /v1/wallets/{id}                     one wallet with balances
 *   POST /v1/wallets/{id}/settlement-default  the wallet that receives network settlements
 *   POST /v1/custody/deposit-addresses        the wallet's receiving address
 *   GET  /v1/balances                         balances by asset across the environment's wallets
 */
import { seg, type AxLinkClient } from './client';
import type { AssetId, Balances, CreateWalletRequest, DepositAddress, SettlementDefaultResponse, Wallet } from './types';

export class WalletsApi {
  constructor(private readonly http: AxLinkClient) {}

  /** Labels are unique per environment: a second create with the same label is 409 (details.walletId). */
  create(body: CreateWalletRequest): Promise<Wallet> {
    return this.http.post('/wallets', body);
  }

  list(): Promise<Wallet[]> {
    return this.http.get('/wallets');
  }

  get(id: string): Promise<Wallet> {
    return this.http.get(`/wallets/${seg(id)}`);
  }

  setSettlementDefault(id: string): Promise<SettlementDefaultResponse> {
    return this.http.post(`/wallets/${seg(id)}/settlement-default`);
  }

  /** One address receives every supported asset on the wallet's network. 503 ADDRESS_NOT_ISSUED: retry shortly. */
  depositAddress(walletId: string, asset?: AssetId): Promise<DepositAddress> {
    return this.http.post('/custody/deposit-addresses', { walletId, ...(asset ? { asset } : {}) });
  }

  balances(): Promise<Balances> {
    return this.http.get('/balances');
  }
}

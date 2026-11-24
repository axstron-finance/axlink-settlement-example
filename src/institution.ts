/**
 * Account and keys: who am I, supported assets, routes open to you, and the address AxLink sees for your server.
 *
 *   GET /v1/institutions/me
 *   GET /v1/assets
 *   GET /v1/routes
 *   GET /v1/auth/client-ip
 */
import type { AxLinkClient } from './client';
import type { AssetsResponse, ClientIpResponse, InstitutionMe, RoutesResponse } from './types';

export class InstitutionApi {
  constructor(private readonly http: AxLinkClient) {}

  /** The calling institution, its legal name, the key's environment, scopes, legs and Leg 2 roles. */
  me(): Promise<InstitutionMe> {
    return this.http.get('/institutions/me');
  }

  /** Assets and network of the key's environment. Use the returned asset IDs (e.g. USDC_SOL) in every request. */
  assets(): Promise<AssetsResponse> {
    return this.http.get('/assets');
  }

  /** Routes (deposit, transfer, conversion, withdrawal, payout) open to you in this environment, with what is missing. */
  routes(): Promise<RoutesResponse> {
    return this.http.get('/routes');
  }

  /** The IP address AxLink sees for this caller: add it to your API key's IP allowlist. */
  clientIp(): Promise<ClientIpResponse> {
    return this.http.get('/auth/client-ip');
  }
}

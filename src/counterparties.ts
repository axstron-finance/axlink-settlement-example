/**
 * Leg A counterparties: where transfers can go. Either an external address (sandbox: active at once; production:
 * after AxLink approval) or another AxLink institution by its participant slug (settles inside AxLink custody).
 *
 *   POST   /v1/counterparties
 *   GET    /v1/counterparties
 *   GET    /v1/counterparties/{id}
 *   DELETE /v1/counterparties/{id}   disable (re-enabling needs AxLink approval)
 */
import { seg, type AxLinkClient } from './client';
import type { Counterparty, CreateCounterpartyRequest } from './types';

export class CounterpartiesApi {
  constructor(private readonly http: AxLinkClient) {}

  /** Errors to expect: 400 INVALID_ADDRESS / ADDRESS_BLOCKED, 404 PARTICIPANT_NOT_FOUND, 409 COUNTERPARTY_EXISTS. */
  create(body: CreateCounterpartyRequest): Promise<Counterparty & { note: string | null }> {
    return this.http.post('/counterparties', body);
  }

  list(): Promise<Counterparty[]> {
    return this.http.get('/counterparties');
  }

  get(id: string): Promise<Counterparty> {
    return this.http.get(`/counterparties/${seg(id)}`);
  }

  disable(id: string): Promise<void> {
    return this.http.delete(`/counterparties/${seg(id)}`);
  }
}

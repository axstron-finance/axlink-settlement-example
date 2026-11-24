/**
 * Leg A statements: the journal entries that touch your accounts, newest first, cursor-paginated.
 *
 *   GET /v1/ledger/entries   ?limit (1-200) &cursor &asset &entityType &entityId
 */
import type { AxLinkClient } from './client';
import type { LedgerEntries, LedgerEntry, LedgerQuery } from './types';

export class LedgerApi {
  constructor(private readonly http: AxLinkClient) {}

  entries(query: LedgerQuery = {}): Promise<LedgerEntries> {
    return this.http.get('/ledger/entries', { ...query });
  }

  /** Every entry matching the filter, following `nextCursor` until it is null. */
  async *all(query: Omit<LedgerQuery, 'cursor'> = {}): AsyncGenerator<LedgerEntry> {
    let cursor: string | undefined;
    do {
      const page = await this.entries({ ...query, cursor });
      yield* page.entries;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
}

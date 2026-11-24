/**
 * Webhook endpoints (any leg). Each delivery is signed: see webhook-server.ts for verification.
 *
 *   POST   /v1/webhook-endpoints                  register (the secret is returned once)
 *   GET    /v1/webhook-endpoints                  list
 *   DELETE /v1/webhook-endpoints/{id}             disable
 *   GET    /v1/webhook-endpoints/{id}/deliveries  recent deliveries: event, attempts, last HTTP status, next retry
 *
 * At most 10 active endpoints per environment. The URL must be public https.
 */
import { seg, type AxLinkClient } from './client';
import type { CreatedWebhookEndpoint, CreateWebhookEndpointRequest, WebhookDelivery, WebhookEndpoint } from './types';

export class WebhookEndpointsApi {
  constructor(private readonly http: AxLinkClient) {}

  /** Store `secret` in your secret store immediately: it is not shown again. */
  create(body: CreateWebhookEndpointRequest): Promise<CreatedWebhookEndpoint> {
    return this.http.post('/webhook-endpoints', body);
  }

  list(): Promise<WebhookEndpoint[]> {
    return this.http.get('/webhook-endpoints');
  }

  disable(id: string): Promise<void> {
    return this.http.delete(`/webhook-endpoints/${seg(id)}`);
  }

  deliveries(id: string): Promise<WebhookDelivery[]> {
    return this.http.get(`/webhook-endpoints/${seg(id)}/deliveries`);
  }
}

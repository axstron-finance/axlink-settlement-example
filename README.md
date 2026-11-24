# AxLink API: example usage (TypeScript)

A small, self-contained TypeScript project that calls every institution endpoint of the AxLink API (`/api/v1`).
Copy the folder into your own repository, or copy only the modules you need.

- `src/client.ts`: the HTTP client (Bearer auth, `Idempotency-Key` on writes, typed errors, timeouts).
- `src/types.ts`: request and response types, derived from the AxLink OpenAPI schemas.
- One module per API area (`src/wallets.ts`, `src/transfers.ts`, ...), gathered by `createAxLink()` in `src/index.ts`.
- `src/demo.ts`: a guided end-to-end run (`npm run demo`).
- `src/webhook-server.ts`: a webhook receiver that verifies signatures (`npm run webhooks`).

Node.js 18 or later (built-in `fetch`). No runtime dependencies; TypeScript and `tsx` are development tools only.

## Setup

```bash
cd api-example-usage
npm install
cp .env.example .env        # then put your API key in .env
npm run typecheck
```

| Variable | Required | Meaning |
|---|---|---|
| `AXLINK_API_KEY` | yes | Your institution API key, from the AxLink portal (Developers → API keys). |
| `AXLINK_BASE_URL` | no | Default `https://axlink.appraglobal.com`. The client appends `/api/v1`. |
| `AXLINK_TIMEOUT_MS` | no | Per-request timeout, default 30000. |
| `ALLOW_PRODUCTION_WRITES` | no | The demo refuses every write with a production key unless this is `true`. |
| `AXLINK_DEMO_WEBHOOK_URL` | no | Public https URL the demo registers as a webhook endpoint (and deletes again). |
| `AXLINK_WEBHOOK_SECRET` | for `npm run webhooks` | The secret returned once when you created the endpoint. |

## Run the demo

```bash
npm run demo
```

It prints each step: who am I → assets → wallets → sandbox test funds → announce and cancel a deposit → register an
external counterparty (a freshly generated address) → a settlement sent with an idempotency key and polled to a final
status → conversion quote and execute → treasury, a bank account in your institution's legal name, withdrawal preview
and create → ledger → activity → webhook endpoint create and delete → Leg 2 (read-only).

Steps that need a leg your institution does not have in this environment (see `legs` in `/me`) are skipped with a
message. An API error in one step is printed (status, code, message, request id) and the demo continues.

**Safety.** The demo prints the environment it is in. With a production key (`axlk_live_…`), every write is refused
inside the client before it is sent, unless `ALLOW_PRODUCTION_WRITES=true`. A key with an unknown prefix is treated as
production. Read-only calls always run. Use a sandbox key (`axlk_test_…`) for the demo.

## The client

```ts
import { createAxLink } from './src';

const axlink = createAxLink({
  apiKey: process.env.AXLINK_API_KEY!,
  baseUrl: 'https://axlink.appraglobal.com',  // the client appends /api/v1
  timeoutMs: 30_000,
});
```

- Sends `Authorization: Bearer <key>` and `X-AxLink-Environment` (from the key prefix). If the key belongs to the other
  environment, AxLink answers `409 ENVIRONMENT_MISMATCH` instead of acting.
- Sends `Idempotency-Key` on every write: yours when you pass one, a random one otherwise.
- Retries GET requests on network errors, `429` and `5xx` (honouring `Retry-After`). Never retries writes by itself.
- Amounts are decimal strings (`"120.5"`). Do not convert them to floating-point numbers for arithmetic.

## API areas

### Account and keys (`src/institution.ts`)

```ts
const me = await axlink.institution.me();        // institution, legalName, environment, scopes, legs, leg2Roles
const { assets } = await axlink.institution.assets();   // asset IDs to use, e.g. USDC_SOL, USDT_SOL
const { routes } = await axlink.institution.routes();   // what is enabled for you in this environment
const { ip } = await axlink.institution.clientIp();     // add it to your key's IP allowlist
```

### Wallets and receiving addresses (`src/wallets.ts`)

```ts
const wallet = await axlink.wallets.create({ label: 'Main settlement wallet' });
const addr = await axlink.wallets.depositAddress(wallet.id, 'USDC_SOL');  // one address for every supported asset
const balances = await axlink.wallets.balances();
await axlink.wallets.setSettlementDefault(wallet.id);  // receives settlements from other AxLink institutions
```

### Sandbox test funds (`src/sandbox.ts`)

```ts
await axlink.sandbox.addTestFunds({ walletId: wallet.id, asset: 'USDC_SOL', amount: '100' }, 'testfunds-001');
```

Sandbox keys only. If the sandbox answers `409 USE_DEVNET_FAUCET`, it runs on a real test network: get test USDC from
the issuer's public test faucet and send it to the wallet's receiving address.

### Deposits (`src/deposits.ts`)

```ts
const d = await axlink.deposits.announce({ walletId: wallet.id, asset: 'USDC_SOL', amount: '25000', reference: 'TOPUP-001' });
// send exactly 25000 to d.depositAddress; credited at finality, webhook deposit.settled
await axlink.deposits.get(d.id);
await axlink.deposits.list('PENDING');
await axlink.deposits.cancel(d.id);   // only while PENDING
```

### Receiving addresses for your customers (`src/end-users.ts`)

```ts
const r = await axlink.endUsers.receivingDetails('CUST-1042', 'USDC');   // your own customer reference
const customer = await axlink.endUsers.get('CUST-1042');                 // addresses, balances, receipts
await axlink.endUsers.createRelease('CUST-1042', { walletId: wallet.id, asset: 'USDC_SOL', amount: '500' }, 'release-CUST-1042-001');
```

A release is asynchronous: `202 PROCESSING`, then `end_user.funds.released` or `end_user.release.failed`.

### Counterparties (`src/counterparties.ts`)

```ts
const ext = await axlink.counterparties.create({ label: 'Supplier wallet', address: '<external address>' });
const bank = await axlink.counterparties.create({ label: 'Bank B', participant: 'bank-b' });  // another AxLink institution
await axlink.counterparties.disable(ext.id);
```

External counterparties are active at once in the sandbox and after AxLink approval in production.

### Transfers and settlements (`src/transfers.ts`)

```ts
const t = await axlink.transfers.createSettlement(
  { walletId: wallet.id, counterpartyId: bank.id, asset: 'USDC_SOL', amount: '10000', reference: 'INV-2026-001' },
  'INV-2026-001',                       // Idempotency-Key: a retry with the same key never pays twice
);
const status = await axlink.transfers.getSettlement(t.id);   // stage, status, proof
await axlink.transfers.cancel(t.id);                          // only while AWAITING_APPROVAL
```

`POST /v1/transfers` (`transfers.create`) and `POST /v1/settlements` (`transfers.createSettlement`) are the same action.
`status` is `PROCESSING`, `COMPLETED` or `FAILED`; `stage` gives the detail. Production transfers wait for AxLink approval.

### Conversions (`src/conversions.ts`)

```ts
const quote = await axlink.conversions.quote({ fromAsset: 'USDC', toAsset: 'USD', fromAmount: '1000', walletId: wallet.id });
// quote.rate, quote.fee, quote.creditAmount, quote.funding.sufficient, quote.expiresAt
const c = await axlink.conversions.execute({ quoteId: quote.id, idempotencyKey: 'conv-001', walletId: wallet.id });
await axlink.conversions.get(c.id);   // PROCESSING, then COMPLETED (webhook conversion.settled)
```

This endpoint takes its idempotency key in the request body.

### Treasury, bank accounts and withdrawals (`src/treasury.ts`)

```ts
const treasury = await axlink.treasury.get();   // USD/EUR balances, routes, fees
const acct = await axlink.treasury.addBankAccount({
  currency: 'USD', country: 'US', bankName: 'Your Bank', accountName: me.institution.legalName!,  // must be your legal name
  accountNumber: '000123456789', bankCode: 'BANKUS33', scheme: 'ACH',
});
const preview = await axlink.treasury.previewWithdrawal({ bankAccountId: acct.id, amount: '500.00' });  // nothing moves
if (preview.allowed) await axlink.treasury.createWithdrawal({ bankAccountId: acct.id, amount: '500.00', reference: 'WD-001' }, 'WD-001');
```

### Ledger (`src/ledger.ts`)

```ts
const page = await axlink.ledger.entries({ limit: 50, asset: 'USDC_SOL' });
for await (const entry of axlink.ledger.all({ entityId: t.id })) console.log(entry.eventType, entry.lines);
```

### Monitoring (`src/monitoring.ts`)

```ts
await axlink.monitoring.activity({ attention: true });              // what needs attention
await axlink.monitoring.diagnose('<transaction hash>');            // "my customer's deposit is missing"
await axlink.monitoring.receivingAddresses('CUST-1042');
```

### Webhook endpoints (`src/webhook-endpoints.ts`)

```ts
const ep = await axlink.webhookEndpoints.create({ url: 'https://your-bank.example.com/webhooks/axlink', events: ['*'] });
// store ep.secret now: it is shown once
await axlink.webhookEndpoints.deliveries(ep.id);
await axlink.webhookEndpoints.disable(ep.id);
```

### Leg 2: send a payout (`src/payouts.ts`)

For a sending bank (`leg2Roles.sender`). A payout partner bank pays the recipient in local currency.

```ts
const cap = await axlink.payouts.capacity('KES', 'MOBILE_MONEY');
const q = await axlink.payouts.quote({ sendAmount: '1000', fundingAsset: 'USDC', destinationCurrency: 'KES', rail: 'MOBILE_MONEY' });
const p = await axlink.payouts.create({ quoteId: q.id, beneficiary: { name: 'Jane Doe', msisdn: '+254700000000' }, originatorReference: 'PAY-001' }, 'PAY-001');
// send exactly p.funding.amount of p.funding.asset to p.funding.address before p.fundingDeadline
await axlink.payouts.get(p.id);
```

### Leg 2: payout partner (`src/payout-partner.ts`)

For a payout partner bank (`leg2Roles.partner`).

```ts
await axlink.payoutPartner.reportBalance('KES', { verifiedBalance: '5000000.00', asOf: new Date().toISOString() });
await axlink.payoutPartner.confirmHold('KES');
const [instr] = await axlink.payoutPartner.instructions();
await axlink.payoutPartner.accept(instr.instructionId, { amount: instr.amount, currency: instr.currency, reservationReference: 'RES-881' });
// at stage PAY: pay the recipient from your own balance, then
await axlink.payoutPartner.result(instr.instructionId, { status: 'PAID', localReference: 'LOCAL-QX12', amount: instr.amount, currency: instr.currency });
```

Before retrying after a local-rail timeout, look the instruction up (`payoutPartner.instruction(id)`) so the recipient
is never paid twice.

### Leg C: payout orders, records only (`src/payout-orders.ts`)

**A payout order moves no money.** It is a record of a disbursement instruction and is not linked to the Leg 2 payout
flow above. Use Leg 2 to settle value.

```ts
const corridors = await axlink.payoutOrders.corridors();
const order = await axlink.payoutOrders.create(
  { currency: 'KES', amount: '1500.00', method: 'MPESA', recipientName: 'Jane Doe', recipientPhone: '+254700000000' },
  'PO-001',
);
await axlink.payoutOrders.list({ status: 'PENDING' });
```

## Idempotency

Every write that can move value takes an `Idempotency-Key` (8 to 128 characters): transfers and settlements,
withdrawals, payouts, payout orders, customer releases and sandbox test funds. Conversions take `idempotencyKey` in
the body.

- Derive the key from your own reference (`INV-2026-001`), not from a random value, so a retry after a crash or a
  timeout reuses it.
- Same key, same body: the original result comes back (`200` instead of `201`/`202`) and nothing moves twice.
- Same key, different body: `409 IDEMPOTENCY_MISMATCH`.
- After a timeout (`AxLinkTransportError`) you do not know whether the write happened: send it again with the same key.

## Errors

Every non-2xx answer has the body `{ "error": { "code", "message", "requestId", "details"? } }`. The client throws:

```ts
import { AxLinkApiError, AxLinkTransportError } from './src';

try {
  await axlink.transfers.create(body, key);
} catch (e) {
  if (e instanceof AxLinkApiError) {
    // e.status, e.code (stable: branch on it), e.message, e.requestId (quote it to AxLink support), e.details
    if (e.code === 'INSUFFICIENT_BALANCE') { /* ... */ }
  } else if (e instanceof AxLinkTransportError) {
    // e.kind: 'TIMEOUT' | 'NETWORK'. Retry the write with the same Idempotency-Key.
  }
}
```

Common codes: `401` invalid key; `403 FORBIDDEN` (missing scope), `LEG_NOT_ENABLED`, `LEG2_ROLE_NOT_ENABLED`,
`ENVIRONMENT_DISABLED`, `SANDBOX_ONLY`; `404 NOT_FOUND`; `409 ENVIRONMENT_MISMATCH`, `IDEMPOTENCY_MISMATCH`,
`COUNTERPARTY_NOT_ACTIVE`; `422 INSUFFICIENT_BALANCE`, `POLICY_LIMIT`; `429 POLICY_VELOCITY`; `503` (retry later).

## Webhooks

```bash
AXLINK_WEBHOOK_SECRET=whsec_... npm run webhooks   # http://localhost:8787/webhooks/axlink
```

Each delivery carries `X-AxLink-Signature: t=<unix seconds>,v1=<hex>`, where
`v1 = HMAC-SHA256(secret, t + "." + rawBody)`. The receiver in `src/webhook-server.ts`:

1. reads the raw body and verifies before parsing JSON (re-serialising the body breaks the signature);
2. compares with `crypto.timingSafeEqual`;
3. refuses timestamps older than 300 seconds or more than 60 seconds in the future (replay window);
4. answers `200` quickly and deduplicates on the event `id` (the same event can be delivered more than once).

Use `verifyAxLinkSignature(rawBody, header, secret)` from that file in your own framework (with Express, use
`express.raw({ type: 'application/json' })` on the webhook route). The endpoint URL you register must be public https;
put the receiver behind your ingress.

## Sandbox and production

- Same host for both. The API key decides the environment: `axlk_test_…` is the sandbox, `axlk_live_…` is production.
  A key reaches its own environment only.
- The sandbox uses test assets and no real money. Test funds, bank accounts (verified automatically) and withdrawals
  are simulated there.
- In production, external counterparties, transfers and bank accounts wait for AxLink approval or verification.
- Asset IDs (`USDC_SOL`, `USDT_SOL`) are the same in both environments; read them from `GET /v1/assets`.

## Not covered

- Portal and session routes (`/v1/auth/*` sign-in, `/v1/portal/*`, `/v1/onboarding/*`): they use a browser session,
  not an API key. `GET /v1/auth/client-ip` is the exception and is included.
- AxLink staff and operator routes.

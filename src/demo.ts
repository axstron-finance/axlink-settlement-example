/**
 * Guided end-to-end run against the AxLink API: npm run demo
 *
 * me -> assets -> wallets -> sandbox test funds -> announce and cancel a deposit -> external counterparty
 *   -> settlement (idempotent, polled to a final status) -> conversion quote and execute -> treasury, bank account,
 *   withdrawal preview and create -> ledger -> activity -> webhook endpoint create and delete -> Leg 2 (read-only)
 *
 * SAFETY: with a production key (axlk_live_...) every write is refused locally unless ALLOW_PRODUCTION_WRITES=true.
 * A key with an unrecognised prefix is treated as production. Read-only calls always run.
 * Run it with a sandbox key (axlk_test_...): the sandbox uses test assets, no real money.
 */
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config';
import { createAxLink, AxLinkApiError, AxLinkTransportError, WritesBlockedError } from './index';
import type { BankAccount, InstitutionMe, Transfer, Wallet, Deposit, Counterparty } from './types';
import { addDecimal, cmpDecimal, fixDecimal, freshExternalAddress, minDecimal, pollUntil } from './util';
import { isFinal } from './transfers';

const ASSET = 'USDC_SOL' as const;

// ── Output helpers ───────────────────────────────────────────────────────────

let stepNo = 0;
const say = (msg: string) => console.log(`    ${msg}`);
const show = (label: string, value: unknown) => say(`${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
const skip = (reason: string) => say(`skipped: ${reason}`);

function reportError(e: unknown): void {
  if (e instanceof WritesBlockedError) say(`skipped (production safety): ${e.method} ${e.path} was not sent. Set ALLOW_PRODUCTION_WRITES=true to allow writes.`);
  else if (e instanceof AxLinkApiError) say(`API error ${e.status} ${e.code}: ${e.message.replace(/^.*?: /, '')}${e.details ? ` details=${JSON.stringify(e.details)}` : ''}`);
  else if (e instanceof AxLinkTransportError) say(`transport error: ${e.message}`);
  else say(`unexpected error: ${(e as Error)?.message ?? String(e)}`);
}

/** Runs one numbered step; an error is printed and the demo moves on. */
async function step<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
  stepNo++;
  console.log(`\n[${stepNo}] ${title}`);
  try { return await fn(); } catch (e) { reportError(e); return undefined; }
}

// ── The run ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = loadConfig();
  const keyEnv = cfg.environment;
  const production = keyEnv !== 'SANDBOX';
  const writesAllowed = !production || cfg.allowProductionWrites;
  const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex')}`;

  const axlink = createAxLink({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, timeoutMs: cfg.timeoutMs, environment: keyEnv, blockWrites: !writesAllowed });

  console.log('AxLink API demo');
  console.log(`  host:        ${cfg.baseUrl} (requests go to ${cfg.baseUrl.replace(/\/+$/, '')}/api/v1)`);
  console.log(`  environment: ${keyEnv ?? 'UNKNOWN key prefix (treated as PRODUCTION)'}`);
  console.log(`  writes:      ${writesAllowed ? 'enabled' : 'DISABLED (production key; set ALLOW_PRODUCTION_WRITES=true to enable)'}`);
  console.log(`  run id:      ${runId}`);
  if (production && writesAllowed) console.log('  WARNING: production writes are enabled. This run moves real value.');

  // 1. Who am I ----------------------------------------------------------------
  const me = await step('Identify the institution (GET /v1/institutions/me)', async () => {
    const m = await axlink.institution.me();
    show('institution', `${m.institution.slug} (${m.institution.legalName ?? 'legal name not returned'})`);
    show('environment', m.environment);
    show('legs', m.legs ?? 'not returned');
    show('Leg 2 roles', m.leg2Roles ?? 'not returned');
    show('scopes', m.scopes.join(', '));
    return m;
  });
  if (!me) { console.log('\nCannot continue without /me (check AXLINK_API_KEY and AXLINK_BASE_URL).'); process.exitCode = 1; return; }
  if (keyEnv && me.environment !== keyEnv) { console.log(`\nThe key prefix says ${keyEnv} but AxLink answered ${me.environment}. Stopping.`); process.exitCode = 1; return; }

  const legA = me.legs?.A !== false;
  const leg2 = me.legs?.two === true;

  // 2. Assets ------------------------------------------------------------------
  await step('Supported assets (GET /v1/assets)', async () => {
    const a = await axlink.institution.assets();
    for (const x of a.assets) say(`${x.id}  ${x.symbol}  network=${x.network}  decimals=${x.decimals}`);
  });

  if (legA) await legASteps(axlink, me, runId);
  else { stepNo++; console.log(`\n[${stepNo}] Leg A steps (wallets, deposits, transfers, conversion, treasury, ledger)`); skip('Leg A is not enabled for your institution in this environment.'); }

  // Webhook endpoints (any leg) -------------------------------------------------
  await step('Webhook endpoint: create, list deliveries, delete (POST/GET/DELETE /v1/webhook-endpoints)', async () => {
    const url = process.env.AXLINK_DEMO_WEBHOOK_URL || 'https://example.com/axlink-demo-webhook';
    const ep = await axlink.webhookEndpoints.create({ url, events: ['*'] });
    show('endpoint', `${ep.id} ${ep.url} status=${ep.status}`);
    show('secret', `${ep.secret.slice(0, 10)}... (shown once; store it in your secret store)`);
    show('events available', ep.availableEvents.length);
    show('deliveries so far', (await axlink.webhookEndpoints.deliveries(ep.id)).length);
    await axlink.webhookEndpoints.disable(ep.id);
    say('deleted (disabled) again');
  });

  // Leg 2 (read-only here) -----------------------------------------------------
  await step('Leg 2 and Leg C, read-only (payout capacity, payout partner accounts, payout-order corridors)', async () => {
    if (!leg2) return skip('Leg 2 is not enabled for your institution in this environment.');
    if (me.leg2Roles?.sender) {
      const c = await axlink.payouts.capacity('KES');
      show('KES payout capacity', `${c.spendable} across ${c.partners} partner(s)`);
    } else say('not a Leg 2 sender: payouts capacity skipped');
    if (me.leg2Roles?.partner) {
      for (const a of await axlink.payoutPartner.accounts()) say(`payout account ${a.currency}: spendable ${a.spendable}, accepting=${a.acceptingNewAssignments}${a.reason ? ` (${a.reason})` : ''}`);
    } else say('not a Leg 2 payout partner: payout accounts skipped');
    const corridors = await axlink.payoutOrders.corridors();
    show('payout-order corridors (Leg C, records only, no money moves)', corridors.map(c => `${c.currency}:${c.methods.join('/')}`).join(' '));
  });

  console.log('\nDone.');
}

type AxLink = ReturnType<typeof createAxLink>;

async function legASteps(axlink: AxLink, me: InstitutionMe, runId: string): Promise<void> {
  // Wallet ---------------------------------------------------------------------
  const wallet = await step('Wallets (GET /v1/wallets, POST /v1/wallets if none, POST /v1/custody/deposit-addresses)', async () => {
    const wallets = await axlink.wallets.list();
    say(`${wallets.length} wallet(s)`);
    let w: Wallet | undefined = wallets.find(x => x.status === 'ACTIVE');
    if (!w) {
      w = await axlink.wallets.create({ label: `Demo wallet ${runId}` });
      say(`created wallet ${w.id}`);
    }
    show('using wallet', `${w.id} "${w.label}" network=${w.network}`);
    for (const b of w.balances ?? []) say(`balance ${b.asset}: available ${b.available}, pending ${b.pending}`);
    try {
      const addr = await axlink.wallets.depositAddress(w.id, ASSET);
      show('receiving address', `${addr.address} (assets: ${addr.assets.join(', ')})`);
    } catch (e) {
      if (e instanceof AxLinkApiError && e.code === 'ADDRESS_NOT_ISSUED') say('receiving address not issued yet; retry in a few seconds');
      else if (e instanceof WritesBlockedError) say(`receiving address (from the wallet record; the POST was not sent): ${w.depositAddress ?? 'not issued yet'}`);
      else reportError(e); // the wallet is still usable for the next steps
    }
    return w;
  });
  if (!wallet) say('no wallet: the steps that need one are skipped; read-only steps still run.');
  const NO_WALLET = 'needs a wallet.';

  // Sandbox test funds ---------------------------------------------------------
  await step('Add sandbox test funds (POST /v1/sandbox/test-funds)', async () => {
    if (me.environment !== 'SANDBOX') return skip('sandbox only.');
    if (!wallet) return skip(NO_WALLET);
    try {
      const d = await axlink.sandbox.addTestFunds({ walletId: wallet.id, asset: ASSET, amount: '100' }, `demo-testfunds-${runId}`);
      show('test deposit', `${d.id} ${d.status} ${d.receivedAmount ?? d.expectedAmount} ${d.asset}`);
    } catch (e) {
      if (e instanceof AxLinkApiError && e.code === 'USE_DEVNET_FAUCET') {
        say('this sandbox runs on a real test network: get test USDC from the issuer\'s public test faucet and send it to the receiving address above.');
        return;
      }
      throw e;
    }
  });

  // Deposit announce + cancel --------------------------------------------------
  await step('Announce a deposit, then cancel it (POST /v1/deposits, GET /v1/deposits/{id}, POST /v1/deposits/{id}/cancel)', async () => {
    if (!wallet) return skip(NO_WALLET);
    const d: Deposit = await axlink.deposits.announce({ walletId: wallet.id, asset: ASSET, amount: '25', reference: `DEMO-DEP-${runId}`, ttlHours: 1 });
    show('announced', `${d.id} ${d.instructionStatus} expect ${d.expectedAmount} ${d.asset} at ${d.depositAddress ?? '(address pending)'} trackingId=${d.trackingId}`);
    const again = await axlink.deposits.get(d.id);
    show('read back', `${again.id} ${again.instructionStatus}`);
    const c = await axlink.deposits.cancel(d.id);
    show('cancelled', `${c.id} ${c.instructionStatus} (public status ${c.status})`);
  });

  // Counterparty ---------------------------------------------------------------
  const counterparty = await step('Register an external counterparty (POST /v1/counterparties)', async () => {
    const address = freshExternalAddress();
    show('fresh address', address);
    const cp: Counterparty = await axlink.counterparties.create({ label: `Demo external ${runId}`, address, note: 'created by the API example demo' });
    show('counterparty', `${cp.id} ${cp.kind} status=${cp.status}${cp.screening ? ` screening=${cp.screening.verdict}` : ''}`);
    if (cp.status !== 'ACTIVE') say('not ACTIVE yet (production counterparties wait for AxLink approval)');
    return cp;
  });

  // Settlement -----------------------------------------------------------------
  await step('Settlement with an Idempotency-Key, polled to a final status (POST /v1/settlements, GET /v1/settlements/{id})', async () => {
    if (!wallet) return skip(NO_WALLET);
    if (!counterparty || counterparty.status !== 'ACTIVE') return skip('needs an ACTIVE counterparty.');
    const amount = '1';
    const fresh = await axlink.wallets.get(wallet.id);
    const available = fresh.balances?.find(b => b.asset === ASSET)?.available ?? '0';
    if (cmpDecimal(available, amount) < 0) return skip(`wallet holds ${available} ${ASSET} available; ${amount} needed.`);

    const idempotencyKey = `demo-settlement-${runId}`;
    const body = { walletId: wallet.id, counterpartyId: counterparty.id, asset: ASSET, amount, reference: `DEMO-SETTLE-${runId}` };
    const t = await axlink.transfers.createSettlement(body, idempotencyKey);
    show('created', `${t.id} stage=${t.stage} status=${t.status}`);
    // A retry with the same key and body returns the same transfer: nothing is paid twice.
    const replay = await axlink.transfers.createSettlement(body, idempotencyKey);
    show('replay with the same Idempotency-Key', replay.id === t.id ? `same transfer ${replay.id} (not paid twice)` : `DIFFERENT id ${replay.id}`);

    const { value, finished } = await pollUntil(
      () => axlink.transfers.getSettlement(t.id) as Promise<Transfer>,
      isFinal,
      { intervalMs: 3000, timeoutMs: 120_000, key: v => `${v.stage}/${v.status}`, onChange: v => say(`stage=${v.stage} status=${v.status}${v.proof?.finality ? ` finality=${v.proof.finality}` : ''}`) },
    );
    if (finished) show('final', `${value.status}${value.proof?.txHash ? ` tx=${value.proof.txHash}` : ''}${value.reason ? ` reason=${value.reason}` : ''}`);
    else say(`not final after 2 minutes (stage ${value.stage}); keep polling or wait for the transfer.settled webhook.`);
  });

  // Conversion -----------------------------------------------------------------
  await step('Conversion quote and execute (GET /v1/conversions/pairs, POST /v1/conversions/quote, POST /v1/conversions)', async () => {
    const { pairs } = await axlink.conversions.pairs();
    show('pairs', pairs.map(p => `${p.from}->${p.to}`).join(' '));
    if (!pairs.some(p => p.from === 'USDC' && p.to === 'USD')) return skip('USDC->USD is not available.');
    if (!wallet) return skip(NO_WALLET);
    const q = await axlink.conversions.quote({ fromAsset: 'USDC', toAsset: 'USD', fromAmount: '20', walletId: wallet.id });
    show('quote', `${q.id}: ${q.fromAmount} ${q.fromAsset} -> ${q.toAmount} ${q.toAsset} at ${q.rate}; fee ${q.fee.amount} ${q.fee.currency}; credited ${q.creditAmount} to ${q.creditTo}; expires ${q.expiresAt}`);
    if (q.funding && !q.funding.sufficient) return skip(`wallet holds ${q.funding.available} ${q.funding.asset}; not enough to execute.`);
    const c = await axlink.conversions.execute({ quoteId: q.id, idempotencyKey: `demo-conversion-${runId}`, walletId: wallet.id, destinationRef: `DEMO-CONV-${runId}` });
    show('executed', `${c.id} ${c.status}: ${c.statusLabel}`);
    const { value, finished } = await pollUntil(() => axlink.conversions.get(c.id), v => v.status !== 'PROCESSING', { intervalMs: 3000, timeoutMs: 90_000 });
    say(finished ? `final: ${value.status}: ${value.statusLabel}` : 'still settling; the conversion.settled webhook will tell you when the treasury is credited.');
  });

  // Treasury, bank account, withdrawal ---------------------------------------
  await step('Treasury, bank account and withdrawal (GET /v1/treasury, POST /v1/bank-accounts, POST /v1/withdrawals/preview, POST /v1/withdrawals)', async () => {
    const tr = await axlink.treasury.get();
    for (const b of tr.balances) say(`treasury ${b.currency}: balance ${b.balance}, available ${b.available}, settling ${b.conversionsSettling}`);
    for (const r of tr.withdrawalRoutes) say(`withdrawal route ${r.currency}: ${r.enabled ? 'enabled' : `disabled (${r.reason})`}${r.simulated ? ', simulated' : ''}`);

    const legalName = me.institution.legalName;
    if (!legalName) return skip('/me returned no legal name; a bank account must be held in that name.');
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    let acct: BankAccount | undefined = (await axlink.treasury.listBankAccounts()).find(a => a.currency === 'USD' && a.status !== 'REJECTED' && norm(a.accountName) === norm(legalName));
    if (acct) say(`using existing bank account ${acct.id} (${acct.status})`);
    else {
      acct = await axlink.treasury.addBankAccount({ currency: 'USD', country: 'US', bankName: 'Demo Bank', accountName: legalName, accountNumber: '000123456789', bankCode: 'DEMOUS33', scheme: 'ACH' });
      say(`added bank account ${acct.id} ${acct.accountNumber} holder "${acct.accountName}" status=${acct.status}`);
    }

    const usd = tr.balances.find(b => b.currency === 'USD');
    const fee = tr.fees.USD ?? '0';
    // Withdraw a little more than the fee when the balance allows; otherwise preview a nominal amount to show the answer.
    const wanted = addDecimal(fee, '10', 2);
    const amount = usd && cmpDecimal(usd.available, fee) > 0 ? fixDecimal(minDecimal(usd.available, wanted), 2) : '10.00';
    const p = await axlink.treasury.previewWithdrawal({ bankAccountId: acct.id, amount });
    show('preview', `${p.amount} ${p.currency}, fee ${p.fee}, net ${p.netAmount}, available ${p.available}, allowed=${p.allowed}${p.reason ? ` (${p.reason})` : ''}`);
    if (!p.allowed) return skip('the preview says this withdrawal is not allowed now.');
    const w = await axlink.treasury.createWithdrawal({ bankAccountId: acct.id, amount, reference: `DEMO-WD-${runId}` }, `demo-withdrawal-${runId}`);
    show('withdrawal', `${w.id} ${w.status} net ${w.netAmount} ${w.currency}${w.simulated ? ' (simulated)' : ''}`);
    const again = await axlink.treasury.getWithdrawal(w.id);
    show('read back', `${again.status}${again.bankReference ? ` bank reference ${again.bankReference}` : ''}`);
  });

  // Ledger ---------------------------------------------------------------------
  await step('Ledger entries (GET /v1/ledger/entries)', async () => {
    const page = await axlink.ledger.entries({ limit: 5 });
    if (page.entries.length === 0) say('no entries yet');
    for (const e of page.entries) {
      say(`${e.postedAt} ${e.eventType} ${e.entityType}:${e.entityId}`);
      for (const l of e.lines) say(`    ${l.amount.startsWith('-') ? '' : '+'}${l.amount} ${l.asset}  ${l.account}`);
    }
    if (page.nextCursor) say(`more: pass cursor=${page.nextCursor}`);
  });

  // Activity -------------------------------------------------------------------
  await step('Activity feed (GET /v1/activity)', async () => {
    const a = await axlink.monitoring.activity({ limit: 5 });
    show('needing attention', a.attentionCount);
    for (const i of a.items) say(`${i.kind} ${i.id} ${i.amount ?? ''} ${i.asset ?? ''} ${i.statusLabel}${i.attention ? ` ATTENTION: ${i.attention}` : ''}`);
  });
}

main().catch(e => { reportError(e); process.exitCode = 1; });

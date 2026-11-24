/**
 * Request and response types of the AxLink institution API.
 *
 * Derived from `components.schemas` of the AxLink OpenAPI document (Error, InstitutionMe, Asset, Wallet,
 * DepositAddress, Balances, Settlement, Transfer, CreateTransfer, Counterparty, LedgerEntry, LedgerEntries) and from
 * the request bodies of each operation. Where the document describes a response only as "OK", the type follows the
 * fields the API returns today. Amounts are always exact decimal strings: never parse them into floating point for
 * money arithmetic.
 */

export type Environment = 'SANDBOX' | 'PRODUCTION';
/** Asset IDs as the API defines them (GET /v1/assets). */
export type AssetId = 'USDC_SOL' | 'USDT_SOL';
/** Public status shared by deposits, transfers and releases. The detailed stage is in a separate field. */
export type PublicStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';
/** ISO 8601 timestamp. */
export type DateTime = string;
/** Exact decimal amount, e.g. "120.5". */
export type Decimal = string;

// ── Errors ────────────────────────────────────────────────────────────────────

/** schemas.Error */
export interface ErrorEnvelope {
  error: { code: string; message: string; requestId?: string; details?: unknown };
}

// ── Institution ───────────────────────────────────────────────────────────────

export interface EnvironmentAccess {
  status: 'ACTIVE' | 'DISABLED';
  available: boolean;
  readOnly: boolean;
  reason: 'ENVIRONMENT_DISABLED' | 'MFA_REQUIRED' | 'API_KEY_ENVIRONMENT' | null;
}

/** schemas.InstitutionMe, plus `legalName`, `legs` and `leg2Roles`, which the API also returns. */
export interface InstitutionMe {
  institution: { id: string; slug: string; legalName?: string | null };
  /** Legs switched on for this institution in the key's environment. `two` is Leg 2 (payouts). */
  legs?: { A: boolean; two: boolean };
  /** Leg 2 roles in this environment: `sender` funds payouts, `partner` pays recipients locally. */
  leg2Roles?: { partner: boolean; sender: boolean };
  environment: Environment;
  environments?: Record<Environment, EnvironmentAccess>;
  scopes: string[];
  /** Alias of `scopes`. */
  permissions: string[];
}

/** schemas.Asset */
export interface Asset {
  id: AssetId;
  symbol: string;
  network: string;
  contract: string;
  decimals: number;
  issuer?: string;
}

export interface Network { id: string; family: string; finality: string }
export interface AssetsResponse { assets: Asset[]; networks: Network[] }

export interface RouteStatus {
  id: string;
  kind: string;
  label: string;
  from: string;
  to: string;
  enabled: boolean;
  verified: boolean;
  missing: { kind: string; check: string; detail: string }[];
}
export interface RoutesResponse { routes: RouteStatus[] }

export interface ClientIpResponse { ip: string; forwardedFor: string[]; trustedProxyHops: number }

// ── Wallets ───────────────────────────────────────────────────────────────────

export interface WalletBalance { asset: AssetId; available: Decimal; pending: Decimal; updatedAt?: DateTime }

/** schemas.Wallet */
export interface Wallet {
  id: string;
  label: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  network: string;
  custody: { provider: string; vaultId: string };
  /** One address receives every supported asset on the wallet's network. */
  depositAddress: string | null;
  balances: WalletBalance[];
  createdAt: DateTime;
}

export interface CreateWalletRequest { label: string; network?: string }

/** schemas.DepositAddress */
export interface DepositAddress {
  walletId: string;
  network: string;
  address: string;
  assets: AssetId[];
  custody: { provider: string; vaultId: string };
  note?: string;
}

export interface SettlementDefaultResponse { settlementWalletId: string; environment: Environment }

/** schemas.Balances */
export interface Balances {
  institutionId: string;
  asOf: DateTime;
  balances: { asset: AssetId; symbol: string; network: string; available: Decimal; wallets: { walletId: string; available: Decimal }[] }[];
}

// ── Deposits ──────────────────────────────────────────────────────────────────

export type DepositInstructionStatus = 'PENDING' | 'RECEIVED' | 'SETTLED' | 'CANCELLED' | 'EXPIRED';

/** schemas.Settlement (a deposit instruction). */
export interface Deposit {
  id: string;
  kind: 'DEPOSIT';
  status: PublicStatus;
  instructionStatus: DepositInstructionStatus;
  walletId: string;
  asset: AssetId;
  expectedAmount: Decimal;
  receivedAmount: Decimal | null;
  reference: string | null;
  /** Put this in the transfer's external id when your sending system allows it. */
  trackingId: string;
  depositAddress: string | null;
  expiresAt: DateTime;
  receivedAt: DateTime | null;
  settledAt: DateTime | null;
  createdAt?: DateTime;
  proof: {
    custodyTxId: string | null;
    txHash: string | null;
    explorerUrl: string | null;
    finality: 'CUSTODY_CONFIRMED' | 'ON_CHAIN_FINALIZED' | 'SANDBOX_SIMULATED';
  } | null;
  attention: { at: DateTime; reason: string } | null;
  /** Sandbox test funds (POST /v1/sandbox/test-funds). */
  testFunds?: boolean;
}

export interface AnnounceDepositRequest {
  walletId: string;
  asset: AssetId;
  amount: Decimal;
  reference?: string;
  /** 1 to 720, default 72. */
  ttlHours?: number;
}

export interface TestFundsRequest { walletId: string; asset: AssetId; amount: Decimal }

// ── Counterparties and transfers ──────────────────────────────────────────────

/** schemas.Counterparty */
export interface Counterparty {
  id: string;
  label: string;
  kind: 'EXTERNAL' | 'NETWORK';
  network: string;
  address: string | null;
  participant: string | null;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'DISABLED';
  approvedAt: DateTime | null;
  custodyWhitelisted: boolean;
  note: string | null;
  screening: { verdict: 'CLEAR' | 'REVIEW' | 'BLOCKED'; provider: string; at: DateTime } | null;
  createdAt: DateTime;
}

/** Exactly one of `address` (an external address) or `participant` (another AxLink institution's slug). */
export type CreateCounterpartyRequest =
  | { label: string; address: string; participant?: never; network?: string; note?: string }
  | { label: string; participant: string; address?: never; network?: string; note?: string };

export type TransferStage =
  | 'AWAITING_APPROVAL' | 'APPROVED' | 'SUBMITTING' | 'SUBMITTED' | 'CONFIRMED' | 'UNDER_REVIEW'
  | 'SETTLED' | 'FAILED' | 'REJECTED' | 'CANCELLED';

/** schemas.Transfer */
export interface Transfer {
  id: string;
  kind: 'TRANSFER';
  status: PublicStatus;
  stage: TransferStage;
  walletId: string;
  counterparty: { id: string; label?: string; address?: string; network?: string };
  asset: AssetId;
  amount: Decimal;
  reference: string | null;
  idempotencyKey: string;
  approval: { required: boolean; by?: string | null; at?: DateTime } | null;
  proof: {
    custodyTxId: string | null;
    txHash: string | null;
    explorerUrl: string | null;
    finality: 'PENDING' | 'CUSTODY_CONFIRMED' | 'UNDER_REVIEW' | 'ON_CHAIN_FINALIZED' | 'SANDBOX_SIMULATED' | 'OPERATOR_ATTESTED';
    slot?: string | null;
  } | null;
  attention?: boolean;
  reason?: string;
  submittedAt: DateTime | null;
  confirmedAt: DateTime | null;
  settledAt: DateTime | null;
  createdAt: DateTime;
}

/** schemas.CreateTransfer */
export interface CreateTransferRequest {
  walletId: string;
  counterpartyId: string;
  asset: AssetId;
  amount: Decimal;
  /** Up to 140 characters. */
  reference?: string;
}

// ── End users (receiving addresses for your customers) ────────────────────────

export interface ReceivingDetails {
  endUserRef: string;
  endUserId: string;
  destinationId: string;
  network: string;
  status: string;
  address: string | null;
  memo: string | null;
  assets: AssetId[];
  asset?: AssetId;
}

export type EndUserBalances = Record<string, { available: Decimal; pending: Decimal; ledger: Decimal }>;

export interface EndUserSummary {
  endUserRef: string;
  endUserId: string;
  createdAt: DateTime;
  destinations: ReceivingDetails[];
  balances: EndUserBalances;
}

export interface EndUserReceipt {
  id: string;
  asset: AssetId;
  network: string;
  amount: Decimal;
  status: 'RECEIVED' | 'CREDITED' | 'REJECTED' | string;
  statusLabel: string;
  custodyTxId: string | null;
  txHash: string | null;
  reason: string | null;
  receivedAt: DateTime;
  creditedAt: DateTime | null;
}

export interface EndUserDetail {
  endUserRef: string;
  endUserId: string;
  destinations: ReceivingDetails[];
  balances: EndUserBalances;
  receipts: EndUserReceipt[];
}

export interface CreateReleaseRequest { walletId: string; asset: AssetId; amount: Decimal }

export interface EndUserRelease {
  id: string;
  releaseId: string;
  kind: 'END_USER_RELEASE';
  endUserRef: string;
  walletId: string;
  asset: AssetId;
  network: string;
  amount: Decimal;
  status: PublicStatus;
  stage: 'AUTHORIZED' | 'SUBMITTING' | 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'UNDER_REVIEW';
  finality: 'ON_CHAIN_FINALIZED' | 'SANDBOX_SIMULATED' | 'OPERATOR_ATTESTED' | null;
  custodyTxId: string | null;
  txHash: string | null;
  explorerUrl: string | null;
  reason?: string;
  attention?: boolean;
  idempotencyKey: string;
  createdAt: DateTime;
  completedAt: DateTime | null;
}

// ── Conversions ───────────────────────────────────────────────────────────────

export interface ConversionPairsResponse { pairs: { from: string; to: string }[] }

export interface ConversionQuoteRequest {
  /** e.g. "USDC" */
  fromAsset: string;
  /** e.g. "USD" */
  toAsset: string;
  fromAmount: Decimal;
  /** The wallet the stablecoin comes from: the quote then says whether it holds enough (`funding`). */
  walletId?: string;
}

export interface ConversionQuote {
  id: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: Decimal;
  toAmount: Decimal;
  rate: Decimal;
  axlinkMarkupBps: number;
  expiresAt: DateTime;
  simulated: boolean;
  rateSource: 'LIVE' | 'SANDBOX_TEST_RATE';
  rateReason: string | null;
  fee: { amount: Decimal; currency: string };
  creditAmount: Decimal;
  creditTo: 'TREASURY' | 'WALLET';
  funding: { walletId: string; asset: string; available: Decimal; sufficient: boolean } | null;
}

export interface ExecuteConversionRequest {
  quoteId: string;
  /** Required, in the body (not a header) for this endpoint. Up to 128 characters. */
  idempotencyKey: string;
  walletId: string;
  destinationRef?: string;
}

export interface Conversion {
  id: string;
  fromAsset: string;
  toAsset: string;
  fromAmount: Decimal;
  toAmount: Decimal;
  rate: Decimal;
  feeAmount: Decimal;
  feeCurrency: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | string;
  simulated: boolean;
  creditTo: 'TREASURY' | 'WALLET' | null;
  creditAmount: Decimal | null;
  statusLabel: string;
  queueReason: string | null;
  settlementTxHash: string | null;
  quoteId: string;
  walletId: string | null;
  destinationRef: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  settledAt: DateTime | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export interface ConversionList { items: Conversion[]; nextCursor: string | null }

// ── Treasury, bank accounts, withdrawals ──────────────────────────────────────

export type FiatCurrency = 'USD' | 'EUR';

export interface TreasuryBalance {
  currency: FiatCurrency;
  balance: Decimal;
  available: Decimal;
  withdrawalsInFlight: Decimal;
  conversionsSettling: Decimal;
}

export interface BankAccount {
  id: string;
  currency: FiatCurrency;
  country: string;
  bankName: string;
  accountName: string;
  /** Masked. */
  accountNumber: string;
  bankCode: string | null;
  scheme: BankScheme;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'REJECTED' | string;
  verification: { at?: DateTime; by?: string; note: string | null } | null;
  environment: Environment;
  createdAt: DateTime;
}

export type BankScheme = 'RTGS' | 'SIBS' | 'SWIFT' | 'SEPA' | 'ACH' | 'LOCAL';

export interface CreateBankAccountRequest {
  currency: FiatCurrency;
  /** ISO 3166-1 alpha-2. */
  country: string;
  bankName: string;
  /** Must equal your institution's legal name (GET /v1/institutions/me -> institution.legalName). */
  accountName: string;
  /** Account number or IBAN. */
  accountNumber: string;
  /** SWIFT/BIC or local bank code. */
  bankCode?: string;
  scheme: BankScheme;
}

export interface Withdrawal {
  id: string;
  status: 'REQUESTED' | 'PROCESSING' | 'PAID' | 'FAILED' | string;
  currency: FiatCurrency;
  amount: Decimal;
  fee: Decimal;
  netAmount: Decimal;
  reference: string;
  bankAccount: { id: string; bankName?: string; accountNumber?: string; scheme?: string; country?: string };
  simulated: boolean;
  bankReference: string | null;
  failureMessage: string | null;
  paidAt: DateTime | null;
  createdAt: DateTime;
}

export interface Treasury {
  environment: Environment;
  balances: TreasuryBalance[];
  bankAccounts: BankAccount[];
  withdrawals: Withdrawal[];
  withdrawalRoutes: { currency: string; enabled: boolean; simulated: boolean; reason: string | null }[];
  fees: Record<FiatCurrency, Decimal>;
}

export interface WithdrawalPreviewRequest { bankAccountId: string; /** At most 2 decimals. */ amount: Decimal }

export interface WithdrawalPreview {
  currency: FiatCurrency;
  amount: Decimal;
  fee: Decimal;
  netAmount: Decimal;
  available: Decimal;
  bankAccount: BankAccount;
  allowed: boolean;
  reason: string | null;
  simulated: boolean;
}

export interface CreateWithdrawalRequest {
  bankAccountId: string;
  /** At most 2 decimals. */
  amount: Decimal;
  /** 2 to 60 characters, shown on the bank transfer. */
  reference: string;
}

// ── Ledger ────────────────────────────────────────────────────────────────────

/** schemas.LedgerEntry */
export interface LedgerEntry {
  id: string;
  postedAt: DateTime;
  eventType: string;
  entityType: string;
  entityId: string;
  narrative: string;
  reversesId: string | null;
  /** Only the lines on accounts your institution owns. `amount` is signed: positive = debit. */
  lines: { account: string; asset: string; amount: Decimal; memo: string | null }[];
}

/** schemas.LedgerEntries */
export interface LedgerEntries { entries: LedgerEntry[]; nextCursor: string | null }

export interface LedgerQuery {
  /** 1 to 200, default 50. */
  limit?: number;
  cursor?: string;
  asset?: AssetId;
  entityType?: string;
  entityId?: string;
}

// ── Monitoring ────────────────────────────────────────────────────────────────

export type ActivityKind = 'DEPOSIT' | 'EXPECTED_DEPOSIT' | 'TRANSFER' | 'CONVERSION' | 'WITHDRAWAL' | 'WEBHOOK';

export interface ActivityItem {
  kind: ActivityKind;
  id: string;
  reference: string | null;
  asset: string | null;
  network: string | null;
  amount: string | null;
  status: string;
  statusLabel: string;
  /** What needs attention, in one sentence; null when nothing does. */
  attention: string | null;
  txHash?: string | null;
  createdAt: DateTime;
  updatedAt?: DateTime | null;
}

export interface ActivityResponse {
  items: ActivityItem[];
  attentionCount: number;
  balances: { customerDeposits: Record<string, { credited: Decimal; confirming: Decimal }> };
}

export interface ActivityQuery { q?: string; kind?: ActivityKind; attention?: boolean; /** up to 200 */ limit?: number }

export interface DiagnoseResponse {
  txHash: string;
  found: boolean;
  item?: ActivityItem;
  steps: { detectedByAxLink: boolean; networkConfirmed: boolean | null; ledgerCredited: boolean } | null;
  customerReference?: string;
  answer?: string;
}

export interface ReceivingAddressesResponse {
  addresses: { reference: string; address: string | null; network: string; status: string; createdAt: DateTime }[];
}

// ── Webhook endpoints ─────────────────────────────────────────────────────────

export interface WebhookEndpoint { id: string; url: string; events: string[]; status: 'ACTIVE' | 'DISABLED'; createdAt: DateTime }

export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  /** Shown once. Store it in your secret store; it verifies X-AxLink-Signature. */
  secret: string;
  note: string;
  availableEvents: string[];
}

export interface CreateWebhookEndpointRequest {
  /** Public https URL. */
  url: string;
  /** Event types, or ["*"] for all (the default). */
  events?: string[];
}

export interface WebhookDelivery {
  id: string;
  type: string;
  status: 'PENDING' | 'DELIVERING' | 'DELIVERED' | 'FAILED' | 'ABANDONED';
  attempts: number;
  lastStatus: number | null;
  nextAttemptAt: DateTime | null;
  entityType: string;
  entityId: string;
  createdAt: DateTime;
}

// ── Leg 2: payouts (sending bank) ─────────────────────────────────────────────

export type PayoutRail = 'BANK_TRANSFER' | 'MOBILE_MONEY';

export interface PayoutCapacity { currency: string; rail: PayoutRail | null; spendable: Decimal; partners: number }

export interface PayoutQuoteRequest {
  sendAmount: Decimal;
  /** Default USDC. */
  fundingAsset?: 'USDC' | 'USDT';
  /** e.g. "KES" */
  destinationCurrency: string;
  rail: PayoutRail;
}

export type PayoutStatus =
  | 'QUOTED' | 'AWAITING_FUNDING' | 'FUNDING_RECEIVED' | 'FUNDING_CONFIRMED' | 'SETTLING' | 'PARTNER_SETTLEMENT_RECEIVED'
  | 'INSTRUCTED' | 'BENEFICIARY_PAID' | 'COMPLETED'
  | 'EXPIRED' | 'FUNDING_EXPIRED' | 'FUNDING_SHORT' | 'PAYOUT_FAILED' | 'REFUNDED';

export interface Payout {
  id: string;
  status: PayoutStatus;
  queueReason: string | null;
  /** Send exactly `funding.amount` of `funding.asset` to `funding.address`. */
  funding: { asset: string; network: string; amount: Decimal; principal: Decimal; address: string | null; trackingId: string | null };
  fees: { axlink: Decimal; partner: Decimal; currency: string; chargedSeparately: boolean };
  rate: { reference: Decimal; source: string; at: DateTime; partnerFxMarginBps: number; applied: Decimal; executedBy: string };
  receive: { amount: Decimal; currency: string; rail: PayoutRail };
  economics: unknown;
  beneficiary: PayoutBeneficiary | null;
  originatorReference: string | null;
  quoteExpiresAt: DateTime;
  fundingDeadline: DateTime | null;
  steps: {
    fundingConfirmedAt: DateTime | null;
    partnerSettlementAt: DateTime | null;
    instructedAt: DateTime | null;
    beneficiaryPaidAt: DateTime | null;
    completedAt: DateTime | null;
    localReference: string | null;
  };
  createdAt: DateTime;
}

/** `msisdn` (mobile money) or `accountNumber` (bank) is required. */
export interface PayoutBeneficiary { name: string; msisdn?: string; accountNumber?: string; bankCode?: string }

export interface CreatePayoutRequest { quoteId: string; beneficiary: PayoutBeneficiary; originatorReference?: string }

// ── Leg 2: payout partner ─────────────────────────────────────────────────────

export interface PayoutAccount {
  payoutAccountId: string;
  institutionId: string;
  currency: string;
  rails: PayoutRail[];
  pausedRails: PayoutRail[];
  status: string;
  verifiedBalance: Decimal;
  balanceSource: string;
  balanceUpdatedAt: DateTime;
  stale: boolean;
  committed: Decimal;
  quoted: Decimal;
  protectedReserve: Decimal;
  activationMinimum: Decimal;
  spendable: Decimal;
  fundingModel: string;
  holdConfirmed: boolean;
  policy: { activationMinimum: Decimal; protectedReserve: Decimal; note: string };
  acceptingNewAssignments: boolean;
  reason: string | null;
}

export interface ReportBalanceRequest { /** At most 2 decimals. */ verifiedBalance: Decimal; /** When the balance was true; send it if you report asynchronously. */ asOf?: DateTime }

export type InstructionStage = 'ACCEPT_REQUESTED' | 'ACCEPTED_AWAITING_SETTLEMENT' | 'PAY' | 'PAID' | 'FAILED';

export interface PayoutInstruction {
  instructionId: string;
  movementId: string;
  version: number;
  stage: InstructionStage;
  reservation: { required: { amount: Decimal; currency: string }; acceptedAt: DateTime | null; reference: string | null };
  amount: Decimal;
  currency: string;
  method: PayoutRail;
  beneficiary: PayoutBeneficiary | null;
  originatorReference: string | null;
  settlement: { asset: string; amount: Decimal | null; principal: Decimal; partnerFee: Decimal; txHash: string | null };
  status: string;
  localReference: string | null;
  resultSource?: string | null;
  offeredAt: DateTime | null;
  instructedAt: DateTime | null;
  beneficiaryPaidAt?: DateTime | null;
}

export interface AcceptInstructionRequest { amount: Decimal; currency: string; reservationReference: string }
export interface AcceptInstructionResponse { instructionId: string; stage: InstructionStage; reservationReference: string; acceptedAt: DateTime }

export interface InstructionResultRequest {
  status: 'PAID' | 'FAILED';
  /** Required for PAID: your local rail reference. */
  localReference?: string;
  amount?: Decimal;
  currency?: string;
  paidAt?: DateTime;
  reason?: string;
}
export interface InstructionResultResponse { instructionId: string; status: string; localReference: string | null }

// ── Leg C: payout orders (records only; no money moves) ───────────────────────

export type PayoutOrderMethod = 'MPESA' | 'MTN_MOMO' | 'AIRTEL_MONEY' | 'BANK_TRANSFER' | 'WAVE' | 'ORANGE_MONEY';
export type PayoutOrderStatus = 'PENDING' | 'SENT' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface PayoutOrder {
  id: string;
  /** e.g. PO-KES-00042 */
  reference: string;
  status: PayoutOrderStatus;
  currency: string;
  amount: Decimal;
  method: PayoutOrderMethod;
  recipientName: string;
  recipientPhone: string | null;
  accountNumber: string | null;
  bankCode: string | null;
  accountName: string | null;
  transferId: string | null;
  partnerRef: string | null;
  providerReceipt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  sentAt: DateTime | null;
  completedAt: DateTime | null;
  createdAt: DateTime;
  updatedAt: DateTime;
}

export interface CreatePayoutOrderRequest {
  /** Three-letter code, e.g. KES. */
  currency: string;
  /** Greater than zero, at most 2 decimals. */
  amount: Decimal;
  method: PayoutOrderMethod;
  recipientName: string;
  /** Required for mobile-money methods. */
  recipientPhone?: string;
  /** Required for BANK_TRANSFER. */
  accountNumber?: string;
  bankCode?: string;
  accountName?: string;
  /** Your own reference to the settlement behind this order; one order per value. */
  transferId?: string;
}

export interface PayoutOrderList { items: PayoutOrder[]; nextCursor: string | null }
export interface PayoutOrderQuery { status?: PayoutOrderStatus; currency?: string; limit?: number; cursor?: string }

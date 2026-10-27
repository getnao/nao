import { and, count, eq, gte, lt, sql } from 'drizzle-orm';

import s, {
	type DBCreditLedger,
	type DBCreditWallet,
	type DBManagedAiUsage,
	type NewCreditLedger,
	type NewManagedAiUsage,
} from '../db/abstractSchema';
import { db, type DBTransaction, type Lockable } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { CreditGrantType } from '../types/managed-ai-usage';
import { ManagedCreditsExhaustedError } from '../utils/error';

export interface CreditPurchase {
	checkoutSessionId: string;
	paymentIntentId: string;
	invoiceId: string | null;
	orgId: string;
	initiatingUserId: string;
	creditAmountCents: number;
	platformFeeCents: number;
	walletAmountMicroUsd: number;
	taxAmountCents: number;
	totalAmountCents: number;
}

export interface CreditPurchaseMovement {
	paymentIntentId: string;
	movementGroupId: string;
	targetDeltaMicroUsd: number;
	idempotencyKey: string;
	externalReference: string;
	entryType: 'refund' | 'adjustment';
	metadata?: Record<string, unknown>;
}

export interface CreditGrant {
	grantType: CreditGrantType;
	orgId: string;
	idempotencyKey: string;
	userId?: string;
	projectId?: string;
}

export interface BackofficeCreditTopUp {
	orgId: string;
	amountMicroUsd: number;
	requestId: string;
	grantedBy: string;
	reason: string;
}

type LedgerEntry = Omit<
	NewCreditLedger,
	'id' | 'walletId' | 'balanceAfterMicroUsd' | 'transactionSequence' | 'createdAt'
>;

export async function issueCreditGrant(input: CreditGrant): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((transaction) => issueSqliteCreditGrant(transaction, input), { behavior: 'immediate' });
	}
	return db.transaction((transaction) => issuePostgresCreditGrant(transaction, input));
}

export async function issueCreditPurchase(purchase: CreditPurchase): Promise<boolean> {
	return appendOrganizationLedgerEntry(purchase.orgId, creditPurchaseEntry(purchase));
}

export async function issueBackofficeCreditTopUp(topUp: BackofficeCreditTopUp): Promise<boolean> {
	return appendOrganizationLedgerEntry(topUp.orgId, backofficeCreditTopUpEntry(topUp));
}

export async function setCreditPurchaseMovement(input: CreditPurchaseMovement): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((transaction) => setSqliteCreditPurchaseMovement(transaction, input), {
			behavior: 'immediate',
		});
	}
	return db.transaction((transaction) => setPostgresCreditPurchaseMovement(transaction, input));
}

export async function releaseStaleManagedAiCreditReservations(cutoff: Date): Promise<number> {
	const reservations = await db
		.select({ id: s.creditLedger.id })
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.entryType, 'reservation'), lt(s.creditLedger.createdAt, cutoff)))
		.execute();
	let released = 0;
	for (const reservation of reservations) {
		if (await releaseManagedAiCreditReservation(reservation.id)) {
			released += 1;
		}
	}
	return released;
}

export async function reserveManagedAiCredits(
	orgId: string,
	operationId: string,
	reservationMicroUsd: number,
): Promise<void> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => reserveSqliteManagedAiCredits(transaction, orgId, operationId, reservationMicroUsd),
			{ behavior: 'immediate' },
		);
	}
	await db.transaction((transaction) =>
		reservePostgresManagedAiCredits(transaction, orgId, operationId, reservationMicroUsd),
	);
}

export async function recordUnbilledManagedAiUsage(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged' | 'customerChargeMicroUsd'>,
): Promise<DBManagedAiUsage | null> {
	const values = {
		...usage,
		walletId: null,
		isManaged: true,
		customerChargeMicroUsd: 0,
	};
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.insert(s.managedAiUsage).values(values).onConflictDoNothing().returning().get() ?? null;
	}
	const [created] = await db.insert(s.managedAiUsage).values(values).onConflictDoNothing().returning().execute();
	return created ?? null;
}

export async function recordManagedAiUsageAndChargeWallet(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	customerChargeMicroUsd: number,
	billedOrgId: string,
): Promise<DBManagedAiUsage | null> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => settleSqliteManagedAiUsage(transaction, usage, customerChargeMicroUsd, billedOrgId),
			{ behavior: 'immediate' },
		);
	}
	return db.transaction((transaction) =>
		settlePostgresManagedAiUsage(transaction, usage, customerChargeMicroUsd, billedOrgId),
	);
}

async function appendOrganizationLedgerEntry(orgId: string, entry: LedgerEntry): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const wallet = ensureSqliteWallet(transaction, orgId);
				return appendSqliteLedgerEntry(transaction, wallet.id, entry);
			},
			{ behavior: 'immediate' },
		);
	}
	return db.transaction(async (transaction) => {
		const wallet = await ensurePostgresWallet(transaction, orgId);
		return appendPostgresLedgerEntry(transaction, wallet.id, entry);
	});
}

function issueSqliteCreditGrant(transaction: DBTransaction, input: CreditGrant): boolean {
	const policy = transaction
		.select()
		.from(s.creditGrantPolicy)
		.where(eq(s.creditGrantPolicy.grantType, input.grantType))
		.get();
	if (!policy) {
		throw new Error(`Credit grant policy ${input.grantType} is not configured.`);
	}
	if (!policy.enabled) {
		return false;
	}
	validateGrantPolicy(policy.amountMicroUsd, policy.maxGrantsPerOrg, input.grantType);
	const wallet = ensureSqliteWallet(transaction, input.orgId);
	if (
		policy.maxGrantsPerOrg !== null &&
		countSqliteGrants(transaction, wallet.id, input.grantType) >= policy.maxGrantsPerOrg
	) {
		return false;
	}
	return appendSqliteLedgerEntry(transaction, wallet.id, creditGrantEntry(input, policy.amountMicroUsd));
}

async function issuePostgresCreditGrant(transaction: DBTransaction, input: CreditGrant): Promise<boolean> {
	const [policy] = await transaction
		.select()
		.from(s.creditGrantPolicy)
		.where(eq(s.creditGrantPolicy.grantType, input.grantType))
		.limit(1)
		.execute();
	if (!policy) {
		throw new Error(`Credit grant policy ${input.grantType} is not configured.`);
	}
	if (!policy.enabled) {
		return false;
	}
	validateGrantPolicy(policy.amountMicroUsd, policy.maxGrantsPerOrg, input.grantType);
	const wallet = await ensurePostgresWallet(transaction, input.orgId, true);
	if (
		policy.maxGrantsPerOrg !== null &&
		(await countPostgresGrants(transaction, wallet.id, input.grantType)) >= policy.maxGrantsPerOrg
	) {
		return false;
	}
	return appendPostgresLedgerEntry(transaction, wallet.id, creditGrantEntry(input, policy.amountMicroUsd));
}

function setSqliteCreditPurchaseMovement(transaction: DBTransaction, input: CreditPurchaseMovement): boolean {
	const purchase = transaction
		.select()
		.from(s.creditLedger)
		.where(
			and(eq(s.creditLedger.entryType, 'purchase'), eq(s.creditLedger.externalReference, input.paymentIntentId)),
		)
		.get();
	if (!purchase?.walletId) {
		throw new Error(`Credit purchase for PaymentIntent ${input.paymentIntentId} was not found.`);
	}
	const wallet = getSqliteWallet(transaction, purchase.walletId);
	const linkedEntries = transaction
		.select()
		.from(s.creditLedger)
		.where(eq(s.creditLedger.walletId, wallet.id))
		.all()
		.filter((entry) => isCreditPurchaseMovementFor(entry, input.paymentIntentId));
	const deltaMicroUsd = calculatePurchaseMovementDelta(
		purchase.deltaMicroUsd,
		linkedEntries,
		input.movementGroupId,
		input.targetDeltaMicroUsd,
	);
	return appendSqliteLedgerEntry(transaction, wallet.id, creditPurchaseMovementEntry(input, deltaMicroUsd));
}

async function setPostgresCreditPurchaseMovement(
	transaction: DBTransaction,
	input: CreditPurchaseMovement,
): Promise<boolean> {
	const [purchase] = await transaction
		.select()
		.from(s.creditLedger)
		.where(
			and(eq(s.creditLedger.entryType, 'purchase'), eq(s.creditLedger.externalReference, input.paymentIntentId)),
		)
		.limit(1)
		.execute();
	if (!purchase?.walletId) {
		throw new Error(`Credit purchase for PaymentIntent ${input.paymentIntentId} was not found.`);
	}
	const wallet = await getPostgresWallet(transaction, purchase.walletId, true);
	const linkedEntries = await transaction
		.select()
		.from(s.creditLedger)
		.where(eq(s.creditLedger.walletId, wallet.id))
		.execute();
	const deltaMicroUsd = calculatePurchaseMovementDelta(
		purchase.deltaMicroUsd,
		linkedEntries.filter((entry) => isCreditPurchaseMovementFor(entry, input.paymentIntentId)),
		input.movementGroupId,
		input.targetDeltaMicroUsd,
	);
	return appendPostgresLedgerEntry(transaction, wallet.id, creditPurchaseMovementEntry(input, deltaMicroUsd));
}

async function releaseManagedAiCreditReservation(reservationId: string): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction((transaction) => releaseSqliteManagedAiCreditReservation(transaction, reservationId), {
			behavior: 'immediate',
		});
	}
	return db.transaction((transaction) => releasePostgresManagedAiCreditReservation(transaction, reservationId));
}

function releaseSqliteManagedAiCreditReservation(transaction: DBTransaction, reservationId: string): boolean {
	const reservation = transaction
		.select()
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.id, reservationId), eq(s.creditLedger.entryType, 'reservation')))
		.get();
	if (!reservation?.walletId) {
		return false;
	}
	const releasedAmount = -reservation.deltaMicroUsd;
	validatePositiveAmount(releasedAmount, 'Managed AI reservation release');
	if (
		!appendSqliteLedgerEntry(
			transaction,
			reservation.walletId,
			reservationReleaseEntry(reservation, releasedAmount),
		)
	) {
		return false;
	}
	transaction
		.update(s.creditLedger)
		.set({ entryType: 'adjustment', metadata: { ...reservation.metadata, released: true } })
		.where(and(eq(s.creditLedger.id, reservation.id), eq(s.creditLedger.entryType, 'reservation')))
		.run();
	return true;
}

async function releasePostgresManagedAiCreditReservation(
	transaction: DBTransaction,
	reservationId: string,
): Promise<boolean> {
	const reservationQuery = transaction
		.select()
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.id, reservationId), eq(s.creditLedger.entryType, 'reservation')))
		.limit(1);
	const [reservation] = await lockForUpdate(reservationQuery).execute();
	if (!reservation?.walletId) {
		return false;
	}
	const releasedAmount = -reservation.deltaMicroUsd;
	validatePositiveAmount(releasedAmount, 'Managed AI reservation release');
	if (
		!(await appendPostgresLedgerEntry(
			transaction,
			reservation.walletId,
			reservationReleaseEntry(reservation, releasedAmount),
		))
	) {
		return false;
	}
	await transaction
		.update(s.creditLedger)
		.set({ entryType: 'adjustment', metadata: { ...reservation.metadata, released: true } })
		.where(and(eq(s.creditLedger.id, reservation.id), eq(s.creditLedger.entryType, 'reservation')))
		.execute();
	return true;
}

function reserveSqliteManagedAiCredits(
	transaction: DBTransaction,
	orgId: string,
	operationId: string,
	reservationMicroUsd: number,
): void {
	const wallet = transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservationMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(and(eq(s.creditWallet.orgId, orgId), gte(s.creditWallet.balanceMicroUsd, reservationMicroUsd)))
		.returning()
		.get();
	if (!wallet) {
		throw new ManagedCreditsExhaustedError();
	}
	transaction
		.insert(s.creditLedger)
		.values(reservationLedgerEntry(wallet, operationId, reservationMicroUsd))
		.run();
}

async function reservePostgresManagedAiCredits(
	transaction: DBTransaction,
	orgId: string,
	operationId: string,
	reservationMicroUsd: number,
): Promise<void> {
	const [wallet] = await transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservationMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(and(eq(s.creditWallet.orgId, orgId), gte(s.creditWallet.balanceMicroUsd, reservationMicroUsd)))
		.returning()
		.execute();
	if (!wallet) {
		throw new ManagedCreditsExhaustedError();
	}
	await transaction
		.insert(s.creditLedger)
		.values(reservationLedgerEntry(wallet, operationId, reservationMicroUsd))
		.execute();
}

function settleSqliteManagedAiUsage(
	transaction: DBTransaction,
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	customerChargeMicroUsd: number,
	billedOrgId: string,
): DBManagedAiUsage | null {
	const wallet = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, billedOrgId)).get();
	if (!wallet) {
		throw new Error(`Managed AI usage has no wallet for organization ${billedOrgId}.`);
	}
	const existingUsage = transaction
		.select({ id: s.managedAiUsage.id })
		.from(s.managedAiUsage)
		.where(eq(s.managedAiUsage.operationId, usage.operationId))
		.get();
	if (existingUsage) {
		return null;
	}
	const reservation = transaction
		.select()
		.from(s.creditLedger)
		.where(
			and(
				eq(s.creditLedger.walletId, wallet.id),
				eq(s.creditLedger.idempotencyKey, usage.operationId),
				eq(s.creditLedger.entryType, 'reservation'),
			),
		)
		.get();
	if (!reservation) {
		throw new Error(`Managed AI usage ${usage.operationId} has no credit reservation.`);
	}
	const created = transaction
		.insert(s.managedAiUsage)
		.values(managedAiUsageEntry(usage, wallet.id, customerChargeMicroUsd))
		.onConflictDoNothing()
		.returning()
		.get();
	if (!created) {
		return null;
	}
	const updated = transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservation.deltaMicroUsd} - ${created.customerChargeMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(s.creditWallet.id, wallet.id))
		.returning()
		.get();
	if (!updated) {
		throw new Error(`Credit wallet ${wallet.id} could not be charged.`);
	}
	transaction
		.update(s.creditLedger)
		.set(settledReservation(created.id, created.customerChargeMicroUsd, updated))
		.where(eq(s.creditLedger.id, reservation.id))
		.run();
	return created;
}

async function settlePostgresManagedAiUsage(
	transaction: DBTransaction,
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	customerChargeMicroUsd: number,
	billedOrgId: string,
): Promise<DBManagedAiUsage | null> {
	const [wallet] = await transaction
		.select()
		.from(s.creditWallet)
		.where(eq(s.creditWallet.orgId, billedOrgId))
		.limit(1)
		.execute();
	if (!wallet) {
		throw new Error(`Managed AI usage has no wallet for organization ${billedOrgId}.`);
	}
	const [existingUsage] = await transaction
		.select({ id: s.managedAiUsage.id })
		.from(s.managedAiUsage)
		.where(eq(s.managedAiUsage.operationId, usage.operationId))
		.limit(1)
		.execute();
	if (existingUsage) {
		return null;
	}
	const reservationQuery = transaction
		.select()
		.from(s.creditLedger)
		.where(
			and(
				eq(s.creditLedger.walletId, wallet.id),
				eq(s.creditLedger.idempotencyKey, usage.operationId),
				eq(s.creditLedger.entryType, 'reservation'),
			),
		)
		.limit(1);
	const [reservation] = await lockForUpdate(reservationQuery).execute();
	if (!reservation) {
		throw new Error(`Managed AI usage ${usage.operationId} has no credit reservation.`);
	}
	const [created] = await transaction
		.insert(s.managedAiUsage)
		.values(managedAiUsageEntry(usage, wallet.id, customerChargeMicroUsd))
		.onConflictDoNothing()
		.returning()
		.execute();
	if (!created) {
		return null;
	}
	const [updated] = await transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservation.deltaMicroUsd} - ${created.customerChargeMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(s.creditWallet.id, wallet.id))
		.returning()
		.execute();
	if (!updated) {
		throw new Error(`Credit wallet ${wallet.id} could not be charged.`);
	}
	await transaction
		.update(s.creditLedger)
		.set(settledReservation(created.id, created.customerChargeMicroUsd, updated))
		.where(eq(s.creditLedger.id, reservation.id))
		.execute();
	return created;
}

function appendSqliteLedgerEntry(transaction: DBTransaction, walletId: string, entry: LedgerEntry): boolean {
	const created = transaction
		.insert(s.creditLedger)
		.values({ ...entry, walletId, balanceAfterMicroUsd: 0, transactionSequence: 0 })
		.onConflictDoNothing()
		.returning({ id: s.creditLedger.id })
		.get();
	if (!created) {
		return false;
	}
	const wallet = transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${entry.deltaMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(s.creditWallet.id, walletId))
		.returning()
		.get();
	if (!wallet) {
		throw new Error(`Credit wallet ${walletId} could not be updated.`);
	}
	transaction
		.update(s.creditLedger)
		.set({
			balanceAfterMicroUsd: wallet.balanceMicroUsd,
			transactionSequence: wallet.ledgerSequence,
		})
		.where(eq(s.creditLedger.id, created.id))
		.run();
	return true;
}

async function appendPostgresLedgerEntry(
	transaction: DBTransaction,
	walletId: string,
	entry: LedgerEntry,
): Promise<boolean> {
	const [created] = await transaction
		.insert(s.creditLedger)
		.values({ ...entry, walletId, balanceAfterMicroUsd: 0, transactionSequence: 0 })
		.onConflictDoNothing()
		.returning({ id: s.creditLedger.id })
		.execute();
	if (!created) {
		return false;
	}
	const [wallet] = await transaction
		.update(s.creditWallet)
		.set({
			balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${entry.deltaMicroUsd}`,
			ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
			updatedAt: new Date(),
		})
		.where(eq(s.creditWallet.id, walletId))
		.returning()
		.execute();
	if (!wallet) {
		throw new Error(`Credit wallet ${walletId} could not be updated.`);
	}
	await transaction
		.update(s.creditLedger)
		.set({
			balanceAfterMicroUsd: wallet.balanceMicroUsd,
			transactionSequence: wallet.ledgerSequence,
		})
		.where(eq(s.creditLedger.id, created.id))
		.execute();
	return true;
}

function ensureSqliteWallet(transaction: DBTransaction, orgId: string): DBCreditWallet {
	transaction.insert(s.creditWallet).values({ orgId }).onConflictDoNothing().run();
	const wallet = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, orgId)).get();
	if (!wallet) {
		throw new Error(`Credit wallet could not be created for organization ${orgId}.`);
	}
	return wallet;
}

async function ensurePostgresWallet(transaction: DBTransaction, orgId: string, lock = false): Promise<DBCreditWallet> {
	await transaction.insert(s.creditWallet).values({ orgId }).onConflictDoNothing().execute();
	const query = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, orgId)).limit(1);
	const [wallet] = await (lock ? lockForUpdate(query) : query).execute();
	if (!wallet) {
		throw new Error(`Credit wallet could not be created for organization ${orgId}.`);
	}
	return wallet;
}

function getSqliteWallet(transaction: DBTransaction, walletId: string): DBCreditWallet {
	const wallet = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.id, walletId)).get();
	if (!wallet) {
		throw new Error(`Credit wallet ${walletId} was not found.`);
	}
	return wallet;
}

async function getPostgresWallet(transaction: DBTransaction, walletId: string, lock = false): Promise<DBCreditWallet> {
	const query = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.id, walletId)).limit(1);
	const [wallet] = await (lock ? lockForUpdate(query) : query).execute();
	if (!wallet) {
		throw new Error(`Credit wallet ${walletId} was not found.`);
	}
	return wallet;
}

function countSqliteGrants(transaction: DBTransaction, walletId: string, grantType: CreditGrantType): number {
	const grants = transaction
		.select({ count: count() })
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.walletId, walletId), eq(s.creditLedger.grantType, grantType)))
		.get();
	return grants?.count ?? 0;
}

async function countPostgresGrants(
	transaction: DBTransaction,
	walletId: string,
	grantType: CreditGrantType,
): Promise<number> {
	const [grants] = await transaction
		.select({ count: count() })
		.from(s.creditLedger)
		.where(and(eq(s.creditLedger.walletId, walletId), eq(s.creditLedger.grantType, grantType)))
		.execute();
	return grants?.count ?? 0;
}

function creditGrantEntry(input: CreditGrant, amountMicroUsd: number): LedgerEntry {
	return {
		entryType: 'gift',
		deltaMicroUsd: amountMicroUsd,
		idempotencyKey: input.idempotencyKey,
		grantType: input.grantType,
		metadata: {
			source: 'nao',
			grantType: input.grantType,
			amountMicroUsd,
			...(input.userId && { grantedForUserId: input.userId }),
			...(input.projectId && { projectId: input.projectId }),
		},
	};
}

function creditPurchaseEntry(purchase: CreditPurchase): LedgerEntry {
	return {
		entryType: 'purchase',
		deltaMicroUsd: purchase.walletAmountMicroUsd,
		idempotencyKey: `purchase:stripe:${purchase.checkoutSessionId}`,
		externalReference: purchase.paymentIntentId,
		metadata: {
			source: 'stripe',
			checkoutSessionId: purchase.checkoutSessionId,
			paymentIntentId: purchase.paymentIntentId,
			invoiceId: purchase.invoiceId,
			initiatingUserId: purchase.initiatingUserId,
			currency: 'usd',
			creditAmountCents: purchase.creditAmountCents,
			platformFeeCents: purchase.platformFeeCents,
			walletAmountMicroUsd: purchase.walletAmountMicroUsd,
			taxAmountCents: purchase.taxAmountCents,
			totalAmountCents: purchase.totalAmountCents,
		},
	};
}

function backofficeCreditTopUpEntry(topUp: BackofficeCreditTopUp): LedgerEntry {
	return {
		entryType: 'gift',
		deltaMicroUsd: topUp.amountMicroUsd,
		idempotencyKey: `backoffice-top-up:${topUp.requestId}`,
		metadata: {
			source: 'backoffice',
			amountMicroUsd: topUp.amountMicroUsd,
			grantedBy: topUp.grantedBy,
			reason: topUp.reason,
		},
	};
}

function creditPurchaseMovementEntry(input: CreditPurchaseMovement, deltaMicroUsd: number): LedgerEntry {
	return {
		entryType: input.entryType,
		deltaMicroUsd,
		idempotencyKey: input.idempotencyKey,
		externalReference: input.externalReference,
		purchasePaymentIntentId: input.paymentIntentId,
		metadata: {
			...input.metadata,
			source: 'stripe',
			purchasePaymentIntentId: input.paymentIntentId,
			movementGroupId: input.movementGroupId,
			movementTargetDeltaMicroUsd: input.targetDeltaMicroUsd,
		},
	};
}

function reservationReleaseEntry(reservation: DBCreditLedger, releasedAmount: number): LedgerEntry {
	return {
		entryType: 'adjustment',
		deltaMicroUsd: releasedAmount,
		idempotencyKey: `reservation-release:${reservation.idempotencyKey}`,
		externalReference: reservation.id,
		metadata: {
			source: 'nao',
			adjustmentType: 'reservation_release',
			operationId: reservation.idempotencyKey,
		},
	};
}

function reservationLedgerEntry(
	wallet: DBCreditWallet,
	operationId: string,
	reservationMicroUsd: number,
): NewCreditLedger {
	return {
		walletId: wallet.id,
		entryType: 'reservation',
		deltaMicroUsd: -reservationMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd,
		transactionSequence: wallet.ledgerSequence,
		idempotencyKey: operationId,
		metadata: { source: 'nao', operationId },
	};
}

function managedAiUsageEntry(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	walletId: string,
	customerChargeMicroUsd: number,
): NewManagedAiUsage {
	return { ...usage, walletId, isManaged: true, customerChargeMicroUsd };
}

function settledReservation(usageId: string, customerChargeMicroUsd: number, wallet: DBCreditWallet) {
	return {
		usageId,
		entryType: 'usage' as const,
		deltaMicroUsd: -customerChargeMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd,
		transactionSequence: wallet.ledgerSequence,
		metadata: null,
	};
}

function calculatePurchaseMovementDelta(
	purchaseMicroUsd: number,
	linkedEntries: DBCreditLedger[],
	movementGroupId: string,
	targetDeltaMicroUsd: number,
): number {
	const movementGroups = new Map<
		string,
		{
			appliedDeltaMicroUsd: number;
			targetDeltaMicroUsd?: number;
			targetSequence: number;
		}
	>();
	for (const entry of linkedEntries) {
		const entryMovementGroupId = entry.metadata?.movementGroupId;
		if (typeof entryMovementGroupId !== 'string') {
			continue;
		}
		const movementGroup = movementGroups.get(entryMovementGroupId) ?? {
			appliedDeltaMicroUsd: 0,
			targetSequence: -1,
		};
		movementGroup.appliedDeltaMicroUsd += entry.deltaMicroUsd;
		const recordedTarget = entry.metadata?.movementTargetDeltaMicroUsd;
		if (
			typeof recordedTarget === 'number' &&
			Number.isSafeInteger(recordedTarget) &&
			recordedTarget <= 0 &&
			entry.transactionSequence > movementGroup.targetSequence
		) {
			movementGroup.targetDeltaMicroUsd = recordedTarget;
			movementGroup.targetSequence = entry.transactionSequence;
		}
		movementGroups.set(entryMovementGroupId, movementGroup);
	}
	const desiredGroupDeltas = new Map(
		[...movementGroups].map(([groupId, group]) => [
			groupId,
			group.targetDeltaMicroUsd ?? group.appliedDeltaMicroUsd,
		]),
	);
	desiredGroupDeltas.set(movementGroupId, targetDeltaMicroUsd);
	const aggregateTargetDelta = Math.max(
		-purchaseMicroUsd,
		[...desiredGroupDeltas.values()].reduce((total, delta) => total + delta, 0),
	);
	const currentAggregateDelta = linkedEntries.reduce((total, entry) => total + entry.deltaMicroUsd, 0);
	return aggregateTargetDelta - currentAggregateDelta;
}

function isCreditPurchaseMovementFor(entry: DBCreditLedger, paymentIntentId: string): boolean {
	return (
		entry.purchasePaymentIntentId === paymentIntentId ||
		(entry.purchasePaymentIntentId === null && entry.metadata?.purchasePaymentIntentId === paymentIntentId)
	);
}

function validateGrantPolicy(amountMicroUsd: number, maxGrantsPerOrg: number | null, grantType: CreditGrantType): void {
	validatePositiveAmount(amountMicroUsd, `Credit grant policy ${grantType}`);
	if (maxGrantsPerOrg !== null && (!Number.isSafeInteger(maxGrantsPerOrg) || maxGrantsPerOrg <= 0)) {
		throw new Error(`Credit grant policy ${grantType} must have a positive integer organization limit.`);
	}
}

function validatePositiveAmount(amountMicroUsd: number, label: string): void {
	if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
		throw new Error(`${label} must have a positive integer amount.`);
	}
}

function lockForUpdate<Query extends { execute(): unknown }>(query: Query): Query {
	return (query as Query & Lockable<Query>).for('update');
}

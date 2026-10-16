import { and, eq, gte, sql } from 'drizzle-orm';

import s, { type DBCreditWallet, type DBManagedAiUsage, type NewManagedAiUsage } from '../db/abstractSchema';
import { db } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { CreditGrantType } from '../types/managed-ai-usage';
import { ManagedCreditsExhaustedError } from '../utils/error';

export async function issueCreditGrant({
	grantType,
	orgId,
	userId,
	projectId,
}: {
	grantType: CreditGrantType;
	orgId: string;
	userId?: string;
	projectId?: string;
}): Promise<boolean> {
	const idempotencyKey = creditGrantIdempotencyKey(grantType, orgId, userId);
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const policy = transaction
					.select()
					.from(s.creditGrantPolicy)
					.where(eq(s.creditGrantPolicy.grantType, grantType))
					.get();
				if (!policy) {
					throw new Error(`Credit grant policy ${grantType} is not configured.`);
				}
				if (!policy.enabled) {
					return false;
				}
				validateGrantAmount(policy.amountMicroUsd, grantType);
				transaction.insert(s.creditWallet).values({ orgId }).onConflictDoNothing().run();
				const wallet = transaction.select().from(s.creditWallet).where(eq(s.creditWallet.orgId, orgId)).get();
				if (!wallet) {
					throw new Error(`Credit wallet could not be created for organization ${orgId}.`);
				}
				const entry = transaction
					.insert(s.creditLedger)
					.values(
						creditGrantEntry(wallet, grantType, policy.amountMicroUsd, idempotencyKey, userId, projectId),
					)
					.onConflictDoNothing()
					.returning()
					.get();
				if (!entry) {
					return false;
				}
				const updated = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${policy.amountMicroUsd}`,
						ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
						updatedAt: new Date(),
					})
					.where(eq(s.creditWallet.id, wallet.id))
					.returning()
					.get();
				if (!updated) {
					throw new Error(`Credit wallet ${wallet.id} could not be updated.`);
				}
				transaction
					.update(s.creditLedger)
					.set({
						balanceAfterMicroUsd: updated.balanceMicroUsd,
						transactionSequence: updated.ledgerSequence,
					})
					.where(eq(s.creditLedger.id, entry.id))
					.run();
				return true;
			},
			{ behavior: 'immediate' },
		);
	}

	return db.transaction(async (transaction) => {
		const [policy] = await transaction
			.select()
			.from(s.creditGrantPolicy)
			.where(eq(s.creditGrantPolicy.grantType, grantType))
			.limit(1);
		if (!policy) {
			throw new Error(`Credit grant policy ${grantType} is not configured.`);
		}
		if (!policy.enabled) {
			return false;
		}
		validateGrantAmount(policy.amountMicroUsd, grantType);
		await transaction.insert(s.creditWallet).values({ orgId }).onConflictDoNothing().execute();
		const [wallet] = await transaction
			.select()
			.from(s.creditWallet)
			.where(eq(s.creditWallet.orgId, orgId))
			.limit(1);
		if (!wallet) {
			throw new Error(`Credit wallet could not be created for organization ${orgId}.`);
		}

		const [entry] = await transaction
			.insert(s.creditLedger)
			.values(creditGrantEntry(wallet, grantType, policy.amountMicroUsd, idempotencyKey, userId, projectId))
			.onConflictDoNothing()
			.returning()
			.execute();
		if (!entry) {
			return false;
		}

		const [updated] = await transaction
			.update(s.creditWallet)
			.set({
				balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${policy.amountMicroUsd}`,
				ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(s.creditWallet.id, wallet.id))
			.returning()
			.execute();
		if (!updated) {
			throw new Error(`Credit wallet ${wallet.id} could not be updated.`);
		}
		await transaction
			.update(s.creditLedger)
			.set({
				balanceAfterMicroUsd: updated.balanceMicroUsd,
				transactionSequence: updated.ledgerSequence,
			})
			.where(eq(s.creditLedger.id, entry.id))
			.execute();
		return true;
	});
}

export async function reserveManagedAiCredits(
	orgId: string,
	operationId: string,
	reservationMicroUsd: number,
): Promise<void> {
	if (!Number.isSafeInteger(reservationMicroUsd) || reservationMicroUsd <= 0) {
		throw new Error('Managed AI credit reservation must be a positive integer.');
	}
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const wallet = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservationMicroUsd}`,
						ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
						updatedAt: new Date(),
					})
					.where(
						and(eq(s.creditWallet.orgId, orgId), gte(s.creditWallet.balanceMicroUsd, reservationMicroUsd)),
					)
					.returning()
					.get();
				if (!wallet) {
					throw new ManagedCreditsExhaustedError();
				}
				transaction
					.insert(s.creditLedger)
					.values(reservationLedgerEntry(wallet, operationId, reservationMicroUsd))
					.run();
			},
			{ behavior: 'immediate' },
		);
	}

	await db.transaction(async (transaction) => {
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
	});
}

export async function recordManagedAiUsageAndChargeWallet(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	customerChargeMicroUsd: number,
): Promise<DBManagedAiUsage | null> {
	if (!Number.isSafeInteger(customerChargeMicroUsd) || customerChargeMicroUsd < 0) {
		throw new Error('Managed AI charge must be a non-negative integer.');
	}
	const billedOrgId = usage.orgId;
	if (!billedOrgId) {
		throw new Error('Managed AI usage requires a billed organization.');
	}
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const wallet = transaction
					.select()
					.from(s.creditWallet)
					.where(eq(s.creditWallet.orgId, billedOrgId))
					.get();
				if (!wallet) {
					throw new Error(`Managed AI usage has no wallet for organization ${billedOrgId}.`);
				}
				const reservation = transaction
					.select()
					.from(s.creditLedger)
					.where(
						and(
							eq(s.creditLedger.walletId, wallet.id),
							eq(s.creditLedger.idempotencyKey, usage.operationId),
						),
					)
					.get();
				if (!reservation) {
					throw new Error(`Managed AI usage ${usage.operationId} has no credit reservation.`);
				}
				const created = transaction
					.insert(s.managedAiUsage)
					.values({
						...usage,
						walletId: wallet.id,
						isManaged: true,
						customerChargeMicroUsd: Math.min(customerChargeMicroUsd, -reservation.deltaMicroUsd),
					})
					.onConflictDoNothing()
					.returning()
					.get();
				if (!created) {
					return created ?? null;
				}
				const settledChargeMicroUsd = created.customerChargeMicroUsd;
				const updated = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservation.deltaMicroUsd} - ${settledChargeMicroUsd}`,
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
					.set({
						usageId: created.id,
						entryType: 'usage',
						deltaMicroUsd: -settledChargeMicroUsd,
						balanceAfterMicroUsd: updated.balanceMicroUsd,
						transactionSequence: updated.ledgerSequence,
						metadata: null,
					})
					.where(eq(s.creditLedger.id, reservation.id))
					.run();
				return created;
			},
			{ behavior: 'immediate' },
		);
	}

	return db.transaction(async (transaction) => {
		const [wallet] = await transaction
			.select()
			.from(s.creditWallet)
			.where(eq(s.creditWallet.orgId, billedOrgId))
			.limit(1);
		if (!wallet) {
			throw new Error(`Managed AI usage has no wallet for organization ${billedOrgId}.`);
		}
		const [reservation] = await transaction
			.select()
			.from(s.creditLedger)
			.where(and(eq(s.creditLedger.walletId, wallet.id), eq(s.creditLedger.idempotencyKey, usage.operationId)))
			.limit(1);
		if (!reservation) {
			throw new Error(`Managed AI usage ${usage.operationId} has no credit reservation.`);
		}

		const [created] = await transaction
			.insert(s.managedAiUsage)
			.values({
				...usage,
				walletId: wallet.id,
				isManaged: true,
				customerChargeMicroUsd: Math.min(customerChargeMicroUsd, -reservation.deltaMicroUsd),
			})
			.onConflictDoNothing()
			.returning()
			.execute();
		if (!created) {
			return created ?? null;
		}
		const settledChargeMicroUsd = created.customerChargeMicroUsd;

		const [updated] = await transaction
			.update(s.creditWallet)
			.set({
				balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} - ${reservation.deltaMicroUsd} - ${settledChargeMicroUsd}`,
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
			.set({
				usageId: created.id,
				entryType: 'usage',
				deltaMicroUsd: -settledChargeMicroUsd,
				balanceAfterMicroUsd: updated.balanceMicroUsd,
				transactionSequence: updated.ledgerSequence,
				metadata: null,
			})
			.where(eq(s.creditLedger.id, reservation.id))
			.execute();
		return created;
	});
}

function creditGrantIdempotencyKey(grantType: CreditGrantType, orgId: string, userId?: string): string {
	if (grantType === 'organization_setup') {
		return `organization-setup:v0:${orgId}`;
	}
	if (!userId) {
		throw new Error('User join credit grant requires a user.');
	}
	return `user-join:v0:${userId}`;
}

function validateGrantAmount(amountMicroUsd: number, grantType: CreditGrantType): void {
	if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
		throw new Error(`Credit grant policy ${grantType} must have a positive integer amount.`);
	}
}

function creditGrantEntry(
	wallet: DBCreditWallet,
	grantType: CreditGrantType,
	amountMicroUsd: number,
	idempotencyKey: string,
	userId?: string,
	projectId?: string,
) {
	return {
		walletId: wallet.id,
		entryType: 'gift' as const,
		deltaMicroUsd: amountMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd + amountMicroUsd,
		transactionSequence: 0,
		idempotencyKey,
		metadata: {
			source: 'nao',
			grantType,
			amountMicroUsd,
			...(userId && { grantedForUserId: userId }),
			...(projectId && { projectId }),
		},
	};
}

function reservationLedgerEntry(wallet: DBCreditWallet, operationId: string, reservationMicroUsd: number) {
	return {
		walletId: wallet.id,
		entryType: 'reservation' as const,
		deltaMicroUsd: -reservationMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd,
		transactionSequence: wallet.ledgerSequence,
		idempotencyKey: operationId,
		metadata: { source: 'nao', operationId },
	};
}

import { and, eq, gte, lt, sql } from 'drizzle-orm';

import s, { type DBCreditWallet, type DBManagedAiUsage, type NewManagedAiUsage } from '../db/abstractSchema';
import { db } from '../db/db';
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

interface CreditPurchaseMovement {
	paymentIntentId: string;
	movementGroupId: string;
	targetDeltaMicroUsd: number;
	idempotencyKey: string;
	externalReference: string;
	entryType: 'refund' | 'adjustment';
	metadata?: Record<string, unknown>;
}

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

export async function issueCreditPurchase(purchase: CreditPurchase): Promise<boolean> {
	validatePositiveAmount(purchase.walletAmountMicroUsd, 'Credit purchase');
	const idempotencyKey = `purchase:stripe:${purchase.checkoutSessionId}`;
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				transaction.insert(s.creditWallet).values({ orgId: purchase.orgId }).onConflictDoNothing().run();
				const wallet = transaction
					.select()
					.from(s.creditWallet)
					.where(eq(s.creditWallet.orgId, purchase.orgId))
					.get();
				if (!wallet) {
					throw new Error(`Credit wallet could not be created for organization ${purchase.orgId}.`);
				}
				const entry = transaction
					.insert(s.creditLedger)
					.values(creditPurchaseEntry(wallet, purchase, idempotencyKey))
					.onConflictDoNothing()
					.returning()
					.get();
				if (!entry) {
					return false;
				}
				const updated = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${purchase.walletAmountMicroUsd}`,
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
		await transaction.insert(s.creditWallet).values({ orgId: purchase.orgId }).onConflictDoNothing().execute();
		const [wallet] = await transaction
			.select()
			.from(s.creditWallet)
			.where(eq(s.creditWallet.orgId, purchase.orgId))
			.limit(1);
		if (!wallet) {
			throw new Error(`Credit wallet could not be created for organization ${purchase.orgId}.`);
		}
		const [entry] = await transaction
			.insert(s.creditLedger)
			.values(creditPurchaseEntry(wallet, purchase, idempotencyKey))
			.onConflictDoNothing()
			.returning()
			.execute();
		if (!entry) {
			return false;
		}
		const [updated] = await transaction
			.update(s.creditWallet)
			.set({
				balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${purchase.walletAmountMicroUsd}`,
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

export async function setCreditPurchaseMovement(input: CreditPurchaseMovement): Promise<boolean> {
	if (!Number.isSafeInteger(input.targetDeltaMicroUsd) || input.targetDeltaMicroUsd > 0) {
		throw new Error('Credit purchase movement target must be a non-positive integer.');
	}
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
				const purchase = transaction
					.select()
					.from(s.creditLedger)
					.where(
						and(
							eq(s.creditLedger.entryType, 'purchase'),
							eq(s.creditLedger.externalReference, input.paymentIntentId),
						),
					)
					.get();
				if (!purchase?.walletId) {
					throw new Error(`Credit purchase for PaymentIntent ${input.paymentIntentId} was not found.`);
				}
				const wallet = transaction
					.select()
					.from(s.creditWallet)
					.where(eq(s.creditWallet.id, purchase.walletId))
					.get();
				if (!wallet) {
					throw new Error(`Credit wallet ${purchase.walletId} was not found.`);
				}
				const linkedEntries = transaction
					.select()
					.from(s.creditLedger)
					.where(eq(s.creditLedger.walletId, wallet.id))
					.all()
					.filter((entry) => entry.metadata?.purchasePaymentIntentId === input.paymentIntentId);
				const deltaMicroUsd = calculatePurchaseMovementDelta(
					purchase.deltaMicroUsd,
					linkedEntries,
					input.movementGroupId,
					input.targetDeltaMicroUsd,
				);
				const entry = transaction
					.insert(s.creditLedger)
					.values(creditPurchaseMovementEntry(wallet, input, deltaMicroUsd))
					.onConflictDoNothing()
					.returning()
					.get();
				if (!entry) {
					return false;
				}
				const updated = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${deltaMicroUsd}`,
						ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
						updatedAt: new Date(),
					})
					.where(eq(s.creditWallet.id, wallet.id))
					.returning()
					.get();
				if (!updated) {
					throw new Error(`Credit wallet ${wallet.id} could not be adjusted.`);
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
		const [purchase] = await transaction
			.select()
			.from(s.creditLedger)
			.where(
				and(
					eq(s.creditLedger.entryType, 'purchase'),
					eq(s.creditLedger.externalReference, input.paymentIntentId),
				),
			)
			.limit(1);
		if (!purchase?.walletId) {
			throw new Error(`Credit purchase for PaymentIntent ${input.paymentIntentId} was not found.`);
		}
		const walletQuery = transaction
			.select()
			.from(s.creditWallet)
			.where(eq(s.creditWallet.id, purchase.walletId))
			.limit(1);
		const [wallet] = await (
			walletQuery as typeof walletQuery & {
				for(strength: 'update'): typeof walletQuery;
			}
		)
			.for('update')
			.execute();
		if (!wallet) {
			throw new Error(`Credit wallet ${purchase.walletId} was not found.`);
		}
		const linkedEntries = (
			await transaction.select().from(s.creditLedger).where(eq(s.creditLedger.walletId, wallet.id))
		).filter((entry) => entry.metadata?.purchasePaymentIntentId === input.paymentIntentId);
		const deltaMicroUsd = calculatePurchaseMovementDelta(
			purchase.deltaMicroUsd,
			linkedEntries,
			input.movementGroupId,
			input.targetDeltaMicroUsd,
		);
		const [entry] = await transaction
			.insert(s.creditLedger)
			.values(creditPurchaseMovementEntry(wallet, input, deltaMicroUsd))
			.onConflictDoNothing()
			.returning()
			.execute();
		if (!entry) {
			return false;
		}
		const [updated] = await transaction
			.update(s.creditWallet)
			.set({
				balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${deltaMicroUsd}`,
				ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(s.creditWallet.id, wallet.id))
			.returning()
			.execute();
		if (!updated) {
			throw new Error(`Credit wallet ${wallet.id} could not be adjusted.`);
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

async function releaseManagedAiCreditReservation(reservationId: string): Promise<boolean> {
	if (dbConfig.dialect === Dialect.Sqlite) {
		return db.transaction(
			(transaction) => {
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
				const updated = transaction
					.update(s.creditWallet)
					.set({
						balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${releasedAmount}`,
						ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
						updatedAt: new Date(),
					})
					.where(eq(s.creditWallet.id, reservation.walletId))
					.returning()
					.get();
				if (!updated) {
					throw new Error(`Credit wallet ${reservation.walletId} could not release a reservation.`);
				}
				transaction
					.update(s.creditLedger)
					.set({ entryType: 'adjustment', metadata: { ...reservation.metadata, released: true } })
					.where(and(eq(s.creditLedger.id, reservation.id), eq(s.creditLedger.entryType, 'reservation')))
					.run();
				transaction
					.insert(s.creditLedger)
					.values(reservationReleaseEntry(updated, reservation, releasedAmount))
					.onConflictDoNothing()
					.run();
				return true;
			},
			{ behavior: 'immediate' },
		);
	}

	return db.transaction(async (transaction) => {
		const reservationQuery = transaction
			.select()
			.from(s.creditLedger)
			.where(and(eq(s.creditLedger.id, reservationId), eq(s.creditLedger.entryType, 'reservation')))
			.limit(1);
		const [reservation] = await (
			reservationQuery as typeof reservationQuery & {
				for(strength: 'update'): typeof reservationQuery;
			}
		)
			.for('update')
			.execute();
		if (!reservation?.walletId) {
			return false;
		}
		const releasedAmount = -reservation.deltaMicroUsd;
		validatePositiveAmount(releasedAmount, 'Managed AI reservation release');
		const [updated] = await transaction
			.update(s.creditWallet)
			.set({
				balanceMicroUsd: sql`${s.creditWallet.balanceMicroUsd} + ${releasedAmount}`,
				ledgerSequence: sql`${s.creditWallet.ledgerSequence} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(s.creditWallet.id, reservation.walletId))
			.returning()
			.execute();
		if (!updated) {
			throw new Error(`Credit wallet ${reservation.walletId} could not release a reservation.`);
		}
		await transaction
			.update(s.creditLedger)
			.set({ entryType: 'adjustment', metadata: { ...reservation.metadata, released: true } })
			.where(and(eq(s.creditLedger.id, reservation.id), eq(s.creditLedger.entryType, 'reservation')))
			.execute();
		await transaction
			.insert(s.creditLedger)
			.values(reservationReleaseEntry(updated, reservation, releasedAmount))
			.onConflictDoNothing()
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
		const [existingUsage] = await transaction
			.select({ id: s.managedAiUsage.id })
			.from(s.managedAiUsage)
			.where(eq(s.managedAiUsage.operationId, usage.operationId))
			.limit(1);
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
		const [reservation] = await (
			reservationQuery as typeof reservationQuery & {
				for(strength: 'update'): typeof reservationQuery;
			}
		)
			.for('update')
			.execute();
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
	validatePositiveAmount(amountMicroUsd, `Credit grant policy ${grantType}`);
}

function validatePositiveAmount(amountMicroUsd: number, label: string): void {
	if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
		throw new Error(`${label} must have a positive integer amount.`);
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

function creditPurchaseEntry(wallet: DBCreditWallet, purchase: CreditPurchase, idempotencyKey: string) {
	return {
		walletId: wallet.id,
		entryType: 'purchase' as const,
		deltaMicroUsd: purchase.walletAmountMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd + purchase.walletAmountMicroUsd,
		transactionSequence: 0,
		idempotencyKey,
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

function calculatePurchaseMovementDelta(
	purchaseMicroUsd: number,
	linkedEntries: (typeof s.creditLedger.$inferSelect)[],
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

function creditPurchaseMovementEntry(wallet: DBCreditWallet, input: CreditPurchaseMovement, deltaMicroUsd: number) {
	return {
		walletId: wallet.id,
		entryType: input.entryType,
		deltaMicroUsd,
		balanceAfterMicroUsd: wallet.balanceMicroUsd + deltaMicroUsd,
		transactionSequence: 0,
		idempotencyKey: input.idempotencyKey,
		externalReference: input.externalReference,
		metadata: {
			...input.metadata,
			source: 'stripe',
			purchasePaymentIntentId: input.paymentIntentId,
			movementGroupId: input.movementGroupId,
			movementTargetDeltaMicroUsd: input.targetDeltaMicroUsd,
		},
	};
}

function reservationReleaseEntry(
	wallet: DBCreditWallet,
	reservation: typeof s.creditLedger.$inferSelect,
	releasedAmount: number,
) {
	return {
		walletId: wallet.id,
		entryType: 'adjustment' as const,
		deltaMicroUsd: releasedAmount,
		balanceAfterMicroUsd: wallet.balanceMicroUsd,
		transactionSequence: wallet.ledgerSequence,
		idempotencyKey: `reservation-release:${reservation.idempotencyKey}`,
		externalReference: reservation.id,
		metadata: {
			source: 'nao',
			adjustmentType: 'reservation_release',
			operationId: reservation.idempotencyKey,
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

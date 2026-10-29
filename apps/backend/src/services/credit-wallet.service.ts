import type { DBManagedAiUsage, NewManagedAiUsage } from '../db/abstractSchema';
import type { BackofficeCreditTopUp, CreditPurchase, CreditPurchaseMovement } from '../queries/credit-ledger.queries';
import * as creditLedgerQueries from '../queries/credit-ledger.queries';
import * as userQueries from '../queries/user.queries';
import { creditGrantIdempotencyKey, type CreditGrantType } from '../types/managed-ai-usage';

export type { BackofficeCreditTopUp, CreditPurchase } from '../queries/credit-ledger.queries';

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
	const subjectId = grantType === 'organization_setup' ? orgId : userId;
	if (!subjectId) {
		throw new Error('User join credit grant requires a user.');
	}
	if (grantType === 'user_join' && !(await isEmailVerified(subjectId))) {
		return false;
	}
	return creditLedgerQueries.issueCreditGrant({
		grantType,
		orgId,
		userId,
		projectId,
		idempotencyKey: creditGrantIdempotencyKey(grantType, subjectId),
	});
}

export async function issueCreditPurchase(purchase: CreditPurchase): Promise<boolean> {
	validatePositiveAmount(purchase.walletAmountMicroUsd, 'Credit purchase');
	return creditLedgerQueries.issueCreditPurchase(purchase);
}

export async function issueBackofficeCreditTopUp(topUp: BackofficeCreditTopUp): Promise<boolean> {
	validatePositiveAmount(topUp.amountMicroUsd, 'Backoffice credit top-up');
	return creditLedgerQueries.issueBackofficeCreditTopUp(topUp);
}

export async function setCreditPurchaseMovement(input: CreditPurchaseMovement): Promise<boolean> {
	if (!Number.isSafeInteger(input.targetDeltaMicroUsd) || input.targetDeltaMicroUsd > 0) {
		throw new Error('Credit purchase movement target must be a non-positive integer.');
	}
	return creditLedgerQueries.setCreditPurchaseMovement(input);
}

export async function releaseStaleManagedAiCreditReservations(cutoff: Date): Promise<number> {
	return creditLedgerQueries.releaseStaleManagedAiCreditReservations(cutoff);
}

export async function reserveManagedAiCredits(
	orgId: string,
	operationId: string,
	reservationMicroUsd: number,
): Promise<void> {
	validatePositiveAmount(reservationMicroUsd, 'Managed AI credit reservation');
	return creditLedgerQueries.reserveManagedAiCredits(orgId, operationId, reservationMicroUsd);
}

export async function recordUnbilledManagedAiUsage(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged' | 'customerChargeMicroUsd'>,
): Promise<DBManagedAiUsage | null> {
	return creditLedgerQueries.recordUnbilledManagedAiUsage(usage);
}

export async function recordManagedAiUsageAndChargeWallet(
	usage: Omit<NewManagedAiUsage, 'id' | 'walletId' | 'isManaged'>,
	customerChargeMicroUsd: number,
): Promise<DBManagedAiUsage | null> {
	if (!Number.isSafeInteger(customerChargeMicroUsd) || customerChargeMicroUsd < 0) {
		throw new Error('Managed AI charge must be a non-negative integer.');
	}
	if (!usage.orgId) {
		throw new Error('Managed AI usage requires a billed organization.');
	}
	return creditLedgerQueries.recordManagedAiUsageAndChargeWallet(usage, customerChargeMicroUsd, usage.orgId);
}

async function isEmailVerified(userId: string): Promise<boolean> {
	return (await userQueries.getUser({ id: userId }))?.emailVerified === true;
}

function validatePositiveAmount(amountMicroUsd: number, label: string): void {
	if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd <= 0) {
		throw new Error(`${label} must have a positive integer amount.`);
	}
}

import { eq, sql } from 'drizzle-orm';

import s, { type NewManagedAiUsage } from '../db/abstractSchema';
import { db } from '../db/db';

export const MANAGED_AI_ALLOWANCE_MICRO_USD = 5_000_000;

export async function getManagedAiSpendMicroUsd(userId: string): Promise<number> {
	const [result] = await db
		.select({ spentMicroUsd: sql<number>`coalesce(sum(${s.managedAiUsage.costMicroUsd}), 0)` })
		.from(s.managedAiUsage)
		.where(eq(s.managedAiUsage.userId, userId));
	return Number(result?.spentMicroUsd ?? 0);
}

export async function getManagedAiBalance(userId: string): Promise<{
	spentMicroUsd: number;
	remainingMicroUsd: number;
	allowanceMicroUsd: number;
}> {
	const spentMicroUsd = await getManagedAiSpendMicroUsd(userId);
	return {
		spentMicroUsd,
		remainingMicroUsd: Math.max(0, MANAGED_AI_ALLOWANCE_MICRO_USD - spentMicroUsd),
		allowanceMicroUsd: MANAGED_AI_ALLOWANCE_MICRO_USD,
	};
}

export async function insertManagedAiUsage(usage: NewManagedAiUsage): Promise<void> {
	await db.insert(s.managedAiUsage).values(usage);
}

import { and, eq, gt, lt, sql } from 'drizzle-orm';

import s from '../db/abstractSchema';
import { db } from '../db/db';
import type { ExampleChatAllowanceScope } from '../types/example-chat-allowance';

export const EXAMPLE_CHAT_RUN_CAP = 30;
export const ONBOARDING_CHAT_RUN_CAP = 100;

export async function consumeExampleChatRun(userId: string, scope: ExampleChatAllowanceScope): Promise<boolean> {
	const cap = scope === 'example' ? EXAMPLE_CHAT_RUN_CAP : ONBOARDING_CHAT_RUN_CAP;
	await db.insert(s.exampleChatAllowance).values({ userId, scope }).onConflictDoNothing().execute();
	const updated = await db
		.update(s.exampleChatAllowance)
		.set({
			usedRuns: sql`${s.exampleChatAllowance.usedRuns} + 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(s.exampleChatAllowance.userId, userId),
				eq(s.exampleChatAllowance.scope, scope),
				lt(s.exampleChatAllowance.usedRuns, cap),
			),
		)
		.returning({ usedRuns: s.exampleChatAllowance.usedRuns })
		.execute();
	return updated.length === 1;
}

export async function releaseExampleChatRun(userId: string, scope: ExampleChatAllowanceScope): Promise<void> {
	await db
		.update(s.exampleChatAllowance)
		.set({
			usedRuns: sql`${s.exampleChatAllowance.usedRuns} - 1`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(s.exampleChatAllowance.userId, userId),
				eq(s.exampleChatAllowance.scope, scope),
				gt(s.exampleChatAllowance.usedRuns, 0),
			),
		)
		.execute();
}

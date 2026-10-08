/* @license Enterprise */

import { DEFAULT_MEMBER_BUDGET_PERIOD } from '@nao/shared/member-budget';
import { LLM_PROVIDERS, type MemberBudgetPeriod } from '@nao/shared/types';
import { and, eq } from 'drizzle-orm';

import s, { DBProjectGroupBudget, DBProjectMemberBudget, DBProjectMemberBudgetSettings } from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { SetMemberBudgetsInput } from '../types/member-budget';
import { queryProviderPeriodCosts, roundCost } from './budget.queries';

type SQLiteRunnable = { run(): unknown };
type Executable = { execute(): Promise<unknown> };

export const getMemberBudgetSettings = async (projectId: string): Promise<DBProjectMemberBudgetSettings | null> => {
	const [row] = await db
		.select()
		.from(s.projectMemberBudgetSettings)
		.where(eq(s.projectMemberBudgetSettings.projectId, projectId))
		.execute();
	return row ?? null;
};

export const listPersonalBudgets = async (projectId: string): Promise<DBProjectMemberBudget[]> => {
	return db.select().from(s.projectMemberBudget).where(eq(s.projectMemberBudget.projectId, projectId)).execute();
};

export const getPersonalBudget = async (projectId: string, userId: string): Promise<DBProjectMemberBudget | null> => {
	const [row] = await db
		.select()
		.from(s.projectMemberBudget)
		.where(and(eq(s.projectMemberBudget.projectId, projectId), eq(s.projectMemberBudget.userId, userId)))
		.execute();
	return row ?? null;
};

export const listGroupBudgets = async (projectId: string): Promise<DBProjectGroupBudget[]> => {
	return db.select().from(s.projectGroupBudget).where(eq(s.projectGroupBudget.projectId, projectId)).execute();
};

export const listGroupBudgetsForMember = async (
	projectId: string,
	userId: string,
): Promise<Array<{ groupId: string; limitUsd: number }>> => {
	return db
		.selectDistinct({ groupId: s.projectGroupBudget.groupId, limitUsd: s.projectGroupBudget.limitUsd })
		.from(s.projectGroupBudget)
		.innerJoin(s.userGroupMember, eq(s.userGroupMember.groupId, s.projectGroupBudget.groupId))
		.where(and(eq(s.projectGroupBudget.projectId, projectId), eq(s.userGroupMember.userId, userId)))
		.execute();
};

export const setPersonalBudget = async (projectId: string, userId: string, limitUsd: number | null): Promise<void> => {
	await writePersonalBudget(db, projectId, userId, limitUsd).execute();
};

export const setGroupBudget = async (projectId: string, groupId: string, limitUsd: number | null): Promise<void> => {
	await writeGroupBudget(db, projectId, groupId, limitUsd).execute();
};

export const setDefaultMemberBudgetLimit = async (projectId: string, defaultLimitUsd: number): Promise<void> => {
	await db
		.insert(s.projectMemberBudgetSettings)
		.values({ projectId, period: DEFAULT_MEMBER_BUDGET_PERIOD, defaultLimitUsd })
		.onConflictDoUpdate({
			target: s.projectMemberBudgetSettings.projectId,
			set: { defaultLimitUsd, updatedAt: new Date() },
		})
		.execute();
};

/** Saves the period, the default limit and the changed personal and group budgets in one transaction. */
export const saveMemberBudgets = async (projectId: string, input: SetMemberBudgetsInput): Promise<void> => {
	if (dbConfig.dialect === Dialect.Sqlite) {
		db.transaction((tx) => {
			for (const statement of buildMemberBudgetWrites(tx, projectId, input)) {
				(statement as unknown as SQLiteRunnable).run();
			}
		});
		return;
	}
	await db.transaction(async (tx) => {
		for (const statement of buildMemberBudgetWrites(tx, projectId, input)) {
			await statement.execute();
		}
	});
};

/** Spend of every project member across all providers over the current `period`, keyed by user id. */
export const getPeriodCostsByUser = async (
	projectId: string,
	period: MemberBudgetPeriod,
): Promise<Record<string, number>> => {
	const rows = await queryAllProviderCosts(projectId, period);
	const costByUser: Record<string, number> = {};
	for (const row of rows) {
		if (row.userId) {
			costByUser[row.userId] = (costByUser[row.userId] ?? 0) + Number(row.totalCost ?? 0);
		}
	}
	for (const userId of Object.keys(costByUser)) {
		costByUser[userId] = roundCost(costByUser[userId]);
	}
	return costByUser;
};

export const getUserPeriodCost = async (
	projectId: string,
	userId: string,
	period: MemberBudgetPeriod,
): Promise<number> => {
	const rows = await queryAllProviderCosts(projectId, period, userId);
	return roundCost(rows.reduce((total, row) => total + Number(row.totalCost ?? 0), 0));
};

/** Records the member's limit-reached notice for a period; returns false when it was already recorded. */
export const claimMemberBudgetNotification = async (
	projectId: string,
	userId: string,
	periodStart: Date,
): Promise<boolean> => {
	const rows = await db
		.insert(s.memberBudgetNotification)
		.values({ projectId, userId, periodStart })
		.onConflictDoNothing()
		.returning({ id: s.memberBudgetNotification.id })
		.execute();
	return rows.length > 0;
};

export const releaseMemberBudgetNotification = async (
	projectId: string,
	userId: string,
	periodStart: Date,
): Promise<void> => {
	await db
		.delete(s.memberBudgetNotification)
		.where(
			and(
				eq(s.memberBudgetNotification.projectId, projectId),
				eq(s.memberBudgetNotification.userId, userId),
				eq(s.memberBudgetNotification.periodStart, periodStart),
			),
		)
		.execute();
};

function buildMemberBudgetWrites(executor: DBExecutor, projectId: string, input: SetMemberBudgetsInput): Executable[] {
	return [
		executor
			.insert(s.projectMemberBudgetSettings)
			.values({ projectId, period: input.period, defaultLimitUsd: input.defaultLimitUsd })
			.onConflictDoUpdate({
				target: s.projectMemberBudgetSettings.projectId,
				set: { period: input.period, defaultLimitUsd: input.defaultLimitUsd, updatedAt: new Date() },
			}),
		...input.personalBudgets.map(({ userId, limitUsd }) =>
			writePersonalBudget(executor, projectId, userId, limitUsd),
		),
		...input.groupBudgets.map(({ groupId, limitUsd }) => writeGroupBudget(executor, projectId, groupId, limitUsd)),
	];
}

/** Upserts the budget, or deletes it when `limitUsd` is null. */
function writePersonalBudget(executor: DBExecutor, projectId: string, userId: string, limitUsd: number | null) {
	if (limitUsd === null) {
		return executor
			.delete(s.projectMemberBudget)
			.where(and(eq(s.projectMemberBudget.projectId, projectId), eq(s.projectMemberBudget.userId, userId)));
	}
	return executor
		.insert(s.projectMemberBudget)
		.values({ projectId, userId, limitUsd })
		.onConflictDoUpdate({
			target: [s.projectMemberBudget.projectId, s.projectMemberBudget.userId],
			set: { limitUsd, updatedAt: new Date() },
		});
}

/** Upserts the budget, or deletes it when `limitUsd` is null. */
function writeGroupBudget(executor: DBExecutor, projectId: string, groupId: string, limitUsd: number | null) {
	if (limitUsd === null) {
		return executor
			.delete(s.projectGroupBudget)
			.where(and(eq(s.projectGroupBudget.projectId, projectId), eq(s.projectGroupBudget.groupId, groupId)));
	}
	return executor
		.insert(s.projectGroupBudget)
		.values({ projectId, groupId, limitUsd })
		.onConflictDoUpdate({
			target: s.projectGroupBudget.groupId,
			set: { limitUsd, updatedAt: new Date() },
		});
}

/** Member budgets span every provider, so every provider shares the member budget's period. */
function queryAllProviderCosts(projectId: string, period: MemberBudgetPeriod, userId?: string) {
	return queryProviderPeriodCosts(
		projectId,
		LLM_PROVIDERS.map((provider) => ({ provider, period })),
		{ userId },
	);
}

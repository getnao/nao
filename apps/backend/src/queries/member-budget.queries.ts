/* @license Enterprise */

import { getCurrentPeriodStart } from '@nao/shared/date';
import { DEFAULT_MEMBER_BUDGET_PERIOD } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';
import { and, eq, inArray, isNotNull, or } from 'drizzle-orm';

import s, {
	DBProjectGroupBudget,
	DBProjectGroupSharedBudget,
	DBProjectMemberBudget,
	DBProjectMemberBudgetSettings,
} from '../db/abstractSchema';
import { db, type DBExecutor } from '../db/db';
import dbConfig, { Dialect } from '../db/dbConfig';
import type { SetMemberBudgetsInput } from '../types/member-budget';
import { queryAllProvidersCostsSince, roundCost } from './budget.queries';

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

export const listGroupSharedBudgets = async (projectId: string): Promise<DBProjectGroupSharedBudget[]> => {
	return db
		.select()
		.from(s.projectGroupSharedBudget)
		.where(eq(s.projectGroupSharedBudget.projectId, projectId))
		.execute();
};

/** All Users stores no member rows, so its shared budget applies to every member. */
export const listGroupSharedBudgetsForMember = async (
	projectId: string,
	userId: string,
): Promise<Array<{ groupId: string; groupName: string; isDefault: boolean; limitUsd: number }>> => {
	return db
		.selectDistinct({
			groupId: s.projectGroupSharedBudget.groupId,
			groupName: s.userGroup.name,
			isDefault: s.userGroup.isDefault,
			limitUsd: s.projectGroupSharedBudget.limitUsd,
		})
		.from(s.projectGroupSharedBudget)
		.innerJoin(s.userGroup, eq(s.userGroup.id, s.projectGroupSharedBudget.groupId))
		.leftJoin(
			s.userGroupMember,
			and(
				eq(s.userGroupMember.groupId, s.projectGroupSharedBudget.groupId),
				eq(s.userGroupMember.userId, userId),
			),
		)
		.where(
			and(
				eq(s.projectGroupSharedBudget.projectId, projectId),
				or(eq(s.userGroup.isDefault, true), isNotNull(s.userGroupMember.userId)),
			),
		)
		.execute();
};

/** Every member of the groups, whether added by hand or synced from SSO. */
export const listGroupMemberships = async (groupIds: string[]): Promise<Array<{ groupId: string; userId: string }>> => {
	if (groupIds.length === 0) {
		return [];
	}
	return db
		.selectDistinct({ groupId: s.userGroupMember.groupId, userId: s.userGroupMember.userId })
		.from(s.userGroupMember)
		.where(inArray(s.userGroupMember.groupId, groupIds))
		.execute();
};

export const setPersonalBudget = async (projectId: string, userId: string, limitUsd: number | null): Promise<void> => {
	await writePersonalBudget(db, projectId, userId, limitUsd).execute();
};

export const setGroupBudget = async (projectId: string, groupId: string, limitUsd: number | null): Promise<void> => {
	await writeGroupBudget(db, projectId, groupId, limitUsd).execute();
};

export const setGroupSharedBudget = async (
	projectId: string,
	groupId: string,
	limitUsd: number | null,
): Promise<void> => {
	await writeGroupSharedBudget(db, projectId, groupId, limitUsd).execute();
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

/** Spend of every project member, or only of `userIds`, across all providers over the current `period`, keyed by user id. */
export const getPeriodCostsByUser = async (
	projectId: string,
	period: MemberBudgetPeriod,
	userIds?: string[],
): Promise<Record<string, number>> => {
	const rows = await queryAllProviderCosts(projectId, period, { userIds });
	const costByUser: Record<string, number> = {};
	for (const row of rows) {
		if (row.userId) {
			costByUser[row.userId] = (costByUser[row.userId] ?? 0) + Number(row.totalCost ?? 0);
		}
	}
	return costByUser;
};

export const getUserPeriodCost = async (
	projectId: string,
	userId: string,
	period: MemberBudgetPeriod,
): Promise<number> => {
	const rows = await queryAllProviderCosts(projectId, period, { userId });
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

/** Records a member's notice that a group's shared budget is used up; returns false when it was already recorded. */
export const claimGroupBudgetNotification = async (
	projectId: string,
	groupId: string,
	userId: string,
	periodStart: Date,
): Promise<boolean> => {
	const rows = await db
		.insert(s.groupBudgetNotification)
		.values({ projectId, groupId, userId, periodStart })
		.onConflictDoNothing()
		.returning({ id: s.groupBudgetNotification.id })
		.execute();
	return rows.length > 0;
};

export const releaseGroupBudgetNotification = async (
	groupId: string,
	userId: string,
	periodStart: Date,
): Promise<void> => {
	await db
		.delete(s.groupBudgetNotification)
		.where(
			and(
				eq(s.groupBudgetNotification.groupId, groupId),
				eq(s.groupBudgetNotification.userId, userId),
				eq(s.groupBudgetNotification.periodStart, periodStart),
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
		...input.groupSharedBudgets.map(({ groupId, limitUsd }) =>
			writeGroupSharedBudget(executor, projectId, groupId, limitUsd),
		),
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

/** Upserts the shared budget, or deletes it when `limitUsd` is null or 0 since a shared budget of 0 caps nothing. */
function writeGroupSharedBudget(executor: DBExecutor, projectId: string, groupId: string, limitUsd: number | null) {
	if (!limitUsd) {
		return executor
			.delete(s.projectGroupSharedBudget)
			.where(
				and(
					eq(s.projectGroupSharedBudget.projectId, projectId),
					eq(s.projectGroupSharedBudget.groupId, groupId),
				),
			);
	}
	return executor
		.insert(s.projectGroupSharedBudget)
		.values({ projectId, groupId, limitUsd })
		.onConflictDoUpdate({
			target: s.projectGroupSharedBudget.groupId,
			set: { limitUsd, updatedAt: new Date() },
		});
}

/** Member budgets span every provider, named instances included, over the member budget's period. */
function queryAllProviderCosts(
	projectId: string,
	period: MemberBudgetPeriod,
	senders: { userId?: string; userIds?: string[] },
) {
	return queryAllProvidersCostsSince(projectId, getCurrentPeriodStart(period), senders);
}

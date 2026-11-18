/* @license Enterprise */

import { getNextPeriodStart } from '@nao/shared/date';
import {
	DEFAULT_MEMBER_BUDGET_PERIOD,
	type InheritedMemberBudgetSource,
	type MemberBudgetSource,
	resolveMemberBudgetLimit,
} from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import { roundCost } from '../queries/budget.queries';
import * as memberBudgetQueries from '../queries/member-budget.queries';
import { hasFeature, LICENSE_FEATURES } from '../services/license.service';
import { listActiveUserGroups } from '../services/user-group-availability.service';

export type MemberBudgetConfig = { period: MemberBudgetPeriod; defaultLimitUsd: number };

export type MemberBudgetLimit = {
	limitUsd: number;
	source: MemberBudgetSource;
	period: MemberBudgetPeriod;
	personalLimitUsd: number | null;
	inheritedLimitUsd: number;
	inheritedSource: InheritedMemberBudgetSource;
};

export type MemberBudgetUsage = {
	limitUsd: number;
	source: MemberBudgetSource;
	spendUsd: number;
	ratio: number;
	period: MemberBudgetPeriod;
	resetsAt: Date;
};

export type GroupSharedBudgetUsage = {
	groupId: string;
	groupName: string;
	limitUsd: number;
	spendUsd: number;
	ratio: number;
	period: MemberBudgetPeriod;
	resetsAt: Date;
};

export function isMemberBudgetLicensed(projectId: string): Promise<boolean> {
	return hasFeature(LICENSE_FEATURES.userBudget, { projectId });
}

export async function assertMemberBudgetLicensed(projectId: string): Promise<void> {
	if (!(await isMemberBudgetLicensed(projectId))) {
		throw new TRPCError({ code: 'FORBIDDEN', message: 'Member budgets require an Enterprise license.' });
	}
}

export async function getMemberBudgetConfig(projectId: string): Promise<MemberBudgetConfig> {
	const settings = await memberBudgetQueries.getMemberBudgetSettings(projectId);
	if (!settings) {
		return { period: DEFAULT_MEMBER_BUDGET_PERIOD, defaultLimitUsd: 0 };
	}
	return { period: settings.period, defaultLimitUsd: settings.defaultLimitUsd };
}

/** Current-period usage of a member against their cross-provider budget. */
export async function resolveMemberBudgetUsage(projectId: string, userId: string): Promise<MemberBudgetUsage | null> {
	if (!(await isMemberBudgetLicensed(projectId))) {
		return null;
	}

	const { limitUsd, source, period } = await getMemberBudgetLimit(projectId, userId);
	const spendUsd = await memberBudgetQueries.getUserPeriodCost(projectId, userId, period);
	return {
		limitUsd,
		source,
		spendUsd,
		ratio: limitUsd > 0 ? spendUsd / limitUsd : 0,
		period,
		resetsAt: getNextPeriodStart(period),
	};
}

/** Current-period usage of the shared budgets of a member's groups, each covering the spend of all its members. */
export async function resolveGroupSharedBudgetUsages(
	projectId: string,
	userId: string,
): Promise<GroupSharedBudgetUsage[]> {
	if (!(await isMemberBudgetLicensed(projectId))) {
		return [];
	}

	const sharedBudgets = await listActiveGroupSharedBudgets(projectId, userId);
	if (sharedBudgets.length === 0) {
		return [];
	}
	const groupIds = sharedBudgets.map((sharedBudget) => sharedBudget.groupId);
	const [{ period }, memberships] = await Promise.all([
		getMemberBudgetConfig(projectId),
		memberBudgetQueries.listGroupMemberships(groupIds),
	]);
	const memberIds = [...new Set(memberships.map((membership) => membership.userId))];
	const spendByUser = await memberBudgetQueries.getPeriodCostsByUser(projectId, period, memberIds);
	const spendByGroup = sumSpendByGroup(memberships, spendByUser);
	const resetsAt = getNextPeriodStart(period);
	return sharedBudgets.map(({ groupId, groupName, limitUsd }) => {
		const spendUsd = spendByGroup[groupId] ?? 0;
		return { groupId, groupName, limitUsd, spendUsd, ratio: spendUsd / limitUsd, period, resetsAt };
	});
}

/** A member counts once per group, even when both added by hand and synced from SSO. */
export function sumSpendByGroup(
	memberships: Array<{ groupId: string; userId: string }>,
	spendByUser: Record<string, number>,
): Record<string, number> {
	const memberIdsByGroup = new Map<string, Set<string>>();
	for (const { groupId, userId } of memberships) {
		const memberIds = memberIdsByGroup.get(groupId) ?? new Set<string>();
		memberIds.add(userId);
		memberIdsByGroup.set(groupId, memberIds);
	}
	const spendByGroup: Record<string, number> = {};
	for (const [groupId, memberIds] of memberIdsByGroup) {
		spendByGroup[groupId] = roundCost([...memberIds].reduce((total, id) => total + (spendByUser[id] ?? 0), 0));
	}
	return spendByGroup;
}

/** Budget that applies to a member and where it comes from; a limit of 0 means no limit. */
export async function getMemberBudgetLimit(projectId: string, userId: string): Promise<MemberBudgetLimit> {
	const [config, personalBudget, groupLimits] = await Promise.all([
		getMemberBudgetConfig(projectId),
		memberBudgetQueries.getPersonalBudget(projectId, userId),
		listActiveGroupBudgetLimits(projectId, userId),
	]);
	const personalLimitUsd = personalBudget?.limitUsd ?? null;
	const inheritedSource: InheritedMemberBudgetSource = groupLimits.length > 0 ? 'group' : 'default';
	return {
		limitUsd: resolveMemberBudgetLimit(personalLimitUsd, groupLimits, config.defaultLimitUsd),
		source: personalLimitUsd === null ? inheritedSource : 'personal',
		period: config.period,
		personalLimitUsd,
		inheritedLimitUsd: resolveMemberBudgetLimit(null, groupLimits, config.defaultLimitUsd),
		inheritedSource,
	};
}

/** Budgets of user groups locked on the free plan are kept but no longer apply. */
async function listActiveGroupBudgetLimits(projectId: string, userId: string): Promise<number[]> {
	const groupBudgets = await memberBudgetQueries.listGroupBudgetsForMember(projectId, userId);
	if (groupBudgets.length === 0) {
		return [];
	}
	const activeGroupIds = await listActiveGroupIds(projectId);
	return groupBudgets
		.filter((groupBudget) => activeGroupIds.has(groupBudget.groupId))
		.map((groupBudget) => groupBudget.limitUsd);
}

async function listActiveGroupSharedBudgets(
	projectId: string,
	userId: string,
): Promise<Array<{ groupId: string; groupName: string; limitUsd: number }>> {
	const sharedBudgets = await memberBudgetQueries.listGroupSharedBudgetsForMember(projectId, userId);
	if (sharedBudgets.length === 0) {
		return [];
	}
	const activeGroupIds = await listActiveGroupIds(projectId);
	return sharedBudgets.filter(
		(sharedBudget) => sharedBudget.limitUsd > 0 && activeGroupIds.has(sharedBudget.groupId),
	);
}

async function listActiveGroupIds(projectId: string): Promise<Set<string>> {
	return new Set((await listActiveUserGroups(projectId)).map((group) => group.id));
}

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

export function isMemberBudgetLicensed(): Promise<boolean> {
	return hasFeature(LICENSE_FEATURES.userBudget);
}

export async function assertMemberBudgetLicensed(): Promise<void> {
	if (!(await isMemberBudgetLicensed())) {
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

/** Current-period usage of a member against their cross-provider budget, or null when none applies. */
export async function resolveMemberBudgetUsage(projectId: string, userId: string): Promise<MemberBudgetUsage | null> {
	if (!(await isMemberBudgetLicensed())) {
		return null;
	}

	const { limitUsd, source, period } = await getMemberBudgetLimit(projectId, userId);
	if (limitUsd <= 0) {
		return null;
	}

	const spendUsd = await memberBudgetQueries.getUserPeriodCost(projectId, userId, period);
	return {
		limitUsd,
		source,
		spendUsd,
		ratio: spendUsd / limitUsd,
		period,
		resetsAt: getNextPeriodStart(period),
	};
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
	const activeGroupIds = new Set((await listActiveUserGroups(projectId)).map((group) => group.id));
	return groupBudgets
		.filter((groupBudget) => activeGroupIds.has(groupBudget.groupId))
		.map((groupBudget) => groupBudget.limitUsd);
}

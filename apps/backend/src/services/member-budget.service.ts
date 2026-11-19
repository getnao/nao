/* @license Enterprise */

import { getNextPeriodStart } from '@nao/shared/date';
import type { InheritedMemberBudgetSource, MemberBudgetSource } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as memberBudgetQueries from '../queries/member-budget.queries';
import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { SetMemberBudgetsInput, SetPersonalBudgetInput } from '../types/member-budget';
import { getMemberBudgetConfig, getMemberBudgetLimit } from '../utils/member-budget';
import { listActiveUserGroups } from './user-group-availability.service';

export interface MemberBudgetRow {
	id: string;
	name: string;
	email: string;
	spendUsd: number;
	personalLimitUsd: number | null;
	groupIds: string[];
}

export interface MemberBudgetOverview {
	period: MemberBudgetPeriod;
	defaultLimitUsd: number;
	groups: Array<{ id: string; name: string; isDefault: boolean; limitUsd: number | null }>;
	members: MemberBudgetRow[];
}

export interface MemberBudgetSettings {
	period: MemberBudgetPeriod;
	defaultLimitUsd: number;
	groupBudgets: Array<{ groupId: string; limitUsd: number }>;
}

export interface MemberBudget {
	limitUsd: number;
	source: MemberBudgetSource;
	personalLimitUsd: number | null;
	inheritedLimitUsd: number;
	inheritedSource: InheritedMemberBudgetSource;
	spendUsd: number;
	period: MemberBudgetPeriod;
	nextPeriodStart: Date;
}

/** Spend per user over the current window of `period`, used to preview a period before it is saved. */
export async function getMemberSpendForPeriod(
	projectId: string,
	period: MemberBudgetPeriod,
): Promise<Record<string, number>> {
	return memberBudgetQueries.getPeriodCostsByUser(projectId, period);
}

export async function getMemberBudgetOverview(projectId: string): Promise<MemberBudgetOverview> {
	const config = await getMemberBudgetConfig(projectId);

	const [members, personalBudgets, groupBudgets, spendByUser, groups, memberships, ssoMemberships] =
		await Promise.all([
			projectQueries.listUsersWithProjectAccess(projectId),
			memberBudgetQueries.listPersonalBudgets(projectId),
			memberBudgetQueries.listGroupBudgets(projectId),
			memberBudgetQueries.getPeriodCostsByUser(projectId, config.period),
			listActiveUserGroups(projectId),
			userGroupQueries.listUserGroupMemberships(projectId),
			userGroupQueries.listUserGroupSsoMemberships(projectId),
		]);

	const personalLimitByUser = new Map(personalBudgets.map((budget) => [budget.userId, budget.limitUsd]));
	const budgetByGroup = new Map(groupBudgets.map((groupBudget) => [groupBudget.groupId, groupBudget.limitUsd]));
	const groupIdsByUser = new Map<string, Set<string>>();
	for (const membership of [...memberships, ...ssoMemberships]) {
		const groupIds = groupIdsByUser.get(membership.userId) ?? new Set<string>();
		groupIds.add(membership.groupId);
		groupIdsByUser.set(membership.userId, groupIds);
	}

	return {
		period: config.period,
		defaultLimitUsd: config.defaultLimitUsd,
		groups: groups.map(({ id, name, isDefault }) => ({
			id,
			name,
			isDefault,
			limitUsd: isDefault ? config.defaultLimitUsd : (budgetByGroup.get(id) ?? null),
		})),
		members: members.map((member) => ({
			id: member.id,
			name: member.name,
			email: member.email,
			spendUsd: spendByUser[member.id] ?? 0,
			personalLimitUsd: personalLimitByUser.get(member.id) ?? null,
			groupIds: [...(groupIdsByUser.get(member.id) ?? [])],
		})),
	};
}

export async function getMemberBudgetSettings(projectId: string): Promise<MemberBudgetSettings> {
	const [config, groupBudgets] = await Promise.all([
		getMemberBudgetConfig(projectId),
		memberBudgetQueries.listGroupBudgets(projectId),
	]);
	return {
		period: config.period,
		defaultLimitUsd: config.defaultLimitUsd,
		groupBudgets: groupBudgets.map(({ groupId, limitUsd }) => ({ groupId, limitUsd })),
	};
}

export async function getMemberBudget(projectId: string, userId: string): Promise<MemberBudget> {
	const budgetLimit = await getMemberBudgetLimit(projectId, userId);
	const spendUsd = await memberBudgetQueries.getUserPeriodCost(projectId, userId, budgetLimit.period);
	return { ...budgetLimit, spendUsd, nextPeriodStart: getNextPeriodStart(budgetLimit.period) };
}

export async function setPersonalBudget(projectId: string, input: SetPersonalBudgetInput): Promise<void> {
	await memberBudgetQueries.setPersonalBudget(projectId, input.userId, input.limitUsd);
}

export async function saveMemberBudgets(projectId: string, input: SetMemberBudgetsInput): Promise<void> {
	const [members, budgetableGroupIds] = await Promise.all([
		projectQueries.listUsersWithProjectAccess(projectId),
		listBudgetableGroupIds(projectId),
	]);
	const memberIds = new Set(members.map((member) => member.id));
	const personalBudgets = input.personalBudgets.filter((budget) => memberIds.has(budget.userId));
	const groupBudgets = input.groupBudgets.filter((budget) => budgetableGroupIds.has(budget.groupId));
	await memberBudgetQueries.saveMemberBudgets(projectId, { ...input, personalBudgets, groupBudgets });
}

/** All Users includes every member, so its budget is the project's default per-member budget. */
export async function setGroupBudget(projectId: string, groupId: string, limitUsd: number | null): Promise<void> {
	const group = (await listActiveUserGroups(projectId)).find((candidate) => candidate.id === groupId);
	if (!group) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'User group not found.' });
	}
	if (group.isDefault) {
		await memberBudgetQueries.setDefaultMemberBudgetLimit(projectId, limitUsd ?? 0);
		return;
	}
	await memberBudgetQueries.setGroupBudget(projectId, groupId, limitUsd);
}

async function listBudgetableGroupIds(projectId: string): Promise<Set<string>> {
	const groups = await listActiveUserGroups(projectId);
	return new Set(groups.filter((group) => !group.isDefault).map((group) => group.id));
}

/* @license Enterprise */

import { getNextPeriodStart } from '@nao/shared/date';
import type { InheritedMemberBudgetSource, MemberBudgetSource } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';

import * as memberBudgetQueries from '../queries/member-budget.queries';
import * as projectQueries from '../queries/project.queries';
import * as userGroupQueries from '../queries/user-group.queries';
import type { SetMemberBudgetsInput, SetPersonalBudgetInput } from '../types/member-budget';
import {
	getMemberBudgetConfig,
	getMemberBudgetLimit,
	type GroupSharedBudgetUsage,
	resolveGroupSharedBudgetUsages,
	sumSpendByGroup,
} from '../utils/member-budget';
import { listActiveUserGroups } from './user-group-availability.service';

export interface MemberBudgetRow {
	id: string;
	name: string;
	email: string;
	spendUsd: number;
	personalLimitUsd: number | null;
	groupIds: string[];
}

export interface MemberBudgetGroup {
	id: string;
	name: string;
	isDefault: boolean;
	limitUsd: number | null;
	sharedLimitUsd: number | null;
	spendUsd: number;
}

export interface MemberBudgetOverview {
	period: MemberBudgetPeriod;
	defaultLimitUsd: number;
	groups: MemberBudgetGroup[];
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
	groupSharedBudgets: GroupSharedBudgetUsage[];
}

export interface MemberSpendForPeriod {
	members: Record<string, number>;
	groups: Record<string, number>;
}

/** Spend per user and per group over the current window of `period`, used to preview a period before it is saved. */
export async function getMemberSpendForPeriod(
	projectId: string,
	period: MemberBudgetPeriod,
): Promise<MemberSpendForPeriod> {
	const [spendByUser, memberships, groups] = await Promise.all([
		memberBudgetQueries.getPeriodCostsByUser(projectId, period),
		listProjectGroupMemberships(projectId),
		listActiveUserGroups(projectId),
	]);
	const defaultGroupId = groups.find((group) => group.isDefault)?.id;
	return { members: spendByUser, groups: sumSpendByGroup(memberships, spendByUser, defaultGroupId) };
}

export async function getMemberBudgetOverview(projectId: string): Promise<MemberBudgetOverview> {
	const config = await getMemberBudgetConfig(projectId);

	const [members, personalBudgets, groupBudgets, groupSharedBudgets, spendByUser, groups, memberships] =
		await Promise.all([
			projectQueries.listUsersWithProjectAccess(projectId),
			memberBudgetQueries.listPersonalBudgets(projectId),
			memberBudgetQueries.listGroupBudgets(projectId),
			memberBudgetQueries.listGroupSharedBudgets(projectId),
			memberBudgetQueries.getPeriodCostsByUser(projectId, config.period),
			listActiveUserGroups(projectId),
			listProjectGroupMemberships(projectId),
		]);

	const personalLimitByUser = new Map(personalBudgets.map((budget) => [budget.userId, budget.limitUsd]));
	const budgetByGroup = new Map(groupBudgets.map((groupBudget) => [groupBudget.groupId, groupBudget.limitUsd]));
	const sharedBudgetByGroup = new Map(groupSharedBudgets.map((budget) => [budget.groupId, budget.limitUsd]));
	const spendByGroup = sumSpendByGroup(memberships, spendByUser, groups.find((group) => group.isDefault)?.id);
	const groupIdsByUser = new Map<string, Set<string>>();
	for (const membership of memberships) {
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
			sharedLimitUsd: sharedBudgetByGroup.get(id) ?? null,
			spendUsd: spendByGroup[id] ?? 0,
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
	const [budgetLimit, groupSharedBudgets] = await Promise.all([
		getMemberBudgetLimit(projectId, userId),
		resolveGroupSharedBudgetUsages(projectId, userId),
	]);
	const spendUsd = await memberBudgetQueries.getUserPeriodCost(projectId, userId, budgetLimit.period);
	return {
		...budgetLimit,
		spendUsd,
		nextPeriodStart: getNextPeriodStart(budgetLimit.period),
		groupSharedBudgets,
	};
}

export async function setPersonalBudget(projectId: string, input: SetPersonalBudgetInput): Promise<void> {
	await memberBudgetQueries.setPersonalBudget(projectId, input.userId, input.limitUsd);
}

export async function saveMemberBudgets(projectId: string, input: SetMemberBudgetsInput): Promise<void> {
	const [members, groups] = await Promise.all([
		projectQueries.listUsersWithProjectAccess(projectId),
		listActiveUserGroups(projectId),
	]);
	const memberIds = new Set(members.map((member) => member.id));
	const activeGroupIds = new Set(groups.map((group) => group.id));
	const budgetableGroupIds = new Set(groups.filter((group) => !group.isDefault).map((group) => group.id));
	const personalBudgets = input.personalBudgets.filter((budget) => memberIds.has(budget.userId));
	const groupBudgets = input.groupBudgets.filter((budget) => budgetableGroupIds.has(budget.groupId));
	const groupSharedBudgets = input.groupSharedBudgets.filter((budget) => activeGroupIds.has(budget.groupId));
	await memberBudgetQueries.saveMemberBudgets(projectId, {
		...input,
		personalBudgets,
		groupBudgets,
		groupSharedBudgets,
	});
}

/** All Users includes every member, so its budget is the project's default per-member budget. */
export async function setGroupBudget(projectId: string, groupId: string, limitUsd: number | null): Promise<void> {
	const group = await getActiveGroup(projectId, groupId);
	if (group.isDefault) {
		await memberBudgetQueries.setDefaultMemberBudgetLimit(projectId, limitUsd ?? 0);
		return;
	}
	await memberBudgetQueries.setGroupBudget(projectId, groupId, limitUsd);
}

export async function setGroupSharedBudget(projectId: string, groupId: string, limitUsd: number | null): Promise<void> {
	await getActiveGroup(projectId, groupId);
	await memberBudgetQueries.setGroupSharedBudget(projectId, groupId, limitUsd);
}

async function getActiveGroup(projectId: string, groupId: string) {
	const group = (await listActiveUserGroups(projectId)).find((candidate) => candidate.id === groupId);
	if (!group) {
		throw new TRPCError({ code: 'NOT_FOUND', message: 'User group not found.' });
	}
	return group;
}

async function listProjectGroupMemberships(projectId: string): Promise<Array<{ groupId: string; userId: string }>> {
	const [memberships, ssoMemberships] = await Promise.all([
		userGroupQueries.listUserGroupMemberships(projectId),
		userGroupQueries.listUserGroupSsoMemberships(projectId),
	]);
	return [...memberships, ...ssoMemberships];
}

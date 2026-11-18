/* @license Enterprise */

import { getCurrentPeriodStart, getNextPeriodStart } from '@nao/shared/date';
import {
	getMemberBudgetStatus,
	MEMBER_BUDGET_SOURCE_LABELS,
	MEMBER_BUDGET_STATUS_LABELS,
	type MemberBudgetSource,
	type MemberBudgetStatus,
	resolveMemberBudgetLimit,
} from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';

import { roundCost } from '../queries/budget.queries';
import { buildCsv } from '../utils/csv';
import { getMemberBudgetOverview, type MemberBudgetOverview, type MemberBudgetRow } from './member-budget.service';

export interface MemberBudgetReportRow {
	name: string;
	email: string;
	groups: string[];
	spendUsd: number;
	/** `null` when the member has no limit. */
	limitUsd: number | null;
	source: MemberBudgetSource;
	remainingUsd: number | null;
	status: MemberBudgetStatus;
}

export interface MemberBudgetReport {
	period: MemberBudgetPeriod;
	periodStart: Date;
	resetsAt: Date;
	members: MemberBudgetReportRow[];
}

const CSV_HEADER = [
	'Member',
	'Email',
	'Groups',
	'Period',
	'Period start',
	'Resets on',
	'Usage (USD)',
	'Budget (USD)',
	'Budget source',
	'Remaining (USD)',
	'Status',
];

/** Saved budgets and current-period usage of every member, highest spenders first. */
export async function getMemberBudgetReport(projectId: string): Promise<MemberBudgetReport> {
	const overview = await getMemberBudgetOverview(projectId);
	const members = overview.members.map((member) => buildReportRow(member, overview));
	return {
		period: overview.period,
		periodStart: getCurrentPeriodStart(overview.period),
		resetsAt: getNextPeriodStart(overview.period),
		members: members.sort((left, right) => right.spendUsd - left.spendUsd || left.name.localeCompare(right.name)),
	};
}

export function buildMemberBudgetReportCsv(report: MemberBudgetReport): string {
	const periodStart = toDateString(report.periodStart);
	const resetsAt = toDateString(report.resetsAt);
	return buildCsv(
		CSV_HEADER,
		report.members.map((member) => [
			member.name,
			member.email,
			member.groups.join('; '),
			report.period,
			periodStart,
			resetsAt,
			member.spendUsd,
			member.limitUsd,
			MEMBER_BUDGET_SOURCE_LABELS[member.source],
			member.remainingUsd,
			MEMBER_BUDGET_STATUS_LABELS[member.status],
		]),
	);
}

function buildReportRow(member: MemberBudgetRow, overview: MemberBudgetOverview): MemberBudgetReportRow {
	const memberGroups = overview.groups.filter((group) => group.isDefault || member.groupIds.includes(group.id));
	const groupLimits = memberGroups.flatMap((group) =>
		!group.isDefault && group.limitUsd !== null ? [group.limitUsd] : [],
	);
	const limitUsd = resolveMemberBudgetLimit(member.personalLimitUsd, groupLimits, overview.defaultLimitUsd);
	const hasLimit = limitUsd > 0;
	return {
		name: member.name,
		email: member.email,
		groups: memberGroups.map((group) => group.name),
		spendUsd: member.spendUsd,
		limitUsd: hasLimit ? limitUsd : null,
		source: resolveBudgetSource(member.personalLimitUsd, groupLimits),
		remainingUsd: hasLimit ? roundCost(Math.max(0, limitUsd - member.spendUsd)) : null,
		status: getMemberBudgetStatus(member.spendUsd, limitUsd),
	};
}

function resolveBudgetSource(personalLimitUsd: number | null, groupLimits: number[]): MemberBudgetSource {
	if (personalLimitUsd !== null) {
		return 'personal';
	}
	return groupLimits.length > 0 ? 'group' : 'default';
}

function toDateString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

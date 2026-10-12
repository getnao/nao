import { type MemberBudgetPeriod, WARNING_BUDGET_THRESHOLD } from './types';

export const DEFAULT_MEMBER_BUDGET_PERIOD: MemberBudgetPeriod = 'month';
export const MEMBER_BUDGET_STEP_USD = 100;
export const MEMBER_BUDGET_MAX_PRESET_USD = 2_000;

export type MemberBudgetStatus = 'under' | 'close' | 'exceeded' | 'unlimited';

export type MemberBudgetSource = 'personal' | 'group' | 'default';
export type InheritedMemberBudgetSource = Exclude<MemberBudgetSource, 'personal'>;

/* personal budget > most permissive budget among their groups > project default */
export function resolveMemberBudgetLimit(
	personalLimitUsd: number | null | undefined,
	groupLimitsUsd: number[],
	defaultLimitUsd: number,
): number {
	if (personalLimitUsd !== null && personalLimitUsd !== undefined) {
		return personalLimitUsd;
	}
	if (groupLimitsUsd.length === 0) {
		return defaultLimitUsd;
	}
	return groupLimitsUsd.includes(0) ? 0 : Math.max(...groupLimitsUsd);
}

export function getMemberBudgetStatus(spendUsd: number, limitUsd: number): MemberBudgetStatus {
	if (limitUsd <= 0) {
		return 'unlimited';
	}
	const ratio = spendUsd / limitUsd;
	if (ratio >= 1) {
		return 'exceeded';
	}
	if (ratio >= WARNING_BUDGET_THRESHOLD) {
		return 'close';
	}
	return 'under';
}

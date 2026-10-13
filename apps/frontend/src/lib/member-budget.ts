import { MEMBER_BUDGET_MAX_PRESET_USD, MEMBER_BUDGET_STEP_USD } from '@nao/shared/member-budget';
import { MAX_BUDGET_LIMIT_USD } from '@nao/shared/types';
import type { MemberBudgetSource, MemberBudgetStatus } from '@nao/shared/member-budget';
import type { MemberBudgetPeriod } from '@nao/shared/types';

export const PERIOD_LABELS: Record<MemberBudgetPeriod, string> = {
	week: 'Week',
	month: 'Month',
	year: 'Year',
};

export const PERIOD_RANGE_HINTS: Record<MemberBudgetPeriod, string> = {
	week: 'Monday 00:00 → Sunday 24:00 (UTC)',
	month: '1st → last day of the month (UTC)',
	year: 'January 1st → December 31st (UTC)',
};

export const STATUS_META: Record<MemberBudgetStatus, { label: string; className: string }> = {
	exceeded: { label: 'Over budget', className: 'bg-destructive/10 text-destructive' },
	close: { label: 'Close to limit', className: 'bg-amber-500/10 text-amber-600 dark:text-amber-500' },
	under: { label: 'Under budget', className: 'bg-green-500/10 text-green-600 dark:text-green-500' },
	unlimited: { label: 'No limit', className: 'bg-muted text-muted-foreground' },
};

export const LIMIT_PRESETS_USD = Array.from(
	{ length: MEMBER_BUDGET_MAX_PRESET_USD / MEMBER_BUDGET_STEP_USD + 1 },
	(_, index) => index * MEMBER_BUDGET_STEP_USD,
);

export function clampLimit(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.round(Math.min(MAX_BUDGET_LIMIT_USD, Math.max(0, value)));
}

export function formatUsd(value: number, fractionDigits = 0): string {
	return `$${value.toLocaleString('en-US', {
		minimumFractionDigits: fractionDigits,
		maximumFractionDigits: fractionDigits,
	})}`;
}

export const BUDGET_SOURCE_LABELS: Record<MemberBudgetSource, string> = {
	personal: 'Personal limit',
	group: 'User group limit',
	default: 'Workspace default limit',
};

/** Limits added, edited or cleared since the last save; a cleared limit is sent as `null`. */
export function listChangedLimits(
	saved: Record<string, number>,
	draft: Record<string, number>,
): Array<{ id: string; limitUsd: number | null }> {
	const ids = new Set([...Object.keys(saved), ...Object.keys(draft)]);
	return [...ids].filter((id) => saved[id] !== draft[id]).map((id) => ({ id, limitUsd: draft[id] ?? null }));
}

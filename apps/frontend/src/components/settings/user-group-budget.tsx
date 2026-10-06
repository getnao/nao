/* @license Enterprise */

import { Link } from '@tanstack/react-router';
import type { MemberBudgetPeriod } from '@nao/shared/types';

import { BudgetCell } from '@/components/settings/budget-cell';
import { BudgetLimitRow } from '@/components/settings/budget-limit-row';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { PERIOD_LABELS } from '@/lib/member-budget';

interface UserGroupBudgetProps {
	isLicensed: boolean;
	isDefaultGroup: boolean;
	isLoading: boolean;
	isError: boolean;
	limitUsd: number | null;
	defaultLimitUsd: number;
	period: MemberBudgetPeriod;
	onLimitChange: (limitUsd: number | null) => void;
}

export function UserGroupBudget({
	isLicensed,
	isDefaultGroup,
	isLoading,
	isError,
	limitUsd,
	defaultLimitUsd,
	period,
	onLimitChange,
}: UserGroupBudgetProps) {
	return (
		<section className='flex min-h-64 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h3 className='text-sm font-medium'>Budget per member</h3>
					<p className='mt-1 text-xs text-muted-foreground'>
						Cap what each member of this group can spend across all providers.
					</p>
				</div>
			</div>
			{!isLicensed ? (
				<div className='flex items-start justify-between gap-4 rounded-lg border px-3 py-3'>
					<div className='min-w-0'>
						<p className='text-sm font-medium'>Enterprise feature inactive</p>
						<p className='text-xs text-muted-foreground'>No member budget is currently enforced.</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			) : isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading budgets...</p>
			) : isError ? (
				<p className='text-sm text-destructive'>Failed to load budgets. Reload the page to edit them.</p>
			) : (
				<BudgetLimitRow
					description={
						isDefaultGroup
							? 'Everyone starts with this budget unless a group or personal budget applies.'
							: 'Members get this budget instead of the project default.'
					}
					unitLabel={`/member per ${PERIOD_LABELS[period].toLowerCase()}`}
				>
					{isDefaultGroup ? (
						<BudgetCell
							limitUsd={limitUsd ?? 0}
							onChange={(value) => onLimitChange(value ?? 0)}
							className='w-36'
						/>
					) : (
						<BudgetCell
							limitUsd={limitUsd ?? defaultLimitUsd}
							inherited={{ source: 'default', limitUsd: defaultLimitUsd }}
							isInherited={limitUsd === null}
							onChange={onLimitChange}
							className='w-36'
						/>
					)}
				</BudgetLimitRow>
			)}
			<p className='text-xs text-muted-foreground'>
				A member&apos;s personal budget always wins, and members in several groups get the most generous group
				budget.{' '}
				<Link
					to='/settings/project/budgets'
					search={{ tab: 'advanced' }}
					className='underline underline-offset-2 hover:text-foreground'
				>
					Manage all member budgets
				</Link>
			</p>
		</section>
	);
}

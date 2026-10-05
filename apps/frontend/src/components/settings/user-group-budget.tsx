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
	limitUsd: number | null;
	defaultLimitUsd: number;
	period: MemberBudgetPeriod;
	onLimitChange: (limitUsd: number | null) => void;
}

export function UserGroupBudget({
	isLicensed,
	isDefaultGroup,
	isLoading,
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
				{!isLicensed && <UpgradeToEnterprise />}
			</div>
			{!isLicensed ? (
				<p className='rounded-md bg-muted/40 p-3 text-sm text-muted-foreground'>
					Group budgets are an Enterprise feature.
				</p>
			) : isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading budgets...</p>
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

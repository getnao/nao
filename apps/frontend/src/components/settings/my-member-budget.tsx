/* @license Enterprise */

import { useQuery } from '@tanstack/react-query';

import { MemberBudgetUsage } from '@/components/settings/member-budget-usage';
import { SettingsCard } from '@/components/ui/settings-card';
import { BUDGET_SOURCE_LABELS } from '@/lib/member-budget';
import { trpc } from '@/main';

export function MyMemberBudget() {
	const budget = useQuery(trpc.memberBudget.getMine.queryOptions());

	return (
		<SettingsCard
			title='Your budget'
			description='The spending cap your admins set for you across all providers this period.'
		>
			{budget.isLoading ? (
				<p className='text-sm text-muted-foreground'>Loading your budget…</p>
			) : budget.isError || !budget.data ? (
				<p className='text-sm text-destructive'>Failed to load your budget.</p>
			) : (
				<MemberBudgetUsage
					spendUsd={budget.data.spendUsd}
					limitUsd={budget.data.limitUsd}
					period={budget.data.period}
					nextPeriodStart={budget.data.nextPeriodStart}
					sourceLabel={BUDGET_SOURCE_LABELS[budget.data.source]}
				/>
			)}
		</SettingsCard>
	);
}

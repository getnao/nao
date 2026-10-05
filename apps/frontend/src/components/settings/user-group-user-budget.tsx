/* @license Enterprise */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { BudgetCell } from '@/components/settings/budget-cell';
import { BudgetLimitRow } from '@/components/settings/budget-limit-row';
import { MemberBudgetUsage } from '@/components/settings/member-budget-usage';
import { UnsavedChangesFooter } from '@/components/settings/unsaved-changes-footer';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { useLicenseFeatures } from '@/hooks/use-license';
import { BUDGET_SOURCE_LABELS, PERIOD_LABELS } from '@/lib/member-budget';
import { trpc } from '@/main';

export function UserGroupUserBudget({ userId }: { userId: string }) {
	const license = useLicenseFeatures();
	const isLicensed = license.data?.['user-budget'] === true;

	return (
		<div className='flex min-w-0 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h4 className='text-sm font-medium'>Budget</h4>
					<p className='text-xs text-muted-foreground'>
						Resolved from this user&apos;s personal budget, their groups and the project default.
					</p>
				</div>
				<Link
					to='/settings/project/budgets'
					search={{ tab: 'advanced' }}
					className='shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
				>
					Manage all member budgets
				</Link>
			</div>
			{license.isLoading ? (
				<BudgetStatus message='Checking member budget license...' />
			) : isLicensed ? (
				<PersonalBudgetEditor userId={userId} />
			) : (
				<div className='flex items-start justify-between gap-4 rounded-lg border px-3 py-3'>
					<div className='min-w-0'>
						<p className='text-sm font-medium'>Enterprise feature inactive</p>
						<p className='text-xs text-muted-foreground'>No member budget is currently enforced.</p>
					</div>
					<UpgradeToEnterprise />
				</div>
			)}
		</div>
	);
}

function PersonalBudgetEditor({ userId }: { userId: string }) {
	const queryClient = useQueryClient();
	const budget = useQuery(trpc.memberBudget.getForMember.queryOptions({ userId }));
	const saveMutation = useMutation(
		trpc.memberBudget.setPersonalBudget.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: [['memberBudget']] });
			},
		}),
	);
	const { draftLimitUsd, setDraftLimitUsd, isDirty, resetDraft } = usePersonalBudgetDraft(
		budget.data?.personalLimitUsd,
	);

	if (budget.isLoading) {
		return <BudgetStatus message='Loading budget...' />;
	}
	if (budget.isError || !budget.data) {
		return <BudgetStatus message='Failed to load budget.' />;
	}

	const { inheritedLimitUsd, inheritedSource, period } = budget.data;
	const effectiveLimitUsd = draftLimitUsd ?? inheritedLimitUsd;
	const periodLabel = PERIOD_LABELS[period].toLowerCase();

	return (
		<>
			<BudgetLimitRow
				description='A personal budget replaces the group and default budgets for this user.'
				unitLabel={`per ${periodLabel}`}
			>
				<BudgetCell
					limitUsd={effectiveLimitUsd}
					inherited={{ source: inheritedSource, limitUsd: inheritedLimitUsd }}
					isInherited={draftLimitUsd === null}
					onChange={setDraftLimitUsd}
					className='w-36'
				/>
			</BudgetLimitRow>
			<div className='rounded-lg border px-3 py-3'>
				<MemberBudgetUsage
					spendUsd={budget.data.spendUsd}
					limitUsd={effectiveLimitUsd}
					period={period}
					nextPeriodStart={budget.data.nextPeriodStart}
					sourceLabel={BUDGET_SOURCE_LABELS[draftLimitUsd === null ? inheritedSource : 'personal']}
				/>
			</div>
			{(isDirty || saveMutation.isPending) && (
				<UnsavedChangesFooter
					isSaving={saveMutation.isPending}
					errorMessage={saveMutation.isError ? saveMutation.error.message : undefined}
					onCancel={resetDraft}
					onSave={() => saveMutation.mutate({ userId, limitUsd: draftLimitUsd })}
				/>
			)}
		</>
	);
}

/** Follows the saved personal budget until the admin edits it; `null` means the user inherits a budget. */
function usePersonalBudgetDraft(savedLimitUsd: number | null | undefined) {
	const saved = savedLimitUsd ?? null;
	const [draftLimitUsd, setDraftLimitUsd] = useState<number | null>(saved);
	const [syncedLimitUsd, setSyncedLimitUsd] = useState<number | null>(saved);

	if (saved !== syncedLimitUsd) {
		setSyncedLimitUsd(saved);
		setDraftLimitUsd(saved);
	}

	function resetDraft() {
		setDraftLimitUsd(saved);
	}

	return { draftLimitUsd, setDraftLimitUsd, isDirty: draftLimitUsd !== saved, resetDraft };
}

function BudgetStatus({ message }: { message: string }) {
	return <div className='rounded-lg border px-3 py-3 text-sm text-muted-foreground'>{message}</div>;
}

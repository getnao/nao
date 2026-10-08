/* @license Enterprise */

import { useState } from 'react';
import { getNextPeriodStart } from '@nao/shared/date';
import { DEFAULT_MEMBER_BUDGET_PERIOD } from '@nao/shared/member-budget';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { BudgetCell } from '@/components/settings/budget-cell';
import { BudgetLimitRow } from '@/components/settings/budget-limit-row';
import { LockedFieldset } from '@/components/settings/locked-fieldset';
import { MemberBudgetUsage } from '@/components/settings/member-budget-usage';
import { UnsavedChangesFooter } from '@/components/settings/unsaved-changes-footer';
import { UpgradeToEnterprise } from '@/components/settings/upgrade-to-enterprise';
import { BUDGET_SOURCE_LABELS, PERIOD_LABELS } from '@/lib/member-budget';
import { trpc } from '@/main';

export function UserGroupUserBudget({ userId, isLicensed }: { userId: string; isLicensed: boolean }) {
	return (
		<div className='flex min-w-0 flex-col gap-4'>
			<div className='flex items-start justify-between gap-3'>
				<div>
					<h4 className='text-sm font-medium'>Budget</h4>
					<p className='text-xs text-muted-foreground'>
						Resolved from this user&apos;s personal budget, their groups and the project default.
					</p>
				</div>
				<div className='flex shrink-0 items-center gap-2'>
					{!isLicensed && <UpgradeToEnterprise />}
					<Link
						to='/settings/project/budgets'
						search={{ tab: 'advanced' }}
						className='text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground'
					>
						Manage all member budgets
					</Link>
				</div>
			</div>
			<LockedFieldset disabled={!isLicensed}>
				<PersonalBudgetEditor key={userId} userId={userId} isLicensed={isLicensed} />
			</LockedFieldset>
		</div>
	);
}

function PersonalBudgetEditor({ userId, isLicensed }: { userId: string; isLicensed: boolean }) {
	const queryClient = useQueryClient();
	const budget = useQuery({
		...trpc.memberBudget.getForMember.queryOptions({ userId }),
		enabled: isLicensed,
	});
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

	if (isLicensed && budget.isLoading) {
		return <BudgetStatus message='Loading budget...' />;
	}
	if (isLicensed && (budget.isError || !budget.data)) {
		return <BudgetStatus message='Failed to load budget.' />;
	}

	const data =
		isLicensed && budget.data
			? budget.data
			: {
					inheritedLimitUsd: 0,
					inheritedSource: 'default' as const,
					period: DEFAULT_MEMBER_BUDGET_PERIOD,
					spendUsd: 0,
					nextPeriodStart: getNextPeriodStart(DEFAULT_MEMBER_BUDGET_PERIOD),
				};
	const { inheritedLimitUsd, inheritedSource, period } = data;
	const effectiveLimitUsd = draftLimitUsd ?? inheritedLimitUsd;
	const periodLabel = PERIOD_LABELS[period].toLowerCase();

	return (
		<>
			<BudgetLimitRow
				description='A personal budget replaces the group and default budgets for this user.'
				unitLabel={`per ${periodLabel}`}
			>
				<fieldset disabled={saveMutation.isPending} className='contents'>
					<BudgetCell
						limitUsd={effectiveLimitUsd}
						inherited={{ source: inheritedSource, limitUsd: inheritedLimitUsd }}
						isInherited={draftLimitUsd === null}
						onChange={setDraftLimitUsd}
						className='w-36'
					/>
				</fieldset>
			</BudgetLimitRow>
			<div className='rounded-lg border px-3 py-3'>
				<MemberBudgetUsage
					spendUsd={data.spendUsd}
					limitUsd={effectiveLimitUsd}
					period={period}
					nextPeriodStart={data.nextPeriodStart}
					sourceLabel={BUDGET_SOURCE_LABELS[draftLimitUsd === null ? inheritedSource : 'personal']}
				/>
			</div>
			{isLicensed && (isDirty || saveMutation.isPending) && (
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

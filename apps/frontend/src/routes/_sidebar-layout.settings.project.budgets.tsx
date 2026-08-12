import { useEffect, useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react';
import { getNextPeriodStart } from '@nao/shared/date';
import {
	BUDGET_PERIODS,
	MAX_BUDGET_LIMIT_USD,
	providerKind,
	providerLabel,
	WARNING_BUDGET_THRESHOLD,
} from '@nao/shared/types';
import type { BudgetPeriod } from '@nao/shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useLicenseFeatures } from '@/hooks/use-license';
import { useLlmProviders } from '@/hooks/use-llm-providers';
import { usePermissions } from '@/hooks/use-permissions';
import { useSession } from '@/lib/auth-client';
import { cn, toLocalDateString } from '@/lib/utils';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/project/budgets')({
	component: RouteComponent,
});

type Period = 'none' | BudgetPeriod;

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
	{ value: 'none', label: '-' },
	...BUDGET_PERIODS.map((p) => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) })),
];

function buildFormState(
	data: { provider: string; limitUsd: number; perUserLimitUsd: number | null; period: string }[],
) {
	const b: Record<string, number> = {};
	const u: Record<string, number> = {};
	const p: Record<string, Period> = {};
	for (const row of data) {
		b[row.provider] = row.limitUsd;
		u[row.provider] = row.perUserLimitUsd ?? 0;
		p[row.provider] = row.period as Period;
	}
	return { budgets: b, perUserBudgets: u, periods: p };
}

function BudgetInput({
	value,
	disabled,
	onChange,
	onBlur,
}: {
	value: number;
	disabled: boolean;
	onChange: (v: number) => void;
	onBlur?: () => void;
}) {
	return (
		<div className='flex items-center gap-1'>
			<span className='text-muted-foreground text-sm mr-1'>$</span>
			<Input
				type='number'
				min={0}
				max={MAX_BUDGET_LIMIT_USD}
				disabled={disabled}
				value={value}
				onChange={(e) => onChange(Number(e.target.value))}
				onBlur={onBlur}
				className='w-16 h-7 text-center px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
			/>
			<div className='flex flex-col items-center'>
				<button
					disabled={disabled || value >= MAX_BUDGET_LIMIT_USD}
					onClick={() => onChange(Math.min(MAX_BUDGET_LIMIT_USD, value + 1))}
					className='text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 size-4 rounded-sm inline-flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed'
				>
					<ChevronUp className='size-3' />
				</button>
				<button
					disabled={disabled || value <= 0}
					onClick={() => onChange(Math.max(0, value - 1))}
					className='text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 size-4 rounded-sm inline-flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed'
				>
					<ChevronDown className='size-3' />
				</button>
			</div>
		</div>
	);
}

function RouteComponent() {
	const { isAdmin } = usePermissions();
	const { data: session } = useSession();
	const licenseFeatures = useLicenseFeatures();
	const hasUserBudget = licenseFeatures.data?.['user-budget'] === true;

	const { projectConfigs, configProviders, envProviders } = useLlmProviders();
	const allConfiguredProviders = useMemo(
		() => [
			...new Set([
				...projectConfigs.map((config) => config.provider),
				...configProviders.map((config) => config.provider),
				...envProviders,
			]),
		],
		[projectConfigs, configProviders, envProviders],
	);
	const costSupport = useQuery(trpc.budget.getProvidersCostSupport.queryOptions());

	const savedBudgets = useQuery(trpc.budget.getBudgets.queryOptions());
	const configManagedProviders = useMemo(
		() => new Set((savedBudgets.data ?? []).filter((row) => row.source === 'config').map((row) => row.provider)),
		[savedBudgets.data],
	);
	const queryClient = useQueryClient();
	const setBudgetsMutation = useMutation(
		trpc.budget.setBudgets.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: [['budget']] }),
		}),
	);

	const providerCosts = useQuery(trpc.budget.getProviderCosts.queryOptions());

	const showPerUserSpend = isAdmin && hasUserBudget;
	const perUserProviders = useMemo(() => {
		const configured = new Set(allConfiguredProviders);
		return (savedBudgets.data ?? []).filter(
			(row) => (row.perUserLimitUsd ?? 0) > 0 && configured.has(row.provider),
		);
	}, [savedBudgets.data, allConfiguredProviders]);
	const perUserSpendEnabled = showPerUserSpend && perUserProviders.length > 0;
	const perUserCosts = useQuery({
		...trpc.budget.getPerUserProviderCosts.queryOptions(),
		enabled: perUserSpendEnabled,
	});
	const projectMembers = useQuery({
		...trpc.project.listAllUsersWithRoles.queryOptions(),
		enabled: perUserSpendEnabled,
	});

	const [budgets, setBudgets] = useState<Record<string, number>>({});
	const [perUserBudgets, setPerUserBudgets] = useState<Record<string, number>>({});
	const [periods, setPeriods] = useState<Record<string, Period>>({});

	useEffect(() => {
		if (!savedBudgets.data) {
			return;
		}
		const state = buildFormState(savedBudgets.data);
		setBudgets(state.budgets);
		setPerUserBudgets(state.perUserBudgets);
		setPeriods(state.periods);
	}, [savedBudgets.data]);

	const isDirty = useMemo(() => {
		if (!savedBudgets.data) {
			return false;
		}
		const saved = buildFormState(savedBudgets.data);
		for (const provider of allConfiguredProviders) {
			if (configManagedProviders.has(provider)) {
				continue;
			}
			if (
				(saved.budgets[provider] ?? 0) !== (budgets[provider] ?? 0) ||
				(saved.perUserBudgets[provider] ?? 0) !== (perUserBudgets[provider] ?? 0) ||
				(saved.periods[provider] ?? 'none') !== (periods[provider] ?? 'none')
			) {
				return true;
			}
		}
		return false;
	}, [savedBudgets.data, budgets, perUserBudgets, periods, allConfiguredProviders, configManagedProviders]);

	function resetForm() {
		const state = buildFormState(savedBudgets.data ?? []);
		setBudgets(state.budgets);
		setPerUserBudgets(state.perUserBudgets);
		setPeriods(state.periods);
	}

	function updateBudget(provider: string, budget: number) {
		const clamped = Math.round(Math.min(MAX_BUDGET_LIMIT_USD, Math.max(0, budget)));
		setBudgets((prev) => ({ ...prev, [provider]: clamped }));
	}

	function updatePerUserBudget(provider: string, budget: number) {
		const clamped = Math.round(Math.min(MAX_BUDGET_LIMIT_USD, Math.max(0, budget)));
		setPerUserBudgets((prev) => ({ ...prev, [provider]: clamped }));
	}

	function clearPeriodIfNoBudget(provider: string) {
		if ((budgets[provider] ?? 0) === 0 && (perUserBudgets[provider] ?? 0) === 0) {
			setPeriods((prev) => ({ ...prev, [provider]: 'none' }));
		}
	}

	const resetLabels = useMemo(
		() =>
			Object.fromEntries(BUDGET_PERIODS.map((p) => [p, toLocalDateString(getNextPeriodStart(p))])) as Record<
				BudgetPeriod,
				string
			>,
		[],
	);

	async function handleSave() {
		const entries = allConfiguredProviders
			.filter((provider) => {
				if (configManagedProviders.has(provider)) {
					return false;
				}
				const hasCost = costSupport.data?.[providerKind(provider)] ?? false;
				const budget = budgets[provider] ?? 0;
				const perUserBudget = perUserBudgets[provider] ?? 0;
				const period = periods[provider] ?? 'none';
				return hasCost && (budget > 0 || perUserBudget > 0) && period !== 'none';
			})
			.map((provider) => ({
				provider,
				limitUsd: budgets[provider] ?? 0,
				perUserLimitUsd: perUserBudgets[provider] ?? 0,
				period: periods[provider] as BudgetPeriod,
			}));

		await setBudgetsMutation.mutateAsync({ budgets: entries });
	}

	return (
		<>
			<SettingsCard title='Budgets' description='Limit the budgets of your most expensive providers.'>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Provider</TableHead>
							<TableHead className='text-center'>Project limit</TableHead>
							{hasUserBudget && <TableHead className='text-center'>User limit</TableHead>}
							<TableHead className='text-center'>Period</TableHead>
							<TableHead className='text-center'>Cost</TableHead>
							<TableHead className='text-center'>Reset on</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{allConfiguredProviders.map((provider) => {
							const hasCost = costSupport.data?.[providerKind(provider)] ?? false;

							if (!hasCost) {
								return (
									<TableRow key={provider} className='h-12 opacity-50'>
										<TableCell>{providerLabel(provider)}</TableCell>
										<TableCell colSpan={hasUserBudget ? 5 : 4}>
											<span className='flex items-center gap-1.5 text-muted-foreground text-sm'>
												<TriangleAlert className='size-4' />
												Cost data unavailable for this provider — budget tracking is not
												supported.
											</span>
										</TableCell>
									</TableRow>
								);
							}

							const budget = budgets[provider] ?? 0;
							const perUserBudget = perUserBudgets[provider] ?? 0;
							const period = periods[provider] ?? 'none';
							const hasAnyBudget = budget > 0 || perUserBudget > 0;
							const isConfigManaged = configManagedProviders.has(provider);

							return (
								<TableRow key={provider}>
									<TableCell>
										<span className='flex items-center gap-2'>
											{providerLabel(provider)}
											{isConfigManaged && (
												<span
													className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground'
													title='This budget is set in nao_config.yaml'
												>
													nao_config.yaml
												</span>
											)}
										</span>
									</TableCell>
									<TableCell>
										<BudgetInput
											value={budget}
											disabled={!isAdmin || isConfigManaged}
											onChange={(v) => updateBudget(provider, v)}
											onBlur={() => clearPeriodIfNoBudget(provider)}
										/>
									</TableCell>
									{hasUserBudget && (
										<TableCell>
											<BudgetInput
												value={perUserBudget}
												disabled={!isAdmin || isConfigManaged}
												onChange={(v) => updatePerUserBudget(provider, v)}
												onBlur={() => clearPeriodIfNoBudget(provider)}
											/>
										</TableCell>
									)}
									<TableCell>
										<Select
											value={period}
											onValueChange={(val) =>
												setPeriods((prev) => ({ ...prev, [provider]: val as Period }))
											}
											disabled={!isAdmin || !hasAnyBudget || isConfigManaged}
										>
											<SelectTrigger size='sm' className='w-24'>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{PERIOD_OPTIONS.map((opt) => (
													<SelectItem key={opt.value} value={opt.value}>
														{opt.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TableCell>
									<TableCell>
										{period === 'none' ? (
											<span className='text-muted-foreground text-sm mr-1'>-</span>
										) : (
											<>
												<span className='text-muted-foreground text-sm mr-1'>$</span>
												<span className='text-sm mr-1'>
													{(providerCosts.data?.[provider] ?? 0).toFixed(2)}
												</span>
											</>
										)}
									</TableCell>
									<TableCell>{period === 'none' ? '-' : resetLabels[period]}</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>

				{isAdmin && (
					<div className='flex justify-end gap-2 pt-2'>
						<Button variant='ghost' size='sm' onClick={resetForm} disabled={!isDirty}>
							Cancel
						</Button>
						<Button
							size='sm'
							variant='primary-gradient'
							onClick={handleSave}
							disabled={!isDirty || setBudgetsMutation.isPending}
						>
							{setBudgetsMutation.isPending ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				)}
			</SettingsCard>

			{showPerUserSpend && perUserProviders.length > 0 && (
				<SettingsCard
					title='Spend per user'
					description='Current-period spend for each member, broken down by provider.'
				>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Member</TableHead>
								{perUserProviders.map((row) => (
									<TableHead key={row.provider} className='text-center'>
										{providerLabel(row.provider)}
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{(projectMembers.data ?? []).map((member) => (
								<TableRow key={member.id}>
									<TableCell className='font-medium'>
										{member.name}
										{member.id === session?.user?.id && (
											<span className='text-muted-foreground ml-1'>(you)</span>
										)}
									</TableCell>
									{perUserProviders.map((row) => {
										const spend = perUserCosts.data?.[row.provider]?.[member.id] ?? 0;
										const limit = row.perUserLimitUsd ?? 0;
										return (
											<TableCell key={row.provider} className='text-center'>
												<span className={cn('text-sm', spendClassName(spend, limit))}>
													${spend.toFixed(2)}
												</span>
											</TableCell>
										);
									})}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</SettingsCard>
			)}
		</>
	);
}

function spendClassName(spend: number, limit: number): string {
	if (limit <= 0) {
		return '';
	}
	const ratio = spend / limit;
	if (ratio >= 1) {
		return 'text-destructive font-medium';
	}
	if (ratio >= WARNING_BUDGET_THRESHOLD) {
		return 'text-amber-500 font-medium';
	}
	return '';
}

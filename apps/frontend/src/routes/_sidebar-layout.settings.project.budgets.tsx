import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { SettingsCard } from '@/components/ui/settings-card';
import { trpc } from '@/main';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLlmProviders } from '@/hooks/use-llm-providers';
import { toLocalDateString } from '@/lib/utils';

export const Route = createFileRoute('/_sidebar-layout/settings/project/budgets')({
	component: RouteComponent,
});

type Period = 'none' | 'day' | 'week' | 'month';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
	{ value: 'none', label: '-' },
	{ value: 'day', label: 'Day' },
	{ value: 'week', label: 'Week' },
	{ value: 'month', label: 'Month' },
];

const PERIOD_MS: Record<Period, number> = {
	none: 0,
	day: 24 * 60 * 60 * 1000,
	week: 7 * 24 * 60 * 60 * 1000,
	month: 30 * 24 * 60 * 60 * 1000,
};

const MAX_LIMIT_BUDGET = 200_000;

function nextResetLabel(period: Period): string {
	if (period === 'none') {
		return '-';
	}
	return toLocalDateString(new Date(Date.now() + PERIOD_MS[period]));
}

const spinnerButtonClass =
	'text-muted-foreground hover:text-foreground hover:bg-accent transition-all duration-200 size-4 rounded-sm inline-flex items-center justify-center disabled:opacity-20 disabled:cursor-not-allowed';

function RouteComponent() {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const isAdmin = project.data?.userRole === 'admin';

	const { projectConfigs, envProviders } = useLlmProviders();
	const allConfiguredProviders = [...new Set([...projectConfigs.map((config) => config.provider), ...envProviders])];
	const costSupport = useQuery(trpc.budget.getProvidersCostSupport.queryOptions());

	const [budgets, setBudgets] = useState<Record<string, number>>({});
	const [periods, setPeriods] = useState<Record<string, Period>>({});
	const [costs, setCosts] = useState<Record<string, number>>({});

	function updateBudget(provider: string, next: number) {
		const clamped = Math.min(MAX_LIMIT_BUDGET, Math.max(0, next));
		setBudgets((prev) => ({ ...prev, [provider]: clamped }));
		if (clamped === 0) {
			setPeriods((prev) => ({ ...prev, [provider]: 'none' }));
		}
	}

	return (
		<SettingsCard title='Budgets' description='Limit the budgets of your most expensive providers.'>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Provider</TableHead>
						<TableHead>Budget limit</TableHead>
						<TableHead>Period</TableHead>
						<TableHead>Cost</TableHead>
						<TableHead>Reset on</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{allConfiguredProviders.map((provider) => {
						const hasCost = costSupport.data?.[provider] ?? false;

						if (!hasCost) {
							return (
								<TableRow key={provider} className='h-12 opacity-50'>
									<TableCell>{provider}</TableCell>
									<TableCell colSpan={4}>
										<span className='flex items-center gap-1.5 text-muted-foreground text-sm'>
											<TriangleAlert className='size-4' />
											Cost data unavailable for this provider — budget tracking is not supported.
										</span>
									</TableCell>
								</TableRow>
							);
						}

						const budget = budgets[provider] ?? 0;
						const period = periods[provider] ?? 'none';
						const cost = costs[provider] ?? 0;

						return (
							<TableRow key={provider}>
								<TableCell>{provider}</TableCell>
								<TableCell>
									<div className='flex items-center gap-1'>
										<div className='flex flex-col items-center'>
											<button
												disabled={!isAdmin || budget >= MAX_LIMIT_BUDGET}
												onClick={() => updateBudget(provider, budget + 1)}
												className={spinnerButtonClass}
											>
												<ChevronUp className='size-3' />
											</button>
											<button
												disabled={!isAdmin || budget <= 0}
												onClick={() => updateBudget(provider, budget - 1)}
												className={spinnerButtonClass}
											>
												<ChevronDown className='size-3' />
											</button>
										</div>
										<Input
											type='number'
											min={0}
											max={MAX_LIMIT_BUDGET}
											disabled={!isAdmin}
											value={budget}
											onChange={(e) => updateBudget(provider, Number(e.target.value))}
											className='w-16 h-7 text-center px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
										/>
										<span className='text-muted-foreground text-sm mr-1'>$</span>
									</div>
								</TableCell>
								<TableCell>
									<Select
										value={period}
										onValueChange={(val) =>
											setPeriods((prev) => ({ ...prev, [provider]: val as Period }))
										}
										disabled={!isAdmin || budget <= 0}
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
								<TableCell>{period === 'none' ? '-' : cost}</TableCell>
								<TableCell>{nextResetLabel(period)}</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>

			<div className='flex justify-end gap-2 pt-2'>
				<Button variant='ghost' size='sm' onClick={() => {}}>
					Cancel
				</Button>
				<Button size='sm' onClick={() => {}} disabled={false}>
					Save Changes
				</Button>
			</div>
		</SettingsCard>
	);
}

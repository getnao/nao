import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { TokenChartDisplayMode, UsageRouteSearch } from '@/components/settings/usage-route-search';
import { ChatsReplayPage } from '@/components/settings/chats-replay-page';
import { UsageChartCard } from '@/components/settings/usage-chart-card';
import { UsageFilters, dateFormats } from '@/components/settings/usage-filters';
import { validateUsageSearch } from '@/components/settings/usage-route-search';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { trpc } from '@/main';
import { requireAdmin, requireContextAdminOrAdmin } from '@/lib/require-admin';

export const Route = createFileRoute('/_sidebar-layout/settings/usage')({
	beforeLoad: ({ location }) =>
		location.pathname.startsWith('/settings/usage/replay/') ? requireContextAdminOrAdmin() : requireAdmin(),
	validateSearch: validateUsageSearch,
	component: UsagePage,
});

const tokenChartDisplayOptions: { value: TokenChartDisplayMode; label: string }[] = [
	{ value: 'tokens', label: 'Show in tokens' },
	{ value: 'dollars', label: 'Show in dollars' },
];

const tokenSeries = [
	{ data_key: 'inputNoCacheTokens', color: 'var(--chart-1)', label: 'Input' },
	{ data_key: 'inputCacheReadTokens', color: 'var(--chart-2)', label: 'Cache read' },
	{ data_key: 'inputCacheWriteTokens', color: 'var(--chart-3)', label: 'Cache write' },
	{ data_key: 'outputTotalTokens', color: 'var(--chart-4)', label: 'Output' },
];

const costSeries = [
	{ data_key: 'inputNoCacheCost', color: 'var(--chart-1)', label: 'Input' },
	{ data_key: 'inputCacheReadCost', color: 'var(--chart-2)', label: 'Cache read' },
	{ data_key: 'inputCacheWriteCost', color: 'var(--chart-3)', label: 'Cache write' },
	{ data_key: 'outputCost', color: 'var(--chart-4)', label: 'Output' },
];

function UsagePage() {
	const usageSearch = Route.useSearch();
	const navigate = useNavigate();
	const isReplayRoute = useRouterState({
		select: (state) => state.location.pathname.startsWith('/settings/usage/replay/'),
	});

	if (isReplayRoute) {
		return <Outlet />;
	}

	return (
		<UsageOverview
			usageSearch={usageSearch}
			onUpdateSearch={(next) => {
				navigate({
					to: '/settings/usage',
					search: { ...usageSearch, ...next },
					replace: true,
				});
			}}
			onOpenChatReplay={(chatId) => {
				navigate({
					to: '/settings/usage/replay/$chatId',
					params: { chatId },
					search: usageSearch,
				});
			}}
		/>
	);
}

function UsageOverview({
	usageSearch,
	onUpdateSearch,
	onOpenChatReplay,
}: {
	usageSearch: UsageRouteSearch;
	onUpdateSearch: (next: Partial<UsageRouteSearch>) => void;
	onOpenChatReplay: (chatId: string) => void;
}) {
	const { granularity, provider, users, feedback, tools, tokenView } = usageSearch;

	const usedProviders = useQuery(trpc.usage.getUsedProviders.queryOptions());
	const chatFacets = useQuery({
		...trpc.project.getProjectChats.queryOptions({
			page: 0,
			pageSize: 1,
		}),
		placeholderData: keepPreviousData,
	});
	const messagesUsage = useQuery({
		...trpc.usage.getMessagesUsage.queryOptions({
			granularity,
			provider: provider === 'all' ? undefined : provider,
			userNames: users,
		}),
		placeholderData: keepPreviousData,
	});
	const totalUsage = useQuery({
		...trpc.usage.getTotalUsage.queryOptions({
			granularity,
			provider: provider === 'all' ? undefined : provider,
			userNames: users,
		}),
		placeholderData: keepPreviousData,
	});

	const chartData = messagesUsage.data ?? [];
	const totalUsageChartData = totalUsage.data ? [totalUsage.data] : [];
	const showCost = tokenView === 'dollars';

	const filtersComponent = (
		<UsageFilters
			provider={provider}
			onProviderChange={(value) => onUpdateSearch({ provider: value })}
			granularity={granularity}
			onGranularityChange={(value) => onUpdateSearch({ granularity: value })}
			availableProviders={usedProviders.data}
			chatFacets={chatFacets.data?.facets}
			selectedUserNames={users}
			onSelectedUserNamesChange={(value) => onUpdateSearch({ users: value })}
			selectedFeedbackStates={feedback}
			onSelectedFeedbackStatesChange={(value) => onUpdateSearch({ feedback: value })}
			selectedToolStates={tools}
			onSelectedToolStatesChange={(value) => onUpdateSearch({ tools: value })}
		/>
	);

	return (
		<div className='overflow-auto flex-1 min-h-0'>
			<div className='flex flex-col w-full min-h-full gap-12'>
				<div className='flex flex-col w-full gap-12 px-4 md:p-8'>
					{filtersComponent}

					<div className='grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_3fr_3fr] gap-2'>
						<div className='lg:col-span-2 xl:col-span-1'>
							<UsageChartCard
								title='Messages'
								isLoading={totalUsage.isLoading}
								isFetching={totalUsage.isFetching}
								isError={totalUsage.isError}
								data={totalUsageChartData}
								chartType='kpi_card'
								series={[
									{ data_key: 'totalMessages', label: 'Total messages', color: 'var(--chart-1)' },
									{ data_key: 'uniqueUsers', label: 'Unique users', color: 'var(--chart-2)' },
								]}
							/>
						</div>

						<UsageChartCard
							title='Messages'
							isLoading={messagesUsage.isLoading}
							isFetching={messagesUsage.isFetching}
							isError={messagesUsage.isError}
							data={chartData}
							chartType='stacked_bar'
							xAxisLabelFormatter={(value) => format(new Date(value), dateFormats[granularity])}
							titleAccessory={
								<span className='text-xs text-muted-foreground'>Number of messages by source</span>
							}
							series={[
								{ data_key: 'webMessageCount', color: 'var(--chart-1)', label: 'Web' },
								{ data_key: 'slackMessageCount', color: 'var(--chart-2)', label: 'Slack' },
								{ data_key: 'teamsMessageCount', color: 'var(--chart-3)', label: 'Teams' },
								{ data_key: 'telegramMessageCount', color: 'var(--chart-4)', label: 'Telegram' },
								{ data_key: 'whatsappMessageCount', color: 'var(--chart-5)', label: 'WhatsApp' },
							]}
						/>

						<UsageChartCard
							title={showCost ? 'Cost' : 'Tokens'}
							isLoading={messagesUsage.isLoading}
							isFetching={messagesUsage.isFetching}
							isError={messagesUsage.isError}
							data={chartData}
							chartType='stacked_bar'
							xAxisLabelFormatter={(value) => format(new Date(value), dateFormats[granularity])}
							valueFormatter={showCost ? formatUsd : undefined}
							series={showCost ? costSeries : tokenSeries}
							titleAccessory={
								<Select
									value={tokenView}
									onValueChange={(value) =>
										onUpdateSearch({ tokenView: value as TokenChartDisplayMode })
									}
								>
									<SelectTrigger size='sm' variant='ghost' className='mt-0 h-4 px-0 text-xs'>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{tokenChartDisplayOptions.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							}
						/>
					</div>
				</div>

				<section className='flex flex-1 flex-col w-full min-h-0'>
					<ChatsReplayPage
						selectedUserNames={users}
						selectedFeedbackStates={feedback}
						selectedToolStates={tools}
						onOpenChat={onOpenChatReplay}
					/>
				</section>
			</div>
		</div>
	);
}

function formatUsd(value: number): string {
	const abs = Math.abs(value);

	if (abs >= 10_000) {
		return `${value < 0 ? '-' : ''}$${formatCompactCurrency(Math.abs(value))}`;
	}

	if (abs > 0 && abs < 0.01) {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 4,
			maximumFractionDigits: 4,
		}).format(value);
	}

	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: abs === 0 ? 0 : 2,
		maximumFractionDigits: 2,
	}).format(value);
}

function formatCompactCurrency(value: number): string {
	if (value >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
	}
	return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
}

import { useEffect } from 'react';
import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TokenChartDisplayMode, UsageRouteSearch } from '@/components/settings/usage-route-search';
import type { UsageChartData } from '@/components/settings/usage-chart-card';
import type { displayChart } from '@nao/shared/tools';
import type { UsageRecord } from '@nao/backend/usage';
import { ChatsReplayPage } from '@/components/settings/chats-replay-page';
import { ChatsReplaySearchBar } from '@/components/settings/chats-replay-search-bar';
import { UsageChartCard } from '@/components/settings/usage-chart-card';
import { ReplayFilters, UsageFilters } from '@/components/settings/usage-filters';
import {
	saveUsageFilters,
	validateUsageSearch,
	validateUsageSearchWithStoredFilters,
} from '@/components/settings/usage-route-search';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePermissions } from '@/hooks/use-permissions';
import { useUsagePeriodSettings } from '@/hooks/use-usage-period-settings';
import { trpc } from '@/main';
import { requireContextAdminOrAdmin } from '@/lib/require-admin';
import { buildUserUsageChart } from '@/lib/usage-by-user';
import { formatUsageBucketLabel } from '@/lib/usage-date';

export const Route = createFileRoute('/_sidebar-layout/settings/usage')({
	beforeLoad: requireContextAdminOrAdmin,
	validateSearch: validateUsageSearchWithStoredFilters,
	component: UsagePage,
});

const USD_VALUE_FORMAT = {
	d3_format: ',.2f',
	prefix: '$',
	compact: 'financial',
} satisfies displayChart.ValueFormat;

interface UsageChart {
	data: UsageChartData;
	series: displayChart.SeriesConfig[];
	showLegend: boolean;
}

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
	{ data_key: 'inputNoCacheCost', color: 'var(--chart-1)', label: 'Input', value_format: USD_VALUE_FORMAT },
	{ data_key: 'inputCacheReadCost', color: 'var(--chart-2)', label: 'Cache read', value_format: USD_VALUE_FORMAT },
	{ data_key: 'inputCacheWriteCost', color: 'var(--chart-3)', label: 'Cache write', value_format: USD_VALUE_FORMAT },
	{ data_key: 'outputCost', color: 'var(--chart-4)', label: 'Output', value_format: USD_VALUE_FORMAT },
];

const messageSeries = [
	{ data_key: 'webMessageCount', color: 'var(--chart-1)', label: 'Web' },
	{ data_key: 'slackMessageCount', color: 'var(--chart-2)', label: 'Slack' },
	{ data_key: 'teamsMessageCount', color: 'var(--chart-3)', label: 'Teams' },
	{ data_key: 'telegramMessageCount', color: 'var(--chart-4)', label: 'Telegram' },
	{ data_key: 'whatsappMessageCount', color: 'var(--chart-5)', label: 'WhatsApp' },
	{ data_key: 'adminMessageCount', color: 'var(--chart-6)', label: 'Admin mode' },
	{ data_key: 'mcpMessageCount', color: 'var(--chart-7)', label: 'MCP' },
	{
		data_key: 'contextRecommendationsMessageCount',
		color: 'var(--chart-8)',
		label: 'Context recommendations',
	},
] as const;

function UsagePage() {
	const usageSearch = Route.useSearch();
	const navigate = Route.useNavigate();
	const isReplayRoute = useRouterState({
		select: (state) => state.location.pathname.startsWith('/settings/usage/replay/'),
	});

	useEffect(() => {
		saveUsageFilters(usageSearch);
	}, [usageSearch]);

	if (isReplayRoute) {
		return <Outlet />;
	}

	return (
		<UsageOverview
			usageSearch={usageSearch}
			onUpdateSearch={(next) => {
				navigate({
					to: '/settings/usage',
					search: (current) => validateUsageSearch({ ...current, ...next }),
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
	const { provider, users, feedback, tools, sources, search, splitByUser, tokenView } = usageSearch;
	const { canViewUsage } = usePermissions();
	const periodState = useUsagePeriodSettings({ canViewUsage, usageSearch, onUpdateSearch });
	const { period, granularity } = periodState;

	const usedProviders = useQuery({
		...trpc.usage.getUsedProviders.queryOptions(),
		enabled: canViewUsage,
	});
	const chatFacets = useQuery({
		...trpc.project.getProjectChats.queryOptions({
			page: 0,
			pageSize: 1,
		}),
		placeholderData: keepPreviousData,
	});
	const chartFilter = {
		period,
		granularity,
		provider: provider === 'all' ? undefined : provider,
		userNames: users,
		sources,
	};
	const messagesUsage = useQuery({
		...trpc.usage.getMessagesUsage.queryOptions(chartFilter),
		placeholderData: keepPreviousData,
		enabled: canViewUsage && periodState.isReady && !splitByUser,
	});
	const usageByUser = useQuery({
		...trpc.usage.getMessagesUsageByUser.queryOptions(chartFilter),
		placeholderData: keepPreviousData,
		enabled: canViewUsage && periodState.isReady && splitByUser,
	});
	const totalUsage = useQuery({
		...trpc.usage.getTotalUsage.queryOptions({
			period,
			provider: provider === 'all' ? undefined : provider,
			userNames: users,
			sources,
		}),
		placeholderData: keepPreviousData,
		enabled: canViewUsage && periodState.isReady,
	});

	const chartData = messagesUsage.data ?? [];
	const chartDataByUser = usageByUser.data ?? [];
	const chartQuery = splitByUser ? usageByUser : messagesUsage;
	const totalUsageChartData = totalUsage.data ? [totalUsage.data] : [];
	const showCost = tokenView === 'dollars';
	const messagesChart: UsageChart = splitByUser
		? buildUserUsageChart(chartDataByUser, 'messageCount')
		: buildMessagesBySourceChart(chartData);
	const tokensChart: UsageChart = splitByUser
		? buildUserUsageChart(
				chartDataByUser,
				showCost ? 'totalCost' : 'totalTokens',
				showCost ? USD_VALUE_FORMAT : undefined,
			)
		: { data: chartData, series: showCost ? costSeries : tokenSeries, showLegend: true };

	const filtersComponent = (
		<UsageFilters
			showUsageControls={canViewUsage}
			provider={provider}
			onProviderChange={(value) => onUpdateSearch({ provider: value })}
			periodSelection={periodState.selection}
			onPeriodSelectionChange={periodState.selectPeriod}
			savedPeriods={periodState.savedPeriods}
			isPeriodLoading={periodState.isLoading}
			periodError={periodState.error}
			onRetryPeriod={periodState.retry}
			onCreateSavedPeriod={periodState.createSavedPeriod}
			onUpdateSavedPeriod={periodState.updateSavedPeriod}
			onDeleteSavedPeriod={periodState.deleteSavedPeriod}
			availableProviders={usedProviders.data}
			chatFacets={chatFacets.data?.facets}
			selectedUserNames={users}
			onSelectedUserNamesChange={(value) => onUpdateSearch({ users: value })}
			selectedSources={sources}
			onSelectedSourcesChange={(value) => onUpdateSearch({ sources: value })}
			splitByUser={splitByUser}
			onSplitByUserChange={(value) => onUpdateSearch({ splitByUser: value })}
		/>
	);

	return (
		<div className='flex flex-1 min-h-0 overflow-auto xl:overflow-hidden bg-background'>
			<div className='flex min-h-0 w-full flex-col xl:h-full'>
				<div className='flex flex-col w-full gap-2 px-4 md:p-8 xl:shrink-0'>
					{filtersComponent}

					{canViewUsage && (
						<div className='grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[1fr_3fr_3fr] gap-2'>
							<div className='lg:col-span-2 xl:col-span-1'>
								<UsageChartCard
									title='Messages'
									isLoading={periodState.isLoading || totalUsage.isLoading}
									isFetching={totalUsage.isFetching}
									isError={totalUsage.isError}
									data={totalUsageChartData}
									chartType='kpi_card'
									series={[
										{
											data_key: 'totalMessages',
											label: 'Total messages',
											color: 'var(--chart-1)',
										},
										{
											data_key: 'uniqueUsers',
											label: 'Unique users',
											color: 'var(--chart-2)',
										},
									]}
								/>
							</div>

							<UsageChartCard
								title='Messages'
								isLoading={periodState.isLoading || chartQuery.isLoading}
								isFetching={chartQuery.isFetching}
								isError={chartQuery.isError}
								data={messagesChart.data}
								chartType='stacked_bar'
								xAxisLabelFormatter={(value) => formatUsageBucketLabel(value, granularity)}
								titleAccessory={
									<span className='text-xs text-muted-foreground'>
										{splitByUser ? 'Number of messages by user' : 'Number of messages by source'}
									</span>
								}
								series={messagesChart.series}
								showLegend={messagesChart.showLegend}
							/>

							<UsageChartCard
								title={showCost ? 'Cost' : 'Tokens'}
								isLoading={periodState.isLoading || chartQuery.isLoading}
								isFetching={chartQuery.isFetching}
								isError={chartQuery.isError}
								data={tokensChart.data}
								chartType='stacked_bar'
								xAxisLabelFormatter={(value) => formatUsageBucketLabel(value, granularity)}
								valueFormatter={showCost ? formatUsd : undefined}
								series={tokensChart.series}
								showLegend={tokensChart.showLegend}
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
					)}
				</div>

				<section className='flex min-h-[400px] flex-1 flex-col w-full overflow-hidden xl:min-h-0'>
					<div className='flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 pb-2 md:px-8'>
						<h2 className='text-sm font-semibold'>Chats replay</h2>
						<div className='flex flex-wrap items-center gap-2'>
							<ChatsReplaySearchBar
								value={search}
								onChange={(value) => onUpdateSearch({ search: value })}
							/>
							<ReplayFilters
								chatFacets={chatFacets.data?.facets}
								selectedFeedbackStates={feedback}
								onSelectedFeedbackStatesChange={(value) => onUpdateSearch({ feedback: value })}
								selectedToolStates={tools}
								onSelectedToolStatesChange={(value) => onUpdateSearch({ tools: value })}
							/>
						</div>
					</div>
					<ChatsReplayPage
						search={search}
						selectedUserNames={users}
						selectedFeedbackStates={feedback}
						selectedToolStates={tools}
						selectedSources={sources}
						onOpenChat={onOpenChatReplay}
					/>
				</section>
			</div>
		</div>
	);
}

function buildMessagesBySourceChart(chartData: UsageRecord[]): UsageChart {
	const activeMessageSeries = messageSeries.filter(({ data_key }) =>
		chartData.some((record) => record[data_key] > 0),
	);
	const series = activeMessageSeries.length > 0 ? activeMessageSeries : [...messageSeries];

	return {
		data: chartData,
		series,
		showLegend: series.some(({ data_key }) => data_key !== 'webMessageCount'),
	};
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

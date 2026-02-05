import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import type { Granularity } from 'backend/usage';
import type { LlmProvider } from 'backend/llm';
import type { ChartView } from '@/components/usage-filters';
import { UsageChartCard } from '@/components/usage-chart-card';
import { UsageFilters, dateFormats } from '@/components/usage-filters';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/settings/usage')({
	component: UsagePage,
});

function UsagePage() {
	const [granularity, setGranularity] = useState<Granularity>('day');
	const [provider, setProvider] = useState<LlmProvider | 'all'>('all');
	const [chartView, setChartView] = useState<ChartView>('messages');

	const usedProviders = useQuery(trpc.usage.getUsedProviders.queryOptions());
	const messagesUsage = useQuery({
		...trpc.usage.getMessagesUsage.queryOptions({
			granularity,
			provider: provider === 'all' ? undefined : provider,
		}),
		placeholderData: keepPreviousData,
	});

	const chartData = messagesUsage.data ?? [];

	return (
		<>
			<div className='flex items-start justify-between'>
				<h1 className='text-2xl font-semibold text-foreground'>Usage & costs</h1>
				<UsageFilters
					chartView={chartView}
					onChartViewChange={setChartView}
					provider={provider}
					onProviderChange={setProvider}
					granularity={granularity}
					onGranularityChange={setGranularity}
					availableProviders={usedProviders.data}
				/>
			</div>

			{chartView === 'messages' && (
				<UsageChartCard
					title='Messages'
					description='How many messages have been sent across all chats?'
					isLoading={messagesUsage.isLoading}
					isFetching={messagesUsage.isFetching}
					isError={messagesUsage.isError}
					data={chartData}
					chartType='bar'
					xAxisLabelFormatter={(value) => format(new Date(value), dateFormats[granularity])}
					series={[{ data_key: 'nbMessages', color: 'var(--chart-1)', label: 'Number of messages' }]}
				/>
			)}

			{chartView === 'tokens' && (
				<UsageChartCard
					title='Tokens'
					description='Tokens used across all chats.'
					isLoading={messagesUsage.isLoading}
					isFetching={messagesUsage.isFetching}
					isError={messagesUsage.isError}
					data={chartData}
					chartType='stacked_bar'
					xAxisLabelFormatter={(value) => format(new Date(value), dateFormats[granularity])}
					series={[
						{ data_key: 'inputNoCacheTokens', color: 'var(--chart-1)', label: 'Input' },
						{ data_key: 'inputCacheReadTokens', color: 'var(--chart-2)', label: 'Input (cache read)' },
						{ data_key: 'inputCacheWriteTokens', color: 'var(--chart-3)', label: 'Input (cache write)' },
						{ data_key: 'outputTotalTokens', color: 'var(--chart-4)', label: 'Output' },
					]}
				/>
			)}
		</>
	);
}

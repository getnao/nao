import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Granularity } from '@nao/backend/usage';
import type { LlmProvider } from '@nao/backend/llm';
import type { ChartView } from '@/components/settings/usage-filters';
import { UsageChartCard } from '@/components/settings/usage-chart-card';
import { UsageFilters, dateFormats } from '@/components/settings/usage-filters';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trpc } from '@/main';
import { Empty } from '@/components/ui/empty';

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
	const recentFeedbacks = useQuery(trpc.feedback.getRecent.queryOptions({ limit: 10 }));

	const chartData = messagesUsage.data ?? [];

	const filtersComponent = (
		<UsageFilters
			chartView={chartView}
			onChartViewChange={setChartView}
			provider={provider}
			onProviderChange={setProvider}
			granularity={granularity}
			onGranularityChange={setGranularity}
			availableProviders={usedProviders.data}
		/>
	);

	return (
		<>
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
					series={[{ data_key: 'messageCount', color: 'var(--chart-1)', label: 'Number of messages' }]}
					filters={filtersComponent}
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
					filters={filtersComponent}
				/>
			)}

			{chartView === 'cost' && (
				<UsageChartCard
					title='Cost'
					description='Estimated cost in USD based on token usage and model pricing.'
					isLoading={messagesUsage.isLoading}
					isFetching={messagesUsage.isFetching}
					isError={messagesUsage.isError}
					data={chartData}
					chartType='stacked_bar'
					xAxisLabelFormatter={(value) => format(new Date(value), dateFormats[granularity])}
					series={[
						{ data_key: 'inputNoCacheCost', color: 'var(--chart-1)', label: 'Input' },
						{ data_key: 'inputCacheReadCost', color: 'var(--chart-2)', label: 'Input (cache read)' },
						{ data_key: 'inputCacheWriteCost', color: 'var(--chart-3)', label: 'Input (cache write)' },
						{ data_key: 'outputCost', color: 'var(--chart-4)', label: 'Output' },
					]}
					filters={filtersComponent}
				/>
			)}

			<SettingsCard
				title='Feedbacks'
				description='Feedbacks users have given to the agent during their sessions.'
			>
				{recentFeedbacks.isLoading ? (
					<Empty>Loading feedbacks...</Empty>
				) : recentFeedbacks.isError ? (
					<Empty>Failed to load feedbacks.</Empty>
				) : !recentFeedbacks.data?.length ? (
					<Empty>No feedbacks yet.</Empty>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Vote</TableHead>
								<TableHead>User</TableHead>
								<TableHead className='w-[40%]'>Message</TableHead>
								<TableHead>Reason</TableHead>
								<TableHead>Date</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{recentFeedbacks.data.map((feedback) => (
								<TableRow key={feedback.messageId}>
									<TableCell>
										{feedback.vote === 'up' ? (
											<ThumbsUp className='h-4 w-4 text-green-500' />
										) : (
											<ThumbsDown className='h-4 w-4 text-red-500' />
										)}
									</TableCell>
									<TableCell className='font-medium'>{feedback.userName}</TableCell>
									<TableCell className='max-w-xs truncate text-muted-foreground'>
										{feedback.messageText ? (
											<span title={feedback.messageText}>
												{feedback.messageText.length > 60
													? `${feedback.messageText.slice(0, 60)}...`
													: feedback.messageText}
											</span>
										) : (
											<span className='italic'>No text.</span>
										)}
									</TableCell>
									<TableCell className='max-w-xs truncate text-muted-foreground'>
										{feedback.explanation ? (
											<span title={feedback.explanation}>
												{feedback.explanation.length > 40
													? `${feedback.explanation.slice(0, 40)}...`
													: feedback.explanation}
											</span>
										) : (
											<span className='italic'>-</span>
										)}
									</TableCell>
									<TableCell className='text-muted-foreground'>
										{formatDistanceToNow(new Date(feedback.createdAt), { addSuffix: true })}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</SettingsCard>
		</>
	);
}

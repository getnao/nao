import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { Granularity } from 'backend/usage';
import type { LlmProvider } from 'backend/llm';
import type { ChartView } from '@/components/usage-filters';
import { UsageChartCard } from '@/components/usage-chart-card';
import { UsageFilters, dateFormats } from '@/components/usage-filters';
import { SettingsCard } from '@/components/ui/settings-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
	const recentFeedbacks = useQuery(trpc.feedback.getRecent.queryOptions({ limit: 10 }));

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

			<SettingsCard title='Feedbacks'>
				{recentFeedbacks.isLoading ? (
					<p className='text-muted-foreground text-sm'>Loading feedbacks...</p>
				) : recentFeedbacks.isError ? (
					<p className='text-destructive text-sm'>Failed to load feedbacks</p>
				) : !recentFeedbacks.data?.length ? (
					<p className='text-muted-foreground text-sm'>No feedbacks yet</p>
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
											<span className='italic'>No text</span>
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

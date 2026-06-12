import { splitCodeIntoSegments } from '@nao/shared/story-segments';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { MessageSquare, Loader2 } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import type { ParsedChartBlock, ParsedTableBlock } from '@nao/shared/story-segments';

import type { SelectionData } from '@/components/highlight-bubble';
import type { QueryDataMap } from '@/components/story-embeds';
import { HighlightBubble } from '@/components/highlight-bubble';
import { StoryDownload } from '@/components/story-download';
import { StoryChartEmbed, StoryTableEmbed } from '@/components/story-embeds';
import { SegmentList } from '@/components/story-rendering';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SelectionProvider } from '@/contexts/text-selection';
import { chatPendingCitationStore } from '@/stores/chat-pending-citation';
import { trpc } from '@/main';

export const Route = createFileRoute('/_sidebar-layout/stories/standalone/$storyId')({
	component: StandaloneStoryPage,
});

function StandaloneStoryPage() {
	const { storyId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const storyQuery = useQuery(trpc.story.getStandalone.queryOptions({ storyId }));
	const story = storyQuery.data;

	const openStandaloneMutation = useMutation(
		trpc.chatFork.openStandalone.mutationOptions({
			onSuccess: ({ chatId }) => {
				queryClient.invalidateQueries({ queryKey: trpc.story.listAll.queryKey() });
				queryClient.invalidateQueries({ queryKey: trpc.story.listStandalone.queryKey() });
				navigate({ to: '/$chatId', params: { chatId }, state: { openStorySlug: story?.slug } });
			},
		}),
	);

	const handleSelectionAsk = useCallback(
		(data: SelectionData) => {
			if (!story?.chatId) {
				return;
			}
			chatPendingCitationStore.set({ chatId: story.chatId, storySlug: story.slug, ...data });
			navigate({ to: '/$chatId', params: { chatId: story.chatId } });
		},
		[navigate, story?.chatId, story?.slug],
	);

	const handleOpenChat = useCallback(() => {
		if (!story) {
			return;
		}
		if (story.chatId) {
			navigate({ to: '/$chatId', params: { chatId: story.chatId }, state: { openStorySlug: story.slug } });
		} else {
			openStandaloneMutation.mutate({ storyId });
		}
	}, [story, storyId, navigate, openStandaloneMutation]);

	if (storyQuery.isLoading) {
		return (
			<div className='flex flex-1 items-center justify-center'>
				<Spinner />
			</div>
		);
	}

	if (!story) {
		return <div>Not Found</div>;
	}

	return (
		<div className='flex flex-col flex-1 h-full overflow-hidden bg-background min-w-0'>
			<header className='flex items-center gap-3 border-b px-4 py-3 md:px-6 md:py-4 shrink-0 bg-background'>
				<h1 className='text-base font-medium truncate'>{story.title}</h1>
				<div className='ml-auto flex items-center gap-1.5 shrink-0'>
					<StoryDownload storyId={storyId} isOwner={true} />
					<Button
						variant='outline'
						size='sm'
						className='gap-1.5'
						onClick={handleOpenChat}
						disabled={openStandaloneMutation.isPending}
					>
						{openStandaloneMutation.isPending ? (
							<Loader2 className='size-3.5 animate-spin' />
						) : (
							<MessageSquare className='size-3.5' />
						)}
						<span>Open chat</span>
					</Button>
				</div>
			</header>
			<SelectionProvider key={storyId}>
				<HighlightBubble onAsk={handleSelectionAsk} disabled={!story.chatId} />
				<StandaloneStoryContent code={story.code} queryData={story.queryData as QueryDataMap | null} />
			</SelectionProvider>
		</div>
	);
}

function StandaloneStoryContent({ code, queryData }: { code: string; queryData: QueryDataMap | null }) {
	const segments = useMemo(() => splitCodeIntoSegments(code), [code]);

	const renderChart = useCallback(
		(chart: ParsedChartBlock) => <StoryChartEmbed chart={chart} queryData={queryData} />,
		[queryData],
	);

	const renderTable = useCallback(
		(table: ParsedTableBlock) => <StoryTableEmbed table={table} queryData={queryData} />,
		[queryData],
	);

	return (
		<div className='flex-1 overflow-auto'>
			<div className='max-w-5xl mx-auto p-4 md:p-8 flex flex-col gap-4'>
				<SegmentList segments={segments} renderChart={renderChart} renderTable={renderTable} />
			</div>
		</div>
	);
}

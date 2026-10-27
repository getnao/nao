import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { extractStorySummary } from '../../../../backend/src/utils/story-summary';
import { StoryCard } from '../story-card';
import { Skeleton } from '../ui/skeleton';
import { TextShimmer } from '../ui/text-shimmer';
import type { ToolCallComponentProps } from '.';
import type { QueryDataMap } from '@/components/story-embeds';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useStoryThemeForCurrentMode } from '@/components/story-theme-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatId } from '@/hooks/use-chat-id';
import { useTimeAgo } from '@/hooks/use-time-ago';
import { trpc } from '@/main';

const STORY_ACTION_LABELS = {
	create: { pending: 'Creating...', done: 'Created' },
	update: { pending: 'Updating...', done: 'Updated' },
	replace: { pending: 'Replacing...', done: 'Replaced' },
	publish: { pending: 'Publishing...', done: 'Published' },
	delete_files: { pending: 'Deleting files...', done: 'Deleted draft files' },
	revert: { pending: 'Reverting draft...', done: 'Reverted draft' },
} as const;

export const StoryToolCall = ({ toolPart }: ToolCallComponentProps<'story'>) => {
	const { open: openSidePanel, isVisible, currentStorySlug, chatId: sidePanelChatId } = useSidePanel();
	const contextOrUrlChatId = useChatId();
	const input = toolPart.input;
	const isStreaming = toolPart.state === 'input-streaming';
	const output = toolPart.output;
	const chatId = output?.story_chat_id ?? contextOrUrlChatId ?? sidePanelChatId;
	const hasAutoOpenedRef = useRef(false);

	const finalStorySlug = output?.id ?? input?.id;
	const canOpen = Boolean(chatId && finalStorySlug);
	const isCreateAction = input?.action === 'create' && isClassicCreate(input);
	const mountedBeforeOutputRef = useRef(toolPart.state !== 'output-available' && toolPart.state !== 'output-error');
	const isCustomPublished =
		mountedBeforeOutputRef.current && output?.format === 'custom' && output.success && input?.action === 'publish';

	const isInInteractiveContext = Boolean(contextOrUrlChatId);

	const { data: latestStory } = useQuery({
		...trpc.story.getLatest.queryOptions({
			chatId: chatId ?? '',
			storySlug: finalStorySlug ?? '',
		}),
		enabled: !isStreaming && canOpen,
	});
	const summary = extractStorySummary(latestStory?.code ?? output?.code ?? '');
	const storyTheme = useStoryThemeForCurrentMode(latestStory?.theme);

	useEffect(() => {
		const shouldAutoOpen = (isCreateAction && isStreaming) || isCustomPublished;
		if (hasAutoOpenedRef.current || !shouldAutoOpen || !canOpen || !chatId || !finalStorySlug) {
			return;
		}

		// Do not re-open if the same story is already visible.
		if (isVisible && currentStorySlug === finalStorySlug) {
			hasAutoOpenedRef.current = true;
			return;
		}

		openSidePanel(
			<StoryViewer
				chatId={chatId}
				storySlug={finalStorySlug}
				isReadonlyMode={isInInteractiveContext ? false : undefined}
			/>,
			finalStorySlug,
		);
		hasAutoOpenedRef.current = true;
	}, [
		isCreateAction,
		isCustomPublished,
		isStreaming,
		canOpen,
		chatId,
		finalStorySlug,
		isVisible,
		currentStorySlug,
		openSidePanel,
		isInInteractiveContext,
	]);

	if (toolPart.state === 'output-error') {
		return <StoryError message={toolPart.errorText ?? 'The story could not be saved.'} />;
	}

	if (!input) {
		const partialAction = (toolPart as { input?: { action?: string } }).input?.action;
		const loadingLabel =
			partialAction === 'update' || partialAction === 'replace' ? 'Updating story' : 'Creating story';

		return (
			<div className='my-2 -mx-3 flex items-center gap-3 rounded-xl border p-4'>
				<Skeleton className='size-8 rounded-lg' />
				<Skeleton className='h-4 w-40' />
				<TextShimmer text={loadingLabel} className='ml-auto text-xs' />
			</div>
		);
	}

	if (output?.error) {
		return <StoryError message={output.error} />;
	}

	const isCustomStory = (latestStory?.format ?? output?.format ?? input.format) === 'custom';
	const title = latestStory?.title ?? output?.title ?? input.title ?? input.id;
	const labels = STORY_ACTION_LABELS[input.action ?? 'create'] ?? STORY_ACTION_LABELS.create;
	const statusLabel = isStreaming
		? labels.pending
		: `${labels.done}${output?.version ? ` · v${output.version}` : ''}`;

	const handleOpen = () => {
		if (!canOpen || !chatId || !finalStorySlug) {
			return;
		}
		openSidePanel(
			<StoryViewer
				chatId={chatId}
				storySlug={finalStorySlug}
				isReadonlyMode={isInInteractiveContext ? false : undefined}
			/>,
			finalStorySlug,
		);
	};

	return (
		<StoryCard
			title={title ?? ''}
			isCustomStory={isCustomStory}
			summary={summary}
			storyId={latestStory?.storyId}
			version={latestStory?.version}
			theme={storyTheme}
			queryData={latestStory?.queryData as QueryDataMap | null | undefined}
			canOpen={canOpen}
			onOpen={handleOpen}
			status={
				<>
					<span className='text-xs text-muted-foreground'>{statusLabel}</span>
					{latestStory?.isLive && latestStory?.cachedAt && (
						<LiveStoryTimestamp cachedAt={latestStory.cachedAt} />
					)}
				</>
			}
		/>
	);
};

function StoryError({ message }: { message: string }) {
	return (
		<div className='my-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400'>{message}</div>
	);
}

function LiveStoryTimestamp({ cachedAt }: { cachedAt: string | Date }) {
	const timestampMs = new Date(cachedAt).getTime();
	const timeAgo = useTimeAgo(timestampMs);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className='flex items-center gap-1 rounded-full bg-secondary/50 px-1.5 py-0.5 text-[10px] text-muted-foreground'>
					<Clock className='size-3' />
					<span>Updated {timeAgo.humanReadable.toLowerCase()}</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>Updated {new Date(cachedAt).toLocaleString()}</TooltipContent>
		</Tooltip>
	);
}

function isClassicCreate(input: { format?: 'classic' | 'custom'; code?: string }): boolean {
	return input.format === 'classic' || (input.format === undefined && input.code !== undefined);
}

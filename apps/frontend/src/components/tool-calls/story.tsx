import { useEffect, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import { StoryThumbnail } from '../story-thumbnail';
import { extractStorySummary } from '../../../../backend/src/utils/story-summary';
import type { ToolCallComponentProps } from '.';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useChatId } from '@/hooks/use-chat-id';

export const StoryToolCall = ({ toolPart }: ToolCallComponentProps<'story'>) => {
	const { open: openSidePanel, isVisible, currentStorySlug, chatId: sidePanelChatId } = useSidePanel();
	const contextOrUrlChatId = useChatId();
	const chatId = contextOrUrlChatId ?? sidePanelChatId;
	const input = toolPart.input;
	const isStreaming = toolPart.state === 'input-streaming';
	const output = toolPart.output;
	const summary = extractStorySummary(output?.code ?? '');
	const hasAutoOpenedRef = useRef(false);

	const finalStorySlug = output?.id ?? input?.id;
	const canOpen = Boolean(chatId && finalStorySlug);
	const isCreateAction = input?.action === 'create';

	const isInInteractiveContext = Boolean(contextOrUrlChatId);

	useEffect(() => {
		if (hasAutoOpenedRef.current || !isCreateAction || !isStreaming || !canOpen || !chatId || !finalStorySlug) {
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
		isStreaming,
		canOpen,
		chatId,
		finalStorySlug,
		isVisible,
		currentStorySlug,
		openSidePanel,
		isInInteractiveContext,
	]);

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
		return (
			<div className='my-2 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400'>
				{output.error}
			</div>
		);
	}

	const title = output?.title ?? input.title ?? input.id;
	const actionLabel = input.action === 'create' ? 'Created' : input.action === 'update' ? 'Updated' : 'Replaced';
	const statusLabel = isStreaming
		? input.action === 'create'
			? 'Creating...'
			: input.action === 'update'
				? 'Updating...'
				: 'Replacing...'
		: `${actionLabel}${output?.version ? ` · v${output.version}` : ''}`;

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
		<button
			type='button'
			onClick={handleOpen}
			disabled={!canOpen}
			className='group my-2 -mx-3 flex items-center gap-3 pr-3 rounded-lg border bg-background text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-default cursor-pointer overflow-hidden'
		>
			<div className='items-end relative h-16 w-30 shrink-0'>
				<StoryThumbnail summary={summary} className='rounded-lg overflow-visible right-6' isToolPart={true} />
			</div>

			<div className='flex flex-col gap-1 min-w-0 flex-1 pl-5 py-3'>
				<span className='text-sm font-medium truncate'>{title}</span>
				<span className='text-xs text-muted-foreground'>{statusLabel}</span>
			</div>

			{canOpen && (
				<Button variant='ghost-muted' size='icon-xs' className='hover:bg-transparent' asChild>
					<span>
						<ArrowUpRight className='size-3.5' />
					</span>
				</Button>
			)}
		</button>
	);
};

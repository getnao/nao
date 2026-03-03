import { useEffect, useRef } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import StoryIcon from '../ui/story-icon';
import type { ToolCallComponentProps } from '.';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';

export const StoryToolCall = ({ toolPart }: ToolCallComponentProps<'story'>) => {
	const { open: openSidePanel, isVisible, currentStoryId } = useSidePanel();
	const { chatId } = useParams({ strict: false });
	const input = toolPart.input;
	const isStreaming = toolPart.state === 'input-streaming';
	const output = toolPart.output;
	const hasAutoOpenedRef = useRef(false);

	const finalStoryId = output?.id ?? input?.id;
	const canOpen = Boolean(chatId && finalStoryId);
	const isCreateAction = input?.action === 'create';

	useEffect(() => {
		if (hasAutoOpenedRef.current || !isCreateAction || !isStreaming || !canOpen || !chatId || !finalStoryId) {
			return;
		}

		// Do not re-open if the same story is already visible.
		if (isVisible && currentStoryId === finalStoryId) {
			hasAutoOpenedRef.current = true;
			return;
		}

		openSidePanel(<StoryViewer chatId={chatId} storyId={finalStoryId} />, finalStoryId);
		hasAutoOpenedRef.current = true;
	}, [isCreateAction, isStreaming, canOpen, chatId, finalStoryId, isVisible, currentStoryId, openSidePanel]);

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
		if (!canOpen || !chatId || !finalStoryId) {
			return;
		}
		openSidePanel(<StoryViewer chatId={chatId} storyId={finalStoryId} />, finalStoryId);
	};

	return (
		<button
			type='button'
			onClick={handleOpen}
			disabled={!canOpen}
			className='group my-2 -mx-3 flex md:w-2/3 items-center gap-3 rounded-xl border bg-card py-4 pl-4 pr-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-default cursor-pointer overflow-hidden'
		>
			<div className='relative -mt-4 -mb-12 mr-1 flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-b from-muted/40 to-white/80 rotate-[-4deg] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:rotate-[-2.5deg]'>
				<StoryIcon className='size-5 text-muted-foreground' strokeWidth={1} />
			</div>

			<div className='flex flex-col gap-0.5 min-w-0 flex-1'>
				<span className='text-sm font-medium truncate'>{title}</span>
				<span className='text-xs text-muted-foreground'>{statusLabel}</span>
			</div>

			{canOpen && (
				<Button variant='ghost-muted' size='icon-xs' asChild>
					<span>
						<ArrowUpRight className='size-3.5' />
					</span>
				</Button>
			)}
		</button>
	);
};

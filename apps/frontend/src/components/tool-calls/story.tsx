import { ScrollText, ArrowUpRight } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import type { ToolCallComponentProps } from '.';
import { StoryViewer } from '@/components/side-panel/story-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { isToolSettled } from '@/lib/ai';

export const StoryToolCall = ({ toolPart }: ToolCallComponentProps<'story'>) => {
	const { open: openSidePanel } = useSidePanel();
	const { chatId } = useParams({ strict: false });
	const isSettled = isToolSettled(toolPart);
	const input = toolPart.state !== 'input-streaming' ? toolPart.input : undefined;
	const output = toolPart.output;

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
	const storyId = output?.id ?? input.id;

	const handleOpen = () => {
		if (!chatId) {
			return;
		}
		openSidePanel(<StoryViewer chatId={chatId} storyId={storyId} />, storyId);
	};

	return (
		<button
			type='button'
			onClick={handleOpen}
			disabled={!isSettled}
			className='group my-2 -mx-3 flex md:w-2/3 items-center gap-3 rounded-xl border bg-card py-4 pl-4 pr-3 text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-default cursor-pointer overflow-hidden'
		>
			<div className='relative -mt-4 -mb-10 mr-1 flex h-16 w-14 shrink-0 items-center justify-center rounded-lg border border-border bg-gradient-to-b from-muted/40 to-white/80 rotate-[-4deg] transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:rotate-[-2.5deg]'>
				<ScrollText className='size-5 text-muted-foreground' />
			</div>

			<div className='flex flex-col gap-0.5 min-w-0 flex-1'>
				<span className='text-sm font-medium truncate'>{title}</span>
				<span className='text-xs text-muted-foreground'>
					{input.action === 'create' ? 'Created' : input.action === 'update' ? 'Updated' : 'Replaced'}
					{output?.version ? ` · v${output.version}` : ''}
				</span>
			</div>

			{isSettled && (
				<Button variant='ghost-muted' size='icon-xs' asChild>
					<span>
						<ArrowUpRight className='size-3.5' />
					</span>
				</Button>
			)}
		</button>
	);
};

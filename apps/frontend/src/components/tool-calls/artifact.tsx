import { FileText, ArrowUpRight } from 'lucide-react';
import { TextShimmer } from '../ui/text-shimmer';
import { Skeleton } from '../ui/skeleton';
import { Button } from '../ui/button';
import type { ToolCallComponentProps } from '.';
import { ArtifactViewer } from '@/components/side-panel/artifact-viewer';
import { useSidePanel } from '@/contexts/side-panel';
import { useAgentContext } from '@/contexts/agent.provider';
import { isToolSettled } from '@/lib/ai';
import { collectArtifactVersions } from '@/lib/artifact.utils';

export const ArtifactToolCall = ({ toolPart }: ToolCallComponentProps<'artifact'>) => {
	const { open: openSidePanel } = useSidePanel();
	const { messages } = useAgentContext();
	const isSettled = isToolSettled(toolPart);
	const input = toolPart.state !== 'input-streaming' ? toolPart.input : undefined;
	const output = toolPart.output;

	if (!input) {
		const partialAction = (toolPart as { input?: { action?: string } }).input?.action;
		const loadingLabel =
			partialAction === 'update' || partialAction === 'replace' ? 'Updating artifact' : 'Creating artifact';

		return (
			<div className='my-2 flex items-center gap-3 rounded-xl border p-4'>
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
	const artifactId = output?.id ?? input.id;

	const handleOpen = () => {
		const versions = collectArtifactVersions(messages, artifactId);
		openSidePanel(<ArtifactViewer artifactId={artifactId} initialVersions={versions} />);
	};

	return (
		<button
			type='button'
			onClick={handleOpen}
			disabled={!isSettled}
			className='my-2 flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50 disabled:opacity-50 disabled:cursor-default cursor-pointer'
		>
			<div className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary'>
				<FileText className='size-4' />
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

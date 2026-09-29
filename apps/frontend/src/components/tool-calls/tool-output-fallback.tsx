import { RotateCw } from 'lucide-react';
import { Button } from '../ui/button';
import { useToolCallContext } from '@/contexts/tool-call';

interface Props {
	/** What to show while the call is genuinely in flight, e.g. "Executing query...". */
	runningLabel: string;
}

/**
 * Body for a tool call that has no output to render.
 *
 * A tool part without output means one of two things, and they must not look alike: the call is
 * still running, or the message stopped streaming and the output never arrived. The second
 * happens when the stream to this tab drops mid-run; the server usually finished and persisted
 * the result, so a reload shows it.
 *
 * Rendering the in-flight placeholder for both is what makes a dropped stream read as a hung
 * page: the tab has already set `isRunning=false`, so nothing is going to update it.
 *
 * `read.tsx`, `grep.tsx` and `read-query-result.tsx` already gate their placeholder on
 * `isSettled`; this centralizes the same rule for the tool bodies that did not.
 */
export const ToolOutputFallback = ({ runningLabel }: Props) => {
	const { isSettled } = useToolCallContext();

	if (!isSettled) {
		return <div className='p-4 text-center text-foreground/50 text-sm'>{runningLabel}</div>;
	}

	return (
		<div className='p-4 text-center'>
			<p className='text-sm text-foreground/70'>No result reached this tab.</p>
			<p className='mt-1 text-xs text-muted-foreground'>
				The connection dropped before the result arrived. It may have completed on the server — reload to load
				the stored result.
			</p>
			<Button
				variant='outline'
				size='sm'
				className='mt-3 h-7 text-xs gap-1.5'
				onClick={() => {
					window.location.reload();
				}}
			>
				<RotateCw className='size-3' />
				Reload page
			</Button>
		</div>
	);
};

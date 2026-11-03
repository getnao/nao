import { useState } from 'react';
import { formatDate } from 'date-fns';
import { Clock, Timer } from 'lucide-react';
import { formatDuration } from '@/components/subagent/use-subagent-duration';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function MessageDateTime({ timestamp, className }: { timestamp: number; className?: string }) {
	return (
		<time className={cn('tabular-nums', className)} dateTime={new Date(timestamp).toISOString()}>
			{formatDate(timestamp, 'yyyy-MM-dd HH:mm:ss')}
		</time>
	);
}

/** How long an answer took, switching to the time it finished at on click. */
export function AnswerDuration({ startedAt, finishedAt }: { startedAt: number | undefined; finishedAt: number }) {
	const [showFinishedAt, setShowFinishedAt] = useState(false);
	const durationMs = startedAt == null ? null : finishedAt - startedAt;

	if (durationMs == null || durationMs < 0) {
		return <MessageDateTime timestamp={finishedAt} />;
	}

	const duration = formatDuration(durationMs);
	return (
		<SimpleTooltip
			content={
				<div className='flex flex-col gap-0.5'>
					<span>Answered in {duration}</span>
					<span className='tabular-nums'>
						Finished at <MessageDateTime timestamp={finishedAt} />
					</span>
					<span className='opacity-70'>
						{showFinishedAt ? 'Click to show the duration' : 'Click to show the time'}
					</span>
				</div>
			}
			side='top'
		>
			<button
				type='button'
				onClick={() => setShowFinishedAt((value) => !value)}
				className='flex cursor-pointer items-center gap-1 rounded-sm tabular-nums transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
			>
				{showFinishedAt ? (
					<>
						<Clock className='size-3' />
						<MessageDateTime timestamp={finishedAt} />
					</>
				) : (
					<>
						<Timer className='size-3' />
						{duration}
					</>
				)}
			</button>
		</SimpleTooltip>
	);
}

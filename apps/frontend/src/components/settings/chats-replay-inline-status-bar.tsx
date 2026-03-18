import { ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type NavSegmentProps = {
	label: string;
	current: number;
	total: number;
	color: 'amber' | 'green' | 'red';
	onPrev: () => void;
	onNext: () => void;
};

const DOT_COLORS: Record<NavSegmentProps['color'], string> = {
	amber: 'bg-amber-400',
	green: 'bg-green-600',
	red: 'bg-red-500',
};

function NavSegment({ label, current, total, color, onPrev, onNext }: NavSegmentProps) {
	return (
		<div className='flex items-center gap-2 px-3 py-1.5 border-r border-border last:border-r-0'>
			<span className={cn('size-2 rounded-full flex-shrink-0', DOT_COLORS[color])} />
			<span className='text-sm text-muted-foreground whitespace-nowrap'>
				<span className='font-medium text-foreground'>{current > total ? 0 : current}</span>
				{' / '}
				{total} {label}
			</span>
			<div className='flex items-center gap-0.5'>
				<Button
					variant='ghost-muted'
					size='icon-sm'
					onClick={onPrev}
					disabled={current <= 1}
					aria-label={`Previous ${label}`}
				>
					<ChevronUp className='size-3.5' />
				</Button>
				<div className='w-px h-3.5 bg-border' />
				<Button
					variant='ghost-muted'
					size='icon-sm'
					onClick={onNext}
					disabled={current >= total}
					aria-label={`Next ${label}`}
				>
					<ChevronDown className='size-3.5' />
				</Button>
			</div>
		</div>
	);
}

type InlineStatusBarProps = {
	feedbackCurrent: number;
	feedbackTotal: number;
	feedbackVote?: 'up' | 'down' | null;
	errorCurrent: number;
	errorTotal: number;
	onPrevFeedback: () => void;
	onNextFeedback: () => void;
	onPrevError: () => void;
	onNextError: () => void;
	className?: string;
};

function feedbackColor(vote: 'up' | 'down' | null | undefined): NavSegmentProps['color'] {
	if (vote === 'up') {
		return 'green';
	}
	if (vote === 'down') {
		return 'red';
	}
	return 'amber';
}

export function InlineStatusBar({
	feedbackCurrent,
	feedbackTotal,
	feedbackVote,
	errorCurrent,
	errorTotal,
	onPrevFeedback,
	onNextFeedback,
	onPrevError,
	onNextError,
	className,
}: InlineStatusBarProps) {
	if (feedbackTotal === 0 && errorTotal === 0) {
		return null;
	}

	return (
		<div
			className={cn(
				'inline-flex items-stretch',
				'border border-border rounded-md bg-muted/30 overflow-hidden',
				className,
			)}
		>
			{feedbackTotal > 0 && (
				<NavSegment
					label={feedbackTotal > 1 ? 'feedbacks' : 'feedback'}
					current={feedbackCurrent}
					total={feedbackTotal}
					color={feedbackColor(feedbackVote)}
					onPrev={onPrevFeedback}
					onNext={onNextFeedback}
				/>
			)}
			{errorTotal > 0 && (
				<NavSegment
					label={errorTotal > 1 ? 'errors' : 'error'}
					current={errorCurrent}
					total={errorTotal}
					color='red'
					onPrev={onPrevError}
					onNext={onNextError}
				/>
			)}
		</div>
	);
}

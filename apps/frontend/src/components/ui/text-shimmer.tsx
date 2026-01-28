import { cn } from '@/lib/utils';

export const TextShimmer = ({ className, text = 'Thinking' }: { className?: string; text?: string }) => {
	return (
		<div className={cn(className)}>
			<span className='text-sm text-shimmer'>{text}</span>
		</div>
	);
};

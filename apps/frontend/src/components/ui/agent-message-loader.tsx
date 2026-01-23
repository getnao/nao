import { cn } from '@/lib/utils';

export const AgentMessageLoader = ({ className }: { className?: string }) => {
	return (
		<div className={cn('px-3', className)}>
			<span className='text-sm text-shimmer'>Thinking</span>
		</div>
	);
};

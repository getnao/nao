import { cn } from '@/lib/utils';

export function LastUsedPill({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				'rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium leading-none text-primary-foreground ring-2 ring-background',
				className,
			)}
		>
			Last used
		</span>
	);
}

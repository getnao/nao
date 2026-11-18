import { cn } from '@/lib/utils';

export function LastUsedPill({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				'rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ring-2 ring-background',
				'bg-[var(--last-used-pill-bg,var(--primary))] text-[var(--last-used-pill-fg,var(--primary-foreground))]',
				className,
			)}
		>
			Last used
		</span>
	);
}

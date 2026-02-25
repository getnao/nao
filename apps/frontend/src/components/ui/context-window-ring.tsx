import { cn } from '@/lib/utils';

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ringColor(value: number): string {
	if (value >= 85) {
		return 'stroke-destructive';
	}
	if (value >= 65) {
		return 'stroke-amber-500';
	}
	return 'stroke-muted-foreground/60';
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) {
		return `${(n / 1_000_000).toFixed(1)}M`;
	}
	if (n >= 1_000) {
		return `${Math.round(n / 1_000)}K`;
	}
	return String(n);
}

interface ContextProps {
	value: number;
	usedTokens?: number;
	contextWindow?: number;
	className?: string;
}

export function ContextWindowRing({ value, usedTokens, contextWindow, className }: ContextProps) {
	const clamped = Math.max(0, Math.min(100, value));
	const offset = CIRCUMFERENCE * (1 - clamped / 100);

	const percentLabel = clamped.toFixed(1);
	const tooltipText =
		usedTokens != null && contextWindow != null
			? `${percentLabel}% used ${formatTokens(usedTokens)}/${formatTokens(contextWindow)}`
			: `${percentLabel}% used`;

	return (
		<div className='group relative inline-flex'>
			<svg
				width='20'
				height='20'
				viewBox='0 0 20 20'
				className={cn('-rotate-90', className)}
				aria-label={tooltipText}
				role='img'
			>
				<circle
					cx='10'
					cy='10'
					r={RADIUS}
					fill='none'
					strokeWidth='2.5'
					className='stroke-muted-foreground/20'
				/>
				<circle
					cx='10'
					cy='10'
					r={RADIUS}
					fill='none'
					strokeWidth='2.5'
					strokeLinecap='round'
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={offset}
					className={cn('transition-[stroke-dashoffset,stroke] duration-700', ringColor(clamped))}
				/>
			</svg>
			<span className='pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap rounded border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100'>
				{tooltipText}
			</span>
		</div>
	);
}

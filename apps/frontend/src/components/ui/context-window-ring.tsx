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

interface ContextProps {
	/** Percentage of context window used, 0–100 */
	value: number;
	className?: string;
}

export function ContextWindowRing({ value, className }: ContextProps) {
	const clamped = Math.max(0, Math.min(100, value));
	const offset = CIRCUMFERENCE * (1 - clamped / 100);

	return (
		<svg
			width='20'
			height='20'
			viewBox='0 0 20 20'
			className={cn('-rotate-90', className)}
			aria-label={`Context window: ${Math.round(clamped)}% used`}
			role='img'
		>
			<circle cx='10' cy='10' r={RADIUS} fill='none' strokeWidth='2.5' className='stroke-muted-foreground/20' />
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
	);
}

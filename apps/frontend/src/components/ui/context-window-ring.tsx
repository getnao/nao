import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

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
	value: number;
	tooltipText: string;
	className?: string;
}

export function ContextWindowRing({ value, tooltipText, className }: ContextProps) {
	const clamped = Math.max(0, Math.min(100, value));
	const offset = CIRCUMFERENCE * (1 - clamped / 100);

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						tabIndex={0}
						aria-label={tooltipText}
						className='size-4 inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
					>
						<svg
							width='20'
							height='20'
							viewBox='0 0 20 20'
							className={cn('-rotate-90', className)}
							aria-hidden='true'
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
					</span>
				</TooltipTrigger>
				<TooltipContent side='top' align='center'>
					{tooltipText}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

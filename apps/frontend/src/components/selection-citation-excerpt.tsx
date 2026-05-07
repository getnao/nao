import { cn } from '@/lib/utils';

interface SelectionCitationExcerptProps {
	label?: string;
	start?: number;
	end?: number;
	text: string;
	maxLength?: number;
	lineClamp?: 2 | 3;
}

export function SelectionCitationExcerpt({
	label,
	start,
	end,
	text,
	maxLength = 220,
	lineClamp = 3,
}: SelectionCitationExcerptProps) {
	const displayed = maxLength > 0 && text.length > maxLength ? `${text.slice(0, maxLength)}\u2026` : text;

	return (
		<>
			<p className='text-[11px] text-muted-foreground font-mono tracking-tight mb-1.5'>
				{label ?? `@chars ${start}\u2013${end}`}
			</p>
			{displayed && (
				<blockquote
					className={cn(
						'text-xs text-foreground/80 italic leading-relaxed border-l-2 border-primary/50 pl-3',
						lineClamp === 2 ? 'line-clamp-2' : 'line-clamp-3',
					)}
				>
					&ldquo;{displayed}&rdquo;
				</blockquote>
			)}
		</>
	);
}

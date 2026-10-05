import type { StoryBlockReference } from '@nao/shared/types';
import { cn } from '@/lib/utils';

interface SelectionCitationExcerptProps {
	label?: string;
	start?: number;
	end?: number;
	block?: StoryBlockReference;
	text: string;
	maxLength?: number;
	lineClamp?: 2 | 3;
}

export function SelectionCitationExcerpt({
	label,
	start,
	end,
	block,
	text,
	maxLength = 220,
	lineClamp = 3,
}: SelectionCitationExcerptProps) {
	const displayed = maxLength > 0 && text.length > maxLength ? `${text.slice(0, maxLength)}\u2026` : text;

	return (
		<>
			<p className='text-[11px] text-muted-foreground font-mono tracking-tight mb-1.5'>
				{label ?? describeLabel(start, end, block)}
			</p>
			{displayed && (
				<blockquote
					className={cn(
						'text-xs text-foreground/80 italic leading-relaxed border-l-2 border-primary pl-3',
						lineClamp === 2 ? 'line-clamp-2' : 'line-clamp-3',
					)}
				>
					&ldquo;{displayed}&rdquo;
				</blockquote>
			)}
		</>
	);
}

function describeLabel(start?: number, end?: number, block?: StoryBlockReference) {
	return block ? `@${block.kind} block` : `@chars ${start}\u2013${end}`;
}

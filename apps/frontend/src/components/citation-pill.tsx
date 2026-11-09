import { X } from 'lucide-react';
import type { CitationData } from '@nao/shared/types';

import { toCitationMentionOption } from '@/lib/citation-mention';

/** A citation outside of a prompt, drawn like the pills a prompt shows. */
export function CitationPill({ citation, onRemove }: { citation: CitationData; onRemove?: () => void }) {
	const { label, icon } = toCitationMentionOption(citation, '');
	return (
		<span className='group/pill inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2 py-1.5 text-[0.825rem] leading-[1.2] font-[470] shadow-xs dark:border-input'>
			{onRemove ? (
				<button
					type='button'
					onClick={onRemove}
					aria-label={`Remove ${label}`}
					className='relative flex size-3 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground [&_svg]:size-3'
				>
					<span className='flex group-hover/pill:invisible'>{icon}</span>
					<X className='invisible absolute size-3 group-hover/pill:visible' strokeWidth={2.5} />
				</button>
			) : (
				<span className='flex size-3 shrink-0 items-center text-muted-foreground [&_svg]:size-3'>{icon}</span>
			)}
			<span className='truncate'>{label}</span>
		</span>
	);
}

export function CitationPills({
	citations,
	onRemove,
}: {
	citations: CitationData[];
	onRemove?: (index: number) => void;
}) {
	if (citations.length === 0) {
		return null;
	}
	return (
		<div className='flex flex-wrap gap-1.5'>
			{citations.map((citation, index) => (
				<CitationPill
					key={`${index}:${citation.text}`}
					citation={citation}
					onRemove={onRemove && (() => onRemove(index))}
				/>
			))}
		</div>
	);
}

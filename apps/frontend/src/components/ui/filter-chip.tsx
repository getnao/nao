import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function FilterChip({
	label,
	icon,
	title = label,
	onRemove,
}: {
	label: string;
	icon?: ReactNode;
	/** Shown on hover, the label by default. */
	title?: string;
	onRemove: () => void;
}) {
	return (
		<span className='inline-flex h-6 max-w-56 shrink-0 items-center gap-1 rounded-full bg-accent pr-1 pl-2.5 text-xs text-foreground [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:text-muted-foreground'>
			{icon}
			<span className='truncate' title={title}>
				{label}
			</span>
			<button
				type='button'
				onClick={onRemove}
				aria-label={`Remove ${label} filter`}
				className='inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-foreground'
			>
				<X className='size-3' />
			</button>
		</span>
	);
}

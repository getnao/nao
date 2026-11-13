import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** A collapsible group of the Changes view, its actions showing on the header while open. */
export function ChangesSection({
	title,
	count,
	actions,
	isDefaultOpen = true,
	children,
}: {
	title: string;
	count?: number;
	actions?: ReactNode;
	isDefaultOpen?: boolean;
	children: ReactNode;
}) {
	const [isOpen, setIsOpen] = useState(isDefaultOpen);

	return (
		<section aria-label={title} className='flex flex-col'>
			<div className='flex h-7 shrink-0 items-center gap-0.5 pr-2 pl-2'>
				<button
					type='button'
					aria-expanded={isOpen}
					onClick={() => setIsOpen(!isOpen)}
					className='flex h-full min-w-0 flex-1 cursor-pointer items-center gap-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:text-foreground'
				>
					<ChevronRight
						aria-hidden='true'
						className={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')}
					/>
					<span className='truncate'>{title}</span>
					{count !== undefined && <span className='font-medium tracking-normal'>{count}</span>}
				</button>
				{isOpen && actions}
			</div>
			{isOpen && <div className='flex flex-col pb-1.5'>{children}</div>}
		</section>
	);
}

export function SectionNote({ children }: { children: ReactNode }) {
	return <p className='px-6 py-1 text-[11px] text-muted-foreground'>{children}</p>;
}

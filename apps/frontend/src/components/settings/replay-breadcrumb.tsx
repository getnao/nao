import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';

import { cn } from '@/lib/utils';

export type ReplayCrumb = {
	label: string;
	onClick?: () => void;
};

/** Where the admin is inside a replay; every crumb but the last navigates back up. */
export function ReplayBreadcrumb({ crumbs }: { crumbs: ReplayCrumb[] }) {
	return (
		<nav aria-label='Replay navigation' className='flex items-center gap-1 min-w-0 text-sm'>
			{crumbs.map((crumb, index) => {
				const isLast = index === crumbs.length - 1;
				return (
					<Fragment key={index}>
						{index > 0 && <ChevronRight className='size-4 text-muted-foreground/50 shrink-0' />}
						<Crumb crumb={crumb} isLast={isLast} />
					</Fragment>
				);
			})}
		</nav>
	);
}

function Crumb({ crumb, isLast }: { crumb: ReplayCrumb; isLast: boolean }) {
	if (isLast || !crumb.onClick) {
		return (
			<span className={cn('truncate', isLast ? 'text-foreground' : 'text-muted-foreground')}>{crumb.label}</span>
		);
	}

	return (
		<button
			type='button'
			onClick={crumb.onClick}
			className='truncate text-muted-foreground hover:text-foreground transition-colors cursor-pointer'
		>
			{crumb.label}
		</button>
	);
}

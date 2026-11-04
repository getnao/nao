import type { ReactNode } from 'react';

import type { RunFilters } from '@/components/settings/test-run-filter-menu';
import { RunFilterMenu } from '@/components/settings/test-run-filter-menu';
import { cn } from '@/lib/utils';

/** The width of the runs column of the drawer panes, shared with the "All tests" tab so their edges line up. */
export const RUNS_COLUMN_WIDTH_CLASS = 'w-56';

/** The header row of each pane, all of the same height so their bottom borders line up across the drawer. */
export function PanelHeader({ className, children }: { className?: string; children: ReactNode }) {
	return (
		<div
			className={cn(
				'sticky top-0 z-10 flex min-h-9 shrink-0 items-center border-b bg-background px-3 py-1 text-muted-foreground',
				className,
			)}
		>
			{children}
		</div>
	);
}

export function RecentRunsHeader({
	filters,
	onChange,
}: {
	filters: RunFilters;
	onChange: (filters: RunFilters) => void;
}) {
	return (
		<PanelHeader>
			<span className='text-[10px] font-medium tracking-wide uppercase'>Recent runs</span>
			<RunFilterMenu filters={filters} onChange={onChange} />
		</PanelHeader>
	);
}

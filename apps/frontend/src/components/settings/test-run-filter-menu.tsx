import { ListFilter } from 'lucide-react';

import type { TestHistoryRun, TestRunSummary } from '@/components/settings/test-run-types';
import type { RunListState } from '@/components/settings/test-run-list-item';
import { getRunListState } from '@/components/settings/test-run-list-item';
import { Button } from '@/components/ui/button';
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type RunKindFilter = 'all' | 'runs' | 'comparisons';
export type RunOutcomeFilter = 'all' | 'passed' | 'failed';

export interface RunFilters {
	kind: RunKindFilter;
	outcome: RunOutcomeFilter;
}

export const ALL_RUNS: RunFilters = { kind: 'all', outcome: 'all' };

const KIND_OPTIONS: { value: RunKindFilter; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'runs', label: 'Runs' },
	{ value: 'comparisons', label: 'Comparisons' },
];

const OUTCOME_OPTIONS: { value: RunOutcomeFilter; label: string }[] = [
	{ value: 'all', label: 'All' },
	{ value: 'passed', label: 'Passed' },
	{ value: 'failed', label: 'Failed' },
];

/** Narrows the listed runs to test runs or comparisons, and to the ones that passed or failed. */
export function RunFilterMenu({ filters, onChange }: { filters: RunFilters; onChange: (filters: RunFilters) => void }) {
	const isFiltered = filters.kind !== 'all' || filters.outcome !== 'all';
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant='ghost'
					size='icon-xs'
					aria-label='Filter the runs'
					className={cn(
						'-mr-1.5 ml-auto text-muted-foreground hover:text-foreground',
						isFiltered && 'bg-accent text-foreground',
					)}
				>
					<ListFilter />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align='start' className='w-40'>
				<DropdownMenuLabel className='text-xs'>Type</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={filters.kind}
					onValueChange={(kind) => onChange({ ...filters, kind: kind as RunKindFilter })}
				>
					{KIND_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} indicator='check'>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
				<DropdownMenuSeparator />
				<DropdownMenuLabel className='text-xs'>Outcome</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={filters.outcome}
					onValueChange={(outcome) => onChange({ ...filters, outcome: outcome as RunOutcomeFilter })}
				>
					{OUTCOME_OPTIONS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} indicator='check'>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function matchesRunFilters(run: TestRunSummary, filters: RunFilters): boolean {
	return matchesKindFilter(run.trigger, filters.kind) && matchesRunOutcome(getRunListState(run), filters.outcome);
}

/** Filters the runs of a single test, judged on that test only. */
export function matchesTestHistoryRunFilters(run: TestHistoryRun, filters: RunFilters): boolean {
	return matchesKindFilter(run.trigger, filters.kind) && matchesRunOutcome(getRunListState(run), filters.outcome);
}

function matchesKindFilter(trigger: TestRunSummary['trigger'], kind: RunKindFilter): boolean {
	switch (kind) {
		case 'all':
			return true;
		case 'runs':
			return trigger !== 'comparison';
		case 'comparisons':
			return trigger === 'comparison';
	}
}

/** Judged like the run's icon; unfinished runs neither pass nor fail. */
function matchesRunOutcome(state: RunListState, outcome: RunOutcomeFilter): boolean {
	switch (outcome) {
		case 'all':
			return true;
		case 'passed':
			return state === 'passed';
		case 'failed':
			return state === 'failed' || state === 'flaky';
	}
}

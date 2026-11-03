import { cn } from '@/lib/utils';

export type TestResultFilter = 'all' | 'passed' | 'failed' | 'disagree';

interface TestOutcome {
	passedAttempts: number;
	totalAttempts: number;
	modelsDisagree?: boolean;
}

const FILTERS: { id: TestResultFilter; label: string; countClassName: string }[] = [
	{ id: 'all', label: 'All', countClassName: 'bg-muted text-muted-foreground' },
	{
		id: 'passed',
		label: 'Passed',
		countClassName: 'bg-green-500/15 text-green-700 dark:text-green-400',
	},
	{ id: 'failed', label: 'Failed', countClassName: 'bg-destructive/10 text-destructive' },
	{
		id: 'disagree',
		label: 'Models disagree',
		countClassName: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
	},
];

export function TestResultFilterPills({
	outcomes,
	filter,
	onChange,
	hasSeveralModels = false,
}: {
	outcomes: TestOutcome[];
	filter: TestResultFilter;
	onChange: (filter: TestResultFilter) => void;
	hasSeveralModels?: boolean;
}) {
	const filters = FILTERS.filter((option) => option.id !== 'disagree' || hasSeveralModels);
	return (
		<div role='radiogroup' aria-label='Filter the tests' className='flex shrink-0 items-center gap-1'>
			{filters.map((option) => (
				<button
					key={option.id}
					type='button'
					role='radio'
					aria-checked={filter === option.id}
					onClick={() => onChange(option.id)}
					className={cn(
						'flex cursor-pointer items-center gap-2 rounded-md py-1 pr-1 pl-2.5 transition-colors',
						filter === option.id
							? 'bg-accent text-foreground'
							: 'text-muted-foreground hover:text-foreground',
					)}
				>
					{option.label}
					<span
						className={cn(
							'min-w-5 rounded px-1.5 text-center font-medium tabular-nums',
							option.countClassName,
						)}
					>
						{outcomes.filter((outcome) => matchesResultFilter(outcome, option.id)).length}
					</span>
				</button>
			))}
		</div>
	);
}

/** A test passes when all of its attempts pass and fails when one does not; tests still waiting only show in "All". */
export function matchesResultFilter(outcome: TestOutcome, filter: TestResultFilter): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'passed':
			return outcome.totalAttempts > 0 && outcome.passedAttempts === outcome.totalAttempts;
		case 'failed':
			return outcome.totalAttempts > 0 && outcome.passedAttempts < outcome.totalAttempts;
		case 'disagree':
			return outcome.modelsDisagree === true;
	}
}

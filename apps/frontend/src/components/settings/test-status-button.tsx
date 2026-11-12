import { FlaskConical } from 'lucide-react';

import type { ChangesRunResult } from '@/hooks/use-latest-changes-run';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Opens the tests, showing how many passed on the latest run of these changes once they were tested. */
export function TestStatusButton({
	label,
	result,
	disabled,
	onClick,
}: {
	label: string;
	result: ChangesRunResult | null;
	disabled?: boolean;
	onClick: () => void;
}) {
	if (!result) {
		return (
			<Button
				variant='ghost-muted'
				size='icon-xs'
				aria-label={label}
				title={label}
				disabled={disabled}
				onClick={onClick}
			>
				<FlaskConical />
			</Button>
		);
	}

	const hasPassedAll = result.passedTests === result.testCount;
	return (
		<button
			type='button'
			aria-label={label}
			title={`${result.passedTests} of ${result.testCount} tests passed on the latest run`}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				'h-5 shrink-0 cursor-pointer rounded-full px-1.5 font-mono text-[10.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
				hasPassedAll
					? 'bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400'
					: 'bg-amber-500/12 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400',
			)}
		>
			{hasPassedAll ? '✓' : '!'} {result.passedTests}/{result.testCount}
		</button>
	);
}

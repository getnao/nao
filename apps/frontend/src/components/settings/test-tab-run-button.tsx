import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { useTestFileRun } from '@/hooks/use-test-run-start';
import { cn } from '@/lib/utils';

/**
 * The icon of a test tab, which turns into a play button on hover to run the test the way the compare button would:
 * as it is in the editor when its tab is shown, else as it is saved.
 */
export function TestTabRunButton({
	icon,
	testPath,
	testFile,
	isTestFileInvalid,
	settings,
	draft,
	activeRun,
	onStart,
	onRunStarted,
}: {
	icon: ReactNode;
	/** The explorer path of the test. */
	testPath: string;
	/** The test as it is in the editor, when its tab is the one shown. */
	testFile: { path: string; content: string } | null;
	isTestFileInvalid: boolean;
	settings: TestRunSettings;
	draft: DraftContext | null;
	activeRun: TestRunSummary | undefined;
	onStart: () => void;
	onRunStarted: (run: { id: string }) => void;
}) {
	const { label, disabledReason, error, isStarting, run } = useTestFileRun({
		testPath,
		testFile,
		isTestFileInvalid,
		settings,
		draft,
		activeRun,
		onRunStarted,
	});

	const handleClick = () => {
		if (disabledReason) {
			return;
		}
		onStart();
		run();
	};

	return (
		<span className='relative mr-1.5 ml-3 flex size-4 shrink-0 items-center justify-center'>
			<span className={cn('flex', isStarting ? 'opacity-0' : 'group-hover:opacity-0')}>{icon}</span>
			<SimpleTooltip content={error ?? disabledReason ?? label} side='top'>
				<button
					type='button'
					aria-label={label}
					aria-disabled={disabledReason !== null}
					onClick={handleClick}
					className={cn(
						'absolute inset-0 flex items-center justify-center rounded-sm text-foreground focus-visible:opacity-100',
						isStarting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
						disabledReason ? 'cursor-not-allowed text-muted-foreground' : 'cursor-pointer hover:bg-accent',
					)}
				>
					{isStarting ? <Spinner className='size-3' /> : <Play className='size-3' />}
				</button>
			</SimpleTooltip>
		</span>
	);
}

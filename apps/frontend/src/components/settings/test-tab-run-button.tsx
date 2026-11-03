import { useMutation } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { ReactNode } from 'react';

import type { ContextRunMode } from '@/components/settings/test-run-actions';
import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { useContextRunMode, useDraftContextRunStarts } from '@/components/settings/test-run-actions';
import { fromExplorerTestPath, getContextChanges } from '@/components/settings/test-run-types';
import { Spinner } from '@/components/ui/spinner';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

const RUN_LABELS: Record<ContextRunMode, string> = {
	compare: 'Compare this test with production',
	changes: 'Run this test with your changes',
	production: 'Run this test on production',
};

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

/** Runs one test the way its tab's play button does, on production or against the user's changes as they chose. */
export function useTestFileRun({
	testPath,
	testFile,
	isTestFileInvalid,
	settings,
	draft,
	activeRun,
	onRunStarted,
}: {
	testPath: string;
	testFile: { path: string; content: string } | null;
	isTestFileInvalid: boolean;
	settings: TestRunSettings;
	draft: DraftContext | null;
	activeRun: TestRunSummary | undefined;
	onRunStarted: (run: { id: string }) => void;
}) {
	const startRun = useMutation(trpc.testRun.startRun.mutationOptions({ onSuccess: onRunStarted }));
	const startDraftRun = useMutation(trpc.testRun.startDraftRun.mutationOptions({ onSuccess: onRunStarted }));
	const { startComparison, startChangesRun, ...starts } = useDraftContextRunStarts(onRunStarted, [
		startRun,
		startDraftRun,
	]);
	const [contextRunMode] = useContextRunMode();
	const mode = getContextChanges(draft).length > 0 ? contextRunMode : null;
	const runSettings = { models: settings.models, attempts: settings.attempts };
	const savedTestPaths = [fromExplorerTestPath(testPath)];
	const testSelection = testFile ? { testFile } : { paths: savedTestPaths };

	const runOnProduction = () =>
		testFile
			? startDraftRun.mutate({ ...testFile, ...runSettings })
			: startRun.mutate({ paths: savedTestPaths, ...runSettings });

	const run = () =>
		starts.start(() => {
			if (mode === 'compare') {
				startComparison.mutate({ ...testSelection, ...runSettings });
			} else if (mode === 'changes') {
				startChangesRun.mutate({ ...testSelection, ...runSettings });
			} else {
				runOnProduction();
			}
		});

	return {
		mode: mode ?? 'production',
		label: mode ? RUN_LABELS[mode] : 'Run this test',
		disabledReason: getDisabledReason({ activeRun, settings, isTestFileInvalid, isStarting: starts.isStarting }),
		error: starts.error,
		isStarting: starts.isStarting,
		run,
	};
}

function getDisabledReason({
	activeRun,
	settings,
	isTestFileInvalid,
	isStarting,
}: {
	activeRun: TestRunSummary | undefined;
	settings: TestRunSettings;
	isTestFileInvalid: boolean;
	isStarting: boolean;
}): string | null {
	if (activeRun) {
		return 'Wait for the run in progress to finish.';
	}
	if (settings.models.length === 0) {
		return 'Loading the models…';
	}
	if (isTestFileInvalid) {
		return 'Fix the test file first.';
	}
	return isStarting ? 'Starting the run…' : null;
}

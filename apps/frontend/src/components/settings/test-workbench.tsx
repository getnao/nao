import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Play } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import type { RunFilters } from '@/components/settings/test-run-filter-menu';
import type { RunBranches } from '@/components/settings/test-run-labels';
import type { RunListContext } from '@/components/settings/test-run-list-item';
import type { DraftContext, TestHistoryRun, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestFileValidationState } from '@/hooks/use-test-file-validation';
import type { ContextRunMode } from '@/hooks/use-test-run-start';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { RecentRunsHeader, RUNS_COLUMN_WIDTH_CLASS } from '@/components/settings/test-drawer-layout';
import { RunDetails } from '@/components/settings/test-run-details';
import { ALL_RUNS, matchesRunFilters } from '@/components/settings/test-run-filter-menu';
import { BranchCode, BranchName, getMainBranch, getRunBranches } from '@/components/settings/test-run-labels';
import { describeRunListItem, RunListItem } from '@/components/settings/test-run-list-item';
import { ACTIVE_RUN_REFETCH_MS, fromExplorerTestPath, isActiveRun } from '@/components/settings/test-run-types';
import { Button } from '@/components/ui/button';
import { Empty } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useTestFileRun } from '@/hooks/use-test-run-start';
import { cn } from '@/lib/utils';
import { trpc } from '@/main';

interface TestWorkbenchProps {
	testFile: { path: string; content: string };
	/** The check of the test as it is in the editor. */
	validation: TestFileValidationState;
	draft: DraftContext | null;
	/** The run shown, or `null` for the latest one. */
	selectedRunId: string | null;
	onSelectRun: (runId: string) => void;
	runSettings: TestRunSettings;
	activeRun: TestRunSummary | undefined;
	onRunStarted: (run: { id: string }) => void;
}

/** Shows how the latest runs of the test open in the editor went, attempt by attempt. */
export function TestWorkbench({
	testFile,
	validation,
	draft,
	selectedRunId,
	onSelectRun,
	runSettings,
	activeRun,
	onRunStarted,
}: TestWorkbenchProps) {
	const history = useQuery({
		...trpc.testRun.getTestHistory.queryOptions({ path: testFile.path }),
		refetchInterval: (query) => (query.state.data?.some(isActiveRun) ? ACTIVE_RUN_REFETCH_MS : false),
	});
	const currentHash = validation.validation?.test?.hash;
	const runs = history.data ?? [];
	const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs.at(0);
	const runListContext = { mainBranch: getMainBranch(draft), testPath: fromExplorerTestPath(testFile.path) };

	return (
		<div className='flex h-full min-h-0 flex-col'>
			<ValidationNotice validation={validation} />

			{history.isLoading ? (
				<div className='flex flex-1 items-center justify-center'>
					<Spinner />
				</div>
			) : history.error ? (
				<Empty className='flex-1'>Could not load the runs of this test: {history.error.message}</Empty>
			) : runs.length === 0 || !selectedRun ? (
				<NeverRunState
					testFile={testFile}
					validation={validation}
					draft={draft}
					runSettings={runSettings}
					activeRun={activeRun}
					onRunStarted={onRunStarted}
				/>
			) : (
				<div className='flex min-h-0 flex-1'>
					<RunList
						runs={runs}
						selectedRunId={selectedRun.id}
						currentHash={currentHash}
						runListContext={runListContext}
						onSelect={onSelectRun}
					/>
					<RunDetails
						key={selectedRun.id}
						run={selectedRun}
						isOutdated={isRunOfAnotherVersion(selectedRun, currentHash)}
						branches={getRunBranches(selectedRun, draft)}
					/>
				</div>
			)}
		</div>
	);
}

function RunList({
	runs,
	selectedRunId,
	currentHash,
	runListContext,
	onSelect,
}: {
	runs: TestHistoryRun[];
	selectedRunId: string;
	currentHash: string | undefined;
	runListContext: RunListContext;
	onSelect: (runId: string) => void;
}) {
	const [filters, setFilters] = useState<RunFilters>(ALL_RUNS);
	const listedRuns = runs.filter((run) => matchesRunFilters(run, filters));
	return (
		<div className={cn('flex shrink-0 flex-col overflow-y-auto border-r text-xs', RUNS_COLUMN_WIDTH_CLASS)}>
			<RecentRunsHeader filters={filters} onChange={setFilters} />
			{listedRuns.length === 0 && (
				<span className='px-3 py-2 text-muted-foreground'>No run matches the filter.</span>
			)}
			<div className='flex flex-col gap-0.5 p-1' role='listbox' aria-label='Runs'>
				{listedRuns.map((run) => (
					<RunListItem
						key={run.id}
						view={describeRunListItem(run, runListContext)}
						isSelected={run.id === selectedRunId}
						isOutdated={isRunOfAnotherVersion(run, currentHash)}
						isOption
						onSelect={() => onSelect(run.id)}
					/>
				))}
			</div>
		</div>
	);
}

/** Says the test has not run yet, with a button that runs it the way the tab's play button would. */
function NeverRunState({
	testFile,
	validation,
	draft,
	runSettings,
	activeRun,
	onRunStarted,
}: {
	testFile: { path: string; content: string };
	validation: TestFileValidationState;
	draft: DraftContext | null;
	runSettings: TestRunSettings;
	activeRun: TestRunSummary | undefined;
	onRunStarted: (run: { id: string }) => void;
}) {
	const testRun = useTestFileRun({
		testPath: testFile.path,
		testFile,
		isTestFileInvalid: !validation.validation?.test,
		settings: runSettings,
		draft,
		activeRun,
		onRunStarted,
	});
	const branches = getRunBranches({}, draft);
	const invitation = describeRunInvitation(testRun.mode, branches);

	return (
		<div className='flex flex-1 flex-col items-center justify-center gap-1 p-4 text-center text-sm'>
			<span className='font-medium text-foreground'>This test has not run yet.</span>
			<span className='text-muted-foreground'>{invitation.sentence}</span>
			<Button
				type='button'
				size='sm'
				className='mt-3 gap-1.5'
				disabled={testRun.disabledReason !== null}
				title={testRun.disabledReason ?? undefined}
				onClick={testRun.run}
			>
				{testRun.isStarting ? <Spinner className='size-3.5' /> : <Play className='size-3.5' />}
				<span>{invitation.button}</span>
			</Button>
			{testRun.error && <span className='text-xs text-destructive'>{testRun.error}</span>}
		</div>
	);
}

/** Says why the test cannot run, and nothing while it is valid, as the tab already names it. */
function ValidationNotice({ validation }: { validation: TestFileValidationState }) {
	const message = describeValidationError(validation);
	if (!message) {
		return null;
	}
	return (
		<div className='flex shrink-0 items-start gap-1.5 border-b bg-destructive/5 px-3 py-1.5 text-xs text-destructive'>
			<CircleAlert className='mt-px size-3.5 shrink-0' />
			<pre className='min-w-0 font-sans whitespace-pre-wrap'>{message}</pre>
		</div>
	);
}

function describeRunInvitation(
	mode: ContextRunMode,
	branches: RunBranches,
): { sentence: ReactNode; button: ReactNode } {
	switch (mode) {
		case 'compare':
			return {
				sentence: (
					<>
						Compare it with <BranchName name={branches.main} /> to see how your changes affect it.
					</>
				),
				button: (
					<>
						Compare with <BranchCode name={branches.main} />
					</>
				),
			};
		case 'changes':
			return {
				sentence: 'Run it with your changes to check that the agent answers like the reference SQL.',
				button: 'Run with your changes',
			};
		case 'production':
			return {
				sentence: 'Run it to check that the agent answers like the reference SQL.',
				button: 'Run test',
			};
	}
}

function describeValidationError(validation: TestFileValidationState): string | null {
	if (validation.error) {
		return `Could not check the test: ${validation.error}`;
	}
	const checked = validation.validation;
	if (checked?.error) {
		return `Invalid test: ${checked.error}`;
	}
	return checked && !checked.test ? 'Invalid test: the file does not define a test.' : null;
}

function isRunOfAnotherVersion(run: TestHistoryRun, currentHash: string | undefined): boolean {
	const ranHash = run.results.at(0)?.testHash;
	return !!currentHash && !!ranHash && ranHash !== currentHash;
}

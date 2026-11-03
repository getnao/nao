import { useMutation } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import { fromExplorerTestPath, getContextChanges } from '@/components/settings/test-run-types';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

export type ContextRunMode = 'compare' | 'changes' | 'production';

/** The tests a run covers: one test as it is in the editor, or saved tests, the whole suite when `paths` is undefined. */
type RunTarget = { testFile: { path: string; content: string } } | { paths: string[] | undefined };

interface TestRunStartOptions {
	target: RunTarget;
	/** Why these tests cannot run, such as an invalid test file, or `null` when they can. */
	blockedReason: string | null;
	settings: TestRunSettings;
	draft: DraftContext | null;
	activeRun: TestRunSummary | undefined;
	onRunStarted: (run: { id: string }) => void;
}

const CONTEXT_RUN_MODES: ContextRunMode[] = ['compare', 'changes', 'production'];

const TEST_FILE_RUN_LABELS: Record<ContextRunMode, string> = {
	compare: 'Compare this test with production',
	changes: 'Run this test with your changes',
	production: 'Run this test on production',
};

const contextRunModeStorage = createLocalStorage<ContextRunMode>('nao-test-context-run-mode', 'compare');
const contextRunModeListeners = new Set<() => void>();

/**
 * Starts a run of some tests on production, with the user's changes, or both side by side, as picked in the menu of
 * the compare button. Runs go to production alone while the context has no changes.
 */
export function useTestRunStart({
	target,
	blockedReason,
	settings,
	draft,
	activeRun,
	onRunStarted,
}: TestRunStartOptions) {
	const startRun = useMutation(trpc.testRun.startRun.mutationOptions({ onSuccess: onRunStarted }));
	const startDraftRun = useMutation(trpc.testRun.startDraftRun.mutationOptions({ onSuccess: onRunStarted }));
	const startComparison = useMutation(trpc.testRun.startComparisonRun.mutationOptions({ onSuccess: onRunStarted }));
	const startChangesRun = useMutation(trpc.testRun.startChangesRun.mutationOptions({ onSuccess: onRunStarted }));
	const allStarts = [startRun, startDraftRun, startComparison, startChangesRun];
	const [contextRunMode] = useContextRunMode();
	const hasContextChanges = getContextChanges(draft).length > 0;
	const mode: ContextRunMode = hasContextChanges ? contextRunMode : 'production';
	const isStarting = allStarts.some((runStart) => runStart.isPending);
	const runSettings = { models: settings.models, attempts: settings.attempts };

	const startInMode = () => {
		if (mode === 'compare') {
			startComparison.mutate({ ...target, ...runSettings });
		} else if (mode === 'changes') {
			startChangesRun.mutate({ ...target, ...runSettings });
		} else if ('testFile' in target) {
			startDraftRun.mutate({ ...target.testFile, ...runSettings });
		} else {
			startRun.mutate({ paths: target.paths, ...runSettings });
		}
	};

	const run = () => {
		allStarts.forEach((runStart) => runStart.reset());
		startInMode();
	};

	return {
		mode,
		hasContextChanges,
		isStarting,
		error: allStarts.find((runStart) => runStart.error)?.error?.message,
		disabledReason: getRunDisabledReason({ activeRun, blockedReason, settings, isStarting }),
		run,
	};
}

/** Runs one test the way its tab's play button does: as it is in the editor when given, else as it is saved. */
export function useTestFileRun({
	testPath,
	testFile,
	isTestFileInvalid,
	...options
}: Omit<TestRunStartOptions, 'target' | 'blockedReason'> & {
	/** The explorer path of the test. */
	testPath: string;
	testFile: { path: string; content: string } | null;
	isTestFileInvalid: boolean;
}) {
	const testRun = useTestRunStart({
		...options,
		target: testFile ? { testFile } : { paths: [fromExplorerTestPath(testPath)] },
		blockedReason: isTestFileInvalid ? 'Fix the test file first.' : null,
	});
	return {
		...testRun,
		label: testRun.hasContextChanges ? TEST_FILE_RUN_LABELS[testRun.mode] : 'Run this test',
	};
}

/** How runs start when the context has changes, picked in the menu of the compare button and shared by every button. */
export function useContextRunMode() {
	const storedMode = useSyncExternalStore(subscribeToContextRunMode, contextRunModeStorage.get);
	const mode: ContextRunMode = CONTEXT_RUN_MODES.includes(storedMode) ? storedMode : 'compare';
	return [mode, setContextRunMode] as const;
}

function getRunDisabledReason({
	activeRun,
	blockedReason,
	settings,
	isStarting,
}: {
	activeRun: TestRunSummary | undefined;
	blockedReason: string | null;
	settings: TestRunSettings;
	isStarting: boolean;
}): string | null {
	if (activeRun) {
		return 'Wait for the run in progress to finish.';
	}
	if (blockedReason) {
		return blockedReason;
	}
	if (settings.models.length === 0) {
		return 'Loading the models…';
	}
	return isStarting ? 'Starting the run…' : null;
}

function subscribeToContextRunMode(listener: () => void) {
	contextRunModeListeners.add(listener);
	return () => {
		contextRunModeListeners.delete(listener);
	};
}

function setContextRunMode(mode: ContextRunMode) {
	contextRunModeStorage.set(mode);
	contextRunModeListeners.forEach((listener) => listener());
}

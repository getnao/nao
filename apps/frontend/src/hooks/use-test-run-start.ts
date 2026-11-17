import { fromExplorerTestPath } from '@nao/shared/test-paths';
import { useMutation } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

import type { TrpcRouter } from '@nao/backend/trpc';
import type { inferRouterInputs } from '@trpc/server';
import type { DraftContext, TestRunSummary } from '@/components/settings/test-run-types';
import type { TestRunSettings } from '@/hooks/use-test-run-settings';
import type { UpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { getMainBranch } from '@/components/settings/test-run-labels';
import { getContextChanges } from '@/components/settings/test-run-types';
import { formatUpstreamRef, useUpstreamTestSource } from '@/hooks/use-upstream-test-source';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

type StartRunInput = inferRouterInputs<TrpcRouter>['testRun']['startRun'];

export type ContextRunMode = StartRunInput['mode'];

/** The tests a run covers: one test as it is in the editor, or saved tests, the whole suite when `paths` is undefined. */
type RunTarget = StartRunInput['target'];

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

const contextRunModeStorage = createLocalStorage<ContextRunMode>('nao-test-context-run-mode', 'compare');
const contextRunModeListeners = new Set<() => void>();

/**
 * Starts a run of some tests on the main branch, with the changes, or both side by side, as picked in the menu of the
 * compare button. The changes are the user's, or those of the upstream branch picked. Runs go to the main branch alone
 * while there are no changes.
 */
export function useTestRunStart({
	target,
	blockedReason,
	settings,
	draft,
	activeRun,
	onRunStarted,
}: TestRunStartOptions) {
	const runStart = useMutation(trpc.testRun.startRun.mutationOptions({ onSuccess: onRunStarted }));
	const [contextRunMode] = useContextRunMode();
	const [upstream, , isCheckingUpstream] = useUpstreamTestSource();
	const hasContextChanges = upstream !== null || getContextChanges(draft).length > 0;
	const mode: ContextRunMode = hasContextChanges ? contextRunMode : 'production';
	const isStarting = runStart.isPending;

	return {
		mode,
		hasContextChanges,
		upstream,
		isStarting,
		error: runStart.error?.message,
		disabledReason: getRunDisabledReason({ activeRun, blockedReason, settings, isStarting, isCheckingUpstream }),
		run: () =>
			runStart.mutate({
				mode,
				target,
				models: settings.models,
				attempts: settings.attempts,
				threads: settings.threads,
				upstream: mode === 'production' ? undefined : (upstream ?? undefined),
			}),
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
		label: testRun.hasContextChanges
			? describeTestFileRun(testRun.mode, getMainBranch(options.draft), describeChanges(testRun.upstream))
			: 'Run this test',
	};
}

/** How runs start when the context has changes, picked in the menu of the compare button and shared by every button. */
export function useContextRunMode() {
	const storedMode = useSyncExternalStore(subscribeToContextRunMode, contextRunModeStorage.get);
	const mode: ContextRunMode = CONTEXT_RUN_MODES.includes(storedMode) ? storedMode : 'compare';
	return [mode, setContextRunMode] as const;
}

/** Names the tested changes in sentences such as "Run this test with your changes". */
export function describeChanges(upstream: UpstreamTestSource | null): string {
	return upstream ? formatUpstreamRef(upstream) : 'your changes';
}

function describeTestFileRun(mode: ContextRunMode, mainBranch: string, changes: string): string {
	switch (mode) {
		case 'compare':
			return `Compare this test with ${mainBranch}`;
		case 'changes':
			return `Run this test with ${changes}`;
		case 'production':
			return `Run this test on ${mainBranch}`;
	}
}

function getRunDisabledReason({
	activeRun,
	blockedReason,
	settings,
	isStarting,
	isCheckingUpstream,
}: {
	activeRun: TestRunSummary | undefined;
	blockedReason: string | null;
	settings: TestRunSettings;
	isStarting: boolean;
	isCheckingUpstream: boolean;
}): string | null {
	if (activeRun) {
		return 'Wait for the run in progress to finish.';
	}
	if (blockedReason) {
		return blockedReason;
	}
	if (settings.models.length === 0) {
		return settings.isLoading ? 'Loading the models…' : 'No model is configured for tests.';
	}
	if (isCheckingUpstream) {
		return 'Checking the synced repositories…';
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

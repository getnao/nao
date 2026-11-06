import { getModelReasoningEfforts } from '@nao/backend/provider-meta';
import { getDefaultTestRunThreads, MAX_TEST_RUN_ATTEMPTS, MAX_TEST_RUN_THREADS } from '@nao/backend/test-run';
import { isSameModel } from '@nao/shared/types';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { TestModelSelection } from '@nao/backend/test-run';
import type { ActiveEffort } from '@nao/backend/llm';

import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

export { MAX_TEST_RUN_ATTEMPTS, MAX_TEST_RUN_MODELS, MAX_TEST_RUN_THREADS } from '@nao/backend/test-run';

interface StoredTestRunSettings {
	models: TestModelSelection[];
	attempts: number;
	/** Only stored once the user picks them, so that they otherwise follow the selected models. */
	threads?: number;
}

export interface TestRunSettings extends Required<StoredTestRunSettings> {
	/** The models, attempts and threads come from this browser rather than from the project defaults. */
	isCustom: boolean;
	/** The project defaults are still loading, so `models` may be empty for now. */
	isLoading: boolean;
	update: (settings: Partial<StoredTestRunSettings>) => void;
	reset: () => void;
}

/**
 * The models, attempts and threads the tests run with: the user's pick, remembered per project in this browser, else the
 * `test` block of nao_config.yaml, else the project's default chat model.
 */
export function useTestRunSettings(): TestRunSettings {
	const project = useQuery(trpc.project.getCurrent.queryOptions());
	const suite = useQuery(trpc.testRun.listTests.queryOptions());
	const defaultModel = useQuery(trpc.project.getDefaultChatModel.queryOptions());
	const availableModels = useQuery(trpc.project.listAvailableTranscribeModels.queryOptions());
	const projectId = project.data?.id;
	const [, setRevision] = useState(0);

	const stored = projectId ? testRunSettingsStorage(projectId).get() : null;
	const availableStoredModels = stored?.models.filter(
		(model) => !availableModels.data || availableModels.data.some((available) => isSameModel(available, model)),
	);
	useEffect(() => {
		if (!projectId || !availableModels.data) {
			return;
		}
		const storage = testRunSettingsStorage(projectId);
		const current = storage.get();
		const reconciledModels = current?.models.filter((model) =>
			availableModels.data.some((available) => isSameModel(available, model)),
		);
		if (!current || reconciledModels?.length === current.models.length) {
			return;
		}
		if (reconciledModels?.length) {
			storage.set({ ...current, models: reconciledModels });
		} else {
			localStorage.removeItem(storageKey(projectId));
		}
		setRevision((revision) => revision + 1);
	}, [availableModels.data, projectId]);
	const projectModels = suite.data?.settings.models ?? (defaultModel.data ? [defaultModel.data] : []);
	const models = availableStoredModels?.length ? availableStoredModels : projectModels;
	const attempts = Math.min(stored?.attempts ?? suite.data?.settings.attempts ?? 1, MAX_TEST_RUN_ATTEMPTS);
	const storedThreads = stored?.threads;
	const threads = Math.min(
		storedThreads ?? suite.data?.settings.threads ?? getDefaultTestRunThreads(countModelRuns(models)),
		MAX_TEST_RUN_THREADS,
	);
	const isLoading = project.isPending || suite.isPending || defaultModel.isPending;

	const update = useCallback(
		(settings: Partial<StoredTestRunSettings>) => {
			if (!projectId) {
				return;
			}
			testRunSettingsStorage(projectId).set({ models, attempts, threads: storedThreads, ...settings });
			setRevision((current) => current + 1);
		},
		[projectId, models, attempts, storedThreads],
	);

	const reset = useCallback(() => {
		if (projectId) {
			localStorage.removeItem(storageKey(projectId));
			setRevision((current) => current + 1);
		}
	}, [projectId]);

	return { models, attempts, threads, isCustom: stored !== null, isLoading, update, reset };
}

/** How many times a test runs per attempt: once per model, or once per reasoning effort picked for it. */
export function countModelRuns(models: TestModelSelection[]): number {
	return models.reduce((count, model) => count + countRunEfforts(model), 0);
}

/** How many reasoning efforts a picked model runs at, 1 when it runs at its configured one. */
export function countRunEfforts(model: TestModelSelection): number {
	return Math.max(listPickedEfforts(model).length, 1);
}

/** The reasoning efforts picked for a model that it supports, from the lowest. */
export function listPickedEfforts(model: TestModelSelection): ActiveEffort[] {
	return getModelReasoningEfforts(model.provider, model.modelId).filter((effort) =>
		model.reasoningEfforts?.includes(effort),
	);
}

function testRunSettingsStorage(projectId: string) {
	return createLocalStorage<StoredTestRunSettings>(storageKey(projectId));
}

function storageKey(projectId: string): string {
	return `nao-test-run-settings:${projectId}`;
}

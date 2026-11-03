import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { LlmSelectedModel } from '@nao/shared/types';
import { isSameTestModel } from '@/components/settings/test-run-types';
import { createLocalStorage } from '@/lib/local-storage';
import { trpc } from '@/main';

export const MAX_TEST_RUN_ATTEMPTS = 10;
export const MAX_TEST_RUN_MODELS = 10;

interface StoredTestRunSettings {
	models: LlmSelectedModel[];
	attempts: number;
}

export interface TestRunSettings extends StoredTestRunSettings {
	/** The models and attempts come from this browser rather than from the project defaults. */
	isCustom: boolean;
	update: (settings: Partial<StoredTestRunSettings>) => void;
	reset: () => void;
}

/**
 * The models and attempts the tests run with: the user's pick, remembered per project in this browser, else the
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
		(model) => !availableModels.data || availableModels.data.some((available) => isSameTestModel(available, model)),
	);
	const projectModels = suite.data?.settings.models ?? (defaultModel.data ? [defaultModel.data] : []);
	const models = availableStoredModels?.length ? availableStoredModels : projectModels;
	const attempts = stored?.attempts ?? suite.data?.settings.attempts ?? 1;

	const update = useCallback(
		(settings: Partial<StoredTestRunSettings>) => {
			if (!projectId) {
				return;
			}
			testRunSettingsStorage(projectId).set({ models, attempts, ...settings });
			setRevision((current) => current + 1);
		},
		[projectId, models, attempts],
	);

	const reset = useCallback(() => {
		if (projectId) {
			localStorage.removeItem(storageKey(projectId));
			setRevision((current) => current + 1);
		}
	}, [projectId]);

	return { models, attempts, isCustom: stored !== null, update, reset };
}

function testRunSettingsStorage(projectId: string) {
	return createLocalStorage<StoredTestRunSettings>(storageKey(projectId));
}

function storageKey(projectId: string): string {
	return `nao-test-run-settings:${projectId}`;
}

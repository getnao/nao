// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LlmProvidersSection } from './llm-providers-section';
import type * as ReactQuery from '@tanstack/react-query';
import { useLlmProviders } from '@/hooks/use-llm-providers';
import { usePermissions } from '@/hooks/use-permissions';

vi.mock('@tanstack/react-query', async (importOriginal) => ({
	...(await importOriginal<typeof ReactQuery>()),
	useQuery: vi.fn(() => ({ data: undefined })),
}));

vi.mock('@/hooks/use-llm-providers');
vi.mock('@/hooks/use-permissions');
vi.mock('@/main', () => ({
	trpc: {
		account: {
			getManagedCreditStatus: { queryOptions: vi.fn(() => ({})) },
			getCreditSummary: { queryOptions: vi.fn(() => ({})) },
		},
	},
}));
vi.mock('./llm-access-mode-control', () => ({
	LlmAccessModeControl: () => null,
}));

describe('LlmProvidersSection', () => {
	afterEach(cleanup);

	it('preserves an ENV credential stored name while editing', () => {
		vi.mocked(usePermissions).mockReturnValue({ isOrgAdmin: false } as ReturnType<typeof usePermissions>);
		vi.mocked(useLlmProviders).mockReturnValue({
			projectConfigs: [
				{
					id: 'openai-env',
					provider: 'openai',
					name: 'OpenAI (ENV)',
					credentialSource: 'env',
					enabledModels: [],
					customModels: [],
					modelSettings: {},
				},
			],
			configProviders: [],
			envProviders: ['openai'],
			envBaseUrls: {},
			availableProvidersToAdd: [],
			takenConfigNames: ['OpenAI', 'OpenAI (ENV)'],
			unconfiguredEnvProviders: [],
			unconfiguredConfigProviders: [],
			currentModels: [],
			isLoaded: true,
			editingState: {
				provider: 'openai',
				configId: 'openai-env',
				configName: 'OpenAI (ENV)',
				isEditing: true,
				inheritedKeySource: 'env',
				initialValues: {
					enabledModels: [],
					customModels: [],
					modelSettings: {},
					baseUrl: '',
				},
			},
			upsertPending: false,
			upsertError: null,
			deletePending: false,
			handleSubmit: vi.fn(),
			handleCancel: vi.fn(),
			handleEditConfig: vi.fn(),
			handleOverrideConfigProvider: vi.fn(),
			handleDeleteConfig: vi.fn(),
			handleSelectProvider: vi.fn(),
			handleConfigureEnvProvider: vi.fn(),
			handleEditProvider: vi.fn(),
			getModelDisplayName: vi.fn(),
		} as unknown as ReturnType<typeof useLlmProviders>);

		render(<LlmProvidersSection isAdmin={true} />);

		expect((screen.getByLabelText(/Credential name/) as HTMLInputElement).value).toBe('OpenAI (ENV)');
	});
});

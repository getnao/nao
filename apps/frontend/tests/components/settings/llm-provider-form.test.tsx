// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubScrollIntoView } from '../../helpers/browser-stubs';
import { createTestQueryClient } from '../../helpers/query-client';
import { LlmProviderForm } from '@/components/settings/llm-provider-form';

const mocks = vi.hoisted(() => ({
	listDatabricksServingEndpoints: vi.fn(),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			listDatabricksServingEndpoints: {
				mutationOptions: () => ({ mutationFn: mocks.listDatabricksServingEndpoints }),
			},
		},
	},
}));

describe('LlmProviderForm', () => {
	afterEach(cleanup);

	it('enables a serving endpoint listed from the Databricks workspace', async () => {
		mocks.listDatabricksServingEndpoints.mockResolvedValue(['databricks-claude-sonnet-4-5', 'team-gpt']);
		render(
			<QueryClientProvider client={createTestQueryClient()}>
				<LlmProviderForm
					provider='databricks'
					isEditing={false}
					inheritedKeySource={null}
					currentModels={[]}
					onSubmit={vi.fn()}
					onCancel={vi.fn()}
					isPending={false}
					error={null}
					title='Add Databricks'
				/>
			</QueryClientProvider>,
		);

		fireEvent.change(screen.getByLabelText(/Workspace URL/), {
			target: { value: 'https://dbc-123.cloud.databricks.com' },
		});
		fireEvent.change(screen.getByPlaceholderText('Enter bearer token or leave empty for env credentials'), {
			target: { value: 'dapi-token' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Load endpoints' }));
		fireEvent.click(await screen.findByRole('button', { name: 'team-gpt' }));

		expect(mocks.listDatabricksServingEndpoints.mock.calls[0][0]).toEqual({
			configId: undefined,
			baseUrl: 'https://dbc-123.cloud.databricks.com',
			apiKey: 'dapi-token',
			credentials: {},
		});
		expect(screen.getByRole('button', { name: 'Remove team-gpt' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'team-gpt' })).toBeNull();
		expect(screen.getByRole('button', { name: 'databricks-claude-sonnet-4-5' })).toBeTruthy();
	});

	it('lists the serving endpoints of a saved Databricks config as soon as it opens', async () => {
		mocks.listDatabricksServingEndpoints.mockReset().mockResolvedValue(['team-gpt']);
		render(
			<QueryClientProvider client={createTestQueryClient()}>
				<LlmProviderForm
					provider='databricks'
					configId='config-1'
					isEditing={true}
					inheritedKeySource={null}
					currentModels={[]}
					onSubmit={vi.fn()}
					onCancel={vi.fn()}
					isPending={false}
					error={null}
					title='Edit Databricks'
				/>
			</QueryClientProvider>,
		);

		expect(await screen.findByRole('button', { name: 'team-gpt' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Reload endpoints' })).toBeTruthy();
		expect(mocks.listDatabricksServingEndpoints).toHaveBeenCalledTimes(1);
		expect(mocks.listDatabricksServingEndpoints.mock.calls[0][0]).toMatchObject({ configId: 'config-1' });
	});

	it('describes inherited config credentials for optional-auth providers', () => {
		render(
			<LlmProviderForm
				provider='bedrock'
				isEditing={true}
				inheritedKeySource='config'
				currentModels={[]}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
				isPending={false}
				error={null}
				title='Override bedrock'
			/>,
		);

		expect(screen.getByText('(optional - leave empty to use nao_config.yaml)')).toBeTruthy();
		expect(screen.getByPlaceholderText('Enter bearer token to override nao_config.yaml')).toBeTruthy();
		expect(screen.queryByText(/leave empty to use AWS credentials from environment/)).toBeNull();
	});

	it('opens the settings dialog of the model it is focused on, and follows a new focus', () => {
		stubScrollIntoView();
		const { rerender } = render(renderFocusedForm('acme/new-model'));

		expect(within(screen.getByRole('dialog')).getByText(/acme\/new-model/)).toBeTruthy();

		rerender(renderFocusedForm('acme/other-model'));

		expect(within(screen.getByRole('dialog')).getByText(/acme\/other-model/)).toBeTruthy();
	});
});

function renderFocusedForm(focusedModelId: string) {
	return (
		<LlmProviderForm
			provider='openrouter'
			isEditing={true}
			inheritedKeySource={null}
			initialValues={{
				enabledModels: ['acme/new-model', 'acme/other-model'],
				customModels: [{ id: 'acme/new-model' }, { id: 'acme/other-model' }],
				modelSettings: {},
				baseUrl: '',
			}}
			initialEditedModelId={focusedModelId}
			currentModels={[]}
			onSubmit={vi.fn()}
			onCancel={vi.fn()}
			isPending={false}
			error={null}
			title='Edit OpenRouter'
		/>
	);
}

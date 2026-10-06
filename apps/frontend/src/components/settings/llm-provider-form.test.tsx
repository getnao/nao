// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmProviderForm } from './llm-provider-form';

describe('LlmProviderForm', () => {
	afterEach(cleanup);

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

	it('opens the settings dialog of the model it is focused on', () => {
		Element.prototype.scrollIntoView = vi.fn();
		render(
			<LlmProviderForm
				provider='openrouter'
				isEditing={true}
				inheritedKeySource={null}
				initialValues={{
					enabledModels: ['acme/new-model'],
					customModels: [{ id: 'acme/new-model' }],
					modelSettings: {},
					baseUrl: '',
				}}
				initialEditedModelId='acme/new-model'
				currentModels={[]}
				onSubmit={vi.fn()}
				onCancel={vi.fn()}
				isPending={false}
				error={null}
				title='Edit OpenRouter'
			/>,
		);

		expect(screen.getByText('Token cost')).toBeTruthy();
	});
});

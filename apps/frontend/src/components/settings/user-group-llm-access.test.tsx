// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserGroupLlmAccess } from './user-group-llm-access';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
	useQuery: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: mocks.useQuery,
}));
vi.mock('@tanstack/react-router', () => ({
	Link: ({
		children,
		search,
		to,
	}: {
		children: ReactNode;
		search: { tab: string; provider?: string };
		to: string;
	}) => (
		<a href={to} data-search={JSON.stringify(search)}>
			{children}
		</a>
	),
}));
vi.mock('@/main', () => ({
	trpc: {
		project: {
			getLlmConfigs: { queryOptions: vi.fn(() => ({ queryKey: ['llm-configs'] })) },
		},
	},
}));

describe('UserGroupLlmAccess', () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView = vi.fn();
		mocks.useQuery.mockReturnValue({
			data: {
				projectConfigs: [
					{
						id: 'env-openai',
						name: 'OpenAI (ENV)',
						provider: 'openai',
						credentialSource: 'env',
						apiKeyPreview: null,
						credentialPreviews: null,
						enabledModels: [],
						availableModels: [{ id: 'gpt-5-mini', name: 'GPT-5 mini' }],
						customModels: [],
						modelSettings: {},
						baseUrl: null,
					},
				],
				configProviders: [],
				envProviders: ['openai'],
				envBaseUrls: {},
			},
			isLoading: false,
			isError: false,
		});
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('assigns an automatically registered ENV credential', () => {
		const onChange = vi.fn();
		render(<UserGroupLlmAccess llmConfigIds={[]} llmModelIdsByConfig={{}} isLicensed onChange={onChange} />);

		fireEvent.click(screen.getByRole('checkbox', { name: /OpenAI \(ENV\)/ }));

		expect(onChange).toHaveBeenCalledWith({
			llmConfigIds: ['env-openai'],
			llmModelIdsByConfig: {},
		});
		expect(screen.getByText('OpenAI · ENV')).toBeTruthy();
	});

	it('keeps access controls interactive while autosaving', () => {
		const onChange = vi.fn();
		const { rerender } = render(
			<UserGroupLlmAccess
				llmConfigIds={[]}
				llmModelIdsByConfig={{}}
				isLicensed
				saveStatus='saving'
				onChange={onChange}
			/>,
		);

		expect((screen.getByRole('checkbox', { name: /OpenAI \(ENV\)/ }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByRole('status').textContent).toBe('Saving...');

		rerender(
			<UserGroupLlmAccess
				llmConfigIds={[]}
				llmModelIdsByConfig={{}}
				isLicensed
				saveStatus='saved'
				onChange={onChange}
			/>,
		);
		expect(screen.getByRole('status').textContent).toBe('Saved');
	});

	it('silently removes unavailable credential assignments from the form', async () => {
		const onChange = vi.fn();
		render(
			<UserGroupLlmAccess
				llmConfigIds={['unavailable-config', 'env-openai']}
				llmModelIdsByConfig={{
					'unavailable-config': ['old-model'],
					'env-openai': ['gpt-5-mini'],
				}}
				isLicensed
				onChange={onChange}
			/>,
		);

		await waitFor(() =>
			expect(onChange).toHaveBeenCalledWith({
				llmConfigIds: ['env-openai'],
				llmModelIdsByConfig: { 'env-openai': ['gpt-5-mini'] },
			}),
		);
		expect(screen.queryByText(/unavailable credential/)).toBeNull();
	});

	it('shows inherited models as checked and read-only', () => {
		const onChange = vi.fn();
		render(
			<UserGroupLlmAccess
				llmConfigIds={[]}
				llmModelIdsByConfig={{}}
				inheritedLlmConfigIds={['env-openai']}
				inheritedLlmModelIdsByConfig={{ 'env-openai': ['gpt-5-mini'] }}
				isLicensed
				onChange={onChange}
			/>,
		);

		const inheritedModel = screen.getByRole('checkbox', { name: /GPT-5 mini/ }) as HTMLButtonElement;
		expect(inheritedModel.getAttribute('aria-checked')).toBe('true');
		expect(inheritedModel.disabled).toBe(true);
		fireEvent.click(inheritedModel);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('freezes the current catalog when switching from all to selected models', () => {
		const onChange = vi.fn();
		render(
			<UserGroupLlmAccess
				llmConfigIds={['env-openai']}
				llmModelIdsByConfig={{}}
				isLicensed
				onChange={onChange}
			/>,
		);

		fireEvent.keyDown(screen.getByRole('combobox', { name: 'OpenAI (ENV) model access' }), { key: 'Enter' });
		fireEvent.click(screen.getByRole('option', { name: 'Selected models' }));

		expect(onChange).toHaveBeenCalledWith({
			llmConfigIds: ['env-openai'],
			llmModelIdsByConfig: { 'env-openai': ['gpt-5-mini'] },
		});
	});
});

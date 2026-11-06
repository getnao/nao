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
		render(<UserGroupLlmAccess llmConfigIds={[]} isLicensed onChange={onChange} />);

		fireEvent.click(screen.getByRole('checkbox', { name: /OpenAI \(ENV\)/ }));

		expect(onChange).toHaveBeenCalledWith(['env-openai']);
		expect(screen.getByText('OpenAI · ENV')).toBeTruthy();
	});

	it('silently removes unavailable credential assignments from the form', async () => {
		const onChange = vi.fn();
		render(
			<UserGroupLlmAccess llmConfigIds={['unavailable-config', 'env-openai']} isLicensed onChange={onChange} />,
		);

		await waitFor(() => expect(onChange).toHaveBeenCalledWith(['env-openai']));
		expect(screen.queryByText(/unavailable credential/)).toBeNull();
	});

	it('shows inherited credentials as checked and read-only', () => {
		const onChange = vi.fn();
		render(
			<UserGroupLlmAccess
				llmConfigIds={[]}
				inheritedLlmConfigIds={['env-openai']}
				isLicensed
				onChange={onChange}
			/>,
		);

		const inheritedCredential = screen.getByRole('checkbox', { name: /OpenAI \(ENV\)/ }) as HTMLButtonElement;
		expect(inheritedCredential.getAttribute('aria-checked')).toBe('true');
		expect(inheritedCredential.disabled).toBe(true);
		fireEvent.click(inheritedCredential);
		expect(onChange).not.toHaveBeenCalled();
	});
});

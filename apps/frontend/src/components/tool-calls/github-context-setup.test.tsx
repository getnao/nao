// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GithubContextSetup } from './github-context-setup';
import type { GithubContextValues } from './github-context-setup';

const mocks = vi.hoisted(() => ({ connected: true }));

vi.mock('@/main', () => ({
	trpc: {
		github: {
			isAvailable: {
				queryOptions: () => ({
					queryKey: ['github-available'],
					queryFn: async () => true,
				}),
			},
			getStatus: {
				queryOptions: () => ({
					queryKey: ['github-status'],
					queryFn: async () =>
						mocks.connected
							? { connected: true, user: { login: 'octocat', avatarUrl: '' } }
							: { connected: false },
				}),
			},
		},
	},
}));

vi.mock('@/components/settings/github-repo-list', () => ({
	GithubRepoList: ({
		onSelect,
	}: {
		onSelect: (value: string, repo: { full_name: string; default_branch: string }) => void;
	}) => (
		<button
			type='button'
			onClick={() => onSelect('acme/analytics', { full_name: 'acme/analytics', default_branch: 'main' })}
		>
			acme/analytics
		</button>
	),
}));

afterEach(() => {
	cleanup();
	mocks.connected = true;
	vi.restoreAllMocks();
});

describe('GithubContextSetup', () => {
	it('selects a repository from the connected GitHub account', async () => {
		const onValuesChange = vi.fn();
		render(
			<QueryClientProvider client={new QueryClient()}>
				<GithubHarness onValuesChange={onValuesChange} />
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		await waitFor(() => expect(screen.getByText('Connected as octocat')).toBeTruthy());
		fireEvent.click(screen.getByRole('button', { name: 'acme/analytics' }));

		expect(screen.getByText('Connected')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
		expect(onValuesChange).toHaveBeenCalledWith({ repoFullName: 'acme/analytics', branch: 'main' });
	});

	it('clears the waiting state when GitHub redirects with an error', async () => {
		mocks.connected = false;
		const popup = {
			closed: false,
			close: vi.fn(),
			location: { href: 'http://localhost/onboarding?github=error&reason=exchange_failed' },
		} as unknown as Window;
		vi.spyOn(window, 'open').mockReturnValue(popup);
		render(
			<QueryClientProvider client={new QueryClient()}>
				<GithubHarness onValuesChange={vi.fn()} />
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
		const connectButton = await screen.findByRole('button', { name: 'Connect GitHub' });
		await waitFor(() => expect((connectButton as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(connectButton);
		expect(screen.getByRole('button', { name: 'Waiting for GitHub…' })).toBeTruthy();

		await screen.findByText('GitHub authorization failed. Please try again.');
		expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeTruthy();
		expect(popup.close).toHaveBeenCalledOnce();
	});
});

function GithubHarness({ onValuesChange }: { onValuesChange: (values: GithubContextValues) => void }) {
	const [values, setValues] = useState<GithubContextValues>({ repoFullName: '', branch: '' });
	const handleValuesChange = (nextValues: GithubContextValues) => {
		setValues(nextValues);
		onValuesChange(nextValues);
	};

	return <GithubContextSetup values={values} isStarting={false} onValuesChange={handleValuesChange} />;
}

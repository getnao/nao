// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { RepoList } from '@/components/settings/repo-list';

interface Repo {
	id: number;
	name: string;
}

const REPOS: Repo[] = [{ id: 1, name: 'getnao/chat-analytics' }];

afterEach(() => {
	cleanup();
});

describe('RepoList search', () => {
	it.each([
		['while the search is being typed', false, true],
		['while the results of the search load', true, false],
	])('shows a loader %s', (_moment, isShowingPreviousResults, typesSearch) => {
		renderRepoList({ isShowingPreviousResults });
		if (typesSearch) {
			fireEvent.change(screen.getByPlaceholderText('Search repositories...'), { target: { value: 'chat' } });
		}

		expect(screen.getByRole('status', { name: 'Searching repositories' })).toBeTruthy();
		expect(screen.getByText('getnao/chat-analytics').closest('[aria-busy]')?.getAttribute('aria-busy')).toBe(
			'true',
		);
	});

	it('shows no loader once the results are in', () => {
		renderRepoList({ isShowingPreviousResults: false });

		expect(screen.queryByRole('status', { name: 'Searching repositories' })).toBeNull();
	});
});

function renderRepoList({ isShowingPreviousResults }: { isShowingPreviousResults: boolean }) {
	render(
		<RepoList<Repo>
			selected={null}
			onSelect={() => undefined}
			searchPlaceholder='Search repositories...'
			resourceNounPlural='repositories'
			useItems={() => ({ data: { items: REPOS, hasMore: false }, isLoading: false, isShowingPreviousResults })}
			getKey={(repo) => repo.id}
			getValue={(repo) => repo.name}
			getLabel={(repo) => repo.name}
			getDescription={() => null}
			getUpdatedAt={() => '2026-11-01T00:00:00.000Z'}
			isPrivate={() => false}
		/>,
	);
}

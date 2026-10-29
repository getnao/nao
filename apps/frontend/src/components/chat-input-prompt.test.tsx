// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ChatPrompt } from './chat-input-prompt';
import { setActiveProjectId } from '@/lib/active-project';

const mocks = vi.hoisted(() => ({
	project: null as { id: string } | null,
	storage: new Map<string, string>(),
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[] }) => {
		switch (options.queryKey[0]) {
			case 'project':
				return { data: mocks.project };
			case 'skills':
				return { data: [{ name: 'Old skill', description: null }], isFetching: false };
			case 'database-objects':
				return {
					data: [
						{
							type: 'table',
							database: 'old',
							schema: 'public',
							table: 'orders',
							fqdn: 'old.public.orders',
						},
					],
					isFetching: false,
				};
			default:
				return { data: undefined, isFetching: false };
		}
	},
}));

vi.mock('@tanstack/react-router', () => ({
	useParams: () => undefined,
}));

vi.mock('prompt-mentions', () => ({
	Prompt: ({ mentionConfigs }: { mentionConfigs: { options: { id: string; label: string }[] }[] }) => (
		<div>
			{mentionConfigs.flatMap((config) =>
				config.options.map((option) => (
					<span key={option.id} data-testid={`mention-${option.id}`}>
						{option.label}
					</span>
				)),
			)}
		</div>
	),
}));

vi.mock('@/hooks/use-custom-stories-enabled', () => ({
	useCustomStoriesEnabled: () => false,
}));

vi.mock('@/hooks/use-effective-user-group-features', () => ({
	useEffectiveUserGroupFeatures: () => ({ customStoryCreationEnabled: false }),
}));

vi.mock('@/main', () => ({
	trpc: {
		project: {
			getCurrent: { queryOptions: () => ({ queryKey: ['project'] }) },
			getDatabaseObjects: { queryOptions: () => ({ queryKey: ['database-objects'] }) },
		},
		skill: {
			list: { queryOptions: () => ({ queryKey: ['skills'] }) },
		},
		story: {
			listReferenceable: { queryOptions: () => ({ queryKey: ['referenceable-stories'] }) },
			listMostViewed: { queryOptions: () => ({ queryKey: ['most-viewed-stories'] }) },
		},
		storyFolder: {
			listTree: { queryOptions: () => ({ queryKey: ['story-folders'] }) },
			listItems: { queryOptions: () => ({ queryKey: ['story-folder-items'] }) },
		},
	},
}));

beforeEach(() => {
	mocks.storage.clear();
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => mocks.storage.get(key) ?? null,
		setItem: (key: string, value: string) => mocks.storage.set(key, value),
	});
	setActiveProjectId(null);
	mocks.project = null;
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it('hides cached project mentions when no project is active', () => {
	render(<ChatPrompt promptRef={{ current: null }} placeholder='' storyCreationEnabled={false} onChange={vi.fn()} />);

	expect(screen.queryByTestId('mention-Old skill')).toBeNull();
	expect(screen.queryByTestId('mention-old.public.orders')).toBeNull();
});

it('shows project mentions when the active project id is corrected', () => {
	setActiveProjectId('stale-project');
	mocks.project = { id: 'current-project' };
	render(<ChatPrompt promptRef={{ current: null }} placeholder='' storyCreationEnabled={false} onChange={vi.fn()} />);

	expect(screen.queryByTestId('mention-Old skill')).toBeNull();
	expect(screen.queryByTestId('mention-old.public.orders')).toBeNull();

	act(() => setActiveProjectId('current-project'));

	expect(screen.getByTestId('mention-Old skill')).toBeDefined();
	expect(screen.getByTestId('mention-old.public.orders')).toBeDefined();
});

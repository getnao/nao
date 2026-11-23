// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { stubLocalStorage } from '../helpers/browser-stubs';
import { ChatPrompt } from '@/components/chat-input-prompt';
import { setActiveProjectId } from '@/lib/active-project';

const mocks = vi.hoisted(() => ({
	project: null as { id: string } | null,
	canCreateSkill: false,
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey: string[] }) => {
		switch (options.queryKey[0]) {
			case 'project':
				return { data: mocks.project };
			case 'skills':
				return {
					data: [
						{ name: 'Old skill', description: '', scope: 'project' },
						{ name: 'my-skill', description: 'Mine.', scope: 'personal' },
					],
					isFetching: false,
				};
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
	useNavigate: () => vi.fn(),
}));

vi.mock('@/hooks/use-can-manage-personal-skills', () => ({
	useCanManagePersonalSkills: () => mocks.canCreateSkill,
}));

vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => ({ canExploreContext: false }) }));

vi.mock('@/components/personal-skills', async (importOriginal) => ({
	...((await importOriginal()) as object),
	NewSkillDialog: () => null,
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
	mocks.canCreateSkill = false;
	stubLocalStorage();
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

it('lists personal skills after the skills shared with everyone, without group titles', () => {
	setActiveProjectId('current-project');
	mocks.project = { id: 'current-project' };
	render(<ChatPrompt promptRef={{ current: null }} placeholder='' storyCreationEnabled={false} onChange={vi.fn()} />);

	const skillIds = screen.getAllByTestId(/^mention-/).map((element) => element.dataset.testid);
	expect(skillIds.slice(0, 2)).toEqual(['mention-Old skill', 'mention-my-skill']);
	expect(screen.queryByTestId('mention-skills-personal')).toBeNull();
});

it('ends the skills with "Create a skill" for people who can create one', () => {
	setActiveProjectId('current-project');
	mocks.project = { id: 'current-project' };
	mocks.canCreateSkill = true;
	render(<ChatPrompt promptRef={{ current: null }} placeholder='' storyCreationEnabled={false} onChange={vi.fn()} />);

	const skillIds = screen.getAllByTestId(/^mention-/).map((element) => element.dataset.testid);
	expect(skillIds.slice(0, 3)).toEqual(['mention-Old skill', 'mention-my-skill', 'mention-:create-skill']);

	cleanup();
	mocks.canCreateSkill = false;
	render(<ChatPrompt promptRef={{ current: null }} placeholder='' storyCreationEnabled={false} onChange={vi.fn()} />);
	expect(screen.queryByTestId('mention-:create-skill')).toBeNull();
});

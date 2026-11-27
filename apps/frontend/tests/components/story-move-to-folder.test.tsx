// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubScrollIntoView } from '../helpers/browser-stubs';
import { StoryMoveToFolderButton } from '@/components/story-move-to-folder';
import { TooltipProvider } from '@/components/ui/tooltip';

const PRIVATE_FOLDER = {
	id: 'private-root',
	parentId: null,
	name: 'My private folder',
	visibility: 'private',
	teamGroupIds: [],
};
const TEAM_FOLDER = { id: 'team', parentId: null, name: 'Team', visibility: 'public', teamGroupIds: [] };

const mocks = vi.hoisted(() => ({
	moveStory: vi.fn(),
	permissions: { isAdmin: false, isViewer: false },
	isAgentRunning: false,
	areFoldersLoaded: true,
	story: {} as { isOwner: boolean; isArchived: boolean; projectId: string; chatId: string | null },
}));

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey?: string }) => {
		const data = queryResults()[options.queryKey ?? ''];
		return { data, isSuccess: data !== undefined };
	},
	useMutation: (options: { mutationKey?: string }) => ({
		mutate: options.mutationKey === 'moveStory' ? mocks.moveStory : vi.fn(),
		isPending: false,
		error: null,
	}),
	useQueryClient: () => ({}),
}));
vi.mock('@/main', () => ({
	trpc: {
		project: { getCurrent: { queryOptions: () => ({ queryKey: 'project' }) } },
		story: { resolve: { queryOptions: () => ({ queryKey: 'resolve' }) } },
		storyFolder: {
			listTree: { queryOptions: () => ({ queryKey: 'tree' }) },
			listItems: { queryOptions: () => ({ queryKey: 'items' }) },
			moveStory: { mutationOptions: () => ({ mutationKey: 'moveStory' }) },
			move: { mutationOptions: () => ({}) },
			bulkMove: { mutationOptions: () => ({}) },
		},
	},
}));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => mocks.permissions }));
vi.mock('@/hooks/use-chat-activity', () => ({ useChatActivity: () => ({ running: mocks.isAgentRunning }) }));

describe('StoryMoveToFolderButton', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubScrollIntoView();
		mocks.permissions = { isAdmin: false, isViewer: false };
		mocks.isAgentRunning = false;
		mocks.areFoldersLoaded = true;
		mocks.story = { isOwner: true, isArchived: false, projectId: 'project-1', chatId: 'chat-1' };
	});

	afterEach(cleanup);

	it.each([
		['the story belongs to someone else', () => (mocks.story.isOwner = false)],
		['the story is archived', () => (mocks.story.isArchived = true)],
		['the story is in another project', () => (mocks.story.projectId = 'project-2')],
		['the user is a viewer', () => (mocks.permissions.isViewer = true)],
		['the agent is still editing the story', () => (mocks.isAgentRunning = true)],
	])('is hidden when %s', (_, arrange) => {
		arrange();
		renderButton();

		expect(screen.queryByRole('button', { name: 'Move to folder' })).toBeNull();
	});

	it("lets an admin move someone else's story", () => {
		mocks.story.isOwner = false;
		mocks.permissions.isAdmin = true;
		renderButton();

		expect(screen.getByRole('button', { name: 'Move to folder' })).toBeTruthy();
	});

	it('warns before making a private story public, then moves it to the chosen folder', () => {
		renderButton();

		fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }));
		fireEvent.click(screen.getByRole('button', { name: /Team/ }));
		expect(screen.getByText('Moving here will make this story public.')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Move here' }));

		expect(mocks.moveStory).toHaveBeenCalledWith({ storyId: 'story-1', folderId: 'team' });
	});

	it('keeps the move disabled while the folders are loading', () => {
		mocks.areFoldersLoaded = false;
		renderButton();

		fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }));

		expect(screen.getByRole('button', { name: 'Move here' })).toHaveProperty('disabled', true);
	});
});

function renderButton() {
	return render(
		<TooltipProvider>
			<StoryMoveToFolderButton storyId='story-1' />
		</TooltipProvider>,
	);
}

function queryResults(): Record<string, unknown> {
	return {
		resolve: { storyId: 'story-1', ...mocks.story },
		project: { id: 'project-1' },
		tree: mocks.areFoldersLoaded ? [PRIVATE_FOLDER, TEAM_FOLDER] : undefined,
		items: mocks.areFoldersLoaded ? [{ storyId: 'story-1', folderId: PRIVATE_FOLDER.id }] : undefined,
	};
}

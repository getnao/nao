// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubScrollIntoView } from '../helpers/browser-stubs';
import type { ShareModel } from '@/hooks/use-share-target';
import type { ShareDraft } from '@/lib/share-draft';
import type * as ShareDialogHooks from '@/hooks/use-share-dialog';
import type { ShareOwner } from '@/lib/share-access';
import { ShareDialog } from '@/components/share-dialog';

const ADA_GRANT = {
	key: 'user:ada',
	kind: 'user' as const,
	id: 'ada',
	name: 'Ada',
	detail: '',
	role: 'viewer' as const,
};
const ADA = { id: 'ada', name: 'Ada', email: 'ada@example.com' };
const GRACE = { id: 'grace', name: 'Grace', email: 'grace@example.com' };

const mocks = vi.hoisted(() => ({
	model: undefined as ShareModel | undefined,
	save: vi.fn(),
	transfer: vi.fn(),
	editDraft: undefined as ((draft: ShareDraft) => void) | undefined,
	changeOwner: undefined as ((owner: ShareOwner) => void) | undefined,
	canShareToProject: false,
}));

const FOLDER_TREE = [
	{
		id: 'private',
		name: 'My private folder',
		parentId: null,
		visibility: 'private',
		systemType: 'private_folder',
		teamGroupIds: [],
	},
	{ id: 'reports', name: 'Reports', parentId: null, visibility: 'public', systemType: null, teamGroupIds: [] },
];

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey?: string[] }) => ({
		data: { transferRecipients: [], folderTree: FOLDER_TREE }[options.queryKey?.[0] ?? ''] ?? false,
	}),
	useQueryClient: () => ({}),
	useMutation: () => ({ mutate: mocks.transfer, reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/main', () => ({
	trpc: {
		authConfig: { smtp: { isSetup: { queryOptions: () => ({}) } } },
		storyFolder: { listTree: { queryOptions: () => ({ queryKey: ['folderTree'] }) } },
		story: {
			listTransferRecipients: { queryOptions: () => ({ queryKey: ['transferRecipients'] }) },
			transferOwnership: { mutationOptions: () => ({}) },
		},
	},
}));
vi.mock('@/lib/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'owner' } } }) }));
vi.mock('@/hooks/use-share-target', () => ({
	useShareTarget: () => ({
		isLoading: false,
		model: mocks.model,
		refetch: vi.fn(),
		commands: { save: mocks.save, invalidate: async () => undefined },
	}),
}));
vi.mock('@/hooks/use-share-dialog', async (importOriginal) => ({
	...(await importOriginal<typeof ShareDialogHooks>()),
	useShareAudience: () => ({ canShareToProject: mocks.canShareToProject, isLoading: false }),
	useShareCandidates: () => ({ candidates: [], isLoading: false }),
}));
vi.mock('@/components/share-access-panel', () => ({
	ShareAccessPanel: ({
		draft,
		onDraftChange,
		onChangeOwner,
		children,
	}: {
		draft: ShareDraft;
		onDraftChange: (draft: ShareDraft) => void;
		onChangeOwner?: (owner: ShareOwner) => void;
		children?: React.ReactNode;
	}) => {
		mocks.editDraft = onDraftChange;
		mocks.changeOwner = onChangeOwner;
		return (
			<>
				<output aria-label='draft'>{`${draft.visibility}:${draft.grants.length}`}</output>
				{children}
			</>
		);
	},
}));

describe('ShareDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		stubScrollIntoView();
		mocks.canShareToProject = false;
		mocks.model = storyModel({ isShared: false });
		mocks.save.mockResolvedValue('https://nao.test/stories/story-1');
	});

	afterEach(cleanup);

	it('cannot share a story with nobody', () => {
		renderDialog();

		expect(screen.getByRole('button', { name: 'Share & copy link' })).toHaveProperty('disabled', true);
	});

	it('follows the project sharing right until the person changes the draft', () => {
		const { rerender } = renderDialog();
		expect(screen.getByLabelText('draft').textContent).toBe('specific:0');

		mocks.canShareToProject = true;
		rerender(<ShareDialog open onOpenChange={vi.fn()} target={STORY_TARGET} />);

		expect(screen.getByLabelText('draft').textContent).toBe('project:0');
	});

	it('stops sharing a shared story from its own button', async () => {
		mocks.model = storyModel({ isShared: true, grants: [ADA_GRANT] });
		renderDialog();

		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
		});

		expect(mocks.save).toHaveBeenCalledWith(
			{ visibility: 'specific', projectRole: 'viewer', grants: [] },
			{ notify: false },
		);
	});

	it('retries with the draft on screen, not the one that failed', async () => {
		mocks.model = storyModel({ isShared: true, grants: [ADA_GRANT] });
		mocks.save.mockRejectedValueOnce(new Error('Network down'));
		renderDialog();
		act(() => {
			mocks.editDraft?.({ visibility: 'project', projectRole: 'viewer', grants: [] });
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		});

		act(() => {
			mocks.editDraft?.({ visibility: 'project', projectRole: 'editor', grants: [] });
		});
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		});

		expect(mocks.save).toHaveBeenLastCalledWith(
			{ visibility: 'project', projectRole: 'editor', grants: [] },
			expect.anything(),
		);
	});

	it('files the story in the last used folder that fits once shared with the project', async () => {
		mocks.model = storyModel({
			isShared: true,
			grants: [ADA_GRANT],
			placement: { folderId: 'private', lastUsedFolderId: 'reports' },
		});
		renderDialog();
		act(() => mocks.editDraft?.({ visibility: 'project', projectRole: 'viewer', grants: [] }));
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		});

		expect(mocks.save).toHaveBeenCalledWith(expect.anything(), { notify: false, folderId: 'reports' });
	});

	it('leaves a story in a folder its owner cannot see until they pick another one', async () => {
		mocks.model = storyModel({
			isShared: true,
			grants: [ADA_GRANT],
			placement: { folderId: 'hidden-team-folder', lastUsedFolderId: null },
		});
		renderDialog();

		expect(screen.getByRole('button', { name: 'Save in' }).textContent).toBe('Current folder');
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

		act(() =>
			mocks.editDraft?.({
				visibility: 'specific',
				projectRole: 'viewer',
				grants: [{ ...ADA_GRANT, role: 'editor' }],
			}),
		);
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		});
		expect(mocks.save).toHaveBeenCalledWith(expect.anything(), { notify: false, folderId: undefined });
	});

	it('moves a project-wide story to the private folder with nobody picked yet', async () => {
		mocks.canShareToProject = true;
		mocks.model = storyModel({
			isShared: true,
			generalAccess: { visibility: 'project', projectRole: 'viewer' },
			placement: { folderId: 'reports', lastUsedFolderId: null },
		});
		renderDialog();
		fireEvent.click(screen.getByRole('button', { name: 'Save in' }));
		fireEvent.click(screen.getByRole('button', { name: /My private folder/ }));

		expect(screen.getByLabelText('draft').textContent).toBe('specific:0');
		await act(async () => {
			fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
		});
		expect(mocks.save).toHaveBeenCalledWith(expect.anything(), { notify: false, folderId: 'private' });
	});

	it('transfers ownership to the member picked, once confirmed', () => {
		renderDialog();
		act(() => mocks.changeOwner?.(GRACE));

		expect(mocks.transfer).not.toHaveBeenCalled();
		const confirmation = screen.getByRole('dialog', { name: 'Transfer ownership to Grace?' });
		fireEvent.click(within(confirmation).getByRole('button', { name: 'Transfer' }));

		expect(mocks.transfer).toHaveBeenCalledWith({ storyId: 'story-1', recipientId: 'grace' });
	});

	it('asks to save edited sharing before transferring, so the new owner gets the sharing shown', () => {
		mocks.model = storyModel({ isShared: true, grants: [ADA_GRANT] });
		renderDialog();
		act(() => mocks.editDraft?.({ visibility: 'project', projectRole: 'viewer', grants: [] }));
		act(() => mocks.changeOwner?.(GRACE));

		const confirmation = screen.getByRole('dialog', { name: 'Transfer ownership to Grace?' });

		expect(within(confirmation).getByRole('button', { name: 'Transfer' }).hasAttribute('disabled')).toBe(true);
		expect(within(confirmation).getByText(/Save or cancel your sharing changes first/)).toBeTruthy();
	});

	it('cancels an ownership transfer without running it', () => {
		renderDialog();
		act(() => mocks.changeOwner?.(ADA));

		const confirmation = screen.getByRole('dialog', { name: 'Transfer ownership to Ada?' });
		fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }));

		expect(screen.queryByRole('dialog', { name: 'Transfer ownership to Ada?' })).toBeNull();
		expect(mocks.transfer).not.toHaveBeenCalled();
	});
});

const STORY_TARGET = { kind: 'story' as const, chatId: 'chat-1', storySlug: 'revenue' };

function renderDialog() {
	return render(<ShareDialog open onOpenChange={vi.fn()} target={STORY_TARGET} />);
}

function storyModel(model: Partial<ShareModel>): ShareModel {
	return {
		itemLabel: 'story',
		storyId: 'story-1',
		owner: { id: 'owner', name: 'Owner', email: 'owner@example.com' },
		grants: [],
		generalAccess: { visibility: 'specific', projectRole: 'viewer' },
		isShared: false,
		canManage: true,
		withRoles: true,
		withGroups: true,
		shareUrl: 'https://nao.test/stories/story-1',
		placement: null,
		...model,
	};
}

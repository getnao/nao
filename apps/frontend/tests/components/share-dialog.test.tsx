// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('@tanstack/react-query', () => ({
	useQuery: (options: { queryKey?: string[] }) => ({
		data: options.queryKey?.[0] === 'transferRecipients' ? [] : false,
	}),
	useQueryClient: () => ({}),
	useMutation: () => ({ mutate: mocks.transfer, reset: vi.fn(), isPending: false, error: null }),
}));
vi.mock('@/main', () => ({
	trpc: {
		authConfig: { smtp: { isSetup: { queryOptions: () => ({}) } } },
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
	}: {
		draft: ShareDraft;
		onDraftChange: (draft: ShareDraft) => void;
		onChangeOwner?: (owner: ShareOwner) => void;
	}) => {
		mocks.editDraft = onDraftChange;
		mocks.changeOwner = onChangeOwner;
		return <output aria-label='draft'>{`${draft.visibility}:${draft.grants.length}`}</output>;
	},
}));

describe('ShareDialog', () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

	it('transfers ownership to the member picked, once confirmed', () => {
		renderDialog();
		act(() => mocks.changeOwner?.(GRACE));

		expect(mocks.transfer).not.toHaveBeenCalled();
		const confirmation = screen.getByRole('dialog', { name: 'Transfer ownership to Grace?' });
		fireEvent.click(within(confirmation).getByRole('button', { name: 'Transfer' }));

		expect(mocks.transfer).toHaveBeenCalledWith({ storyId: 'story-1', recipientId: 'grace' });
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
		...model,
	};
}

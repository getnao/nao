// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShareModel } from '@/hooks/use-share-target';
import type { ShareDraft } from '@/lib/share-draft';
import type * as ShareDialogHooks from '@/hooks/use-share-dialog';
import { ShareDialog } from '@/components/share-dialog';

const ADA_GRANT = {
	key: 'user:ada',
	kind: 'user' as const,
	id: 'ada',
	name: 'Ada',
	detail: '',
	role: 'viewer' as const,
};

const mocks = vi.hoisted(() => ({
	model: undefined as ShareModel | undefined,
	save: vi.fn(),
	editDraft: undefined as ((draft: ShareDraft) => void) | undefined,
	canShareToProject: false,
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: false }) }));
vi.mock('@/main', () => ({ trpc: { authConfig: { smtp: { isSetup: { queryOptions: () => ({}) } } } } }));
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
	ShareAccessPanel: ({ draft, onDraftChange }: { draft: ShareDraft; onDraftChange: (draft: ShareDraft) => void }) => {
		mocks.editDraft = onDraftChange;
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
});

const STORY_TARGET = { kind: 'story' as const, chatId: 'chat-1', storySlug: 'revenue' };

function renderDialog() {
	return render(<ShareDialog open onOpenChange={vi.fn()} target={STORY_TARGET} />);
}

function storyModel(model: Partial<ShareModel>): ShareModel {
	return {
		itemLabel: 'story',
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

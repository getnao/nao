// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useStoryStateSession } from './use-story-state-session';
import type { StoryStateSnapshot } from '@nao/shared/story-app';
import type { ReactNode } from 'react';

const STATE_KEY = ['story-state'];
const { saveStoryState, saveLater, snapshotRef } = vi.hoisted(() => ({
	saveStoryState: vi.fn(),
	saveLater: vi.fn(),
	snapshotRef: { current: null as unknown },
}));

vi.mock('./story-data-options', () => ({
	stateOptions: () => ({ queryKey: STATE_KEY, queryFn: () => snapshotRef.current, staleTime: Infinity }),
	saveStoryState,
}));

vi.mock('./use-story-state-writer', () => ({ useStoryStateWriter: () => saveLater }));

const DATA_SOURCE = { kind: 'share', storyId: 'story-1' } as const;
const MEMBER: StoryStateSnapshot = {
	shared: { tab: 'revenue', zoom: 1 },
	own: { zoom: 3 },
	isOwner: false,
	ownerName: 'Sarah',
};
const OWNER: StoryStateSnapshot = { shared: { tab: 'revenue' }, own: {}, isOwner: true, ownerName: 'Sarah' };

async function setup(snapshot: StoryStateSnapshot, autoSaveDefault: boolean) {
	snapshotRef.current = snapshot;
	const queryClient = new QueryClient();
	const pushToFrame = vi.fn();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
	const { result } = renderHook(
		() =>
			useStoryStateSession({
				dataSource: DATA_SOURCE,
				storyId: 'story-1',
				enabled: true,
				autoSaveDefault,
				pushToFrame,
			}),
		{ wrapper },
	);
	await waitFor(() => expect(result.current.snapshot).toBeDefined());
	const cached = () => queryClient.getQueryData<StoryStateSnapshot>(STATE_KEY);
	return { result, pushToFrame, cached };
}

describe('useStoryStateSession', () => {
	beforeEach(() => {
		localStorage.clear();
		saveStoryState.mockReset();
		saveStoryState.mockResolvedValue(undefined);
		saveLater.mockReset();
	});

	it("auto-saves a member's change into their own view", async () => {
		const { result, cached } = await setup(MEMBER, true);

		act(() => result.current.record({ key: 'tab', value: 'orders' }));

		expect(saveLater).toHaveBeenCalledWith({ key: 'tab', value: 'orders' });
		expect(cached()?.own).toEqual({ zoom: 3, tab: 'orders' });
		expect(cached()?.shared).toEqual(MEMBER.shared);
	});

	it("auto-saves the owner's change into the shared view", async () => {
		const { result, cached } = await setup(OWNER, true);

		act(() => result.current.record({ key: 'tab', value: 'orders' }));

		expect(cached()?.shared).toEqual({ tab: 'orders' });
	});

	it('keeps changes as a draft until saved when auto-save is off', async () => {
		const { result, cached } = await setup(OWNER, false);

		act(() => result.current.record({ key: 'tab', value: 'orders' }));
		expect(result.current.hasChanges).toBe(true);
		expect(saveLater).not.toHaveBeenCalled();

		await act(() => result.current.save());

		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'tab', value: 'orders' });
		expect(cached()?.shared).toEqual({ tab: 'orders' });
		expect(result.current.hasChanges).toBe(false);
	});

	it('keeps a change made while saving as a draft', async () => {
		const { result } = await setup(OWNER, false);
		let finishSave = () => {};
		saveStoryState.mockReturnValueOnce(new Promise<void>((resolve) => (finishSave = resolve)));

		act(() => result.current.record({ key: 'tab', value: 'orders' }));
		let saving = Promise.resolve();
		act(() => {
			saving = result.current.save();
		});
		act(() => result.current.record({ key: 'zoom', value: 2 }));
		await act(async () => {
			finishSave();
			await saving;
		});

		expect(result.current.hasChanges).toBe(true);
	});

	it('drops a draft change that goes back to the saved value', async () => {
		const { result } = await setup(OWNER, false);

		act(() => result.current.record({ key: 'tab', value: 'orders' }));
		act(() => result.current.record({ key: 'tab', value: 'revenue' }));

		expect(result.current.hasChanges).toBe(false);
	});

	it("puts a member's frame back on their saved view when discarding", async () => {
		const { result, pushToFrame } = await setup(MEMBER, false);
		act(() => result.current.record({ key: 'tab', value: 'orders' }));

		act(() => result.current.discard());

		expect(pushToFrame).toHaveBeenCalledWith({ tab: 'revenue', zoom: 3 });
		expect(result.current.hasChanges).toBe(false);
	});

	it("shows a member the owner's view without saving anything there", async () => {
		const { result, pushToFrame } = await setup(MEMBER, false);
		act(() => result.current.record({ key: 'tab', value: 'orders' }));

		act(() => result.current.setView('shared'));
		expect(pushToFrame).toHaveBeenLastCalledWith({ tab: 'revenue', zoom: 1 });
		act(() => result.current.record({ key: 'zoom', value: 9 }));

		act(() => result.current.setView('mine'));
		expect(pushToFrame).toHaveBeenLastCalledWith({ tab: 'orders', zoom: 3 });
		expect(saveLater).not.toHaveBeenCalled();
	});

	it('saves the pending draft when auto-save is turned on and remembers the choice', async () => {
		const { result } = await setup(OWNER, false);
		act(() => result.current.record({ key: 'tab', value: 'orders' }));

		await act(async () => result.current.setAutoSave(true));

		expect(saveStoryState).toHaveBeenCalledWith(DATA_SOURCE, { key: 'tab', value: 'orders' });
		const next = await setup(OWNER, false);
		expect(next.result.current.autoSave).toBe(true);
	});
});

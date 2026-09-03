// @vitest-environment jsdom

import {
	addStoryTab,
	deleteStoryTab,
	moveStoryTab,
	renameStoryTab,
	replaceStoryTabInner,
} from '@nao/shared/story-tabs';
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { StoryViewMode } from '@/components/side-panel/story-viewer.types';
import type { StorySaveResult } from '@/lib/story-save';
import { selectStoryEditorCode, useStoryEditBuffer } from '@/hooks/use-story-edit-buffer';
import { useStoryEditTransitions } from '@/hooks/use-story-edit-transitions';
import { getStoryNavigationBlockerOptions } from '@/hooks/use-story-exit-guard';

const tabbedStory = [
	'<tab title="Overview">',
	'# Overview',
	'</tab>',
	'',
	'<tab title="Details">',
	'Details',
	'</tab>',
].join('\n');

describe('Story editing', () => {
	it('marks changes in any tab metadata as dirty', () => {
		const { result } = renderHook(() => useStoryEditBuffer(tabbedStory));

		act(() => result.current.handleCodeChange(renameStoryTab(tabbedStory, 1, 'Revenue')));

		expect(result.current.isDirty).toBe(true);
	});

	it('keeps newer edits dirty when an earlier save finishes', () => {
		const { result } = renderHook(() => useStoryEditBuffer('# Story'));

		act(() => {
			result.current.handleCodeChange('# First edit');
			result.current.handleCodeChange('# Newer edit');
			result.current.markSaved('# First edit');
		});

		expect(result.current.getCode()).toBe('# Newer edit');
		expect(result.current.isDirty).toBe(true);
	});

	it('keeps rendering the buffer while a clean save is still finishing', () => {
		expect(
			selectStoryEditorCode({
				persistedCode: '# Old persisted Story',
				bufferCode: '# Saved Story',
				isDirty: false,
				isSaving: true,
			}),
		).toBe('# Saved Story');
		expect(
			selectStoryEditorCode({
				persistedCode: '# Refreshed persisted Story',
				bufferCode: '# Stale buffer Story',
				isDirty: false,
				isSaving: false,
			}),
		).toBe('# Refreshed persisted Story');
	});

	it('switches dirty Edit to Code without saving or losing the buffer', async () => {
		const save = vi.fn(async (): Promise<StorySaveResult> => 'saved');
		const { result } = renderEditingSession({ initialMode: 'edit', save });

		act(() => result.current.changeCode('# Unsaved visual edit'));
		await act(() => result.current.requestViewMode('code'));

		expect(save).not.toHaveBeenCalled();
		expect(result.current.viewMode).toBe('code');
		expect(result.current.code).toBe('# Unsaved visual edit');
		expect(result.current.isDirty).toBe(true);
	});

	it('switches dirty valid Code to Edit without saving or losing the buffer', async () => {
		const save = vi.fn(async (): Promise<StorySaveResult> => 'saved');
		const { result } = renderEditingSession({ initialMode: 'code', save });

		act(() => result.current.changeCode('# Unsaved code edit'));
		await act(() => result.current.requestViewMode('edit'));

		expect(save).not.toHaveBeenCalled();
		expect(result.current.viewMode).toBe('edit');
		expect(result.current.code).toBe('# Unsaved code edit');
		expect(result.current.isDirty).toBe(true);
	});

	it('keeps invalid Code active with its buffer intact', async () => {
		const save = vi.fn(async (): Promise<StorySaveResult> => 'saved');
		const { result } = renderEditingSession({ initialMode: 'code', isCodeValid: false, save });

		act(() => result.current.changeCode('<invalid>'));
		await act(() => result.current.requestViewMode('edit'));

		expect(save).not.toHaveBeenCalled();
		expect(result.current.viewMode).toBe('code');
		expect(result.current.code).toBe('<invalid>');
		expect(result.current.isDirty).toBe(true);
	});

	it.each<StoryViewMode>(['edit', 'code'])('awaits dirty %s persistence before Preview', async (initialMode) => {
		let finishSave: (result: StorySaveResult) => void = () => {};
		const save = vi.fn(
			() =>
				new Promise<StorySaveResult>((resolve) => {
					finishSave = resolve;
				}),
		);
		const { result } = renderEditingSession({ initialMode, save });

		act(() => result.current.changeCode('# Dirty Story'));

		let transition!: Promise<void>;
		act(() => {
			transition = result.current.requestViewMode('preview');
		});
		expect(save).toHaveBeenCalledOnce();
		expect(result.current.viewMode).toBe(initialMode);

		await act(async () => {
			finishSave('saved');
			await transition;
		});
		expect(result.current.viewMode).toBe('preview');
	});

	it('keeps complete tabbed Story operations across Edit and Code', async () => {
		const contentEditedStory = replaceStoryTabInner(tabbedStory, 0, '# Updated overview');
		const addedStory = addStoryTab(contentEditedStory);
		const renamedStory = renameStoryTab(addedStory, 2, 'Forecast');
		const reorderedStory = moveStoryTab(renamedStory, 2, 0);
		const changedStory = deleteStoryTab(reorderedStory, 2);
		const { result } = renderEditingSession({ initialMode: 'edit', initialCode: tabbedStory });

		act(() => result.current.changeCode(changedStory));
		await act(() => result.current.requestViewMode('code'));
		await act(() => result.current.requestViewMode('edit'));

		expect(result.current.code).toBe(changedStory);
		expect(result.current.isDirty).toBe(true);
	});

	it('only enables route and unload blocking while dirty', () => {
		expect(getStoryNavigationBlockerOptions(false)).toMatchObject({
			disabled: true,
			enableBeforeUnload: false,
		});
		expect(getStoryNavigationBlockerOptions(true)).toMatchObject({
			disabled: false,
			enableBeforeUnload: true,
		});
	});
});

function renderEditingSession({
	initialMode,
	initialCode = '# Story',
	isCodeValid = true,
	save = async () => 'saved',
}: {
	initialMode: StoryViewMode;
	initialCode?: string;
	isCodeValid?: boolean;
	save?: () => Promise<StorySaveResult>;
}) {
	const requestExit = vi.fn();
	return renderHook(() => {
		const [viewMode, setViewMode] = useState<StoryViewMode>(initialMode);
		const buffer = useStoryEditBuffer(initialCode);
		const transitions = useStoryEditTransitions({
			viewMode,
			setViewMode,
			isDirty: buffer.isDirty,
			isCodeValid,
			isSaving: false,
			save,
			requestExit,
		});

		return {
			viewMode,
			code: buffer.getCode(),
			isDirty: buffer.isDirty,
			changeCode: buffer.handleCodeChange,
			requestViewMode: transitions.requestViewMode,
		};
	});
}

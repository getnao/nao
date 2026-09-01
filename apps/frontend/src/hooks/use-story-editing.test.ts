// @vitest-environment jsdom

import { renameStoryTab } from '@nao/shared/story-tabs';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { selectStoryEditorCode, useStoryEditBuffer } from './use-story-edit-buffer';
import { useStoryEditTransitions } from './use-story-edit-transitions';
import { getStoryNavigationBlockerOptions } from './use-story-exit-guard';

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
				persistedCode: '# Saved Story',
				bufferCode: '# Saved Story',
				isDirty: false,
				isSaving: false,
			}),
		).toBe('# Saved Story');
	});

	it('awaits Edit to Preview persistence before changing mode', async () => {
		let finishSave: (result: 'saved') => void = () => {};
		const save = vi.fn(
			() =>
				new Promise<'saved'>((resolve) => {
					finishSave = resolve;
				}),
		);
		const setViewMode = vi.fn();
		const { result } = renderHook(() =>
			useStoryEditTransitions({
				viewMode: 'edit',
				setViewMode,
				isEditDirty: true,
				isCodeDirty: false,
				isSaving: false,
				save,
				requestExit: vi.fn(),
			}),
		);

		let transition!: Promise<void>;
		act(() => {
			transition = result.current.requestViewMode('preview');
		});
		expect(save).toHaveBeenCalledOnce();
		expect(setViewMode).not.toHaveBeenCalled();

		await act(async () => {
			finishSave('saved');
			await transition;
		});
		expect(setViewMode).toHaveBeenCalledWith('preview');
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

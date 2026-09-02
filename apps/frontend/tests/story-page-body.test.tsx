// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';

import type { useStoryPageEditor } from '@/hooks/use-story-page-editor';
import { StoryPageBody } from '@/components/story-page-body';

vi.hoisted(() => {
	Object.defineProperty(window.URL, 'createObjectURL', {
		configurable: true,
		value: vi.fn(() => 'blob:test'),
	});
});

vi.mock('@/hooks/use-drag-auto-scroll', () => ({
	useDragAutoScroll: vi.fn(),
}));

vi.mock('@/components/side-panel/story-code-view', () => ({
	StoryCodeView: () => null,
}));

vi.mock('@/components/side-panel/story-editor', () => ({
	StoryEditor: () => null,
}));

vi.mock('@/components/side-panel/story-tabbed-editor', () => ({
	StoryTabbedEditor: ({ contentClassName }: { contentClassName?: string }) => (
		<div data-testid='tabbed-editor-content' className={contentClassName} />
	),
}));

vi.mock('@/contexts/story-embed-data', () => ({
	StoryEmbedDataProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe('expanded story page editor layout', () => {
	it('gives tabbed edit content the full available page width', () => {
		const editor = {
			viewMode: 'edit',
			tiptapEditorRef: createRef<Editor>(),
			tabbedEditCodeRef: createRef<() => string>(),
			handleSave: vi.fn(),
		} as unknown as ReturnType<typeof useStoryPageEditor>;
		const code = [
			'<tab title="Overview">',
			'# Fulfillment and Payments',
			'</tab>',
			'<tab title="Trends">',
			'# Trends',
			'</tab>',
		].join('\n');

		render(<StoryPageBody code={code} editor={editor} preview={null} />);

		expect(screen.getByTestId('tabbed-editor-content').className).toBe('mx-auto w-full max-w-5xl p-4 md:p-8');
	});
});

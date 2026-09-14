import { describe, expect, it } from 'vitest';
import { shouldSyncStoryEditorContent } from './story-editor-content-sync';

describe('shouldSyncStoryEditorContent', () => {
	it('skips a tabbed prop echo of Markdown emitted by the editor', () => {
		expect(
			shouldSyncStoryEditorContent({
				editorMarkdown: '# Overview updated',
				incomingCode: '\n# Overview updated\n',
				lastEmittedMarkdown: '# Overview updated',
			}),
		).toBe(false);
	});

	it('syncs genuine external and other-tab content changes', () => {
		expect(
			shouldSyncStoryEditorContent({
				editorMarkdown: '# Local edit',
				incomingCode: '\n# Externally loaded version\n',
				lastEmittedMarkdown: '# Local edit',
			}),
		).toBe(true);
		expect(
			shouldSyncStoryEditorContent({
				editorMarkdown: '# Overview',
				incomingCode: '\n# Details\n',
				lastEmittedMarkdown: '# Overview',
			}),
		).toBe(true);
	});
});

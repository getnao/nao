import { describe, expect, it } from 'vitest';

import { extractStoryFolderReferenceIds, extractStoryReferenceIds, replaceStoryAndFolderReferences } from './mentions';

describe('story reference mentions', () => {
	it('extracts referenced stories once, in order, ignoring table mentions', () => {
		const text = 'Compare @[story:b] with @[story:a] using @[warehouse.public.orders] and @[story:b] again';

		expect(extractStoryReferenceIds(text)).toEqual(['b', 'a']);
	});

	it('replaces story and folder references, leaving table mentions', () => {
		const text = 'Explain @[story:a] in @[story-folder:f1] from @[warehouse.public.orders]';

		expect(
			replaceStoryAndFolderReferences(text, {
				story: (storyId) => `"${storyId.toUpperCase()}"`,
				folder: (folderId) => `<${folderId}>`,
			}),
		).toBe('Explain "A" in <f1> from @[warehouse.public.orders]');
	});

	it('never rewrites a replacement that looks like a mention', () => {
		const text = 'Explain @[story:a] and @[story-folder:f1]';

		expect(
			replaceStoryAndFolderReferences(text, {
				story: () => '"Copy of @[story-folder:f1]"',
				folder: () => '"Finance"',
			}),
		).toBe('Explain "Copy of @[story-folder:f1]" and "Finance"');
	});
});

describe('story folder mentions', () => {
	it('extracts and replaces folder references only', () => {
		const text =
			'Sum up @[story-folder:f1] and @[story:a] then @[story-folder:__shared_with_me__] and @[story-folder:f1]';

		expect(extractStoryFolderReferenceIds(text)).toEqual(['f1', '__shared_with_me__']);
		expect(extractStoryReferenceIds(text)).toEqual(['a']);
		expect(
			replaceStoryAndFolderReferences(text, {
				story: (storyId) => storyId,
				folder: (folderId) => `<${folderId}>`,
			}),
		).toBe('Sum up <f1> and a then <__shared_with_me__> and <f1>');
	});
});

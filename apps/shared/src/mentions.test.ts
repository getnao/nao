import { describe, expect, it } from 'vitest';

import {
	extractStoryFolderReferenceIds,
	extractStoryReferenceIds,
	getStoryIdFromMentionId,
	isStoryFolderMentionId,
	isStoryReferenceMentionId,
	replaceStoryFolderReferences,
	replaceStoryReferences,
	toStoryFolderMentionId,
} from './mentions';

describe('story reference mentions', () => {
	it('extracts referenced stories once, in order, ignoring table mentions', () => {
		const text = 'Compare @[story:b] with @[story:a] using @[warehouse.public.orders] and @[story:b] again';

		expect(extractStoryReferenceIds(text)).toEqual(['b', 'a']);
	});

	it('replaces story references only', () => {
		const text = 'Explain @[story:a] from @[warehouse.public.orders]';

		expect(replaceStoryReferences(text, (storyId) => `"${storyId.toUpperCase()}"`)).toBe(
			'Explain "A" from @[warehouse.public.orders]',
		);
	});
});

describe('story folder mentions', () => {
	it('is told apart from story mentions', () => {
		const mentionId = toStoryFolderMentionId('folder-1');

		expect(isStoryFolderMentionId(mentionId)).toBe(true);
		expect(isStoryReferenceMentionId(mentionId)).toBe(false);
		expect(getStoryIdFromMentionId(mentionId)).toBeNull();
	});

	it('extracts and replaces folder references only', () => {
		const text =
			'Sum up @[story-folder:f1] and @[story:a] then @[story-folder:__shared_with_me__] and @[story-folder:f1]';

		expect(extractStoryFolderReferenceIds(text)).toEqual(['f1', '__shared_with_me__']);
		expect(extractStoryReferenceIds(text)).toEqual(['a']);
		expect(replaceStoryFolderReferences(text, (folderId) => `<${folderId}>`)).toBe(
			'Sum up <f1> and @[story:a] then <__shared_with_me__> and <f1>',
		);
	});
});

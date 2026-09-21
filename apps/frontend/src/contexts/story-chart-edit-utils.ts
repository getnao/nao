const BLOCK_NOT_FOUND_MESSAGE = 'Could not locate the item in the current story version.';
const BLOCK_AMBIGUOUS_MESSAGE = 'Could not uniquely identify the item because the same tag appears more than once.';

/** Replaces a unique block tag (chart or table) within the story markdown. */
export function replaceUniqueStoryBlockTag(storyCode: string, rawTag: string, nextTag: string): string {
	if (!rawTag) {
		throw new Error(BLOCK_NOT_FOUND_MESSAGE);
	}

	const startIndex = storyCode.indexOf(rawTag);
	if (startIndex === -1) {
		throw new Error(BLOCK_NOT_FOUND_MESSAGE);
	}

	const nextIndex = storyCode.indexOf(rawTag, startIndex + rawTag.length);
	if (nextIndex !== -1) {
		throw new Error(BLOCK_AMBIGUOUS_MESSAGE);
	}

	return `${storyCode.slice(0, startIndex)}${nextTag}${storyCode.slice(startIndex + rawTag.length)}`;
}

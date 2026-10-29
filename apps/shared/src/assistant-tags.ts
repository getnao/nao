import { CITATION_TAG_REGEX, normalizeCitationMarkers } from './citation';

export const SAVED_FILE_TAG_REGEX = /<\/?saved-file[^>]*>/g;

export const STORY_REFERENCE_TAG = 'story-reference';
export const STORY_REFERENCE_TAG_REGEX = new RegExp(`</?${STORY_REFERENCE_TAG}[^>]*>`, 'g');
const STORY_REFERENCE_ELEMENT_REGEX = new RegExp(
	`<${STORY_REFERENCE_TAG}\\s+id\\s*=\\s*["']([^"'\\s]+)["']\\s*>([^<]*)</${STORY_REFERENCE_TAG}\\s*>`,
	'g',
);

export const stripAssistantTags = (text: string): string => {
	return normalizeCitationMarkers(text)
		.replace(CITATION_TAG_REGEX, '')
		.replace(SAVED_FILE_TAG_REGEX, '')
		.replace(STORY_REFERENCE_TAG_REGEX, '');
};

/** The existing stories an answer hands over, with the title the agent gave them, in order. */
export const extractStoryReferenceTags = (text: string): { storyId: string; title: string }[] => {
	return [...text.matchAll(STORY_REFERENCE_ELEMENT_REGEX)].map((match) => ({
		storyId: match[1],
		title: match[2].trim(),
	}));
};

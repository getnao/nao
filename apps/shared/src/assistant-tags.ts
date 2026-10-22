import { CITATION_TAG_REGEX, normalizeCitationMarkers } from './citation';

export const SAVED_FILE_TAG_REGEX = /<\/?saved-file[^>]*>/g;

export const STORY_REFERENCE_TAG = 'story-reference';
export const STORY_REFERENCE_TAG_REGEX = new RegExp(`</?${STORY_REFERENCE_TAG}[^>]*>`, 'g');

export const stripAssistantTags = (text: string): string => {
	return normalizeCitationMarkers(text)
		.replace(CITATION_TAG_REGEX, '')
		.replace(SAVED_FILE_TAG_REGEX, '')
		.replace(STORY_REFERENCE_TAG_REGEX, '');
};

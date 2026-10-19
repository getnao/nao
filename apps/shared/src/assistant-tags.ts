import { CITATION_TAG_REGEX, normalizeCitationMarkers } from './citation';

export const SAVED_FILE_TAG_REGEX = /<\/?saved-file[^>]*>/g;

export const stripAssistantTags = (text: string): string => {
	return normalizeCitationMarkers(text).replace(CITATION_TAG_REGEX, '').replace(SAVED_FILE_TAG_REGEX, '');
};

/** Marks story code rebuilt for a viewer with restricted data access. Never shown: `prepareRestrictedStoryCode` strips it. */
export const STORY_VIEWER_RESTRICTED_CODE_MARKER =
	'<!-- nao-internal:viewer-restricted-code:8f14e45f-ea4a-4c14-a947-16f95e8e7f65 -->';

/** Stand in for the owner's prose until it is rewritten from the rows the viewer may read. */
export const VIEWER_NARRATIVE_PLACEHOLDER = 'Viewer-specific narrative.';
export const VIEWER_SECTION_PLACEHOLDER = 'Viewer-specific section';

/** Removes the marker and the placeholders nothing rewrote, so a restricted story never displays them. */
export function prepareRestrictedStoryCode(code: string): { code: string; hasRestrictedContent: boolean } {
	if (!code.split('\n').some((line) => line.trim() === STORY_VIEWER_RESTRICTED_CODE_MARKER)) {
		return { code, hasRestrictedContent: false };
	}

	const placeholderHeading = new RegExp(String.raw`^\s*#{1,6}\s+${VIEWER_SECTION_PLACEHOLDER}\s*`);
	const lines = code
		.split('\n')
		.filter((line) => ![STORY_VIEWER_RESTRICTED_CODE_MARKER, VIEWER_NARRATIVE_PLACEHOLDER].includes(line.trim()))
		.map((line) => line.replace(placeholderHeading, ''));
	return {
		code: lines
			.join('\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim(),
		hasRestrictedContent: true,
	};
}

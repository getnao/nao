export const CITATION_TAG_REGEX = /<\/?citation-number[^>]*>/g;

const CITATION_TAG_NAMES = ['citation-number', '/citation-number'];
const OPENAI_CITATION_START = '\uE200';
const OPENAI_CITATION_MARKER_REGEX = /[\uE200-\uE202]/;
const OPENAI_CITATION_MARKERS_REGEX = /[\uE200-\uE202]/g;
const MISMARKED_CITATION_TAG_REGEX = /\uE200(?=\/?citation-number)/g;
const OPENAI_NATIVE_CITATION_REGEX = /[ \t]*\uE200[^\uE200\uE201<>\n]*\uE201/g;
const OPENAI_NATIVE_CITATION_BOUNDARY_REGEX = /[\uE200\uE201<>\n]/;
const MAX_OPENAI_NATIVE_CITATION_LENGTH = 200;

export type ColumnLineageNode = {
	name: string;
	source_name: string;
	expression?: string;
	reference_node_name?: string;
	sources: ColumnLineageNode[];
};

export type CitationPayload = {
	sql_query: string;
	database_id: string;
	tables: Array<{
		name: string;
	}>;
	column_lineage: ColumnLineageNode;
};

/**
 * OpenAI models sometimes write citations in ChatGPT's private-use markup (U+E200…U+E201) instead of
 * `<citation-number>`, which renders as unreadable boxes. A marker that stands in for the tag's `<`
 * becomes `<` again; ChatGPT's own `\uE200cite\uE202turn0\uE201` citations point nowhere and are dropped.
 */
export const normalizeCitationMarkers = (text: string): string => {
	if (!OPENAI_CITATION_MARKER_REGEX.test(text)) {
		return text;
	}

	return text
		.replace(MISMARKED_CITATION_TAG_REGEX, '<')
		.replace(OPENAI_NATIVE_CITATION_REGEX, '')
		.replace(OPENAI_CITATION_MARKERS_REGEX, '');
};

/**
 * Offset from which more streamed text could still change how `text` normalizes: the first unfinished
 * citation marker and the spaces before it, which go away with a dropped ChatGPT citation. -1 when none.
 */
export const findUnfinishedCitationMarker = (text: string): number => {
	let offset = text.indexOf(OPENAI_CITATION_START);
	while (offset !== -1) {
		if (isUnfinishedCitationMarker(text.slice(offset + 1))) {
			return skipSpacesBackward(text, offset);
		}
		offset = text.indexOf(OPENAI_CITATION_START, offset + 1);
	}

	return -1;
};

function isUnfinishedCitationMarker(textAfterMarker: string): boolean {
	if (CITATION_TAG_NAMES.some((name) => textAfterMarker.startsWith(name))) {
		return false;
	}

	if (CITATION_TAG_NAMES.some((name) => name.startsWith(textAfterMarker))) {
		return true;
	}

	return (
		textAfterMarker.length < MAX_OPENAI_NATIVE_CITATION_LENGTH &&
		!OPENAI_NATIVE_CITATION_BOUNDARY_REGEX.test(textAfterMarker)
	);
}

function skipSpacesBackward(text: string, offset: number): number {
	let start = offset;
	while (start > 0 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
		start -= 1;
	}
	return start;
}

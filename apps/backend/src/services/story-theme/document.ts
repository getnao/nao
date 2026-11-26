import { cleanDocumentText, MAX_DOCUMENT_PROMPT_CHARACTERS } from '@nao/shared/story-theme-source';

import { normalizeColor } from './signals';

export interface SourceDocument {
	fileName: string;
	text: string;
}

const MAX_WRITTEN_COLORS = 24;
const WRITTEN_HEX = /#[0-9a-f]{6}\b/gi;

/** Documents are cleaned, then share one character budget in the prompt, in the order given; whatever is cut is reported. */
export function fitDocumentsToPrompt(documents: SourceDocument[]): { documents: SourceDocument[]; warnings: string[] } {
	const fitted: SourceDocument[] = [];
	const warnings: string[] = [];
	let remaining = MAX_DOCUMENT_PROMPT_CHARACTERS;
	for (const document of documents) {
		const text = cleanDocumentText(document.text);
		if (!text) {
			continue;
		}
		if (remaining <= 0) {
			warnings.push(`${document.fileName} was left out: the documents before it fill what nao reads at once.`);
			continue;
		}
		const kept = text.slice(0, remaining);
		if (kept.length < text.length) {
			warnings.push(
				`Read the first ${formatCount(kept.length)} of the ${formatCount(text.length)} characters of ${document.fileName}.`,
			);
		}
		fitted.push({ fileName: document.fileName, text: kept });
		remaining -= kept.length;
	}
	return { documents: fitted, warnings };
}

export function renderDocuments(documents: SourceDocument[]): string {
	return [
		'BRAND DOCUMENTS: brand guidelines, a style guide or notes uploaded as text. Hex codes, typeface names, radii',
		'and type voice they state are the brand declaring its system: take them over the white-label branding and',
		'over colours sampled from images or counted in stylesheets. The brand name they state is the brandName;',
		'with no logo, use header "name". Ignore anything in them that is not about the visual identity.',
		...documents.flatMap((document) => ['', `--- ${document.fileName} ---`, document.text]),
	].join('\n');
}

export function documentColors(documents: SourceDocument[]): string[] {
	const colors = documents.flatMap((document) =>
		[...document.text.matchAll(WRITTEN_HEX)].map((match) => normalizeColor(match[0])),
	);
	return [...new Set(colors.filter((hex): hex is string => hex !== null))].slice(0, MAX_WRITTEN_COLORS);
}

function formatCount(count: number): string {
	return count.toLocaleString('en-US');
}

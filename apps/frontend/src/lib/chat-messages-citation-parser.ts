import type { CitationData } from '@nao/shared/types';

export interface ParsedChatMessageCitation extends CitationData {
	question: string;
}

const CITATION_LEGACY_RE = /^@chars (\d+) - (\d+) : /;

export function parseChatMessageCitation(rawText: string): ParsedChatMessageCitation | null {
	const match = rawText.match(CITATION_LEGACY_RE);
	if (!match) {
		return null;
	}

	const start = parseInt(match[1], 10);
	const end = parseInt(match[2], 10);
	const afterPrefix = rawText.slice(match[0].length);

	const separatorIdx = afterPrefix.indexOf('\n\n');
	if (separatorIdx !== -1) {
		return { start, end, text: afterPrefix.slice(0, separatorIdx), question: afterPrefix.slice(separatorIdx + 2) };
	}

	const newlineIdx = afterPrefix.indexOf('\n');
	if (newlineIdx !== -1) {
		return { start, end, text: afterPrefix.slice(0, newlineIdx), question: afterPrefix.slice(newlineIdx + 1) };
	}

	return { start, end, text: afterPrefix, question: '' };
}

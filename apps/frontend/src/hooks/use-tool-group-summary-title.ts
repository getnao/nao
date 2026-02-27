import { useMemo } from 'react';
import { pluralize } from '@nao/shared';
import type { CollapsiblePart } from '@/types/ai';
import { isReasoningPart } from '@/lib/ai';

/**
 * Creates a summary title for the tool group based on the tool calls (e.g. "Explore X files, X folders (X errors)").
 */
export const useToolGroupSummaryTitle = (opts: { parts: CollapsiblePart[]; isLoading: boolean }): string => {
	const { parts, isLoading } = opts;

	const title = useMemo(() => {
		let fullTitle = isLoading ? 'Exploring' : 'Explored';

		const toolCallsSummary = createToolCallsSummary(parts);
		if (toolCallsSummary) {
			fullTitle += ` ${toolCallsSummary}`;
		}

		const errorCount = parts.filter((part) => !isReasoningPart(part) && !!part.errorText).length;

		if (errorCount) {
			fullTitle += ` (${errorCount} ${pluralize('error', errorCount)})`;
		}

		return fullTitle;
	}, [isLoading, parts]);

	return title;
};

const createToolCallsSummary = (parts: CollapsiblePart[]): string => {
	const counts = collectExplorationCounts(parts);

	const formatCount = (count: number, word: string): string => {
		const countClamped = Math.min(count, 10);
		const isClamped = countClamped !== count;
		return count ? `${countClamped}${isClamped ? `+` : ''} ${pluralize(word, count)}` : '';
	};

	const segments = [
		formatCount(counts.files, 'file'),
		formatCount(counts.folders, 'folder'),
		formatCount(counts.searches, 'search'),
	];

	return segments.filter(Boolean).join(', ');
};

interface ExplorationCounts {
	files: number;
	folders: number;
	searches: number;
}

const collectExplorationCounts = (parts: CollapsiblePart[]): ExplorationCounts => {
	const counts: ExplorationCounts = { files: 0, folders: 0, searches: 0 };

	for (const part of parts) {
		switch (part.type) {
			case 'tool-read':
				counts.files++;
				break;
			case 'tool-list':
				counts.folders++;
				break;
			case 'tool-search':
				counts.searches++;
				break;
			case 'tool-grep':
				counts.searches++;
				break;
		}
	}

	return counts;
};

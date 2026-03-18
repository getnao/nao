import { useMemo } from 'react';
import { TOOL_LABELS, pluralize } from '@nao/shared';
import type { GroupablePart } from '@/types/ai';
import { isReasoningPart } from '@/lib/ai';

/**
 * Creates a summary title for the tool group based on the tool calls (e.g. "Explore X files, X folders (X errors)").
 */
export const useToolGroupSummaryTitle = (opts: { parts: GroupablePart[]; isLoading: boolean }): string => {
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

const createToolCallsSummary = (parts: GroupablePart[]): string => {
	const countByNoun = new Map<string, number>();

	for (const part of parts) {
		const noun = TOOL_LABELS[part.type];
		if (noun) {
			countByNoun.set(noun, (countByNoun.get(noun) ?? 0) + 1);
		}
	}

	const segments = [...countByNoun.entries()].map(([noun, count]) => {
		const countClamped = Math.min(count, 10);
		const isClamped = countClamped !== count;
		return `${countClamped}${isClamped ? '+' : ''} ${pluralize(noun, count)}`;
	});

	return segments.join(', ');
};

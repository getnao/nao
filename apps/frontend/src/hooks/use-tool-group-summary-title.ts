import { useMemo } from 'react';
import { TOOL_LABELS, pluralize } from '@nao/shared';
import type { GroupablePart } from '@/types/ai';
import { isReasoningPart } from '@/lib/ai';
import { getPartMcpServer, isMcpPart } from '@/lib/mcp';

/**
 * Creates a summary title for the tool group based on the tool calls (e.g. "Explore X files, X folders (X errors)").
 */
export const useToolGroupSummaryTitle = (opts: { parts: GroupablePart[]; isLoading: boolean }): string => {
	const { parts, isLoading } = opts;

	const title = useMemo(() => {
		let fullTitle = isLoading ? 'Exploring' : 'Explored';

		const mcpParts = parts.filter(isMcpPart);
		const nonMcpParts = parts.filter((part) => !isMcpPart(part));
		const toolCallsSummary = createToolCallsSummary(nonMcpParts);
		const mcpLabel = createMcpLabel(mcpParts);

		if (mcpLabel && toolCallsSummary) {
			fullTitle = `${fullTitle} ${toolCallsSummary}, ${isLoading ? 'using' : 'used'} ${mcpLabel}`;
		} else if (mcpLabel) {
			fullTitle = `${isLoading ? 'Using' : 'Used'} ${mcpLabel}`;
		} else if (toolCallsSummary) {
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

const createMcpLabel = (parts: GroupablePart[]): string | null => {
	if (parts.length === 0) {
		return null;
	}

	const servers: string[] = [];
	for (const part of parts) {
		const server = getPartMcpServer(part);
		if (server && !servers.includes(server)) {
			servers.push(server);
		}
	}

	return servers.length === 0 ? 'MCP' : `${servers.join(', ')} MCP`;
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

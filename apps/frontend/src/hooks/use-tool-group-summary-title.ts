import { useMemo } from 'react';
import { TOOL_LABELS, pluralize } from '@nao/shared';
import type { GroupablePart } from '@/types/ai';
import { isReasoningPart } from '@/lib/ai';
import { getPartMcpServer, isMcpPart } from '@/lib/mcp';
import { getLatestToolActivityLabel } from '@/lib/tool-activity';
import { useThrottledValue } from '@/hooks/use-throttled-value';

/** Each title stays on screen at least this long, so fast successive tool calls remain readable. */
const MIN_TITLE_DISPLAY_MS = 1000;

/**
 * Creates a summary title for the tool group based on the tool calls (e.g. "Explored X files, X folders (X errors)").
 * While the group is loading and collapsed, the title follows the latest tool call instead (e.g. "Exploring crm.md from docs").
 */
export const useToolGroupSummaryTitle = (opts: {
	parts: GroupablePart[];
	isLoading: boolean;
	isExpanded: boolean;
}): string => {
	const { parts, isLoading, isExpanded } = opts;

	const title = useMemo(() => {
		const latestToolLabel = isLoading && !isExpanded ? getLatestToolActivityLabel(parts) : null;
		const fullTitle = latestToolLabel ?? createAggregateTitle(parts, isLoading);
		const errorCount = parts.filter((part) => !isReasoningPart(part) && !!part.errorText).length;
		if (!errorCount) {
			return fullTitle;
		}
		return `${fullTitle} (${errorCount} ${pluralize('error', errorCount)})`;
	}, [isLoading, isExpanded, parts]);

	return useThrottledValue(title, MIN_TITLE_DISPLAY_MS);
};

const createAggregateTitle = (parts: GroupablePart[], isLoading: boolean): string => {
	const mcpParts = parts.filter(isMcpPart);
	const nonMcpParts = parts.filter((part) => !isMcpPart(part));
	const toolCallsSummary = createToolCallsSummary(nonMcpParts);
	const mcpLabel = createMcpLabel(mcpParts);
	const exploreVerb = isLoading ? 'Exploring' : 'Explored';

	if (mcpLabel && toolCallsSummary) {
		return `${exploreVerb} ${toolCallsSummary}, ${isLoading ? 'using' : 'used'} ${mcpLabel}`;
	}
	if (mcpLabel) {
		return `${isLoading ? 'Using' : 'Used'} ${mcpLabel}`;
	}
	if (toolCallsSummary) {
		return `${exploreVerb} ${toolCallsSummary}`;
	}
	return exploreVerb;
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

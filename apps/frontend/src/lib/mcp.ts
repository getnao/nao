import type { GroupablePart, McpGroupedPart, McpSubGroupPart } from '@/types/ai';
import { getToolName, isReasoningPart } from '@/lib/ai';

export interface McpTarget {
	server: string | null;
	tool: string | null;
}

/**
 * Parses a virtual path pointing inside the MCP specs folder.
 * `/agent/mcps` → { server: null }, `/agent/mcps/<server>` → { server },
 * `/agent/mcps/<server>/<tool>.json` → { server, tool }. Returns null for non-MCP paths.
 */
export const getMcpTarget = (path?: string): McpTarget | null => {
	const match = path?.match(/^\/?agent\/mcps(?:\/([^/]+?))?(?:\/([^/]+?)\.json)?\/?$/);
	if (!match) {
		return null;
	}
	return { server: match[1] ?? null, tool: match[2] ?? null };
};

export const getPartMcpServer = (part: GroupablePart): string | null => {
	if (isReasoningPart(part)) {
		return null;
	}

	const toolName = getToolName(part);
	if (toolName === 'mcp_call') {
		return (part.input as { server?: string } | undefined)?.server ?? null;
	}
	if (toolName === 'list') {
		return getMcpTarget((part.input as { path?: string } | undefined)?.path)?.server ?? null;
	}
	if (toolName === 'read') {
		return getMcpTarget((part.input as { file_path?: string } | undefined)?.file_path)?.server ?? null;
	}
	return null;
};

export const isMcpPart = (part: GroupablePart): boolean => {
	if (isReasoningPart(part)) {
		return false;
	}

	const toolName = getToolName(part);
	if (toolName === 'mcp_call') {
		return true;
	}
	if (toolName === 'list') {
		return getMcpTarget((part.input as { path?: string } | undefined)?.path) !== null;
	}
	if (toolName === 'read') {
		return getMcpTarget((part.input as { file_path?: string } | undefined)?.file_path) !== null;
	}
	return false;
};

export const isMcpCallPart = (part: GroupablePart): boolean => {
	return !isReasoningPart(part) && getToolName(part) === 'mcp_call';
};

export const groupMcpToolCalls = (parts: GroupablePart[]): McpGroupedPart[] => {
	const result: McpGroupedPart[] = [];
	let currentRun: { server: string; parts: GroupablePart[] } | null = null;
	let pendingReasoning: GroupablePart[] = [];

	const closeRun = () => {
		if (!currentRun) {
			return;
		}

		if (currentRun.parts.length >= 2) {
			const firstToolCallId = (
				currentRun.parts.find((part) => !isReasoningPart(part)) as { toolCallId?: string } | undefined
			)?.toolCallId;
			const subGroup: McpSubGroupPart = {
				type: 'mcp-sub-group',
				id: `${currentRun.server}:${firstToolCallId ?? currentRun.parts.length}`,
				server: currentRun.server,
				parts: currentRun.parts,
			};
			result.push(subGroup);
		} else {
			result.push(currentRun.parts[0]);
		}
		currentRun = null;
	};

	for (const part of parts) {
		if (isReasoningPart(part)) {
			if (currentRun) {
				pendingReasoning.push(part);
			} else {
				result.push(part);
			}
			continue;
		}

		const server = getPartMcpServer(part);
		if (currentRun && server === currentRun.server) {
			currentRun.parts.push(...pendingReasoning, part);
			pendingReasoning = [];
			continue;
		}

		closeRun();
		result.push(...pendingReasoning);
		pendingReasoning = [];

		if (server) {
			currentRun = { server, parts: [part] };
		} else {
			result.push(part);
		}
	}

	closeRun();
	result.push(...pendingReasoning);

	return result;
};

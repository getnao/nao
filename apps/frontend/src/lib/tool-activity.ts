import type { UIToolPart } from '@nao/backend/chat';
import type { GroupablePart } from '@/types/ai';
import { getToolName, isReasoningPart, isToolSettled } from '@/lib/ai';
import { getFileName, getReadContextLabel } from '@/lib/file-path';
import { getMcpTarget } from '@/lib/mcp';

type ToolInput = Record<string, unknown>;

/** Describes the latest tool call for a collapsed group title without flashing back to the summary. */
export const getLatestToolActivityLabel = (parts: GroupablePart[]): string | null => {
	const latestPart = findLatestToolPart(parts);
	return latestPart ? describeToolActivity(latestPart) : null;
};

/** Parallel calls can settle out of order, so the newest call still running wins over the newest call overall. */
const findLatestToolPart = (parts: GroupablePart[]): UIToolPart | undefined => {
	const toolParts = parts.filter(isToolPart).reverse();
	return toolParts.find(isRunning) ?? toolParts[0];
};

const isToolPart = (part: GroupablePart): part is UIToolPart => {
	return !isReasoningPart(part);
};

const isRunning = (part: UIToolPart): boolean => {
	return !isToolSettled(part);
};

const describeToolActivity = (part: UIToolPart): string | null => {
	const input = (part.input ?? {}) as ToolInput;

	switch (getToolName(part)) {
		case 'read':
			return describeRead(input);
		case 'write':
			return withAsset('Saving', getFileName(asString(input.file_path)));
		case 'str_replace':
			return withAsset('Editing', getFileName(asString(input.file_path)));
		case 'search':
		case 'grep':
			return withAsset('Searching', asString(input.pattern));
		case 'list':
			return describeList(input);
		case 'execute_sql':
		case 'execute_semantic_query':
			return withAsset('Running', asString(input.name)) ?? 'Running query';
		case 'mcp_call':
			return describeMcpCall(input);
		case 'mcp_connect':
			return withAsset('Connecting to', asString(input.server));
		default:
			return null;
	}
};

const describeRead = (input: ToolInput): string | null => {
	const filePath = asString(input.file_path);
	const mcpTarget = getMcpTarget(filePath);
	if (mcpTarget) {
		return mcpTarget.tool && mcpTarget.server
			? `Loading ${mcpTarget.tool} from ${mcpTarget.server}`
			: `Loading ${mcpTarget.server ?? 'MCP servers'}`;
	}

	const fileName = getFileName(filePath);
	const contextLabel = getReadContextLabel(filePath);
	if (!fileName) {
		return null;
	}
	return contextLabel ? `Exploring ${fileName} from ${contextLabel}` : `Exploring ${fileName}`;
};

const describeList = (input: ToolInput): string | null => {
	const path = asString(input.path);
	const mcpTarget = getMcpTarget(path);
	if (!mcpTarget) {
		return withAsset('Exploring', path);
	}
	return mcpTarget.server ? `Listing ${mcpTarget.server} MCP tools` : 'Listing MCP servers';
};

const describeMcpCall = (input: ToolInput): string | null => {
	const server = asString(input.server);
	const tool = asString(input.tool);
	if (!server || !tool) {
		return null;
	}
	return `Using ${tool} from ${server}`;
};

const withAsset = (verb: string, asset: string | undefined): string | null => {
	return asset ? `${verb} ${asset}` : null;
};

const asString = (value: unknown): string | undefined => {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
};

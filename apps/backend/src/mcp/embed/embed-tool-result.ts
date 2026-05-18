import {
	buildMcpEmbedMarkdownLinks,
	chartAppPayloadFrom,
	type McpChartAppPayload,
	storyAppPayloadFrom,
} from '@nao/shared';
import type { McpEmbedKind } from '@nao/shared/types';

import type { ToolResult } from '../logging';
import { chatUrl } from '../urls';
import { attachSandboxToAppPayload } from './embed-payload';

export type StoryMcpToolPayload = Record<string, unknown> & { embedUrl: string };

export type ChartToolPayload = McpChartAppPayload & Record<string, unknown>;

export function buildStoryToolResult(
	output: StoryMcpToolPayload,
	options?: { sandboxStoryHtml?: string | null },
): ToolResult {
	const title = typeof output.title === 'string' ? output.title : 'Story';
	const naoUrl = typeof output.url === 'string' ? output.url : null;
	const slimPayload = storyAppPayloadFrom({
		embedUrl: output.embedUrl,
		id: output.id,
		title: output.title,
		url: output.url,
		chatUrl: output.chatUrl,
	});

	return buildEmbedToolResult({
		kind: 'story',
		title,
		embedUrl: output.embedUrl,
		naoUrl,
		jsonPayload: output,
		structuredBase: slimPayload,
		sandboxHtml: options?.sandboxStoryHtml,
	});
}

export function buildChartToolResult(
	output: ChartToolPayload,
	options: { sandboxChartHtml?: string | null },
): ToolResult {
	const title = typeof output.title === 'string' ? output.title : 'Chart';
	const embedUrl = typeof output.embedUrl === 'string' && output.embedUrl.length > 0 ? output.embedUrl : null;
	const chatId = typeof output.chatId === 'string' ? output.chatId : null;
	const naoUrl = chatId ? chatUrl(chatId) : null;
	const slimPayload = chartAppPayloadFrom(output);

	return buildEmbedToolResult({
		kind: 'chart',
		title,
		embedUrl,
		naoUrl,
		jsonPayload: slimPayload,
		structuredBase: slimPayload,
		sandboxHtml: options.sandboxChartHtml,
		missingQueryMessage:
			embedUrl === null
				? `_Query data for \`${output.queryId}\` not found — re-run \`execute_sql\` then \`display_chart\`. The JSON payload includes the \`<chart>\` block._`
				: undefined,
	});
}

function buildEmbedToolResult(options: {
	kind: McpEmbedKind;
	title: string;
	embedUrl: string | null;
	naoUrl: string | null;
	jsonPayload: Record<string, unknown>;
	structuredBase: Record<string, unknown>;
	sandboxHtml?: string | null;
	missingQueryMessage?: string;
}): ToolResult {
	const fallbackText = buildMcpEmbedMarkdownLinks({
		title: options.title,
		embedUrl: options.embedUrl,
		naoUrl: options.naoUrl,
		missingQueryMessage: options.missingQueryMessage,
	});

	const textPayload = attachSandboxToAppPayload(options.jsonPayload, options.sandboxHtml, options.kind);
	const structuredContent = attachSandboxToAppPayload(options.structuredBase, options.sandboxHtml, options.kind);

	return {
		content: [
			{ type: 'text', text: JSON.stringify(textPayload) },
			{ type: 'text', text: fallbackText },
		],
		structuredContent,
	};
}

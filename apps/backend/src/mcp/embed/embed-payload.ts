import { MCP_EMBED_SANDBOX_HTML_FIELD, type McpEmbedKind } from '@nao/shared/types';

export const MAX_SANDBOX_MCP_BYTES = 48 * 1024;

export const MAX_SANDBOX_HTML_CHARS = 220_000;

export function attachSandboxToAppPayload<T extends Record<string, unknown>>(
	payload: T,
	sandboxHtml: string | null | undefined,
	kind: McpEmbedKind,
): T {
	if (!sandboxFitsMcpPayload(sandboxHtml)) {
		return payload;
	}
	const field = MCP_EMBED_SANDBOX_HTML_FIELD[kind];
	return { ...payload, [field]: sandboxHtml };
}

function sandboxFitsMcpPayload(html: string | null | undefined): html is string {
	if (typeof html !== 'string' || html.length === 0) {
		return false;
	}
	return Buffer.byteLength(html, 'utf8') <= MAX_SANDBOX_MCP_BYTES;
}

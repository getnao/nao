import { describe, expect, it } from 'vitest';

import { mcpJsonSchema, NAO_INTERNAL_MCP_SERVER } from '../src/mcp';

describe('mcp.json', () => {
	it('keeps the name of nao’s own server for nao', () => {
		const server = { url: 'https://mcp.linear.app/mcp' };

		expect(mcpJsonSchema.safeParse({ mcpServers: { linear: server } }).success).toBe(true);
		expect(
			mcpJsonSchema.safeParse({ mcpServers: { [NAO_INTERNAL_MCP_SERVER]: server } }).error?.issues[0].message,
		).toContain('reserved');
	});
});

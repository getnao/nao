import { describe, expect, it } from 'vitest';

import { groupMcpToolCalls } from './mcp';
import type { GroupablePart } from '@/types/ai';

const mcpCall = (toolCallId: string, server: string): GroupablePart =>
	({
		type: 'dynamic-tool',
		toolName: 'mcp_call',
		toolCallId,
		state: 'output-available',
		input: { server, tool: 'search', arguments: {} },
		output: {},
	}) as unknown as GroupablePart;

describe('groupMcpToolCalls', () => {
	it('uses the first tool call id as the stable MCP subgroup id', () => {
		const first = groupMcpToolCalls([mcpCall('call-1', 'metabase'), mcpCall('call-2', 'metabase')]);
		const updated = groupMcpToolCalls([
			mcpCall('call-1', 'metabase'),
			{ type: 'reasoning', text: 'thinking', state: 'done' } as GroupablePart,
			mcpCall('call-2', 'metabase'),
			mcpCall('call-3', 'metabase'),
		]);

		expect(first[0]).toMatchObject({ type: 'mcp-sub-group', id: 'metabase:call-1' });
		expect(updated[0]).toMatchObject({ type: 'mcp-sub-group', id: 'metabase:call-1' });
	});
});

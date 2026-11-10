import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	buildMcpToolContext: vi.fn(),
}));

vi.mock('../src/services/agent', () => ({
	buildMcpToolContext: mocks.buildMcpToolContext,
	buildToolContext: vi.fn(),
}));

import { runAgentTool } from '../src/mcp/tools/run-agent-tool';

describe('MCP test attempt tool context', () => {
	it('forces dangerous SQL writes off without changing the project setting', async () => {
		const projectSettings = { sql: { dangerouslyWritePermEnabled: true, enforceExcludedColumns: true } };
		const toolContext = { agentSettings: projectSettings };
		mocks.buildMcpToolContext.mockResolvedValue(toolContext);
		const execute = vi.fn((_input, options) => options.experimental_context.agentSettings);

		const result = await runAgentTool(
			{ execute } as never,
			{},
			{
				userId: 'user-1',
				projectId: 'project-1',
				testAttemptId: 'attempt-1',
				role: 'user',
				settings: { enabled: true, subAgentModeEnabled: false, contextLayerModeEnabled: true },
				chartDataMode: false,
				storyCreationEnabled: false,
				customStoryCreationEnabled: false,
			},
		);

		expect(result).toEqual({ sql: { dangerouslyWritePermEnabled: false, enforceExcludedColumns: true } });
		expect(projectSettings.sql.dangerouslyWritePermEnabled).toBe(true);
	});
});

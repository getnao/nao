import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { getTools } from '../src/agents/tools';
import { authRequiredOutput, createMcpCallTool } from '../src/agents/tools/mcp-call';
import { createMcpConnectTool } from '../src/agents/tools/mcp-connect';
import { normalizeReturnTo, resultPage } from '../src/routes/mcp-oauth';
import { McpArgsValidationError, McpService, mcpService } from '../src/services/mcp';
import { extractToolsFromOpenApi } from '../src/services/mcp-openapi';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('MCP OAuth callback helpers', () => {
	it('normalizes unsafe return paths to root', () => {
		expect(normalizeReturnTo('/settings/mcp')).toBe('/settings/mcp');
		expect(normalizeReturnTo('/chat-123?mcp=connected')).toBe('/chat-123');
		expect(normalizeReturnTo('//evil.test/path')).toBe('/');
		expect(normalizeReturnTo('/x</script><script>alert(1)//')).toBe('/');
		expect(normalizeReturnTo('/\\evil')).toBe('/');
	});

	it('escapes JSON embedded in the result page script', () => {
		const html = resultPage('connected', '</script><script>alert(1)</script>', '/safe');

		expect(html).not.toContain('</script><script>alert(1)</script>');
		expect(html).toContain('\\u003c/script>');
	});
});

describe('MCP OpenAPI extraction', () => {
	it('only reads tool operations from generated /tools paths', () => {
		const tools = extractToolsFromOpenApi({
			paths: {
				'/tools/search': { post: { operationId: 'search', description: 'Search' } },
				'/admin/health': { post: { operationId: 'health', description: 'Health' } },
			},
		});

		expect(tools).toEqual([{ name: 'search', description: 'Search' }]);
	});
});

describe('MCP spec file paths', () => {
	it('keeps remote tool names inside the server spec directory', () => {
		const service = new McpService() as unknown as {
			_projectPath: string;
			_toolFilePath: (server: string, tool: string) => string;
		};
		service._projectPath = '/tmp/project';

		const filePath = service._toolFilePath('server', '../../../secrets');

		expect(filePath).toBe(resolve('/tmp/project/agent/mcps/server/..%2F..%2F..%2Fsecrets.json'));
	});

	it('rejects server names that escape the MCP specs directory', () => {
		const service = new McpService() as unknown as {
			_projectPath: string;
			_toolFilePath: (server: string, tool: string) => string;
		};
		service._projectPath = '/tmp/project';

		expect(() => service._toolFilePath('../outside', 'tool')).toThrow('escapes');
	});
});

describe('MCP argument validation', () => {
	it('awaits async Ajv validators and returns schema issues', async () => {
		const service = new McpService() as unknown as {
			_discovered: Record<string, unknown[]>;
			_validateArgs: (server: string, tool: string, args: Record<string, unknown>) => Promise<void>;
		};
		service._discovered = {
			server: [
				{
					name: 'lookup',
					inputSchema: {
						$async: true,
						type: 'object',
						required: ['id'],
						properties: { id: { type: 'string' } },
					},
				},
			],
		};

		await expect(service._validateArgs('server', 'lookup', {})).rejects.toBeInstanceOf(McpArgsValidationError);
	});
});

describe('MCP first discovery', () => {
	it('only reports servers that expose at least one tool as discovered', async () => {
		const service = new McpService() as unknown as {
			_projectId: string;
			_initPromise: Promise<void>;
			_discovered: Record<string, unknown[]>;
			hasDiscoveredTools: (projectId: string, server: string) => Promise<boolean>;
		};
		service._projectId = 'project';
		service._initPromise = Promise.resolve();
		service._discovered = { unconnected: [], connected: [{ name: 'search' }] };

		expect(await service.hasDiscoveredTools('project', 'unconnected')).toBe(false);
		expect(await service.hasDiscoveredTools('project', 'connected')).toBe(true);
	});
});

describe('MCP auth-required tool output', () => {
	it('does not treat colliding remote payloads as internal auth sentinels', () => {
		const tool = createMcpCallTool(null) as unknown as {
			toModelOutput: (args: { output: unknown }) => { value: string };
		};

		const output = tool.toModelOutput({ output: { mcpAuthRequired: true, server: 'remote' } });

		expect(output.value).not.toContain('AUTH_REQUIRED');
		expect(output.value).toContain('"mcpAuthRequired":true');
	});
});

describe('MCP connect tool', () => {
	it('tells the model to wait for the user, then reports the tools once connected', () => {
		const tool = createMcpConnectTool(null) as unknown as {
			toModelOutput: (args: { output: unknown }) => { value: string };
		};

		expect(tool.toModelOutput({ output: authRequiredOutput('metabase') }).value).toContain('AUTH_REQUIRED');
		expect(tool.toModelOutput({ output: { server: 'metabase', tools: ['search'] } }).value).toContain('search');
	});

	it('refuses servers outside the run allowlist', async () => {
		const tool = createMcpConnectTool(['allowed']) as unknown as {
			execute: (input: { server: string }, options: unknown) => Promise<unknown>;
		};

		await expect(tool.execute({ server: 'other' }, { experimental_context: {} })).rejects.toThrow(
			'not available in this context',
		);
	});
});

describe('MCP tool registration', () => {
	it('omits the MCP tools when the requested allowlist is empty or unavailable', () => {
		vi.spyOn(mcpService, 'getConfiguredServerNames').mockReturnValue(['configured']);

		expect(getTools(null, undefined, { mcpServers: [] })).not.toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { mcpServers: ['missing'] })).not.toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { mcpServers: ['configured'] })).toHaveProperty('mcp_call');
		expect(getTools(null, undefined, { mcpServers: ['configured'] })).toHaveProperty('mcp_connect');
		expect(getTools(null, undefined, {})).toHaveProperty('mcp_call');
	});
});

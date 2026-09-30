import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db/db', () => ({ db: {} }));

import { getTools } from '../src/agents/tools';
import { createCodemodeTool } from '../src/agents/tools/codemode';
import { createMcpFunctions, toScriptValue } from '../src/services/codemode/mcp-functions';
import { type CodemodeFunction, type CodemodeResult, runCodemode } from '../src/services/codemode/sandbox';
import { McpArgsValidationError, mcpService } from '../src/services/mcp';
import { McpAuthRequiredError } from '../src/services/mcp-oauth';
import type { ToolContext } from '../src/types/tools';

const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('runCodemode', () => {
	const tickets: CodemodeFunction = {
		path: ['mcp', 'linear', 'get_ticket'],
		execute: async (args) => {
			const { id } = args as { id: string };
			return { id, relations: id === 'ENG-1' ? [{ id: 'ENG-2' }, { id: 'ENG-3' }] : [] };
		},
	};

	it('chains and parallelizes calls, and returns logs and the value', async () => {
		const result = await run(
			`const ticket = await mcp.linear.get_ticket({ id: "ENG-1" });
			const related = await Promise.all(ticket.relations.map((r) => mcp.linear.get_ticket({ id: r.id })));
			console.log("related", related.length);
			return related.map((t) => t.id);`,
			[tickets],
		);

		expect(result).toMatchObject({ ok: true, value: ['ENG-2', 'ENG-3'], logs: ['related 2'] });
		expect(result.calls.map((call) => [call.name, call.status])).toEqual([
			['mcp.linear.get_ticket', 'ok'],
			['mcp.linear.get_ticket', 'ok'],
			['mcp.linear.get_ticket', 'ok'],
		]);
	});

	it('exposes names that are not identifiers under an identifier alias and with brackets', async () => {
		const listThings: CodemodeFunction = { path: ['mcp', 'my-server', 'list-things'], execute: () => ['a'] };

		const result = await run(
			'return [await mcp.my_server.list_things(), await mcp["my-server"]["list-things"]()]',
			[listThings],
		);

		expect(result).toMatchObject({ ok: true, value: [['a'], ['a']] });
	});

	it('lists the available members when the script uses an unknown function', async () => {
		const result = await run('return await mcp.linear.get_tiket({})', [tickets]);

		expect(result.ok).toBe(false);
		expect(errorOf(result).message).toContain('mcp.linear.get_tiket does not exist. Available: get_ticket');
	});

	it('lets the script catch a failing call', async () => {
		const failing: CodemodeFunction = {
			path: ['mcp', 'linear', 'fail'],
			execute: () => {
				throw new Error('boom');
			},
		};

		const result = await run('try { await mcp.linear.fail({}) } catch (e) { return "caught " + e.message }', [
			failing,
		]);

		expect(result).toMatchObject({ ok: true, value: 'caught boom' });
		expect(result.calls).toMatchObject([{ name: 'mcp.linear.fail', status: 'error', error: 'boom' }]);
	});

	it('stops a synchronous infinite loop at the timeout', async () => {
		const result = await run('while (true) {}', [], 300);

		expect(errorOf(result).kind).toBe('timeout');
	});

	it('stops an infinite microtask loop at the timeout', async () => {
		const result = await run('while (true) await null;', [], 300);

		expect(errorOf(result).kind).toBe('timeout');
	});

	it('fails a script awaiting a promise that can never settle', async () => {
		const result = await run('await new Promise(() => {});');

		expect(errorOf(result)).toMatchObject({ kind: 'script' });
		expect(errorOf(result).message).toContain('can never settle');
	});

	it('reports syntax errors as script errors', async () => {
		const result = await run('return (');

		expect(errorOf(result).kind).toBe('script');
	});

	it('gives the script no network, process, modules or timers', async () => {
		const result = await run('return [typeof fetch, typeof process, typeof require, typeof setTimeout]');

		expect(result).toMatchObject({ ok: true, value: ['undefined', 'undefined', 'undefined', 'undefined'] });
	});

	it('fails a script that exceeds the memory limit', async () => {
		const result = await run(
			'const chunks = []; while (true) chunks.push("x".repeat(1024 * 1024) + chunks.length);',
		);

		expect(result.ok).toBe(false);
	});

	it('aborts the run and the pending calls when the signal is aborted', async () => {
		const controller = new AbortController();
		let callSignal: AbortSignal | undefined;
		const hanging: CodemodeFunction = {
			path: ['mcp', 'slow', 'wait'],
			execute: (_args, { signal }) => {
				callSignal = signal;
				controller.abort();
				return new Promise(() => {});
			},
		};

		const result = await runCodemode({
			code: 'return await mcp.slow.wait({})',
			functions: [hanging],
			timeoutMs: 5_000,
			memoryLimitBytes: MEMORY_LIMIT_BYTES,
			signal: controller.signal,
		});

		expect(errorOf(result).kind).toBe('aborted');
		expect(callSignal?.aborted).toBe(true);
		expect(result.calls).toMatchObject([{ name: 'mcp.slow.wait', status: 'cancelled' }]);
	});
});

describe('codemode MCP functions', () => {
	it('exposes one function per callable tool', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([
			{ server: 'linear', tools: ['get_ticket', 'list_issues'] },
			{ server: 'github', tools: [] },
		]);

		const functions = await createMcpFunctions(mcpOptions());

		expect(functions.map((fn) => fn.path)).toEqual([
			['mcp', 'linear', 'get_ticket'],
			['mcp', 'linear', 'list_issues'],
		]);
	});

	it('calls the tool through the MCP service with the run permissions', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([{ server: 'linear', tools: ['get_ticket'] }]);
		const callTool = vi.spyOn(mcpService, 'callTool').mockResolvedValue({
			content: [{ type: 'text', text: '{"id":"ENG-1"}' }],
		});

		const [getTicket] = await createMcpFunctions(mcpOptions({ allowedServers: ['linear'] }));
		const value = await getTicket.execute({ id: 'ENG-1' }, { signal: new AbortController().signal });

		expect(value).toEqual({ id: 'ENG-1' });
		expect(callTool).toHaveBeenCalledWith({
			projectId: 'project-1',
			userId: 'user-1',
			server: 'linear',
			tool: 'get_ticket',
			args: { id: 'ENG-1' },
			allowedServers: ['linear'],
		});
	});

	it('reports the server and throws when the user must connect their account', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([{ server: 'linear', tools: ['get_ticket'] }]);
		vi.spyOn(mcpService, 'callTool').mockRejectedValue(new McpAuthRequiredError('linear'));
		const onAuthRequired = vi.fn();

		const [getTicket] = await createMcpFunctions(mcpOptions({ onAuthRequired }));

		await expect(getTicket.execute({}, { signal: new AbortController().signal })).rejects.toThrow('AUTH_REQUIRED');
		expect(onAuthRequired).toHaveBeenCalledWith('linear');
	});

	it('points to the spec when the arguments do not match it', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([{ server: 'linear', tools: ['get_ticket'] }]);
		vi.spyOn(mcpService, 'callTool').mockRejectedValue(
			new McpArgsValidationError('linear', 'get_ticket', ['id: Required']),
		);

		const [getTicket] = await createMcpFunctions(mcpOptions());

		await expect(getTicket.execute({}, { signal: new AbortController().signal })).rejects.toThrow(
			'Invalid arguments for mcp.linear.get_ticket: id: Required. Check /agent/mcps/linear/get_ticket.json.',
		);
	});

	it('rejects arguments that are not an object', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([{ server: 'linear', tools: ['get_ticket'] }]);

		const [getTicket] = await createMcpFunctions(mcpOptions());

		await expect(getTicket.execute('ENG-1', { signal: new AbortController().signal })).rejects.toThrow(
			'takes one object argument',
		);
	});

	it('converts MCP results into script values', () => {
		expect(toScriptValue({ content: [], structuredContent: { total: 3 } })).toEqual({ total: 3 });
		expect(toScriptValue({ content: [{ type: 'text', text: '[1,2]' }] })).toEqual([1, 2]);
		expect(toScriptValue({ content: [{ type: 'text', text: 'plain text' }] })).toBe('plain text');
		expect(() => toScriptValue({ content: [{ type: 'text', text: 'not found' }], isError: true })).toThrow(
			'not found',
		);
	});
});

describe('codemode tool', () => {
	it('returns the result and the connect prompt when a call needs the user to connect', async () => {
		vi.spyOn(mcpService, 'getCallableTools').mockResolvedValue([{ server: 'linear', tools: ['get_ticket'] }]);
		vi.spyOn(mcpService, 'callTool').mockRejectedValue(new McpAuthRequiredError('linear'));
		const tool = createCodemodeTool({ mcpServers: null });

		const output = await tool.execute!(
			{
				description: 'Fetch a ticket',
				code: 'try { await mcp.linear.get_ticket({}) } catch (e) { return "failed" }',
			},
			{ toolCallId: 'call-1', messages: [], experimental_context: toolContext() },
		);

		expect(output).toMatchObject({ ok: true, result: '"failed"', mcpAuthRequired: true, server: 'linear' });
		const modelOutput = tool.toModelOutput!({
			toolCallId: 'call-1',
			input: undefined as never,
			output: output as never,
		});
		expect(modelOutput).toMatchObject({ type: 'text' });
		expect((modelOutput as { value: string }).value).toContain('AUTH_REQUIRED');
	});

	it('runs without MCP functions when MCP is off for the run', async () => {
		const getCallableTools = vi.spyOn(mcpService, 'getCallableTools');
		const tool = createCodemodeTool({ mcpServers: false });

		const output = await tool.execute!(
			{ description: 'Sum', code: 'return [1, 2, 3].reduce((a, b) => a + b, 0)' },
			{ toolCallId: 'call-1', messages: [], experimental_context: toolContext() },
		);

		expect(output).toMatchObject({ ok: true, result: '6', calls: [] });
		expect(getCallableTools).not.toHaveBeenCalled();
	});

	it('is only exposed behind the experimental setting', () => {
		vi.spyOn(mcpService, 'getConfiguredServerNames').mockReturnValue([]);

		expect(getTools(null)).not.toHaveProperty('codemode');
		expect(getTools({ experimental: { codemode: true } })).toHaveProperty('codemode');
	});
});

function run(code: string, functions: CodemodeFunction[] = [], timeoutMs = 5_000): Promise<CodemodeResult> {
	return runCodemode({ code, functions, timeoutMs, memoryLimitBytes: MEMORY_LIMIT_BYTES });
}

function errorOf(result: CodemodeResult) {
	if (result.ok) {
		throw new Error(`Expected the script to fail, got ${JSON.stringify(result.value)}`);
	}
	return result.error;
}

function mcpOptions(overrides: Partial<Parameters<typeof createMcpFunctions>[0]> = {}) {
	return { projectId: 'project-1', userId: 'user-1', allowedServers: null, onAuthRequired: vi.fn(), ...overrides };
}

function toolContext(): ToolContext {
	return { projectId: 'project-1', userId: 'user-1' } as ToolContext;
}

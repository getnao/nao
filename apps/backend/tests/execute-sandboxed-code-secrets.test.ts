import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../src/types/tools';

class ExecError extends Error {}
class TimeoutError extends Error {}

const exec = vi.fn();
const constructed: Record<string, unknown>[] = [];

class FakeCodeBox {
	constructor(options: Record<string, unknown>) {
		constructed.push(options);
	}
	exec = exec;
	installPackages = vi.fn();
	copyIn = vi.fn();
	copyOut = vi.fn();
	run = vi.fn(() => {
		throw new Error('run() bypasses env injection and must not be used');
	});
}

const resolve = vi.fn();

vi.mock('../src/services/sandbox-runtime', () => ({
	sandboxRuntime: { CodeBox: FakeCodeBox, ExecError, TimeoutError },
	isSandboxAvailable: true,
}));
vi.mock('../src/services/sandbox-secret.service', () => ({
	sandboxSecretService: { resolve },
}));
vi.mock('../src/queries/image.queries', () => ({ getImagesByChatId: vi.fn(async () => []) }));
vi.mock('../src/services/query-result.service', () => ({ getQueryResult: vi.fn() }));
vi.mock('../src/services/storage/user-files', () => ({ readUserFileBytes: vi.fn(), writeUserFileBytes: vi.fn() }));

const { default: executeSandboxedCode } = await import('../src/agents/tools/execute-sandboxed-code');

const SECRET_VALUE = 'sk-live-0123456789abcdef';
const projectFolder = mkdtempSync(join(tmpdir(), 'nao-sandbox-secrets-'));

afterAll(() => {
	rmSync(projectFolder, { recursive: true, force: true });
});

function contextFor(userId: string): ToolContext {
	return {
		projectFolder,
		chatId: 'chat-1',
		userId,
		projectId: 'project-1',
		supportsCustomCharts: false,
		agentSettings: null,
		envVars: {},
		azureAccessToken: null,
		queryResults: new Map(),
		generatedArtifacts: { charts: [], maps: [], stories: [] },
	};
}

async function run(input: Record<string, unknown>, context: ToolContext) {
	const tool = executeSandboxedCode!;
	return tool.execute!(input as never, { toolCallId: 'call', messages: [], experimental_context: context } as never);
}

function guestExecCalls() {
	return exec.mock.calls.filter(([command]) => command !== 'mkdir');
}

beforeEach(() => {
	exec.mockReset();
	resolve.mockReset();
	constructed.length = 0;
	exec.mockImplementation(async (command: string, args: string[] | string) => {
		if (command === 'mkdir') {
			return { stdout: '', stderr: '', exitCode: 0 };
		}
		const code = Array.isArray(args) ? args[1] : '';
		return { stdout: `out ${SECRET_VALUE} ${code}`, stderr: `err ${SECRET_VALUE}`, exitCode: 0 };
	});
	resolve.mockResolvedValue([{ name: 'OPENWEATHER_API_KEY', value: SECRET_VALUE }]);
});

describe('execute_sandboxed_code secrets', () => {
	it('passes the user secrets as environment variables to the python interpreter', async () => {
		const context = contextFor('user-1');
		await run({ code: 'print(1)', language: 'python' }, context);

		expect(resolve).toHaveBeenCalledWith('user-1', 'project-1');
		const [command, args, env] = guestExecCalls()[0];
		expect(command).toBe('/usr/local/bin/python');
		expect(args).toEqual(['-c', 'print(1)']);
		expect(env).toEqual({ OPENWEATHER_API_KEY: SECRET_VALUE });
	});

	it('passes the user secrets as environment variables to the shell', async () => {
		await run({ code: 'echo hi', language: 'shell' }, contextFor('user-1'));

		const [command, args, env] = guestExecCalls()[0];
		expect(command).toBe('sh');
		expect(args).toEqual(['-c', 'echo hi']);
		expect(env).toEqual({ OPENWEATHER_API_KEY: SECRET_VALUE });
	});

	it('passes no environment when the user has no secret', async () => {
		resolve.mockResolvedValue([]);
		await run({ code: 'print(1)', language: 'python' }, contextFor('user-1'));

		const [, , env] = guestExecCalls()[0];
		expect(env).toBeUndefined();
	});

	it('redacts secret values from stdout and stderr before they reach the model', async () => {
		const result = await run({ code: 'print(1)', language: 'python' }, contextFor('user-1'));

		expect(result.stdout).toBe('out [REDACTED:OPENWEATHER_API_KEY] print(1)');
		expect(result.stderr).toBe('err [REDACTED:OPENWEATHER_API_KEY]');
		expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
	});

	it('redacts secret values from execution errors', async () => {
		exec.mockImplementation(async (command: string) => {
			if (command === 'mkdir') {
				return { stdout: '', stderr: '', exitCode: 0 };
			}
			throw new ExecError(`boom ${SECRET_VALUE}`);
		});

		const result = await run({ code: 'print(1)', language: 'python' }, contextFor('user-1'));
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe('boom [REDACTED:OPENWEATHER_API_KEY]');
	});

	it('does not reuse a pooled sandbox created for another user', async () => {
		const first = await run({ code: 'print(1)', language: 'python' }, contextFor('user-1'));

		const sameUser = await run({ sandbox_id: first.sandbox_id, code: 'print(2)' }, contextFor('user-1'));
		expect(sameUser.sandbox_id).toBe(first.sandbox_id);
		expect(constructed).toHaveLength(1);

		const otherUser = await run({ sandbox_id: first.sandbox_id, code: 'print(3)' }, contextFor('user-2'));
		expect(otherUser.sandbox_id).not.toBe(first.sandbox_id);
		expect(constructed).toHaveLength(2);
	});
});

import type { executeSandboxedCode } from '@nao/shared/tools';
import type { Tool } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../src/types/tools';
import { useTemporaryFolders } from '../helpers/temporary-folders';
import { createToolContext, executeTool } from '../helpers/tool-context';

type ExecResult = { stdout: string; stderr: string; exitCode: number };

const sandbox = vi.hoisted(() => {
	class ExecError extends Error {}
	class TimeoutError extends Error {}

	return {
		boxes: [] as { exec: ReturnType<typeof vi.fn> }[],
		housekeepingExec: vi.fn(),
		codeExec: vi.fn(),
		resolveSecrets: vi.fn(),
		ExecError,
		TimeoutError,
	};
});

vi.mock('../../src/services/sandbox-runtime', () => ({
	isSandboxAvailable: true,
	sandboxRuntime: {
		CodeBox: class FakeCodeBox {
			/** User code is run through `exec` with an args array; housekeeping passes variadic strings. */
			exec = vi.fn(async (command: string, ...args: unknown[]) => {
				const [codeArgs, env] = args;
				if (!Array.isArray(codeArgs)) {
					return sandbox.housekeepingExec(this, command, ...args);
				}
				return sandbox.codeExec(this, command, codeArgs, env);
			});
			installPackages = vi.fn();
			copyIn = vi.fn();
			copyOut = vi.fn();
			run = vi.fn(() => {
				throw new Error('run() bypasses env injection and must not be used');
			});

			constructor() {
				sandbox.boxes.push(this);
			}
		},
		ExecError: sandbox.ExecError,
		TimeoutError: sandbox.TimeoutError,
	},
}));
vi.mock('../../src/services/sandbox-secret.service', () => ({
	sandboxSecretService: { resolve: sandbox.resolveSecrets },
}));
vi.mock('../../src/queries/image.queries', () => ({ getImagesByChatId: vi.fn(async () => []) }));
vi.mock('../../src/services/query-result.service', () => ({ getQueryResult: vi.fn() }));
vi.mock('../../src/services/storage/user-files', () => ({ readUserFileBytes: vi.fn(), writeUserFileBytes: vi.fn() }));

import sandboxTool from '../../src/agents/tools/execute-sandboxed-code';

const SECRET_VALUE = 'sk-live-0123456789abcdef';

let projectFolder: string;
const createTemporaryFolder = useTemporaryFolders();

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	sandbox.boxes.splice(0);
	sandbox.housekeepingExec.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
	sandbox.resolveSecrets.mockResolvedValue([]);
	onCodeRun((code) => code);
	projectFolder = createTemporaryFolder('nao-sandbox-project-');
});

afterEach(() => {
	vi.useRealTimers();
});

describe('execute sandboxed code pooling', () => {
	it('serializes the full operation for requests reusing one sandbox', async () => {
		const initial = await runSandbox({ code: 'seed' });
		const box = sandbox.boxes[0];
		const firstStarted = deferred<void>();
		const releaseFirst = deferred<void>();

		box.exec.mockClear();
		sandbox.housekeepingExec.mockClear();
		sandbox.codeExec.mockClear();
		onCodeRun(async (code) => {
			if (code === 'first') {
				firstStarted.resolve();
				await releaseFirst.promise;
			}
			return code;
		});

		const first = runSandbox({ sandbox_id: initial.sandbox_id, code: 'first' });
		await firstStarted.promise;
		const second = runSandbox({ sandbox_id: initial.sandbox_id, code: 'second' });
		await Promise.resolve();

		expect(sandbox.housekeepingExec).toHaveBeenCalledTimes(1);
		expect(sandbox.codeExec).toHaveBeenCalledTimes(1);

		releaseFirst.resolve();
		await expect(Promise.all([first, second])).resolves.toMatchObject([
			{ stdout: 'first', sandbox_id: initial.sandbox_id },
			{ stdout: 'second', sandbox_id: initial.sandbox_id },
		]);
		expect(executedCode()).toEqual(['first', 'second']);
	});

	it('keeps operations on different sandboxes concurrent', async () => {
		const firstSandbox = await runSandbox({ code: 'seed-one' });
		const secondSandbox = await runSandbox({ code: 'seed-two' });
		const firstStarted = deferred<void>();
		const secondStarted = deferred<void>();
		const release = deferred<void>();

		onCodeRun(async (code) => {
			if (code === 'first') {
				firstStarted.resolve();
				await release.promise;
			}
			if (code === 'second') {
				secondStarted.resolve();
				await release.promise;
			}
			return code;
		});

		const first = runSandbox({ sandbox_id: firstSandbox.sandbox_id, code: 'first' });
		const second = runSandbox({ sandbox_id: secondSandbox.sandbox_id, code: 'second' });
		await Promise.all([firstStarted.promise, secondStarted.promise]);

		release.resolve();
		await expect(Promise.all([first, second])).resolves.toMatchObject([
			{ stdout: 'first', sandbox_id: firstSandbox.sandbox_id },
			{ stdout: 'second', sandbox_id: secondSandbox.sandbox_id },
		]);
	});

	it('replaces a timed-out sandbox before a queued request runs', async () => {
		const initial = await runSandbox({ code: 'seed' });
		const timedOutStarted = deferred<void>();
		const releaseTimeout = deferred<void>();

		onCodeRun(async (code) => {
			if (code === 'timeout') {
				timedOutStarted.resolve();
				await releaseTimeout.promise;
				throw new sandbox.TimeoutError();
			}
			return code;
		});

		const timedOut = runSandbox({ sandbox_id: initial.sandbox_id, code: 'timeout' });
		await timedOutStarted.promise;
		const queued = runSandbox({ sandbox_id: initial.sandbox_id, code: 'after-timeout' });
		releaseTimeout.resolve();

		await expect(timedOut).resolves.toMatchObject({ exitCode: 124, sandbox_id: initial.sandbox_id });
		const replacement = await queued;
		expect(replacement.sandbox_id).not.toBe(initial.sandbox_id);
		expect(replacement.stderr).toContain(`Sandbox "${initial.sandbox_id}" expired`);
		expect(replacement.stdout).toBe('after-timeout');
		expect(sandbox.boxes).toHaveLength(2);
	});

	it('reuses a pooled sandbox only for the same user and project', async () => {
		const first = await runSandbox({ code: 'print(1)' });

		const sameOwner = await runSandbox({ sandbox_id: first.sandbox_id, code: 'print(2)' });
		expect(sameOwner.sandbox_id).toBe(first.sandbox_id);
		expect(sandbox.boxes).toHaveLength(1);

		const otherUser = await runSandbox({ sandbox_id: first.sandbox_id, code: 'print(3)' }, { userId: 'user-2' });
		expect(otherUser.sandbox_id).not.toBe(first.sandbox_id);
		expect(sandbox.boxes).toHaveLength(2);

		const otherProject = await runSandbox(
			{ sandbox_id: first.sandbox_id, code: 'print(4)' },
			{ projectId: 'project-2' },
		);
		expect(otherProject.sandbox_id).not.toBe(first.sandbox_id);
		expect(sandbox.boxes).toHaveLength(3);
	});

	it('evicts pooled sandboxes once their idle timeout elapses', async () => {
		const first = await runSandbox({ code: 'print(1)' });
		vi.advanceTimersByTime(5 * 60 * 1000 + 1);

		const afterExpiry = await runSandbox({ sandbox_id: first.sandbox_id, code: 'print(2)' });
		expect(afterExpiry.sandbox_id).not.toBe(first.sandbox_id);
		expect(afterExpiry.stderr).toContain('expired');
	});
});

describe('execute_sandboxed_code secrets', () => {
	beforeEach(() => {
		sandbox.resolveSecrets.mockResolvedValue([{ name: 'OPENWEATHER_API_KEY', value: SECRET_VALUE }]);
		sandbox.codeExec.mockImplementation(
			async (_box, _command, args: string[]): Promise<ExecResult> => ({
				stdout: `out ${SECRET_VALUE} ${args[1]}`,
				stderr: `err ${SECRET_VALUE}`,
				exitCode: 0,
			}),
		);
	});

	it('passes the user secrets as environment variables to the python interpreter', async () => {
		await runSandbox({ code: 'print(1)', language: 'python' });

		expect(sandbox.resolveSecrets).toHaveBeenCalledWith('user-1', 'project-1');
		const [, command, args, env] = sandbox.codeExec.mock.calls[0];
		expect(command).toBe('/usr/local/bin/python');
		expect(args).toEqual(['-c', 'print(1)']);
		expect(env).toEqual({ OPENWEATHER_API_KEY: SECRET_VALUE });
	});

	it('passes the user secrets as environment variables to the shell', async () => {
		await runSandbox({ code: 'echo hi', language: 'shell' });

		const [, command, args, env] = sandbox.codeExec.mock.calls[0];
		expect(command).toBe('sh');
		expect(args).toEqual(['-c', 'echo hi']);
		expect(env).toEqual({ OPENWEATHER_API_KEY: SECRET_VALUE });
	});

	it('passes no environment when the user has no secret', async () => {
		sandbox.resolveSecrets.mockResolvedValue([]);
		await runSandbox({ code: 'print(1)', language: 'python' });

		const [, , , env] = sandbox.codeExec.mock.calls[0];
		expect(env).toBeUndefined();
	});

	it('redacts secret values from stdout and stderr before they reach the model', async () => {
		const result = await runSandbox({ code: 'print(1)', language: 'python' });

		expect(result.stdout).toBe('out [REDACTED:OPENWEATHER_API_KEY] print(1)');
		expect(result.stderr).toBe('err [REDACTED:OPENWEATHER_API_KEY]');
		expect(JSON.stringify(result)).not.toContain(SECRET_VALUE);
	});

	it('redacts secret values from execution errors', async () => {
		sandbox.codeExec.mockRejectedValue(new sandbox.ExecError(`boom ${SECRET_VALUE}`));

		const result = await runSandbox({ code: 'print(1)', language: 'python' });
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe('boom [REDACTED:OPENWEATHER_API_KEY]');
	});
});

function runSandbox(
	overrides: Pick<executeSandboxedCode.Input, 'code'> & Partial<executeSandboxedCode.Input>,
	contextOverrides: Partial<ToolContext> = {},
): Promise<executeSandboxedCode.Output> {
	const input: executeSandboxedCode.Input = {
		language: 'python',
		image: 'python:3.12-slim',
		vm_size: 'xxs',
		...overrides,
	};
	const tool = sandboxTool as Tool<executeSandboxedCode.Input, executeSandboxedCode.Output>;
	return executeTool(tool, input, createToolContext({ projectFolder, ...contextOverrides }));
}

function onCodeRun(runCode: (code: string) => string | Promise<string>): void {
	sandbox.codeExec.mockImplementation(
		async (_box, _command, args: string[]): Promise<ExecResult> => ({
			stdout: await runCode(args[1]),
			stderr: '',
			exitCode: 0,
		}),
	);
}

function executedCode(): string[] {
	return sandbox.codeExec.mock.calls.map(([, , args]) => args[1]);
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

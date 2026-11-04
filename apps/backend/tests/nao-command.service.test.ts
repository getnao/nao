import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boxlite = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('../src/env', () => ({ env: { APP_COMMIT: 'abc1234' } }));
vi.mock('../src/utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../src/services/sandbox-runtime', () => ({
	sandboxRuntime: { JsBoxlite: { withDefaultConfig: () => ({ create: boxlite.create }) } },
}));

import { NaoCommandExitError, runNaoCommandInSandbox } from '../src/services/nao-command.service';

let root: string;
let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-command-test-'));
	project = path.join(root, 'project');
	writeFiles(project, {
		'nao_config.yaml': 'project_name: sales\n',
		'RULES.md': 'old rules\n',
		'old.md': 'removed by sync\n',
		'databases/stale/columns.md': 'removed by sync\n',
		'.git/config': '[core]\n',
		'.git/hooks/README': 'hooks\n',
	});
	fs.writeFileSync(path.join(root, 'outside.md'), 'outside\n');
	fs.symlinkSync(path.join(root, 'outside.md'), path.join(project, 'linked.md'));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('runNaoCommandInSandbox', () => {
	it('runs nao in a box that only sees the project env vars, and streams the logs', async () => {
		const box = useFakeBox({ stdout: ['\u001b[32mSyncing\u001b[0m\r', 'Done\n'] });
		const onOutput = vi.fn(async () => undefined);

		await runNaoCommandInSandbox(['sync'], project, { POSTGRES_PASSWORD: 'secret' }, onOutput);

		expect(boxlite.create).toHaveBeenCalledWith(
			expect.objectContaining({
				image: 'getnao/nao:abc1234',
				volumes: [{ hostPath: expect.not.stringContaining(project), guestPath: '/project' }],
				autoStop: 0,
			}),
		);
		expect(box.exec).toHaveBeenCalledWith(
			'nao',
			['sync'],
			[['POSTGRES_PASSWORD', 'secret']],
			false,
			null,
			null,
			'/project',
		);
		expect(onOutput).toHaveBeenLastCalledWith('Syncing\nDone\n');
		await vi.waitFor(() => expect(fs.existsSync(box.mountPath())).toBe(false));
	});

	it('gives the box a copy without Git or symlinks, and brings back only plain files', async () => {
		let stagedEntries: string[] = [];
		useFakeBox({
			run: (staged) => {
				stagedEntries = fs.readdirSync(staged, { recursive: true }).map(String);
				fs.writeFileSync(path.join(staged, 'RULES.md'), 'new rules\n');
				fs.rmSync(path.join(staged, 'old.md'));
				fs.rmSync(path.join(staged, 'databases', 'stale'), { recursive: true });
				writeFiles(staged, {
					'databases/orders/columns.md': 'synced\n',
					'.git/config': '[core]\n\tfsmonitor = touch /tmp/pwned\n',
					'docs/.git/config': '[core]\n\tfsmonitor = touch /tmp/pwned\n',
				});
				fs.symlinkSync('/etc/hosts', path.join(staged, 'escape.md'));
				fs.mkdirSync(path.join(staged, 'linked.md'));
				fs.writeFileSync(path.join(staged, 'linked.md', 'through-link.md'), 'escaped\n');
			},
		});

		await runNaoCommandInSandbox(['sync'], project, {});

		expect(stagedEntries).not.toContain('.git');
		expect(stagedEntries).not.toContain('linked.md');
		expect(read('RULES.md')).toBe('new rules\n');
		expect(read('databases/orders/columns.md')).toBe('synced\n');
		expect(fs.existsSync(path.join(project, 'old.md'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'databases', 'stale'))).toBe(false);
		expect(read('.git/config')).toBe('[core]\n');
		expect(fs.existsSync(path.join(project, 'docs', '.git'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'escape.md'))).toBe(false);
		expect(fs.lstatSync(path.join(project, 'linked.md')).isSymbolicLink()).toBe(true);
		expect(fs.readFileSync(path.join(root, 'outside.md'), 'utf8')).toBe('outside\n');
	});

	it('keeps what synced and fails with the CLI output when nao exits with an error', async () => {
		useFakeBox({
			stderr: ['Failed to sync 1 database: finance\n'],
			exitCode: 1,
			run: (staged) => writeFiles(staged, { 'databases/orders/columns.md': 'synced\n' }),
		});

		const result = runNaoCommandInSandbox(['sync'], project, {});

		await expect(result).rejects.toThrow(NaoCommandExitError);
		await expect(result).rejects.toThrow('nao sync failed: Failed to sync 1 database: finance');
		expect(read('databases/orders/columns.md')).toBe('synced\n');
	});

	it('kills the command and brings nothing back when the sync is cancelled', async () => {
		const box = useFakeBox({
			stdout: ['Syncing\n'],
			runsUntilKilled: true,
			run: (staged) => writeFiles(staged, { 'databases/orders/columns.md': 'half synced\n' }),
		});
		const controller = new AbortController();

		const result = runNaoCommandInSandbox(['sync'], project, {}, undefined, controller.signal);
		await vi.waitFor(() => expect(box.exec).toHaveBeenCalled());
		controller.abort();

		await expect(result).rejects.toThrow('nao sync was cancelled.');
		expect(box.execution.kill).toHaveBeenCalled();
		expect(box.stop).toHaveBeenCalled();
		expect(fs.existsSync(path.join(project, 'databases', 'orders'))).toBe(false);
		await vi.waitFor(() => expect(fs.existsSync(box.mountPath())).toBe(false));
	});

	it('never starts nao when the sync is cancelled while the image downloads', async () => {
		const box = useFakeBox({});
		let finishDownload: () => void = () => undefined;
		boxlite.create.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishDownload = () => resolve(box);
				}),
		);
		const controller = new AbortController();

		const result = runNaoCommandInSandbox(['sync'], project, {}, undefined, controller.signal);
		await vi.waitFor(() => expect(boxlite.create).toHaveBeenCalled());
		controller.abort();
		finishDownload();

		await expect(result).rejects.toThrow();
		expect(box.exec).not.toHaveBeenCalled();
		expect(box.stop).toHaveBeenCalled();
	});
});

function useFakeBox({
	stdout = [],
	stderr = [],
	exitCode = 0,
	runsUntilKilled = false,
	run = () => undefined,
}: {
	stdout?: string[];
	stderr?: string[];
	exitCode?: number;
	runsUntilKilled?: boolean;
	run?: (stagedProject: string) => void;
}) {
	let mountPath = '';
	let markKilled: () => void = () => undefined;
	const killed = new Promise<void>((resolve) => {
		markKilled = resolve;
	});
	const toStream = (chunks: string[]) => {
		const remaining = [...chunks];
		return {
			async next() {
				if (remaining.length > 0) {
					return remaining.shift()!;
				}
				if (runsUntilKilled) {
					await killed;
				}
				return null;
			},
		};
	};
	const execution = {
		stdout: async () => toStream(stdout),
		stderr: async () => toStream(stderr),
		wait: async () => ({ exitCode: runsUntilKilled ? 137 : exitCode }),
		kill: vi.fn(async () => markKilled()),
	};
	const box = {
		execution,
		mountPath: () => mountPath,
		start: vi.fn(async () => undefined),
		exec: vi.fn(async () => {
			if (box.start.mock.calls.length === 0) {
				throw new Error('Cannot exec box: it is configured but not started.');
			}
			run(mountPath);
			return execution;
		}),
		stop: vi.fn(async () => undefined),
	};
	boxlite.create.mockImplementation(async (options: { volumes: { hostPath: string }[] }) => {
		mountPath = options.volumes[0].hostPath;
		return box;
	});
	return box;
}

function writeFiles(directory: string, files: Record<string, string>): void {
	for (const [relativePath, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(directory, relativePath)), { recursive: true });
		fs.writeFileSync(path.join(directory, relativePath), content);
	}
}

function read(relativePath: string): string {
	return fs.readFileSync(path.join(project, relativePath), 'utf8');
}

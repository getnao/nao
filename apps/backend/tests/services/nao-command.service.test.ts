import dns from 'node:dns/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boxlite = vi.hoisted(() => ({ create: vi.fn() }));
const testEnv = vi.hoisted(() => ({
	APP_COMMIT: 'abc1234',
	NAO_MODE: 'cloud',
	NAO_SYNC_MAX_RUNTIME_HOURS: 24,
	NAO_SYNC_MAX_FILE_SIZE_MB: 500,
	NAO_SYNC_MAX_OUTPUT_SIZE_GB: 8,
	NAO_SYNC_MAX_OUTPUT_FILES: 20_000,
	NAO_SYNC_APPROVED_PRIVATE_WAREHOUSE_HOSTS: {} as Record<string, string[]>,
}));

vi.mock('../../src/env', () => ({ env: testEnv }));
vi.mock('../../src/utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../../src/services/sandbox-runtime', () => ({
	sandboxRuntime: { JsBoxlite: { withDefaultConfig: () => ({ create: boxlite.create }) } },
}));

import {
	NaoCommandExitError,
	NaoCommandOutputLimitError,
	NaoCommandTimeoutError,
	runNaoCommandInSandbox,
} from '../../src/services/nao-command.service';

let root: string;
let project: string;

beforeEach(() => {
	vi.clearAllMocks();
	testEnv.NAO_SYNC_MAX_RUNTIME_HOURS = 24;
	testEnv.NAO_SYNC_MAX_FILE_SIZE_MB = 500;
	testEnv.NAO_SYNC_MAX_OUTPUT_SIZE_GB = 8;
	testEnv.NAO_SYNC_MAX_OUTPUT_FILES = 20_000;
	testEnv.NAO_SYNC_APPROVED_PRIVATE_WAREHOUSE_HOSTS = {};
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-command-test-'));
	project = path.join(root, 'project');
	writeFiles(project, {
		'nao_config.yaml': 'project_name: sales\n',
		'RULES.md': 'old rules\n',
		'old.md': 'removed by sync\n',
		'databases/stale/columns.md': 'removed by sync\n',
		'repos/source/docs': 'docs used to be a file\n',
		'repos/source/readme/intro.md': 'readme used to be a folder\n',
		'reports/summary.md.j2': 'Summary for {{ nao.project.name }}\n',
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
		const box = useFakeBox({
			stdout: ['\u001b[32mSyncing\u001b[0m\r', 'Done\n'],
			run: (staged) => expect(fs.existsSync(path.join(staged, 'nao_config.yaml'))).toBe(true),
		});
		const onOutput = vi.fn(async (_output: string) => undefined);
		fs.writeFileSync(
			path.join(project, 'nao_config.yaml'),
			"project_name: sales\ndatabases:\n  - name: warehouse\n    type: postgres\n    host: {{ env('POSTGRES_HOST') }}\n",
		);
		testEnv.NAO_SYNC_APPROVED_PRIVATE_WAREHOUSE_HOSTS = { 'project-1': ['10.20.30.40'] };

		await runNaoCommandInSandbox(
			['sync'],
			project,
			{ POSTGRES_HOST: '10.20.30.40', POSTGRES_PASSWORD: 'secret' },
			onOutput,
			undefined,
			'project-1',
		);

		expect(boxlite.create).toHaveBeenCalledWith(
			expect.objectContaining({
				image: 'getnao/nao:abc1234',
				diskSizeGb: 8,
				workingDir: '/',
				autoStop: 0,
				security: { jailerEnabled: true, maxFileSize: 500 * 1024 * 1024 },
				network: {
					outbound: { mode: 'enabled', allowNet: ['10.20.30.40'] },
					inbound: { mode: 'disabled' },
				},
			}),
		);
		expect(boxlite.create.mock.calls[0][0]).not.toHaveProperty('volumes');
		expect(box.copyIn).toHaveBeenCalledWith(expect.any(String), '/project', {
			recursive: true,
			overwrite: true,
			followSymlinks: false,
			includeParent: false,
		});
		expect(box.copyOut).toHaveBeenCalledWith('/project', expect.any(String), {
			recursive: true,
			overwrite: true,
			followSymlinks: false,
			includeParent: false,
		});
		expect(box.exec).toHaveBeenCalledWith(
			'nao',
			['sync'],
			[
				['POSTGRES_HOST', '10.20.30.40'],
				['POSTGRES_PASSWORD', 'secret'],
				['POSTHOG_DISABLED', 'true'],
			],
			false,
			null,
			null,
			'/project',
		);
		const output = vi.mocked(onOutput).mock.calls.at(-1)?.[0];
		expect(output).toContain('Checking sync connections.');
		expect(output).toContain('Preparing the secure sync environment. The first run may take a few minutes.');
		expect(output).toContain('Copying the project into the secure sync environment.');
		expect(output).toContain('Starting nao sync...');
		expect(output).toContain('Syncing\nDone\n');
		await vi.waitFor(() => expect(fs.existsSync(box.mountPath())).toBe(false));
	});

	it('pins validated hostnames to IP-only egress rules before running nao', async () => {
		const lookup = vi.spyOn(dns, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
		fs.writeFileSync(
			path.join(project, 'nao_config.yaml'),
			[
				'project_name: sales',
				'databases:',
				'  - name: warehouse',
				'    type: postgres',
				'    host: warehouse.example.com',
				'',
			].join('\n'),
		);
		const box = useFakeBox({});

		try {
			await runNaoCommandInSandbox(['sync'], project, {});
		} finally {
			lookup.mockRestore();
		}

		expect(boxlite.create).toHaveBeenCalledWith(
			expect.objectContaining({
				network: {
					outbound: { mode: 'enabled', allowNet: ['93.184.216.34'] },
					inbound: { mode: 'disabled' },
				},
			}),
		);
		expect(box.exec.mock.calls[0]?.[0]).toBe('sh');
		expect(box.exec.mock.calls[0]?.[1]?.[1]).toContain('93.184.216.34\twarehouse.example.com');
		expect(box.exec.mock.calls[1]?.[0]).toBe('nao');
	});

	it('bounds concurrent project file operations', async () => {
		const copyFile = fs.promises.copyFile.bind(fs.promises);
		let activeCopies = 0;
		let maxActiveCopies = 0;
		const copyFileSpy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (source, destination, mode) => {
			activeCopies++;
			maxActiveCopies = Math.max(maxActiveCopies, activeCopies);
			await new Promise<void>((resolve) => setImmediate(resolve));
			try {
				await copyFile(source, destination, mode);
			} finally {
				activeCopies--;
			}
		});
		useFakeBox({});

		try {
			await runNaoCommandInSandbox(['sync'], project, {});
		} finally {
			copyFileSpy.mockRestore();
		}

		expect(maxActiveCopies).toBeGreaterThan(1);
		expect(maxActiveCopies).toBeLessThanOrEqual(16);
	});

	it('stops a cloud sync at the emergency runtime ceiling and brings nothing back', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		testEnv.NAO_SYNC_MAX_RUNTIME_HOURS = 1 / 3600;
		const box = useFakeBox({
			runsUntilKilled: true,
			run: (staged) => writeFiles(staged, { 'databases/timed-out.md': 'partial\n' }),
		});

		const result = runNaoCommandInSandbox(['sync'], project, {});
		await vi.waitFor(() => expect(box.exec).toHaveBeenCalled());
		const timedOut = expect(result).rejects.toThrow(NaoCommandTimeoutError);
		await vi.advanceTimersByTimeAsync(1000);

		await timedOut;
		expect(box.execution.kill).toHaveBeenCalled();
		expect(fs.existsSync(path.join(project, 'databases', 'timed-out.md'))).toBe(false);
		await vi.waitFor(() => expect(fs.existsSync(box.mountPath())).toBe(false));
	});

	it('brings back only expected sync and existing-template outputs', async () => {
		let stagedEntries: string[] = [];
		useFakeBox({
			run: (staged) => {
				stagedEntries = fs.readdirSync(staged, { recursive: true }).map(String);
				fs.writeFileSync(path.join(staged, 'RULES.md'), 'new rules\n');
				fs.rmSync(path.join(staged, 'old.md'));
				fs.rmSync(path.join(staged, 'databases', 'stale'), { recursive: true });
				fs.rmSync(path.join(staged, 'repos', 'source', 'docs'));
				fs.rmSync(path.join(staged, 'repos', 'source', 'readme'), { recursive: true });
				writeFiles(staged, {
					'databases/orders/columns.md': 'synced\n',
					'repos/source/docs/page.md': 'docs is now a folder\n',
					'repos/source/readme': 'readme is now a file\n',
					'semantics/metrics/orders.md': 'metric\n',
					'docs/notion/page.md': 'notion\n',
					'docs/confluence/page.md': 'confluence\n',
					'docs/obsidian/page.md': 'obsidian\n',
					'reports/summary.md.j2': 'modified template\n',
					'reports/summary.md': 'rendered summary\n',
					'reports/untrusted.md.j2': 'untrusted template\n',
					'reports/untrusted.md': 'untrusted output\n',
					'docs/other/page.md': 'not a sync output\n',
					'outside-output.md': 'not a sync output\n',
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
		expect(read('RULES.md')).toBe('old rules\n');
		expect(read('databases/orders/columns.md')).toBe('synced\n');
		expect(read('old.md')).toBe('removed by sync\n');
		expect(fs.existsSync(path.join(project, 'databases', 'stale'))).toBe(false);
		expect(read('repos/source/docs/page.md')).toBe('docs is now a folder\n');
		expect(read('repos/source/readme')).toBe('readme is now a file\n');
		expect(read('semantics/metrics/orders.md')).toBe('metric\n');
		expect(read('docs/notion/page.md')).toBe('notion\n');
		expect(read('docs/confluence/page.md')).toBe('confluence\n');
		expect(read('docs/obsidian/page.md')).toBe('obsidian\n');
		expect(read('reports/summary.md')).toBe('rendered summary\n');
		expect(read('reports/summary.md.j2')).toBe('Summary for {{ nao.project.name }}\n');
		expect(fs.existsSync(path.join(project, 'reports', 'untrusted.md.j2'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'reports', 'untrusted.md'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'docs', 'other'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'outside-output.md'))).toBe(false);
		expect(read('.git/config')).toBe('[core]\n');
		expect(fs.existsSync(path.join(project, 'docs', '.git'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'escape.md'))).toBe(false);
		expect(fs.lstatSync(path.join(project, 'linked.md')).isSymbolicLink()).toBe(true);
		expect(fs.readFileSync(path.join(root, 'outside.md'), 'utf8')).toBe('outside\n');
	});

	it('brings back created, updated, and removed configured repository targets', async () => {
		fs.writeFileSync(
			path.join(project, 'nao_config.yaml'),
			[
				'project_name: sales',
				'repos:',
				'  - name: analytics',
				'    url: https://github.com/nao/analytics.git',
				'    targets:',
				'      - source: nao/tests',
				`        target: "tests/{{ env('TEAM') }}"`,
				'',
			].join('\n'),
		);
		writeFiles(project, {
			'tests/analytics/updated.yml': 'old\n',
			'tests/analytics/obsolete/removed.yml': 'remove me\n',
		});
		useFakeBox({
			run: (staged) => {
				fs.writeFileSync(path.join(staged, 'tests/analytics/updated.yml'), 'new\n');
				fs.rmSync(path.join(staged, 'tests/analytics/obsolete'), { recursive: true });
				writeFiles(staged, { 'tests/analytics/created.yml': 'created\n' });
			},
		});

		await runNaoCommandInSandbox(['sync'], project, { TEAM: 'analytics' });

		expect(read('tests/analytics/updated.yml')).toBe('new\n');
		expect(read('tests/analytics/created.yml')).toBe('created\n');
		expect(fs.existsSync(path.join(project, 'tests', 'analytics', 'obsolete'))).toBe(false);
	});

	it('rejects an oversized generated file before copying anything back', async () => {
		testEnv.NAO_SYNC_MAX_FILE_SIZE_MB = 1 / (1024 * 1024);
		useFakeBox({
			run: (staged) => {
				clearSyncOutputs(staged);
				writeFiles(staged, { 'databases/oversized.md': 'xx' });
			},
		});

		const result = runNaoCommandInSandbox(['sync'], project, {});

		await expect(result).rejects.toThrow(NaoCommandOutputLimitError);
		await expect(result).rejects.toThrow('file-size limit');
		expect(fs.existsSync(path.join(project, 'databases', 'oversized.md'))).toBe(false);
		expect(read('databases/stale/columns.md')).toBe('removed by sync\n');
	});

	it('rejects excessive total output before copying anything back', async () => {
		testEnv.NAO_SYNC_MAX_OUTPUT_SIZE_GB = 1 / (1024 * 1024 * 1024);
		useFakeBox({
			run: (staged) => {
				clearSyncOutputs(staged);
				writeFiles(staged, { 'databases/first.md': 'x', 'repos/second.md': 'x' });
			},
		});

		const result = runNaoCommandInSandbox(['sync'], project, {});

		await expect(result).rejects.toThrow(NaoCommandOutputLimitError);
		await expect(result).rejects.toThrow('total-output limit');
		expect(fs.existsSync(path.join(project, 'databases', 'first.md'))).toBe(false);
		expect(read('databases/stale/columns.md')).toBe('removed by sync\n');
	});

	it('rejects excessive output file counts before copying anything back', async () => {
		fs.rmSync(project, { recursive: true });
		writeFiles(project, { 'nao_config.yaml': 'project_name: sales\n' });
		testEnv.NAO_SYNC_MAX_OUTPUT_FILES = 1;
		useFakeBox({
			run: (staged) => {
				clearSyncOutputs(staged);
				writeFiles(staged, { 'databases/first.md': 'x', 'repos/second.md': 'x' });
			},
		});

		const result = runNaoCommandInSandbox(['sync'], project, {});

		await expect(result).rejects.toThrow(NaoCommandOutputLimitError);
		await expect(result).rejects.toThrow('output files');
		expect(fs.existsSync(path.join(project, 'databases', 'first.md'))).toBe(false);
		expect(fs.existsSync(path.join(project, 'repos', 'second.md'))).toBe(false);
	});

	it('rejects excessive project file counts before creating a box', async () => {
		testEnv.NAO_SYNC_MAX_OUTPUT_FILES = 1;

		const result = runNaoCommandInSandbox(['sync'], project, {});

		await expect(result).rejects.toThrow(NaoCommandOutputLimitError);
		await expect(result).rejects.toThrow('Project contains more than 1 files');
		expect(boxlite.create).not.toHaveBeenCalled();
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
	const mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-command-box-'));
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
	const hostMappingExecution = {
		wait: async () => ({ exitCode: 0 }),
	};
	const box = {
		execution,
		mountPath: () => mountPath,
		start: vi.fn(async () => undefined),
		copyIn: vi.fn(async (hostPath: string, _guestPath: string, options?: { includeParent?: boolean }) =>
			copyDirectory(hostPath, mountPath, options?.includeParent),
		),
		copyOut: vi.fn(async (_guestPath: string, hostPath: string, options?: { includeParent?: boolean }) =>
			copyDirectory(mountPath, hostPath, options?.includeParent),
		),
		exec: vi.fn(async (command: string, _args: string[] = []) => {
			if (box.start.mock.calls.length === 0) {
				throw new Error('Cannot exec box: it is configured but not started.');
			}
			if (command === 'nao') {
				run(mountPath);
				return execution;
			}
			return hostMappingExecution;
		}),
		stop: vi.fn(async () => fs.rmSync(mountPath, { recursive: true, force: true })),
	};
	boxlite.create.mockImplementation(async () => box);
	return box;
}

function copyDirectory(source: string, destination: string, includeParent = true): void {
	if (includeParent) {
		fs.cpSync(source, path.join(destination, path.basename(source)), {
			recursive: true,
			dereference: false,
			force: true,
		});
		return;
	}
	copyDirectoryContents(source, destination);
}

function copyDirectoryContents(source: string, destination: string): void {
	for (const entry of fs.readdirSync(source)) {
		fs.cpSync(path.join(source, entry), path.join(destination, entry), {
			recursive: true,
			dereference: false,
			force: true,
		});
	}
}

function clearSyncOutputs(directory: string): void {
	for (const relativePath of ['databases', 'repos', 'semantics', 'docs']) {
		fs.rmSync(path.join(directory, relativePath), { recursive: true, force: true });
	}
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

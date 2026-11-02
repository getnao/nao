import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/env', () => ({ env: { NAO_MODE: 'cloud' } }));
vi.mock('../src/utils/context-repo', () => ({
	getWorktreeProjectRoot: (repo: { worktreeRoot: string }) => repo.worktreeRoot,
}));
vi.mock('../src/queries/activity.queries', () => ({
	startProjectSyncActivity: vi.fn(async () => ({ id: crypto.randomUUID() })),
	completeActivity: vi.fn(),
	failActivity: vi.fn(),
	cancelActivity: vi.fn(),
	getLatestCompletedProjectSync: vi.fn(async () => null),
	getRunningProjectSync: vi.fn(async () => null),
}));
vi.mock('../src/services/context-explorer-git.service', () => ({
	resolveContextExplorerGitSafely: vi.fn(),
}));
vi.mock('../src/services/managed-github-repository', () => ({
	publishManagedGithubRepositoryUpdate: vi.fn(),
	readManagedGithubRepositoryFullName: vi.fn(),
}));
vi.mock('../src/services/project-runtime-env', () => ({
	getProjectRuntimeEnvVars: vi.fn(),
}));
vi.mock('../src/services/nao-command.service', () => ({
	createNaoCommandEnvironment: vi.fn((env) => env),
	NaoCommandExitError: class NaoCommandExitError extends Error {},
	runNaoCommand: vi.fn(),
}));
vi.mock('../src/utils/keyed-lock', () => ({
	withKeyedLock: vi.fn((_key, fn) => fn()),
}));
vi.mock('../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

import type { DBProject } from '../src/db/abstractSchema';
import {
	cancelActivity,
	completeActivity,
	failActivity,
	getLatestCompletedProjectSync,
} from '../src/queries/activity.queries';
import {
	type ContextExplorerGitContext,
	resolveContextExplorerGitSafely,
} from '../src/services/context-explorer-git.service';
import {
	publishManagedGithubRepositoryUpdate,
	readManagedGithubRepositoryFullName,
} from '../src/services/managed-github-repository';
import { NaoCommandExitError, runNaoCommand } from '../src/services/nao-command.service';
import { getProjectRuntimeEnvVars } from '../src/services/project-runtime-env';
import {
	__resetProjectSyncRunsForTesting,
	assertNoProjectSyncRunning,
	assertNoProjectSyncWritingFiles,
	cancelProjectSync,
	getProjectSyncState,
	startProjectSync,
} from '../src/services/project-sync.service';

const project = { id: 'project-1', name: 'Sales', path: '/live/project-1' } as DBProject;

let worktreeRoot: string;

beforeEach(() => {
	vi.clearAllMocks();
	__resetProjectSyncRunsForTesting();
	worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-sync-test-'));
	fs.writeFileSync(path.join(worktreeRoot, 'nao_config.yaml'), 'project_name: edited in the editor\n');
	const resolution = { status: 'available', repo: { worktreeRoot }, context: {} } as never;
	vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue(resolution);
	vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue(null);
	vi.mocked(getProjectRuntimeEnvVars).mockResolvedValue({ POSTGRES_PASSWORD: 'super-secret' });
});

afterEach(() => {
	fs.rmSync(worktreeRoot, { recursive: true, force: true });
});

describe('project sync', () => {
	it("runs nao sync in the user's editor worktree and leaves the results there", async () => {
		vi.mocked(runNaoCommand).mockImplementation(async (_args, cwd, _env, onOutput) => {
			fs.mkdirSync(path.join(cwd, 'databases'));
			fs.writeFileSync(path.join(cwd, 'databases', 'sales.md'), 'synced');
			await onOutput?.('Connecting with super-secret\n');
		});

		const run = await startProjectSync(project, gitContext('user-1'));
		await waitForStatus('user-1', 'succeeded');

		const state = await getProjectSyncState(project, gitContext('user-1'));
		expect(run.status).toBe('queued');
		expect(runNaoCommand).toHaveBeenCalledWith(
			['sync'],
			worktreeRoot,
			{ POSTGRES_PASSWORD: 'super-secret' },
			expect.any(Function),
			expect.any(AbortSignal),
		);
		expect(state.run?.logs).toContain('Connecting with [REDACTED:POSTGRES_PASSWORD]');
		expect(state.run?.logs).toContain('✓ Synced files are ready to review in your changes');
		expect(completeActivity).toHaveBeenCalledWith(run.id, { logs: state.run?.logs });
		expect(failActivity).not.toHaveBeenCalled();
		expect(fs.readFileSync(path.join(worktreeRoot, 'databases', 'sales.md'), 'utf8')).toBe('synced');
		expect((await getProjectSyncState(project, gitContext('user-2'))).run).toBeNull();
	});

	it("blocks the user's Git actions only while their sync is running", async () => {
		let finishSync: () => void = () => undefined;
		vi.mocked(runNaoCommand).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSync = resolve;
				}),
		);

		await startProjectSync(project, gitContext('user-1'));

		expect(() => assertNoProjectSyncRunning(project.id, 'user-1')).toThrow(
			'Wait for the project sync to finish before using Git.',
		);
		expect(() => assertNoProjectSyncRunning(project.id, 'user-2')).not.toThrow();
		await vi.waitFor(() => expect(runNaoCommand).toHaveBeenCalled());
		finishSync();
		await waitForStatus('user-1', 'succeeded');
		expect(() => assertNoProjectSyncRunning(project.id, 'user-1')).not.toThrow();
	});

	it("pauses saves in the syncing user's worktree, and every admin's saves for nao-managed projects", async () => {
		let finishSync: () => void = () => undefined;
		vi.mocked(runNaoCommand).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSync = resolve;
				}),
		);

		await startProjectSync(project, gitContext('user-1'));

		const saveBlockedMessage = 'Wait for the project sync to finish before saving files.';
		expect(() => assertNoProjectSyncWritingFiles(project.id, 'user-1', false)).toThrow(saveBlockedMessage);
		expect(() => assertNoProjectSyncWritingFiles(project.id, 'user-2', false)).not.toThrow();
		expect(() => assertNoProjectSyncWritingFiles(project.id, 'user-2', true)).toThrow(saveBlockedMessage);
		expect(() => assertNoProjectSyncWritingFiles('other-project', 'user-2', true)).not.toThrow();
		await vi.waitFor(() => expect(runNaoCommand).toHaveBeenCalled());
		finishSync();
		await waitForStatus('user-1', 'succeeded');
		expect(() => assertNoProjectSyncWritingFiles(project.id, 'user-2', true)).not.toThrow();
	});

	it('stops a running sync without publishing when the user cancels it', async () => {
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});
		vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue('nao-projects/sales');
		vi.mocked(runNaoCommand).mockImplementation(
			(_args, _cwd, _env, _onOutput, signal) =>
				new Promise<void>((_resolve, reject) => {
					const cancel = () => reject(new Error('nao sync was cancelled.'));
					if (signal?.aborted) {
						cancel();
					}
					signal?.addEventListener('abort', cancel);
				}),
		);
		const managedContext = gitContext('user-1', worktreeRoot);

		const run = await startProjectSync(project, managedContext);
		await vi.waitFor(() => expect(runNaoCommand).toHaveBeenCalled());
		cancelProjectSync(project.id, 'user-1');

		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project, managedContext)).run?.status).toBe('cancelled');
		});
		expect(cancelActivity).toHaveBeenCalledWith(run.id);
		expect(failActivity).not.toHaveBeenCalled();
		expect(publishManagedGithubRepositoryUpdate).not.toHaveBeenCalled();
	});

	it('keeps what synced and fails the run when one source fails, like the CLI', async () => {
		vi.mocked(runNaoCommand).mockImplementation(async (_args, cwd) => {
			fs.writeFileSync(path.join(cwd, 'sales.md'), 'synced');
			throw new NaoCommandExitError('nao sync failed: Failed to sync 1 database: finance');
		});

		const run = await startProjectSync(project, gitContext('user-1'));
		await waitForStatus('user-1', 'failed');

		const state = await getProjectSyncState(project, gitContext('user-1'));
		expect(state.run?.error).toBe('nao sync failed: Failed to sync 1 database: finance');
		expect(failActivity).toHaveBeenCalledWith(run.id, 'nao sync failed: Failed to sync 1 database: finance');
		expect(completeActivity).not.toHaveBeenCalled();
		expect(fs.readFileSync(path.join(worktreeRoot, 'sales.md'), 'utf8')).toBe('synced');
	});

	it('syncs nao-managed projects in the live folder and publishes the results to main', async () => {
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});
		vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue('nao-projects/sales');
		vi.mocked(publishManagedGithubRepositoryUpdate).mockResolvedValue(true);
		vi.mocked(runNaoCommand).mockResolvedValue(undefined);
		const managedContext = gitContext('user-1', worktreeRoot);

		await startProjectSync(project, managedContext);
		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project, managedContext)).run?.status).toBe('succeeded');
		});

		expect(runNaoCommand).toHaveBeenCalledWith(
			['sync'],
			worktreeRoot,
			expect.anything(),
			expect.any(Function),
			expect.any(AbortSignal),
		);
		expect(publishManagedGithubRepositoryUpdate).toHaveBeenCalledWith({
			projectDir: worktreeRoot,
			repoFullName: 'nao-projects/sales',
			paths: ['.'],
			message: 'Sync project',
			author: { name: 'Leo', email: 'leo@example.com' },
		});
		expect((await getProjectSyncState(project, managedContext)).run?.logs).toContain(
			'✓ Synced files were published',
		);
	});

	it("reports the project's last completed sync to every user", async () => {
		const completedAt = new Date('2026-10-30T12:00:00Z');
		vi.mocked(getLatestCompletedProjectSync).mockResolvedValue({ completedAt, actorName: 'Leo' });

		await expect(getProjectSyncState(project, gitContext('user-2'))).resolves.toMatchObject({
			run: null,
			lastSyncedAt: completedAt,
			lastSyncedBy: 'Leo',
		});
		expect(getLatestCompletedProjectSync).toHaveBeenCalledWith(project.id);
	});

	it('is unavailable when the editor has no Git access to the project', async () => {
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});

		await expect(getProjectSyncState(project, gitContext('user-1'))).resolves.toMatchObject({
			available: false,
			unavailableReason: 'Connect a repository first.',
		});
	});

	it('is unavailable when the worktree has no nao_config.yaml', async () => {
		fs.rmSync(path.join(worktreeRoot, 'nao_config.yaml'));

		await expect(getProjectSyncState(project, gitContext('user-1'))).resolves.toMatchObject({
			available: false,
			unavailableReason: 'This project has no nao_config.yaml.',
		});
	});
});

function gitContext(userId: string, projectFolder = project.path!): ContextExplorerGitContext {
	return {
		projectId: project.id,
		projectFolder,
		userId,
		user: { name: 'Leo', email: 'leo@example.com' },
		token: 'github-token',
	};
}

async function waitForStatus(userId: string, status: 'succeeded' | 'failed'): Promise<void> {
	await vi.waitFor(async () => {
		expect((await getProjectSyncState(project, gitContext(userId))).run?.status).toBe(status);
	});
}

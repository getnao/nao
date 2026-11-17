import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sandbox = vi.hoisted(() => ({ isAvailable: true }));
const lockState = vi.hoisted(() => ({ locks: new Map<string, Promise<unknown>>() }));

vi.mock('../../src/env', () => ({ env: { NAO_MODE: 'cloud' } }));
vi.mock('../../src/services/sandbox-runtime', () => ({
	get isSandboxAvailable() {
		return sandbox.isAvailable;
	},
}));
vi.mock('../../src/utils/context-repo', () => ({
	getWorktreeProjectRoot: (repo: { worktreeRoot: string }) => repo.worktreeRoot,
}));
vi.mock('../../src/queries/activity.queries', () => ({
	startProjectSyncActivity: vi.fn(async () => ({ id: crypto.randomUUID() })),
	completeActivity: vi.fn(),
	failActivity: vi.fn(),
	cancelActivity: vi.fn(),
	getLatestCompletedProjectSync: vi.fn(async () => null),
	getRunningProjectSync: vi.fn(async () => null),
	getLatestUserProjectSync: vi.fn(async () => null),
	failInterruptedProjectSyncActivities: vi.fn(),
	SYNC_LEASE_MS: 120_000,
	PROJECT_SYNC_LEASE_KEY_PREFIX: 'project-sync:activity:',
}));
vi.mock('../../src/queries/keyed-lock.queries', () => ({
	tryAcquireLock: vi.fn(async () => true),
	renewLock: vi.fn(async () => true),
	releaseLock: vi.fn(async () => undefined),
}));
vi.mock('../../src/services/context-explorer-git.service', () => ({
	resolveContextExplorerGitSafely: vi.fn(),
}));
vi.mock('../../src/services/managed-github-repository', () => ({
	publishManagedGithubRepositoryUpdate: vi.fn(),
	readManagedGithubRepositoryFullName: vi.fn(),
}));
vi.mock('../../src/services/project-runtime-env', () => ({
	getProjectSyncEnvVars: vi.fn(),
}));
vi.mock('../../src/services/nao-command.service', () => ({
	NaoCommandExitError: class NaoCommandExitError extends Error {},
	runNaoCommandInSandbox: vi.fn(),
}));
vi.mock('../../src/utils/keyed-lock', () => ({
	contextWorktreeLockKey: (projectId: string, userId: string) => `context-worktree-write:${projectId}:${userId}`,
	withKeyedLock: vi.fn((key: string, fn: () => Promise<unknown>) => {
		const previous = lockState.locks.get(key) ?? Promise.resolve();
		const current = previous.catch(() => undefined).then(fn);
		lockState.locks.set(key, current);
		return current.finally(() => {
			if (lockState.locks.get(key) === current) {
				lockState.locks.delete(key);
			}
		});
	}),
}));
vi.mock('../../src/utils/logger', () => ({
	logger: { error: vi.fn() },
}));

import type { DBActivity, DBProject } from '../../src/db/abstractSchema';
import {
	cancelActivity,
	completeActivity,
	failActivity,
	getLatestCompletedProjectSync,
	getLatestUserProjectSync,
	getRunningProjectSync,
	startProjectSyncActivity,
} from '../../src/queries/activity.queries';
import { releaseLock, renewLock, tryAcquireLock } from '../../src/queries/keyed-lock.queries';
import {
	type ContextExplorerGitContext,
	resolveContextExplorerGitSafely,
} from '../../src/services/context-explorer-git.service';
import {
	publishManagedGithubRepositoryUpdate,
	readManagedGithubRepositoryFullName,
} from '../../src/services/managed-github-repository';
import { NaoCommandExitError, runNaoCommandInSandbox } from '../../src/services/nao-command.service';
import { getProjectSyncEnvVars } from '../../src/services/project-runtime-env';
import {
	__resetProjectSyncRunsForTesting,
	assertNoProjectSyncRunning,
	assertNoProjectSyncWritingFiles,
	cancelProjectSync,
	getProjectSyncState,
	startProjectSync,
	withProjectSyncIdleWorktree,
} from '../../src/services/project-sync.service';
import { withKeyedLock } from '../../src/utils/keyed-lock';

const project = { id: 'project-1', name: 'Sales', path: '/live/project-1' } as DBProject;

let worktreeRoot: string;

beforeEach(() => {
	vi.clearAllMocks();
	lockState.locks.clear();
	__resetProjectSyncRunsForTesting();
	worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-sync-test-'));
	fs.writeFileSync(path.join(worktreeRoot, 'nao_config.yaml'), 'project_name: edited in the editor\n');
	const resolution = { status: 'available', repo: { worktreeRoot }, context: {} } as never;
	vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue(resolution);
	vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue(null);
	vi.mocked(getLatestUserProjectSync).mockResolvedValue(null);
	vi.mocked(getRunningProjectSync).mockResolvedValue(null);
	vi.mocked(getProjectSyncEnvVars).mockResolvedValue({ POSTGRES_PASSWORD: 'super-secret' });
});

afterEach(() => {
	vi.useRealTimers();
	fs.rmSync(worktreeRoot, { recursive: true, force: true });
});

describe('project sync', () => {
	it("runs nao sync in the user's editor worktree and leaves the results there", async () => {
		vi.mocked(getProjectSyncEnvVars).mockResolvedValue({
			POSTGRES_PASSWORD: 'super-secret',
			SHORT_SECRET: 'abc',
		});
		vi.mocked(runNaoCommandInSandbox).mockImplementation(async (_args, cwd, _env, onOutput) => {
			fs.mkdirSync(path.join(cwd, 'databases'));
			fs.writeFileSync(path.join(cwd, 'databases', 'sales.md'), 'synced');
			await onOutput?.('Connecting with super-secret and abc\n');
		});

		const run = await startProjectSync(project, gitContext('user-1'));
		await waitForStatus('user-1', 'succeeded');

		const state = await getProjectSyncState(project, gitContext('user-1'));
		expect(run.status).toBe('queued');
		expect(runNaoCommandInSandbox).toHaveBeenCalledWith(
			['sync'],
			worktreeRoot,
			{ POSTGRES_PASSWORD: 'super-secret', SHORT_SECRET: 'abc' },
			expect.any(Function),
			expect.any(AbortSignal),
			project.id,
		);
		expect(getProjectSyncEnvVars).toHaveBeenCalledWith(project, 'user-1', worktreeRoot);
		expect(state.run?.logs).toContain('Connecting with [REDACTED:POSTGRES_PASSWORD]');
		expect(state.run?.logs).toContain('[REDACTED:SHORT_SECRET]');
		expect(state.run?.logs).toContain('✓ Synced files are ready to review in your changes');
		expect(completeActivity).toHaveBeenCalledWith(run.id, { logs: state.run?.logs });
		expect(failActivity).not.toHaveBeenCalled();
		expect(withKeyedLock).toHaveBeenCalledWith('context-worktree-write:project-1:user-1', expect.any(Function));
		expect(fs.readFileSync(path.join(worktreeRoot, 'databases', 'sales.md'), 'utf8')).toBe('synced');
		const [leaseKey, leaseOwner] = vi.mocked(tryAcquireLock).mock.calls[0];
		expect(leaseKey).toBe(`project-sync:activity:${run.id}`);
		await vi.waitFor(() => expect(releaseLock).toHaveBeenCalledWith(leaseKey, leaseOwner));
		expect((await getProjectSyncState(project, gitContext('user-2'))).run).toBeNull();
	});

	it("blocks the user's Git actions only while their sync is running", async () => {
		let finishSync: () => void = () => undefined;
		vi.mocked(runNaoCommandInSandbox).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSync = resolve;
				}),
		);

		await startProjectSync(project, gitContext('user-1'));

		await expect(assertNoProjectSyncRunning(project.id, 'user-1')).rejects.toThrow(
			'Wait for the project sync to finish before using Git.',
		);
		await expect(assertNoProjectSyncRunning(project.id, 'user-2')).resolves.toBeUndefined();
		await vi.waitFor(() => expect(runNaoCommandInSandbox).toHaveBeenCalled());
		finishSync();
		await waitForStatus('user-1', 'succeeded');
		await expect(assertNoProjectSyncRunning(project.id, 'user-1')).resolves.toBeUndefined();
	});

	it('holds the worktree lock until sync finishes before running a Git action', async () => {
		let finishSync: () => void = () => undefined;
		vi.mocked(runNaoCommandInSandbox).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSync = resolve;
				}),
		);
		await startProjectSync(project, gitContext('user-1'));
		await vi.waitFor(() => expect(runNaoCommandInSandbox).toHaveBeenCalled());
		const action = vi.fn(async () => 'switched');
		const result = withProjectSyncIdleWorktree(project.id, 'user-1', action);
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(action).not.toHaveBeenCalled();

		finishSync();

		await expect(result).resolves.toBe('switched');
		expect(action).toHaveBeenCalledOnce();
	});

	it('allows only one active sync per project', async () => {
		vi.mocked(getRunningProjectSync).mockResolvedValue({ actorName: 'Maya' });

		await expect(getProjectSyncState(project, gitContext('user-2'))).resolves.toMatchObject({ syncingBy: 'Maya' });
		await expect(startProjectSync(project, gitContext('user-2'))).rejects.toThrow(
			'Maya is already syncing this project.',
		);

		expect(startProjectSyncActivity).not.toHaveBeenCalled();
		expect(runNaoCommandInSandbox).not.toHaveBeenCalled();
	});

	it("pauses saves in the syncing user's worktree, and every admin's saves for nao-managed projects", async () => {
		let finishSync: () => void = () => undefined;
		vi.mocked(runNaoCommandInSandbox).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSync = resolve;
				}),
		);

		await startProjectSync(project, gitContext('user-1'));

		const saveBlockedMessage = 'Wait for the project sync to finish before saving files.';
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-1', false)).rejects.toThrow(saveBlockedMessage);
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-2', false)).resolves.toBeUndefined();
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-2', true)).rejects.toThrow(saveBlockedMessage);
		await expect(assertNoProjectSyncWritingFiles('other-project', 'user-2', true)).resolves.toBeUndefined();
		await vi.waitFor(() => expect(runNaoCommandInSandbox).toHaveBeenCalled());
		finishSync();
		await waitForStatus('user-1', 'succeeded');
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-2', true)).resolves.toBeUndefined();
	});

	it.each([
		{
			stoppedWhen: 'the user cancels it',
			stop: () => cancelProjectSync(project.id, 'user-1'),
			status: 'cancelled',
			error: undefined,
		},
		{
			stoppedWhen: 'its server can no longer renew its lease',
			stop: async () => {
				vi.mocked(renewLock).mockResolvedValueOnce(false);
				await vi.advanceTimersByTimeAsync(30_000);
			},
			status: 'failed',
			error: 'nao lost contact with its database for too long, so the sync was stopped. Try again.',
		},
	])('stops a running sync without publishing when $stoppedWhen', async ({ stop, status, error }) => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});
		vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue('nao-projects/sales');
		vi.mocked(runNaoCommandInSandbox).mockImplementation(async (_args, _cwd, _env, onOutput, signal) => {
			await onOutput?.('Connecting with super-secret\n');
			return new Promise<void>((_resolve, reject) => {
				const cancel = () => reject(new Error('nao sync was cancelled.'));
				if (signal?.aborted) {
					cancel();
				}
				signal?.addEventListener('abort', cancel);
			});
		});
		const managedContext = gitContext('user-1', worktreeRoot);

		const run = await startProjectSync(project, managedContext);
		await vi.waitFor(() => expect(runNaoCommandInSandbox).toHaveBeenCalled());
		await stop();

		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project, managedContext)).run?.status).toBe(status);
		});
		if (error) {
			expect(failActivity).toHaveBeenCalledWith(run.id, error, {
				logs: 'Connecting with [REDACTED:POSTGRES_PASSWORD]\n',
			});
			expect(cancelActivity).not.toHaveBeenCalled();
		} else {
			expect(cancelActivity).toHaveBeenCalledWith(run.id, {
				logs: 'Connecting with [REDACTED:POSTGRES_PASSWORD]\nSync cancelled\n',
			});
			expect(failActivity).not.toHaveBeenCalled();
		}
		expect(publishManagedGithubRepositoryUpdate).not.toHaveBeenCalled();
	});

	it('keeps what synced and completes with errors when one source fails, like the CLI', async () => {
		vi.mocked(runNaoCommandInSandbox).mockImplementation(async (_args, cwd) => {
			fs.writeFileSync(path.join(cwd, 'sales.md'), 'synced');
			throw new NaoCommandExitError('nao sync failed: Failed to sync 1 database: finance');
		});

		const run = await startProjectSync(project, gitContext('user-1'));
		await waitForStatus('user-1', 'completed_with_errors');

		const state = await getProjectSyncState(project, gitContext('user-1'));
		expect(state.run?.error).toBe('Sync completed with errors. Review the terminal output above for more details.');
		expect(failActivity).toHaveBeenCalledWith(
			run.id,
			'Sync completed with errors. Review the terminal output above for more details.',
			{ logs: state.run?.logs, outcome: 'completed_with_errors' },
		);
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
		vi.mocked(runNaoCommandInSandbox).mockResolvedValue(undefined);
		const managedContext = gitContext('user-1', worktreeRoot);

		await startProjectSync(project, managedContext);
		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project, managedContext)).run?.status).toBe('succeeded');
		});

		expect(runNaoCommandInSandbox).toHaveBeenCalledWith(
			['sync'],
			worktreeRoot,
			expect.anything(),
			expect.any(Function),
			expect.any(AbortSignal),
			project.id,
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

	it('does not publish a nao-managed sync that completed with errors', async () => {
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});
		vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue('nao-projects/sales');
		vi.mocked(runNaoCommandInSandbox).mockRejectedValue(
			new NaoCommandExitError('nao sync failed: Failed to sync 1 database: finance'),
		);
		const managedContext = gitContext('user-1', worktreeRoot);

		await startProjectSync(project, managedContext);
		await waitForStatus('user-1', 'completed_with_errors');

		expect(publishManagedGithubRepositoryUpdate).not.toHaveBeenCalled();
		expect((await getProjectSyncState(project, managedContext)).run).toMatchObject({
			status: 'completed_with_errors',
			error: 'Sync completed with errors. Review the terminal output above for more details.',
			logs: expect.stringContaining('✗ Sync failed'),
		});
	});

	it('holds the save lock from staging a nao-managed sync until it is published', async () => {
		const heldLocks = new Set<string>();
		const isSaveLockHeld = () => [...heldLocks].some((key) => key.startsWith('managed-context-write:'));
		const lockedSteps: string[] = [];
		vi.mocked(withKeyedLock).mockImplementation(async (key, fn) => {
			heldLocks.add(key);
			try {
				return await fn();
			} finally {
				heldLocks.delete(key);
			}
		});
		vi.mocked(resolveContextExplorerGitSafely).mockResolvedValue({
			status: 'unavailable',
			reason: 'no-repo',
			message: 'Connect a repository first.',
			repo: null,
		});
		vi.mocked(readManagedGithubRepositoryFullName).mockResolvedValue('nao-projects/sales');
		vi.mocked(runNaoCommandInSandbox).mockImplementation(async () => {
			lockedSteps.push(`sync:${isSaveLockHeld()}`);
		});
		vi.mocked(publishManagedGithubRepositoryUpdate).mockImplementation(async () => {
			lockedSteps.push(`publish:${isSaveLockHeld()}`);
			return true;
		});
		const managedContext = gitContext('user-1', worktreeRoot);

		await startProjectSync(project, managedContext);
		await vi.waitFor(async () => {
			expect((await getProjectSyncState(project, managedContext)).run?.status).toBe('succeeded');
		});

		expect(lockedSteps).toEqual(['sync:true', 'publish:true']);
		expect(
			vi.mocked(withKeyedLock).mock.calls.filter(([key]) => key.startsWith('managed-context-write:')),
		).toHaveLength(1);
	});

	it('shows, never duplicates, and waits for a sync that the previous deployment is still running', async () => {
		vi.mocked(getLatestUserProjectSync).mockImplementation(async (_projectId, userId) =>
			userId === 'user-1' ? syncActivity({ id: 'old-deployment-run', status: 'running' }) : null,
		);
		vi.mocked(getRunningProjectSync).mockImplementation(async (_projectId, excludedUserId) =>
			excludedUserId === 'user-1' ? null : { actorName: 'Leo' },
		);

		const state = await getProjectSyncState(project, gitContext('user-1'));
		const run = await startProjectSync(project, gitContext('user-1'));

		expect(state.run).toMatchObject({ id: 'old-deployment-run', status: 'running' });
		expect(run.id).toBe('old-deployment-run');
		expect(startProjectSyncActivity).not.toHaveBeenCalled();
		expect(runNaoCommandInSandbox).not.toHaveBeenCalled();
		await expect(cancelProjectSync(project.id, 'user-1')).rejects.toThrow('can only finish');
		await expect(assertNoProjectSyncRunning(project.id, 'user-1')).rejects.toThrow('before using Git');
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-1', false)).rejects.toThrow('before saving');
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-2', false)).resolves.toBeUndefined();
		await expect(assertNoProjectSyncWritingFiles(project.id, 'user-2', true)).rejects.toThrow('before saving');
	});

	it('shows the result once the previous deployment finishes the sync', async () => {
		vi.mocked(getLatestUserProjectSync).mockResolvedValue(
			syncActivity({ id: 'old-deployment-run', status: 'completed', payload: { logs: 'Synced 3 tables\n' } }),
		);

		await expect(getProjectSyncState(project, gitContext('user-1'))).resolves.toMatchObject({
			run: { id: 'old-deployment-run', status: 'succeeded', logs: 'Synced 3 tables\n' },
		});
	});

	it('restores a completed-with-errors outcome from a previous deployment', async () => {
		vi.mocked(getLatestUserProjectSync).mockResolvedValue(
			syncActivity({
				id: 'old-deployment-run',
				status: 'failed',
				payload: { logs: 'Confluence failed\n', outcome: 'completed_with_errors' },
				errorMessage: 'Sync completed with errors. Review the terminal output above for more details.',
			}),
		);

		await expect(getProjectSyncState(project, gitContext('user-1'))).resolves.toMatchObject({
			run: {
				id: 'old-deployment-run',
				status: 'completed_with_errors',
				logs: 'Confluence failed\n',
			},
		});
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

	it('stays off and never runs nao sync on servers without the sandbox', async () => {
		sandbox.isAvailable = false;

		try {
			await expect(getProjectSyncState(project, gitContext('user-1'))).resolves.toMatchObject({
				available: false,
				unavailableReason: 'Project sync is not enabled on this server yet.',
			});
			await expect(startProjectSync(project, gitContext('user-1'))).rejects.toThrow(
				'Project sync is not enabled on this server yet.',
			);
			expect(runNaoCommandInSandbox).not.toHaveBeenCalled();
		} finally {
			sandbox.isAvailable = true;
		}
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

function syncActivity(activity: Pick<DBActivity, 'id' | 'status'> & Partial<DBActivity>): DBActivity {
	return {
		projectId: project.id,
		userId: 'user-1',
		type: 'project.synced',
		trigger: 'manual',
		storyId: null,
		chatId: null,
		sharedStoryId: null,
		sharedChatId: null,
		payload: null,
		errorMessage: null,
		startedAt: new Date(),
		completedAt: null,
		...activity,
	};
}

async function waitForStatus(userId: string, status: 'succeeded' | 'failed' | 'completed_with_errors'): Promise<void> {
	await vi.waitFor(async () => {
		expect((await getProjectSyncState(project, gitContext(userId))).run?.status).toBe(status);
	});
}

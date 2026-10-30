import { TRPCError } from '@trpc/server';

import type { DBProject } from '../db/abstractSchema';
import { env } from '../env';
import { getWorktreeProjectRoot } from '../utils/context-repo';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { canonicalizeWriteRoot } from '../utils/safe-file-write';
import { redactSecretValues } from '../utils/sandbox-secrets';
import { type ContextExplorerGitContext, resolveContextExplorerGitSafely } from './context-explorer-git.service';
import { publishManagedGithubRepositoryUpdate, readManagedGithubRepositoryFullName } from './managed-github-repository';
import { createNaoCommandEnvironment, NaoCommandExitError, runNaoCommand } from './nao-command.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

const SYNC_TIMEOUT_MS = 30 * 60_000;

export type ProjectSyncStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ProjectSyncRun {
	id: string;
	status: ProjectSyncStatus;
	logs: string;
	error: string | null;
	createdAt: Date;
	startedAt: Date | null;
	finishedAt: Date | null;
}

export interface ProjectSyncState {
	available: boolean;
	unavailableReason: string | null;
	run: ProjectSyncRun | null;
}

interface SyncTarget {
	root: string;
	managedRepoFullName: string | null;
}

const runs = new Map<string, ProjectSyncRun>();

export async function getProjectSyncState(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
): Promise<ProjectSyncState> {
	const unavailableReason = await getUnavailableReason(gitContext);
	return {
		available: unavailableReason === null,
		unavailableReason,
		run: runs.get(getRunKey(project.id, gitContext.userId)) ?? null,
	};
}

export async function startProjectSync(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
): Promise<ProjectSyncRun> {
	const runKey = getRunKey(project.id, gitContext.userId);
	return withKeyedLock(`project-sync:start:${runKey}`, async () => {
		const unavailableReason = await getUnavailableReason(gitContext);
		if (unavailableReason) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: unavailableReason });
		}

		const current = runs.get(runKey);
		if (current?.status === 'queued' || current?.status === 'running') {
			return current;
		}

		const run: ProjectSyncRun = {
			id: crypto.randomUUID(),
			status: 'queued',
			logs: '',
			error: null,
			createdAt: new Date(),
			startedAt: null,
			finishedAt: null,
		};
		runs.set(runKey, run);
		setImmediate(() => {
			void runProjectSync(project, gitContext, runKey, run.id).catch((error) => {
				const message = error instanceof Error ? error.message : 'Project sync failed.';
				updateRun(runKey, run.id, {
					status: 'failed',
					error: message,
					finishedAt: new Date(),
				});
				logger.error(`Project sync failed: ${message}`, {
					source: 'system',
					context: { projectId: project.id, runId: run.id },
				});
			});
		});
		return run;
	});
}

async function getUnavailableReason(gitContext: ContextExplorerGitContext): Promise<string | null> {
	const target = await resolveSyncTarget(gitContext);
	return 'unavailableReason' in target ? target.unavailableReason : null;
}

async function resolveSyncTarget(
	gitContext: ContextExplorerGitContext,
): Promise<SyncTarget | { unavailableReason: string }> {
	if (env.NAO_MODE !== 'cloud') {
		return { unavailableReason: 'Project sync in UI is only available in cloud mode.' };
	}
	const git = await resolveContextExplorerGitSafely(gitContext);
	if (git.status === 'available') {
		return { root: getWorktreeProjectRoot(git.repo), managedRepoFullName: null };
	}
	const managedRepoFullName =
		git.reason === 'no-repo' ? await readManagedGithubRepositoryFullName(gitContext.projectFolder) : null;
	return managedRepoFullName
		? { root: gitContext.projectFolder, managedRepoFullName }
		: { unavailableReason: git.message };
}

// ponytail: the editor's Git actions don't take this lock, so switching branches mid-sync mixes outputs; lock on the worktree if that bites.
async function runProjectSync(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
	runKey: string,
	runId: string,
): Promise<void> {
	await withKeyedLock(`project-sync:run:${runKey}`, async () => {
		updateRun(runKey, runId, {
			status: 'running',
			startedAt: new Date(),
		});

		const projectEnvVars = await getProjectRuntimeEnvVars(project.id);
		const redact = (value: string) =>
			redactSecretValues(
				value,
				Object.entries(projectEnvVars)
					.filter(([, secret]) => secret.length >= 4)
					.map(([name, value]) => ({ name, value })),
			);

		try {
			const target = await resolveSyncTarget(gitContext);
			if ('unavailableReason' in target) {
				throw new Error(target.unavailableReason);
			}
			const syncError = await runNaoSync(target.root, projectEnvVars, async (logs) => {
				updateRun(runKey, runId, { logs: redact(logs) });
			});
			if (target.managedRepoFullName) {
				const published = await publishSyncedFiles(target.root, target.managedRepoFullName, gitContext);
				appendRunLog(runKey, runId, published ? '✓ Synced files were published' : '✓ Everything is up to date');
			} else {
				appendRunLog(
					runKey,
					runId,
					syncError
						? 'Files that synced are ready to review in your changes'
						: '✓ Synced files are ready to review in your changes',
				);
			}
			if (syncError) {
				throw syncError;
			}
			updateRun(runKey, runId, {
				status: 'succeeded',
				error: null,
				finishedAt: new Date(),
			});
		} catch (error) {
			const message = redact(error instanceof Error ? error.message : 'Project sync failed.');
			updateRun(runKey, runId, {
				status: 'failed',
				error: message,
				finishedAt: new Date(),
			});
			logger.error(`Project sync failed: ${message}`, {
				source: 'system',
				context: { projectId: project.id, runId },
			});
		}
	});
}

async function runNaoSync(
	projectPath: string,
	projectEnvVars: Record<string, string>,
	onOutput: (logs: string) => Promise<void>,
): Promise<NaoCommandExitError | null> {
	try {
		await runNaoCommand(
			['sync'],
			projectPath,
			createNaoCommandEnvironment(projectEnvVars),
			SYNC_TIMEOUT_MS,
			onOutput,
		);
		return null;
	} catch (error) {
		if (error instanceof NaoCommandExitError) {
			return error;
		}
		throw error;
	}
}

function publishSyncedFiles(
	projectDir: string,
	repoFullName: string,
	gitContext: ContextExplorerGitContext,
): Promise<boolean> {
	return withKeyedLock(`managed-context-write:${canonicalizeWriteRoot(projectDir)}`, () =>
		publishManagedGithubRepositoryUpdate({
			projectDir,
			repoFullName,
			paths: ['.'],
			message: 'Sync project',
			author: gitContext.user,
		}),
	);
}

function getRunKey(projectId: string, userId: string): string {
	return `${projectId}:${userId}`;
}

function appendRunLog(runKey: string, runId: string, message: string): void {
	const current = runs.get(runKey);
	if (!current || current.id !== runId) {
		return;
	}
	const separator = current.logs && !current.logs.endsWith('\n') ? '\n' : '';
	updateRun(runKey, runId, { logs: `${current.logs}${separator}${message}\n` });
}

function updateRun(runKey: string, runId: string, changes: Partial<ProjectSyncRun>): void {
	const current = runs.get(runKey);
	if (!current || current.id !== runId) {
		return;
	}
	runs.set(runKey, { ...current, ...changes });
}

export function __resetProjectSyncRunsForTesting(): void {
	runs.clear();
}

import fs from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';

import type { DBProject } from '../db/abstractSchema';
import { env } from '../env';
import * as activityQueries from '../queries/activity.queries';
import { getWorktreeProjectRoot } from '../utils/context-repo';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { canonicalizeWriteRoot } from '../utils/safe-file-write';
import { redactSecretValues } from '../utils/sandbox-secrets';
import { type ContextExplorerGitContext, resolveContextExplorerGitSafely } from './context-explorer-git.service';
import { publishManagedGithubRepositoryUpdate, readManagedGithubRepositoryFullName } from './managed-github-repository';
import { createNaoCommandEnvironment, NaoCommandExitError, runNaoCommand } from './nao-command.service';
import { getProjectRuntimeEnvVars } from './project-runtime-env';

export type ProjectSyncStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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
	lastSyncedAt: Date | null;
	lastSyncedBy: string | null;
	syncingBy: string | null;
}

interface SyncTarget {
	root: string;
	managedRepoFullName: string | null;
}

const runs = new Map<string, ProjectSyncRun>();
const controllers = new Map<string, AbortController>();

export async function getProjectSyncState(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
): Promise<ProjectSyncState> {
	const target = await resolveSyncTarget(gitContext);
	const unavailableReason = 'unavailableReason' in target ? target.unavailableReason : null;
	const isManaged = 'root' in target && target.managedRepoFullName !== null;
	const [lastSync, otherSync] = await Promise.all([
		activityQueries.getLatestCompletedProjectSync(project.id),
		isManaged ? activityQueries.getRunningProjectSync(project.id, gitContext.userId) : null,
	]);
	return {
		available: unavailableReason === null,
		unavailableReason,
		run: runs.get(getRunKey(project.id, gitContext.userId)) ?? null,
		lastSyncedAt: lastSync?.completedAt ?? null,
		lastSyncedBy: lastSync?.actorName ?? null,
		syncingBy: otherSync ? (otherSync.actorName ?? 'Another admin') : null,
	};
}

export async function startProjectSync(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
): Promise<ProjectSyncRun> {
	const runKey = getRunKey(project.id, gitContext.userId);
	return withKeyedLock(`project-sync:start:${project.id}`, async () => {
		const target = await resolveSyncTarget(gitContext);
		if ('unavailableReason' in target) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: target.unavailableReason });
		}
		const current = runs.get(runKey);
		if (current && isRunActive(current)) {
			return current;
		}
		if (target.managedRepoFullName) {
			const activeSync = await activityQueries.getRunningProjectSync(project.id, gitContext.userId);
			if (activeSync) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `${activeSync.actorName ?? 'Another admin'} is already syncing this project.`,
				});
			}
		}

		const activity = await activityQueries.startProjectSyncActivity(project.id, gitContext.userId);
		const run: ProjectSyncRun = {
			id: activity.id,
			status: 'queued',
			logs: '',
			error: null,
			createdAt: new Date(),
			startedAt: null,
			finishedAt: null,
		};
		runs.set(runKey, run);
		controllers.set(runKey, new AbortController());
		setImmediate(() => {
			void runProjectSync(project, gitContext, runKey, run.id).catch((error) => {
				const message = error instanceof Error ? error.message : 'Project sync failed.';
				void activityQueries.failActivity(run.id, message);
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

export function cancelProjectSync(projectId: string, userId: string): void {
	controllers.get(getRunKey(projectId, userId))?.abort();
}

/** Sync writes into the user's worktree, so Git actions there wait until it finishes. */
export function assertNoProjectSyncRunning(projectId: string, userId: string): void {
	if (isUserSyncActive(projectId, userId)) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the project sync to finish before using Git.' });
	}
}

/** nao-managed syncs write the shared live folder, so they pause every admin's saves, not just their own. */
export function assertNoProjectSyncWritingFiles(projectId: string, userId: string, isManaged: boolean): void {
	const isSyncWriting = isManaged
		? [...runs].some(([runKey, run]) => runKey.startsWith(`${projectId}:`) && isRunActive(run))
		: isUserSyncActive(projectId, userId);
	if (isSyncWriting) {
		throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the project sync to finish before saving files.' });
	}
}

async function resolveSyncTarget(
	gitContext: ContextExplorerGitContext,
): Promise<SyncTarget | { unavailableReason: string }> {
	if (env.NAO_MODE !== 'cloud') {
		return { unavailableReason: 'Project sync in UI is only available in cloud mode.' };
	}
	const target = await resolveSyncRoot(gitContext);
	if ('root' in target && !fs.existsSync(path.join(target.root, 'nao_config.yaml'))) {
		return { unavailableReason: 'This project has no nao_config.yaml.' };
	}
	return target;
}

async function resolveSyncRoot(
	gitContext: ContextExplorerGitContext,
): Promise<SyncTarget | { unavailableReason: string }> {
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

async function runProjectSync(
	project: DBProject,
	gitContext: ContextExplorerGitContext,
	runKey: string,
	runId: string,
): Promise<void> {
	const signal = controllers.get(runKey)?.signal;
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
			signal?.throwIfAborted();
			const target = await resolveSyncTarget(gitContext);
			if ('unavailableReason' in target) {
				throw new Error(target.unavailableReason);
			}
			const syncError = await runNaoSync(
				target.root,
				projectEnvVars,
				async (logs) => {
					updateRun(runKey, runId, { logs: redact(logs) });
				},
				signal,
			);
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
			await activityQueries.completeActivity(runId, { logs: runs.get(runKey)?.logs ?? '' });
			updateRun(runKey, runId, {
				status: 'succeeded',
				error: null,
				finishedAt: new Date(),
			});
		} catch (error) {
			if (signal?.aborted) {
				await activityQueries.cancelActivity(runId);
				appendRunLog(runKey, runId, 'Sync cancelled');
				updateRun(runKey, runId, { status: 'cancelled', finishedAt: new Date() });
				return;
			}
			const message = redact(error instanceof Error ? error.message : 'Project sync failed.');
			await activityQueries.failActivity(runId, message);
			updateRun(runKey, runId, {
				status: 'failed',
				error: message,
				finishedAt: new Date(),
			});
			logger.error(`Project sync failed: ${message}`, {
				source: 'system',
				context: { projectId: project.id, runId },
			});
		} finally {
			controllers.delete(runKey);
		}
	});
}

async function runNaoSync(
	projectPath: string,
	projectEnvVars: Record<string, string>,
	onOutput: (logs: string) => Promise<void>,
	signal?: AbortSignal,
): Promise<NaoCommandExitError | null> {
	try {
		await runNaoCommand(['sync'], projectPath, createNaoCommandEnvironment(projectEnvVars), onOutput, signal);
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

function isRunActive(run: ProjectSyncRun): boolean {
	return run.status === 'queued' || run.status === 'running';
}

function isUserSyncActive(projectId: string, userId: string): boolean {
	const run = runs.get(getRunKey(projectId, userId));
	return run !== undefined && isRunActive(run);
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
	controllers.clear();
}

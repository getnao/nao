import fs from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';

import type { DBProject } from '../db/abstractSchema';
import * as projectQueries from '../queries/project.queries';
import { withKeyedLock } from '../utils/keyed-lock';
import { logger } from '../utils/logger';
import { redactSecretValues } from '../utils/sandbox-secrets';
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

const runs = new Map<string, ProjectSyncRun>();

export async function getProjectSyncState(project: DBProject): Promise<ProjectSyncState> {
	const unavailableReason = await getUnavailableReason(project);
	return {
		available: unavailableReason === null,
		unavailableReason,
		run: runs.get(project.id) ?? null,
	};
}

export async function startProjectSync(project: DBProject): Promise<ProjectSyncRun> {
	return withKeyedLock(`project-sync:start:${project.id}`, async () => {
		const unavailableReason = await getUnavailableReason(project);
		if (unavailableReason) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: unavailableReason });
		}

		const current = runs.get(project.id);
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
		runs.set(project.id, run);
		setImmediate(() => {
			void runProjectSync(project, run.id).catch((error) => {
				const message = error instanceof Error ? error.message : 'Project sync failed.';
				updateRun(project.id, run.id, {
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

async function getUnavailableReason(project: DBProject): Promise<string | null> {
	if (!project.path || !fs.existsSync(project.path)) {
		return 'Project files are unavailable.';
	}

	if (!fs.existsSync(path.join(project.path, 'nao_config.yaml'))) {
		return 'This project has no nao_config.yaml.';
	}
	// if (!(await warehouseCredentialQueries.getProjectWarehouseCredentials(project.id))) {
	// 	return 'Database sync is only available for projects created with Connect my data.';
	// }
	//this is because i wanted to try it only with connected database first
	return null;
}

async function runProjectSync(project: DBProject, runId: string): Promise<void> {
	await withKeyedLock(`project-sync:run:${project.id}`, async () => {
		updateRun(project.id, runId, {
			status: 'running',
			startedAt: new Date(),
		});

		const projectPath = project.path!;
		const projectEnvVars = await getProjectRuntimeEnvVars(project.id);
		const redact = (value: string) =>
			redactSecretValues(
				value,
				Object.entries(projectEnvVars)
					.filter(([, secret]) => secret.length >= 4)
					.map(([name, value]) => ({ name, value })),
			);
		const stagingPath = fs.mkdtempSync(path.join(path.dirname(projectPath), '.project-sync-'));

		try {
			fs.cpSync(projectPath, stagingPath, { recursive: true });
			const syncError = await runDatabaseSync(stagingPath, projectEnvVars, async (logs) => {
				updateRun(project.id, runId, { logs: redact(logs) });
			});
			// await publishDatabaseContext(stagingPath, projectPath, async () => {
			// 	appendRunLog(project.id, runId, 'Publishing synced context...');
			// 	const result = await publishManagedGithubRepositoryUpdate({
			// 		projectId: project.id,
			// 		projectName: project.name,
			// 		projectDir: projectPath,
			// 		paths: ['databases'],
			// 		message: 'Sync database context',
			// 	});
			// 	if (!result) {
			// 		appendRunLog(project.id, runId, '✓ Updated local context');
			// 	} else if (result.published) {
			// 		appendRunLog(project.id, runId, '✓ Published synced context');
			// 	} else {
			// 		appendRunLog(project.id, runId, '✓ Synced context is already up to date');
			// 	}
			// });
			if (!syncError || fs.existsSync(path.join(stagingPath, 'databases'))) {
				await publishDatabaseContext(stagingPath, projectPath, async () => {
					appendRunLog(
						project.id,
						runId,
						syncError ? 'Updated the databases that synced successfully' : '✓ Updated your project context',
					);
				});
				await projectQueries.touchProjectUpdatedAt(project.id);
			}
			if (syncError) {
				throw syncError;
			}
			updateRun(project.id, runId, {
				status: 'succeeded',
				error: null,
				finishedAt: new Date(),
			});
		} catch (error) {
			const message = redact(error instanceof Error ? error.message : 'Project sync failed.');
			updateRun(project.id, runId, {
				status: 'failed',
				error: message,
				finishedAt: new Date(),
			});
			logger.error(`Project sync failed: ${message}`, {
				source: 'system',
				context: { projectId: project.id, runId },
			});
		} finally {
			fs.rmSync(stagingPath, { recursive: true, force: true });
		}
	});
}

async function runDatabaseSync(
	stagingPath: string,
	projectEnvVars: Record<string, string>,
	onOutput: (logs: string) => Promise<void>,
): Promise<NaoCommandExitError | null> {
	try {
		await runNaoCommand(
			['sync', '--provider', 'databases', '--no-render-templates'],
			stagingPath,
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

async function publishDatabaseContext(
	stagingProjectPath: string,
	projectPath: string,
	publish: () => Promise<void>,
): Promise<void> {
	const stagedDatabasesPath = path.join(stagingProjectPath, 'databases');
	if (!fs.existsSync(stagedDatabasesPath)) {
		throw new Error('nao sync completed without generating database context.');
	}

	const databasesPath = path.join(projectPath, 'databases');
	const backupPath = path.join(projectPath, `.databases-sync-backup-${crypto.randomUUID()}`);
	const hasExistingContext = fs.existsSync(databasesPath);
	if (hasExistingContext) {
		fs.renameSync(databasesPath, backupPath);
	}
	try {
		fs.renameSync(stagedDatabasesPath, databasesPath);
		await publish();
	} catch (error) {
		fs.rmSync(databasesPath, { recursive: true, force: true });
		if (hasExistingContext) {
			fs.renameSync(backupPath, databasesPath);
		}
		throw error;
	}
	fs.rmSync(backupPath, { recursive: true, force: true });
}

function appendRunLog(projectId: string, runId: string, message: string): void {
	const current = runs.get(projectId);
	if (!current || current.id !== runId) {
		return;
	}
	const separator = current.logs && !current.logs.endsWith('\n') ? '\n' : '';
	updateRun(projectId, runId, { logs: `${current.logs}${separator}${message}\n` });
}

function updateRun(projectId: string, runId: string, changes: Partial<ProjectSyncRun>): void {
	const current = runs.get(projectId);
	if (!current || current.id !== runId) {
		return;
	}
	runs.set(projectId, { ...current, ...changes });
}

export function __resetProjectSyncRunsForTesting(): void {
	runs.clear();
}

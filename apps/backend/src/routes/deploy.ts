import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';

import type { App } from '../app';
import { env } from '../env';
import { ensureContextRecommendationsScheduleForNewProject } from '../handlers/context-recommendations.handler';
import * as activityQueries from '../queries/activity.queries';
import * as projectQueries from '../queries/project.queries';
import { validateApiKey } from '../services/api-key.service';
import { createProject, recordProjectDeployment } from '../services/project.service';
import { parseUserGroupsConfig } from '../services/user-group-config.service';
import { diffUserGroupsConfig, type UserGroupConfigDiff } from '../services/user-group-config-diff.service';
import { exportUserGroupsConfig } from '../services/user-group-config-export.service';
import {
	reconcileUserGroupsConfigWithinLock,
	recordUserGroupConfigFailure,
	withUserGroupConfigLock,
} from '../services/user-group-config-reconciliation.service';
import { readUserGroupsConfig, validateUserGroupsConfig } from '../services/user-group-config-validation.service';
import { logger, serializeError } from '../utils/logger';

export const deployRoutes = async (app: App) => {
	await recoverInterruptedDeploys();
	app.post('/deploy', async (request, reply) => {
		const authHeader = request.headers.authorization;
		if (!authHeader?.startsWith('Bearer ')) {
			return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
		}

		const apiKey = await validateApiKey(authHeader.slice(7));
		if (!apiKey) {
			return reply.status(401).send({ error: 'Invalid API key' });
		}
		request.actorUserId = apiKey.createdBy;
		const org = apiKey.organization;
		const dryRun = new URL(request.url, 'http://localhost').searchParams.get('dryRun') === 'true';

		const file = await request.file();
		if (!file) {
			return reply.status(400).send({ error: 'No file uploaded. Send a tar.gz as multipart field "context".' });
		}

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nao-deploy-'));
		const tarPath = path.join(tmpDir, 'context.tar.gz');

		try {
			const chunks: Buffer[] = [];
			for await (const chunk of file.file) {
				chunks.push(chunk);
			}
			fs.writeFileSync(tarPath, Buffer.concat(chunks));

			const extractDir = path.join(tmpDir, 'extracted');
			fs.mkdirSync(extractDir, { recursive: true });
			execFileSync('tar', ['xzf', tarPath, '-C', extractDir], { timeout: 30_000 });

			const rejection = findArchiveRejection(extractDir);
			if (rejection) {
				return reply.status(400).send({ error: rejection });
			}

			const configPath = path.join(extractDir, 'nao_config.yaml');
			if (!fs.existsSync(configPath)) {
				return reply.status(400).send({ error: 'nao_config.yaml not found in uploaded archive' });
			}

			const configContent = fs.readFileSync(configPath, 'utf-8');
			const config = yaml.load(configContent) as { project_name?: string };
			const projectName = config?.project_name;
			if (!projectName) {
				return reply.status(400).send({ error: 'project_name not found in nao_config.yaml' });
			}

			const existing = await projectQueries.getProjectByOrgAndName(org.id, projectName);
			let projectId: string;
			let status: 'created' | 'updated';

			if (existing) {
				projectId = existing.id;
				status = 'updated';
				const projectPath = existing.path;
				if (!projectPath) {
					throw new DeployError(400, 'The target project has no deployment path.');
				}
				const evaluatesGroups = dryRun || existing.userGroupManagementMode === 'code';
				if (evaluatesGroups) {
					const role = await projectQueries.getUserRoleInProject(projectId, apiKey.createdBy);
					if (role !== 'admin') {
						throw new DeployError(
							403,
							'The API key creator must still be a project admin to deploy code-managed user groups.',
						);
					}
					const result = await withUserGroupConfigLock(projectId, async () => {
						let config;
						try {
							config = readUserGroupsConfig(extractDir);
							const currentConfig =
								existing.userGroupManagementMode === 'code'
									? parseUserGroupsConfig(await exportUserGroupsConfig(projectId))
									: undefined;
							await validateUserGroupsConfig(projectId, extractDir, config, currentConfig);
						} catch (error) {
							if (!dryRun && existing.userGroupManagementMode === 'code') {
								await recordUserGroupConfigFailure(
									projectId,
									apiKey.createdBy,
									'apply',
									config?.hash ?? null,
									error,
								);
							}
							throw error;
						}
						if (dryRun) {
							return { diff: await diffUserGroupsConfig(projectId, config), applied: false };
						}
						let diff: UserGroupConfigDiff | undefined;
						await replaceProjectDirectory(
							projectId,
							extractDir,
							projectPath,
							async () => {
								diff = await reconcileUserGroupsConfigWithinLock(projectId, config, apiKey.createdBy);
								try {
									await recordProjectDeployment(projectId);
								} catch (error) {
									logger.warn(
										'User groups were applied but the deployment timestamp was not updated.',
										{
											source: 'system',
											projectId,
											context: serializeError(error),
										},
									);
								}
							},
							config.hash,
						);
						if (!diff) {
							throw new Error('User group reconciliation did not return a result.');
						}
						return { diff, applied: true };
					});
					return reply.send({
						projectId,
						projectName,
						status: result.applied ? status : 'dry-run',
						userGroups: result.diff,
					});
				}
				await withUserGroupConfigLock(projectId, () =>
					replaceProjectDirectory(projectId, extractDir, projectPath, () =>
						recordProjectDeployment(projectId),
					),
				);
			} else {
				if (dryRun) {
					throw new DeployError(400, 'Dry run requires an existing target project.');
				}
				const projectId_ = crypto.randomUUID();
				const projectDir = path.resolve(env.NAO_PROJECTS_DIR, projectId_);
				fs.mkdirSync(projectDir, { recursive: true });
				copyDirectoryContents(extractDir, projectDir);

				const project = await createProject({
					name: projectName,
					type: 'local',
					path: projectDir,
					orgId: org.id,
					deployedAt: new Date(),
				});
				projectId = project.id;
				status = 'created';

				await ensureContextRecommendationsScheduleForNewProject(projectId);
			}

			return reply.send({ projectId, projectName, status });
		} catch (error) {
			const statusCode = error instanceof DeployError ? error.statusCode : 400;
			const message = error instanceof Error ? error.message : String(error);
			return reply.status(statusCode).send({ error: message });
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
};

async function recoverInterruptedDeploys(): Promise<void> {
	for (const project of await projectQueries.listProjectDeploymentPaths()) {
		const parent = path.dirname(project.path);
		const backup = path.join(parent, `.${project.id}.deploy-backup`);
		const next = path.join(parent, `.${project.id}.deploy-next`);
		const marker = path.join(parent, `.${project.id}.deploy-recovery.json`);
		if (![backup, next, marker].some((candidate) => fs.existsSync(candidate))) {
			continue;
		}
		await withUserGroupConfigLock(project.id, () =>
			recoverInterruptedDeploy(project.id, project.path, backup, next, marker),
		);
	}
}

class DeployError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
	}
}

async function replaceProjectDirectory(
	projectId: string,
	source: string,
	target: string,
	afterSwap: () => Promise<void>,
	userGroupConfigHash?: string,
): Promise<void> {
	const parent = path.dirname(target);
	const backup = path.join(parent, `.${projectId}.deploy-backup`);
	const next = path.join(parent, `.${projectId}.deploy-next`);
	const marker = path.join(parent, `.${projectId}.deploy-recovery.json`);
	await recoverInterruptedDeploy(projectId, target, backup, next, marker);
	fs.mkdirSync(next, { recursive: true });
	copyDirectoryContents(source, next);
	const hadPrevious = fs.existsSync(target);
	fs.writeFileSync(
		marker,
		JSON.stringify({ phase: 'prepared', target, backup, next, userGroupConfigHash, hadPrevious }),
	);
	if (hadPrevious) {
		fs.renameSync(target, backup);
	}
	try {
		fs.renameSync(next, target);
		fs.writeFileSync(
			marker,
			JSON.stringify({ phase: 'swapped', target, backup, next, userGroupConfigHash, hadPrevious }),
		);
		await afterSwap();
	} catch (error) {
		fs.rmSync(target, { recursive: true, force: true });
		if (hadPrevious && fs.existsSync(backup)) {
			fs.renameSync(backup, target);
		}
		fs.rmSync(next, { recursive: true, force: true });
		fs.rmSync(marker, { force: true });
		throw error;
	}
	try {
		fs.writeFileSync(marker, JSON.stringify({ phase: 'committed', target, backup, next }));
	} catch {
		fs.rmSync(marker, { force: true });
	}
	if (hadPrevious) {
		fs.rmSync(backup, { recursive: true, force: true });
	}
	fs.rmSync(marker, { force: true });
}

async function recoverInterruptedDeploy(
	projectId: string,
	target: string,
	backup: string,
	next: string,
	marker: string,
): Promise<void> {
	if (!fs.existsSync(marker)) {
		if (!fs.existsSync(target) && fs.existsSync(backup)) {
			fs.renameSync(backup, target);
		} else if (fs.existsSync(target)) {
			fs.rmSync(backup, { recursive: true, force: true });
		}
		fs.rmSync(next, { recursive: true, force: true });
		return;
	}
	const recovery = JSON.parse(fs.readFileSync(marker, 'utf8')) as {
		phase?: string;
		userGroupConfigHash?: string;
		hadPrevious?: boolean;
	};
	const groupsCommitted =
		recovery.userGroupConfigHash !== undefined &&
		(await activityQueries.hasCompletedUserGroupConfigHash(projectId, recovery.userGroupConfigHash));
	if (recovery.phase === 'committed' || groupsCommitted) {
		fs.rmSync(backup, { recursive: true, force: true });
		fs.rmSync(next, { recursive: true, force: true });
		fs.rmSync(marker, { force: true });
		return;
	}
	if (fs.existsSync(backup)) {
		fs.rmSync(target, { recursive: true, force: true });
		fs.renameSync(backup, target);
	} else if (recovery.hadPrevious === false) {
		fs.rmSync(target, { recursive: true, force: true });
	}
	fs.rmSync(next, { recursive: true, force: true });
	fs.rmSync(marker, { force: true });
}

/**
 * Why the archive cannot become a project folder, if it cannot. Git metadata is refused because the
 * server runs git in project folders, and a repository's own config and hooks can make git run commands.
 */
function findArchiveRejection(root: string, relativeDir = ''): string | null {
	const entries = fs.readdirSync(path.join(root, relativeDir), { withFileTypes: true });
	if (isGitDirectoryLayout(entries)) {
		return `Archive folder "${relativeDir || '.'}" is laid out as a Git repository. Git metadata is not allowed.`;
	}

	for (const entry of entries) {
		const relativePath = path.join(relativeDir, entry.name);
		if (isGitMetadataName(entry.name)) {
			return `Archive entry "${relativePath}" is Git metadata, which is not allowed. Deploy the project files without it.`;
		}
		if (entry.isDirectory()) {
			const nested = findArchiveRejection(root, relativePath);
			if (nested) {
				return nested;
			}
		} else if (!entry.isFile()) {
			return `Archive entry "${relativePath}" is not a regular file or directory. Symlinks and special files are not allowed.`;
		}
	}
	return null;
}

function isGitMetadataName(name: string): boolean {
	return name.toLowerCase() === '.git';
}

/** Git also treats a folder as a repository, whatever its name, when it holds what a `.git` folder holds. */
function isGitDirectoryLayout(entries: fs.Dirent[]): boolean {
	const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
	return names.has('head') && (names.has('commondir') || (names.has('objects') && names.has('refs')));
}

function copyDirectoryContents(src: string, dest: string): void {
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			fs.mkdirSync(destPath, { recursive: true });
			copyDirectoryContents(srcPath, destPath);
		} else if (entry.isFile()) {
			fs.copyFileSync(srcPath, destPath);
		} else {
			throw new Error(`Refusing to copy non-regular file: ${srcPath}`);
		}
	}
}

import fs from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import yaml from 'js-yaml';

import type { DBProject } from '../db/abstractSchema';
import { env } from '../env';
import { ensureContextRecommendationsScheduleForNewProject } from '../handlers/context-recommendations.handler';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';

export function createTempProjectDir(prefix: string): string {
	const dir = path.resolve(env.NAO_PROJECTS_DIR, `.${prefix}-${crypto.randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function replaceProjectDirectory(src: string, dest: string): void {
	const parentDir = path.dirname(dest);
	const backupDir = path.join(parentDir, `.project-import-backup-${crypto.randomUUID()}`);
	let hasBackup = false;

	fs.mkdirSync(parentDir, { recursive: true });
	if (fs.existsSync(dest)) {
		fs.renameSync(dest, backupDir);
		hasBackup = true;
	}

	try {
		fs.cpSync(src, dest, { recursive: true });
		if (hasBackup) {
			fs.rmSync(backupDir, { recursive: true, force: true });
		}
	} catch (err) {
		fs.rmSync(dest, { recursive: true, force: true });
		if (hasBackup) {
			fs.renameSync(backupDir, dest);
		}
		throw err;
	}
}

export function readProjectNameFromConfig(projectDir: string): string | null {
	const configPath = path.join(projectDir, 'nao_config.yaml');
	if (!fs.existsSync(configPath)) {
		return null;
	}

	try {
		const config = yaml.load(fs.readFileSync(configPath, 'utf-8')) as { project_name?: unknown } | null;
		return typeof config?.project_name === 'string' && config.project_name.trim()
			? config.project_name.trim()
			: null;
	} catch {
		return null;
	}
}

export function getProjectNameFromPath(fullPath: string): string {
	return fullPath.split('/').pop()!;
}

export async function createNewProject({
	sourceDir,
	projectName,
	orgId,
}: {
	sourceDir: string;
	projectName: string;
	orgId: string;
}) {
	const projectId = crypto.randomUUID();
	const projectDir = path.resolve(env.NAO_PROJECTS_DIR, projectId);

	try {
		replaceProjectDirectory(sourceDir, projectDir);
	} catch (err) {
		fs.rmSync(projectDir, { recursive: true, force: true });
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: err instanceof Error ? err.message : 'Failed to import repository',
		});
	}

	const project = await projectQueries.createProject({
		name: projectName,
		type: 'local',
		path: projectDir,
		orgId,
	});

	const orgMembers = await orgQueries.listOrgMembersWithUsers(orgId);
	for (const member of orgMembers) {
		await projectQueries.addProjectMember({
			projectId: project.id,
			userId: member.id,
			role: member.role,
		});
	}
	await ensureContextRecommendationsScheduleForNewProject(project.id);

	return { projectId: project.id, projectName, status: 'created' as const };
}

export async function replaceExistingProject({
	sourceDir,
	project,
	projectName,
}: {
	sourceDir: string;
	project: DBProject;
	projectName: string;
}) {
	if (!project.path) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project path not configured' });
	}

	try {
		replaceProjectDirectory(sourceDir, project.path);
	} catch (err) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: err instanceof Error ? err.message : 'Failed to replace project from repository',
		});
	}

	await projectQueries.touchProjectUpdatedAt(project.id);
	return { projectId: project.id, projectName, status: 'updated' as const };
}

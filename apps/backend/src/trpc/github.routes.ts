import fs from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import yaml from 'js-yaml';
import { z } from 'zod/v4';

import type { DBProject } from '../db/abstractSchema';
import { env } from '../env';
import { ensureContextRecommendationsScheduleForNewProject } from '../handlers/context-recommendations.handler';
import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as githubService from '../services/github';
import { adminProtectedProcedure, protectedProcedure } from './trpc';

export const githubRoutes = {
	isAvailable: protectedProcedure.query(() => {
		return githubService.isGithubIntegrationAvailable();
	}),

	getStatus: protectedProcedure.query(async ({ ctx }) => {
		const token = await userQueries.getGithubToken(ctx.user.id);
		if (!token) {
			return { connected: false as const };
		}

		try {
			const user = await githubService.getUser(token);
			return { connected: true as const, user: { login: user.login, avatarUrl: user.avatar_url } };
		} catch {
			return { connected: false as const };
		}
	}),

	disconnect: protectedProcedure.mutation(async ({ ctx }) => {
		await userQueries.updateGithubToken(ctx.user.id, null);
	}),

	listRepos: protectedProcedure
		.input(z.object({ page: z.number().default(1), search: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const token = await userQueries.getGithubToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitHub is not connected' });
			}

			try {
				return await githubService.listRepos(token, { page: input.page, search: input.search });
			} catch (err) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: err instanceof Error ? err.message : 'Failed to list repos',
				});
			}
		}),

	createProjectFromRepo: protectedProcedure
		.input(
			z.object({
				repoFullName: z.string(),
				projectName: z.string().min(1).optional(),
				replaceExisting: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = await userQueries.getGithubToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitHub is not connected' });
			}

			const membership = await orgQueries.getUserOrgMembership(ctx.user.id);
			if (!membership) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
			}

			const cloneDir = createTempProjectDir();
			try {
				try {
					githubService.cloneRepo(token, input.repoFullName, cloneDir);
				} catch (err) {
					throw new TRPCError({
						code: 'INTERNAL_SERVER_ERROR',
						message: err instanceof Error ? err.message : 'Failed to clone repository',
					});
				}

				const orgId = membership.orgId;
				const projectName =
					input.projectName ||
					readProjectNameFromConfig(cloneDir) ||
					getProjectNameFromRepo(input.repoFullName);
				const existing = await projectQueries.getProjectByOrgAndName(orgId, projectName);
				if (existing) {
					if (!input.replaceExisting) {
						throw new TRPCError({
							code: 'CONFLICT',
							message: `A project named "${projectName}" already exists in this organization. Confirm replacement to import this repository over it.`,
						});
					}

					return replaceExistingProjectFromRepo({
						sourceDir: cloneDir,
						project: existing,
						projectName,
					});
				}

				return createProjectFromRepo({
					sourceDir: cloneDir,
					projectName,
					orgId,
				});
			} finally {
				try {
					fs.rmSync(cloneDir, { recursive: true, force: true });
				} catch {
					// best-effort cleanup
				}
			}
		}),

	getProjectGitInfo: adminProtectedProcedure.query(({ ctx }) => {
		if (!ctx.project.path) {
			return null;
		}
		return githubService.getGitInfo(ctx.project.path);
	}),

	unlinkProject: adminProtectedProcedure.mutation(async ({ ctx }) => {
		if (!ctx.project.path) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project path not configured' });
		}

		const gitInfo = githubService.getGitInfo(ctx.project.path);
		if (!gitInfo.isGithub) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'This project is not linked to a GitHub repository' });
		}

		try {
			githubService.removeOriginRemote(ctx.project.path);
			return githubService.getGitInfo(ctx.project.path);
		} catch (err) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: err instanceof Error ? err.message : 'Failed to unlink repository',
			});
		}
	}),

	pullProject: adminProtectedProcedure.mutation(async ({ ctx }) => {
		if (!ctx.project.path) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project path not configured' });
		}

		const gitInfo = githubService.getGitInfo(ctx.project.path);
		if (!gitInfo.isGithub || !gitInfo.repoFullName) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'This project is not linked to a GitHub repository' });
		}

		const token = await userQueries.getGithubToken(ctx.user.id);
		if (!token) {
			throw new TRPCError({
				code: 'BAD_REQUEST',
				message: 'GitHub is not connected. Connect your GitHub account first.',
			});
		}

		try {
			await githubService.pullRepo(token, gitInfo.repoFullName, ctx.project.path);
			return githubService.getGitInfo(ctx.project.path);
		} catch (err) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: err instanceof Error ? err.message : 'Failed to pull latest changes',
			});
		}
	}),
};

async function createProjectFromRepo({
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

async function replaceExistingProjectFromRepo({
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

function getProjectNameFromRepo(repoFullName: string): string {
	return repoFullName.split('/').pop()!;
}

function readProjectNameFromConfig(projectDir: string): string | null {
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

function createTempProjectDir(): string {
	const dir = path.resolve(env.NAO_PROJECTS_DIR, `.github-import-${crypto.randomUUID()}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function replaceProjectDirectory(src: string, dest: string): void {
	const parentDir = path.dirname(dest);
	const backupDir = path.join(parentDir, `.github-import-backup-${crypto.randomUUID()}`);
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

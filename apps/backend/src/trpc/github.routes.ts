import fs from 'node:fs';

import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as githubService from '../services/github';
import {
	createNewProject,
	createTempProjectDir,
	getProjectNameFromPath,
	readProjectNameFromConfig,
	replaceExistingProject,
} from '../utils/project-import.utils';
import { adminProtectedProcedure, contextAdminProtectedProcedure, protectedProcedure } from './trpc';

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

			const cloneDir = createTempProjectDir('github-import');
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
					getProjectNameFromPath(input.repoFullName);
				const existing = await projectQueries.getProjectByOrgAndName(orgId, projectName);
				if (existing) {
					if (!input.replaceExisting) {
						throw new TRPCError({
							code: 'CONFLICT',
							message: `A project named "${projectName}" already exists in this organization. Confirm replacement to import this repository over it.`,
							cause: { conflictingProjectName: projectName },
						});
					}

					return replaceExistingProject({
						sourceDir: cloneDir,
						project: existing,
						projectName,
					});
				}

				return createNewProject({
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

	getProjectGitInfo: contextAdminProtectedProcedure.query(({ ctx }) => {
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
			githubService.pullRepo(token, gitInfo.repoFullName, ctx.project.path);
			return githubService.getGitInfo(ctx.project.path);
		} catch (err) {
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: err instanceof Error ? err.message : 'Failed to pull latest changes',
			});
		}
	}),
};

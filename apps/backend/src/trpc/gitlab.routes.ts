import fs from 'node:fs';

import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import * as orgQueries from '../queries/organization.queries';
import * as projectQueries from '../queries/project.queries';
import * as userQueries from '../queries/user.queries';
import * as gitlabService from '../services/gitlab';
import { logger, serializeError } from '../utils/logger';
import {
	createNewProject,
	createTempProjectDir,
	getProjectNameFromPath,
	readProjectNameFromConfig,
	replaceExistingProject,
} from '../utils/project-import.utils';
import { adminProtectedProcedure, protectedProcedure } from './trpc';

export const gitlabRoutes = {
	isAvailable: protectedProcedure.query(() => {
		return gitlabService.isGitlabIntegrationAvailable();
	}),

	getStatus: protectedProcedure.query(async ({ ctx }) => {
		const token = await userQueries.getGitlabToken(ctx.user.id);
		if (!token) {
			return { connected: false as const };
		}

		try {
			const user = await gitlabService.getUser(token);
			return { connected: true as const, user: { username: user.username, avatarUrl: user.avatar_url } };
		} catch {
			return { connected: false as const };
		}
	}),

	disconnect: protectedProcedure.mutation(async ({ ctx }) => {
		await userQueries.updateGitlabToken(ctx.user.id, null);
	}),

	listProjects: protectedProcedure
		.input(z.object({ page: z.number().default(1), search: z.string().optional() }))
		.query(async ({ ctx, input }) => {
			const token = await userQueries.getGitlabToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitLab is not connected' });
			}

			try {
				return await gitlabService.listProjects(token, { page: input.page, search: input.search });
			} catch (err) {
				logger.error(`Failed to list GitLab projects: ${JSON.stringify(serializeError(err))}`, {
					source: 'http',
				});
				throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to list projects' });
			}
		}),

	createProjectFromRepo: protectedProcedure
		.input(
			z.object({
				projectPathWithNamespace: z.string(),
				projectName: z.string().min(1).optional(),
				replaceExisting: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const token = await userQueries.getGitlabToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitLab is not connected' });
			}

			const membership = await orgQueries.getUserOrgMembership(ctx.user.id);
			if (!membership) {
				throw new TRPCError({ code: 'NOT_FOUND', message: 'You are not a member of any organization' });
			}

			const cloneDir = createTempProjectDir('gitlab-import');
			try {
				try {
					gitlabService.cloneRepo(token, input.projectPathWithNamespace, cloneDir);
				} catch (err) {
					logger.error(`Failed to clone GitLab repository: ${JSON.stringify(serializeError(err))}`, {
						source: 'http',
					});
					throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to clone repository' });
				}

				const orgId = membership.orgId;
				const projectName =
					input.projectName ||
					readProjectNameFromConfig(cloneDir) ||
					getProjectNameFromPath(input.projectPathWithNamespace);
				const existing = await projectQueries.getProjectByOrgAndName(orgId, projectName);
				if (existing) {
					if (!input.replaceExisting) {
						throw new TRPCError({
							code: 'CONFLICT',
							message: `A project named "${projectName}" already exists in this organization. Confirm replacement to import this repository over it.`,
							cause: { conflictingProjectName: projectName },
						});
					}
					return replaceExistingProject({ sourceDir: cloneDir, project: existing, projectName });
				}

				return createNewProject({ sourceDir: cloneDir, projectName, orgId });
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
		return gitlabService.getGitInfo(ctx.project.path);
	}),

	unlinkProject: adminProtectedProcedure.mutation(async ({ ctx }) => {
		if (!ctx.project.path) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project path not configured' });
		}

		const gitInfo = gitlabService.getGitInfo(ctx.project.path);
		if (!gitInfo.isGitlab) {
			throw new TRPCError({ code: 'BAD_REQUEST', message: 'This project is not linked to a GitLab repository' });
		}

		try {
			gitlabService.removeOriginRemote(ctx.project.path);
			return gitlabService.getGitInfo(ctx.project.path);
		} catch (err) {
			logger.error(`Failed to unlink GitLab repository: ${JSON.stringify(serializeError(err))}`, {
				source: 'http',
			});
			throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to unlink repository' });
		}
	}),
};

import fs from 'node:fs';
import path from 'node:path';

import { TRPCError } from '@trpc/server';
import { z } from 'zod/v4';

import { env } from '../env';
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

			const orgId = membership.orgId;
			const projectName = input.projectName || input.repoFullName.split('/').pop()!;
			const existing = await projectQueries.getProjectByOrgAndName(orgId, projectName);
			if (existing) {
				throw new TRPCError({
					code: 'CONFLICT',
					message: `A project named "${projectName}" already exists in this organization`,
				});
			}

			const projectId = crypto.randomUUID();
			const projectDir = path.resolve(env.NAO_PROJECTS_DIR, projectId);
			fs.mkdirSync(projectDir, { recursive: true });

			try {
				await githubService.cloneRepo(token, input.repoFullName, projectDir);
			} catch (err) {
				fs.rmSync(projectDir, { recursive: true, force: true });
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: err instanceof Error ? err.message : 'Failed to clone repository',
				});
			}

			const project = await projectQueries.createProject({
				name: projectName,
				type: 'local',
				path: projectDir,
				orgId,
			});

			const orgMembers = await orgQueries.getOrgMembersWithUsers(orgId);
			for (const member of orgMembers) {
				await projectQueries.addProjectMember({
					projectId: project.id,
					userId: member.id,
					role: member.role,
				});
			}

			return { projectId: project.id, projectName };
		}),

	getProjectGitInfo: adminProtectedProcedure.query(({ ctx }) => {
		if (!ctx.project.path) {
			return null;
		}
		return githubService.getGitInfo(ctx.project.path);
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

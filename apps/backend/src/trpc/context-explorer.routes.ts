import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as userQueries from '../queries/user.queries';
import {
	getFileTreeResponse,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../services/context-explorer.service';
import {
	connectContextRepository,
	discardContextFileChange,
	getChangedContextFiles,
	getContextFileDiff,
	getContextRepositoryStatus,
} from '../services/context-explorer-git.service';
import { createContextExplorerPullRequest } from '../services/context-explorer-pr.service';
import { contextAdminProtectedProcedure } from './trpc';

function requireProjectPath(path: string | null): string {
	if (!path) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project path configured' });
	}
	return path;
}

export const contextExplorerRoutes = {
	getRepositoryStatus: contextAdminProtectedProcedure.query(({ ctx }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return getContextRepositoryStatus(projectPath);
	}),

	connectRepository: contextAdminProtectedProcedure
		.input(
			z.object({
				provider: z.enum(['github', 'gitlab']),
				repoFullName: z
					.string()
					.trim()
					.regex(/^[\w./-]+\/[\w.-]+$/, 'Expected a repository in "owner/name" format'),
				branch: z.string().trim().min(1).optional().default('main'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			const token =
				input.provider === 'github'
					? await userQueries.getGithubToken(ctx.user.id)
					: await userQueries.getGitlabToken(ctx.user.id);
			if (!token) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message:
						input.provider === 'github'
							? 'GitHub is not connected. Connect your GitHub account first.'
							: 'GitLab is not connected. Connect your GitLab account first.',
				});
			}

			try {
				return await connectContextRepository({ projectFolder: projectPath, token, ...input });
			} catch (error) {
				throw new TRPCError({
					code: 'BAD_REQUEST',
					message: error instanceof Error ? error.message : 'Failed to connect repository.',
				});
			}
		}),

	getFileTree: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return getFileTreeResponse(projectPath);
	}),

	readFile: contextAdminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return readFileContent(input.path, projectPath);
	}),

	writeFile: contextAdminProtectedProcedure
		.input(
			z.object({
				path: z.string(),
				content: z.string().max(MAX_CONTEXT_FILE_SIZE),
				expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			return writeFileContent(input.path, input.content, input.expectedHash, projectPath);
		}),

	searchContent: contextAdminProtectedProcedure
		.input(z.object({ query: z.string().min(2).max(200) }))
		.query(async ({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			return searchFileContents(input.query, projectPath);
		}),

	getChangedFiles: contextAdminProtectedProcedure.query(({ ctx }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return getChangedContextFiles(projectPath);
	}),

	getFileDiff: contextAdminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return getContextFileDiff(input.path, projectPath);
	}),

	createPullRequest: contextAdminProtectedProcedure
		.input(z.object({ paths: z.array(z.string()).min(1).max(100) }))
		.mutation(async ({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			return createContextExplorerPullRequest(projectPath, ctx.user.id, input.paths);
		}),

	discardLocalChange: contextAdminProtectedProcedure
		.input(z.object({ path: z.string() }))
		.mutation(({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			return discardContextFileChange(input.path, projectPath);
		}),
};

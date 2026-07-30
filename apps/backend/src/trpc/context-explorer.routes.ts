import { REPO_PROVIDERS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as userQueries from '../queries/user.queries';
import type { ContextExplorerFileAccess } from '../services/context-explorer.service';
import {
	getFileTreeResponse,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../services/context-explorer.service';
import type { ContextExplorerGitContext } from '../services/context-explorer-git.service';
import {
	commitContextChanges,
	connectContextRepository,
	createContextBranch,
	createContextBranchAndCommit,
	discardAllContextChanges,
	discardContextFileChange,
	getChangedContextFiles,
	getContextFileDiff,
	getContextRepositoryStatus,
	resolveContextExplorerGit,
	suggestContextBranchName,
	switchContextBranch,
} from '../services/context-explorer-git.service';
import { createContextExplorerPullRequest } from '../services/context-explorer-pr.service';
import { resolveContextRepository } from '../utils/context-repo';
import { contextAdminProtectedProcedure } from './trpc';

const branchSchema = z.string().trim().min(1).max(200);
const pathsSchema = z.array(z.string()).min(1).max(100);

export const contextExplorerRoutes = {
	getRepositoryStatus: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return getContextRepositoryStatus(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id));
	}),

	connectRepository: contextAdminProtectedProcedure
		.input(
			z.object({
				provider: z.enum(REPO_PROVIDERS),
				repoFullName: z
					.string()
					.trim()
					.regex(/^[\w./-]+\/[\w.-]+$/, 'Expected a repository in "owner/name" format'),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.provider !== 'github') {
				throw new TRPCError({ code: 'BAD_REQUEST', message: 'GitLab is not supported yet.' });
			}
			const projectFolder = requireProjectPath(ctx.project.path);
			const context: ContextExplorerGitContext = {
				projectId: ctx.project.id,
				projectFolder,
				token: await userQueries.getGithubToken(ctx.user.id),
			};
			if (!context.token) {
				throw new TRPCError({ code: 'FORBIDDEN', message: 'Connect your GitHub account first.' });
			}
			return connectContextRepository({ ...context, token: context.token, ...input });
		}),

	getFileTree: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const access = await createFileAccess(ctx.project.id, ctx.project.path, ctx.user.id);
		return getFileTreeResponse(access);
	}),

	readFile: contextAdminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const access = await createFileAccess(ctx.project.id, ctx.project.path, ctx.user.id);
		return readFileContent(input.path, access);
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
			const access = await createFileAccess(ctx.project.id, ctx.project.path, ctx.user.id);
			return writeFileContent(input.path, input.content, input.expectedHash, access);
		}),

	searchContent: contextAdminProtectedProcedure
		.input(z.object({ query: z.string().min(2).max(200) }))
		.query(({ ctx, input }) => searchFileContents(input.query, requireProjectPath(ctx.project.path))),

	getChangedFiles: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return getChangedContextFiles(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id));
	}),

	getFileDiff: contextAdminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		return getContextFileDiff(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id), input.path);
	}),

	switchBranch: contextAdminProtectedProcedure
		.input(z.object({ branch: branchSchema }))
		.mutation(async ({ ctx, input }) => {
			return switchContextBranch(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id),
				input.branch,
			);
		}),

	createBranch: contextAdminProtectedProcedure
		.input(z.object({ branch: branchSchema }))
		.mutation(async ({ ctx, input }) => {
			return createContextBranch(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id),
				input.branch,
			);
		}),

	suggestBranchName: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return suggestContextBranchName(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id));
	}),

	createBranchAndCommit: contextAdminProtectedProcedure
		.input(
			z.object({
				branch: branchSchema.optional(),
				paths: pathsSchema,
				message: z.string().trim().min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createContextBranchAndCommit(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id),
				input,
			);
		}),

	commitChanges: contextAdminProtectedProcedure
		.input(z.object({ paths: pathsSchema, message: z.string().trim().min(1).max(500) }))
		.mutation(async ({ ctx, input }) => {
			return commitContextChanges(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id), input);
		}),

	discardLocalChange: contextAdminProtectedProcedure
		.input(z.object({ path: z.string() }))
		.mutation(async ({ ctx, input }) => {
			return discardContextFileChange(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id),
				input.path,
			);
		}),

	discardAllChanges: contextAdminProtectedProcedure.mutation(async ({ ctx }) => {
		return discardAllContextChanges(await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id));
	}),

	createPullRequest: contextAdminProtectedProcedure
		.input(
			z.object({
				paths: pathsSchema,
				message: z.string().trim().min(1).max(500),
				title: z.string().trim().min(1).max(200),
				body: z.string().max(10_000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createContextExplorerPullRequest(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user.id),
				input,
			);
		}),
};

async function createFileAccess(
	projectId: string,
	projectPath: string | null,
	userId: string,
): Promise<ContextExplorerFileAccess> {
	const context = await createGitContext(projectId, projectPath, userId);
	return {
		projectId,
		projectFolder: context.projectFolder,
		userId,
		git: await resolveContextExplorerGit(context),
	};
}

async function createGitContext(
	projectId: string,
	projectPath: string | null,
	userId: string,
): Promise<ContextExplorerGitContext> {
	const projectFolder = requireProjectPath(projectPath);
	const repository = await resolveContextRepository(projectId, projectFolder);
	return {
		projectId,
		projectFolder,
		token:
			repository?.provider === 'gitlab'
				? await userQueries.getGitlabToken(userId)
				: await userQueries.getGithubToken(userId),
	};
}

function requireProjectPath(projectPath: string | null): string {
	if (!projectPath) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project path configured.' });
	}
	return projectPath;
}

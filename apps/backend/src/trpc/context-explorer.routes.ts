import { REPO_PROVIDERS } from '@nao/shared/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import * as activityQueries from '../queries/activity.queries';
import { generateContextCommitMessage } from '../services/context-commit-message.service';
import {
	getFileTree,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../services/context-explorer.service';
import {
	createGitContext,
	createSafeFileAccess,
	createStrictFileAccess,
	getProviderToken,
} from '../services/context-explorer-access.service';
import {
	commitContextChanges,
	connectContextRepository,
	type ContextExplorerGitContext,
	createContextBranch,
	createContextBranchAndCommit,
	discardAllContextChanges,
	discardContextFileChange,
	disconnectContextRepository,
	getChangedContextFiles,
	getContextFileDiff,
	getContextRepositoryStatus,
	getHistoricalContextDiffActions,
	listContextRepositoryBranches,
	pullLiveContext,
	sanitizeLiveContextError,
	suggestContextBranchName,
	switchContextBranch,
	undoLastContextCommit,
	updateContextWorktree,
} from '../services/context-explorer-git.service';
import { pushContextExplorerBranch } from '../services/context-explorer-pr.service';
import { listContextFileHeaderProblems, listContextFileOwners } from '../services/context-file-header.service';
import {
	discardAllNaoDraftFiles,
	discardNaoDraftFile,
	getNaoDraftFileDiff,
	getNaoDraftFileTree,
	hasContextRepository,
	listNaoDraftChanges,
	searchNaoDraftContents,
} from '../services/nao-draft.service';
import { getRepoProviderDisplayName } from '../services/review-request-provider';
import { listActiveUserGroups } from '../services/user-group-availability.service';
import { ContextProjectResolutionError } from '../utils/context-repo';
import { logger, serializeError } from '../utils/logger';
import { draftOwnerOf, requireProjectPath } from './route-context';
import { cloudBillingAdminProcedure, cloudBillingContextAdminProcedure, contextAdminProtectedProcedure } from './trpc';

const branchSchema = z.string().trim().min(1).max(200);
const pathsSchema = z.array(z.string()).min(1).max(100);
const commitSchema = z.string().regex(/^[a-f0-9]{40,64}$/i);
const MAX_PULL_HISTORY_FILES = 1_000;
const fileDiffInputSchema = z
	.object({
		path: z.string(),
		from: commitSchema.optional(),
		to: commitSchema.optional(),
	})
	.refine((input) => Boolean(input.from) === Boolean(input.to), {
		message: 'Both historical commits are required.',
	});
const pullFileSchema = z.object({
	path: z.string().max(2_000),
	additions: z.number().int().nonnegative().nullable(),
	deletions: z.number().int().nonnegative().nullable(),
});
const pullPayloadSchema = z.object({
	configuredBranch: z.string().max(200),
	changed: z.boolean(),
	oldCommit: z
		.string()
		.regex(/^[a-f0-9]{40,64}$/)
		.nullable(),
	newCommit: z.string().regex(/^[a-f0-9]{40,64}$/),
	fileCount: z.number().int().nonnegative().optional(),
	files: z.array(pullFileSchema).max(MAX_PULL_HISTORY_FILES),
});

export const contextExplorerRoutes = {
	getRepositoryStatus: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return getContextRepositoryStatus(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	getLiveContextPullHistory: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const activities = await activityQueries.listContextPullActivities(ctx.project.id);
		const entries = activities.map(toContextPullHistoryEntry);
		const actions = await getHistoricalContextDiffActions(
			await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
			entries.map((entry) => ({ fromCommit: entry.oldCommit, toCommit: entry.newCommit })),
		);
		return entries.map((entry, index) => ({ ...entry, fileExplorerAction: actions[index] ?? 'update' }));
	}),

	pullLiveContext: cloudBillingAdminProcedure.mutation(async ({ ctx }) => {
		const activity = await activityQueries.startContextPullActivity(ctx.project.id, ctx.user.id);
		let token: string | null | undefined;
		try {
			const gitContext = await createGitContext(ctx.project.id, ctx.project.path, ctx.user);
			token = gitContext.token;
			const result = await pullLiveContext(gitContext);
			try {
				await activityQueries.completeActivity(activity.id, {
					configuredBranch: result.configuredBranch,
					changed: result.changed,
					oldCommit: result.oldCommit,
					newCommit: result.newCommit,
					fileCount: result.files.length,
					files: result.files.slice(0, MAX_PULL_HISTORY_FILES),
				});
			} catch (persistenceError) {
				logPullHistoryFailure(
					'Context pull completed, but its history could not be saved.',
					ctx.project.id,
					activity.id,
					persistenceError,
				);
			}
			return result;
		} catch (error) {
			const sanitizedError = sanitizeLiveContextError(error, token);
			try {
				await activityQueries.failActivity(activity.id, sanitizedError.message);
			} catch (persistenceError) {
				logPullHistoryFailure(
					'Context pull failed, but its history could not be updated.',
					ctx.project.id,
					activity.id,
					persistenceError,
				);
			}
			throw new TRPCError({
				code:
					error instanceof TRPCError
						? error.code
						: error instanceof ContextProjectResolutionError
							? 'BAD_REQUEST'
							: 'INTERNAL_SERVER_ERROR',
				message: sanitizedError.message,
			});
		}
	}),

	connectRepository: cloudBillingContextAdminProcedure
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
			const projectFolder = requireProjectPath(ctx.project.path);
			const context: ContextExplorerGitContext = {
				projectId: ctx.project.id,
				projectFolder,
				userId: ctx.user.id,
				user: { name: ctx.user.name, email: ctx.user.email },
				token: await getProviderToken(input.provider, ctx.user.id),
			};
			if (!context.token) {
				throw new TRPCError({
					code: 'FORBIDDEN',
					message: `Connect your ${getRepoProviderDisplayName(input.provider)} account first.`,
				});
			}
			return connectContextRepository({ ...context, token: context.token, ...input });
		}),

	disconnectRepository: cloudBillingContextAdminProcedure.mutation(async ({ ctx }) => {
		return disconnectContextRepository({
			projectId: ctx.project.id,
			projectFolder: requireProjectPath(ctx.project.path),
			userId: ctx.user.id,
		});
	}),

	getFileTree: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const projectFolder = requireProjectPath(ctx.project.path);
		const entries = (await hasContextRepository(ctx.project.id))
			? await getFileTree(projectFolder)
			: await getNaoDraftFileTree(draftOwnerOf(ctx), projectFolder);
		return { entries };
	}),

	getRulesPreviewGroups: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const groups = await listActiveUserGroups(ctx.project.id);
		return {
			enforced: true as const,
			groups: groups.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
		};
	}),

	listFileOwners: contextAdminProtectedProcedure.query(async ({ ctx }) => listContextFileOwners(ctx.project.id)),

	getFileHeaderProblems: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		const access = await createSafeFileAccess(ctx.project.id, ctx.project.path, ctx.user);
		return listContextFileHeaderProblems(ctx.project.id, access);
	}),

	readFile: contextAdminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const access = await createSafeFileAccess(ctx.project.id, ctx.project.path, ctx.user);
		return readFileContent(input.path, access);
	}),

	writeFile: cloudBillingContextAdminProcedure
		.input(
			z.object({
				path: z.string(),
				content: z.string().max(MAX_CONTEXT_FILE_SIZE),
				expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const access = await createStrictFileAccess(ctx.project.id, ctx.project.path, ctx.user);
			return writeFileContent(input.path, input.content, input.expectedHash, access);
		}),

	searchContent: contextAdminProtectedProcedure
		.input(z.object({ query: z.string().min(2).max(200) }))
		.query(async ({ ctx, input }) => {
			const projectFolder = requireProjectPath(ctx.project.path);
			return (await hasContextRepository(ctx.project.id))
				? searchFileContents(input.query, projectFolder)
				: searchNaoDraftContents(draftOwnerOf(ctx), projectFolder, input.query);
		}),

	getChangedFiles: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		if (!(await hasContextRepository(ctx.project.id))) {
			return listNaoDraftChanges(draftOwnerOf(ctx));
		}
		return getChangedContextFiles(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	getFileDiff: contextAdminProtectedProcedure.input(fileDiffInputSchema).query(async ({ ctx, input }) => {
		if (!input.from && !(await hasContextRepository(ctx.project.id))) {
			return getNaoDraftFileDiff(draftOwnerOf(ctx), requireProjectPath(ctx.project.path), input.path);
		}
		return getContextFileDiff(
			await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
			input.path,
			input.from && input.to ? { fromCommit: input.from, toCommit: input.to } : undefined,
		);
	}),

	getHistoricalDiffAction: contextAdminProtectedProcedure
		.input(z.object({ from: commitSchema, to: commitSchema }))
		.query(async ({ ctx, input }) => {
			const actions = await getHistoricalContextDiffActions(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				[{ fromCommit: input.from, toCommit: input.to }],
			);
			return actions[0] ?? 'update';
		}),

	updateWorktree: cloudBillingContextAdminProcedure
		.input(z.object({ requiredCommits: z.array(commitSchema).max(2).default([]) }))
		.mutation(async ({ ctx, input }) => {
			return updateContextWorktree(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input.requiredCommits,
			);
		}),

	listBranches: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return listContextRepositoryBranches(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	switchBranch: cloudBillingContextAdminProcedure
		.input(z.object({ branch: branchSchema }))
		.mutation(async ({ ctx, input }) => {
			return switchContextBranch(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input.branch,
			);
		}),

	createBranch: cloudBillingContextAdminProcedure
		.input(z.object({ branch: branchSchema }))
		.mutation(async ({ ctx, input }) => {
			return createContextBranch(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input.branch,
			);
		}),

	suggestBranchName: contextAdminProtectedProcedure.query(async ({ ctx }) => {
		return suggestContextBranchName(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	createBranchAndCommit: cloudBillingContextAdminProcedure
		.input(
			z.object({
				branch: branchSchema.optional(),
				paths: pathsSchema,
				message: z.string().trim().min(1).max(500),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			return createContextBranchAndCommit(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input,
			);
		}),

	commitChanges: cloudBillingContextAdminProcedure
		.input(z.object({ paths: pathsSchema, message: z.string().trim().min(1).max(500) }))
		.mutation(async ({ ctx, input }) => {
			return commitContextChanges(await createGitContext(ctx.project.id, ctx.project.path, ctx.user), input);
		}),

	discardLocalChange: cloudBillingContextAdminProcedure
		.input(z.object({ path: z.string() }))
		.mutation(async ({ ctx, input }) => {
			if (!(await hasContextRepository(ctx.project.id))) {
				return discardNaoDraftFile(draftOwnerOf(ctx), requireProjectPath(ctx.project.path), input.path);
			}
			return discardContextFileChange(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input.path,
			);
		}),

	discardAllChanges: cloudBillingContextAdminProcedure.mutation(async ({ ctx }) => {
		if (!(await hasContextRepository(ctx.project.id))) {
			return discardAllNaoDraftFiles(draftOwnerOf(ctx));
		}
		return discardAllContextChanges(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	undoLastCommit: cloudBillingContextAdminProcedure.mutation(async ({ ctx }) => {
		await undoLastContextCommit(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),

	generateCommitMessage: cloudBillingContextAdminProcedure
		.input(z.object({ paths: pathsSchema }))
		.mutation(async ({ ctx, input }) => {
			return generateContextCommitMessage(
				await createGitContext(ctx.project.id, ctx.project.path, ctx.user),
				input.paths,
			);
		}),

	pushBranch: cloudBillingContextAdminProcedure.mutation(async ({ ctx }) => {
		return pushContextExplorerBranch(await createGitContext(ctx.project.id, ctx.project.path, ctx.user));
	}),
};

function toContextPullHistoryEntry(activity: activityQueries.ContextPullActivityRow) {
	const payload = parsePullPayload(activity.payload);
	return {
		id: activity.id,
		status: activity.status,
		startedAt: activity.startedAt,
		completedAt: activity.completedAt,
		configuredBranch: payload.success ? payload.data.configuredBranch : null,
		changed: payload.success ? payload.data.changed : null,
		oldCommit: payload.success ? payload.data.oldCommit : null,
		newCommit: payload.success ? payload.data.newCommit : null,
		fileCount: payload.success ? (payload.data.fileCount ?? payload.data.files.length) : 0,
		files: payload.success ? payload.data.files : [],
		errorMessage: activity.status === 'failed' ? (activity.errorMessage ?? 'Context pull failed.') : null,
	};
}

function parsePullPayload(payload: Record<string, unknown> | null) {
	if (!payload || !Array.isArray(payload.files)) {
		return pullPayloadSchema.safeParse(payload);
	}
	return pullPayloadSchema.safeParse({
		...payload,
		fileCount: payload.fileCount ?? payload.files.length,
		files: payload.files.slice(0, MAX_PULL_HISTORY_FILES),
	});
}

function logPullHistoryFailure(message: string, projectId: string, activityId: string, error: unknown): void {
	logger.warn(message, {
		source: 'system',
		context: { projectId, activityId, error: serializeError(error) },
	});
}

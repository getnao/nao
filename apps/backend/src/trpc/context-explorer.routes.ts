import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
	getFileTree,
	MAX_CONTEXT_FILE_SIZE,
	readFileContent,
	searchFileContents,
	writeFileContent,
} from '../services/context-explorer.service';
import { isGitRepository } from '../utils/git-repo';
import { adminProtectedProcedure } from './trpc';

function requireProjectPath(path: string | null): string {
	if (!path) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project path configured' });
	}
	return path;
}

export const contextExplorerRoutes = {
	getFileTree: adminProtectedProcedure.query(async ({ ctx }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return {
			entries: await getFileTree(projectPath),
			isEditable: isGitRepository(projectPath),
		};
	}),

	readFile: adminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		return readFileContent(input.path, projectPath);
	}),

	writeFile: adminProtectedProcedure
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

	searchContent: adminProtectedProcedure
		.input(z.object({ query: z.string().min(2).max(200) }))
		.query(async ({ ctx, input }) => {
			const projectPath = requireProjectPath(ctx.project.path);
			return searchFileContents(input.query, projectPath);
		}),
};

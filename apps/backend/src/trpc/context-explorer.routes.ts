import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { getFileTree, readFileContent } from '../services/context-explorer.service';
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
		return getFileTree(projectPath);
	}),

	readFile: adminProtectedProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
		const projectPath = requireProjectPath(ctx.project.path);
		const content = await readFileContent(input.path, projectPath);
		return { content };
	}),
};

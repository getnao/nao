import { TRPCError } from '@trpc/server';

import type { DraftOwner } from '../queries/context-draft.queries';

interface ProjectUserContext {
	project: { id: string };
	user: { id: string };
}

export function requireProjectPath(projectPath: string | null): string {
	if (!projectPath) {
		throw new TRPCError({ code: 'BAD_REQUEST', message: 'No project path configured.' });
	}
	return projectPath;
}

export function draftOwnerOf(ctx: ProjectUserContext): DraftOwner {
	return { projectId: ctx.project.id, userId: ctx.user.id };
}

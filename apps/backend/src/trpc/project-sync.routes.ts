import { getProjectSyncState, startProjectSync } from '../services/project-sync.service';
import { createGitContext } from './context-explorer.routes';
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure, router } from './trpc';

export const projectSyncRoutes = router({
	getStatus: contextAdminProtectedProcedure.query(async ({ ctx }) =>
		getProjectSyncState(ctx.project, await createGitContext(ctx.project.id, ctx.project.path, ctx.user)),
	),
	start: cloudBillingContextAdminProcedure.mutation(async ({ ctx }) =>
		startProjectSync(ctx.project, await createGitContext(ctx.project.id, ctx.project.path, ctx.user)),
	),
});

import { createGitContext } from '../services/context-explorer-access.service';
import { cancelProjectSync, getProjectSyncState, startProjectSync } from '../services/project-sync.service';
import { adminProtectedProcedure, cloudBillingAdminProcedure, contextAdminProtectedProcedure, router } from './trpc';

export const projectSyncRoutes = router({
	getStatus: contextAdminProtectedProcedure.query(async ({ ctx }) =>
		getProjectSyncState(ctx.project, await createGitContext(ctx.project.id, ctx.project.path, ctx.user)),
	),
	start: cloudBillingAdminProcedure.mutation(async ({ ctx }) =>
		startProjectSync(ctx.project, await createGitContext(ctx.project.id, ctx.project.path, ctx.user)),
	),
	cancel: adminProtectedProcedure.mutation(({ ctx }) => cancelProjectSync(ctx.project.id, ctx.user.id)),
});

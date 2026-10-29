import { getProjectSyncState, startProjectSync } from '../services/project-sync.service';
import { cloudBillingContextAdminProcedure, contextAdminProtectedProcedure, router } from './trpc';

export const projectSyncRoutes = router({
	getStatus: contextAdminProtectedProcedure.query(({ ctx }) => getProjectSyncState(ctx.project)),
	start: cloudBillingContextAdminProcedure.mutation(({ ctx }) => startProjectSync(ctx.project)),
});

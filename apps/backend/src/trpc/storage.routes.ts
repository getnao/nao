import { env } from '../env';
import * as projectQueries from '../queries/project.queries';
import { getStorageConfig, getStorageHealth, isStorageEnabled } from '../services/storage';
import { getProjectUsageByUser, getScopeUsage } from '../services/storage/usage';
import { adminProtectedProcedure, projectProtectedProcedure } from './trpc';

export const storageRoutes = {
	getConfig: adminProtectedProcedure.query(() => getStorageConfig()),

	getHealth: adminProtectedProcedure.query(async () => {
		const health = await getStorageHealth();
		return { ...health, checkedAt: new Date() };
	}),

	/** What the chat input needs to know before letting someone attach a file. */
	getUploadLimits: projectProtectedProcedure.query(() => ({
		enabled: isStorageEnabled(),
		maxFileSizeMb: env.NAO_STORAGE_MAX_FILE_SIZE_MB,
	})),

	/** Everyone sees their own space; admins also get the breakdown across the project. */
	getUsage: projectProtectedProcedure.query(async ({ ctx }) => {
		const own = await getScopeUsage({ projectId: ctx.project.id, userId: ctx.user.id });

		return {
			own,
			byUser: ctx.userRole === 'admin' ? await getNamedUsageByUser(ctx.project.id) : null,
		};
	}),
};

/** Files outlive membership, so a space whose owner left is labelled by its user id. */
const getNamedUsageByUser = async (projectId: string) => {
	const [usageByUser, members] = await Promise.all([
		getProjectUsageByUser(projectId),
		projectQueries.listUsersWithProjectAccess(projectId),
	]);
	const nameByUserId = new Map(members.map((member) => [member.id, member.name || member.email]));

	return usageByUser.map((usage) => ({ ...usage, name: nameByUserId.get(usage.userId) ?? usage.userId }));
};

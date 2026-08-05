import { env } from '../env';
import { getStorageConfig, getStorageHealth, isStorageEnabled } from '../services/storage';
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
};

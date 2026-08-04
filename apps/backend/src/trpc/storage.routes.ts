import { getStorageConfig, getStorageHealth } from '../services/storage';
import { adminProtectedProcedure } from './trpc';

export const storageRoutes = {
	getConfig: adminProtectedProcedure.query(() => getStorageConfig()),

	getHealth: adminProtectedProcedure.query(async () => {
		const health = await getStorageHealth();
		return { ...health, checkedAt: new Date() };
	}),
};

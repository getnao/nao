import { env } from '../env';
import { checkForUpdate } from '../services/version-check.service';
import { adminProtectedProcedure, publicProcedure } from './trpc';

export const systemRoutes = {
	getPublicConfig: publicProcedure.query(() => ({
		naoMode: env.NAO_MODE,
	})),

	version: adminProtectedProcedure.query(() => ({
		version: env.APP_VERSION,
		commit: env.APP_COMMIT,
		buildDate: env.APP_BUILD_DATE,
	})),

	checkUpdate: adminProtectedProcedure.query(async () => {
		const result = await checkForUpdate();
		return {
			currentVersion: result.currentVersion,
			latestVersion: result.latestVersion,
			updateAvailable: result.updateAvailable,
		};
	}),
};

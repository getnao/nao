import { env } from '../env';
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
};

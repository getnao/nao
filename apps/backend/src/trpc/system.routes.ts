import { env } from '../env';
import { adminProtectedProcedure } from './trpc';

export const systemRoutes = {
	version: adminProtectedProcedure.query(() => ({
		version: env.APP_VERSION,
		commit: env.APP_COMMIT,
		buildDate: env.APP_BUILD_DATE,
	})),
};

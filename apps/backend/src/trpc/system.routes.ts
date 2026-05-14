import { env } from '../env';
import * as userQueries from '../queries/user.queries';
import { checkForUpdate } from '../services/version-check.service';
import { adminProtectedProcedure, publicProcedure } from './trpc';

export const systemRoutes = {
	getPublicConfig: publicProcedure.query(async () => ({
		naoMode: env.NAO_MODE,
		enableUserLogin: env.ENABLE_USER_LOGIN,
		enableUserSignup: await isUserSignupAvailable(),
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

async function isUserSignupAvailable(): Promise<boolean> {
	if (env.ENABLE_USER_SIGNUP) {
		return true;
	}

	return (await userQueries.countUsers()) === 0;
}

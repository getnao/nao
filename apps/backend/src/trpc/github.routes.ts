import { env } from '../env';
import { publicProcedure } from './trpc';

export const githubRoutes = {
	isSetup: publicProcedure.query(() => {
		return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
	}),
};

import { posthog } from '../services/posthog';
import { publicProcedure } from './trpc';

export const posthogRoutes = {
	getConfig: publicProcedure.query(() => {
		return posthog.getConfig();
	}),
};

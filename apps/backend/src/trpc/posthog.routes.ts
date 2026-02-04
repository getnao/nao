import { posthog } from '../services/posthog.service';
import { publicProcedure } from './trpc';

export const posthogRoutes = {
	getConfig: publicProcedure.query(() => {
		return posthog.getConfig();
	}),
};

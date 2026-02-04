import { posthog } from '../services/posthog.service';
import { publicProcedure } from './trpc';

export const posthogRoutes = {
	isEnabled: publicProcedure.query(() => {
		return posthog.isEnabled();
	}),
};

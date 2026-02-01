import { publicProcedure, router } from './trpc';

export const configRoutes = router({
	getPostHogConfig: publicProcedure.query(() => {
		return {
			posthog: {
				apiKey: process.env.POSTHOG_KEY,
				apiHost: process.env.POSTHOG_HOST,
			},
		};
	}),
});
